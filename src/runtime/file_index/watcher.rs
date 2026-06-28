//! `watch: true` — the live-update layer of `Bun.FileIndex`.
//!
//! One watcher per watching index. The OS event source never touches JSC: it
//! coalesces *relative paths* into a debounced batch (~[`DEBOUNCE_MS`] after
//! the last event in a burst) and hands the owned batch to the JS thread via
//! a `ConcurrentTask` ([`WatchDelivery`]). The JS thread re-`lstat`s each
//! path, applies the result to the `Store`, and only then invokes
//! `onchange` (see `FileIndex::apply_watch_batches`), so a handler that calls
//! `index.stat(path)` observes the new state.
//!
//! # Platform backends
//!
//! - **Linux / Android**: one inotify fd per index and one watch descriptor
//!   per non-ignored directory, owned by a dedicated thread
//!   (`"FileIndexWatch"`) that `poll`s the inotify fd and a wake pipe.
//!   Directories created later are registered from `IN_CREATE|IN_ISDIR`;
//!   `IN_Q_OVERFLOW` degrades to a full re-crawl.
//! - **macOS**: one recursive `FSEventStream` on the root (reusing
//!   `node/fs_events.rs`, which owns the process-wide CFRunLoop thread).
//!   Events arrive on that thread, are filtered against the ignore rules,
//!   and are flushed by this index's `"FileIndexWatch"` debounce thread.
//! - **Windows**: one recursive `uv_fs_event_t` on the JS/libuv loop (the
//!   `node/win_watcher.rs` pattern), filtered on arrival; the
//!   `"FileIndexWatch"` debounce thread only times batches out.
//!
//! # Which paths produce events
//!
//! Only non-ignored directories get an OS watch on Linux, and on every
//! platform an event is dropped unless the nearest indexed ancestor's ignore
//! chain admits the path. The JS thread sends the directory list of each
//! completed crawl ([`WatchHandle::sync`]) and the watcher (re)builds one
//! [`IgnoreChain`] per directory by re-reading that directory's
//! `.gitignore`. Events under ignored directories never fire and, on Linux,
//! never cost a watch descriptor.
//!
//! # Ownership and shutdown
//!
//! The JS thread owns a [`WatchHandle`]; everything the watcher thread and
//! the OS callbacks touch lives in the refcounted [`WatchDelivery`]. The raw
//! `*const FileIndex` inside it is only dereferenced on the JS thread, after
//! checking `detached` (set by `close()` before the index can be torn down).
//! `close()` signals the watcher thread and **joins it** before returning, so
//! no background thread ever outlives the handle.

// Platforms with no backend (FreeBSD) still compile the shared machinery —
// only `platform_start` (which fails) reaches it — so don't flag it there.
#![cfg_attr(
    not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        windows
    )),
    allow(dead_code)
)]

#[cfg(any(target_os = "linux", target_os = "android"))]
use core::ffi::c_int;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use bun_collections::StringHashMap;
use bun_core::handle_oom;
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_ignore::IgnoreChain;
use bun_jsc::ConcurrentTask as concurrent_task;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JsTerminated};
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_sys::{Dir, FdExt as _};
use bun_sys::{Fd, O};
use bun_threading::{Condition, GuardedBy, Mutex};

use super::FileIndex;

bun_core::declare_scope!(file_index_watch, hidden);

/// Quiet window after the last filesystem event before a batch is delivered.
pub(crate) const DEBOUNCE_MS: u64 = 20;
/// A burst that dirties more distinct paths than this between flushes is
/// degraded to one full re-crawl instead of an unbounded per-path batch.
const MAX_DIRTY_PATHS: usize = 65_536;

// ────────────────────────────────────────────────────────────────────────────
// Shared state (JS thread ⇄ watcher thread ⇄ OS event source)
// ────────────────────────────────────────────────────────────────────────────

/// One coalesced, debounced batch handed to the JS thread.
pub(crate) struct Batch {
    /// Sorted, deduplicated dirty paths relative to the root.
    pub paths: Vec<Vec<u8>>,
    /// A `.gitignore` changed (or the event queue overflowed): the JS thread
    /// must schedule a full background re-crawl.
    pub recrawl: bool,
    /// The watcher finished applying a [`WatchHandle::sync`]: every
    /// directory in that crawl is now registered. Posted out of band (not
    /// debounced) so `ready` can resolve only once watching is effective.
    pub synced: bool,
}

/// Dirty-path accumulator + control mailbox. All fields are guarded by
/// [`WatchDelivery::state`]'s mutex.
struct State {
    /// `close()` asked the watcher thread to exit.
    shutdown: bool,
    /// Latest directory list from a completed crawl (root-relative, sorted,
    /// without the root itself), replacing the watcher's registrations.
    sync: Option<Vec<Vec<u8>>>,
    /// Ignore rules in force at the root (`.git/info/exclude` + the user's
    /// `ignore` patterns + the root `.gitignore`), refreshed by every `sync`.
    base_chain: IgnoreChain,
    /// Per-directory ignore chains, keyed by root-relative directory path
    /// (the root itself is `base_chain`, not an entry). Rebuilt on `sync`,
    /// extended for directories discovered live, never pruned between syncs.
    chains: StringHashMap<IgnoreChain>,
    /// Respect `.gitignore` files (`FileIndexOptions.gitignore`).
    gitignore: bool,
    /// Dirty root-relative paths since the last flush. Consecutive
    /// duplicates are suppressed at insert; the flush sorts + dedups.
    dirty: Vec<Vec<u8>>,
    /// Too many distinct paths, an event-queue overflow, or a `.gitignore`
    /// change: ask the JS thread for a full re-crawl.
    recrawl: bool,
    /// Deadline of the running debounce window (`None` = nothing pending).
    deadline: Option<Instant>,
}

