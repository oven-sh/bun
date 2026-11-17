//! Bun's cross-platform filesystem watcher. Runs on its own thread.

use core::fmt;
use std::borrow::Cow;
use std::sync::Arc;

use bun_collections::{BoundedArray, MultiArrayList};
use bun_core::{feature_flags, output as Output, strings, zstr};
use bun_sys::{self as sys, CloseOnDrop, File};
use bun_threading::Guarded;

use crate::watcher_trace as WatcherTrace;

// Android: same kernel inotify ABI as glibc/musl Linux, so list both.
#[cfg(any(target_os = "linux", target_os = "android"))]
use crate::inotify_watcher as platform;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
use crate::kevent_watcher as platform;
#[cfg(windows)]
use crate::windows_watcher as platform;
use bun_collections::index_sort;
#[cfg(any(target_os = "linux", target_os = "android"))]
use platform::watch_loop;
#[cfg(target_arch = "wasm32")]
compile_error!("Unsupported platform");

bun_core::define_scoped_log!(log, watcher, visible);

// ─── constants ────────────────────────────────────────────────────────────

pub const MAX_COUNT: usize = 128;

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub const REQUIRES_FILE_DESCRIPTORS: bool = true;
#[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
pub const REQUIRES_FILE_DESCRIPTORS: bool = false;

/// True if events match watch items by path, so an item keeps working after its file is deleted
/// and recreated.
pub const WATCHES_BY_PATH: bool = cfg!(windows);

/// Open flags for an fd that exists only to receive kqueue VNODE events.
/// Darwin has O_EVTONLY (no read/write access requested); FreeBSD has no
/// equivalent, so the watch fd is a plain O_RDONLY. `O_CLOEXEC` keeps the fd
/// out of the image that `--watch` and `--hot` `execve` into on reload.
#[cfg(target_os = "macos")]
pub const WATCH_OPEN_FLAGS: i32 = libc::O_EVTONLY | bun_sys::O::CLOEXEC;
#[cfg(not(target_os = "macos"))]
pub const WATCH_OPEN_FLAGS: i32 = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC;

pub type Event = WatchEvent;
pub type WatchList = MultiArrayList<WatchItem>;
pub type HashType = u32;
pub type WatchItemIndex = u32;
pub const MAX_EVICTION_COUNT: usize = 8096;
/// The items to stop watching once `on_file_update` returns.
pub type Evictions = BoundedArray<WatchItemIndex, MAX_EVICTION_COUNT>;

const NO_WATCH_ITEM: WatchItemIndex = WatchItemIndex::MAX;

// TODO: some platform-specific behavior is implemented in
// this file instead of the platform-specific file.
// ideally, the constants above can be inlined
pub(crate) type Platform = platform::Platform;

// ─── Watcher ──────────────────────────────────────────────────────────────

/// What the watcher thread shares with the threads that add files.
pub struct Watcher {
    #[cfg(not(windows))]
    pub(crate) platform: Platform,
    #[cfg(windows)]
    pub(crate) port: Arc<std::os::windows::io::OwnedHandle>,
    /// Locked while a `WatcherContext` method runs.
    pub(crate) state: Guarded<State>,
    cwd: &'static [u8],
    /// Cleared when the `OwnedWatcher` drops, polled by `watch_loop`.
    pub(crate) running: bun_core::AtomicCell<bool>,
}

/// Ends the watcher thread when it drops. The context is not called after that.
#[must_use]
pub struct OwnedWatcher(Arc<Watcher>);

impl core::ops::Deref for OwnedWatcher {
    type Target = Arc<Watcher>;
    fn deref(&self) -> &Arc<Watcher> {
        &self.0
    }
}

impl Drop for OwnedWatcher {
    fn drop(&mut self) {
        let _state = self.state.lock();
        self.running.store(false);
        self.wake();
    }
}

pub(crate) struct State {
    pub(crate) watchlist: WatchList,
    evictions: Evictions,
    /// `Some` until `thread_main` takes it.
    thread: Option<Box<WatcherThread>>,
}

/// What only the watcher thread uses.
pub(crate) struct WatcherThread {
    pub(crate) watch_events: [WatchEvent; MAX_COUNT],
    #[cfg(windows)]
    pub(crate) platform: Platform,
    ctx: Box<dyn WatcherContext>,
}

