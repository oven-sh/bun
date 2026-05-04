//! POSIX backend for `fs.watch()`.
//!
//! This is deliberately independent of `bun.Watcher` (the bundler/--watch/--hot
//! watcher). `bun.Watcher` is shaped around a module graph — its WatchItem carries
//! `options.Loader`, `*PackageJSON`, a `*bun.fs.FileSystem`, and on Windows is pinned
//! to `top_level_dir`. None of that applies to `fs.watch()`, and routing `fs.watch()`
//! through it required a 1k-line shim (the old version of this file) full of
//! lock-ordering workarounds, a WorkPool directory crawler, and a bolted-on FSEvents
//! side-channel.
//!
//! The Windows backend (`win_watcher.zig`, libuv `uv_fs_event`) never went through
//! `bun.Watcher` and is a quarter of the size; this file gives Linux/macOS/FreeBSD
//! the same shape:
//!
//!   PathWatcherManager        process-global, lazy, owns the OS resource
//!     ├─ Linux:   one inotify fd + one reader thread, wd → PathWatcher map
//!     ├─ macOS:   delegates to fs_events.zig (one CFRunLoop thread, one FSEventStream)
//!     └─ FreeBSD: one kqueue fd + one reader thread, fd → PathWatcher map
//!
//!   PathWatcher               one per unique (realpath, recursive) — deduped
//!     └─ handlers[]           the JS FSWatcher contexts sharing this watch
//!
//! A second `fs.watch()` on the same path returns the existing PathWatcher with a
//! new handler appended. `detach()` removes a handler; the last one out tears down
//! the OS watch.

use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_collections::{ArrayHashMap, HashMap, StringArrayHashMap};
use bun_core::Output;
use bun_paths::{self as path, PathBuffer};
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Fd, Syscall};
use bun_threading::Mutex;
use bun_wyhash::hash;

use bun_jsc::VirtualMachine;

// TODO(port): exact module path for FSWatcher/Event in bun_runtime
use crate::node::node_fs_watcher::{self as fswatcher, Event, FSWatcher};
type EventPathString = fswatcher::EventPathString;

#[cfg(target_os = "macos")]
use crate::node::fs_events as fsevents;

bun_output::declare_scope!(fs_watch, hidden);
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(fs_watch, $($arg)*) };
}

/// Process-global manager. Created on first `fs.watch()`, never destroyed (matches
/// the FSEvents loop and Windows libuv loop lifetimes).
// TODO(port): static mut — guarded by DEFAULT_MANAGER_MUTEX; consider OnceLock in Phase B
static mut DEFAULT_MANAGER: Option<&'static PathWatcherManager> = None;
static DEFAULT_MANAGER_MUTEX: Mutex = Mutex::new();

// ────────────────────────────────────────────────────────────────────────────────
// PathWatcherManager
// ────────────────────────────────────────────────────────────────────────────────

pub struct PathWatcherManager {
    /// Guards `watchers` and all per-platform dispatch maps. The reader thread holds
    /// this while dispatching, so `detach()` on the JS thread cannot free a PathWatcher
    /// mid-emit. A single lock here replaces the three interacting mutexes of the old
    /// design.
    mutex: Mutex,

    /// Dedup map: dedup key → PathWatcher. The key is the resolved path with a one-byte
    /// suffix encoding `recursive` (so `fs.watch(p)` and `fs.watch(p, {recursive:true})`
    /// don't share — they want different OS registrations on every platform).
    // TODO(port): interior mutability — mutated under `mutex` via &'static; needs UnsafeCell
    watchers: StringArrayHashMap<*mut PathWatcher>,

    /// Platform-specific state (inotify fd / kqueue fd + dispatch maps + thread).
    /// On macOS this is empty — FSEvents owns its own thread via `fs_events.zig`.
    platform: Platform,
}

impl Default for PathWatcherManager {
    fn default() -> Self {
        Self {
            mutex: Mutex::new(),
            watchers: StringArrayHashMap::default(),
            platform: Platform::default(),
        }
    }
}

impl PathWatcherManager {
    pub fn get() -> sys::Result<&'static PathWatcherManager> {
        // No unlocked fast path: `default_manager` is a plain global and an unsynchronized
        // read here would be textbook broken DCLP (a concurrent Worker's first `fs.watch()`
        // on ARM64 could observe the non-null pointer before `m.* = .{}` is visible and
        // lock a garbage `m.mutex`). `get()` runs once per `fs.watch()` call; the mutex is
        // uncontended after initialization.
        DEFAULT_MANAGER_MUTEX.lock();
        let _g = scopeguard::guard((), |_| DEFAULT_MANAGER_MUTEX.unlock());
        // SAFETY: DEFAULT_MANAGER is only read/written while holding DEFAULT_MANAGER_MUTEX.
        unsafe {
            if let Some(m) = DEFAULT_MANAGER {
                return Ok(m);
            }
        }

        let m = Box::leak(Box::new(PathWatcherManager::default()));
        if let Err(e) = Platform::init(m) {
            // SAFETY: `m` was just leaked from a Box and not yet published.
            unsafe { drop(Box::from_raw(m as *mut PathWatcherManager)) };
            return Err(e);
        }
        // SAFETY: holding DEFAULT_MANAGER_MUTEX.
        unsafe { DEFAULT_MANAGER = Some(&*m) };
        Ok(&*m)
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
        let watchers = unsafe { &mut *(&self.watchers as *const _ as *mut StringArrayHashMap<*mut PathWatcher>) };
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
    path: Box<ZStr>,
    recursive: bool,
    is_file: bool,