impl State {
    fn mark_dirty(&mut self, path: &[u8]) {
        if path.is_empty() {
            return;
        }
        if self.dirty.len() >= MAX_DIRTY_PATHS {
            self.recrawl = true;
        } else if self.dirty.last().is_none_or(|last| last != path) {
            self.dirty.push(path.to_vec());
        }
        self.touch_deadline();
    }

    fn mark_recrawl(&mut self) {
        self.recrawl = true;
        self.touch_deadline();
    }

    fn touch_deadline(&mut self) {
        self.deadline = Some(Instant::now() + Duration::from_millis(DEBOUNCE_MS));
    }

    /// Take the pending batch if its quiet window has elapsed.
    fn take_due(&mut self, now: Instant) -> Option<Batch> {
        let deadline = self.deadline?;
        if now < deadline {
            return None;
        }
        self.deadline = None;
        let mut paths = core::mem::take(&mut self.dirty);
        let recrawl = core::mem::replace(&mut self.recrawl, false);
        paths.sort_unstable();
        paths.dedup();
        Some(Batch {
            paths,
            recrawl,
            synced: false,
        })
    }

    /// Milliseconds until the deadline, or `None` when nothing is pending.
    /// `+1` rounds up so a timed wait never wakes a hair early and spins.
    fn timeout_ms(&self, now: Instant) -> Option<u64> {
        let deadline = self.deadline?;
        Some(deadline.saturating_duration_since(now).as_millis() as u64 + 1)
    }
}

/// Outbox of flushed batches awaiting the JS thread, plus the "is a
/// `ConcurrentTask` already queued" latch.
struct Inbox {
    batches: Vec<Batch>,
    armed: bool,
}

/// The refcounted hub shared by the JS thread, the watcher thread, and the
/// platform event source. This is also the `ConcurrentTask` payload type: an
/// armed delivery owns one `Arc` reference (`Arc::into_raw` at enqueue,
/// `Arc::from_raw` in [`WatchDelivery::run_from_js`]).
pub struct WatchDelivery {
    state: GuardedBy<State, Mutex>,
    /// Wakes the watcher thread when `state` changes. On Linux the wake pipe
    /// is also written, so a `poll` blocked on the inotify fd returns.
    cond: Condition,
    inbox: GuardedBy<Inbox, Mutex>,
    /// Set by `close()` (JS thread) before the `FileIndex` can be collected;
    /// once set, `index` is never dereferenced again.
    detached: AtomicBool,
    /// The JS thread's VM. Only used for `enqueue_task_concurrent`, the
    /// documented cross-thread entry point; the pointee outlives the process.
    vm: *mut VirtualMachine,
    /// The native `FileIndex` this watcher feeds. JS-thread use only, guarded
    /// by `detached`; valid because the wrapper holds itself alive (strong
    /// `JsRef`) from construction until `close()`.
    index: *const FileIndex,
}

impl Taskable for WatchDelivery {
    const TAG: TaskTag = task_tag::FileIndexWatchTask;
}

// SAFETY: every field is either `Send + Sync` by construction (mutex-guarded
// state, `Condition`, `AtomicBool`) or a raw pointer with a documented thread
// contract: `vm` is only passed to `enqueue_task_concurrent` (the documented
// cross-thread entry point) and `index` is only dereferenced on the JS thread
// after the `detached` check.
unsafe impl Send for WatchDelivery {}
// SAFETY: see the `Send` justification above; shared (`&self`) access from
// other threads only goes through the mutexes / the atomic.
unsafe impl Sync for WatchDelivery {}

impl WatchDelivery {
    /// Record a flushed batch and, if no delivery is queued, enqueue one.
    /// Runs on the watcher thread (or, on Windows, the JS thread).
    fn post(self: &Arc<Self>, batch: Batch) {
        if batch.paths.is_empty() && !batch.recrawl && !batch.synced {
            return;
        }
        let arm = {
            let mut inbox = self.inbox.lock();
            inbox.batches.push(batch);
            !core::mem::replace(&mut inbox.armed, true)
        };
        if !arm {
            return;
        }
        let raw = Arc::into_raw(Arc::clone(self)).cast_mut();
        let task = concurrent_task::create_from::<WatchDelivery>(raw);
        // SAFETY: `vm` points at the JS thread's process-lifetime
        // `VirtualMachine`; its concurrent queue is the documented
        // cross-thread entry point (same contract as `CrawlTask`).
        unsafe { (*self.vm).enqueue_task_concurrent(task) };
    }

    /// JS-thread dispatch (`task_tag::FileIndexWatchTask`). Consumes the
    /// `Arc` reference taken out by [`WatchDelivery::post`].
    // `this` is the `Arc::into_raw` pointer; the deref is `Arc::from_raw`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn run_from_js(this: *mut WatchDelivery) -> Result<(), JsTerminated> {
        // SAFETY: `this` came from `Arc::into_raw` in `post`, which armed
        // exactly one delivery; this is its single matching `from_raw`.
        let shared = unsafe { Arc::from_raw(this.cast_const()) };
        let batches = {
            let mut inbox = shared.inbox.lock();
            inbox.armed = false;
            core::mem::take(&mut inbox.batches)
        };
        let vm = VirtualMachine::get();
        if vm.is_shutting_down() || shared.detached.load(Ordering::Acquire) {
            return Ok(());
        }
        // SAFETY: `detached` is false, so `close()` has not run and the
        // wrapper's strong self-reference keeps the `FileIndex` alive; we are
        // on the JS thread, the only place this pointer is dereferenced.
        let index = unsafe { &*shared.index };
        index.apply_watch_batches(vm.global(), batches);
        Ok(())
    }
}

// ────────────────────────────────────────────────────────────────────────────
// The JS-thread handle
// ────────────────────────────────────────────────────────────────────────────

