//! Backend for `fs.watch()`.
//!
//! This is deliberately independent of `bun.Watcher` (the bundler/--watch/--hot
//! watcher). `bun.Watcher` is shaped around a module graph — its WatchItem carries
//! `options.Loader`, `*PackageJSON`, a filesystem handle, and on Windows is pinned
//! to `top_level_dir`. None of that applies to `fs.watch()`, and routing `fs.watch()`
//! through it required a 1k-line shim (the old version of this file) full of
//! lock-ordering workarounds, a WorkPool directory crawler, and a bolted-on FSEvents
//! side-channel.
//!
//! Every platform has the same shape:
//!
//!   PathWatcherManager        process-global, lazy, owns the OS resource
//!     ├─ Linux:   one inotify fd + one reader thread, wd → PathWatcher map
//!     ├─ macOS:   delegates to fs_events.rs (one CFRunLoop thread, one FSEventStream)
//!     ├─ FreeBSD: one kqueue fd + one reader thread, fd → PathWatcher map
//!     └─ Windows: one completion port + one reader thread, one directory handle per PathWatcher
//!
//!   PathWatcher               one per unique (realpath, recursive) — deduped
//!     └─ handlers[]           the JS FSWatcher contexts sharing this watch
//!
//! A second `fs.watch()` on the same path returns the existing PathWatcher with a
//! new handler appended. `detach()` removes a handler; the last one out tears down
//! the OS watch.

use core::cell::Cell;
use core::ffi::c_void;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use core::sync::atomic::{AtomicBool, Ordering};

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_collections::HashMap;
use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::ZBox;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_core::strings;
#[cfg(not(target_os = "macos"))]
use bun_core::{Output, zstr};
use bun_core::{Timespec, TimespecMockMode, ZStr, handle_oom};
use bun_paths as path;
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_paths::platform;
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_paths::resolve_path::join_z_buf_spill;
#[cfg(not(target_os = "macos"))]
use bun_sys::FdExt;
#[cfg(windows)]
use bun_sys::windows as w;
use bun_sys::{self as sys, E, Fd, Tag};
use bun_threading::{Guarded, Mutex};
use bun_wyhash::hash;

use crate::node::node_fs_watcher::{Event, FSWatcher, WatchEventKind};

#[cfg(target_os = "macos")]
use crate::node::fs_events as fsevents;

bun_output::define_scoped_log!(log, fs_watch, hidden);

/// Process-global manager. Created on first `fs.watch()`, never destroyed (matches
/// the FSEvents loop's lifetime).
// PORTING.md §Global mutable state: init-once-then-read-only → `OnceLock`.
// `DEFAULT_MANAGER_MUTEX` still serializes the *fallible* init path so a failed
// `Platform::init` can be retried on a later `get()` without two threads
// racing to allocate; `OnceLock` provides the Acquire/Release publish so the
// FSEvents-thread reads in `on_fs_event` need no `unsafe`.
static DEFAULT_MANAGER: std::sync::OnceLock<&'static PathWatcherManager> =
    std::sync::OnceLock::new();
static DEFAULT_MANAGER_MUTEX: Mutex = Mutex::new();

// ────────────────────────────────────────────────────────────────────────────────
// PathWatcherManager
// ────────────────────────────────────────────────────────────────────────────────

pub(crate) struct PathWatcherManager {
    /// Guards `watchers` and all per-platform dispatch maps. The reader thread holds
    /// this while dispatching, so `detach()` on the JS thread cannot free a PathWatcher
    /// mid-emit. A single lock here replaces the three interacting mutexes of the old
    /// design.
    mutex: Guarded<Locked>,

    /// inotify/kqueue fd, or the completion port. Set once in `Platform::init` *before*
    /// the reader thread spawns, never reassigned (process-lifetime singleton, no teardown).
    /// Hoisted out of `Locked` so reads are safe `Cell::get()` with no lock and no
    /// raw deref; thread-spawn happens-before makes the cross-thread read sound.
    #[cfg(not(target_os = "macos"))]
    platform_fd: Cell<Fd>,

    /// Reader-thread loop flag. Initialized `true`, never cleared (no teardown).
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    running: AtomicBool,

    /// Monotonic kevent generation counter (FreeBSD). Bumped under `mutex`.
    /// `Cell` so the bump is a safe `.get()/.set()` instead of a raw deref.
    #[cfg(target_os = "freebsd")]
    next_gen: Cell<usize>,
}

/// The maps [`PathWatcherManager::mutex`] owns.
#[derive(Default)]
struct Locked {
    /// Dedup map: dedup key → PathWatcher. The key is the resolved path with a one-byte
    /// suffix encoding `recursive` (so `fs.watch(p)` and `fs.watch(p, {recursive:true})`
    /// don't share — they want different OS registrations on every platform).
    watchers: StringArrayHashMap<*mut PathWatcher>,

    /// Platform-specific dispatch maps (inotify wd_map / kqueue entries).
    /// On macOS this is empty — FSEvents owns its own thread via `fs_events.rs`.
    #[cfg(not(target_os = "macos"))]
    platform: Platform,
}

// SAFETY: all interior-mutable state (`watchers`, `platform` dispatch maps,
// `next_gen`) is only accessed while holding `mutex`. `running` is atomic.
// `platform_fd` is set once in `init()` before the reader thread spawns and is
// never written afterwards, so cross-thread `Cell::get()` reads observe only the
// publish ordered by the spawn happens-before — no data race. The manager is a
// process-global singleton shared between the JS thread(s) and the reader thread.
unsafe impl Sync for PathWatcherManager {}

impl Default for PathWatcherManager {
    fn default() -> Self {
        Self {
            mutex: Guarded::new(Locked::default()),
            #[cfg(not(target_os = "macos"))]
            platform_fd: Cell::new(Fd::INVALID),
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
            running: AtomicBool::new(true),
            #[cfg(target_os = "freebsd")]
            next_gen: Cell::new(1),
        }
    }
}

impl PathWatcherManager {
    fn get() -> sys::Result<&'static PathWatcherManager> {
        // No unlocked fast path: `default_manager` is a plain global and an unsynchronized
        // read here would be textbook broken DCLP (a concurrent Worker's first `fs.watch()`
        // on ARM64 could observe the non-null pointer before `m.* = .{}` is visible and
        // lock a garbage `m.mutex`). `get()` runs once per `fs.watch()` call; the mutex is
        // uncontended after initialization.
        let _g = DEFAULT_MANAGER_MUTEX.lock_guard();
        if let Some(&m) = DEFAULT_MANAGER.get() {
            return Ok(m);
        }

        let m = Platform::init()?;
        // Holding DEFAULT_MANAGER_MUTEX with `.get()` having returned `None`
        // above, so this is the first publish; `set` cannot fail.
        let _ = DEFAULT_MANAGER.set(m);
        Ok(m)
    }

    /// The manager of a backend that has a thread of its own wait on `fd`, which this takes.
    #[cfg(not(target_os = "macos"))]
    fn with_reader_thread(
        fd: Fd,
        thread_main: fn(&'static PathWatcherManager),
    ) -> sys::Result<&'static PathWatcherManager> {
        // Owning raw pointer first, shared view second: the spawn error arm reclaims
        // through `manager_ptr`, which must not be derived from a shared reference.
        let manager_ptr = bun_core::heap::into_raw(Box::new(PathWatcherManager::default()));
        // SAFETY: just allocated and exclusively owned; published only on Ok.
        let manager: &'static PathWatcherManager = unsafe { &*manager_ptr };
        manager.platform_fd.set(fd);
        // The manager is process-global and never torn down, so the reader thread is
        // a daemon — detach it instead of stashing a handle we'd never join.
        match std::thread::Builder::new().spawn(move || thread_main(manager)) {
            Ok(handle) => drop(handle), // detach
            Err(_) => {
                fd.close();
                // SAFETY: the thread never started and the manager was never published.
                drop(unsafe { bun_core::heap::take(manager_ptr) });
                return Err(sys::Error::from_code(E::ENOMEM, Tag::watch));
            }
        }
        Ok(manager)
    }

    /// Build the dedup key into `buf`. Not null-terminated; only used as a hashmap key.
    fn make_key<'a>(buf: &'a mut [u8], resolved_path: &[u8], recursive: bool) -> &'a [u8] {
        buf[..resolved_path.len()].copy_from_slice(resolved_path);
        buf[resolved_path.len()] = if recursive { b'R' } else { b'N' };
        &buf[..resolved_path.len() + 1]
    }
}

