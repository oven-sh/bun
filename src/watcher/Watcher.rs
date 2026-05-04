//! Bun's cross-platform filesystem watcher. Runs on its own thread.

use core::ffi::{c_int, CStr};
use core::fmt;

use bun_collections::MultiArrayList;
use bun_core::{FeatureFlags, Output};
use bun_fs::{FileSystem, PathName};
use bun_resolver::package_json::PackageJSON;
use bun_resolver::{AnyResolveWatcher, ResolveWatcher};
use bun_str::{strings, ZStr};
use bun_sys::{self as sys, Fd};
use bun_threading::Mutex;

use crate::watcher_trace as WatcherTrace;

#[cfg(target_os = "linux")]
use crate::inotify_watcher as platform;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
use crate::kevent_watcher as platform;
#[cfg(windows)]
use crate::windows_watcher as platform;
#[cfg(target_arch = "wasm32")]
compile_error!("Unsupported platform");

bun_output::declare_scope!(watcher, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(watcher, $($arg)*) };
}

// ─── constants ────────────────────────────────────────────────────────────

pub const MAX_COUNT: usize = 128;

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub const REQUIRES_FILE_DESCRIPTORS: bool = true;
#[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
pub const REQUIRES_FILE_DESCRIPTORS: bool = false;

/// Open flags for an fd that exists only to receive kqueue VNODE events.
/// Darwin has O_EVTONLY (no read/write access requested); FreeBSD has no
/// equivalent, so the watch fd is a plain O_RDONLY.
#[cfg(target_os = "macos")]
pub const WATCH_OPEN_FLAGS: i32 = bun_sys::c::O_EVTONLY;
#[cfg(not(target_os = "macos"))]
pub const WATCH_OPEN_FLAGS: i32 = bun_sys::O::RDONLY;

pub type Event = WatchEvent;
pub type Item<'a> = WatchItem<'a>;
pub type ItemList<'a> = WatchList<'a>;
pub type WatchList<'a> = MultiArrayList<WatchItem<'a>>;
pub type HashType = u32;
pub type WatchItemIndex = u16;
pub const MAX_EVICTION_COUNT: usize = 8096;

const NO_WATCH_ITEM: WatchItemIndex = WatchItemIndex::MAX;

// TODO: some platform-specific behavior is implemented in
// this file instead of the platform-specific file.
// ideally, the constants above can be inlined
pub type Platform = platform::Platform;

// TODO(port): `?[:0]u8` element — TSV mandates Option<Box<CStr>> for the
// callback signature; entries are likely borrowed from platform buffers
// (inotify event names), not heap-owned. Revisit ownership in Phase B.
pub type ChangedFilePath = Option<Box<CStr>>;

// ─── Watcher ──────────────────────────────────────────────────────────────

pub struct Watcher<'a> {
    // This will always be [MAX_COUNT]WatchEvent,
    // We avoid statically allocating because it increases the binary size.
    pub watch_events: Box<[WatchEvent]>,
    pub changed_filepaths: [ChangedFilePath; MAX_COUNT],

    /// The platform-specific implementation of the watcher
    pub platform: Platform,

    pub watchlist: WatchList<'a>,
    pub watched_count: usize,
    pub mutex: Mutex,

    pub fs: &'a FileSystem,
    // allocator field dropped — global mimalloc (see §Allocators)
    pub watchloop_handle: Option<std::thread::ThreadId>,
    pub cwd: &'a [u8],
    pub thread: Option<std::thread::JoinHandle<()>>,
    pub running: bool,
    pub close_descriptors: bool,

    pub evict_list: [WatchItemIndex; MAX_EVICTION_COUNT],
    pub evict_list_i: WatchItemIndex,

    pub ctx: *mut (),
    pub on_file_update:
        fn(*mut (), &mut [WatchEvent], &mut [Option<Box<CStr>>], WatchList),
    pub on_error: fn(*mut (), sys::Error),

    pub thread_lock: bun_core::safety::ThreadLock,
}

