//! POSIX backend for `fs.watch()`.
//!
//! This is deliberately independent of `bun.Watcher` (the bundler/--watch/--hot
//! watcher). `bun.Watcher` is shaped around a module graph — its WatchItem carries
//! a filesystem handle, and on Windows is pinned
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

use core::cell::Cell;
use core::ffi::c_void;
use core::ops::{Index, IndexMut};
use std::sync::OnceLock;

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_collections::HashMap;
use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::ZBox;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_core::strings;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_core::{Output, zstr};
use bun_core::{ZStr, handle_oom};
use bun_paths as path;
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_paths::platform;
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_paths::resolve_path::join_z_buf_spill;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
use bun_sys::Fd;
use bun_sys::{self as sys, E, Tag};
use bun_threading::{Guarded, Mutex};
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_watcher::inotify_watcher::EventIterator as InotifyEventIterator;
use bun_wyhash::hash;

use bun_jsc::VirtualMachineRef as VirtualMachine;

use crate::node::node_fs_watcher::{Event, FSWatcher, WatchEventKind};

#[cfg(target_os = "macos")]
use crate::node::fs_events as fsevents;

bun_output::define_scoped_log!(log, fs_watch, hidden);

/// Process-global manager. Created on first `fs.watch()`, never destroyed (matches
/// the FSEvents loop and Windows libuv loop lifetimes).
static DEFAULT_MANAGER: OnceLock<Guarded<PathWatcherManager>> = OnceLock::new();
/// Serializes the fallible init, which a later `get()` retries.
static DEFAULT_MANAGER_MUTEX: Mutex = Mutex::new();

// ────────────────────────────────────────────────────────────────────────────────
// PathWatcherManager
// ────────────────────────────────────────────────────────────────────────────────

pub(crate) struct PathWatcherManager {
    /// Dedup map: dedup key → `WatcherId`. The key is the resolved path with a one-byte
    /// suffix encoding `recursive` (so `fs.watch(p)` and `fs.watch(p, {recursive:true})`
    /// don't share — they want different OS registrations on every platform).
    by_path: StringArrayHashMap<WatcherId>,

    watchers: Watchers,

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    platform: Platform,
}

impl PathWatcherManager {
    fn get() -> sys::Result<&'static Guarded<Self>> {
        let _g = DEFAULT_MANAGER_MUTEX.lock_guard();
        if let Some(m) = DEFAULT_MANAGER.get() {
            return Ok(m);
        }

        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        let platform = Platform::init()?;
        Ok(DEFAULT_MANAGER.get_or_init(|| {
            Guarded::new(Self {
                by_path: StringArrayHashMap::default(),
                watchers: Watchers::default(),
                #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
                platform,
            })
        }))
    }

    /// Build the dedup key into `buf`. Not null-terminated; only used as a hashmap key.
    fn make_key<'a>(buf: &'a mut [u8], resolved_path: &[u8], recursive: bool) -> &'a [u8] {
        buf[..resolved_path.len()].copy_from_slice(resolved_path);
        buf[resolved_path.len()] = if recursive { b'R' } else { b'N' };
        &buf[..resolved_path.len() + 1]
    }
}

/// The slot of a `PathWatcher` in [`Watchers`].
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct WatcherId(u32);

#[derive(Default)]
struct Watchers {
    slots: Vec<Option<PathWatcher>>,
    free_list: Vec<WatcherId>,
}

impl Watchers {
    fn insert(&mut self, watcher: PathWatcher) -> WatcherId {
        if let Some(id) = self.free_list.pop() {
            self.slots[id.0 as usize] = Some(watcher);
            return id;
        }
        self.slots.push(Some(watcher));
        WatcherId((self.slots.len() - 1) as u32)
    }

    fn remove(&mut self, id: WatcherId) -> Option<PathWatcher> {
        let watcher = self.slots[id.0 as usize].take();
        if self.free_list.len() + 1 == self.slots.len() {
            // The last watcher: free both lists.
            *self = Self::default();
        } else {
            self.free_list.push(id);
        }
        watcher
    }
}