/// The JS thread's owned handle to a running watcher. Dropping it (or calling
/// [`WatchHandle::close`]) stops the OS event source, signals the watcher
/// thread, and joins it.
pub(crate) struct WatchHandle {
    shared: Arc<WatchDelivery>,
    thread: Option<std::thread::JoinHandle<()>>,
    /// Linux: write end of the wake pipe (the read end belongs to the
    /// watcher thread).
    #[cfg(any(target_os = "linux", target_os = "android"))]
    wake_tx: Fd,
    /// macOS: the registered FSEvents stream entry. Dropped (= unregistered,
    /// blocking out any in-flight callback) by `close` before the join.
    #[cfg(target_os = "macos")]
    fsevents: Option<Box<crate::node::fs_events::FSEventsWatcher>>,
    /// macOS: the NUL-terminated root path the `FSEventsWatcher` borrows.
    /// Declared after `fsevents` so it strictly outlives the borrower.
    #[cfg(target_os = "macos")]
    _fsevents_path: Box<[u8]>,
    /// Windows: the heap-allocated `uv_fs_event_t` wrapper, freed by libuv's
    /// close callback (never by this handle).
    #[cfg(windows)]
    uv: *mut windows_impl::UvWatch,
    closed: bool,
}

impl WatchHandle {
    /// Spawn the watcher for `index`. Called from the constructor on the JS
    /// thread; no OS watches are registered until the first [`Self::sync`].
    pub(crate) fn start(
        global: &JSGlobalObject,
        index: &FileIndex,
    ) -> Result<WatchHandle, bun_sys::Error> {
        let gitignore = index.options().gitignore;
        let make_shared = move || WatchDelivery {
            state: GuardedBy::init(State {
                shutdown: false,
                sync: None,
                base_chain: IgnoreChain::empty(),
                chains: StringHashMap::default(),
                gitignore,
                dirty: Vec::new(),
                recrawl: false,
                deadline: None,
            }),
            cond: Condition::new(),
            inbox: GuardedBy::init(Inbox {
                batches: Vec::new(),
                armed: false,
            }),
            detached: AtomicBool::new(false),
            vm: global.bun_vm_ptr(),
            index: core::ptr::from_ref(index),
        };
        platform_start(index, make_shared)
    }

    /// Hand the watcher the directory list from a completed crawl (sorted
    /// ascending, root-relative) and the root-level ignore chain. Replaces
    /// every existing registration. JS thread.
    pub(crate) fn sync(&self, dirs: Vec<Vec<u8>>, base_chain: IgnoreChain) {
        if self.closed {
            return;
        }
        {
            let mut state = self.shared.state.lock();
            state.sync = Some(dirs);
            state.base_chain = base_chain;
        }
        self.wake();
        #[cfg(windows)]
        windows_impl::after_sync(self);
    }

    /// Stop the OS event source, signal the watcher thread, and join it.
    /// Idempotent. JS thread.
    pub(crate) fn close(&mut self) {
        if core::mem::replace(&mut self.closed, true) {
            return;
        }
        // After this store a queued delivery is a no-op, and no new delivery
        // will dereference `index`.
        self.shared.detached.store(true, Ordering::Release);

        // Stop the out-of-thread event sources *before* the join so nothing
        // keeps producing into a dead debounce thread.
        #[cfg(target_os = "macos")]
        {
            // `FSEventsWatcher::drop` unregisters from the FSEvents loop and
            // blocks until any in-flight callback batch completes; only then
            // is its `ctx` reference released.
            if self.fsevents.take().is_some() {
                let raw = Arc::as_ptr(&self.shared);
                // SAFETY: balances the `Arc::into_raw` taken for the (now
                // unregistered) FSEvents callback context in `start`.
                drop(unsafe { Arc::from_raw(raw) });
            }
        }
        #[cfg(windows)]
        windows_impl::stop(self);

        self.shared.state.lock().shutdown = true;
        self.wake();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        self.wake_tx.close();
    }

    fn wake(&self) {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = bun_sys::write(self.wake_tx, b"x");
        }
        self.shared.cond.notify_all();
    }
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        self.close();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Ignore bookkeeping shared by every backend
// ────────────────────────────────────────────────────────────────────────────

/// Parent directory of a root-relative path (`b""` for a top-level entry).
fn parent_dir(rel: &[u8]) -> &[u8] {
    match memchr::memrchr(b'/', rel) {
        Some(i) => &rel[..i],
        None => b"",
    }
}

/// The ignore chain governing the contents of `dir`, or `None` when `dir` is
/// not a known (non-ignored) directory. `b""` is the root.
fn chain_for_dir<'a>(state: &'a State, dir: &[u8]) -> Option<&'a IgnoreChain> {
    if dir.is_empty() {
        return Some(&state.base_chain);
    }
    state.chains.get(dir)
}

/// `<root>/<dir_rel>/.gitignore` appended to `parent` when present and
/// non-empty (and `gitignore` is enabled).
fn append_gitignore(
    root_abs: &[u8],
    parent: &IgnoreChain,
    dir_rel: &[u8],
    gitignore: bool,
) -> IgnoreChain {
    if !gitignore {
        return parent.clone();
    }
    let mut path = Vec::with_capacity(root_abs.len() + dir_rel.len() + 12);
    path.extend_from_slice(root_abs);
    if !dir_rel.is_empty() {
        path.push(b'/');
        path.extend_from_slice(dir_rel);
    }
    path.extend_from_slice(b"/.gitignore");
    let Ok(file) = bun_sys::File::openat(Fd::cwd(), &path, O::RDONLY | O::NOFOLLOW | O::CLOEXEC, 0)
    else {
        return parent.clone();
    };
    let Ok(bytes) = file.read_to_end() else {
        return parent.clone();
    };
    let file = bun_ignore::IgnoreFile::parse(dir_rel, &bytes);
    if file.is_empty() {
        parent.clone()
    } else {
        parent.append(file)
    }
}