/// Context types passed to `Watcher::init` implement this trait.
/// Replaces Zig's `@hasDecl(T, "onWatchError")` structural check with a
/// trait bound; the default `on_watch_error` forwards to `on_error`.
pub trait WatcherContext {
    fn on_file_update(
        &mut self,
        events: &mut [WatchEvent],
        changed_files: &mut [ChangedFilePath],
        watchlist: WatchList,
    );
    fn on_error(&mut self, err: sys::Error);
    fn on_watch_error(&mut self, err: sys::Error) {
        self.on_error(err);
    }
}

impl<'a> Watcher<'a> {
    /// Initializes a watcher. Each watcher is tied to some context type, which
    /// receives watch callbacks on the watcher thread. This function does not
    /// actually start the watcher thread.
    ///
    ///     let watcher = Watcher::init(instance_of_t, fs)?;
    ///     // on error: watcher.shutdown(false);
    ///     watcher.start()?;
    ///
    /// To integrate a started watcher into module resolution:
    ///
    ///     transpiler.resolver.watcher = watcher.get_resolve_watcher();
    ///
    /// To integrate a started watcher into bundle_v2:
    ///
    ///     bundle_v2.bun_watcher = watcher;
    pub fn init<T: WatcherContext>(
        ctx: *mut T,
        fs: &'a FileSystem,
    ) -> Result<Box<Watcher<'a>>, bun_core::Error> {
        fn on_file_update_wrapped<T: WatcherContext>(
            ctx_opaque: *mut (),
            events: &mut [WatchEvent],
            changed_files: &mut [ChangedFilePath],
            watchlist: WatchList,
        ) {
            // SAFETY: ctx_opaque was stored from *mut T in init()
            let ctx = unsafe { &mut *(ctx_opaque as *mut T) };
            ctx.on_file_update(events, changed_files, watchlist);
        }
        fn on_error_wrapped<T: WatcherContext>(ctx_opaque: *mut (), err: sys::Error) {
            // SAFETY: ctx_opaque was stored from *mut T in init()
            let ctx = unsafe { &mut *(ctx_opaque as *mut T) };
            ctx.on_watch_error(err);
        }

        let mut watcher = Box::new(Watcher {
            fs,
            watched_count: 0,
            watchlist: WatchList::default(),
            mutex: Mutex::default(),
            cwd: fs.top_level_dir,
            ctx: ctx as *mut (),
            on_file_update: on_file_update_wrapped::<T>,
            on_error: on_error_wrapped::<T>,
            platform: Platform::default(),
            watch_events: vec![WatchEvent::default(); MAX_COUNT].into_boxed_slice(),
            changed_filepaths: [const { None }; MAX_COUNT],
            watchloop_handle: None,
            thread: None,
            running: true,
            close_descriptors: false,
            evict_list: [0; MAX_EVICTION_COUNT],
            evict_list_i: 0,
            thread_lock: bun_core::safety::ThreadLock::init_unlocked(),
        });

        Platform::init(&mut watcher.platform, fs.top_level_dir)?;

        // Initialize trace file if BUN_WATCHER_TRACE env var is set
        WatcherTrace::init();

