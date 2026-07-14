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
//!     └─ handlers[]           the JS FSWatcher contexts sharing this watch
//!
//! A second `fs.watch()` on the same path returns the existing PathWatcher with a
//! new handler appended. `detach()` removes a handler; the last one out tears down
//! the OS watch.

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use core::cell::Cell;
use core::cell::UnsafeCell;
use core::ffi::c_void;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use core::sync::atomic::{AtomicBool, Ordering};

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_collections::HashMap;
use bun_collections::{ArrayHashMap, StringArrayHashMap};
#[cfg(not(windows))]
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
use bun_paths::resolve_path::{join_string_buf, join_z_buf};
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_sys::FdExt;
use bun_sys::{self as sys, E, Fd, Tag};
use bun_threading::Mutex;
#[cfg(not(windows))]
use bun_wyhash::hash;

use bun_jsc::VirtualMachineRef as VirtualMachine;

use crate::node::node_fs_watcher::{Event, FSWatcher, WatchEventKind};

#[cfg(target_os = "macos")]
use crate::node::fs_events as fsevents;

bun_output::define_scoped_log!(log, fs_watch, hidden);

/// Process-global manager. Created on first `fs.watch()`, never destroyed (matches
/// the FSEvents loop and Windows libuv loop lifetimes).
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
    mutex: Mutex,

    /// Dedup map: dedup key → PathWatcher. The key is the resolved path with a one-byte
    /// suffix encoding `recursive` (so `fs.watch(p)` and `fs.watch(p, {recursive:true})`
    /// don't share — they want different OS registrations on every platform).
    ///
    /// Interior-mutable: written through `&'static PathWatcherManager` while holding
    /// `mutex`. The field must be `UnsafeCell` so deriving `&mut` from a shared
    /// manager reference is defined.
    watchers: UnsafeCell<StringArrayHashMap<*mut PathWatcher>>,

    /// Platform-specific dispatch maps (inotify wd_map / kqueue entries).
    /// On macOS this is empty — FSEvents owns its own thread via `fs_events.rs`.
    /// Interior-mutable for the same reason as `watchers`.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    platform: UnsafeCell<Platform>,

    /// inotify/kqueue fd. Set once in `Platform::init` *before* the reader thread
    /// spawns, never reassigned (process-lifetime singleton, no teardown). Hoisted
    /// out of `UnsafeCell<Platform>` so reads are safe `Cell::get()` instead of
    /// raw deref; thread-spawn happens-before makes the cross-thread read sound.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    platform_fd: Cell<Fd>,

    /// Reader-thread loop flag. Initialized `true`, never cleared (no teardown).
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    running: AtomicBool,

    /// Monotonic kevent generation counter (FreeBSD). Bumped under `mutex`.
    /// `Cell` so the bump is a safe `.get()/.set()` instead of a raw deref.
    #[cfg(target_os = "freebsd")]
    next_gen: Cell<usize>,
}

// SAFETY: all interior-mutable state (`watchers`, `platform` dispatch maps,
// `next_gen`) is only accessed while holding `mutex`. `running` is atomic.
// `platform_fd` is set once in `init()` before the reader thread spawns and is
// never written afterwards, so cross-thread `Cell::get()` reads observe only the
// publish ordered by the spawn happens-before — no data race. The manager is a
// process-global singleton shared between the JS thread(s) and the reader thread.
unsafe impl Sync for PathWatcherManager {}
// SAFETY: same field invariants as `Sync` above; the manager is constructed on
// one thread and only ever crosses threads as `&'static PathWatcherManager`,
// whose `Send` bound reduces to `PathWatcherManager: Sync`.
unsafe impl Send for PathWatcherManager {}

impl Default for PathWatcherManager {
    fn default() -> Self {
        Self {
            mutex: Mutex::new(),
            watchers: UnsafeCell::new(StringArrayHashMap::default()),
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
            platform: UnsafeCell::new(Platform::default()),
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
            platform_fd: Cell::new(Fd::INVALID),
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
            running: AtomicBool::new(true),
            #[cfg(target_os = "freebsd")]
            next_gen: Cell::new(1),
        }
    }
}

impl PathWatcherManager {
    pub(crate) fn get() -> sys::Result<&'static PathWatcherManager> {
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