impl Index<WatcherId> for Watchers {
    type Output = PathWatcher;

    fn index(&self, id: WatcherId) -> &PathWatcher {
        self.slots[id.0 as usize].as_ref().expect("removed watcher")
    }
}

impl IndexMut<WatcherId> for Watchers {
    fn index_mut(&mut self, id: WatcherId) -> &mut PathWatcher {
        self.slots[id.0 as usize].as_mut().expect("removed watcher")
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// PathWatcher
// ────────────────────────────────────────────────────────────────────────────────

pub(crate) struct PathWatcher {
    /// Canonical absolute path (realpath of the user-supplied path). Owned.
    pub(super) path: ZBox,
    pub(super) recursive: bool,
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    is_file: bool,

    /// JS `FSWatcher` contexts sharing this OS watch. Each gets its own ChangeEvent
    /// for per-handler duplicate suppression (same as `win_watcher.rs`).
    handlers: ArrayHashMap<*mut c_void, ChangeEvent>,

    /// The inotify wds or kqueue fds: one for a file or directory, many for a recursive watch.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    descriptors: Vec<i32>,
}

// SAFETY: a handler is an `FSWatcher`, which detaches under the manager's lock before it is freed.
// While it is attached, that lock serializes the writes to its `pending_events`.
unsafe impl Send for PathWatcher {}

/// What a handler holds until it detaches.
pub(crate) struct Handle(WatcherId);

/// Per-handler duplicate suppression.
///
/// Suppresses only exact duplicates: same path hash *and* same event type
/// within a 1ms window. Distinct files changed in the same millisecond must
/// each emit — node delivers both (see test/js/node/test/parallel
/// fs-watch tests that write two files back-to-back). Kept identical to
/// `win_watcher.rs` so POSIX and Windows agree on which bursts are coalesced.
///
/// Fields are `Cell` so `should_emit` takes `&self` — the emit paths then only
/// ever need shared access to a `PathWatcher`.
#[derive(Default)]
pub(crate) struct ChangeEvent {
    hash: Cell<u64>,
    event_type: Cell<WatchEventKind>,
    timestamp: Cell<i64>,
}

impl ChangeEvent {
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

pub(crate) type Callback = fn(ctx: Option<*mut c_void>, event: Event, is_file: bool);
pub(crate) type UpdateEndCallback = fn(ctx: Option<*mut c_void>);

impl PathWatcher {
    /// `rel_path` is borrowed — `onPathUpdatePosix` dupes it before enqueuing.
    /// `&self`: per-handler state is `Cell`-based, so the emit paths never
    /// need an exclusive `PathWatcher` borrow.
    pub(super) fn emit(&self, event_type: WatchEventKind, rel_path: &[u8], is_file: bool) {
        let timestamp = bun_core::time::milli_timestamp();
        let h = hash(rel_path);
        for (&ctx, ev) in self.handlers.iter() {
            if ev.should_emit(h, timestamp, event_type) {
                (FSWatcher::ON_PATH_UPDATE)(
                    Some(ctx),
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn emit_unsuppressed(&self, event_type: WatchEventKind, rel_path: &[u8], is_file: bool) {
        for &ctx in self.handlers.keys() {
            (FSWatcher::ON_PATH_UPDATE)(Some(ctx), event_type.to_event(rel_path.into()), is_file);
        }
    }

    /// The shared inotify queue overflowed and events were lost; every handler
    /// gets `('change', null)`. No duplicate suppression — a loss signal must
    /// always be delivered.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn emit_overflow(&self) {
        for &ctx in self.handlers.keys() {
            (FSWatcher::ON_PATH_UPDATE)(
                Some(ctx),
                Event::NoFilename(WatchEventKind::Change),
                false,
            );
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    fn emit_error(&self, err: &sys::Error, close: bool) {
        for &ctx in self.handlers.keys() {
            (FSWatcher::ON_PATH_UPDATE)(
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
    pub(super) fn flush(&self) {
        for &ctx in self.handlers.keys() {
            FSWatcher::on_update_end(Some(ctx));
        }
    }

    /// JS-thread entry point from `FSWatcher.detach()`. Removes one handler; if it was
    /// the last, tears down the OS watch and frees.
    pub(crate) fn detach(Handle(id): Handle, ctx: *mut c_void) {
        let mut locked = DEFAULT_MANAGER.wait().lock();
        let manager = &mut *locked;

        let watcher = &mut manager.watchers[id];
        watcher.handlers.swap_remove(&ctx);
        if !watcher.handlers.is_empty() {
            return;
        }

        #[cfg(not(target_os = "macos"))]
        manager.platform.remove_watch(id, watcher);
        if let Some(i) = manager.by_path.values().iter().position(|&w| w == id) {
            manager.by_path.swap_remove_at(i);
        }
        let removed = manager.watchers.remove(id);
        drop(locked);
        drop(removed);

        #[cfg(target_os = "macos")]
        fsevents::reschedule();
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// watch()
// ────────────────────────────────────────────────────────────────────────────────

pub(crate) fn watch(
    vm: &VirtualMachine,
    path: &ZStr,
    recursive: bool,
    callback: Callback,
    update_end: UpdateEndCallback,
    ctx: *mut c_void,
) -> sys::Result<Handle> {
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
    let probe = match sys::open(path, sys::O::PATH | sys::O::DIRECTORY | sys::O::CLOEXEC, 0) {
        Ok(fd) => sys::CloseOnDrop::new(fd),
        Err(e) => {
            if e.get_errno() == E::ENOTDIR {
                is_file = true;
                match sys::open(path, sys::O::PATH | sys::O::CLOEXEC, 0) {
                    Ok(fd) => sys::CloseOnDrop::new(fd),
                    Err(e2) => return Err(e2.without_path()),
                }
            } else {
                return Err(e.without_path());
            }
        }
    };
    // fall back to the caller's path; best effort
    let resolved = sys::get_fd_path_z(probe.fd(), &mut resolve_buf).unwrap_or(path);

    let mut key_buf = path::path_buffer_pool::get();
    let key = PathWatcherManager::make_key(key_buf.as_mut_slice(), resolved.as_bytes(), recursive);

    #[cfg(target_os = "macos")]
    start_fsevents()?;

    let mut locked = manager.lock();
    let manager = &mut *locked;

    if let Some(&existing) = manager.by_path.get(key) {
        let handlers = &mut manager.watchers[existing].handlers;
        handle_oom(handlers.put(ctx, ChangeEvent::default()));
        return Ok(Handle(existing));
    }

    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
    let _ = is_file;
    let mut handlers = ArrayHashMap::default();
    handle_oom(handlers.put(ctx, ChangeEvent::default()));
    let id = manager.watchers.insert(PathWatcher {
        path: ZBox::from_bytes(resolved.as_bytes()),
        recursive,
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        is_file,
        handlers,
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        descriptors: Vec::new(),
    });

    #[cfg(not(target_os = "macos"))]
    if let Err(err) = manager.platform.add_watch(id, &mut manager.watchers[id]) {
        let removed = manager.watchers.remove(id);
        drop(locked);
        drop(removed);
        return Err(err.without_path());
    }
    handle_oom(manager.by_path.put(key, id));

    #[cfg(target_os = "macos")]
    {
        drop(locked);
        fsevents::reschedule();
    }
    Ok(Handle(id))
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
    /// Truncates `abs` and `rel` to the directory's path, then appends `name`. Returns `abs`.
    fn set_entry<'a>(
        abs: &'a mut Vec<u8>,
        rel: &mut Vec<u8>,
        abs_len: usize,
        rel_len: usize,
        name: &[u8],
    ) -> &'a ZStr {
        rel.truncate(rel_len);
        if rel_len != 0 {
            rel.push(path::SEP);
        }
        rel.extend_from_slice(name);
        abs.truncate(abs_len);
        // Only the root directory ends with a separator.
        if abs.last() != Some(&path::SEP) {
            abs.push(path::SEP);
        }
        abs.extend_from_slice(name);
        let len = abs.len();
        abs.push(0);
        ZStr::nul_terminate(abs, len)
    }

    fn open_dir(abs: &ZStr) -> sys::Result<sys::Dir> {
        sys::open(abs, sys::O::RDONLY | sys::O::DIRECTORY | sys::O::CLOEXEC, 0)
            .map(sys::Dir::from_fd)
    }

    /// Reads every entry of `dir`, which is at `self.abs`, so that it is closed before the walk descends.
    #[inline(never)]
    fn read_dir<const DIRS_ONLY: bool>(
        &mut self,
        dir: &sys::Dir,
        cb: &mut impl FnMut(&ZStr, &[u8], bool),
    ) {
        let abs_len = self.abs.len() - 1;
        let rel_len = self.rel.len();
        let start = self.pending.len();
        let mut it = sys::dir_iterator::iterate(dir.fd());
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
                let abs = Self::set_entry(&mut self.abs, &mut self.rel, abs_len, rel_len, name);
                cb(abs, &self.rel, true);
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
    if let Ok(dir) = WalkScratch::open_dir(abs_dir) {
        scratch.read_dir::<DIRS_ONLY>(&dir, cb);
    }
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
        let abs = WalkScratch::set_entry(
            &mut scratch.abs,
            &mut scratch.rel,
            level.abs_len,
            level.rel_len,
            name,
        );
        cb(abs, &scratch.rel, is_file);
        if !is_file && let Ok(dir) = WalkScratch::open_dir(abs) {
            // `cb` already watches this directory, so entries created during the read still get events.
            scratch.read_dir::<DIRS_ONLY>(&dir, cb);
        }
    }
}

// Platform dispatch alias.
// Android uses the same inotify backend as Linux (bionic exposes the same
// `inotify_*` libc surface; the kernel ABI is identical).
#[cfg(any(target_os = "linux", target_os = "android"))]
type Platform = Linux;

#[cfg(target_os = "freebsd")]
type Platform = Kqueue;

#[cfg(target_arch = "wasm32")]
compile_error!("path_watcher: unsupported target");

// ────────────────────────────────────────────────────────────────────────────────
// Linux
// ────────────────────────────────────────────────────────────────────────────────

/// Linux: one inotify fd, one blocking reader thread, wd → {PathWatcher, subpath} map.
/// Recursive watches are implemented by walking the tree at subscribe time and adding
/// a wd per directory, then adding new subdirectories as they appear (IN_CREATE|IN_ISDIR).
#[cfg(any(target_os = "linux", target_os = "android"))]
struct Linux {
    file: sys::CloseOnDrop,
    /// wd → list of owners. `inotify_add_watch` returns the same wd for the same
    /// inode on a given inotify fd, so two PathWatchers whose roots overlap (e.g.
    /// a recursive watch on `/a` plus a watch on `/a/sub`) end up sharing a wd. Each
    /// owner gets its own subpath so the event can be reported relative to the right
    /// root, and `inotify_rm_watch` is only issued when the last owner detaches.
    wd_map: HashMap<i32, Vec<WdOwner>>,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
struct WdOwner {
    watcher: WatcherId,
    /// Path of the watched directory/file relative to `watcher.path`. Empty for
    /// the root. Owned; freed when this owner is removed from the wd.
    subpath: ZBox,
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
    fn init() -> sys::Result<Self> {
        use bun_sys::linux::IN;
        let rc = sys::linux::inotify_init1(IN::CLOEXEC);
        if rc < 0 {
            return Err(sys::Error::from_code_int(sys::last_errno(), Tag::watch));
        }
        let file = sys::CloseOnDrop::new(Fd::from_native(rc));
        let fd = file.fd();
        // Daemon reader — the manager is process-global and never torn down.
        if std::thread::Builder::new()
            .spawn(move || Linux::thread_main(fd))
            .is_err()
        {
            return Err(sys::Error::from_code(E::ENOMEM, Tag::watch));
        }
        Ok(Self {
            file,
            wd_map: HashMap::default(),
        })
    }

    fn add_watch(&mut self, id: WatcherId, watcher: &mut PathWatcher) -> sys::Result<()> {
        let wds = &mut watcher.descriptors;
        self.add_one(id, wds, &watcher.path, b"", watcher.is_file)?;
        if watcher.recursive && !watcher.is_file {
            if let Some(err) = self.walk_and_add(id, wds, &watcher.path) {
                // Partial coverage: emit 'error' but keep the watcher, like node.
                watcher.emit_error(&err, false);
                watcher.flush();
            }
        }
        Ok(())
    }

    /// Add a single inotify watch and record ownership.
    fn add_one(
        &mut self,
        id: WatcherId,
        wds: &mut Vec<i32>,
        abs_path: &ZStr,
        subpath: &[u8],
        is_file: bool,
    ) -> sys::Result<()> {
        let mask: u32 = if is_file {
            inotify_masks::WATCH_FILE_MASK
        } else {
            inotify_masks::WATCH_DIR_MASK
        };
        let rc = sys::linux::inotify_add_watch(self.file.fd().native(), abs_path, mask);
        if rc < 0 {
            let err = sys::Error::from_code_int(sys::last_errno(), Tag::watch);
            // ENOENT/ENOTDIR during a recursive walk just means we raced; skip.
            if !subpath.is_empty() && matches!(err.get_errno(), E::ENOENT | E::ENOTDIR) {
                return Ok(());
            }
            return Err(err.with_path(abs_path.as_bytes()));
        }
        let wd: i32 = rc;
        let owners = self.wd_map.entry(wd).or_default();
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
        wds.push(wd);
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
        &mut self,
        id: WatcherId,
        wds: &mut Vec<i32>,
        root: &ZStr,
    ) -> Option<sys::Error> {
        let mut first_err: Option<sys::Error> = None;
        walk_subtree::<true>(root, b"", &mut |abs, rel, _is_file| {
            if let Err(e) = self.add_one(id, wds, abs, rel, false) {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
        });
        first_err
    }

    /// Only issues `inotify_rm_watch` once a wd has no remaining owners.
    fn remove_watch(&mut self, id: WatcherId, watcher: &PathWatcher) {
        let wd_map = &mut self.wd_map;
        for &wd in &watcher.descriptors {
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
                sys::linux::inotify_rm_watch(self.file.fd().native(), wd);
            }
        }
    }

    fn thread_main(fd: Fd) {
        use bun_sys::linux::IN;
        Output::Source::configure_named_thread(zstr!("fs.watch"));
        let manager = DEFAULT_MANAGER.wait();
        // Large enough for a burst of events; inotify guarantees whole events per read.
        let mut buf: Box<[u8; 64 * 1024]> = bun_core::boxed_zeroed();
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut rel_spill: Vec<u8> = Vec::new();

        loop {
            let rc = sys::linux::read(fd.native(), &mut *buf);
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
                    for w in manager.lock().watchers.slots.iter().flatten() {
                        w.emit_error(&err, true);
                        w.flush();
                    }
                    return;
                }
            }
            let n = rc as usize;
            if n == 0 {
                continue;
            }

            let mut locked = manager.lock();
            let PathWatcherManager {
                by_path,
                watchers,
                platform: plat,
            } = &mut *locked;
            // Track which PathWatchers got at least one event so we flush() each once.
            let mut touched: ArrayHashMap<WatcherId, ()> = ArrayHashMap::default();

            for ev in InotifyEventIterator(&buf[..n]) {
                let wd = ev.watch_descriptor;

                // Queue hit fs.inotify.max_queued_events and the kernel dropped
                // events (wd == -1 matches no watch). Every watcher on this fd
                // is affected — notify all, like node on Windows does.
                if ev.mask & IN::Q_OVERFLOW != 0 {
                    for &w in by_path.values() {
                        watchers[w].emit_overflow();
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
                    let wd_map = &mut plat.wd_map;
                    if let Some(owners) = wd_map.get_mut(&wd) {
                        for o in owners.drain(..) {
                            let w = &mut watchers[o.watcher];
                            if o.subpath.as_bytes().is_empty() && (w.is_file || !w.recursive) {
                                w.emit_unsuppressed(
                                    WatchEventKind::Rename,
                                    path::basename(w.path.as_bytes()),
                                    w.is_file,
                                );
                                let _ = handle_oom(touched.get_or_put(o.watcher));
                            }
                            if let Some(idx) = w.descriptors.iter().position(|&x| x == wd) {
                                w.descriptors.swap_remove(idx);
                            }
                        }
                        wd_map.remove(&wd);
                    }
                    continue;
                }

                if plat.wd_map.get(&wd).is_none() {
                    continue;
                }

                let name: &[u8] = ev.name().unwrap_or_default();

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
                    let (id, owner_subpath) = {
                        let Some(owners) = plat.wd_map.get(&wd) else {
                            break;
                        };
                        if oi >= owners.len() {
                            break;
                        }
                        let o = &owners[oi];
                        (o.watcher, o.subpath.as_bytes())
                    };
                    let watcher = &mut watchers[id];
                    let watcher_path = watcher.path.as_bytes();

                    // Build the path relative to this owner's root.
                    let rel: &[u8] = if watcher.is_file {
                        path::basename(watcher_path)
                    } else if owner_subpath.is_empty() {
                        if name.is_empty() && !watcher.recursive {
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

                    watcher.emit(
                        event_type,
                        rel,
                        !is_dir_child
                            && !((ev.mask & (IN::DELETE_SELF | IN::MOVE_SELF) != 0)
                                && !watcher.is_file),
                    );
                    let _ = handle_oom(touched.get_or_put(id));

                    // Recursive: a new directory appeared under this owner's tree —
                    // start watching it so future events inside it are delivered.
                    // This is what makes `{recursive: true}` track structure changes
                    // after the initial crawl (#15939/#15085).
                    if watcher.recursive
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
                        let mut add_err = plat
                            .add_one(id, &mut watcher.descriptors, child_abs, &rel_owned, false)
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
                                    let wds = &mut watcher.descriptors;
                                    if let Err(e) = plat.add_one(id, wds, abs, entry_rel, false) {
                                        if add_err.is_none() {
                                            add_err = Some(e);
                                        }
                                    }
                                }
                                watcher.emit(WatchEventKind::Rename, entry_rel, entry_is_file);
                            },
                        );
                        if let Some(err) = add_err {
                            watcher.emit_error(&err, false);
                        }
                    }

                    oi += 1;
                }
            }

            for &w in touched.keys() {
                watchers[w].flush();
            }
            drop(locked);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Darwin
// ────────────────────────────────────────────────────────────────────────────────

/// macOS: delegate to `fs_events.rs`, which already runs one CFRunLoop thread with
/// one FSEventStream covering every watched path.
#[cfg(target_os = "macos")]
fn start_fsevents() -> sys::Result<()> {
    fsevents::start().map_err(|e| {
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

#[cfg(target_os = "macos")]
impl PathWatcherManager {
    /// Lock order: `FSEventsLoop::mutex`, then this.
    pub(super) fn lock() -> bun_threading::guarded::GuardedLock<'static, Self, Mutex> {
        DEFAULT_MANAGER.wait().lock()
    }

    pub(super) fn watchers(&self) -> impl Iterator<Item = &PathWatcher> {
        self.watchers.slots.iter().flatten()
    }

    pub(super) fn watcher_count(&self) -> usize {
        self.by_path.len()
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
struct Kqueue {
    file: sys::CloseOnDrop,
    /// ident (fd number) → entry (by value — avoids a per-entry heap alloc for
    /// recursive trees). `udata` on the kevent carries a monotonic generation number
    /// so the reader can reject stale events after the fd is recycled.
    entries: ArrayHashMap<i32, KqEntry>,
    next_gen: usize,
}

#[cfg(target_os = "freebsd")]
struct KqEntry {
    watcher: WatcherId,
    /// Closing it removes the kevent.
    _file: sys::File,
    /// Relative to watcher.path; empty for the root. Owned.
    subpath: ZBox,
    generation: usize,
    is_file: bool,
}

#[cfg(target_os = "freebsd")]
impl Kqueue {
    fn init() -> sys::Result<Self> {
        let file = sys::CloseOnDrop::new(sys::kqueue()?);
        let fd = file.fd();
        // Daemon reader — the manager is process-global and never torn down.
        if std::thread::Builder::new()
            .spawn(move || Kqueue::thread_main(fd))
            .is_err()
        {
            return Err(sys::Error::from_code(E::ENOMEM, Tag::watch));
        }
        Ok(Self {
            file,
            entries: ArrayHashMap::default(),
            next_gen: 1,
        })
    }

    fn add_watch(&mut self, id: WatcherId, watcher: &mut PathWatcher) -> sys::Result<()> {
        let fds = &mut watcher.descriptors;
        self.add_one(id, fds, &watcher.path, b"", watcher.is_file)?;
        if watcher.recursive && !watcher.is_file {
            // kqueue needs an open fd per *file* as well as per directory.
            let mut first_err: Option<sys::Error> = None;
            walk_subtree::<false>(&watcher.path, b"", &mut |abs, rel, is_file| {
                if let Err(e) = self.add_one(id, fds, abs, rel, is_file) {
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
        &mut self,
        id: WatcherId,
        fds: &mut Vec<i32>,
        abs_path: &ZStr,
        subpath: &[u8],
        is_file: bool,
    ) -> sys::Result<()> {
        use bun_sys::freebsd::{EV, EVFILT, Kevent, NOTE};
        // O_EVTONLY: we only need the fd for kevent registration, never for I/O.
        // (No-op on FreeBSD where EVTONLY is 0; semantic here for kqueue-on-macOS.)
        let file = match sys::File::open(
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
        let fd = file.fd();

        let generation = self.next_gen;
        self.next_gen = generation.wrapping_add(1);

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
        // SAFETY: only `thread_main` waits on this kqueue, and it reads `udata` as a number.
        if let Err(err) = unsafe { sys::kevent(self.file.fd(), &[kev], &mut [], None) } {
            // Registration failed (ENOMEM/EINVAL on a bad fd, etc.). Don't leave a
            // dead entry in the map that will never deliver events.
            return Err(sys::Error {
                errno: err.errno,
                syscall: Tag::watch,
                ..Default::default()
            }
            .with_path(abs_path.as_bytes()));
        }

        handle_oom(self.entries.put(
            fd.native() as i32,
            KqEntry {
                watcher: id,
                _file: file,
                subpath: ZBox::from_bytes(subpath),
                generation,
                is_file,
            },
        ));
        fds.push(fd.native() as i32);
        Ok(())
    }

    fn remove_watch(&mut self, _: WatcherId, watcher: &PathWatcher) {
        for ident in &watcher.descriptors {
            self.entries.swap_remove(ident);
        }
    }

    fn thread_main(kq: Fd) {
        use bun_sys::freebsd::{Kevent, NOTE};
        Output::Source::configure_named_thread(zstr!("fs.watch"));
        let manager = DEFAULT_MANAGER.wait();
        // SAFETY: Kevent is POD; uninitialized array filled by kernel before read.
        let mut events: [Kevent; 128] = bun_core::ffi::zeroed();
        loop {
            let Ok(count @ 1..) = sys::kevent_wait(kq, &mut events, None) else {
                continue;
            };

            let locked = manager.lock();
            let watchers = &locked.watchers;
            let entries = &locked.platform.entries;
            let mut touched: ArrayHashMap<WatcherId, ()> = ArrayHashMap::default();

            for kev in &events[..count] {
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
                let watcher = &watchers[entry.watcher];
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
                watchers[w].flush();
            }
            drop(locked);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// Windows stub
// ────────────────────────────────────────────────────────────────────────────────