        Ok(watcher)
    }

    /// Write trace events to the trace file if enabled.
    /// This runs on the watcher thread, so no locking is needed.
    pub fn write_trace_events(
        &mut self,
        events: &mut [WatchEvent],
        changed_files: &mut [ChangedFilePath],
    ) {
        WatcherTrace::write_events(self, events, changed_files);
    }

    pub fn start(&mut self) -> Result<(), bun_core::Error> {
        debug_assert!(self.watchloop_handle.is_none());
        // TODO(port): thread spawn — Watcher must be Send across the spawned
        // thread boundary; Zig passed *Watcher. Using raw ptr + manual safety.
        let this: *mut Watcher<'a> = self;
        // SAFETY: Watcher outlives the thread; shutdown() coordinates teardown
        // via `running`/`close_descriptors` and the thread frees the Box.
        self.thread = Some(std::thread::spawn(move || unsafe {
            // TODO(port): narrow error set
            let _ = (*this).thread_main();
        }));
        Ok(())
    }

    // PORT NOTE: not `impl Drop` — takes a flag and conditionally hands
    // ownership to the watcher thread (which frees self in thread_main).
    // Per PORTING.md, `pub fn deinit` is never the public name; renamed to
    // `shutdown` (not `close(self)` because ownership may transfer to the
    // watcher thread instead of dropping here).
    // TODO(port): ownership model — Zig allocator.destroy(this); Rust needs
    // Box::from_raw or an Arc to make this sound.
    pub fn shutdown(this: *mut Self, close_descriptors: bool) {
        // SAFETY: caller passes the unique heap pointer returned from init()
        let me = unsafe { &mut *this };
        if me.watchloop_handle.is_some() {
            me.mutex.lock();
            me.close_descriptors = close_descriptors;
            me.running = false;
            me.mutex.unlock();
        } else {
            if close_descriptors && me.running {
                let fds = me.watchlist.items().fd;
                for fd in fds {
                    fd.close();
                }
            }
            // watchlist freed by Drop on Box
            // SAFETY: this was Box::into_raw'd by caller of init()
            drop(unsafe { Box::from_raw(this) });
        }
    }

    pub fn get_hash(filepath: &[u8]) -> HashType {
        bun_wyhash::hash(filepath) as HashType
    }

    fn thread_main(&mut self) -> Result<(), bun_core::Error> {
        self.watchloop_handle = Some(std::thread::current().id());
        self.thread_lock.lock();
        Output::Source::configure_named_thread("File Watcher");

        // defer Output.flush() — handled at end
        log!("Watcher started");

        match self.watch_loop() {
            Err(err) => {
                self.watchloop_handle = None;
                self.platform.stop();
                if self.running {
                    (self.on_error)(self.ctx, err);
                }
            }
            Ok(()) => {}
        }

        // deinit and close descriptors if needed
        if self.close_descriptors {
            let fds = self.watchlist.items().fd;
            for fd in fds {
                fd.close();
            }
        }
        // watchlist freed by Drop below

        // Close trace file if open
        WatcherTrace::deinit();

        Output::flush();

        // SAFETY: self is the heap allocation from init(); thread owns it now.
        // TODO(port): ownership model — see shutdown()
        drop(unsafe { Box::from_raw(self as *mut Self) });
        Ok(())
    }

    pub fn flush_evictions(&mut self) {
        if self.evict_list_i == 0 {
            return;
        }
        let evict_list_i = self.evict_list_i as usize;
        // defer this.evict_list_i = 0 — set at end of fn

        // swapRemove messes up the order
        // But, it only messes up the order if any elements in the list appear after the item being removed
        // So if we just sort the list by the biggest index first, that should be fine
        self.evict_list[0..evict_list_i].sort_by(|a, b| b.cmp(a));

        // PORT NOTE: reshaped for borrowck — capture fds.len() before loop
        let slice = self.watchlist.slice();
        let fds = slice.items().fd;
        let fds_len = fds.len();
        let mut last_item = NO_WATCH_ITEM;

        for &item in &self.evict_list[0..evict_list_i] {
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
                    fds[item as usize].close();
                }
            }
            last_item = item;
        }

        last_item = NO_WATCH_ITEM;
        // This is split into two passes because reading the slice while modified is potentially unsafe.
        for i in 0..evict_list_i {
            let item = self.evict_list[i];
            if item == last_item || self.watchlist.len() <= item as usize {
                continue;
            }
            self.watchlist.swap_remove(item as usize);

            // swapRemove put a different entry at `item`, but its kqueue registration still
            // carries its old `udata` (= pre-swap index). Rewrite it so subsequent kevents
            // route to the right module; EV_ADD on an existing (ident, filter) replaces in
            // place. See #29524.
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            {
                if (item as usize) < self.watchlist.len() {
                    let moved_fd = self.watchlist.items().fd[item as usize];
                    if moved_fd.is_valid() {
                        self.add_file_descriptor_to_kqueue_without_checks(
                            moved_fd,
                            item as usize,
                        );
                    }
                }
            }

            last_item = item;
        }

        self.evict_list_i = 0;
    }

    fn watch_loop(&mut self) -> sys::Result<()> {
        while self.running {
            // individual platform implementation will call onFileUpdate
            match Platform::watch_loop_cycle(self) {
                Err(err) => return Err(err),
                Ok(_iter) => {}
            }
        }
        Ok(())
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
    pub fn add_file_descriptor_to_kqueue_without_checks(
        &mut self,
        fd: Fd,
        watchlist_id: usize,
    ) {
        // TODO(port): move to watcher_sys
        use libc::{kevent as KEvent, EVFILT_VNODE, EV_ADD, EV_CLEAR, EV_ENABLE};
        use libc::{NOTE_DELETE, NOTE_RENAME, NOTE_WRITE};

        // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
        // SAFETY: all-zero is a valid KEvent
        let mut event: KEvent = unsafe { core::mem::zeroed() };

        event.flags = (EV_ADD | EV_CLEAR | EV_ENABLE) as _;
        // we want to know about the vnode
        event.filter = EVFILT_VNODE as _;

        event.fflags = (NOTE_WRITE | NOTE_RENAME | NOTE_DELETE) as _;

        // id
        event.ident = usize::try_from(fd.native()).unwrap();

        // Store the index for fast filtering later
        event.udata = watchlist_id as _;
        let mut events: [KEvent; 1] = [event];

        // This took a lot of work to figure out the right permutation
        // Basically:
        // - We register the event here.
        // our while(true) loop above receives notification of changes to any of the events created here.
        // SAFETY: events ptr/len valid; kqueue fd unwrapped from Some
        let _ = unsafe {
            libc::kevent(
                self.platform.fd.unwrap().native(),
                events.as_ptr(),
                1,
                events.as_mut_ptr(),
                0,
                core::ptr::null(),
            )
        };
    }

    #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
    pub fn add_file_descriptor_to_kqueue_without_checks(&mut self, _fd: Fd, _watchlist_id: usize) {}

    fn append_file_assume_capacity<const CLONE_FILE_PATH: bool>(
        &mut self,
        fd: Fd,
        file_path: &'a [u8],
        hash: HashType,
        loader: bun_bundler::options::Loader,
        parent_hash: HashType,
        package_json: Option<&'a PackageJSON>,
    ) -> sys::Result<()> {
        #[cfg(windows)]
        {
            // on windows we can only watch items that are in the directory tree of the top level dir
            let rel = bun_paths::is_parent_or_equal(self.fs.top_level_dir, file_path);
            if rel == bun_paths::Relation::Unrelated {
                Output::warn(
                    format_args!(
                        "File {} is not in the project directory and will not be watched\n",
                        bstr::BStr::new(file_path)
                    ),
                );
                return Ok(());
            }
        }

        let watchlist_id = self.watchlist.len();

        // TODO(port): when CLONE_FILE_PATH, the duped buffer is owned by the
        // watchlist but typed as &'a [u8]; Phase B should make WatchItem own
        // a Cow or Box for this case.
        let file_path_: &'a [u8] = if CLONE_FILE_PATH {
            let owned = bun_str::ZStr::from_bytes(file_path);
            // SAFETY: leaked for the lifetime of the watchlist; freed nowhere
            // in Zig either (watchlist.deinit doesn't free file_path).
            unsafe { core::mem::transmute::<&[u8], &'a [u8]>(Box::leak(owned).as_bytes()) }
        } else {
            file_path
        };

        let mut item = WatchItem {
            file_path: file_path_,
            fd,
            hash,
            count: 0,
            loader,
            parent_hash,
            package_json,
            kind: WatchItemKind::File,
            #[cfg(target_os = "linux")]
            eventlist_index: 0,
        };

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            self.add_file_descriptor_to_kqueue_without_checks(fd, watchlist_id);
        }
        #[cfg(target_os = "linux")]
        {
            // var file_path_to_use_ = std.mem.trimRight(u8, file_path_, "/");
            // var buf: [bun.MAX_PATH_BYTES+1]u8 = undefined;
            // bun.copy(u8, &buf, file_path_to_use_);
            // buf[file_path_to_use_.len] = 0;
            let buf = file_path_.as_ptr();
            // SAFETY: file_path_[file_path_.len()] == 0 — Zig assumed sentinel here
            let slice = unsafe { ZStr::from_raw(buf, file_path_.len()) };
            item.eventlist_index = match self.platform.watch_path(slice) {
                Err(err) => return Err(err),
                Ok(r) => r,
            };
        }

        // PERF(port): was assume_capacity
        self.watchlist.push(item);
        Ok(())
    }

    fn append_directory_assume_capacity<const CLONE_FILE_PATH: bool>(
        &mut self,
        stored_fd: Fd,
        file_path: &'a [u8],
        hash: HashType,
    ) -> sys::Result<WatchItemIndex> {
        #[cfg(windows)]
        {
            // on windows we can only watch items that are in the directory tree of the top level dir
            let rel = bun_paths::is_parent_or_equal(self.fs.top_level_dir, file_path);
            if rel == bun_paths::Relation::Unrelated {
                Output::warn(
                    format_args!(
                        "Directory {} is not in the project directory and will not be watched\n",
                        bstr::BStr::new(file_path)
                    ),
                );
                return Ok(NO_WATCH_ITEM);
            }
        }

        let fd = 'brk: {
            if stored_fd.is_valid() {
                break 'brk stored_fd;
            }
            match sys::open_a(file_path, 0, 0) {
                Err(err) => return Err(err),
                Ok(fd) => break 'brk fd,
            }
        };

        // TODO(port): same CLONE_FILE_PATH ownership note as append_file_assume_capacity
        let file_path_: &'a [u8] = if CLONE_FILE_PATH {
            let owned = bun_str::ZStr::from_bytes(file_path);
            // SAFETY: leaked for watchlist lifetime
            unsafe { core::mem::transmute::<&[u8], &'a [u8]>(Box::leak(owned).as_bytes()) }
        } else {
            file_path
        };

        let parent_hash = Self::get_hash(PathName::init(file_path_).dir_with_trailing_slash());

        let watchlist_id = self.watchlist.len();

        let mut item = WatchItem {
            file_path: file_path_,
            fd,
            hash,
            count: 0,
            loader: bun_bundler::options::Loader::File,
            parent_hash,
            kind: WatchItemKind::Directory,
            package_json: None,
            #[cfg(target_os = "linux")]
            eventlist_index: 0,
        };

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            // TODO(port): move to watcher_sys
            use libc::{kevent as KEvent, EVFILT_VNODE, EV_ADD, EV_CLEAR, EV_ENABLE};
            use libc::{NOTE_DELETE, NOTE_RENAME, NOTE_WRITE};

            // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
            // SAFETY: all-zero is a valid KEvent
            let mut event: KEvent = unsafe { core::mem::zeroed() };

            event.flags = (EV_ADD | EV_CLEAR | EV_ENABLE) as _;
            // we want to know about the vnode
            event.filter = EVFILT_VNODE as _;

            // monitor:
            // - Write
            // - Rename
            // - Delete
            event.fflags = (NOTE_WRITE | NOTE_RENAME | NOTE_DELETE) as _;

            // id
            event.ident = usize::try_from(fd.native()).unwrap();

            // Store the index for fast filtering later
            event.udata = watchlist_id as _;
            let mut events: [KEvent; 1] = [event];

            // This took a lot of work to figure out the right permutation
            // Basically:
            // - We register the event here.
            // our while(true) loop above receives notification of changes to any of the events created here.
            // SAFETY: events ptr/len valid; kqueue fd unwrapped from Some
            let _ = unsafe {
                libc::kevent(
                    self.platform.fd.unwrap().native(),
                    events.as_ptr(),
                    1,
                    events.as_mut_ptr(),
                    0,
                    core::ptr::null(),
                )
            };
        }
        #[cfg(target_os = "linux")]
        {
            let mut buf = bun_paths::path_buffer_pool().get();
            let path: &ZStr = if CLONE_FILE_PATH
                && !file_path_.is_empty()
                && file_path_[file_path_.len() - 1] == 0
            {
                // SAFETY: last byte is 0, slice len excludes it
                unsafe { ZStr::from_raw(file_path_.as_ptr(), file_path_.len() - 1) }
            } else {
                let trailing_slash = if file_path_.len() > 1 {
                    bun_str::strings::trim_right(file_path_, &[0, b'/'])
                } else {
                    file_path_
                };
                buf[0..trailing_slash.len()].copy_from_slice(trailing_slash);
                buf[trailing_slash.len()] = 0;
                // SAFETY: buf[len] == 0 written above
                unsafe { ZStr::from_raw(buf.as_ptr(), trailing_slash.len()) }
            };

            item.eventlist_index = match self.platform.watch_dir(path) {
                Err(err) => return Err(err.with_path(file_path)),
                Ok(r) => r,
            };
        }

        let _ = watchlist_id; // silence unused on non-kqueue
        // PERF(port): was assume_capacity
        self.watchlist.push(item);
        Ok((self.watchlist.len() - 1) as WatchItemIndex)
    }

    // Below is platform-independent

    pub fn append_file_maybe_lock<const CLONE_FILE_PATH: bool, const LOCK: bool>(
        &mut self,
        fd: Fd,
        file_path: &'a [u8],
        hash: HashType,
        loader: bun_bundler::options::Loader,
        dir_fd: Fd,
        package_json: Option<&'a PackageJSON>,
    ) -> sys::Result<()> {
        if LOCK {
            self.mutex.lock();
        }
        // TODO(port): errdefer — defer-unlock captures &mut self; needs RAII
        // MutexGuard. Until then, each early-return below hand-inlines
        // `if LOCK { self.mutex.unlock() }`.

        debug_assert!(file_path.len() > 1);
        let pathname = PathName::init(file_path);

        let parent_dir = pathname.dir_with_trailing_slash();
        let parent_dir_hash: HashType = Self::get_hash(parent_dir);

        let mut parent_watch_item: Option<WatchItemIndex> = None;
        let autowatch_parent_dir =
            FeatureFlags::WATCH_DIRECTORIES && self.is_eligible_directory(parent_dir);
        if autowatch_parent_dir {
            let watchlist_slice = self.watchlist.slice();

            if dir_fd.is_valid() {
                let fds = watchlist_slice.items().fd;
                if let Some(i) = fds.iter().position(|f| *f == dir_fd) {
                    parent_watch_item = Some(i as WatchItemIndex);
                }
            }

            if parent_watch_item.is_none() {
                let hashes = watchlist_slice.items().hash;
                if let Some(i) = hashes.iter().position(|h| *h == parent_dir_hash) {
                    parent_watch_item = Some(i as WatchItemIndex);
                }
            }
        }
        self.watchlist
            .ensure_unused_capacity(1 + usize::from(parent_watch_item.is_none()));

        if autowatch_parent_dir {
            parent_watch_item = Some(match parent_watch_item {
                Some(v) => v,
                None => match self.append_directory_assume_capacity::<CLONE_FILE_PATH>(
                    dir_fd,
                    parent_dir,
                    parent_dir_hash,
                ) {
                    Err(err) => {
                        if LOCK {
                            self.mutex.unlock();
                        }
                        return Err(err.with_path(parent_dir));
                    }
                    Ok(r) => r,
                },
            });
        }
        let _ = parent_watch_item;

        match self.append_file_assume_capacity::<CLONE_FILE_PATH>(
            fd,
            file_path,
            hash,
            loader,
            parent_dir_hash,
            package_json,
        ) {
            Err(err) => {
                if LOCK {
                    self.mutex.unlock();
                }
                return Err(err.with_path(file_path));
            }
            Ok(()) => {}
        }

        if bun_output::scope_is_visible!(watcher) {
            let cwd_len_with_slash = if self.cwd[self.cwd.len() - 1] == b'/' {
                self.cwd.len()
            } else {
                self.cwd.len() + 1
            };
            let display_path = if file_path.len() > cwd_len_with_slash
                && file_path.starts_with(self.cwd)
            {
                &file_path[cwd_len_with_slash..]
            } else {
                file_path
            };
            log!(
                "<d>Added <b>{}<r><d> to watch list.<r>",
                bstr::BStr::new(display_path)
            );
        }

        if LOCK {
            self.mutex.unlock();
        }
        Ok(())
    }

    #[inline]
    fn is_eligible_directory(&self, dir: &[u8]) -> bool {
        strings::index_of(dir, self.fs.top_level_dir).is_some()
            && strings::index_of(dir, b"node_modules").is_none()
    }

    pub fn append_file<const CLONE_FILE_PATH: bool>(
        &mut self,
        fd: Fd,
        file_path: &'a [u8],
        hash: HashType,
        loader: bun_bundler::options::Loader,
        dir_fd: Fd,
        package_json: Option<&'a PackageJSON>,
    ) -> sys::Result<()> {
        self.append_file_maybe_lock::<CLONE_FILE_PATH, true>(
            fd,
            file_path,
            hash,
            loader,
            dir_fd,
            package_json,
        )
    }

    pub fn add_directory<const CLONE_FILE_PATH: bool>(
        &mut self,
        fd: Fd,
        file_path: &'a [u8],
        hash: HashType,
    ) -> sys::Result<WatchItemIndex> {
        self.mutex.lock();
        // TODO(port): use RAII guard for mutex
        let result = (|| {
            if let Some(idx) = self.index_of(hash) {
                return Ok(idx as WatchItemIndex);
            }

            self.watchlist.ensure_unused_capacity(1);

            self.append_directory_assume_capacity::<CLONE_FILE_PATH>(fd, file_path, hash)
        })();
        self.mutex.unlock();
        result
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
    pub fn add_file_by_path_slow(
        &mut self,
        file_path: &'a [u8],
        loader: bun_bundler::options::Loader,
    ) -> bool {
        if file_path.is_empty() {
            return false;
        }
        let hash = Self::get_hash(file_path);

        // Check if already watched (with lock to avoid race with removal)
        {
            self.mutex.lock();
            let already_watched = self.index_of(hash).is_some();
            self.mutex.unlock();

            if already_watched {
                return true;
            }
        }

        // Only open fd if we might need it
        let mut fd: Fd = Fd::INVALID;
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            // TODO(port): std.posix.toPosixPath equivalent — copy into a
            // PathBuffer and NUL-terminate.
            let mut path_z = bun_paths::PathBuffer::uninit();
            if file_path.len() >= path_z.len() {
                return false;
            }
            path_z[..file_path.len()].copy_from_slice(file_path);
            path_z[file_path.len()] = 0;
            // SAFETY: path_z[file_path.len()] == 0 written above
            let z = unsafe { ZStr::from_raw(path_z.as_ptr(), file_path.len()) };
            match sys::open(z, WATCH_OPEN_FLAGS, 0) {
                Ok(opened) => fd = opened,
                Err(_) => return false,
            }
        }

        let res = self.add_file::<true>(fd, file_path, hash, loader, Fd::INVALID, None);
        match res {
            Ok(()) => {
                // On kqueue platforms, addFile may have found the file already
                // watched (race) and returned success without using our fd.
                // Close it if unused.
                #[cfg(any(target_os = "macos", target_os = "freebsd"))]
                if fd.is_valid() {
                    self.mutex.lock();
                    let maybe_idx = self.index_of(hash);
                    let stored_fd = if let Some(idx) = maybe_idx {
                        self.watchlist.items().fd[idx as usize]
                    } else {
                        Fd::INVALID
                    };
                    self.mutex.unlock();

                    // Only close if entry exists and stored fd differs from ours.
                    // Race scenarios:
                    // 1. Entry removed (maybe_idx == None): our fd was stored then closed by flushEvictions → don't close
                    // 2. Entry exists with different fd: another thread added entry, addFile didn't use our fd → close ours
                    // 3. Entry exists with same fd: our fd was stored → don't close
                    if maybe_idx.is_some() && stored_fd.native() != fd.native() {
                        fd.close();
                    }
                }
                true
            }
            Err(_) => {
                if fd.is_valid() {
                    fd.close();
                }
                false
            }
        }
    }

    pub fn add_file<const CLONE_FILE_PATH: bool>(
        &mut self,
        fd: Fd,
        file_path: &'a [u8],
        hash: HashType,
        loader: bun_bundler::options::Loader,
        dir_fd: Fd,
        package_json: Option<&'a PackageJSON>,
    ) -> sys::Result<()> {
        // This must lock due to concurrent transpiler
        self.mutex.lock();

        if let Some(index) = self.index_of(hash) {
            if FeatureFlags::ATOMIC_FILE_WATCHER {
                // On Linux, the file descriptor might be out of date.
                if fd.is_valid() {
                    let fds = self.watchlist.items_mut().fd;
                    fds[index as usize] = fd;
                }
            }
            self.mutex.unlock();
            return Ok(());
        }

        let r = self.append_file_maybe_lock::<CLONE_FILE_PATH, false>(
            fd,
            file_path,
            hash,
            loader,
            dir_fd,
            package_json,
        );
        self.mutex.unlock();
        r
    }

    pub fn index_of(&self, hash: HashType) -> Option<u32> {
        for (i, other) in self.watchlist.items().hash.iter().enumerate() {
            if hash == *other {
                return Some(i as u32);
            }
        }
        None
    }

    pub fn remove(&mut self, hash: HashType) {
        self.mutex.lock();
        if let Some(index) = self.index_of(hash) {
            self.remove_at_index::<{ WatchItemKind::File }>(index as WatchItemIndex, hash, &[]);
        }
        self.mutex.unlock();
    }

    pub fn remove_at_index<const KIND: WatchItemKind>(
        &mut self,
        index: WatchItemIndex,
        hash: HashType,
        parents: &[HashType],
    ) {
        debug_assert!(index != NO_WATCH_ITEM);

        self.evict_list[self.evict_list_i as usize] = index;
        self.evict_list_i += 1;

        if KIND == WatchItemKind::Directory {
            for &parent in parents {
                if parent == hash {
                    self.evict_list[self.evict_list_i as usize] = parent as WatchItemIndex;
                    self.evict_list_i += 1;
                }
            }
        }
    }

    pub fn get_resolve_watcher(&mut self) -> AnyResolveWatcher {
        ResolveWatcher::<*mut Self>::init(self, Self::on_maybe_watch_directory)
    }

    pub fn on_maybe_watch_directory(watch: &mut Self, file_path: &'a [u8], dir_fd: Fd) {
        // We don't want to watch:
        // - Directories outside the root directory
        // - Directories inside node_modules
        if strings::index_of(file_path, b"node_modules").is_none()
            && strings::index_of(file_path, watch.fs.top_level_dir).is_some()
        {
            let _ = watch.add_directory::<false>(dir_fd, file_path, Self::get_hash(file_path));
        }
    }
}