/// Called on the watcher thread, which owns it.
pub trait WatcherContext: Send {
    fn on_file_update(
        &mut self,
        events: &[WatchEvent],
        changed_files: &[&[u8]],
        watchlist: &WatchList,
        evictions: &mut Evictions,
    );
    fn on_error(&mut self, err: sys::Error);
}

impl Watcher {
    /// Does not start the watcher thread.
    pub fn init(
        ctx: Box<dyn WatcherContext>,
        top_level_dir: &'static [u8],
    ) -> Result<OwnedWatcher, crate::Error> {
        let thread = Box::new(WatcherThread {
            watch_events: [WatchEvent::default(); MAX_COUNT],
            #[cfg(windows)]
            platform: Platform::new(top_level_dir)?,
            ctx,
        });
        let this = Arc::new(Watcher {
            #[cfg(not(windows))]
            platform: Platform::new(top_level_dir)?,
            #[cfg(windows)]
            port: Arc::clone(&thread.platform.port),
            state: Guarded::new(State::new(thread)),
            cwd: top_level_dir,
            running: bun_core::AtomicCell::new(true),
        });

        // Initialize trace file if BUN_WATCHER_TRACE env var is set
        WatcherTrace::init();

        Ok(OwnedWatcher(this))
    }

    /// Hands `watch_events[..event_count]` to the trace writer and to `on_file_update`.
    pub(crate) fn dispatch_file_updates(
        &self,
        thread: &mut WatcherThread,
        event_count: usize,
        changed_files: &[&[u8]],
    ) {
        let state = &mut *self.state.lock();
        if !self.running.load() {
            return;
        }
        let events = &thread.watch_events[..event_count];
        WatcherTrace::write_events(&state.watchlist, events, changed_files);
        thread.ctx.on_file_update(
            events,
            changed_files,
            &state.watchlist,
            &mut state.evictions,
        );
        self.flush_evictions(state);
    }

    pub fn start(self: &Arc<Self>) -> Result<(), crate::Error> {
        let spawn = || {
            let this = Arc::clone(self);
            std::thread::Builder::new()
                .name("FileWatcher".into())
                .spawn(move || this.thread_main())
        };
        // A --watch reload execve's and immediately re-enters here; under CI load the first
        // pthread_create can see a transient EAGAIN before the old image's threads are reaped.
        // One short retry covers that without masking real resource exhaustion.
        let handle = spawn().or_else(|first| {
            std::thread::sleep(std::time::Duration::from_millis(10));
            spawn().map_err(|_| first)
        });
        handle.map(drop).map_err(|e| {
            // Windows: raw_os_error() is a Win32 GetLastError() code, so
            // route it through the u32 (Win32Error) mapper rather than
            // from_errno's i64 discriminant-cast path.
            #[cfg(windows)]
            let errno = e
                .raw_os_error()
                .and_then(|c| bun_errno::SystemErrno::init(c as u32))
                .unwrap_or(bun_errno::SystemErrno::EAGAIN);
            #[cfg(not(windows))]
            let errno = e
                .raw_os_error()
                .map(bun_errno::from_errno)
                .unwrap_or(bun_errno::SystemErrno::EAGAIN);
            crate::Error::Sys(errno)
        })
    }

    pub fn get_hash(filepath: &[u8]) -> HashType {
        bun_wyhash::hash(filepath) as HashType
    }

    fn thread_main(&self) {
        Output::Source::configure_named_thread(zstr!("File Watcher"));

        log!("Watcher started");

        let thread = self.state.lock().thread.take();
        let mut thread = thread.expect("a watcher is started once");
        if let Err(err) = watch_loop(self, &mut thread) {
            let _state = self.state.lock();
            if self.running.load() {
                thread.ctx.on_error(err);
            }
        }
        // An idle bundler worker can hold the last `Arc`.
        if !self.running.load() {
            self.state.lock().watchlist.drop_elements();
        }

        Output::flush();
    }

    fn flush_evictions(&self, state: &mut State) {
        let evictions = &mut state.evictions;
        if evictions.is_empty() {
            return;
        }
        let watchlist = &mut state.watchlist;

        // swapRemove messes up the order
        // But, it only messes up the order if any elements in the list appear after the item being removed
        // So if we just sort the list by the biggest index first, that should be fine
        index_sort::sort_slice_by(evictions, |a, b| b.cmp(a));

        let mut last_item = NO_WATCH_ITEM;
        for &item in evictions.iter() {
            // Stale udata from a kevent can point past the compacted watchlist.
            if item == last_item || watchlist.len() <= item as usize {
                continue;
            }
            drop(watchlist.swap_remove(item as usize));

            // swapRemove put a different entry at `item`, but its kqueue registration still
            // carries its old `udata` (= pre-swap index). Rewrite it so subsequent kevents
            // route to the right module; EV_ADD on an existing (ident, filter) replaces in
            // place. See #29524.
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            if let Some(Some(moved)) = watchlist.items_file().get(item as usize) {
                self.add_file_descriptor_to_kqueue_without_checks(moved, item as usize);
            }

            last_item = item;
        }

        evictions.clear();
    }