/// Rebuild `state.chains` for `dirs` (sorted ascending, so every parent
/// precedes its children) and fold the root `.gitignore` into `base_chain`.
fn rebuild_chains(state: &mut State, root_abs: &[u8], dirs: &[Vec<u8>]) {
    let gitignore = state.gitignore;
    state.chains = StringHashMap::default();
    state.base_chain = append_gitignore(root_abs, &state.base_chain.clone(), b"", gitignore);
    for dir in dirs {
        if dir.is_empty() {
            continue;
        }
        let parent = match chain_for_dir(state, parent_dir(dir)) {
            Some(chain) => chain.clone(),
            // The parent is not registered (it disappeared between the crawl
            // and this sync): skip the orphan.
            None => continue,
        };
        let chain = append_gitignore(root_abs, &parent, dir, gitignore);
        handle_oom(state.chains.put(dir, chain));
    }
}

/// Whether `rel` should be dropped, given the chain of its nearest known
/// ancestor directory. Used by the recursive backends (macOS, Windows),
/// where an event can arrive for a path inside a directory the watcher has
/// not registered yet. Marks `.gitignore` changes for a re-crawl.
#[cfg(any(target_os = "macos", windows))]
fn admit_recursive_event(state: &mut State, rel: &[u8], is_dir_hint: bool) -> bool {
    if rel == b".git" || rel.starts_with(b".git/") {
        return false;
    }
    if state.gitignore && (rel == b".gitignore" || rel.ends_with(b"/.gitignore")) {
        state.mark_recrawl();
    }
    let mut ancestor = parent_dir(rel);
    let chain = loop {
        if let Some(chain) = chain_for_dir(state, ancestor) {
            break chain.clone();
        }
        if ancestor.is_empty() {
            return false;
        }
        ancestor = parent_dir(ancestor);
    };
    !chain.is_ignored(rel, is_dir_hint)
}

/// The debounce loop used by the backends whose events arrive from another
/// thread (macOS CF thread, Windows JS thread): wait out the quiet window,
/// apply `sync` requests, and post due batches.
#[cfg(any(target_os = "macos", windows))]
fn debounce_thread(shared: Arc<WatchDelivery>, root_abs: Vec<u8>) {
    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("FileIndexWatch"));
    loop {
        let due = {
            let mut state = shared.state.lock();
            if state.shutdown {
                return;
            }
            if let Some(dirs) = state.sync.take() {
                rebuild_chains(&mut state, &root_abs, &dirs);
                drop(state);
                shared.post(Batch {
                    paths: Vec::new(),
                    recrawl: false,
                    synced: true,
                });
                continue;
            }
            match state.timeout_ms(Instant::now()) {
                None => {
                    shared.cond.wait_guarded(&mut state);
                    None
                }
                Some(ms) => {
                    let _ = shared
                        .cond
                        .timed_wait_guarded(&mut state, ms.saturating_mul(1_000_000));
                    state.take_due(Instant::now())
                }
            }
        };
        if let Some(batch) = due {
            shared.post(batch);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Other platforms (FreeBSD): no recursive watch primitive is wired up.
// ────────────────────────────────────────────────────────────────────────────

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    windows
)))]
fn platform_start(
    _index: &FileIndex,
    _make_shared: impl FnOnce() -> WatchDelivery,
) -> Result<WatchHandle, bun_sys::Error> {
    // kqueue needs an open fd per watched file; an index-sized recursive
    // watch is not implementable with it. `new Bun.FileIndex(root, { watch:
    // true })` reports the unsupported platform instead of silently never
    // firing.
    Err(bun_sys::Error::from_code(
        bun_sys::E::ENOSYS,
        bun_sys::Tag::watch,
    ))
}

// ────────────────────────────────────────────────────────────────────────────
// Linux / Android: inotify
// ────────────────────────────────────────────────────────────────────────────