    /// Build the dedup key into `buf`. Not null-terminated; only used as a hashmap key.
    fn make_key<'a>(buf: &'a mut [u8], resolved_path: &[u8], recursive: bool) -> &'a [u8] {
        buf[..resolved_path.len()].copy_from_slice(resolved_path);
        buf[resolved_path.len()] = if recursive { b'R' } else { b'N' };
        &buf[..resolved_path.len() + 1]
    }

    /// Remove `watcher` from the dedup map. Caller holds `mutex`.
    fn unlink_watcher_locked(&self, watcher: *mut PathWatcher) {
        // SAFETY: caller holds self.mutex; exclusive access to self.watchers.
        let watchers = unsafe { &mut *self.watchers.get() };
        if let Some(i) = watchers.values().iter().position(|&w| w == watcher) {
            // Key is an owned Box<[u8]>; swap_remove_at drops it.
            watchers.swap_remove_at(i);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// PathWatcher
// ────────────────────────────────────────────────────────────────────────────────

pub struct PathWatcher {
    manager: Option<&'static PathWatcherManager>,

    /// Canonical absolute path (realpath of the user-supplied path). Owned.
    #[cfg(not(windows))]
    path: ZBox,
    #[cfg(not(windows))]
    recursive: bool,
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    is_file: bool,

    /// JS `FSWatcher` contexts sharing this OS watch. Each gets its own ChangeEvent
    /// for per-handler duplicate suppression (same as `win_watcher.rs`). Guarded by
    /// `manager.mutex` on all platforms — every emit path (inotify/kqueue reader
    /// threads and the Darwin FSEvents callback) holds it while iterating, so
    /// attach/detach can never race with dispatch.
    handlers: ArrayHashMap<*mut c_void, ChangeEvent>,

    /// Per-platform per-watch state (inotify wds, kqueue fds, or the FSEventsWatcher).
    #[cfg(not(windows))]
    platform: PlatformWatch,
}

/// Per-handler duplicate suppression.
///
/// Suppresses only exact duplicates: same path hash *and* same event type
/// within a 1ms window. Distinct files changed in the same millisecond must
/// each emit — node delivers both (see test/js/node/test/parallel
/// fs-watch tests that write two files back-to-back). Kept identical to
/// `win_watcher.rs` so POSIX and Windows agree on which bursts are coalesced.
#[derive(Default)]
pub(crate) struct ChangeEvent {
    #[cfg(not(windows))]
    hash: u64,
    #[cfg(not(windows))]
    event_type_: WatchEventKind,
    #[cfg(not(windows))]
    timestamp: i64,
}

#[cfg(not(windows))]
impl ChangeEvent {
    fn should_emit(&mut self, hash: u64, timestamp: i64, event_type: WatchEventKind) -> bool {
        let time_diff = timestamp - self.timestamp;
        if self.timestamp == 0
            || time_diff > 1
            || self.event_type_ != event_type
            || self.hash != hash
        {
            self.timestamp = timestamp;
            self.event_type_ = event_type;
            self.hash = hash;
            return true;
        }
        false
    }
}

pub type Callback = fn(ctx: Option<*mut c_void>, event: Event, is_file: bool);
pub(crate) type UpdateEndCallback = fn(ctx: Option<*mut c_void>);

impl PathWatcher {
    /// Heap-allocate and return a raw pointer.
    pub(crate) fn new(init: PathWatcher) -> *mut PathWatcher {
        bun_core::heap::into_raw(Box::new(init))
    }

    /// Called from the platform reader thread with `manager.mutex` held.
    /// `rel_path` is borrowed — `onPathUpdatePosix` dupes it before enqueuing.
    #[cfg(not(windows))]
    fn emit(&mut self, event_type: WatchEventKind, rel_path: &[u8], is_file: bool) {
        let timestamp = bun_core::time::milli_timestamp();
        let h = hash(rel_path);
        for entry in self.handlers.iterator() {
            if entry.value_ptr.should_emit(h, timestamp, event_type) {
                (FSWatcher::ON_PATH_UPDATE)(
                    Some(*entry.key_ptr),
                    event_type.to_event(rel_path.into()),
                    is_file,
                );
            }
        }
    }

    /// Like [`emit`](Self::emit), but without per-handler duplicate suppression.
    /// The `IN_IGNORED` retiring a deleted inode's wd lands in the same
    /// millisecond as its `IN_DELETE_SELF`, with the same path and type, so
    /// `should_emit` would fold the two into one; node (libuv) delivers both.
    /// Caller holds `manager.mutex`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn emit_unsuppressed(&mut self, event_type: WatchEventKind, rel_path: &[u8], is_file: bool) {
        for &ctx in self.handlers.keys() {
            (FSWatcher::ON_PATH_UPDATE)(Some(ctx), event_type.to_event(rel_path.into()), is_file);
        }
    }

    /// The shared inotify queue overflowed and events were lost; every handler
    /// gets `('change', null)`. No duplicate suppression — a loss signal must
    /// always be delivered. Caller holds `manager.mutex`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn emit_overflow(&mut self) {
        for &ctx in self.handlers.keys() {
            (FSWatcher::ON_PATH_UPDATE)(
                Some(ctx),
                Event::NoFilename(WatchEventKind::Change),
                false,
            );
        }
    }

    #[cfg(not(any(windows, target_os = "freebsd")))]
    fn emit_error(&mut self, err: &sys::Error) {
        for &ctx in self.handlers.keys() {
            (FSWatcher::ON_PATH_UPDATE)(Some(ctx), Event::Error(err.clone()), false);
        }
    }

    /// Signals end-of-batch so `FSWatcher` can flush its queued events to the JS thread.
    /// Caller holds `manager.mutex`.
    #[cfg(not(windows))]
    fn flush(&mut self) {
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
    /// `_events_cb` holds that mutex while calling into `onFSEvent` (which takes
    /// `manager.mutex`). Holding both here would be AB/BA with the CF thread. Once
    /// `fse.deinit()` returns, `_events_cb` has released the loop mutex and nulled our
    /// slot, so no further callbacks will fire and `destroy()` is safe.
    ///
    /// # Safety
    /// `this` must be a live `PathWatcher` produced by [`PathWatcher::new`] whose
    /// `handlers` still contains `ctx`. Called from the JS thread only.
    // The param must stay `*mut PathWatcher`: forming `&mut *this` at entry would
    // assert exclusive access for the whole call, but on macOS the CF thread may
    // concurrently raw-read the disjoint `manager` field while we're between
    // `unlock()` and `remove_watch()` (see the SAFETY notes below). Each `&mut`
    // is therefore scoped to the region where exclusivity actually holds, so
    // clippy's `&mut` rewrite would be unsound here, not just stylistic.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn detach(this: *mut PathWatcher, ctx: *mut c_void) {
        // SAFETY: `this` is a live PathWatcher created via `PathWatcher::new`. Read
        // `manager` via the raw pointer so no `&mut PathWatcher` is asserted before
        // we hold `manager.mutex` — on macOS the CF thread may concurrently raw-read
        // the same field inside `on_fs_event` (see that fn's SAFETY note).
        let Some(manager) = (unsafe { (*this).manager }) else {
            // No manager → never registered (or already unlinked); we are sole owner.
            // SAFETY: sole owner; no other thread can reach `this`.
            let w = unsafe { &mut *this };
            w.handlers.swap_remove(&ctx);
            if w.handlers.len() == 0 {
                // SAFETY: `this` was created via PathWatcher::new (heap::alloc).
                unsafe { Self::destroy(this) };
            }
            return;
        };

        manager.mutex.lock();
        {
            // SAFETY: holding manager.mutex; the reader/CF threads only form their own
            // `&mut PathWatcher` while holding this lock, so ours is exclusive. Scope
            // `w` so its last use is before `unlock()` (NLL ends the borrow there) —
            // on macOS the tail below must not hold a `&mut` across `fse.deinit()`.
            let w = unsafe { &mut *this };
            w.handlers.swap_remove(&ctx);
            if w.handlers.len() > 0 {
                manager.mutex.unlock();
                return;
            }

            // Last handler gone — make this watcher unreachable before dropping the lock.
            manager.unlink_watcher_locked(this);
            w.manager = None;
            #[cfg(not(target_os = "macos"))]
            {
                Platform::remove_watch(manager, w);
            }
        }
        manager.mutex.unlock();

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

pub fn watch(
    vm: &VirtualMachine,
    path: &ZStr,
    recursive: bool,
    callback: Callback,
    update_end: UpdateEndCallback,
    ctx: *mut c_void,
) -> sys::Result<*mut PathWatcher> {
    // Assert the callback/updateEnd are what node_fs_watcher passes.
    // Compare against the *exact* fn pointers `FSWatcher` passes (not local wrappers,
    // which would be distinct fn items with distinct addresses).
    debug_assert!(callback as usize == FSWatcher::ON_PATH_UPDATE as usize);
    debug_assert!(update_end as usize == (FSWatcher::on_update_end as UpdateEndCallback) as usize);
    let _ = vm;

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
            // SAFETY: resolve_buf[len] == 0 written above; buf lives for the rest of this fn.
            ZStr::from_buf(&resolve_buf[..], len)
        }
    };

    let mut key_buf = path::path_buffer_pool::get();
    let key = PathWatcherManager::make_key(key_buf.as_mut_slice(), resolved.as_bytes(), recursive);

    manager.mutex.lock();

    // SAFETY: holding manager.mutex; exclusive access to manager.watchers.
    let watchers = unsafe { &mut *manager.watchers.get() };
    if let Some(&existing) = watchers.get(key) {
        // SAFETY: existing is a live PathWatcher under manager.mutex.
        unsafe { handle_oom((*existing).handlers.put(ctx, ChangeEvent::default())) };
        manager.mutex.unlock();
        return Ok(existing);
    }

    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
    let _ = is_file;
    // New watcher: own the key and path.
    let watcher = PathWatcher::new(PathWatcher {
        manager: Some(manager),
        #[cfg(not(windows))]
        path: ZBox::from_bytes(resolved.as_bytes()),
        #[cfg(not(windows))]
        recursive,
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        is_file,
        handlers: ArrayHashMap::default(),
        #[cfg(not(windows))]
        platform: PlatformWatch::default(),
    });
    // SAFETY: watcher just allocated; we hold the only reference.
    unsafe { handle_oom((*watcher).handlers.put(ctx, ChangeEvent::default())) };
    handle_oom(watchers.put(key, watcher));

    // Linux/FreeBSD: `addWatch` mutates the platform dispatch maps (wd_map/entries)
    // which live under `manager.mutex`, so call it while still locked.
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
        if let Err(err) = Platform::add_watch(manager, unsafe { &mut *watcher }) {
            // Still under the same lock as the map insertion, so no other thread
            // can have observed `watcher` yet — unconditional destroy is safe.
            manager.unlink_watcher_locked(watcher);
            manager.mutex.unlock();
            // SAFETY: no other thread observed watcher.
            unsafe {
                (*watcher).manager = None;
                PathWatcher::destroy(watcher);
            }
            // `Linux.addOne` builds the error with `.path = watcher.path`, which we
            // just freed; strip it like every other return in this function.
            return Err(err.without_path());
        }
        manager.mutex.unlock();
        return Ok(watcher);
    }

    #[cfg(target_os = "macos")]
    {
        manager.mutex.unlock();

        // SAFETY: watcher heap-allocated; reachable via dedup map but FSEvents not yet
        // scheduled so no concurrent emit.
        if let Err(err) = Platform::add_watch(manager, unsafe { &mut *watcher }) {
            // `watcher` was visible in the dedup map while we were unlocked above; a
            // concurrent Worker's `fs.watch()` on the same path may have attached a
            // handler and already returned `watcher` to its caller. Only destroy if
            // ours was the last handler; otherwise surface the error to the survivors
            // and leave `watcher.manager` set so their `detach()` takes the locked path
            // (→ `unlinkWatcherLocked` no-ops, `removeWatch` no-ops on null `fsevents`,
            // then frees). Never free memory another thread holds.
            manager.mutex.lock();
            manager.unlink_watcher_locked(watcher);
            // SAFETY: holding manager.mutex.
            let w = unsafe { &mut *watcher };
            w.handlers.swap_remove(&ctx);
            if w.handlers.len() > 0 {
                w.emit_error(&err);
                w.flush();
                manager.mutex.unlock();
                return Err(err.without_path());
            }
            w.manager = None;
            manager.mutex.unlock();
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
    let mut rel_buf = path::path_buffer_pool::get();
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
        let child_abs =
            join_z_buf::<platform::Posix>(abs_buf.as_mut_slice(), &[abs_dir.as_bytes(), name]);
        let child_rel: &[u8] = if rel_dir.is_empty() {
            name
        } else {
            join_string_buf::<platform::Posix>(rel_buf.as_mut_slice(), &[rel_dir, name])
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
    /// Raw `*mut`. Stored in a long-lived map and mutated
    /// (`emit`, `platform.wds`) under `manager.mutex`; a `&PathWatcher` here would
    /// make every write-through a const→mut cast (UB). Lifetime: outlives the entry
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
        // Owning raw pointer first, shared view second: the spawn error arm reclaims
        // through `manager_ptr`, which must not be derived from a shared reference.
        let manager_ptr = bun_core::heap::into_raw(Box::new(PathWatcherManager::default()));
        // SAFETY: just allocated and exclusively owned; published only on Ok.
        let manager: &'static PathWatcherManager = unsafe { &*manager_ptr };
        manager.platform_fd.set(Fd::from_native(rc));
        // The manager is process-global and never torn down, so the reader thread is
        // a daemon — detach it instead of stashing a handle we'd never join.
        match std::thread::Builder::new().spawn(move || Linux::thread_main(manager)) {
            Ok(handle) => drop(handle), // detach
            Err(_) => {
                manager.platform_fd.get().close();
                // SAFETY: the thread never started and the manager was never published.
                drop(unsafe { bun_core::heap::take(manager_ptr) });
                return Err(sys::Error::from_code(E::ENOMEM, Tag::watch));
            }
        }
        Ok(manager)
    }

    /// Caller holds `manager.mutex`.
    fn add_watch(
        manager: &'static PathWatcherManager,
        watcher: &mut PathWatcher,
    ) -> sys::Result<()> {
        // Borrowck: clone path to avoid &/&mut overlap on watcher.
        let root = watcher.path.clone();
        Linux::add_one(manager, watcher, &root, b"")?;
        if watcher.recursive && !watcher.is_file {
            Linux::walk_and_add(manager, watcher, &root, b"");
        }
        Ok(())
    }

    /// Add a single inotify watch and record ownership. Caller holds `manager.mutex`.
    fn add_one(
        manager: &'static PathWatcherManager,
        watcher: &mut PathWatcher,
        abs_path: &ZStr,
        subpath: &[u8],
    ) -> sys::Result<()> {
        let plat: *mut Linux = manager.platform.get();
        let mask: u32 = if watcher.is_file && subpath.is_empty() {
            inotify_masks::WATCH_FILE_MASK
        } else {
            inotify_masks::WATCH_DIR_MASK
        };
        let fd = manager.inotify_fd();
        // SAFETY: thin wrapper over libc::inotify_add_watch; abs_path is NUL-terminated.
        let rc = unsafe { sys::linux::inotify_add_watch(fd.native(), abs_path.as_ptr(), mask) };
        if rc < 0 {
            // ENOTDIR/ENOENT during a recursive walk just means we raced; skip.
            if !subpath.is_empty() {
                return Ok(());
            }
            return Err(sys::Error::from_code_int(sys::last_errno(), Tag::watch)
                .with_path(abs_path.as_bytes()));
        }
        let wd: i32 = rc;
        // SAFETY: caller holds manager.mutex; exclusive access to `wd_map`.
        let owners = unsafe { (*plat).wd_map.entry(wd).or_default() };
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
    fn walk_and_add(
        manager: &'static PathWatcherManager,
        watcher: &mut PathWatcher,
        abs_dir: &ZStr,
        rel_dir: &[u8],
    ) {
        walk_subtree::<true>(abs_dir, rel_dir, &mut |abs, rel, _is_file| {
            let _ = Linux::add_one(manager, watcher, abs, rel);
        });
    }

    /// Caller holds `manager.mutex`. Drops this watcher's ownership of each of its
    /// wds; only issues `inotify_rm_watch` once a wd has no remaining owners.
    fn remove_watch(manager: &'static PathWatcherManager, watcher: &mut PathWatcher) {
        let plat: *mut Linux = manager.platform.get();
        let fd = manager.inotify_fd();
        // SAFETY: caller holds manager.mutex; exclusive access to `wd_map`.
        let wd_map = unsafe { &mut (*plat).wd_map };
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
        let plat: *mut Linux = manager.platform.get();
        let fd = manager.inotify_fd();
        let running: &AtomicBool = &manager.running;
        // Large enough for a burst of events; inotify guarantees whole events per read.
        // `align(InotifyEvent)`: stack array `[u8; N]` is 1-aligned; box for 4-byte
        // alignment so the `&InotifyEvent` cast is valid.
        #[repr(C, align(4))]
        struct AlignedBuf([u8; 64 * 1024]);
        let mut buf = {
            let mut b = Box::<AlignedBuf>::new_uninit();
            // SAFETY: `AlignedBuf` is `repr(C)` over `[u8; N]`; `write_bytes`
            // fully zero-initializes it before `assume_init`.
            unsafe {
                core::ptr::write_bytes(b.as_mut_ptr(), 0, 1);
                b.assume_init()
            }
        };
        let mut path_buf = PathBuffer::uninit();

        while running.load(Ordering::Acquire) {
            // SAFETY: buf is valid for buf.0.len() bytes; fd is a plain c_int.
            let rc = unsafe { sys::linux::read(fd.native(), buf.0.as_mut_ptr(), buf.0.len()) };
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
                    manager.mutex.lock();
                    // SAFETY: holding manager.mutex.
                    let watchers = unsafe { &*manager.watchers.get() };
                    for &w in watchers.values() {
                        // SAFETY: holding manager.mutex; w is live.
                        unsafe {
                            (*w).emit_error(&err);
                            (*w).flush();
                        }
                    }
                    manager.mutex.unlock();
                    return;
                }
            }
            let n = rc as usize;
            if n == 0 {
                continue;
            }

            manager.mutex.lock();
            // Track which PathWatchers got at least one event so we flush() each once.
            let mut touched: ArrayHashMap<*mut PathWatcher, ()> = ArrayHashMap::default();

            let mut i: usize = 0;
            while i < n {
                // SAFETY: inotify guarantees whole events and pads `name` so each
                // header stays 4-byte aligned; `buf` is 4-byte aligned via
                // `AlignedBuf`, so byte offset `i` always lands on an aligned
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
                    // SAFETY: holding manager.mutex.
                    let watchers = unsafe { &*manager.watchers.get() };
                    for &w in watchers.values() {
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
                    // SAFETY: holding manager.mutex; exclusive access to `wd_map`.
                    let wd_map = unsafe { &mut (*plat).wd_map };
                    if let Some(owners) = wd_map.get_mut(&wd) {
                        for o in owners.drain(..) {
                            // SAFETY: o.watcher live under manager.mutex. `path` is
                            // read through the raw pointer (a separate ZBox heap
                            // allocation) so the slice is not derived from the
                            // `&mut` formed below, as in the dispatch loop.
                            let (w_is_file, w_recursive, w_path): (bool, bool, &[u8]) = unsafe {
                                (
                                    (*o.watcher).is_file,
                                    (*o.watcher).recursive,
                                    &*std::ptr::from_ref::<[u8]>((*o.watcher).path.as_bytes()),
                                )
                            };
                            // SAFETY: o.watcher live under manager.mutex.
                            let w = unsafe { &mut *o.watcher };
                            if o.subpath.as_bytes().is_empty() && (w_is_file || !w_recursive) {
                                w.emit_unsuppressed(
                                    WatchEventKind::Rename,
                                    path::basename(w_path),
                                    w_is_file,
                                );
                                let _ = handle_oom(touched.get_or_put(o.watcher));
                            }
                            if let Some(idx) = w.platform.wds.iter().position(|&x| x == wd) {
                                w.platform.wds.swap_remove(idx);
                            }
                        }
                        wd_map.remove(&wd);
                    }
                    continue;
                }

                // SAFETY: holding manager.mutex.
                if unsafe { (*plat).wd_map.get(&wd).is_none() } {
                    continue;
                }

                let name: &[u8] = if ev.name_len > 0 {
                    // SAFETY: i was just advanced past this event's name_len bytes; offset is within buf[0..n].
                    let name_ptr = unsafe { buf.0.as_ptr().add(i - ev.name_len as usize) };
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
                    // SAFETY: holding manager.mutex. Re-project `wd_map` each iteration
                    // (raw-ptr access, no long-lived `&mut`): the recursive branch below
                    // calls `add_one`/`walk_and_add`, which take their own `&mut wd_map`
                    // and may rehash. Extract the owner's watcher ptr and subpath bytes,
                    // then drop the map borrow before any of that runs.
                    let (owner_watcher, owner_subpath): (*mut PathWatcher, &[u8]) = unsafe {
                        let Some(owners) = (*plat).wd_map.get(&wd) else {
                            break;
                        };
                        if oi >= owners.len() {
                            break;
                        }
                        let o = &owners[oi];
                        // `o.subpath` is a `ZBox` — its heap bytes do not move when
                        // `wd_map` rehashes (only the Vec header does). Launder the slice
                        // through a raw ptr so its provenance is decoupled from the map
                        // borrow that `add_one` will invalidate.
                        (
                            o.watcher,
                            &*std::ptr::from_ref::<[u8]>(o.subpath.as_bytes()),
                        )
                    };
                    // SAFETY: owner_watcher live under manager.mutex. Read the scalar
                    // fields and the path bytes via the raw pointer *before* forming
                    // `&mut *owner_watcher` so `rel` (which may borrow them) is
                    // decoupled from the exclusive borrow `emit()` needs — a named
                    // shared borrow of `watcher.path` cannot coexist with the
                    // `&mut self` receiver. `path` is a `ZBox`; its heap bytes are a
                    // separate allocation, so this mirrors the `owner_subpath`
                    // raw-ptr laundering above.
                    let (watcher_is_file, watcher_recursive, watcher_path): (bool, bool, &[u8]) = unsafe {
                        (
                            (*owner_watcher).is_file,
                            (*owner_watcher).recursive,
                            &*std::ptr::from_ref::<[u8]>((*owner_watcher).path.as_bytes()),
                        )
                    };
                    // SAFETY: `owner_watcher` is live under `manager.mutex`; no
                    // other `&mut PathWatcher` to this allocation exists while
                    // the lock is held on this thread.
                    let watcher = unsafe { &mut *owner_watcher };

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
                        join_string_buf::<platform::Posix>(
                            path_buf.as_mut_slice(),
                            &[owner_subpath, name],
                        )
                    };

                    watcher.emit(
                        event_type,
                        rel,
                        !is_dir_child
                            && !((ev.mask & (IN::DELETE_SELF | IN::MOVE_SELF) != 0)
                                && !watcher_is_file),
                    );
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
                        let child_abs = join_z_buf::<platform::Posix>(
                            abs_buf.as_mut_slice(),
                            &[watcher_path, owner_subpath, name],
                        );
                        // Borrowck: `rel` may borrow `path_buf`,
                        // which `walk_subtree` also borrows. Own it for the call.
                        let rel_owned: Box<[u8]> = Box::from(rel);
                        // These may rehash `wd_map`; `owners` is re-fetched next iteration.
                        let _ = Linux::add_one(manager, watcher, child_abs, &rel_owned);
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
                                    let _ = Linux::add_one(manager, watcher, abs, entry_rel);
                                }
                                watcher.emit(WatchEventKind::Rename, entry_rel, entry_is_file);
                            },
                        );
                    }

                    oi += 1;
                }
            }

            for &w in touched.keys() {
                // SAFETY: w live under manager.mutex.
                unsafe { (*w).flush() };
            }
            manager.mutex.unlock();
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
pub struct Darwin {
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
        // SAFETY: just allocated; nothing after this can fail.
        Ok(unsafe { &*bun_core::heap::into_raw(Box::new(PathWatcherManager::default())) })
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
    /// mutex, which `_events_cb` holds for the whole dispatch; once this returns no
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