    /// JS `FSWatcher` contexts sharing this OS watch. Each gets its own ChangeEvent
    /// for per-handler duplicate suppression (same as win_watcher.zig). Guarded by
    /// `manager.mutex` on all platforms — every emit path (inotify/kqueue reader
    /// threads and the Darwin FSEvents callback) holds it while iterating, so
    /// attach/detach can never race with dispatch.
    handlers: ArrayHashMap<*mut c_void, ChangeEvent>,

    /// Per-platform per-watch state (inotify wds, kqueue fds, or the FSEventsWatcher).
    platform: PlatformWatch,
}

#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum EventType {
    #[strum(serialize = "rename")]
    Rename,
    #[strum(serialize = "change")]
    Change,
}

impl EventType {
    pub fn to_event(self, path: EventPathString) -> Event {
        match self {
            EventType::Rename => Event::Rename(path),
            EventType::Change => Event::Change(path),
        }
    }
}

/// Per-handler duplicate suppression.
///
/// The predicate is intentionally identical to `win_watcher.zig` and the old
/// `path_watcher.zig` so POSIX and Windows agree on which bursts are coalesced.
/// It suppresses only when, within the same millisecond, *both* the hash and
/// the event type match the previous emission — arguably too aggressive, but
/// changing it here would diverge from Windows; fixing all three together is
/// a separate change.
#[derive(Default)]
pub struct ChangeEvent {
    hash: u64,
    event_type_: EventType,
    timestamp: i64,
}

impl Default for EventType {
    fn default() -> Self {
        EventType::Change
    }
}