#[cfg(any(target_os = "linux", target_os = "android"))]
fn platform_start(
    index: &FileIndex,
    make_shared: impl FnOnce() -> WatchDelivery,
) -> Result<WatchHandle, bun_sys::Error> {
    linux_impl::start(index, make_shared)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux_impl {
    use bun_collections::HashMap;
    use bun_core::ZStr;
    use bun_ignore::Match;
    use bun_sys::linux::IN;
    use bun_watcher::inotify_watcher::Event as InotifyEvent;

    use super::*;

    /// `IN_Q_OVERFLOW` (`linux/inotify.h`); not re-exported by
    /// `bun_sys::linux::IN`. The kernel dropped events: the index can no
    /// longer trust its incremental view and must re-crawl.
    const IN_Q_OVERFLOW: u32 = 0x4000;

    /// Same per-directory mask as `node/path_watcher.rs` (`WATCH_DIR_MASK`).
    const DIR_MASK: u32 = IN::MODIFY
        | IN::ATTRIB
        | IN::CREATE
        | IN::DELETE
        | IN::DELETE_SELF
        | IN::MOVED_FROM
        | IN::MOVED_TO
        | IN::MOVE_SELF
        | IN::ONLYDIR;

    /// Private to the watcher thread.
    struct Backend {
        shared: Arc<WatchDelivery>,
        inotify: Fd,
        wake_rx: Fd,
        /// Absolute index root, no trailing separator.
        root: Vec<u8>,
        /// wd → root-relative directory path (`b""` = the root).
        wd_to_dir: HashMap<c_int, Vec<u8>>,
        /// root-relative directory path → wd.
        dir_to_wd: StringHashMap<c_int>,
        /// `inotify_add_watch` failures since the last sync (typically
        /// `fs.inotify.max_user_watches` exhaustion); logged once per sync.
        add_errors: usize,
    }

    pub(super) fn start(
        index: &FileIndex,
        make_shared: impl FnOnce() -> WatchDelivery,
    ) -> Result<WatchHandle, bun_sys::Error> {
        let rc = bun_sys::linux::inotify_init1(IN::CLOEXEC | IN::NONBLOCK);
        if rc < 0 {
            return Err(bun_sys::Error::from_code_int(
                bun_sys::last_errno(),
                bun_sys::Tag::watch,
            ));
        }
        let inotify = Fd::from_native(rc);
        let [wake_rx, wake_tx] = match bun_sys::pipe() {
            Ok(fds) => fds,
            Err(err) => {
                inotify.close();
                return Err(err);
            }
        };
        let shared = Arc::new(make_shared());
        let backend = Backend {
            shared: Arc::clone(&shared),
            inotify,
            wake_rx,
            root: index.root_bytes().to_vec(),
            wd_to_dir: HashMap::default(),
            dir_to_wd: StringHashMap::default(),
            add_errors: 0,
        };
        let thread = match std::thread::Builder::new()
            .name("FileIndexWatch".to_owned())
            .spawn(move || backend.run())
        {
            Ok(handle) => handle,
            Err(_) => {
                inotify.close();
                wake_rx.close();
                wake_tx.close();
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::ENOMEM,
                    bun_sys::Tag::watch,
                ));
            }
        };
        Ok(WatchHandle {
            shared,
            thread: Some(thread),
            wake_tx,
            closed: false,
        })
    }

    impl Backend {
        fn run(mut self) {
            bun_core::Output::Source::configure_named_thread(bun_core::zstr!("FileIndexWatch"));
            // inotify writes whole events into this; `dispatch_events` reads
            // each header unaligned. Heap-allocated (`vec!`, never a stack
            // temporary) to stay off the thread's stack.
            let mut buf: Box<[u8]> = vec![0u8; 64 * 1024].into_boxed_slice();

            loop {
                let timeout_ms: c_int = {
                    let state = self.shared.state.lock();
                    if state.shutdown {
                        break;
                    }
                    match state.timeout_ms(Instant::now()) {
                        None => -1,
                        Some(ms) => c_int::try_from(ms).unwrap_or(c_int::MAX),
                    }
                };

                let mut fds = [
                    bun_sys::posix::PollFd {
                        fd: self.inotify.native(),
                        events: bun_sys::posix::POLL_IN,
                        revents: 0,
                    },
                    bun_sys::posix::PollFd {
                        fd: self.wake_rx.native(),
                        events: bun_sys::posix::POLL_IN,
                        revents: 0,
                    },
                ];
                if bun_sys::posix::poll(&mut fds, timeout_ms).is_err() {
                    break;
                }
                if fds[1].revents != 0 {
                    // Level-triggered: one read per wakeup is enough; any
                    // leftover bytes just make the next `poll` return.
                    let mut sink = [0u8; 256];
                    let _ = bun_sys::read(self.wake_rx, &mut sink);
                }
                // Re-registration requests are strictly older than anything
                // still queued on the inotify fd (the JS thread sent them
                // before this wakeup): apply them first so queued events are
                // judged by the newest ignore rules.
                self.handle_sync();
                if fds[0].revents != 0 {
                    self.read_inotify(&mut buf);
                }
                let due = {
                    let mut state = self.shared.state.lock();
                    if state.shutdown {
                        break;
                    }
                    state.take_due(Instant::now())
                };
                if let Some(batch) = due {
                    self.shared.post(batch);
                }
            }

            // Closing the inotify fd releases every watch descriptor.
            self.inotify.close();
            self.wake_rx.close();
        }

        /// Apply a pending re-registration request from the JS thread.
        fn handle_sync(&mut self) {
            let dirs = {
                let mut state = self.shared.state.lock();
                if state.shutdown {
                    return;
                }
                match state.sync.take() {
                    Some(dirs) => dirs,
                    None => return,
                }
            };
            self.unregister_all();
            let root = self.root.clone();
            {
                let mut state = self.shared.state.lock();
                rebuild_chains(&mut state, &root, &dirs);
            }
            self.add_watch(&root, b"");
            for dir in &dirs {
                let mut abs = root.clone();
                abs.push(b'/');
                abs.extend_from_slice(dir);
                self.add_watch(&abs, dir);
            }
            self.shared.post(Batch {
                paths: Vec::new(),
                recrawl: false,
                synced: true,
            });
            if self.add_errors > 0 {
                bun_core::scoped_log!(
                    file_index_watch,
                    "inotify_add_watch failed for {} directories (fs.inotify.max_user_watches?)",
                    self.add_errors
                );
                self.add_errors = 0;
            }
        }

        fn unregister_all(&mut self) {
            for (&wd, _) in self.wd_to_dir.iter() {
                bun_sys::linux::inotify_rm_watch(self.inotify.native(), wd);
            }
            self.wd_to_dir = HashMap::default();
            self.dir_to_wd = StringHashMap::default();
        }

        /// Register one directory. `rel` is root-relative (`b""` = root).
        fn add_watch(&mut self, abs: &[u8], rel: &[u8]) {
            let mut abs_z = Vec::with_capacity(abs.len() + 1);
            abs_z.extend_from_slice(abs);
            abs_z.push(0);
            // SAFETY: `abs_z` is NUL-terminated and outlives the call.
            let wd = unsafe {
                bun_sys::linux::inotify_add_watch(
                    self.inotify.native(),
                    abs_z.as_ptr().cast(),
                    DIR_MASK,
                )
            };
            if wd < 0 {
                self.add_errors += 1;
                return;
            }
            // The same inode reuses its wd (e.g. a directory renamed within
            // the tree): drop the stale reverse mapping so later events
            // report the new location.
            if let Some(old) = self.wd_to_dir.insert(wd, rel.to_vec()) {
                self.dir_to_wd.remove(old.as_slice());
            }
            handle_oom(self.dir_to_wd.put(rel, wd));
        }

        fn read_inotify(&mut self, buf: &mut [u8]) {
            // The fd is `IN_NONBLOCK`: read until the queue is drained.
            loop {
                // SAFETY: `buf` is valid for `buf.len()` writable bytes.
                let rc = unsafe {
                    bun_sys::linux::read(self.inotify.native(), buf.as_mut_ptr(), buf.len())
                };
                if rc <= 0 {
                    return;
                }
                self.dispatch_events(&buf[..rc as usize]);
            }
        }

        fn dispatch_events(&mut self, bytes: &[u8]) {
            const HEADER: usize = core::mem::size_of::<InotifyEvent>();
            let mut i = 0usize;
            while i + HEADER <= bytes.len() {
                // SAFETY: `i + HEADER <= bytes.len()` (loop guard), so the
                // whole header is in bounds; `read_unaligned` has no
                // alignment requirement and `Event` is a `repr(C)` POD.
                let ev: InotifyEvent = unsafe {
                    bytes
                        .as_ptr()
                        .add(i)
                        .cast::<InotifyEvent>()
                        .read_unaligned()
                };
                let name_len = ev.name_len as usize;
                if i + HEADER + name_len > bytes.len() {
                    return;
                }
                let name_bytes = &bytes[i + HEADER..i + HEADER + name_len];
                i += HEADER + name_len;
                // The kernel NUL-pads `name` out to `name_len`.
                let name = match memchr::memchr(0, name_bytes) {
                    Some(end) => &name_bytes[..end],
                    None => name_bytes,
                };
                let mask = ev.mask;
                if mask & IN_Q_OVERFLOW != 0 {
                    self.shared.state.lock().mark_recrawl();
                    continue;
                }
                if mask & IN::IGNORED != 0 {
                    if let Some(rel) = self.wd_to_dir.remove(&ev.watch_descriptor) {
                        self.dir_to_wd.remove(rel.as_slice());
                    }
                    continue;
                }
                self.dispatch_one(ev.watch_descriptor, mask, name);
            }
        }

        fn dispatch_one(&mut self, wd: c_int, mask: u32, name: &[u8]) {
            // DELETE_SELF/MOVE_SELF carry no name; the parent's IN_DELETE /
            // IN_MOVED_FROM already marked the directory itself dirty.
            if mask & (IN::DELETE_SELF | IN::MOVE_SELF) != 0 {
                return;
            }
            if name.is_empty() || name == b".git" {
                return;
            }
            let Some(dir_rel) = self.wd_to_dir.get(&wd) else {
                return;
            };
            let mut child = Vec::with_capacity(dir_rel.len() + 1 + name.len());
            if !dir_rel.is_empty() {
                child.extend_from_slice(dir_rel);
                child.push(b'/');
            }
            child.extend_from_slice(name);
            let is_dir = mask & IN::ISDIR != 0;

            {
                let mut state = self.shared.state.lock();
                if state.gitignore && name == b".gitignore" {
                    state.mark_recrawl();
                }
                let verdict = match chain_for_dir(&state, dir_rel) {
                    // The directory was unregistered while events for it
                    // were still queued.
                    None => return,
                    Some(chain) => chain.matches(&child, is_dir),
                };
                if verdict == Match::Ignore {
                    return;
                }
                state.mark_dirty(&child);
            }

            if is_dir && mask & (IN::CREATE | IN::MOVED_TO) != 0 {
                self.register_tree(child);
            } else if is_dir && mask & (IN::DELETE | IN::MOVED_FROM) != 0 {
                self.unregister_under(&child);
            }
        }

        /// A non-ignored directory appeared under a watched directory: watch
        /// it, walk it, watch its non-ignored subdirectories, and mark every
        /// discovered entry dirty (entries created before each watch attached
        /// would otherwise be missed). Iterative: the work list bounds the
        /// stack on adversarially deep trees.
        fn register_tree(&mut self, first: Vec<u8>) {
            let mut work = vec![first];
            while let Some(rel) = work.pop() {
                if self.dir_to_wd.get(rel.as_slice()).is_some() {
                    continue;
                }
                let parent = {
                    let state = self.shared.state.lock();
                    chain_for_dir(&state, parent_dir(&rel)).cloned()
                };
                let Some(parent) = parent else { continue };
                let gitignore = {
                    let state = self.shared.state.lock();
                    state.gitignore
                };
                // `.gitignore` I/O happens outside the state lock.
                let chain = append_gitignore(&self.root, &parent, &rel, gitignore);
                handle_oom(self.shared.state.lock().chains.put(&rel, chain.clone()));

                let mut abs = self.root.clone();
                abs.push(b'/');
                abs.extend_from_slice(&rel);
                self.add_watch(&abs, &rel);
                let Ok(dir) = Dir::open_with(&abs, O::NOFOLLOW | O::CLOEXEC) else {
                    continue;
                };
                let mut iter = bun_sys::iterate_dir(dir.fd());
                let mut name_buf: Vec<u8> = Vec::new();
                loop {
                    let entry = match iter.next() {
                        Ok(Some(entry)) => entry,
                        _ => break,
                    };
                    let name = entry.name.slice_u8();
                    if name == b".git" {
                        continue;
                    }
                    // The iterator's name borrow only lives until the next
                    // `next()`; `lstatat` needs it NUL-terminated.
                    name_buf.clear();
                    name_buf.extend_from_slice(name);
                    name_buf.push(0);
                    let name_z = ZStr::from_buf(&name_buf, name_buf.len() - 1);
                    let Ok(st) = bun_sys::lstatat(dir.fd(), name_z) else {
                        continue;
                    };
                    let stat = bun_sys::PosixStat::init(&st);
                    let is_dir = bun_core::kind_from_mode(stat.mode as bun_core::Mode)
                        == bun_sys::EntryKind::Directory;
                    let name = &name_buf[..name_buf.len() - 1];
                    let mut entry_rel = Vec::with_capacity(rel.len() + 1 + name.len());
                    entry_rel.extend_from_slice(&rel);
                    entry_rel.push(b'/');
                    entry_rel.extend_from_slice(name);
                    if chain.matches(&entry_rel, is_dir) == Match::Ignore {
                        continue;
                    }
                    self.shared.state.lock().mark_dirty(&entry_rel);
                    if is_dir {
                        work.push(entry_rel);
                    }
                }
            }
        }

        /// A watched directory was deleted or moved out of the tree: drop
        /// its watch descriptor and every descendant's. (`IN_IGNORED` also
        /// retires deleted wds; this handles the moved-away case promptly.)
        fn unregister_under(&mut self, rel: &[u8]) {
            let mut prefix = rel.to_vec();
            prefix.push(b'/');
            let doomed: Vec<(c_int, Vec<u8>)> = self
                .wd_to_dir
                .iter()
                .filter(|(_, dir)| dir.as_slice() == rel || dir.starts_with(&prefix))
                .map(|(&wd, dir)| (wd, dir.clone()))
                .collect();
            for (wd, dir) in doomed {
                bun_sys::linux::inotify_rm_watch(self.inotify.native(), wd);
                self.wd_to_dir.remove(&wd);
                self.dir_to_wd.remove(dir.as_slice());
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// macOS: FSEvents + a debounce thread
// ────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn platform_start(
    index: &FileIndex,
    make_shared: impl FnOnce() -> WatchDelivery,
) -> Result<WatchHandle, bun_sys::Error> {
    darwin_impl::start(index, make_shared)
}

#[cfg(target_os = "macos")]
mod darwin_impl {
    use core::ffi::c_void;

    use crate::node::fs_events;
    use crate::node::node_fs_watcher::Event;

    use super::*;

    pub(super) fn start(
        index: &FileIndex,
        make_shared: impl FnOnce() -> WatchDelivery,
    ) -> Result<WatchHandle, bun_sys::Error> {
        let shared = Arc::new(make_shared());
        let thread_shared = Arc::clone(&shared);
        let root_abs = index.root_bytes().to_vec();
        let thread = match std::thread::Builder::new()
            .name("FileIndexWatch".to_owned())
            .spawn(move || debounce_thread(thread_shared, root_abs))
        {
            Ok(handle) => handle,
            Err(_) => {
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::ENOMEM,
                    bun_sys::Tag::watch,
                ));
            }
        };

        // The FSEventsWatcher borrows this NUL-terminated path for its whole
        // lifetime; the handle keeps the allocation alive strictly longer.
        let mut root_z = index.root_bytes().to_vec();
        root_z.push(0);
        let root_z: Box<[u8]> = root_z.into_boxed_slice();
        // The CF callback context is one strong reference, released by
        // `WatchHandle::close` after the stream is unregistered.
        let ctx = Arc::into_raw(Arc::clone(&shared))
            .cast_mut()
            .cast::<c_void>();
        let fsevents = match fs_events::watch(
            &root_z[..root_z.len() - 1],
            true,
            on_fs_event,
            on_fs_flush,
            ctx,
        ) {
            Ok(watcher) => watcher,
            Err(_) => {
                // SAFETY: balances the `Arc::into_raw` above; the stream was
                // never registered so no callback can observe `ctx`.
                drop(unsafe { Arc::from_raw(ctx.cast_const().cast::<WatchDelivery>()) });
                shared.state.lock().shutdown = true;
                shared.cond.notify_all();
                let _ = thread.join();
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::EINVAL,
                    bun_sys::Tag::watch,
                ));
            }
        };
        Ok(WatchHandle {
            shared,
            thread: Some(thread),
            fsevents: Some(fsevents),
            _fsevents_path: root_z,
            closed: false,
        })
    }

    /// Runs on the FSEvents CFRunLoop thread with the FSEvents loop mutex
    /// held. The stream is recursive and rooted at the index root, so the
    /// event path is already root-relative.
    fn on_fs_event(ctx: *mut c_void, event: Event, is_file: bool) {
        // SAFETY: `ctx` is the strong reference taken in `start`;
        // `WatchHandle::close` unregisters the stream (which blocks out this
        // callback) before releasing it.
        let shared: &WatchDelivery = unsafe { &*ctx.cast_const().cast::<WatchDelivery>() };
        let rel: &[u8] = match &event {
            Event::Rename(path) | Event::Change(path) => path,
            _ => return,
        };
        if rel.is_empty() {
            return;
        }
        let mut state = shared.state.lock();
        if admit_recursive_event(&mut state, rel, !is_file) {
            state.mark_dirty(rel);
            drop(state);
            shared.cond.notify_all();
        }
    }

    fn on_fs_flush(_ctx: *mut c_void) {}
}