    /// Called from the CFRunLoop thread (`fs_events.rs`'s `_events_cb`) with the
    /// FSEvents loop mutex held. Take `manager.mutex` so iterating `handlers` can't
    /// race with `watch()`/`detach()` mutating it. The JS thread never holds
    /// `manager.mutex` across a call into FSEvents, so this is deadlock-free.
    ///
    /// `watcher` itself is kept alive by the FSEvents loop mutex: `detach()` →
    /// `removeWatch()` → `fse.deinit()` → `unregisterWatcher()` blocks until
    /// `_events_cb` releases it, so `destroy()` cannot run under us. The
    /// `watcher.manager == null` check catches the window where detach has already
    /// unlinked us but hasn't yet called `fse.deinit()`.
    fn on_fs_event(ctx: *mut c_void, event: Event, is_file: bool) {
        // SAFETY: ctx is the *mut PathWatcher passed in add_watch above. Keep it raw
        // until `manager.mutex` is held and the `manager.is_none()` bail-out has run:
        // `detach()` on the JS thread may concurrently be between its `unlock()` and
        // `remove_watch()` (blocked on the FSEvents loop mutex we hold), with the
        // watcher already unlinked. Forming `&mut *ctx` here before that check would
        // alias detach's access; raw-ptr reads have no exclusivity assertion.
        let watcher_ptr = ctx.cast::<PathWatcher>();
        let Some(&manager) = DEFAULT_MANAGER.get() else {
            return;
        };
        let _g = manager.mutex.lock_guard();
        // SAFETY: raw read under manager.mutex; see above.
        if unsafe { (*watcher_ptr).manager.is_none() } {
            return;
        }
        // SAFETY: holding manager.mutex with `manager` still set → detach() has not
        // yet unlinked us, so no other `&mut PathWatcher` exists for this allocation.
        let watcher = unsafe { &mut *watcher_ptr };
        match event {
            Event::Rename(path) => watcher.emit(WatchEventKind::Rename, &path, is_file),
            Event::Change(path) => watcher.emit(WatchEventKind::Change, &path, is_file),
            Event::Error(err) => watcher.emit_error(&err),
            _ => {}
        }
    }