    /// Register a file descriptor with kqueue on macOS without validation.
    ///
    /// Preconditions (caller must ensure):
    /// - `watchlist_id` matches the entry's index in the watchlist
    ///
    /// Safe to call on an already-registered `file`: `EV_ADD` on an existing
    /// `(ident, filter)` replaces the registration in place, which `flush_evictions`
    /// relies on to rewrite `udata` after `swap_remove`. Adding a
    /// skip-if-registered guard here silently reintroduces #29524.
    ///
    /// Does not propagate kevent registration errors.
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    fn add_file_descriptor_to_kqueue_without_checks(&self, file: &File, watchlist_id: usize) {
        use libc::{EV_ADD, EV_CLEAR, EV_ENABLE, EVFILT_VNODE, kevent as KEvent};
        use libc::{NOTE_DELETE, NOTE_RENAME, NOTE_WRITE};

        // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
        let mut event: KEvent = bun_core::ffi::zeroed();

        event.flags = (EV_ADD | EV_CLEAR | EV_ENABLE) as _;
        // we want to know about the vnode
        event.filter = EVFILT_VNODE as _;

        event.fflags = (NOTE_WRITE | NOTE_RENAME | NOTE_DELETE) as _;

        // id
        event.ident = usize::try_from(file.fd().native()).expect("int cast");

        // Store the index for fast filtering later
        event.udata = watchlist_id as _;

        // This took a lot of work to figure out the right permutation
        // Basically:
        // - We register the event here.
        // our while(true) loop above receives notification of changes to any of the events created here.
        // SAFETY: only `watch_loop_cycle` waits on this kqueue, and it reads `udata` as an index.
        let _ = unsafe { bun_sys::kevent(self.platform.fd.fd(), &[event], &mut [], None) };
    }