// ────────────────────────────────────────────────────────────────────────────
// Windows: libuv `uv_fs_event_t` on the JS loop + a debounce thread
// ────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
fn platform_start(
    index: &FileIndex,
    make_shared: impl FnOnce() -> WatchDelivery,
) -> Result<WatchHandle, bun_sys::Error> {
    windows_impl::start(index, make_shared)
}

#[cfg(windows)]
mod windows_impl {
    use core::ffi::{c_char, c_void};
    use core::ptr;

    use bun_sys::windows::libuv as uv;

    use super::*;

    /// Heap-allocated libuv handle wrapper. After `uv_fs_event_init`, libuv
    /// owns the allocation until the close callback runs.
    pub(super) struct UvWatch {
        handle: uv::uv_fs_event_t,
        /// One strong reference, released with the allocation.
        shared: *const WatchDelivery,
        root: Vec<u8>,
        started: bool,
    }

    pub(super) fn start(
        index: &FileIndex,
        make_shared: impl FnOnce() -> WatchDelivery,
    ) -> Result<WatchHandle, bun_sys::Error> {
        let shared = Arc::new(make_shared());
        let thread_shared = Arc::clone(&shared);
        let root_abs = index.root_bytes().to_vec();
        let thread = match std::thread::Builder::new()
            .name("FileIndexWatch".to_owned())
            .spawn(move || debounce_thread(thread_shared, root_abs))
        {
            Ok(handle) => handle,
            Err(_) => {
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::ENOMEM,
                    bun_sys::Tag::watch,
                ));
            }
        };
        let uv_watch = bun_core::heap::into_raw(Box::new(UvWatch {
            // SAFETY: all-zero is the documented pre-`uv_fs_event_init`
            // state for a libuv handle struct.
            handle: unsafe { bun_core::ffi::zeroed_unchecked() },
            shared: Arc::into_raw(Arc::clone(&shared)),
            root: index.root_bytes().to_vec(),
            started: false,
        }));
        Ok(WatchHandle {
            shared,
            thread: Some(thread),
            uv: uv_watch,
            closed: false,
        })
    }

    /// First `sync` after a crawl (JS thread — libuv handles must only be
    /// driven from the loop thread): start the recursive watch.
    pub(super) fn after_sync(handle: &WatchHandle) {
        let this = handle.uv;
        if this.is_null() {
            return;
        }
        // SAFETY: `this` is the live allocation from `start`, owned by the
        // JS thread until `uv_close` hands it to libuv.
        unsafe {
            if (*this).started {
                return;
            }
            let rc = uv::uv_fs_event_init(
                (*handle.shared.vm).uv_loop(),
                ptr::addr_of_mut!((*this).handle),
            );
            if rc != uv::ReturnCode::zero() {
                return;
            }
            (*this).handle.data = this.cast::<c_void>();
            let mut root_z = (*this).root.clone();
            root_z.push(0);
            let rc = uv::uv_fs_event_start(
                ptr::addr_of_mut!((*this).handle),
                Some(uv_event_callback),
                root_z.as_ptr().cast::<c_char>(),
                uv::UV_FS_EVENT_RECURSIVE as u32,
            );
            if rc != uv::ReturnCode::zero() {
                return;
            }
            // The watching index already holds a `KeepAlive` ref on the
            // event loop; the uv handle must not add a second one.
            uv::uv_unref(ptr::addr_of_mut!((*this).handle).cast());
            (*this).started = true;
        }
    }

    /// JS thread (the libuv loop is the JS loop on Windows): filter, mark
    /// dirty, and let the debounce thread time the batch out.
    extern "C" fn uv_event_callback(
        event: *mut uv::uv_fs_event_t,
        filename: *const c_char,
        _events: core::ffi::c_int,
        status: uv::ReturnCode,
    ) {
        if status != uv::ReturnCode::zero() || filename.is_null() {
            return;
        }
        // SAFETY: libuv hands back the handle started in `after_sync`;
        // `data` is the owning `UvWatch`, alive until the close callback.
        let this: &UvWatch = unsafe { &*(*event).data.cast_const().cast::<UvWatch>() };
        // SAFETY: `shared` is the strong reference owned by `UvWatch`.
        let shared: &WatchDelivery = unsafe { &*this.shared };
        if shared.detached.load(Ordering::Acquire) {
            return;
        }
        // SAFETY: libuv passes a NUL-terminated path relative to the root.
        let rel_raw = unsafe { bun_core::ffi::cstr(filename) }.to_bytes();
        if rel_raw.is_empty() {
            return;
        }
        let rel: Vec<u8> = rel_raw
            .iter()
            .map(|&b| if b == b'\\' { b'/' } else { b })
            .collect();
        let mut state = shared.state.lock();
        // libuv does not say whether the path is a directory; admit it if
        // either interpretation is allowed (`is_ignored` only differs for
        // trailing-`/` directory-only patterns).
        if admit_recursive_event(&mut state, &rel, false)
            || admit_recursive_event(&mut state, &rel, true)
        {
            state.mark_dirty(&rel);
            drop(state);
            shared.cond.notify_all();
        }
    }

    /// `close()` (JS thread): stop the uv handle. libuv frees the wrapper
    /// from its close callback once the kernel is done with it.
    pub(super) fn stop(handle: &mut WatchHandle) {
        let this = handle.uv;
        if this.is_null() {
            return;
        }
        handle.uv = ptr::null_mut();
        // SAFETY: `this` is the live allocation from `start`; JS thread.
        unsafe {
            if (*this).started {
                uv::uv_fs_event_stop(ptr::addr_of_mut!((*this).handle));
                uv::uv_close(
                    ptr::addr_of_mut!((*this).handle).cast(),
                    Some(uv_closed_callback),
                );
            } else {
                release(this);
            }
        }
    }

    extern "C" fn uv_closed_callback(handler: *mut uv::uv_handle_t) {
        let event = handler.cast::<uv::uv_fs_event_t>();
        // SAFETY: `data` was set to the owning `UvWatch` before `uv_close`.
        unsafe { release((*event).data.cast::<UvWatch>()) };
    }

    /// # Safety
    /// `this` must be the live `UvWatch` allocation; called exactly once.
    unsafe fn release(this: *mut UvWatch) {
        // SAFETY: caller contract — sole owner.
        let owned = unsafe { bun_core::heap::take(this) };
        // SAFETY: balances the `Arc::into_raw` in `start`.
        drop(unsafe { Arc::from_raw(owned.shared) });
        drop(owned);
    }
}
