//! Bun's cross-platform filesystem watcher. Runs on its own thread.

use core::fmt;
use std::borrow::Cow;
use std::sync::Arc;

use bun_collections::MultiArrayList;
use bun_core::{feature_flags, output as Output, strings, zstr};
use bun_sys::{self as sys, Fd};
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
/// The items to stop watching once `on_file_update` returns.
pub type Evictions = Vec<WatchItemIndex>;

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
    /// Locked while a `WatcherContext` method runs.
    pub(crate) state: Guarded<State>,
    cwd: &'static [u8],
    /// Cleared by `shutdown`, polled by `watch_loop`.
    pub(crate) running: bun_core::AtomicCell<bool>,
}

pub(crate) struct State {
    pub(crate) watchlist: WatchList,
    evictions: Evictions,
    close_descriptors: bool,
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
    ) -> Result<Arc<Watcher>, crate::Error> {
        let this = Arc::new(Watcher {
            #[cfg(not(windows))]
            platform: Platform::new(top_level_dir)?,
            state: Guarded::new(State {
                watchlist: WatchList::default(),
                evictions: Evictions::new(),
                close_descriptors: false,
                thread: Some(Box::new(WatcherThread {
                    watch_events: [WatchEvent::default(); MAX_COUNT],
                    #[cfg(windows)]
                    platform: Platform::new(top_level_dir)?,
                    ctx,
                })),
            }),
            cwd: top_level_dir,
            running: bun_core::AtomicCell::new(true),
        });

        // Initialize trace file if BUN_WATCHER_TRACE env var is set
        WatcherTrace::init();

        Ok(this)
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

    /// The context is not called after this returns. The thread ends when a change next wakes it.
    pub fn shutdown(&self, close_descriptors: bool) {
        let mut state = self.state.lock();
        state.close_descriptors = close_descriptors;
        self.running.store(false);
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

        // Close trace file if open
        WatcherTrace::deinit();

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

        let fds = watchlist.items_fd();
        let fds_len = fds.len();
        let mut last_item = NO_WATCH_ITEM;

        for &item in &*evictions {
            // catch duplicates, since the list is sorted, duplicates will appear right after each other
            if item == last_item {
                continue;
            }
            // Stale udata from a kevent can point past the compacted watchlist; match the second pass's guard.
            if item as usize >= fds_len {
                continue;
            }

            #[cfg(not(windows))]
            {
                // on mac and linux we can just close the file descriptor
                // we don't need to call inotify_rm_watch on linux because it gets removed when the file descriptor is closed
                if fds[item as usize].is_valid() {
                    let _ = bun_sys::close(fds[item as usize]);
                }
            }
            last_item = item;
        }

        last_item = NO_WATCH_ITEM;
        // This is split into two passes because reading the slice while modified is potentially unsafe.
        for item in evictions.drain(..) {
            if item == last_item || watchlist.len() <= item as usize {
                continue;
            }
            // Frees an owned `file_path`; the fd was closed in the first pass.
            drop(watchlist.swap_remove(item as usize));

            // swapRemove put a different entry at `item`, but its kqueue registration still
            // carries its old `udata` (= pre-swap index). Rewrite it so subsequent kevents
            // route to the right module; EV_ADD on an existing (ident, filter) replaces in
            // place. See #29524.
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            {
                if (item as usize) < watchlist.len() {
                    let moved_fd = watchlist.items_fd()[item as usize];
                    if moved_fd.is_valid() {
                        self.add_file_descriptor_to_kqueue_without_checks(moved_fd, item as usize);
                    }
                }
            }

            last_item = item;
        }
    }

    /// Register a file descriptor with kqueue on macOS without validation.
    ///
    /// Preconditions (caller must ensure):
    /// - `fd` is a valid, open file descriptor
    /// - `watchlist_id` matches the entry's index in the watchlist
    ///
    /// Safe to call on an already-registered `fd`: `EV_ADD` on an existing
    /// `(ident, filter)` replaces the registration in place, which `flush_evictions`
    /// relies on to rewrite `udata` after `swap_remove`. Adding a
    /// skip-if-registered guard here silently reintroduces #29524.
    ///
    /// Does not propagate kevent registration errors.
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    fn add_file_descriptor_to_kqueue_without_checks(&self, fd: Fd, watchlist_id: usize) {
        use libc::{EV_ADD, EV_CLEAR, EV_ENABLE, EVFILT_VNODE, kevent as KEvent};
        use libc::{NOTE_DELETE, NOTE_RENAME, NOTE_WRITE};

        // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
        let mut event: KEvent = bun_core::ffi::zeroed();

        event.flags = (EV_ADD | EV_CLEAR | EV_ENABLE) as _;
        // we want to know about the vnode
        event.filter = EVFILT_VNODE as _;

        event.fflags = (NOTE_WRITE | NOTE_RENAME | NOTE_DELETE) as _;

        // id
        event.ident = usize::try_from(fd.native()).expect("int cast");

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
        fd: Fd,
        file_path: &'a [u8],
        to_static: impl Fn(&'a [u8]) -> Cow<'static, [u8]> + Copy,
        hash: HashType,
        parent_hash: HashType,
    ) -> sys::Result<FdOwnership> {
        #[cfg(windows)]
        {
            // on windows we can only watch items that are in the directory tree of the top level dir
            let rel = bun_paths::resolve_path::is_parent_or_equal(self.top_level_dir(), file_path);
            if rel == bun_paths::resolve_path::ParentEqual::Unrelated {
                bun_core::warn!(
                    "File {} is not in the project directory and will not be watched\n",
                    bstr::BStr::new(file_path)
                );
                return Ok(FdOwnership::Caller);
            }
        }

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        let watchlist_id = watchlist.len();

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        self.add_file_descriptor_to_kqueue_without_checks(fd, watchlist_id);
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
            fd,
            hash,
            parent_hash,
            kind: WatchItemKind::File,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            eventlist_index,
        });
        Ok(FdOwnership::Watcher)
    }

    fn append_directory_assume_capacity<'a>(
        &self,
        watchlist: &mut WatchList,
        stored_fd: Fd,
        file_path: &'a [u8],
        to_static: impl Fn(&'a [u8]) -> Cow<'static, [u8]> + Copy,
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

        let fd = if stored_fd.is_valid() {
            stored_fd
        } else {
            bun_sys::open_a(file_path, bun_sys::O::RDONLY | bun_sys::O::CLOEXEC, 0)?
        };

        let parent_hash = Self::get_hash(
            bun_paths::fs::PathName::init(file_path).dir_with_trailing_slash(file_path),
        );

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        let watchlist_id = watchlist.len();

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        self.add_file_descriptor_to_kqueue_without_checks(fd, watchlist_id);
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
            fd,
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
        fd: Fd,
        file_path: &'a [u8],
        to_static: impl Fn(&'a [u8]) -> Cow<'static, [u8]> + Copy,
        hash: HashType,
        dir_fd: Fd,
    ) -> sys::Result<FdOwnership> {
        debug_assert!(file_path.len() > 1);
        let pathname = bun_paths::fs::PathName::init(file_path);

        let parent_dir = pathname.dir_with_trailing_slash(file_path);
        let parent_dir_hash: HashType = Self::get_hash(parent_dir);

        let mut parent_watch_item: Option<WatchItemIndex> = None;
        let autowatch_parent_dir =
            feature_flags::WATCH_DIRECTORIES && self.is_eligible_directory(parent_dir);
        if autowatch_parent_dir {
            if dir_fd.is_valid() {
                let fds = watchlist.items_fd();
                if let Some(i) = fds.iter().position(|f| *f == dir_fd) {
                    parent_watch_item = Some(i as WatchItemIndex);
                }
            }

            if parent_watch_item.is_none() {
                let hashes = watchlist.items_hash();
                if let Some(i) = hashes.iter().position(|h| *h == parent_dir_hash) {
                    parent_watch_item = Some(i as WatchItemIndex);
                }
            }
        }
        // Abort on OOM:
        // `MultiArrayList::ensure_unused_capacity` returns `Err(AllocError)` on
        // allocation failure (does NOT abort), so discarding it would let the
        // following `append_assume_capacity` write past capacity.
        watchlist
            .ensure_unused_capacity(1 + usize::from(parent_watch_item.is_none()))
            .unwrap_or_else(|_| bun_core::out_of_memory());

        if autowatch_parent_dir {
            parent_watch_item = Some(match parent_watch_item {
                Some(v) => v,
                None => match self.append_directory_assume_capacity(
                    watchlist,
                    dir_fd,
                    parent_dir,
                    to_static,
                    parent_dir_hash,
                ) {
                    Err(err) => {
                        return Err(err.with_path(parent_dir));
                    }
                    Ok(r) => r,
                },
            });
        }
        let _ = parent_watch_item;

        match self.append_file_assume_capacity(
            watchlist,
            fd,
            file_path,
            to_static,
            hash,
            parent_dir_hash,
        ) {
            Err(err) => {
                return Err(err.with_path(file_path));
            }
            // Not appended (e.g. outside the project root on Windows); the
            // caller keeps the descriptor.
            Ok(FdOwnership::Caller) => return Ok(FdOwnership::Caller),
            Ok(FdOwnership::Watcher) => {}
        }

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

        Ok(FdOwnership::Watcher)
    }

    #[inline]
    fn is_eligible_directory(&self, dir: &[u8]) -> bool {
        strings::contains(dir, self.top_level_dir()) && !strings::contains(dir, b"node_modules")
    }

    #[inline]
    fn top_level_dir(&self) -> &[u8] {
        self.cwd
    }

    pub fn add_directory(
        &self,
        fd: Fd,
        file_path: &[u8],
        hash: HashType,
    ) -> sys::Result<WatchItemIndex> {
        self.add_directory_with(fd, file_path, copy_path, hash)
    }

    fn add_directory_with<'a>(
        &self,
        fd: Fd,
        file_path: &'a [u8],
        to_static: impl Fn(&'a [u8]) -> Cow<'static, [u8]> + Copy,
        hash: HashType,
    ) -> sys::Result<WatchItemIndex> {
        let watchlist = &mut self.state.lock().watchlist;
        if let Some(idx) = index_of(watchlist, hash) {
            return Ok(idx as WatchItemIndex);
        }
        watchlist
            .ensure_unused_capacity(1)
            .unwrap_or_else(|_| bun_core::out_of_memory());
        self.append_directory_assume_capacity(watchlist, fd, file_path, to_static, hash)
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
            match sys::File::open(z, WATCH_OPEN_FLAGS, 0) {
                Ok(opened) => Some(opened),
                Err(_) => return false,
            }
        };
        #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
        let file = None;

        self.add_owned_file(file, file_path, hash).is_ok()
    }

    /// [`Self::add_file`] that closes `file` unless the watchlist keeps it.
    pub fn add_owned_file(
        &self,
        file: Option<sys::File>,
        file_path: &[u8],
        hash: HashType,
    ) -> sys::Result<()> {
        let fd = file.as_ref().map_or(Fd::INVALID, sys::File::fd);
        let owner = self.add_file(fd, file_path, hash, Fd::INVALID)?;
        if owner == FdOwnership::Watcher {
            let _ = file.map(sys::File::into_raw);
        }
        Ok(())
    }

    pub fn add_file(
        &self,
        fd: Fd,
        file_path: &[u8],
        hash: HashType,
        dir_fd: Fd,
    ) -> sys::Result<FdOwnership> {
        self.add_file_with(fd, file_path, copy_path, hash, dir_fd)
    }

    /// [`Self::add_file`] without the copy of the path.
    pub fn add_file_static(
        &self,
        fd: Fd,
        file_path: &'static [u8],
        hash: HashType,
        dir_fd: Fd,
    ) -> sys::Result<FdOwnership> {
        self.add_file_with(fd, file_path, Cow::Borrowed, hash, dir_fd)
    }

    fn add_file_with<'a>(
        &self,
        fd: Fd,
        file_path: &'a [u8],
        to_static: impl Fn(&'a [u8]) -> Cow<'static, [u8]> + Copy,
        hash: HashType,
        dir_fd: Fd,
    ) -> sys::Result<FdOwnership> {
        let watchlist = &mut self.state.lock().watchlist;

        if let Some(index) = index_of(watchlist, hash) {
            let mut ownership = FdOwnership::Caller;
            if feature_flags::ATOMIC_FILE_WATCHER && fd.is_valid() {
                // Upgrade a path-only entry (`add_file_by_path_slow` inserts
                // fd-less, e.g. the `--hot` entrypoint) so `hot_reloader`'s
                // directory-event recovery sees a valid fd. A valid stored fd
                // is never replaced: the watchlist owns it until eviction,
                // and the old overwrite leaked it.
                let fds = watchlist.items_fd_mut();
                if !fds[index].is_valid() {
                    fds[index] = fd;
                    ownership = FdOwnership::Watcher;
                }
            }
            return Ok(ownership);
        }

        self.append_file(watchlist, fd, file_path, to_static, hash, dir_fd)
    }

    /// Queues `index` for the next `flush_evictions`.
    pub fn remove_at_index(&self, index: WatchItemIndex) {
        self.state.lock().evictions.push(index);
    }

    pub fn on_maybe_watch_directory(&self, file_path: &'static [u8], dir_fd: Fd) {
        // We don't want to watch:
        // - Directories outside the root directory
        // - Directories inside node_modules
        if !strings::contains(file_path, b"node_modules")
            && strings::contains(file_path, self.top_level_dir())
        {
            let hash = Self::get_hash(file_path);
            let _ = self.add_directory_with(dir_fd, file_path, Cow::Borrowed, hash);
        }
    }
}

impl Drop for State {
    fn drop(&mut self) {
        if self.close_descriptors {
            for &fd in self.watchlist.items_fd().iter().filter(|fd| fd.is_valid()) {
                let _ = bun_sys::close(fd);
            }
        }
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
    pub fd: Fd,
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

/// Who owns the `fd` passed to [`Watcher::add_file`] after it returns.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FdOwnership {
    /// The watchlist stored the descriptor; `flush_evictions`/shutdown will
    /// close it. The caller must not use or close it afterwards.
    Watcher,
    /// The watchlist did not take the descriptor: the file was already
    /// watched with a valid stored one, or the path is not watchable (e.g.
    /// outside the project root on Windows). The caller still owns `fd` and
    /// must close it (or keep using it).
    Caller,
}

bun_collections::multi_array_columns! {
    pub trait WatchItemColumns for WatchItem {
        file_path: Cow<'static, [u8]>,
        hash: u32,
        fd: Fd,
        parent_hash: u32,
        kind: WatchItemKind,
        #[cfg(any(target_os = "linux", target_os = "android"))]
        eventlist_index: platform::EventListIndex,
    }
}