    fn append_file_assume_capacity<'a>(
        &self,
        watchlist: &mut WatchList,
        file: Option<CloseOnDrop>,
        file_path: &'a [u8],
        to_static: fn(&'a [u8]) -> Cow<'static, [u8]>,
        hash: HashType,
        parent_hash: HashType,
    ) -> sys::Result<()> {
        #[cfg(windows)]
        {
            // on windows we can only watch items that are in the directory tree of the top level dir
            let rel = bun_paths::resolve_path::is_parent_or_equal(self.top_level_dir(), file_path);
            if rel == bun_paths::resolve_path::ParentEqual::Unrelated {
                bun_core::warn!(
                    "File {} is not in the project directory and will not be watched\n",
                    bstr::BStr::new(file_path)
                );
                return Ok(());
            }
        }

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        if let Some(file) = &file {
            self.add_file_descriptor_to_kqueue_without_checks(file, watchlist.len());
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let eventlist_index = {
            let mut buf = bun_paths::path_buffer_pool::get();
            if file_path.len() >= buf.len() {
                return Err(sys::Error::new(sys::E::ENAMETOOLONG, sys::Tag::watch));
            }
            self.platform
                .watch_path(bun_paths::resolve_path::z(file_path, &mut buf))?
        };

        watchlist.append_assume_capacity(WatchItem {
            file_path: to_static(file_path),
            file,
            hash,
            parent_hash,
            kind: WatchItemKind::File,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            eventlist_index,
        });
        Ok(())
    }

    fn append_directory_assume_capacity<'a>(
        &self,
        watchlist: &mut WatchList,
        file_path: &'a [u8],
        to_static: fn(&'a [u8]) -> Cow<'static, [u8]>,
        hash: HashType,
    ) -> sys::Result<WatchItemIndex> {
        #[cfg(windows)]
        {
            let rel = bun_paths::resolve_path::is_parent_or_equal(self.top_level_dir(), file_path);
            if rel == bun_paths::resolve_path::ParentEqual::Unrelated {
                bun_core::warn!(
                    "Directory {} is not in the project directory and will not be watched\n",
                    bstr::BStr::new(file_path)
                );
                return Ok(NO_WATCH_ITEM);
            }
        }

        #[cfg(not(windows))]
        let dir = CloseOnDrop::new(sys::open_dir_absolute(file_path)?);
        // On Windows `O::DIRECTORY` also asks for `FILE_TRAVERSE`.
        #[cfg(windows)]
        let dir = CloseOnDrop::new(sys::open_a(file_path, sys::O::RDONLY | sys::O::CLOEXEC, 0)?);

        let parent_hash =
            Self::get_hash(bun_paths::fs::PathName::init(file_path).dir_with_trailing_slash());

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        self.add_file_descriptor_to_kqueue_without_checks(&dir, watchlist.len());
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let eventlist_index = {
            let mut buf = bun_paths::path_buffer_pool::get();
            if file_path.len() >= buf.len() {
                return Err(sys::Error::new(sys::E::ENAMETOOLONG, sys::Tag::watch));
            }
            let trimmed = if file_path.len() > 1 {
                strings::trim_right(file_path, &[0, b'/'])
            } else {
                file_path
            };
            let path = bun_paths::resolve_path::z(trimmed, &mut buf);

            self.platform
                .watch_dir(path)
                .map_err(|e| e.with_path(file_path))?
        };

        watchlist.append_assume_capacity(WatchItem {
            file_path: to_static(file_path),
            file: Some(dir),
            hash,
            parent_hash,
            kind: WatchItemKind::Directory,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            eventlist_index,
        });
        Ok((watchlist.len() - 1) as WatchItemIndex)
    }

    // Below is platform-independent

    fn append_file<'a>(
        &self,
        watchlist: &mut WatchList,
        file: Option<CloseOnDrop>,
        file_path: &'a [u8],
        to_static: fn(&'a [u8]) -> Cow<'static, [u8]>,
        hash: HashType,
    ) -> sys::Result<()> {
        debug_assert!(file_path.len() > 1);
        let pathname = bun_paths::fs::PathName::init(file_path);

        let parent_dir = pathname.dir_with_trailing_slash();
        let parent_dir_hash: HashType = Self::get_hash(parent_dir);

        let append_parent_dir = feature_flags::WATCH_DIRECTORIES
            && self.is_eligible_directory(parent_dir)
            && index_of(watchlist, parent_dir_hash).is_none();
        // Abort on OOM:
        // `MultiArrayList::ensure_unused_capacity` returns `Err(AllocError)` on
        // allocation failure (does NOT abort), so discarding it would let the
        // following `append_assume_capacity` write past capacity.
        watchlist
            .ensure_unused_capacity(1 + usize::from(append_parent_dir))
            .unwrap_or_else(|_| bun_core::out_of_memory());

        if append_parent_dir {
            self.append_directory_assume_capacity(
                watchlist,
                parent_dir,
                to_static,
                parent_dir_hash,
            )
            .map_err(|err| err.with_path(parent_dir))?;
        }

        self.append_file_assume_capacity(
            watchlist,
            file,
            file_path,
            to_static,
            hash,
            parent_dir_hash,
        )
        .map_err(|err| err.with_path(file_path))?;

        let cwd_len_with_slash = if self.cwd[self.cwd.len() - 1] == b'/' {
            self.cwd.len()
        } else {
            self.cwd.len() + 1
        };
        let display_path =
            if file_path.len() > cwd_len_with_slash && file_path.starts_with(self.cwd) {
                &file_path[cwd_len_with_slash..]
            } else {
                file_path
            };
        log!(
            "<d>Added <b>{}<r><d> to watch list.<r>",
            bstr::BStr::new(display_path)
        );

        Ok(())
    }

    #[inline]
    fn is_eligible_directory(&self, dir: &[u8]) -> bool {
        strings::contains(dir, self.top_level_dir()) && !strings::contains(dir, b"node_modules")
    }

    #[inline]
    fn top_level_dir(&self) -> &[u8] {
        self.cwd
    }

    pub fn add_directory(&self, file_path: &[u8], hash: HashType) -> sys::Result<WatchItemIndex> {
        self.add_directory_with(file_path, copy_path, hash)
    }

    fn add_directory_with<'a>(
        &self,
        file_path: &'a [u8],
        to_static: fn(&'a [u8]) -> Cow<'static, [u8]>,
        hash: HashType,
    ) -> sys::Result<WatchItemIndex> {
        let watchlist = &mut self.state.lock().watchlist;
        if let Some(idx) = index_of(watchlist, hash) {
            return Ok(idx as WatchItemIndex);
        }
        watchlist
            .ensure_unused_capacity(1)
            .unwrap_or_else(|_| bun_core::out_of_memory());
        self.append_directory_assume_capacity(watchlist, file_path, to_static, hash)
    }

    /// Lazily watch a file by path (slow path).
    ///
    /// This function is used when a file needs to be watched but was not
    /// encountered during the normal import graph traversal. On macOS, it
    /// opens a file descriptor with O_EVTONLY to obtain an inode reference.
    ///
    /// Thread-safe: uses internal locking to prevent race conditions.
    ///
    /// Returns:
    /// - true if the file is successfully added to the watchlist or already watched
    /// - false if the file cannot be opened or added to the watchlist
    pub fn add_file_by_path_slow(&self, file_path: &[u8]) -> bool {
        if file_path.is_empty() {
            return false;
        }
        let hash = Self::get_hash(file_path);

        if index_of(&self.state.lock().watchlist, hash).is_some() {
            return true;
        }

        // Only open fd if we might need it
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        let file = {
            let mut path_z = bun_paths::path_buffer_pool::get();
            if file_path.len() >= path_z.len() {
                return false;
            }
            let z = bun_paths::resolve_path::z(file_path, &mut path_z);
            match File::open(z, WATCH_OPEN_FLAGS, 0) {
                Ok(opened) => Some(opened),
                Err(_) => return false,
            }
        };
        #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
        let file = None;

        self.add_file(file, file_path, hash).is_ok()
    }

    /// Closes `file` unless the watchlist keeps it.
    pub fn add_file(
        &self,
        file: Option<File>,
        file_path: &[u8],
        hash: HashType,
    ) -> sys::Result<()> {
        self.add_file_with(file, file_path, copy_path, hash)
    }

    /// [`Self::add_file`] without the copy of the path.
    pub fn add_file_static(
        &self,
        file: Option<File>,
        file_path: &'static [u8],
        hash: HashType,
    ) -> sys::Result<()> {
        self.add_file_with(file, file_path, Cow::Borrowed, hash)
    }

    fn add_file_with<'a>(
        &self,
        file: Option<File>,
        file_path: &'a [u8],
        to_static: fn(&'a [u8]) -> Cow<'static, [u8]>,
        hash: HashType,
    ) -> sys::Result<()> {
        let file = file.map(CloseOnDrop::from);
        let watchlist = &mut self.state.lock().watchlist;

        if let Some(index) = index_of(watchlist, hash) {
            if feature_flags::ATOMIC_FILE_WATCHER {
                // Upgrade a path-only entry (`add_file_by_path_slow` inserts
                // fd-less, e.g. the `--hot` entrypoint) so `hot_reloader`'s
                // directory-event recovery sees a valid fd. A valid stored fd
                // is never replaced.
                let stored = &mut watchlist.items_file_mut()[index];
                if stored.is_none() {
                    *stored = file;
                }
            }
            return Ok(());
        }

        self.append_file(watchlist, file, file_path, to_static, hash)
    }

    /// Queues `index` for the next `flush_evictions`.
    pub fn remove_at_index(&self, index: WatchItemIndex) {
        debug_assert!(index != NO_WATCH_ITEM);
        self.state.lock().evictions.append_assume_capacity(index);
    }

    pub fn on_maybe_watch_directory(&self, file_path: &'static [u8]) {
        // We don't want to watch:
        // - Directories outside the root directory
        // - Directories inside node_modules
        if !strings::contains(file_path, b"node_modules")
            && strings::contains(file_path, self.top_level_dir())
        {
            let hash = Self::get_hash(file_path);
            let _ = self.add_directory_with(file_path, Cow::Borrowed, hash);
        }
    }
}

impl State {
    fn new(thread: Box<WatcherThread>) -> Self {
        Self {
            watchlist: WatchList::default(),
            evictions: Evictions::new(),
            thread: Some(thread),
        }
    }
}

impl Drop for State {
    fn drop(&mut self) {
        self.watchlist.drop_elements();
    }
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn watch_loop(this: &Watcher, thread: &mut WatcherThread) -> sys::Result<()> {
    while this.running.load() {
        platform::watch_loop_cycle(this, thread)?;
    }
    Ok(())
}

fn index_of(watchlist: &WatchList, hash: HashType) -> Option<usize> {
    watchlist.items_hash().iter().position(|it| *it == hash)
}

fn copy_path(path: &[u8]) -> Cow<'static, [u8]> {
    Cow::Owned(path.to_vec())
}

// ─── WatchEvent ───────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct WatchEvent {
    pub index: WatchItemIndex,
    pub op: Op,
    pub(crate) name_off: u8,
    pub(crate) name_len: u8,
}