impl Locked {
    /// Remove `watcher` from the dedup map.
    fn unlink_watcher(&mut self, watcher: *mut PathWatcher) {
        if let Some(i) = self.watchers.values().iter().position(|&w| w == watcher) {
            // Key is an owned Box<[u8]>; swap_remove_at drops it.
            self.watchers.swap_remove_at(i);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// PathWatcher
// ────────────────────────────────────────────────────────────────────────────────

pub(crate) struct PathWatcher {
    manager: Option<&'static PathWatcherManager>,

    /// Canonical absolute path (realpath of the user-supplied path). Owned.
    path: ZBox,
    recursive: bool,
    #[cfg(not(target_os = "macos"))]
    is_file: bool,

    /// JS `FSWatcher` contexts sharing this OS watch. Each gets its own ChangeEvent
    /// for per-handler duplicate suppression. Guarded by
    /// `manager.mutex` on all platforms — every emit path (the reader
    /// threads and the Darwin FSEvents callback) holds it while iterating, so
    /// attach/detach can never race with dispatch.
    handlers: ArrayHashMap<*mut c_void, ChangeEvent>,

    /// Per-watch state: inotify wds, kqueue fds, the FSEventsWatcher, or the directory handle.
    platform: PlatformWatch,
}

/// Per-handler duplicate suppression.
///
/// Suppresses only exact duplicates: same path hash *and* same event type
/// within a 1ms window. Distinct files changed in the same millisecond must
/// each emit — node delivers both (see test/js/node/test/parallel
/// fs-watch tests that write two files back-to-back).
///
/// Fields are `Cell` so `should_emit` takes `&self` — the emit paths then only
/// ever need shared access to a `PathWatcher`.
#[derive(Default)]
pub(crate) struct ChangeEvent {
    hash: Cell<u64>,
    event_type: Cell<WatchEventKind>,
    timestamp: Cell<i64>,
    /// The last component as the handler gave it (any case, or the 8.3 name): what a watched file is reported by.
    #[cfg(windows)]
    given_name: Box<[u8]>,
}

impl ChangeEvent {
    fn new(given_path: &[u8]) -> ChangeEvent {
        #[cfg(not(windows))]
        let _ = given_path;
        ChangeEvent {
            #[cfg(windows)]
            given_name: path::basename(given_path).into(),
            ..Default::default()
        }
    }

    /// In milliseconds, and not the time of day: set back, that would make every event a duplicate.
    fn now() -> i64 {
        Timespec::now(TimespecMockMode::ForceRealTime).ms()
    }

    fn should_emit(&self, hash: u64, timestamp: i64, event_type: WatchEventKind) -> bool {
        let time_diff = timestamp - self.timestamp.get();
        if self.timestamp.get() == 0
            || time_diff > 1
            || self.event_type.get() != event_type
            || self.hash.get() != hash
        {
            self.timestamp.set(timestamp);
            self.event_type.set(event_type);
            self.hash.set(hash);
            return true;
        }
        false
    }
}

impl PathWatcher {
    /// Heap-allocate with `ctx` as the first handler and return a raw pointer.
    fn new(init: PathWatcher, ctx: *mut c_void, event: ChangeEvent) -> *mut PathWatcher {
        let mut this = Box::new(init);
        handle_oom(this.handlers.put(ctx, event));
        bun_core::heap::into_raw(this)
    }

    /// Called from the platform reader thread with `manager.mutex` held.
    /// `rel_path` is borrowed — each handler gets a copy.
    /// `&self`: per-handler state is `Cell`-based, so the emit paths never
    /// need an exclusive `PathWatcher` borrow.
    fn emit(&self, event_type: WatchEventKind, rel_path: &[u8], is_file: bool) {
        let timestamp = ChangeEvent::now();
        let h = hash(rel_path);
        for (&ctx, ev) in self.handlers.iter() {
            if ev.should_emit(h, timestamp, event_type) {
                FSWatcher::on_path_update(Some(ctx), event_type.to_event(rel_path.into()), is_file);
            }
        }
    }

    /// Like [`emit`](Self::emit), for a change to the file that is watched.
    #[cfg(windows)]
    fn emit_watched_file(&self, event_type: WatchEventKind) {
        let timestamp = ChangeEvent::now();
        for (&ctx, ev) in self.handlers.iter() {
            if ev.should_emit(0, timestamp, event_type) {
                let event = event_type.to_event(ev.given_name.clone());
                FSWatcher::on_path_update(Some(ctx), event, true);
            }
        }
    }

    /// Like [`emit`](Self::emit), but without per-handler duplicate suppression.
    /// The `IN_IGNORED` retiring a deleted inode's wd lands in the same
    /// millisecond as its `IN_DELETE_SELF`, with the same path and type, so
    /// `should_emit` would fold the two into one; node (libuv) delivers both.
    /// Caller holds `manager.mutex`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn emit_unsuppressed(&self, event_type: WatchEventKind, rel_path: &[u8], is_file: bool) {
        for &ctx in self.handlers.keys() {
            FSWatcher::on_path_update(Some(ctx), event_type.to_event(rel_path.into()), is_file);
        }
    }

    /// Events were lost (queue or buffer overflow): `('change', null)` to every handler, unfiltered. Caller holds `manager.mutex`.
    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    fn emit_overflow(&self) {
        for &ctx in self.handlers.keys() {
            FSWatcher::on_path_update(Some(ctx), Event::Overflow, false);
        }
    }

    fn emit_error(&self, err: &sys::Error, close: bool) {
        for &ctx in self.handlers.keys() {
            FSWatcher::on_path_update(
                Some(ctx),
                Event::Error {
                    err: err.clone(),
                    close,
                },
                false,
            );
        }
    }

    /// Signals end-of-batch so `FSWatcher` can flush its queued events to the JS thread.
    /// Caller holds `manager.mutex`.
    fn flush(&self) {
        for &ctx in self.handlers.keys() {
            FSWatcher::on_update_end(Some(ctx));
        }
    }

    /// JS-thread entry point from `FSWatcher.detach()`. Removes one handler; if it was
    /// the last, tears down the OS watch and frees.
    ///
    /// All bookkeeping (handlers, dedup map, platform dispatch maps) happens under
    /// `manager.mutex` in one critical section so a concurrent `watch()` from another
    /// Worker cannot observe a zero-handler PathWatcher still present in the dedup map.
    ///
    /// On macOS the FSEvents unregister happens *after* releasing `manager.mutex`:
    /// `FSEventsWatcher.deinit()` takes the FSEvents loop mutex, and the CF thread's
    /// `events_cb` holds that mutex while calling into `onFSEvent` (which takes
    /// `manager.mutex`). Holding both here would be AB/BA with the CF thread. Once
    /// `fse.deinit()` returns, `events_cb` has released the loop mutex and nulled our
    /// slot, so no further callbacks will fire and `destroy()` is safe.
    ///
    /// # Safety
    /// `this` must be a live `PathWatcher` produced by [`PathWatcher::new`] whose
    /// `handlers` still contains `ctx`. Called from the JS thread only.
    // The param must stay `*mut PathWatcher`: on macOS the CF thread may
    // concurrently raw-read the disjoint `manager` field while we're between
    // the unlock and `remove_watch()` (see the SAFETY notes below), so no
    // whole-struct reference may span that window — every access below is
    // scoped to a single statement.
    pub(crate) fn detach(this: *mut PathWatcher, ctx: *mut c_void) {
        // SAFETY: `this` is a live PathWatcher created via `PathWatcher::new`. Read
        // `manager` via the raw pointer so no reference is asserted before
        // we hold `manager.mutex` — on macOS the CF thread may concurrently raw-read
        // the same field inside `on_fs_event` (see that fn's SAFETY note).
        let Some(manager) = (unsafe { (*this).manager }) else {
            // No manager → never registered (or already unlinked); we are sole owner.
            // SAFETY: sole owner; no other thread can reach `this`.
            unsafe {
                (*this).handlers.swap_remove(&ctx);
                if (*this).handlers.len() == 0 {
                    Self::destroy(this);
                }
            }
            return;
        };

        let mut locked = manager.mutex.lock();
        {
            // SAFETY: holding manager.mutex; the reader/CF threads only touch this
            // watcher under the same lock, so these scoped accesses are exclusive.
            let remaining = unsafe {
                (*this).handlers.swap_remove(&ctx);
                (*this).handlers.len()
            };
            if remaining > 0 {
                drop(locked);
                return;
            }

            // Last handler gone — make this watcher unreachable before dropping the lock.
            locked.unlink_watcher(this);
            // SAFETY: raw place write under manager.mutex; see above.
            unsafe { (*this).manager = None };
            #[cfg(not(target_os = "macos"))]
            {
                // SAFETY: exclusive under manager.mutex; the borrow ends at the call.
                Platform::remove_watch(manager, &mut locked.platform, unsafe { &mut *this });
            }
        }
        drop(locked);

        #[cfg(target_os = "macos")]
        {
            // Takes fsevents_loop.mutex; must not hold manager.mutex (see doc comment).
            // Pass the raw pointer: the CF thread (holding the FSEvents loop mutex
            // that `deinit` is about to block on) may concurrently take
            // `manager.mutex`, raw-read `(*this).manager`, observe `None`, and bail
            // — so no `&mut PathWatcher` may be live across that call.
            Platform::remove_watch(manager, this);
        }
        // SAFETY: `this` was created via PathWatcher::new (heap::alloc); no other thread
        // can reach it after unlink + remove_watch above.
        unsafe { Self::destroy(this) };
    }

    /// # Safety
    /// `this` must have been produced by `PathWatcher::new` and have no remaining
    /// references (handlers empty, removed from manager maps).
    unsafe fn destroy(this: *mut PathWatcher) {
        // SAFETY: caller contract — `this` came from `heap::into_raw` in
        // `PathWatcher::new` and has no remaining references.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// watch()
// ────────────────────────────────────────────────────────────────────────────────

pub(crate) fn watch(
    path: &ZStr,
    recursive: bool,
    ctx: *mut c_void,
) -> sys::Result<*mut PathWatcher> {
    let manager = PathWatcherManager::get()?;

    // Resolve to a canonical path so `fs.watch("./x")` and `fs.watch("/abs/x")` dedup;
    // FSEvents reports events by realpath so macOS needs this for prefix matching too.
    //
    // Open with O_PATH|O_DIRECTORY first and retry without O_DIRECTORY on ENOTDIR —
    // that tells us file-vs-dir without a separate stat, follows symlinks, and the
    // resulting fd feeds `getFdPath` for the realpath. One or two syscalls instead
    // of lstat + open + (stat) in the old code. `O.PATH` is 0 on macOS (degrades to
    // O_RDONLY, which is what F_GETPATH needs anyway). `sys::open` has no use for
    // these flags on Windows.
    let mut resolve_buf = path::path_buffer_pool::get();
    let mut is_file = false;
    let probe_fd: Fd = match sys::openat(
        Fd::cwd(),
        path,
        sys::O::PATH | sys::O::DIRECTORY | sys::O::CLOEXEC,
        0,
    ) {
        Ok(f) => f,
        Err(e) => {
            if e.get_errno() == E::ENOTDIR {
                is_file = true;
                match sys::openat(Fd::cwd(), path, sys::O::PATH | sys::O::CLOEXEC, 0) {
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
            // SAFETY: resolve_buf[len] == 0 written above; buf lives for the rest of this fn.
            ZStr::from_buf(&resolve_buf[..], len)
        }
    };

    let mut key_buf = path::path_buffer_pool::get();
    let key = PathWatcherManager::make_key(key_buf.as_mut_slice(), resolved.as_bytes(), recursive);

    let mut locked = manager.mutex.lock();

    let existing = if cfg!(windows) {
        // A handle stays with its directory when that is renamed, which nothing reports: the path can name another one by now.
        None
    } else {
        locked.watchers.get(key).copied()
    };
    if let Some(existing) = existing {
        // SAFETY: existing is a live PathWatcher under manager.mutex.
        unsafe {
            handle_oom(
                (*existing)
                    .handlers
                    .put(ctx, ChangeEvent::new(path.as_bytes())),
            )
        };
        drop(locked);
        return Ok(existing);
    }

    #[cfg(target_os = "macos")]
    let _ = is_file;
    // New watcher: own the key and path.
    let init = PathWatcher {
        manager: Some(manager),
        path: ZBox::from_bytes(resolved.as_bytes()),
        recursive,
        #[cfg(not(target_os = "macos"))]
        is_file,
        handlers: ArrayHashMap::default(),
        platform: PlatformWatch::default(),
    };
    let watcher = PathWatcher::new(init, ctx, ChangeEvent::new(path.as_bytes()));
    let address = (watcher as usize).to_ne_bytes();
    let key = if cfg!(windows) { &address[..] } else { key };
    handle_oom(locked.watchers.put(key, watcher));

    // Linux/FreeBSD/Windows: `addWatch` mutates what the reader thread dispatches on, under `manager.mutex`: call it locked.
    //
    // macOS: `addWatch` calls `FSEvents.watch()` which takes the FSEvents loop mutex.
    // The CF thread holds that mutex while calling `onFSEvent`, which in turn takes
    // `manager.mutex`. To keep lock order one-way (fsevents → manager), release ours
    // first. Another Worker's `watch()` finding this PathWatcher in the interim is
    // fine — it just appends a handler; events won't deliver until the FSEventStream
    // is scheduled anyway.
    #[cfg(not(target_os = "macos"))]
    {
        // SAFETY: watcher live under manager.mutex.
        let added = Platform::add_watch(manager, &mut locked.platform, unsafe { &mut *watcher });
        if let Err(err) = added {
            // Still under the same lock as the map insertion, so no other thread
            // can have observed `watcher` yet — unconditional destroy is safe.
            locked.unlink_watcher(watcher);
            drop(locked);
            // SAFETY: no other thread observed watcher.
            unsafe {
                (*watcher).manager = None;
                PathWatcher::destroy(watcher);
            }
            // `Linux.addOne` builds the error with `.path = watcher.path`, which we
            // just freed; strip it like every other return in this function.
            return Err(err.without_path());
        }
        drop(locked);
        return Ok(watcher);
    }

    #[cfg(target_os = "macos")]
    {
        drop(locked);

        // SAFETY: watcher heap-allocated; reachable via dedup map but FSEvents not yet
        // scheduled so no concurrent emit.
        if let Err(err) = Platform::add_watch(manager, unsafe { &mut *watcher }) {
            // `watcher` was visible in the dedup map while we were unlocked above; a
            // concurrent Worker's `fs.watch()` on the same path may have attached a
            // handler and already returned `watcher` to its caller. Only destroy if
            // ours was the last handler; otherwise surface the error to the survivors
            // and leave `watcher.manager` set so their `detach()` takes the locked path
            // (→ `unlink_watcher` no-ops, `removeWatch` no-ops on null `fsevents`,
            // then frees). Never free memory another thread holds.
            let mut locked = manager.mutex.lock();
            locked.unlink_watcher(watcher);
            // SAFETY: holding manager.mutex; scoped accesses only.
            let remaining = unsafe {
                (*watcher).handlers.swap_remove(&ctx);
                (*watcher).handlers.len()
            };
            if remaining > 0 {
                // SAFETY: watcher live under manager.mutex; `emit_error`/`flush`
                // take `&self`.
                unsafe {
                    (*watcher).emit_error(&err, true);
                    (*watcher).flush();
                }
                drop(locked);
                return Err(err.without_path());
            }
            // SAFETY: holding manager.mutex.
            unsafe { (*watcher).manager = None };
            drop(locked);
            // SAFETY: last handler removed; no other thread holds watcher.
            unsafe { PathWatcher::destroy(watcher) };
            return Err(err.without_path());
        }
        return Ok(watcher);
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Platform backends
// ────────────────────────────────────────────────────────────────────────────────

/// Scratch buffers that `walk_subtree` reuses across directories.
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
#[derive(Default)]
struct WalkScratch {
    /// NUL-terminated absolute path of the directory being read, or of the entry passed to `cb`.
    abs: Vec<u8>,
    /// Same path, relative to the watch root.
    rel: Vec<u8>,
    /// Unvisited entries as `[is_file][name][0]` records, innermost directory last.
    pending: Vec<u8>,
    /// Directories with records in `pending`, outermost first.
    levels: Vec<WalkLevel>,
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
struct WalkLevel {
    /// Length of the directory's path in `abs` (without the NUL) and in `rel`.
    abs_len: usize,
    rel_len: usize,
    /// Offset of the directory's first record in `pending`.
    start: usize,
    /// Offset of the first unvisited record.
    next: usize,
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
impl WalkScratch {
    /// Truncates `abs` and `rel` to the directory's path, then appends `name`.
    fn set_entry(
        abs: &mut Vec<u8>,
        rel: &mut Vec<u8>,
        abs_len: usize,
        rel_len: usize,
        name: &[u8],
    ) {
        abs.truncate(abs_len);
        // Only the root directory ends with a separator.
        if abs.last() != Some(&path::SEP) {
            abs.push(path::SEP);
        }
        abs.extend_from_slice(name);
        abs.push(0);
        rel.truncate(rel_len);
        if rel_len != 0 {
            rel.push(path::SEP);
        }
        rel.extend_from_slice(name);
    }

    /// Reads every entry of the directory at `self.abs` and closes it before the walk descends.
    #[inline(never)]
    fn read_dir<const DIRS_ONLY: bool>(&mut self, cb: &mut impl FnMut(&ZStr, &[u8], bool)) {
        let abs_len = self.abs.len() - 1;
        let rel_len = self.rel.len();
        let start = self.pending.len();
        let Ok(dir) = sys::open(
            ZStr::from_slice_with_nul(&self.abs),
            sys::O::RDONLY | sys::O::DIRECTORY | sys::O::CLOEXEC,
            0,
        ) else {
            return;
        };
        let _close = sys::CloseOnDrop::new(dir);
        let mut it = sys::dir_iterator::iterate(dir);
        let mut found_dir = false;
        while let Ok(Some(entry)) = it.next() {
            let is_file = entry.kind != sys::EntryKind::Directory;
            if DIRS_ONLY && is_file {
                continue;
            }
            // The iterator caches the UTF-8 transcode and exposes it as `slice_u8()`.
            let name = entry.name.slice_u8();
            if is_file && !found_dir {
                // No subdirectory precedes this file, so it's next in walk order.
                Self::set_entry(&mut self.abs, &mut self.rel, abs_len, rel_len, name);
                cb(ZStr::from_slice_with_nul(&self.abs), &self.rel, true);
                continue;
            }
            // Copy the name because this entry is visited after the directory is closed.
            found_dir = true;
            self.pending.push(u8::from(is_file));
            self.pending.extend_from_slice(name);
            self.pending.push(0);
        }
        if self.pending.len() > start {
            self.levels.push(WalkLevel {
                abs_len,
                rel_len,
                start,
                next: start,
            });
        }
    }
}

/// Shared directory walk for Linux and Kqueue. Calls `cb` with (abs, rel, is_file) for
/// every entry below `abs_dir`, visiting a directory before its contents. When `DIRS_ONLY`,
/// non-directory entries are skipped entirely (inotify delivers file events on the
/// parent dir's wd so we only need a watch per directory; kqueue needs an fd per file
/// too). The walk is iterative and keeps one directory open at a time, so neither the
/// stack nor the open-file limit caps the tree's depth. Best-effort — an unreadable
/// subdirectory just stops that branch (matches Node).
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
fn walk_subtree<const DIRS_ONLY: bool>(
    abs_dir: &ZStr,
    rel_dir: &[u8],
    cb: &mut impl FnMut(&ZStr, &[u8], bool),
) {
    let mut scratch = WalkScratch {
        abs: abs_dir.as_bytes_with_nul().to_vec(),
        rel: rel_dir.to_vec(),
        ..Default::default()
    };
    scratch.read_dir::<DIRS_ONLY>(cb);
    while let Some(level) = scratch.levels.last_mut() {
        if level.next == scratch.pending.len() {
            scratch.pending.truncate(level.start);
            scratch.levels.pop();
            continue;
        }
        let record = &scratch.pending[level.next..];
        let is_file = record[0] != 0;
        let name = &record[1..];
        let name = &name[..strings::index_of_char_usize(name, 0).unwrap_or(name.len())];
        level.next += 1 + name.len() + 1;
        WalkScratch::set_entry(
            &mut scratch.abs,
            &mut scratch.rel,
            level.abs_len,
            level.rel_len,
            name,
        );
        cb(
            ZStr::from_slice_with_nul(&scratch.abs),
            &scratch.rel,
            is_file,
        );
        if !is_file {
            // `cb` already watches this directory, so entries created during the read still get events.
            scratch.read_dir::<DIRS_ONLY>(cb);
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

#[cfg(windows)]
type Platform = Windows;
#[cfg(windows)]
type PlatformWatch = WindowsWatch;

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
    /// Raw `*mut`. Stored in a long-lived map; `platform.wds` is written through
    /// it under `manager.mutex`, so a `&PathWatcher` here would make every
    /// write-through a const→mut cast (UB). Lifetime: outlives the entry
    /// because `remove_watch` drops all of a watcher's wd entries before `destroy()`.
    watcher: *mut PathWatcher,
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
// Drop: Vec frees automatically.

#[cfg(any(target_os = "linux", target_os = "android"))]
impl PathWatcherManager {
    /// Set-once inotify fd. Assigned exactly once in [`Linux::init`] *before*
    /// the reader thread is spawned and never reassigned afterwards (the
    /// manager is a process-lifetime singleton with no teardown), so reading it
    /// from either thread races with nothing.
    #[inline]
    fn inotify_fd(&self) -> Fd {
        self.platform_fd.get()
    }
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

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Linux {
    fn init() -> sys::Result<&'static PathWatcherManager> {
        use bun_sys::linux::IN;
        let rc = sys::linux::inotify_init1(IN::CLOEXEC);
        if rc < 0 {
            return Err(sys::Error::from_code_int(sys::last_errno(), Tag::watch));
        }
        PathWatcherManager::with_reader_thread(Fd::from_native(rc), Linux::thread_main)
    }

    /// Caller holds `manager.mutex`.
    fn add_watch(
        manager: &'static PathWatcherManager,
        plat: &mut Linux,
        watcher: &mut PathWatcher,
    ) -> sys::Result<()> {
        // Borrowck: clone path to avoid &/&mut overlap on watcher.
        let root = watcher.path.clone();
        let fd = manager.inotify_fd();
        Linux::add_one(fd, plat, watcher, &root, b"")?;
        if watcher.recursive && !watcher.is_file {
            if let Some(err) = Linux::walk_and_add(fd, plat, watcher, &root, b"") {
                // Partial coverage: emit 'error' but keep the watcher, like node.
                watcher.emit_error(&err, false);
                watcher.flush();
            }
        }
        Ok(())
    }

    /// Add a single inotify watch and record ownership. Caller holds `manager.mutex`.
    fn add_one(
        fd: Fd,
        plat: &mut Linux,
        watcher: &mut PathWatcher,
        abs_path: &ZStr,
        subpath: &[u8],
    ) -> sys::Result<()> {
        let mask: u32 = if watcher.is_file && subpath.is_empty() {
            inotify_masks::WATCH_FILE_MASK
        } else {
            inotify_masks::WATCH_DIR_MASK
        };
        let rc = sys::linux::inotify_add_watch(fd.native(), abs_path, mask);
        if rc < 0 {
            let err = sys::Error::from_code_int(sys::last_errno(), Tag::watch);
            // ENOENT/ENOTDIR during a recursive walk just means we raced; skip.
            if !subpath.is_empty() && matches!(err.get_errno(), E::ENOENT | E::ENOTDIR) {
                return Ok(());
            }
            return Err(err.with_path(abs_path.as_bytes()));
        }
        let wd: i32 = rc;
        let owners = plat.wd_map.entry(wd).or_default();
        // This wd may already have this watcher as an owner:
        //   - IN_CREATE raced the initial walk (same subpath → the reassign is a no-op)
        //   - a subdirectory was *renamed* within the tree: IN_MOVED_TO re-adds it,
        //     inotify returns the same wd (it watches by inode), and the cached subpath
        //     is now stale. Overwrite so later events under the moved dir report the
        //     new name. `walkAndAdd` never follows symlinks (`entry.kind == .directory`,
        //     not `.sym_link`), so this can't pick a longer alias via a cycle.
        for o in owners.iter_mut() {
            if core::ptr::eq(o.watcher, watcher) {
                if !strings::eql(o.subpath.as_bytes(), subpath) {
                    o.subpath = ZBox::from_bytes(subpath);
                }
                return Ok(());
            }
        }
        owners.push(WdOwner {
            watcher: std::ptr::from_mut::<PathWatcher>(watcher),
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
        plat: &mut Linux,
        watcher: &mut PathWatcher,
        abs_dir: &ZStr,
        rel_dir: &[u8],
    ) -> Option<sys::Error> {
        let mut first_err: Option<sys::Error> = None;
        walk_subtree::<true>(abs_dir, rel_dir, &mut |abs, rel, _is_file| {
            if let Err(e) = Linux::add_one(fd, plat, watcher, abs, rel) {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
        });
        first_err
    }

    /// Caller holds `manager.mutex`. Drops this watcher's ownership of each of its
    /// wds; only issues `inotify_rm_watch` once a wd has no remaining owners.
    fn remove_watch(
        manager: &'static PathWatcherManager,
        plat: &mut Linux,
        watcher: &mut PathWatcher,
    ) {
        let fd = manager.inotify_fd();
        let wd_map = &mut plat.wd_map;
        for &wd in watcher.platform.wds.iter() {
            let Some(owners) = wd_map.get_mut(&wd) else {
                continue;
            };
            let mut j: usize = 0;
            while j < owners.len() {
                if core::ptr::eq(owners[j].watcher, watcher) {
                    owners.swap_remove(j);
                } else {
                    j += 1;
                }
            }
            if owners.is_empty() {
                wd_map.remove(&wd);
                sys::linux::inotify_rm_watch(fd.native(), wd);
            }
        }
        watcher.platform.wds.clear();
    }

    fn thread_main(manager: &'static PathWatcherManager) {
        use bun_sys::linux::IN;
        Output::Source::configure_named_thread(zstr!("fs.watch"));
        let fd = manager.inotify_fd();
        let running: &AtomicBool = &manager.running;
        // Large enough for a burst of events; inotify guarantees whole events per read.
        // `u32` elements give the 4-byte alignment that the `&InotifyEvent` cast needs.
        let mut buf: Box<[u32; 16 * 1024]> = bun_core::boxed_zeroed();
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut rel_spill: Vec<u8> = Vec::new();

        while running.load(Ordering::Acquire) {
            let rc = sys::linux::read(fd.native(), bun_core::bytes_of_mut(&mut *buf));
            match sys::get_errno(rc) {
                E::SUCCESS => {}
                E::EAGAIN | E::EINTR => continue,
                errno => {
                    // Fatal: surface to every watcher, then exit the thread.
                    let err = sys::Error {
                        errno: errno as u16,
                        syscall: Tag::read,
                        ..Default::default()
                    };
                    let locked = manager.mutex.lock();
                    for &w in locked.watchers.values() {
                        // SAFETY: holding manager.mutex; w is live.
                        unsafe {
                            (*w).emit_error(&err, true);
                            (*w).flush();
                        }
                    }
                    drop(locked);
                    return;
                }
            }
            let n = rc as usize;
            if n == 0 {
                continue;
            }

            let mut locked = manager.mutex.lock();
            // Track which PathWatchers got at least one event so we flush() each once.
            let mut touched: ArrayHashMap<*mut PathWatcher, ()> = ArrayHashMap::default();

            let mut i: usize = 0;
            while i < n {
                // SAFETY: inotify guarantees whole events and pads `name` so each
                // header stays 4-byte aligned; `buf` is 4-byte aligned via
                // its `u32`s, so byte offset `i` always lands on an aligned
                // event header within the `n` bytes the kernel just wrote.
                let ev: &InotifyEvent = unsafe {
                    &*core::ptr::from_ref(&*buf)
                        .cast::<InotifyEvent>()
                        .byte_add(i)
                };
                i += core::mem::size_of::<InotifyEvent>() + ev.name_len as usize;
                let wd = ev.watch_descriptor;

                // Queue hit fs.inotify.max_queued_events and the kernel dropped
                // events (wd == -1 matches no watch). Every watcher on this fd
                // is affected — notify all, like node on Windows does.
                if ev.mask & IN::Q_OVERFLOW != 0 {
                    for &w in locked.watchers.values() {
                        // SAFETY: w live under manager.mutex.
                        unsafe { (*w).emit_overflow() };
                        let _ = handle_oom(touched.get_or_put(w));
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
                    let wd_map = &mut locked.platform.wd_map;
                    if let Some(owners) = wd_map.get_mut(&wd) {
                        for o in owners.drain(..) {
                            // SAFETY: o.watcher live under manager.mutex; shared
                            // access only — `emit_unsuppressed` takes `&self`.
                            let w = unsafe { &*o.watcher };
                            if o.subpath.as_bytes().is_empty() && (w.is_file || !w.recursive) {
                                w.emit_unsuppressed(
                                    WatchEventKind::Rename,
                                    path::basename(w.path.as_bytes()),
                                    w.is_file,
                                );
                                let _ = handle_oom(touched.get_or_put(o.watcher));
                            }
                            // SAFETY: exclusive scoped access to this watcher's wd
                            // list under manager.mutex; the shared borrow above is
                            // no longer used.
                            unsafe {
                                let wds = &mut (*o.watcher).platform.wds;
                                if let Some(idx) = wds.iter().position(|&x| x == wd) {
                                    wds.swap_remove(idx);
                                }
                            }
                        }
                        wd_map.remove(&wd);
                    }
                    continue;
                }

                if locked.platform.wd_map.get(&wd).is_none() {
                    continue;
                }

                let name: &[u8] = if ev.name_len > 0 {
                    // SAFETY: i was just advanced past this event's name_len bytes; offset is within buf[0..n].
                    let name_ptr = unsafe { buf.as_ptr().byte_add(i - ev.name_len as usize) };
                    // SAFETY: kernel NUL-pads name within name_len bytes.
                    unsafe { bun_core::ffi::cstr(name_ptr.cast()).to_bytes() }
                } else {
                    b""
                };

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
                // `addOne`/`walkAndAdd`, which insert into `wd_map` via `getOrPut` and
                // may rehash — that would invalidate any pointer into the map's value
                // storage. Re-fetch the owners list by key each iteration rather than
                // caching `getPtr(wd)` across the loop.
                let mut oi: usize = 0;
                loop {
                    let (owner_watcher, owner_subpath): (*mut PathWatcher, &[u8]) = {
                        let Some(owners) = locked.platform.wd_map.get(&wd) else {
                            break;
                        };
                        if oi >= owners.len() {
                            break;
                        }
                        let o = &owners[oi];
                        (o.watcher, o.subpath.as_bytes())
                    };
                    // SAFETY: owner_watcher live under manager.mutex. Copy the
                    // scalars and launder the path bytes via a raw ptr so `rel`
                    // (which may borrow them) is decoupled from the scoped `&mut`
                    // temporaries `add_one` takes below. `path` is a `ZBox`; its
                    // heap bytes are a separate allocation.
                    let (watcher_is_file, watcher_recursive, watcher_path): (bool, bool, &[u8]) = unsafe {
                        (
                            (*owner_watcher).is_file,
                            (*owner_watcher).recursive,
                            &*std::ptr::from_ref::<[u8]>((*owner_watcher).path.as_bytes()),
                        )
                    };

                    // Build the path relative to this owner's root.
                    let rel: &[u8] = if watcher_is_file {
                        path::basename(watcher_path)
                    } else if owner_subpath.is_empty() {
                        if name.is_empty() && !watcher_recursive {
                            // A nameless event on the root wd is about the watched
                            // directory itself (IN_DELETE_SELF, IN_MOVE_SELF,
                            // IN_ATTRIB); libuv reports basename(watched path),
                            // same as for a file. node's recursive watcher uses
                            // root-relative paths instead, so those keep "".
                            path::basename(watcher_path)
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

                    // SAFETY: owner_watcher live under manager.mutex; `emit` takes `&self`.
                    unsafe {
                        (*owner_watcher).emit(
                            event_type,
                            rel,
                            !is_dir_child
                                && !((ev.mask & (IN::DELETE_SELF | IN::MOVE_SELF) != 0)
                                    && !watcher_is_file),
                        );
                    }
                    let _ = handle_oom(touched.get_or_put(owner_watcher));

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
                            &[watcher_path, owner_subpath, name],
                        );
                        // Borrowck: `rel` may borrow `wd_map`, which `add_one` mutates.
                        let rel_owned: Box<[u8]> = Box::from(rel);
                        // These may rehash `wd_map`; `owners` is re-fetched next iteration.
                        let plat = &mut locked.platform;
                        // SAFETY: owner_watcher live under manager.mutex; the `&mut`
                        // is scoped to the call.
                        let mut add_err = Linux::add_one(
                            fd,
                            plat,
                            unsafe { &mut *owner_watcher },
                            child_abs,
                            &rel_owned,
                        )
                        .err();
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
                                    // SAFETY: owner_watcher live under manager.mutex;
                                    // the `&mut` is scoped to the call.
                                    let watcher = unsafe { &mut *owner_watcher };
                                    if let Err(e) =
                                        Linux::add_one(fd, plat, watcher, abs, entry_rel)
                                    {
                                        if add_err.is_none() {
                                            add_err = Some(e);
                                        }
                                    }
                                }
                                // SAFETY: owner_watcher live under manager.mutex;
                                // `emit` takes `&self`.
                                unsafe {
                                    (*owner_watcher).emit(
                                        WatchEventKind::Rename,
                                        entry_rel,
                                        entry_is_file,
                                    );
                                }
                            },
                        );
                        if let Some(err) = add_err {
                            // SAFETY: owner_watcher live under manager.mutex;
                            // `emit_error` takes `&self`.
                            unsafe { (*owner_watcher).emit_error(&err, false) };
                        }
                    }

                    oi += 1;
                }
            }

            for &w in touched.keys() {
                // SAFETY: w live under manager.mutex.
                unsafe { (*w).flush() };
            }
            drop(locked);
        }
    }
}

/// The kernel `struct inotify_event` header. Shared with the bundler watcher;
/// field naming there is `watch_descriptor` / `name_len`.
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_watcher::inotify_watcher::Event as InotifyEvent;

// ────────────────────────────────────────────────────────────────────────────────
// Darwin
// ────────────────────────────────────────────────────────────────────────────────

/// macOS: delegate to `fs_events.rs`, which already runs one CFRunLoop thread with
/// one FSEventStream covering every watched path. The PathWatcher itself is the
/// FSEventsWatcher's opaque ctx — `fs_events.rs` calls back via `onFSEvent` below,
/// and we fan out to the JS handlers.
///
/// Unlike the old design, FSEvents is used for both files and directories (same as
/// libuv), so `fs.watch()` no longer spins up a second kqueue thread.
#[cfg(target_os = "macos")]
#[derive(Default)]
pub(crate) struct Darwin {
    // No manager-level state — FSEvents has its own process-global loop.
}

#[cfg(target_os = "macos")]
#[derive(Default)]
pub(crate) struct DarwinWatch {
    fsevents: Option<*mut fsevents::FSEventsWatcher>,
}

#[cfg(target_os = "macos")]
impl Drop for DarwinWatch {
    fn drop(&mut self) {
        if let Some(fse) = self.fsevents.take() {
            // SAFETY: fse came from `heap::alloc` in `add_watch`; reconstitute
            // to run `FSEventsWatcher::drop` (→ `unregister_watcher`).
            drop(unsafe { bun_core::heap::take(fse) });
        }
    }
}

#[cfg(target_os = "macos")]
impl Darwin {
    fn init() -> sys::Result<&'static PathWatcherManager> {
        Ok(Box::leak(Box::new(PathWatcherManager::default())))
    }

    /// Caller does NOT hold `manager.mutex` — `FSEvents.watch()` takes the FSEvents
    /// loop mutex, and the CF thread holds that while calling `onFSEvent` (which
    /// takes `manager.mutex`). Keeping this call outside `manager.mutex` makes the
    /// lock order one-way: fsevents_loop.mutex → manager.mutex.
    fn add_watch(_: &'static PathWatcherManager, watcher: &mut PathWatcher) -> sys::Result<()> {
        // Borrowck: capture the raw ctx pointer before the
        // shared borrow of `watcher.path` so the two don't overlap at the call site.
        let ctx = core::ptr::from_mut::<PathWatcher>(watcher).cast::<c_void>();
        match fsevents::watch(
            // `FSEventsWatcher` borrows this slice for its whole lifetime; the
            // backing `ZBox` is NUL-terminated for CF's C-string consumer.
            watcher.path.as_bytes(),
            watcher.recursive,
            Darwin::on_fs_event,
            Darwin::on_fs_event_flush,
            ctx,
        ) {
            Ok(fse) => {
                watcher.platform.fsevents = Some(bun_core::heap::into_raw(fse));
                Ok(())
            }
            Err(e) => Err(sys::Error::from_code(
                if matches!(e, crate::Error::FailedToCreateCoreFoudationSourceLoop) {
                    E::EINVAL
                } else {
                    E::ENOMEM
                },
                Tag::watch,
            )),
        }
    }

    /// Caller does NOT hold `manager.mutex` (same lock-order reasoning as `addWatch`).
    /// `FSEventsWatcher.deinit()` → `unregisterWatcher()` blocks on the FSEvents loop
    /// mutex, which `events_cb` holds for the whole dispatch; once this returns no
    /// further `onFSEvent` calls will arrive for `watcher`.
    ///
    /// Takes a raw `*mut PathWatcher`: while we block on the FSEvents loop mutex
    /// inside `deinit`, the CF thread may concurrently take `manager.mutex` and
    /// raw-read `(*watcher).manager` (to bail on `None`). Holding a `&mut PathWatcher`
    /// across that would be aliased-`&mut` UB under Stacked Borrows.
    fn remove_watch(_: &'static PathWatcherManager, watcher: *mut PathWatcher) {
        // SAFETY: caller is the sole logical owner (last handler detached, watcher
        // unlinked from the dedup map, `manager` already nulled). Project only the
        // `platform.fsevents` sub-place via the raw pointer; the CF thread's
        // concurrent raw read targets the disjoint `manager` field.
        if let Some(fse) = unsafe { (*watcher).platform.fsevents.take() } {
            // SAFETY: fse came from `heap::alloc` in `add_watch`; reconstitute to
            // run `FSEventsWatcher::drop` (→ `unregister_watcher`).
            drop(unsafe { bun_core::heap::take(fse) });
        }
    }

    /// Called from the CFRunLoop thread (`fs_events.rs`'s `events_cb`) with the
    /// FSEvents loop mutex held. Take `manager.mutex` so iterating `handlers` can't
    /// race with `watch()`/`detach()` mutating it. The JS thread never holds
    /// `manager.mutex` across a call into FSEvents, so this is deadlock-free.
    ///
    /// `watcher` itself is kept alive by the FSEvents loop mutex: `detach()` →
    /// `removeWatch()` → `fse.deinit()` → `unregisterWatcher()` blocks until
    /// `events_cb` releases it, so `destroy()` cannot run under us. The
    /// `watcher.manager == null` check catches the window where detach has already
    /// unlinked us but hasn't yet called `fse.deinit()`.
    fn on_fs_event(ctx: *mut c_void, event: Event, is_file: bool) {
        // SAFETY: ctx is the *mut PathWatcher passed in add_watch above. Keep it raw
        // until `manager.mutex` is held and the `manager.is_none()` bail-out has run:
        // `detach()` on the JS thread may concurrently be between its unlock and
        // `remove_watch()` (blocked on the FSEvents loop mutex we hold), with the
        // watcher already unlinked. Forming a reference here before that check would
        // alias detach's access; raw-ptr reads have no exclusivity assertion.
        let watcher_ptr = ctx.cast::<PathWatcher>();
        let Some(&manager) = DEFAULT_MANAGER.get() else {
            return;
        };
        let _g = manager.mutex.lock();
        // SAFETY: raw read under manager.mutex; see above.
        if unsafe { (*watcher_ptr).manager.is_none() } {
            return;
        }
        // SAFETY: holding manager.mutex with `manager` still set → detach() has not
        // yet unlinked us. Shared access only — `emit`/`emit_error` take `&self`.
        let watcher = unsafe { &*watcher_ptr };
        match event {
            Event::Rename(path) => watcher.emit(WatchEventKind::Rename, &path, is_file),
            Event::Change(path) => watcher.emit(WatchEventKind::Change, &path, is_file),
            Event::Error { err, close } => watcher.emit_error(&err, close),
            _ => {}
        }
    }

    fn on_fs_event_flush(ctx: *mut c_void) {
        // SAFETY: see on_fs_event — keep raw until locked + manager-is-none checked.
        let watcher_ptr = ctx.cast::<PathWatcher>();
        let Some(&manager) = DEFAULT_MANAGER.get() else {
            return;
        };
        let _g = manager.mutex.lock();
        // SAFETY: raw read under manager.mutex.
        if unsafe { (*watcher_ptr).manager.is_none() } {
            return;
        }
        // SAFETY: holding manager.mutex with `manager` still set; exclusive.
        unsafe { (*watcher_ptr).flush() };
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
    /// Raw `*mut`. See `WdOwner.watcher` — stored long-lived, dereferenced
    /// under `manager.mutex`; outlives the entry because
    /// `remove_watch` clears all of a watcher's entries before `destroy()`.
    watcher: *mut PathWatcher,
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
// Drop: Vec frees automatically.

#[cfg(target_os = "freebsd")]
impl PathWatcherManager {
    /// Set-once kqueue fd. Assigned exactly once in [`Kqueue::init`] *before*
    /// the reader thread is spawned and never reassigned afterwards (the
    /// manager is a process-lifetime singleton with no teardown), so reading it
    /// from either thread races with nothing.
    #[inline]
    fn kq_fd(&self) -> Fd {
        self.platform_fd.get()
    }
}

#[cfg(target_os = "freebsd")]
impl Kqueue {
    fn init() -> sys::Result<&'static PathWatcherManager> {
        PathWatcherManager::with_reader_thread(sys::kqueue()?, Kqueue::thread_main)
    }

    /// Caller holds `manager.mutex`.
    fn add_watch(
        manager: &'static PathWatcherManager,
        plat: &mut Kqueue,
        watcher: &mut PathWatcher,
    ) -> sys::Result<()> {
        // Borrowck: clone path to avoid &/&mut overlap.
        let root = watcher.path.clone();
        let is_file = watcher.is_file;
        Kqueue::add_one(manager, plat, watcher, &root, b"", is_file)?;
        if watcher.recursive && !watcher.is_file {
            // kqueue needs an open fd per *file* as well as per directory.
            let mut first_err: Option<sys::Error> = None;
            walk_subtree::<false>(&root, b"", &mut |abs, rel, is_file| {
                if let Err(e) = Kqueue::add_one(manager, plat, watcher, abs, rel, is_file) {
                    if first_err.is_none() {
                        first_err = Some(e);
                    }
                }
            });
            if let Some(err) = first_err {
                // Partial coverage: emit 'error' but keep the watcher, like node.
                watcher.emit_error(&err, false);
                watcher.flush();
            }
        }
        Ok(())
    }

    fn add_one(
        manager: &'static PathWatcherManager,
        plat: &mut Kqueue,
        watcher: &mut PathWatcher,
        abs_path: &ZStr,
        subpath: &[u8],
        is_file: bool,
    ) -> sys::Result<()> {
        use bun_sys::freebsd::{EV, EVFILT, Kevent, NOTE, kevent};
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

        // Caller holds manager.mutex; exclusive access to `next_gen`.
        let generation = {
            let g = manager.next_gen.get();
            manager.next_gen.set(g.wrapping_add(1));
            g
        };
        let kq = manager.kq_fd();

        // SAFETY: all-zero is a valid Kevent (#[repr(C)] POD).
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
        let mut changes = [kev];
        // SAFETY: thin wrapper over libc::kevent.
        let krc = unsafe {
            kevent(
                kq.native(),
                changes.as_ptr(),
                1,
                changes.as_mut_ptr(),
                0,
                core::ptr::null(),
            )
        };
        if krc < 0 {
            // Registration failed (ENOMEM/EINVAL on a bad fd, etc.). Don't leave a
            // dead entry in the map that will never deliver events.
            let errno = sys::get_errno(krc);
            fd.close();
            return Err(sys::Error {
                errno: errno as u16,
                syscall: Tag::watch,
                ..Default::default()
            }
            .with_path(abs_path.as_bytes()));
        }

        handle_oom(plat.entries.put(
            fd.native() as i32,
            KqEntry {
                watcher: core::ptr::from_mut(watcher),
                fd,
                subpath: ZBox::from_bytes(subpath),
                generation,
                is_file,
            },
        ));
        watcher.platform.fds.push(fd.native() as i32);
        Ok(())
    }

    /// Caller holds `manager.mutex`.
    fn remove_watch(_: &'static PathWatcherManager, plat: &mut Kqueue, watcher: &mut PathWatcher) {
        for &ident in watcher.platform.fds.iter() {
            if let Some((_, entry)) = plat.entries.fetch_swap_remove(&ident) {
                // Closing the fd auto-removes the kevent.
                entry.fd.close();
                // entry.subpath dropped here.
            }
        }
        watcher.platform.fds.clear();
    }

    fn thread_main(manager: &'static PathWatcherManager) {
        use bun_sys::freebsd::{Kevent, NOTE, kevent};
        Output::Source::configure_named_thread(zstr!("fs.watch"));
        let kq = manager.kq_fd();
        let running: &AtomicBool = &manager.running;
        // SAFETY: Kevent is POD; uninitialized array filled by kernel before read.
        let mut events: [Kevent; 128] = bun_core::ffi::zeroed();
        while running.load(Ordering::Acquire) {
            // SAFETY: thin wrapper over libc::kevent.
            let count = unsafe {
                kevent(
                    kq.native(),
                    events.as_ptr(),
                    0,
                    events.as_mut_ptr(),
                    events.len() as _,
                    core::ptr::null(),
                )
            };
            if count <= 0 {
                continue;
            }

            let locked = manager.mutex.lock();
            let entries = &locked.platform.entries;
            let mut touched: ArrayHashMap<*mut PathWatcher, ()> = ArrayHashMap::default();

            for kev in &events[..count as usize] {
                // Validate via the map — the entry may have been freed by a racing
                // removeWatch between kevent() returning and us taking the lock. POSIX
                // recycles the lowest fd on open(), so the ident could also now belong
                // to an *unrelated* watch registered in that same window; `udata` was
                // set to a monotonic generation at registration and survives in the
                // already-delivered event, so compare it to the current entry's gen
                // to reject stale fd-reuse hits.
                let Some(entry) = entries.get(&(kev.ident as i32)) else {
                    continue;
                };
                if entry.generation != kev.udata as usize {
                    continue;
                }
                // SAFETY: entry.watcher live under manager.mutex; PathWatcher is a
                // separate heap allocation, disjoint from the `entries` borrow above.
                // Shared access only — `emit` takes `&self`.
                let watcher = unsafe { &*entry.watcher };
                let watcher_path: &[u8] = watcher.path.as_bytes();

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
                    path::basename(watcher_path)
                } else {
                    entry.subpath.as_bytes()
                };

                watcher.emit(event_type, rel, entry.is_file);
                let _ = handle_oom(touched.get_or_put(entry.watcher));
            }

            for &w in touched.keys() {
                // SAFETY: w live under manager.mutex.
                unsafe { (*w).flush() };
            }
            drop(locked);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Windows
// ────────────────────────────────────────────────────────────────────────────────

/// One completion port, one reader thread, and per PathWatcher a directory handle with one `ReadDirectoryChangesW` in flight.
#[cfg(windows)]
#[derive(Default)]
pub(crate) struct Windows;

#[cfg(windows)]
pub(crate) struct WindowsWatch {
    /// `path`, or its directory if it is a file. Invalid once the watch has failed.
    dir: Fd,
    /// The path of `dir` and a separator: what the names in the records are relative to.
    dir_path: Box<[u16]>,
    /// A watched file's name and 8.3 name: a record has whichever was used to make the change.
    file_names: Vec<Box<[u16]>>,
    /// In flight for as long as `dir` is open, except while the reader thread handles its packet.
    request: *mut WindowsRequest,
}

#[cfg(windows)]
impl Default for WindowsWatch {
    fn default() -> Self {
        Self {
            dir: Fd::INVALID,
            dir_path: Box::default(),
            file_names: Vec::new(),
            request: core::ptr::null_mut(),
        }
    }
}

#[cfg(windows)]
#[repr(C)]
struct WindowsRequest {
    /// First: a packet has the address of this.
    overlapped: w::OVERLAPPED,
    /// Null once the watcher is done. Once armed, only the reader thread frees it: the kernel writes to it until the packet is off the port.
    owner: *mut PathWatcher,
    /// `u32` for the alignment of the records.
    buffer: Box<[u32]>,
}

#[cfg(windows)]
impl Windows {
    const SEPARATOR: u16 = b'\\' as u16;

    fn init() -> sys::Result<&'static PathWatcherManager> {
        let port = w::kernel32::CreateIoCompletionPort(
            w::INVALID_HANDLE_VALUE,
            core::ptr::null_mut(),
            0,
            1,
        );
        if port.is_null() {
            return Err(sys::Error::from_win32(w::Win32Error::get(), Tag::watch));
        }
        PathWatcherManager::with_reader_thread(Fd::from_system(port), Windows::thread_main)
    }

    /// Caller holds `manager.mutex`.
    fn add_watch(
        manager: &'static PathWatcherManager,
        _: &mut Windows,
        watcher: &mut PathWatcher,
    ) -> sys::Result<()> {
        let started = Windows::open(manager, watcher).and_then(|()| {
            Windows::arm(watcher).map_err(|code| sys::Error::from_win32(code, Tag::watch))
        });
        if started.is_err() {
            Windows::release(watcher);
        }
        started
    }

    fn open(manager: &'static PathWatcherManager, watcher: &mut PathWatcher) -> sys::Result<()> {
        let mut path_buf = path::w_path_buffer_pool::get();
        let full = path::string_paths::to_kernel32_path(&mut path_buf[..], watcher.path.as_bytes());
        let mut dir_path = full.as_slice().to_vec();
        if watcher.is_file {
            let name: Box<[u16]> = Windows::last_component(&dir_path).into();
            dir_path.truncate(dir_path.len() - name.len());
            watcher.platform.file_names.push(name);

            let mut short_buf = path::w_path_buffer_pool::get();
            // SAFETY: `full` is NUL-terminated, and `short_buf` is as long as the call is told.
            let short_len = unsafe {
                w::kernel32::GetShortPathNameW(
                    full.as_ptr(),
                    short_buf.as_mut_ptr(),
                    short_buf.len() as u32,
                )
            } as usize;
            match short_buf.get(..short_len) {
                Some(short) if !short.is_empty() => {
                    let name = Windows::last_component(short).into();
                    watcher.platform.file_names.push(name);
                }
                _ => {}
            }
        } else if dir_path.last() != Some(&Windows::SEPARATOR) {
            dir_path.push(Windows::SEPARATOR);
        }

        // The least access the requests take, and no `FILE_SYNCHRONOUS_IO_*`: they complete on the port.
        let dir = sys::open_file_at_windows(
            Fd::INVALID,
            &dir_path,
            sys::NtCreateFileOptions {
                access_mask: w::FILE_LIST_DIRECTORY | w::SYNCHRONIZE,
                disposition: w::FILE_OPEN,
                options: w::FILE_DIRECTORY_FILE | w::FILE_OPEN_FOR_BACKUP_INTENT,
                ..Default::default()
            },
        )?;
        watcher.platform.dir = dir;
        watcher.platform.dir_path = dir_path.into_boxed_slice();
        let port = manager.platform_fd.get().native();
        if w::kernel32::CreateIoCompletionPort(dir.native(), port, 0, 0).is_null() {
            return Err(sys::Error::from_win32(w::Win32Error::get(), Tag::watch));
        }

        // Node has 4096 for both. A tree has more to say, and a network share fails a request over 64 KiB.
        let buffer_len: usize = if Windows::is_recursive(watcher) {
            64 * 1024
        } else {
            4096
        };
        watcher.platform.request = bun_core::heap::into_raw(Box::new(WindowsRequest {
            overlapped: bun_core::ffi::zeroed(),
            owner: watcher,
            buffer: vec![0u32; buffer_len / size_of::<u32>()].into_boxed_slice(),
        }));
        Ok(())
    }

    fn is_recursive(watcher: &PathWatcher) -> bool {
        watcher.recursive && !watcher.is_file
    }

    fn last_component(path: &[u16]) -> &[u16] {
        let start = path
            .iter()
            .rposition(|&unit| unit == Windows::SEPARATOR)
            .map_or(0, |separator| separator + 1);
        &path[start..]
    }

    /// As the file system compares names.
    fn eql_names(a: &[u16], b: &[u16]) -> bool {
        // SAFETY: both are as long as the call is told.
        a.len() == b.len()
            && unsafe {
                w::kernel32::CompareStringOrdinal(
                    a.as_ptr(),
                    a.len() as i32,
                    b.as_ptr(),
                    b.len() as i32,
                    w::TRUE,
                )
            } == w::kernel32::CSTR_EQUAL
    }

    /// Puts the request in flight: one packet, or none if this fails. Caller holds `manager.mutex`.
    fn arm(watcher: &mut PathWatcher) -> Result<(), w::Win32Error> {
        // SAFETY: the request is not in flight, so it is the watcher's.
        let request = unsafe { &mut *watcher.platform.request };
        request.overlapped = bun_core::ffi::zeroed();
        // SAFETY: the request is not freed before its packet has arrived.
        let ok = unsafe {
            w::kernel32::ReadDirectoryChangesW(
                watcher.platform.dir.native(),
                request.buffer.as_mut_ptr().cast(),
                size_of_val(&*request.buffer) as u32,
                w::BOOL::from(Windows::is_recursive(watcher)),
                // As in Node.
                w::FileNotifyChangeFilter::all(),
                core::ptr::null_mut(),
                &raw mut request.overlapped,
                None,
            )
        };
        if ok == 0 {
            return Err(w::Win32Error::get());
        }
        Ok(())
    }

    /// Caller holds `manager.mutex`, and nothing is in flight.
    fn release(watcher: &mut PathWatcher) {
        let watch = &mut watcher.platform;
        if !watch.request.is_null() {
            // SAFETY: from `heap::into_raw` in `open`, and the kernel is done with it.
            drop(unsafe { bun_core::heap::take(watch.request) });
            watch.request = core::ptr::null_mut();
        }
        if watch.dir.is_valid() {
            watch.dir.close();
            watch.dir = Fd::INVALID;
        }
    }

    /// Caller holds `manager.mutex`.
    fn remove_watch(_: &'static PathWatcherManager, _: &mut Windows, watcher: &mut PathWatcher) {
        let watch = &mut watcher.platform;
        if !watch.request.is_null() {
            // SAFETY: the reader thread reads `owner` under `manager.mutex`, and the kernel does
            // not touch it.
            unsafe {
                (*watch.request).owner = core::ptr::null_mut();
                w::kernel32::CancelIoEx(watch.dir.native(), &raw mut (*watch.request).overlapped);
            }
            watch.request = core::ptr::null_mut();
        }
        Windows::release(watcher);
    }

    fn thread_main(manager: &'static PathWatcherManager) {
        Output::Source::configure_named_thread(zstr!("fs.watch"));
        let port = manager.platform_fd.get().native();
        loop {
            let mut len: w::DWORD = 0;
            let mut key: w::ULONG_PTR = 0;
            let mut overlapped: *mut w::OVERLAPPED = core::ptr::null_mut();
            // What it returns is about the request, whose status says more.
            // SAFETY: the out-params are live locals.
            let _ = unsafe {
                w::kernel32::GetQueuedCompletionStatus(
                    port,
                    &raw mut len,
                    &raw mut key,
                    &raw mut overlapped,
                    w::INFINITE,
                )
            };
            if overlapped.is_null() {
                // Fatal: surface to every watcher, then exit the thread.
                let err = sys::Error::from_win32(w::Win32Error::get(), Tag::watch);
                let locked = manager.mutex.lock();
                for &watcher in locked.watchers.values() {
                    // SAFETY: holding manager.mutex; watcher is live.
                    unsafe {
                        (*watcher).emit_error(&err, true);
                        (*watcher).flush();
                    }
                }
                drop(locked);
                return;
            }
            let request = overlapped.cast::<WindowsRequest>();

            let mut locked = manager.mutex.lock();
            // SAFETY: the packet has arrived, so the kernel is done with the request, and
            // `owner` is live under `manager.mutex` if it is not null.
            unsafe {
                let owner = (*request).owner;
                if owner.is_null() {
                    drop(bun_core::heap::take(request));
                } else {
                    let status = w::NTSTATUS((*request).overlapped.Internal as u32);
                    Windows::on_packet(&mut locked, &mut *owner, status, len as usize);
                    (*owner).flush();
                }
            }
            drop(locked);
        }
    }

    /// Caller holds `manager.mutex`.
    fn on_packet(locked: &mut Locked, watcher: &mut PathWatcher, status: w::NTSTATUS, len: usize) {
        if !w::NT_SUCCESS(status) {
            return Windows::fail(locked, watcher, w::Win32Error::from_nt_status(status));
        }
        // `len == 0`: more changed than the buffer holds.
        if len == 0 || !Windows::emit_records(watcher, len) {
            watcher.emit_overflow();
        }
        if let Err(code) = Windows::arm(watcher) {
            Windows::fail(locked, watcher, code);
        }
    }

    /// Ends the watch: a deleted directory fails every request at once. Caller holds `manager.mutex`, nothing is in flight.
    fn fail(locked: &mut Locked, watcher: &mut PathWatcher, code: w::Win32Error) {
        let is_deleted = code == w::Win32Error::ACCESS_DENIED
            && !watcher.is_file
            && Windows::is_deleted(watcher.platform.dir);
        // The name of a deleted directory is taken for as long as a handle to it is open.
        Windows::release(watcher);
        locked.unlink_watcher(watcher);
        if is_deleted {
            // As libuv.
            watcher.emit(WatchEventKind::Rename, watcher.path.as_bytes(), false);
            return watcher.emit_error(&sys::Error::from_code(E::ENOENT, Tag::watch), true);
        }
        watcher.emit_error(&sys::Error::from_win32(code, Tag::watch), true);
    }

    /// Whether `dir` only lasts for as long as it is open.
    fn is_deleted(dir: Fd) -> bool {
        let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        let mut info: w::FILE_STANDARD_INFORMATION = bun_core::ffi::zeroed();
        // SAFETY: both out-params outlive the call.
        let status = unsafe {
            w::ntdll::NtQueryInformationFile(
                dir.native(),
                &raw mut io,
                (&raw mut info).cast(),
                size_of::<w::FILE_STANDARD_INFORMATION>() as u32,
                w::FILE_INFORMATION_CLASS::FileStandardInformation,
            )
        };
        w::NT_SUCCESS(status) && info.DeletePending != 0
    }

    /// False if the `len` bytes are not whole records.
    fn emit_records(watcher: &PathWatcher, len: usize) -> bool {
        // SAFETY: its packet has arrived, so the request is the watcher's.
        let buffer: &[u32] = unsafe { &(*watcher.platform.request).buffer };
        if len > size_of_val(buffer) {
            return false;
        }
        let units: &[u16] = bun_core::cast_slice(buffer);
        let mut utf8 = path::path_buffer_pool::get();
        let mut long_buf = path::w_path_buffer_pool::get();
        let mut at: usize = 0;
        loop {
            // `FILE_NOTIFY_INFORMATION`: NextEntryOffset, Action, FileNameLength, FileName.
            let header = buffer[at / size_of::<u32>()..].first_chunk::<3>();
            let Some(&[next, action, name_len]) = header else {
                return false;
            };
            let name_start = at + size_of::<[u32; 3]>();
            let name_end = name_start + name_len as usize;
            if name_len % 2 != 0 || name_end > len {
                return false;
            }
            let name = &units[name_start / 2..name_end / 2];
            Windows::emit_record(watcher, action, name, &mut utf8[..], &mut long_buf[..]);
            if next == 0 {
                return true;
            }
            at += next as usize;
            if at < name_end || !at.is_multiple_of(size_of::<u32>()) || at >= len {
                return false;
            }
        }
    }

    fn emit_record(
        watcher: &PathWatcher,
        action: u32,
        name: &[u16],
        utf8: &mut [u8],
        long_buf: &mut [u16],
    ) {
        let (kind, exists) = match action {
            w::FILE_ACTION_ADDED | w::FILE_ACTION_RENAMED_NEW_NAME => {
                (WatchEventKind::Rename, true)
            }
            w::FILE_ACTION_REMOVED | w::FILE_ACTION_RENAMED_OLD_NAME => {
                (WatchEventKind::Rename, false)
            }
            w::FILE_ACTION_MODIFIED => (WatchEventKind::Change, true),
            _ => return,
        };

        if watcher.is_file {
            let names = &watcher.platform.file_names;
            if names.iter().any(|own| Windows::eql_names(own, name)) {
                watcher.emit_watched_file(kind);
            }
            return;
        }

        let name = if exists {
            Windows::long_name(&watcher.platform.dir_path, name, long_buf).unwrap_or(name)
        } else {
            name
        };
        let name = path::string_paths::from_w_path(utf8, name);
        watcher.emit(kind, name.as_bytes(), false);
    }

    /// `name` without the 8.3 names it has if those were used to make the change.
    fn long_name<'a>(dir_path: &[u16], name: &[u16], long_buf: &'a mut [u16]) -> Option<&'a [u16]> {
        const TILDE: u16 = b'~' as u16;
        // Generated 8.3 names all have a tilde. Looking up every name would cost a hundred times the rest.
        if !name.contains(&TILDE) {
            return None;
        }
        let mut short_buf = path::w_path_buffer_pool::get();
        let short_len = dir_path.len() + name.len();
        if short_len >= short_buf.len() {
            return None;
        }
        short_buf[..dir_path.len()].copy_from_slice(dir_path);
        short_buf[dir_path.len()..short_len].copy_from_slice(name);
        short_buf[short_len] = 0;
        // SAFETY: `short_buf` is NUL-terminated, and `long_buf` is as long as the call is told.
        let long_len = unsafe {
            w::kernel32::GetLongPathNameW(
                short_buf.as_ptr(),
                long_buf.as_mut_ptr(),
                long_buf.len() as u32,
            )
        } as usize;
        let (dir, long) = long_buf.get(..long_len)?.split_at_checked(dir_path.len())?;
        (!long.is_empty() && Windows::eql_names(dir, dir_path)).then_some(long)
    }
}