    fn on_fs_event_flush(ctx: *mut c_void) {
        // SAFETY: see on_fs_event — keep raw until locked + manager-is-none checked.
        let watcher_ptr = ctx.cast::<PathWatcher>();
        let Some(&manager) = DEFAULT_MANAGER.get() else {
            return;
        };
        let _g = manager.mutex.lock_guard();
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
    /// Raw `*mut`. See `WdOwner.watcher` — stored long-lived,
    /// mutated through (`emit`) under `manager.mutex`; outlives the entry because
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
        let kq = sys::kqueue()?;
        // Owning raw pointer first, shared view second: the spawn error arm reclaims
        // through `manager_ptr`, which must not be derived from a shared reference.
        let manager_ptr = bun_core::heap::into_raw(Box::new(PathWatcherManager::default()));
        // SAFETY: just allocated and exclusively owned; published only on Ok.
        let manager: &'static PathWatcherManager = unsafe { &*manager_ptr };
        manager.platform_fd.set(kq);
        // Daemon reader — the manager is process-global and never torn down.
        match std::thread::Builder::new().spawn(move || Kqueue::thread_main(manager)) {
            Ok(handle) => drop(handle), // detach
            Err(_) => {
                manager.platform_fd.get().close();
                // SAFETY: the thread never started and the manager was never published.
                drop(unsafe { bun_core::heap::take(manager_ptr) });
                return Err(sys::Error::from_code(E::ENOMEM, Tag::watch));
            }
        }
        Ok(manager)
    }