impl ChangeEvent {
    fn should_emit(&mut self, hash: u64, timestamp: i64, event_type: EventType) -> bool {
        let time_diff = timestamp - self.timestamp;
        if (self.timestamp == 0 || time_diff > 1)
            || (self.event_type_ != event_type && self.hash != hash)
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
pub type UpdateEndCallback = fn(ctx: Option<*mut c_void>);

impl PathWatcher {
    /// `bun.TrivialNew(PathWatcher)` — heap-allocate and return raw pointer.
    pub fn new(init: PathWatcher) -> *mut PathWatcher {
        Box::into_raw(Box::new(init))
    }

    /// Called from the platform reader thread with `manager.mutex` held.
    /// `rel_path` is borrowed — `onPathUpdatePosix` dupes it before enqueuing.
    fn emit(&mut self, event_type: EventType, rel_path: &[u8], is_file: bool) {
        // TODO(port): std.time.milliTimestamp() equivalent
        let timestamp = bun_core::time::milli_timestamp();
        let h = hash(rel_path);
        for (ctx, last) in self.handlers.keys().iter().zip(self.handlers.values_mut()) {
            if last.should_emit(h, timestamp, event_type) {
                on_path_update_fn(Some(*ctx), event_type.to_event(rel_path.into()), is_file);
            }
        }
    }

    fn emit_error(&mut self, err: sys::Error) {
        for ctx in self.handlers.keys() {
            on_path_update_fn(Some(*ctx), Event::Error(err), false);
        }
    }

    /// Signals end-of-batch so `FSWatcher` can flush its queued events to the JS thread.
    /// Caller holds `manager.mutex`.
    fn flush(&mut self) {
        for ctx in self.handlers.keys() {
            on_update_end_fn(Some(*ctx));
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
    pub fn detach(&mut self, ctx: *mut c_void) {
        let Some(manager) = self.manager else {
            self.handlers.swap_remove(&ctx);
            if self.handlers.len() == 0 {
                // SAFETY: self was created via PathWatcher::new (Box::into_raw).
                unsafe { Self::destroy(self as *mut Self) };
            }
            return;
        };

        manager.mutex.lock();
        self.handlers.swap_remove(&ctx);
        if self.handlers.len() > 0 {
            manager.mutex.unlock();
            return;
        }

        // Last handler gone — make this watcher unreachable before dropping the lock.
        manager.unlink_watcher_locked(self as *mut Self);
        self.manager = None;
        #[cfg(not(target_os = "macos"))]
        {
            Platform::remove_watch(manager, self);
        }
        manager.mutex.unlock();

        #[cfg(target_os = "macos")]
        {
            // Takes fsevents_loop.mutex; must not hold manager.mutex (see doc comment).
            Platform::remove_watch(manager, self);
        }
        // SAFETY: self was created via PathWatcher::new (Box::into_raw); no other thread
        // can reach it after unlink + remove_watch above.
        unsafe { Self::destroy(self as *mut Self) };
    }

    /// # Safety
    /// `this` must have been produced by `PathWatcher::new` and have no remaining
    /// references (handlers empty, removed from manager maps).
    unsafe fn destroy(this: *mut PathWatcher) {
        // handlers, platform, path all dropped by Box drop.
        drop(Box::from_raw(this));
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
    // The callback/updateEnd are comptime so the emit path can call them directly
    // without an indirect-call-per-event; assert they're what node_fs_watcher passes.
    // PERF(port): was comptime monomorphization — Zig asserted at compile time.
    debug_assert!(callback as usize == on_path_update_fn as usize);
    debug_assert!(update_end as usize == on_update_end_fn as usize);
    let _ = vm;

    let manager = match PathWatcherManager::get() {
        Err(e) => return Err(e),
        Ok(m) => m,
    };

    // Resolve to a canonical path so `fs.watch("./x")` and `fs.watch("/abs/x")` dedup;
    // FSEvents reports events by realpath so macOS needs this for prefix matching too.
    //
    // Open with O_PATH|O_DIRECTORY first and retry without O_DIRECTORY on ENOTDIR —
    // that tells us file-vs-dir without a separate stat, follows symlinks, and the
    // resulting fd feeds `getFdPath` for the realpath. One or two syscalls instead
    // of lstat + open + (stat) in the old code. `O.PATH` is 0 on macOS (degrades to
    // O_RDONLY, which is what F_GETPATH needs anyway).
    let mut resolve_buf = bun_paths::path_buffer_pool().get();
    let mut is_file = false;
    let probe_fd: Fd = match sys::open(path, sys::O::PATH | sys::O::DIRECTORY | sys::O::CLOEXEC, 0) {
        Ok(f) => f,
        Err(e) => {
            if e.get_errno() == sys::E::NOTDIR {
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
    let _close_probe = scopeguard::guard(probe_fd, |fd| fd.close());
    let resolved: &ZStr = match sys::get_fd_path(probe_fd, &mut *resolve_buf) {
        Err(_) => path, // fall back to the caller's path; best effort
        Ok(r) => {
            let len = r.len();
            resolve_buf[len] = 0;
            // SAFETY: resolve_buf[len] == 0 written above.
            unsafe { ZStr::from_raw(resolve_buf.as_ptr(), len) }
        }
    };

    let mut key_buf = bun_paths::path_buffer_pool().get();
    let key = PathWatcherManager::make_key(&mut *key_buf, resolved.as_bytes(), recursive);

    manager.mutex.lock();

    // SAFETY: holding manager.mutex; exclusive access to manager.watchers.
    let watchers = unsafe {
        &mut *(&manager.watchers as *const _ as *mut StringArrayHashMap<*mut PathWatcher>)
    };
    let gop = watchers.get_or_put(key);
    if gop.found_existing {
        let existing = *gop.value_ptr;
        // SAFETY: existing is a live PathWatcher under manager.mutex.
        unsafe { (*existing).handlers.put(ctx, ChangeEvent::default()) };
        manager.mutex.unlock();
        return Ok(existing);
    }

    // New watcher: own the key and path.
    *gop.key_ptr = Box::<[u8]>::from(key);
    let watcher = PathWatcher::new(PathWatcher {
        manager: Some(manager),
        path: ZStr::from_bytes(resolved.as_bytes()),
        recursive,
        is_file,
        handlers: ArrayHashMap::default(),
        platform: PlatformWatch::default(),
    });
    // SAFETY: watcher just allocated; we hold the only reference.
    unsafe { (*watcher).handlers.put(ctx, ChangeEvent::default()) };
    *gop.value_ptr = watcher;

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
                w.emit_error(err);
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
/// subdirectory just stops that branch (matches Node). Uses `bun.sys` /
/// `bun.DirIterator` / `bun.path` throughout; no std.fs.
// PORT NOTE: ctx+comptime cb collapsed to FnMut closure (same monomorphization).
fn walk_subtree<const DIRS_ONLY: bool>(
    abs_dir: &ZStr,
    rel_dir: &[u8],
    cb: &mut impl FnMut(&ZStr, &[u8], bool),
) {
    let dfd = match sys::open(abs_dir, sys::O::RDONLY | sys::O::DIRECTORY | sys::O::CLOEXEC, 0) {
        Err(_) => return,
        Ok(f) => f,
    };
    let _close = scopeguard::guard(dfd, |f| f.close());
    let mut it = sys::DirIterator::iterate(dfd, sys::DirIteratorEncoding::U8);
    let mut abs_buf = bun_paths::path_buffer_pool().get();
    let mut rel_buf = bun_paths::path_buffer_pool().get();
    loop {
        let entry = match it.next() {
            Err(_) => return,
            Ok(None) => return,
            Ok(Some(e)) => e,
        };
        let child_is_file = entry.kind != sys::DirEntryKind::Directory;
        if DIRS_ONLY && child_is_file {
            continue;
        }
        let name = entry.name.slice();
        let child_abs =
            path::join_z_buf(&mut *abs_buf, &[abs_dir.as_bytes(), name], path::Style::Posix);
        let child_rel: &[u8] = if rel_dir.is_empty() {
            name
        } else {
            path::join_string_buf(&mut *rel_buf, &[rel_dir, name], path::Style::Posix)
        };
        cb(child_abs, child_rel, child_is_file);
        if !child_is_file {
            walk_subtree::<DIRS_ONLY>(child_abs, child_rel, cb);
        }
    }
}

// Platform dispatch alias (Zig: `const Platform = switch (Environment.os) { ... }`).
#[cfg(target_os = "linux")]
type Platform = Linux;
#[cfg(target_os = "linux")]
type PlatformWatch = LinuxWatch;

#[cfg(target_os = "macos")]
type Platform = Darwin;
#[cfg(target_os = "macos")]
type PlatformWatch = DarwinWatch;

#[cfg(target_os = "freebsd")]
type Platform = Kqueue;
#[cfg(target_os = "freebsd")]
type PlatformWatch = KqueueWatch;

// win_watcher.zig imports PathWatcher.EventType from this file, so this type must
// resolve on Windows even though none of the code paths run. The stub keeps the
// struct fields typed while the actual Windows backend lives in win_watcher.zig.
#[cfg(windows)]
type Platform = WindowsStub;
#[cfg(windows)]
type PlatformWatch = WindowsStubWatch;

// TODO(port): wasm → compile_error!("unsupported")

// ────────────────────────────────────────────────────────────────────────────────
// Linux
// ────────────────────────────────────────────────────────────────────────────────

/// Linux: one inotify fd, one blocking reader thread, wd → {PathWatcher, subpath} map.
/// Recursive watches are implemented by walking the tree at subscribe time and adding
/// a wd per directory, then adding new subdirectories as they appear (IN_CREATE|IN_ISDIR).
#[cfg(target_os = "linux")]
pub struct Linux {
    fd: Fd,
    running: AtomicBool,
    /// wd → list of owners. `inotify_add_watch` returns the same wd for the same
    /// inode on a given inotify fd, so two PathWatchers whose roots overlap (e.g.
    /// a recursive watch on `/a` plus a watch on `/a/sub`) end up sharing a wd. Each
    /// owner gets its own subpath so the event can be reported relative to the right
    /// root, and `inotify_rm_watch` is only issued when the last owner detaches.
    wd_map: HashMap<i32, Vec<WdOwner<'static>>>,
}

#[cfg(target_os = "linux")]
impl Default for Linux {
    fn default() -> Self {
        Self {
            fd: Fd::INVALID,
            running: AtomicBool::new(true),
            wd_map: HashMap::default(),
        }
    }
}

#[cfg(target_os = "linux")]
struct WdOwner<'a> {
    // TODO(port): lifetime — TSV says BORROW_PARAM; stored in long-lived map, compared by ptr.
    watcher: &'a PathWatcher,
    /// Path of the watched directory/file relative to `watcher.path`. Empty for
    /// the root. Owned; freed when this owner is removed from the wd.
    subpath: Box<ZStr>,
}

#[cfg(target_os = "linux")]
#[derive(Default)]
pub struct LinuxWatch {
    /// All wds belonging to this PathWatcher (one for a file/non-recursive dir,
    /// many for a recursive dir).
    wds: Vec<i32>,
}
// Drop: Vec frees automatically.

#[cfg(target_os = "linux")]
mod inotify_masks {
    use bun_sys::linux::IN;
    pub const WATCH_FILE_MASK: u32 = IN::MODIFY | IN::ATTRIB | IN::MOVE_SELF | IN::DELETE_SELF;
    pub const WATCH_DIR_MASK: u32 = IN::MODIFY
        | IN::ATTRIB
        | IN::CREATE
        | IN::DELETE
        | IN::DELETE_SELF
        | IN::MOVED_FROM
        | IN::MOVED_TO
        | IN::MOVE_SELF
        | IN::ONLYDIR;
}

#[cfg(target_os = "linux")]
impl Linux {
    fn init(manager: &mut PathWatcherManager) -> sys::Result<()> {
        use bun_sys::linux::IN;
        let rc = sys::syscall::inotify_init1(IN::CLOEXEC);
        if let Some(err) = sys::errno_sys(rc, Syscall::Watch) {
            return Err(err);
        }
        manager.platform.fd = Fd::from_native(i32::try_from(rc).unwrap());
        // The manager is process-global and never torn down, so the reader thread is
        // a daemon — detach it instead of stashing a handle we'd never join.
        let mgr_ptr = manager as *mut PathWatcherManager as usize;
        match bun_threading::spawn(move || {
            // SAFETY: manager is process-global (&'static), never freed.
            Linux::thread_main(unsafe { &*(mgr_ptr as *const PathWatcherManager) })
        }) {
            Ok(thread) => thread.detach(),
            Err(_) => {
                manager.platform.fd.close();
                return Err(sys::Error {
                    errno: sys::E::NOMEM as _,
                    syscall: Syscall::Watch,
                    ..Default::default()
                });
            }
        }
        Ok(())
    }

    /// Caller holds `manager.mutex`.
    fn add_watch(manager: &'static PathWatcherManager, watcher: &mut PathWatcher) -> sys::Result<()> {
        Linux::add_one(manager, watcher, &watcher.path, b"")?;
        if watcher.recursive && !watcher.is_file {
            Linux::walk_and_add(manager, watcher, &watcher.path.clone(), b"");
            // PORT NOTE: reshaped for borrowck — clone path to avoid &/&mut overlap on watcher.
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
        // SAFETY: caller holds manager.mutex; exclusive access to platform.
        let plat = unsafe { &mut *(&manager.platform as *const _ as *mut Linux) };
        let mask: u32 = if watcher.is_file && subpath.is_empty() {
            inotify_masks::WATCH_FILE_MASK
        } else {
            inotify_masks::WATCH_DIR_MASK
        };
        let rc = sys::syscall::inotify_add_watch(plat.fd.native(), abs_path, mask);
        if let Some(err) = sys::errno_sys_p(rc, Syscall::Watch, abs_path.as_bytes()) {
            // ENOTDIR/ENOENT during a recursive walk just means we raced; skip.
            if !subpath.is_empty() {
                return Ok(());
            }
            return Err(err);
        }
        let wd: i32 = i32::try_from(rc).unwrap();
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
                    o.subpath = ZStr::from_bytes(subpath);
                }
                return Ok(());
            }
        }
        owners.push(WdOwner {
            // SAFETY: watcher outlives its wd entries (removed in remove_watch before destroy).
            watcher: unsafe { &*(watcher as *const PathWatcher) },
            subpath: ZStr::from_bytes(subpath),
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
        // SAFETY: caller holds manager.mutex.
        let plat = unsafe { &mut *(&manager.platform as *const _ as *mut Linux) };
        for &wd in watcher.platform.wds.iter() {
            let Some(owners) = plat.wd_map.get_mut(&wd) else { continue };
            let mut j: usize = 0;
            while j < owners.len() {
                if core::ptr::eq(owners[j].watcher, watcher) {
                    owners.swap_remove(j);
                } else {
                    j += 1;
                }
            }
            if owners.is_empty() {
                plat.wd_map.remove(&wd);
                let _ = sys::syscall::inotify_rm_watch(plat.fd.native(), wd);
            }
        }
        watcher.platform.wds.clear();
    }

    fn thread_main(manager: &'static PathWatcherManager) {
        use bun_sys::linux::IN;
        Output::Source::configure_named_thread("fs.watch");
        // SAFETY: thread owns no other &mut to manager.platform; reads of `fd`/`running`
        // are safe (fd set before spawn; running is atomic). wd_map access below is under
        // manager.mutex.
        let plat = unsafe { &*(&manager.platform as *const Linux) };
        // Large enough for a burst of events; inotify guarantees whole events per read.
        // TODO(port): align(InotifyEvent) — ensure buf alignment for ptr cast below.
        let mut buf = [0u8; 64 * 1024];
        let mut path_buf = PathBuffer::uninit();

        while plat.running.load(Ordering::Acquire) {
            let rc = sys::syscall::read(plat.fd.native(), buf.as_mut_ptr(), buf.len());
            match sys::get_errno(rc) {
                sys::E::SUCCESS => {}
                sys::E::AGAIN | sys::E::INTR => continue,
                errno => {
                    // Fatal: surface to every watcher, then exit the thread.
                    let err = sys::Error {
                        errno: (errno as u32) as _,
                        syscall: Syscall::Read,
                        ..Default::default()
                    };
                    manager.mutex.lock();
                    // SAFETY: holding manager.mutex.
                    let watchers = unsafe {
                        &*(&manager.watchers as *const StringArrayHashMap<*mut PathWatcher>)
                    };
                    for &w in watchers.values() {
                        // SAFETY: holding manager.mutex; w is live.
                        unsafe {
                            (*w).emit_error(err);
                            (*w).flush();
                        }
                    }
                    manager.mutex.unlock();
                    return;
                }
            }
            let n: usize = usize::try_from(rc).unwrap();
            if n == 0 {
                continue;
            }

            manager.mutex.lock();
            // SAFETY: holding manager.mutex.
            let plat_mut = unsafe { &mut *(&manager.platform as *const _ as *mut Linux) };
            // Track which PathWatchers got at least one event so we flush() each once.
            let mut touched: ArrayHashMap<*mut PathWatcher, ()> = ArrayHashMap::default();

            let mut i: usize = 0;
            while i < n {
                // SAFETY: inotify guarantees whole events; buf[i..] starts at an event header.
                let ev: &InotifyEvent =
                    unsafe { &*(buf.as_ptr().add(i) as *const InotifyEvent) };
                i += core::mem::size_of::<InotifyEvent>() + ev.name_len as usize;
                let wd = ev.watch_descriptor;

                // Kernel retired this wd (rm_watch, or the watched inode is gone).
                if ev.mask & IN::IGNORED != 0 {
                    if let Some(owners) = plat_mut.wd_map.get_mut(&wd) {
                        for o in owners.drain(..) {
                            // SAFETY: o.watcher live under manager.mutex.
                            let w = unsafe {
                                &mut *(o.watcher as *const PathWatcher as *mut PathWatcher)
                            };
                            if let Some(idx) = w.platform.wds.iter().position(|&x| x == wd) {
                                w.platform.wds.swap_remove(idx);
                            }
                        }
                        plat_mut.wd_map.remove(&wd);
                    }
                    continue;
                }

                if plat_mut.wd_map.get(&wd).is_none() {
                    continue;
                }

                let name: &[u8] = if ev.name_len > 0 {
                    // SAFETY: i was just advanced past this event's name_len bytes; offset is within buf[0..n].
                    let name_ptr = unsafe { buf.as_ptr().add(i - ev.name_len as usize) };
                    // SAFETY: kernel NUL-pads name within name_len bytes.
                    unsafe { core::ffi::CStr::from_ptr(name_ptr as *const _).to_bytes() }
                } else {
                    b""
                };

                let is_dir_child = ev.mask & IN::ISDIR != 0;
                let event_type: EventType = if ev.mask
                    & (IN::CREATE | IN::DELETE | IN::DELETE_SELF | IN::MOVE_SELF | IN::MOVED_FROM | IN::MOVED_TO)
                    != 0
                {
                    EventType::Rename
                } else {
                    EventType::Change
                };

                // Dispatch to every owner of this wd. The recursive branch below calls
                // `addOne`/`walkAndAdd`, which insert into `wd_map` via `getOrPut` and
                // may rehash — that would invalidate any pointer into the map's value
                // storage. Re-fetch the owners list by key each iteration rather than
                // caching `getPtr(wd)` across the loop.
                let mut oi: usize = 0;
                loop {
                    let Some(owners) = plat_mut.wd_map.get(&wd) else { break };
                    if oi >= owners.len() {
                        break;
                    }
                    let owner_watcher = owners[oi].watcher as *const PathWatcher as *mut PathWatcher;
                    let owner_subpath = owners[oi].subpath.as_bytes();
                    // `owner.subpath` is heap-owned by the entry and stays valid across a
                    // rehash (only the ArrayList header moves), so copying it out here is
                    // not required.
                    // SAFETY: owner_watcher live under manager.mutex.
                    let watcher = unsafe { &mut *owner_watcher };

                    // Build the path relative to this owner's root.
                    let rel: &[u8] = if watcher.is_file {
                        path::basename(watcher.path.as_bytes())
                    } else if owner_subpath.is_empty() {
                        name
                    } else if name.is_empty() {
                        owner_subpath
                    } else {
                        path::join_string_buf(
                            &mut path_buf,
                            &[owner_subpath, name],
                            path::Style::Posix,
                        )
                    };

                    watcher.emit(
                        event_type,
                        rel,
                        !is_dir_child
                            && !((ev.mask & (IN::DELETE_SELF | IN::MOVE_SELF) != 0)
                                && !watcher.is_file),
                    );
                    let _ = touched.get_or_put(owner_watcher);

                    // Recursive: a new directory appeared under this owner's tree —
                    // start watching it so future events inside it are delivered.
                    // This is what makes `{recursive: true}` track structure changes
                    // after the initial crawl (#15939/#15085).
                    if watcher.recursive
                        && is_dir_child
                        && (ev.mask & (IN::CREATE | IN::MOVED_TO) != 0)
                        && !name.is_empty()
                    {
                        let mut abs_buf = bun_paths::path_buffer_pool().get();
                        let child_abs = path::join_z_buf(
                            &mut *abs_buf,
                            &[watcher.path.as_bytes(), owner_subpath, name],
                            path::Style::Posix,
                        );
                        // These may rehash `wd_map`; `owners` is re-fetched next iteration.
                        let _ = Linux::add_one(manager, watcher, child_abs, rel);
                        Linux::walk_and_add(manager, watcher, child_abs, rel);
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
#[cfg(target_os = "linux")]
use bun_watcher::inotify_watcher::Event as InotifyEvent;
// TODO(port): exact crate path for src/watcher/INotifyWatcher.zig::Event

// ────────────────────────────────────────────────────────────────────────────────
// Darwin
// ────────────────────────────────────────────────────────────────────────────────

/// macOS: delegate to `fs_events.zig`, which already runs one CFRunLoop thread with
/// one FSEventStream covering every watched path. The PathWatcher itself is the
/// FSEventsWatcher's opaque ctx — `fs_events.zig` calls back via `onFSEvent` below,
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
pub struct DarwinWatch {
    fsevents: Option<Box<fsevents::FSEventsWatcher>>,
}
// Drop: Option<Box<_>> drops automatically (FSEventsWatcher::drop runs deinit).

#[cfg(target_os = "macos")]
impl Darwin {
    fn init(_: &mut PathWatcherManager) -> sys::Result<()> {
        Ok(())
    }

    /// Caller does NOT hold `manager.mutex` — `FSEvents.watch()` takes the FSEvents
    /// loop mutex, and the CF thread holds that while calling `onFSEvent` (which
    /// takes `manager.mutex`). Keeping this call outside `manager.mutex` makes the
    /// lock order one-way: fsevents_loop.mutex → manager.mutex.
    fn add_watch(_: &'static PathWatcherManager, watcher: &mut PathWatcher) -> sys::Result<()> {
        match fsevents::watch(
            &watcher.path,
            watcher.recursive,
            Darwin::on_fs_event,
            Darwin::on_fs_event_flush,
            watcher as *mut PathWatcher as *mut c_void,
        ) {
            Ok(fse) => {
                watcher.platform.fsevents = Some(fse);
                Ok(())
            }
            Err(e) => Err(sys::Error {
                errno: match e {
                    // TODO(port): match exact fsevents error variant name
                    fsevents::Error::FailedToCreateCoreFoudationSourceLoop => sys::E::INVAL as _,
                    _ => sys::E::NOMEM as _,
                },
                syscall: Syscall::Watch,
                ..Default::default()
            }),
        }
    }

    /// Caller does NOT hold `manager.mutex` (same lock-order reasoning as `addWatch`).
    /// `FSEventsWatcher.deinit()` → `unregisterWatcher()` blocks on the FSEvents loop
    /// mutex, which `_events_cb` holds for the whole dispatch; once this returns no
    /// further `onFSEvent` calls will arrive for `watcher`.
    fn remove_watch(_: &'static PathWatcherManager, watcher: &mut PathWatcher) {
        // Dropping the Box runs FSEventsWatcher::drop (deinit).
        watcher.platform.fsevents.take();
    }

    /// Called from the CFRunLoop thread (`fs_events.zig`'s `_events_cb`) with the
    /// FSEvents loop mutex held. Take `manager.mutex` so iterating `handlers` can't
    /// race with `watch()`/`detach()` mutating it. The JS thread never holds
    /// `manager.mutex` across a call into FSEvents, so this is deadlock-free.
    ///
    /// `watcher` itself is kept alive by the FSEvents loop mutex: `detach()` →
    /// `removeWatch()` → `fse.deinit()` → `unregisterWatcher()` blocks until
    /// `_events_cb` releases it, so `destroy()` cannot run under us. The
    /// `watcher.manager == null` check catches the window where detach has already
    /// unlinked us but hasn't yet called `fse.deinit()`.
    fn on_fs_event(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
        // SAFETY: ctx is the *mut PathWatcher passed in add_watch above.
        let watcher: &mut PathWatcher = unsafe { &mut *(ctx.unwrap() as *mut PathWatcher) };
        // SAFETY: read of DEFAULT_MANAGER after init is published; manager never freed.
        let Some(manager) = (unsafe { DEFAULT_MANAGER }) else { return };
        manager.mutex.lock();
        let _g = scopeguard::guard((), |_| manager.mutex.unlock());
        if watcher.manager.is_none() {
            return;
        }
        match event {
            Event::Rename(path) => watcher.emit(EventType::Rename, path.as_bytes(), is_file),
            Event::Change(path) => watcher.emit(EventType::Change, path.as_bytes(), is_file),
            Event::Error(err) => watcher.emit_error(err),
            _ => {}
        }
    }

    fn on_fs_event_flush(ctx: Option<*mut c_void>) {
        // SAFETY: ctx is the *mut PathWatcher passed in add_watch above.
        let watcher: &mut PathWatcher = unsafe { &mut *(ctx.unwrap() as *mut PathWatcher) };
        // SAFETY: see on_fs_event.
        let Some(manager) = (unsafe { DEFAULT_MANAGER }) else { return };
        manager.mutex.lock();
        let _g = scopeguard::guard((), |_| manager.mutex.unlock());
        if watcher.manager.is_none() {
            return;
        }
        watcher.flush();
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
pub struct Kqueue {
    kq: Fd,
    running: AtomicBool,
    /// ident (fd number) → entry (by value — avoids a per-entry heap alloc for
    /// recursive trees). `udata` on the kevent carries a monotonic generation number
    /// so the reader can reject stale events after the fd is recycled.
    entries: ArrayHashMap<i32, KqEntry<'static>>,
    /// Bumped on every `addOne` and stored in both `KqEntry.gen` and `kev.udata`.
    next_gen: usize,
}

#[cfg(target_os = "freebsd")]
impl Default for Kqueue {
    fn default() -> Self {
        Self {
            kq: Fd::INVALID,
            running: AtomicBool::new(true),
            entries: ArrayHashMap::default(),
            next_gen: 1,
        }
    }
}

#[cfg(target_os = "freebsd")]
struct KqEntry<'a> {
    // TODO(port): lifetime — TSV says BORROW_PARAM; stored in long-lived map.
    watcher: &'a PathWatcher,
    fd: Fd,
    /// Relative to watcher.path; empty for the root. Owned.
    subpath: Box<ZStr>,
    gen: usize,
    is_file: bool,
}

#[cfg(target_os = "freebsd")]
#[derive(Default)]
pub struct KqueueWatch {
    fds: Vec<i32>,
}
// Drop: Vec frees automatically.

#[cfg(target_os = "freebsd")]
impl Kqueue {
    fn init(manager: &mut PathWatcherManager) -> sys::Result<()> {
        let rc = sys::syscall::kqueue();
        if let Some(err) = sys::errno_sys(rc, Syscall::Kqueue) {
            return Err(err);
        }
        manager.platform.kq = Fd::from_native(rc);
        // Daemon reader — the manager is process-global and never torn down.
        let mgr_ptr = manager as *mut PathWatcherManager as usize;
        match bun_threading::spawn(move || {
            // SAFETY: manager is process-global (&'static), never freed.
            Kqueue::thread_main(unsafe { &*(mgr_ptr as *const PathWatcherManager) })
        }) {
            Ok(thread) => thread.detach(),
            Err(_) => {
                manager.platform.kq.close();
                return Err(sys::Error {
                    errno: sys::E::NOMEM as _,
                    syscall: Syscall::Watch,
                    ..Default::default()
                });
            }
        }
        Ok(())
    }

    /// Caller holds `manager.mutex`.
    fn add_watch(manager: &'static PathWatcherManager, watcher: &mut PathWatcher) -> sys::Result<()> {
        Kqueue::add_one(manager, watcher, &watcher.path, b"", watcher.is_file)?;
        if watcher.recursive && !watcher.is_file {
            // kqueue needs an open fd per *file* as well as per directory.
            // PORT NOTE: reshaped for borrowck — clone path to avoid &/&mut overlap.
            let root = watcher.path.clone();
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
        use bun_sys::c::{Kevent, EV, EVFILT, NOTE};
        // SAFETY: caller holds manager.mutex.
        let plat = unsafe { &mut *(&manager.platform as *const _ as *mut Kqueue) };
        // O_EVTONLY: we only need the fd for kevent registration, never for I/O.
        // (No-op on FreeBSD where EVTONLY is 0; semantic here for kqueue-on-macOS.)
        let fd = match sys::open(abs_path, sys::O::EVTONLY | sys::O::RDONLY | sys::O::CLOEXEC, 0) {
            Err(e) => {
                if !subpath.is_empty() {
                    return Ok(()); // best-effort on children
                }
                return Err(e.without_path());
            }
            Ok(f) => f,
        };

        let gen = plat.next_gen;
        plat.next_gen = plat.next_gen.wrapping_add(1);

        // SAFETY: all-zero is a valid Kevent (#[repr(C)] POD).
        let mut kev: Kevent = unsafe { core::mem::zeroed() };
        kev.ident = usize::try_from(fd.native()).unwrap();
        kev.filter = EVFILT::VNODE;
        kev.flags = EV::ADD | EV::CLEAR | EV::ENABLE;
        kev.fflags =
            NOTE::WRITE | NOTE::DELETE | NOTE::RENAME | NOTE::EXTEND | NOTE::ATTRIB | NOTE::LINK | NOTE::REVOKE;
        kev.udata = gen;
        let mut changes = [kev];
        let krc = sys::syscall::kevent(plat.kq.native(), changes.as_mut_ptr(), 1, changes.as_mut_ptr(), 0, core::ptr::null());
        if krc < 0 {
            // Registration failed (ENOMEM/EINVAL on a bad fd, etc.). Don't leave a
            // dead entry in the map that will never deliver events.
            let errno = sys::get_errno(krc);
            fd.close();
            if !subpath.is_empty() {
                return Ok(()); // best-effort on children
            }
            return Err(sys::Error {
                errno: (errno as u32) as _,
                syscall: Syscall::Kevent,
                ..Default::default()
            });
        }

        plat.entries.put(
            i32::try_from(fd.native()).unwrap(),
            KqEntry {
                // SAFETY: watcher outlives its kqueue entries (removed before destroy).
                watcher: unsafe { &*(watcher as *const PathWatcher) },
                fd,
                subpath: ZStr::from_bytes(subpath),
                gen,
                is_file,
            },
        );
        watcher.platform.fds.push(i32::try_from(fd.native()).unwrap());
        Ok(())
    }

    /// Caller holds `manager.mutex`.
    fn remove_watch(manager: &'static PathWatcherManager, watcher: &mut PathWatcher) {
        // SAFETY: caller holds manager.mutex.
        let plat = unsafe { &mut *(&manager.platform as *const _ as *mut Kqueue) };
        for &ident in watcher.platform.fds.iter() {
            if let Some(kv) = plat.entries.fetch_swap_remove(&ident) {
                // Closing the fd auto-removes the kevent.
                kv.value.fd.close();
                // kv.value.subpath dropped here.
            }
        }
        watcher.platform.fds.clear();
    }

    fn thread_main(manager: &'static PathWatcherManager) {
        use bun_sys::c::{Kevent, NOTE};
        Output::Source::configure_named_thread("fs.watch");
        // SAFETY: see Linux::thread_main.
        let plat = unsafe { &*(&manager.platform as *const Kqueue) };
        // SAFETY: Kevent is POD; uninitialized array filled by kernel before read.
        let mut events: [Kevent; 128] = unsafe { core::mem::zeroed() };
        while plat.running.load(Ordering::Acquire) {
            let count = sys::syscall::kevent(
                plat.kq.native(),
                events.as_mut_ptr(),
                0,
                events.as_mut_ptr(),
                events.len() as _,
                core::ptr::null(),
            );
            if count <= 0 {
                continue;
            }

            manager.mutex.lock();
            // SAFETY: holding manager.mutex.
            let plat_mut = unsafe { &mut *(&manager.platform as *const _ as *mut Kqueue) };
            let mut touched: ArrayHashMap<*mut PathWatcher, ()> = ArrayHashMap::default();

            for kev in &events[..usize::try_from(count).unwrap()] {
                // Validate via the map — the entry may have been freed by a racing
                // removeWatch between kevent() returning and us taking the lock. POSIX
                // recycles the lowest fd on open(), so the ident could also now belong
                // to an *unrelated* watch registered in that same window; `udata` was
                // set to a monotonic generation at registration and survives in the
                // already-delivered event, so compare it to the current entry's gen
                // to reject stale fd-reuse hits.
                let Some(entry) = plat_mut.entries.get(&(i32::try_from(kev.ident).unwrap())) else {
                    continue;
                };
                if entry.gen != kev.udata {
                    continue;
                }
                // SAFETY: entry.watcher live under manager.mutex.
                let watcher =
                    unsafe { &mut *(entry.watcher as *const PathWatcher as *mut PathWatcher) };

                let event_type: EventType = if kev.fflags
                    & (NOTE::DELETE | NOTE::RENAME | NOTE::REVOKE | NOTE::LINK)
                    != 0
                {
                    EventType::Rename
                } else {
                    EventType::Change
                };

                // kqueue has no filenames. For a file watch, report the basename; for a
                // directory, report the subpath (empty for root → caller re-scans).
                let rel: &[u8] = if entry.is_file && entry.subpath.as_bytes().is_empty() {
                    path::basename(watcher.path.as_bytes())
                } else {
                    entry.subpath.as_bytes()
                };

                watcher.emit(event_type, rel, entry.is_file);
                let _ = touched.get_or_put(watcher as *mut PathWatcher);
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

#[cfg(windows)]
#[derive(Default)]
pub struct WindowsStub {}

#[cfg(windows)]
#[derive(Default)]
pub struct WindowsStubWatch {}

#[cfg(windows)]
impl WindowsStub {
    fn init(_: &mut PathWatcherManager) -> sys::Result<()> {
        Err(sys::Error {
            errno: sys::E::NOTSUP as _,
            syscall: Syscall::Watch,
            ..Default::default()
        })
    }
    fn add_watch(_: &'static PathWatcherManager, _: &mut PathWatcher) -> sys::Result<()> {
        Err(sys::Error {
            errno: sys::E::NOTSUP as _,
            syscall: Syscall::Watch,
            ..Default::default()
        })
    }
    fn remove_watch(_: &'static PathWatcherManager, _: &mut PathWatcher) {}
}

// ────────────────────────────────────────────────────────────────────────────────

// Re-exports of the FSWatcher callback fns called directly from emit paths.
#[inline]
fn on_path_update_fn(ctx: Option<*mut c_void>, event: Event, is_file: bool) {
    FSWatcher::on_path_update(ctx, event, is_file)
}
#[inline]
fn on_update_end_fn(ctx: Option<*mut c_void>) {
    FSWatcher::on_update_end(ctx)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/path_watcher.zig (958 lines)
//   confidence: medium
//   todos:      10
//   notes:      manager needs UnsafeCell for mutex-guarded fields; WdOwner/KqEntry &'a lifetime per TSV is awkward for long-lived maps (likely *mut in Phase B); owned ZStr type, DirIterator API, InotifyEvent path, milli_timestamp() all guessed
// ──────────────────────────────────────────────────────────────────────────