// ─── WatchEvent ───────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct WatchEvent {
    pub index: WatchItemIndex,
    pub op: Op,
    pub name_off: u8,
    pub name_len: u8,
}

pub type Sorter = ();

impl WatchEvent {
    pub fn names<'b>(self, buf: &'b mut [ChangedFilePath]) -> &'b mut [ChangedFilePath] {
        if self.name_len == 0 {
            return &mut [];
        }
        &mut buf[self.name_off as usize..][..self.name_len as usize]
    }

    pub fn sort_by_index(_: Sorter, event: WatchEvent, rhs: WatchEvent) -> bool {
        event.index < rhs.index
    }

    pub fn merge(&mut self, other: WatchEvent) {
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
    pub fn merge(before: Op, after: Op) -> Op {
        before | after
    }
}

impl fmt::Display for Op {
    fn fmt(&self, w: &mut fmt::Formatter<'_>) -> fmt::Result {
        w.write_str("{")?;
        let mut first = true;
        const NAMES: &[(Op, &str)] = &[
            (Op::DELETE, "delete"),
            (Op::METADATA, "metadata"),
            (Op::RENAME, "rename"),
            (Op::WRITE, "write"),
            (Op::MOVE_TO, "move_to"),
            (Op::CREATE, "create"),
        ];
        for &(flag, name) in NAMES {
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

pub struct WatchItem<'a> {
    pub file_path: &'a [u8],
    // filepath hash for quick comparison
    pub hash: u32,
    pub loader: bun_bundler::options::Loader,
    pub fd: Fd,
    pub count: u32,
    pub parent_hash: u32,
    pub kind: WatchItemKind,
    pub package_json: Option<&'a PackageJSON>,
    #[cfg(target_os = "linux")]
    pub eventlist_index: platform::EventListIndex,
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum WatchItemKind {
    File,
    Directory,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/watcher/Watcher.zig (808 lines)
//   confidence: medium
//   todos:      12
//   notes:      Mutex needs RAII guard; Box ownership across thread (init/shutdown/thread_main) needs Arc or raw-ptr protocol; CLONE_FILE_PATH leaks duped path (matches Zig); ChangedFilePath=Option<Box<CStr>> per TSV but likely borrowed from platform buffer
// ──────────────────────────────────────────────────────────────────────────