impl WatchEvent {
    /// Names of the changed files inside a watched directory. Only inotify reports them.
    pub fn names<'a>(self, buf: &'a [&'a [u8]]) -> &'a [&'a [u8]] {
        if self.name_len == 0 {
            return &[];
        }
        &buf[self.name_off as usize..][..self.name_len as usize]
    }

    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    pub(crate) fn sort_by_index(event: WatchEvent, rhs: WatchEvent) -> core::cmp::Ordering {
        event.index.cmp(&rhs.index)
    }

    pub(crate) fn merge(&mut self, other: WatchEvent) {
        self.name_len += other.name_len;
        self.op = Op::merge(self.op, other.op);
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub struct Op: u8 {
        const DELETE   = 1 << 0;
        const METADATA = 1 << 1;
        const RENAME   = 1 << 2;
        const WRITE    = 1 << 3;
        const MOVE_TO  = 1 << 4;
        const CREATE   = 1 << 5;
        // bits 6..7 = _padding
    }
}

impl Op {
    pub(crate) fn merge(before: Op, after: Op) -> Op {
        before | after
    }
}

/// Lowercase name mapping for `Op` flags (used for trace output).
pub(crate) const OP_NAMES: &[(Op, &str)] = &[
    (Op::DELETE, "delete"),
    (Op::METADATA, "metadata"),
    (Op::RENAME, "rename"),
    (Op::WRITE, "write"),
    (Op::MOVE_TO, "move_to"),
    (Op::CREATE, "create"),
];

impl fmt::Display for Op {
    fn fmt(&self, w: &mut fmt::Formatter<'_>) -> fmt::Result {
        w.write_str("{")?;
        let mut first = true;
        for &(flag, name) in OP_NAMES {
            if self.contains(flag) {
                if !first {
                    w.write_str(",")?;
                }
                first = false;
                w.write_str(name)?;
            }
        }
        w.write_str("}")
    }
}

// ─── WatchItem ────────────────────────────────────────────────────────────

pub struct WatchItem {
    pub file_path: Cow<'static, [u8]>,
    // filepath hash for quick comparison
    pub hash: u32,
    /// Closing it ends a kqueue watch.
    pub file: Option<CloseOnDrop>,
    pub parent_hash: u32,
    pub kind: WatchItemKind,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub eventlist_index: platform::EventListIndex,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WatchItemKind {
    File,
    Directory,
}

/// Typed SoA column accessors — thin safe wrappers over the reflection-backed
/// `MultiArrayList::items::<"name", T>()` so callers don't repeat the type.
pub trait WatchItemColumns {
    fn items_file_path(&self) -> &[Cow<'static, [u8]>];
    fn items_hash(&self) -> &[u32];
    fn items_file(&self) -> &[Option<CloseOnDrop>];
    fn items_file_mut(&mut self) -> &mut [Option<CloseOnDrop>];
    fn items_parent_hash(&self) -> &[u32];
    fn items_kind(&self) -> &[WatchItemKind];
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn items_eventlist_index(&self) -> &[platform::EventListIndex];
}

impl WatchItemColumns for WatchList {
    fn items_file_path(&self) -> &[Cow<'static, [u8]>] {
        self.items::<"file_path", Cow<'static, [u8]>>()
    }
    fn items_hash(&self) -> &[u32] {
        self.items::<"hash", u32>()
    }
    fn items_file(&self) -> &[Option<CloseOnDrop>] {
        self.items::<"file", Option<CloseOnDrop>>()
    }
    fn items_file_mut(&mut self) -> &mut [Option<CloseOnDrop>] {
        self.items_mut::<"file", Option<CloseOnDrop>>()
    }
    fn items_parent_hash(&self) -> &[u32] {
        self.items::<"parent_hash", u32>()
    }
    fn items_kind(&self) -> &[WatchItemKind] {
        self.items::<"kind", WatchItemKind>()
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn items_eventlist_index(&self) -> &[platform::EventListIndex] {
        self.items::<"eventlist_index", platform::EventListIndex>()
    }
}