    /// Caller holds `manager.mutex`.
    fn add_watch(
        manager: &'static PathWatcherManager,
        watcher: &mut PathWatcher,
    ) -> sys::Result<()> {
        // Borrowck: clone path to avoid &/&mut overlap.
        let root = watcher.path.clone();
        let is_file = watcher.is_file;
        Kqueue::add_one(manager, watcher, &root, b"", is_file)?;
        if watcher.recursive && !watcher.is_file {
            // kqueue needs an open fd per *file* as well as per directory.
            walk_subtree::<false>(&root, b"", &mut |abs, rel, is_file| {
                let _ = Kqueue::add_one(manager, watcher, abs, rel, is_file);
            });
        }
        Ok(())
    }

    fn add_one(
        manager: &'static PathWatcherManager,
        watcher: &mut PathWatcher,
        abs_path: &ZStr,
        subpath: &[u8],
        is_file: bool,
    ) -> sys::Result<()> {
        use bun_sys::freebsd::{EV, EVFILT, Kevent, NOTE, kevent};
        let plat: *mut Kqueue = manager.platform.get();
        // O_EVTONLY: we only need the fd for kevent registration, never for I/O.
        // (No-op on FreeBSD where EVTONLY is 0; semantic here for kqueue-on-macOS.)
        let fd = match sys::open(
            abs_path,
            sys::O::EVTONLY | sys::O::RDONLY | sys::O::CLOEXEC,
            0,
        ) {
            Err(e) => {
                if !subpath.is_empty() {
                    return Ok(()); // best-effort on children
                }
                return Err(e.without_path());
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
            if !subpath.is_empty() {
                return Ok(()); // best-effort on children
            }
            return Err(sys::Error {
                errno: errno as u16,
                syscall: Tag::kevent,
                ..Default::default()
            });
        }

        // SAFETY: caller holds manager.mutex; exclusive access to `entries`.
        unsafe {
            handle_oom((*plat).entries.put(
                fd.native() as i32,
                KqEntry {
                    watcher: core::ptr::from_mut(watcher),
                    fd,
                    subpath: ZBox::from_bytes(subpath),
                    generation,
                    is_file,
                },
            ));
        }
        watcher.platform.fds.push(fd.native() as i32);
        Ok(())
    }

    /// Caller holds `manager.mutex`.
    fn remove_watch(manager: &'static PathWatcherManager, watcher: &mut PathWatcher) {
        // SAFETY: caller holds manager.mutex; exclusive access to `entries`.
        let entries = unsafe { &mut (*manager.platform.get()).entries };
        for &ident in watcher.platform.fds.iter() {
            if let Some((_, entry)) = entries.fetch_swap_remove(&ident) {
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
        let plat: *mut Kqueue = manager.platform.get();
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

            manager.mutex.lock();
            // SAFETY: holding manager.mutex; exclusive access to `entries`. This loop
            // never mutates `entries`, so a shared borrow suffices.
            let entries = unsafe { &(*plat).entries };
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
                // Launder the path bytes via the raw pointer so `rel` is decoupled
                // from the `&mut self` activated for `emit()` — a named shared borrow
                // of `watcher.path` cannot coexist with that exclusive reborrow.
                // `path` is a `ZBox`; its heap bytes are a separate allocation.
                let watcher_path: &[u8] =
                    unsafe { &*((*entry.watcher).path.as_bytes() as *const [u8]) };
                let watcher = unsafe { &mut *entry.watcher };

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
            manager.mutex.unlock();
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Windows stub
// ────────────────────────────────────────────────────────────────────────────────
