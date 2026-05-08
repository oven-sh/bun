//! Bun's cross-platform filesystem watcher. Runs on its own thread.

use core::fmt;
use std::borrow::Cow;

use bun_collections::MultiArrayList;
use bun_core::{feature_flags, output as Output, strings, zstr, ThreadLock, ZStr};
use bun_sys::{self as sys, Fd};
use bun_threading::Mutex;

use crate::watcher_trace as WatcherTrace;
use crate::Loader;

#[cfg(target_os = "linux")]
use crate::inotify_watcher as platform;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
use crate::kevent_watcher as platform;
#[cfg(windows)]
use crate::windows_watcher as platform;
#[cfg(target_arch = "wasm32")]
compile_error!("Unsupported platform");

bun_core::declare_scope!(watcher, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_core::scoped_log!(watcher, $($arg)*) };
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
pub const WATCH_OPEN_FLAGS: i32 = libc::O_EVTONLY;
#[cfg(not(target_os = "macos"))]
pub const WATCH_OPEN_FLAGS: i32 = bun_sys::O::RDONLY;

pub type Event = WatchEvent;
pub type Item = WatchItem;
pub type ItemList = WatchList;
pub type WatchList = MultiArrayList<WatchItem>;
pub type HashType = u32;
pub type WatchItemIndex = u16;
pub const MAX_EVICTION_COUNT: usize = 8096;

const NO_WATCH_ITEM: WatchItemIndex = WatchItemIndex::MAX;

// ─── erased upward types (CYCLEBREAK) ─────────────────────────────────────

/// Opaque forward-decl of `bun_resolver::package_json::PackageJSON` (T5).
/// Watcher only stores `Option<&PackageJSON>` and passes it through; never
/// dereferenced here. Real layout lives in `bun_resolver`.
// SAFETY: erased PackageJSON — only ever held by reference / raw ptr.
#[repr(C)]
pub struct PackageJSON {
    _opaque: [u8; 0],
    _pinned: core::marker::PhantomPinned,
}

/// Manual vtable for resolver→watcher directory-watch callbacks.
/// Was `bun_resolver::AnyResolveWatcher` (T5); defined here so the low-tier
/// crate owns the shape and `bun_resolver` re-imports it (move-in pass).
// PERF(port): was inline switch (Zig comptime ResolveWatcher generator).
#[derive(Clone, Copy)]
pub struct AnyResolveWatcher {
    pub context: *mut (),
    pub callback: unsafe fn(*mut (), dir_path: &[u8], dir_fd: Fd),
}

impl AnyResolveWatcher {
    #[inline]
    pub fn watch(self, dir_path: &[u8], dir_fd: Fd) {
        // SAFETY: context was stored from a typed *mut T whose callback casts it back.
        unsafe { (self.callback)(self.context, dir_path, dir_fd) }
    }
}

// TODO: some platform-specific behavior is implemented in
// this file instead of the platform-specific file.
// ideally, the constants above can be inlined
pub type Platform = platform::Platform;

/// `?[:0]u8` — name of a changed file inside a watched directory, borrowed
/// from the platform's event buffer (inotify event names / kqueue udata).
/// Ownership stays with the platform buffer for the duration of one
/// `on_file_update` callback; the slot is cleared next cycle.
pub type ChangedFilePath = Option<&'static ZStr>;

// ─── Watcher ──────────────────────────────────────────────────────────────

pub struct Watcher {
    // This will always be [MAX_COUNT]WatchEvent,
    // We avoid statically allocating because it increases the binary size.
    pub watch_events: Box<[WatchEvent]>,
    pub changed_filepaths: [ChangedFilePath; MAX_COUNT],

    /// The platform-specific implementation of the watcher
    pub platform: Platform,

    pub watchlist: WatchList,
    pub watched_count: usize,
    pub mutex: Mutex,

    // PORT NOTE: Zig stored `fs: *Fs.FileSystem` but only ever read
    // `fs.top_level_dir`. Storing the slice directly avoids a forward-decl
    // dependency on the higher-tier `bun_resolver::fs::FileSystem` type.
    // allocator field dropped — global mimalloc (see §Allocators)
    pub watchloop_handle: Option<std::thread::ThreadId>,
    pub cwd: &'static [u8],
    pub thread: Option<std::thread::JoinHandle<()>>,
    pub running: bool,
    pub close_descriptors: bool,

    pub evict_list: [WatchItemIndex; MAX_EVICTION_COUNT],
    pub evict_list_i: WatchItemIndex,

    pub ctx: *mut (),
    pub on_file_update: fn(*mut (), &mut [WatchEvent], &[ChangedFilePath], &WatchList),
    pub on_error: fn(*mut (), sys::Error),

    pub thread_lock: ThreadLock,
}

/// Context types passed to `Watcher::init` implement this trait.
/// Replaces Zig's `@hasDecl(T, "onWatchError")` structural check with a
/// trait bound; the default `on_watch_error` forwards to `on_error`.
pub trait WatcherContext {
    fn on_file_update(
        &mut self,
        events: &mut [WatchEvent],
        changed_files: &[ChangedFilePath],
        watchlist: &WatchList,
    );
    fn on_error(&mut self, err: sys::Error);
    fn on_watch_error(&mut self, err: sys::Error) {
        self.on_error(err);
    }
}

impl Watcher {
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
        top_level_dir: &'static [u8],
    ) -> Result<Box<Watcher>, bun_core::Error> {
        fn on_file_update_wrapped<T: WatcherContext>(
            ctx_opaque: *mut (),
            events: &mut [WatchEvent],
            changed_files: &[ChangedFilePath],
            watchlist: &WatchList,
        ) {
            // SAFETY: ctx_opaque was stored from *mut T in init()
            let ctx = unsafe { &mut *ctx_opaque.cast::<T>() };
            ctx.on_file_update(events, changed_files, watchlist);
        }
        fn on_error_wrapped<T: WatcherContext>(ctx_opaque: *mut (), err: sys::Error) {
            // SAFETY: ctx_opaque was stored from *mut T in init()
            let ctx = unsafe { &mut *ctx_opaque.cast::<T>() };
            ctx.on_watch_error(err);
        }

        let mut this = Box::new(Watcher {
            watched_count: 0,
            watchlist: WatchList::default(),
            mutex: Mutex::default(),
            cwd: top_level_dir,
            ctx: ctx.cast::<()>(),
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
            thread_lock: ThreadLock::init_unlocked(),
        });

        this.platform.init(top_level_dir)?;

        // Initialize trace file if BUN_WATCHER_TRACE env var is set
        WatcherTrace::init();

        Ok(this)
    }

    /// Write trace events to the trace file if enabled.
    /// This runs on the watcher thread, so no locking is needed.
    pub fn write_trace_events(&self, events: &[WatchEvent], changed_files: &[ChangedFilePath]) {
        WatcherTrace::write_events(&self.watchlist, events, changed_files);
    }

    pub fn start(&mut self) -> Result<(), bun_core::Error> {
        debug_assert!(self.watchloop_handle.is_none());
        // TODO(port): thread spawn — Watcher must be Send across the spawned
        // thread boundary; Zig passed *Watcher. Using raw ptr + manual safety.
        let this = std::ptr::from_mut::<Watcher>(self) as usize;
        // SAFETY: Watcher outlives the thread; shutdown() coordinates teardown
        // via `running`/`close_descriptors` and the thread frees the Box.
        self.thread = Some(std::thread::spawn(move || unsafe {
            // TODO(port): narrow error set
            let _ = (*(this as *mut Watcher)).thread_main();
        }));
        Ok(())
    }

    // PORT NOTE: not `impl Drop` — takes a flag and conditionally hands
    // ownership to the watcher thread (which frees self in thread_main).
    // Per PORTING.md, `pub fn deinit` is never the public name; renamed to
    // `shutdown` (not `close(self)` because ownership may transfer to the
    // watcher thread instead of dropping here).
    // TODO(port): ownership model — Zig allocator.destroy(this); Rust needs
    // heap::take or an Arc to make this sound.
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
                let fds = me.watchlist.items_fd();
                for &fd in fds {
                    let _ = bun_sys::close(fd);
                }
            }
            // watchlist freed by Drop on Box
            // SAFETY: this was heap-allocated by caller of init()
            drop(unsafe { bun_core::heap::take(this) });
        }
    }

    pub fn get_hash(filepath: &[u8]) -> HashType {
        bun_wyhash::hash(filepath) as HashType
    }

    fn thread_main(&mut self) -> Result<(), bun_core::Error> {
        self.watchloop_handle = Some(std::thread::current().id());
        self.thread_lock.lock();
        Output::Source::configure_named_thread(zstr!("File Watcher"));

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
            let fds = self.watchlist.items_fd();
            for &fd in fds {
                let _ = bun_sys::close(fd);
            }
        }
        // watchlist freed by Drop below

        // Close trace file if open
        WatcherTrace::deinit();

        Output::flush();

        // SAFETY: self is the heap allocation from init(); thread owns it now.
        // TODO(port): ownership model — see shutdown()
        drop(unsafe { bun_core::heap::take(std::ptr::from_mut::<Self>(self)) });
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
        let fds = slice.items_fd();
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
                    let _ = bun_sys::close(fds[item as usize]);
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
                    let moved_fd = self.watchlist.items_fd()[item as usize];
                    if moved_fd.is_valid() {
                        self.add_file_descriptor_to_kqueue_without_checks(moved_fd, item as usize);
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
            platform::watch_loop_cycle(self)?;
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
    pub fn add_file_descriptor_to_kqueue_without_checks(&mut self, fd: Fd, watchlist_id: usize) {
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
        event.ident = usize::try_from(fd.native()).expect("int cast");

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
        file_path: &[u8],
        hash: HashType,
        loader: Loader,
        parent_hash: HashType,
        package_json: Option<&'static PackageJSON>,
    ) -> sys::Result<()> {
        #[cfg(windows)]
        {
            // on windows we can only watch items that are in the directory tree of the top level dir
            let rel = bun_paths::resolve_path::is_parent_or_equal(self.top_level_dir(), file_path);
            if rel == bun_paths::resolve_path::ParentEqual::Unrelated {
                Output::warn(format_args!(
                    "File {} is not in the project directory and will not be watched\n",
                    bstr::BStr::new(file_path)
                ));
                return Ok(());
            }
        }

        let watchlist_id = self.watchlist.len();

        // Zig: `if (clone_file_path) bun.asByteSlice(bun.handleOom(allocator.dupeZ(u8, file_path))) else file_path`.
        // `WatchItem.file_path` is now an owning `Cow<'static, [u8]>` column so the
        // CLONE_FILE_PATH=true arm heap-dups (matching Zig's `dupeZ`) instead of
        // dangling once the caller's buffer is freed.
        let file_path_: Cow<'static, [u8]> = if CLONE_FILE_PATH {
            Cow::Owned(file_path.to_vec())
        } else {
            // SAFETY: when CLONE_FILE_PATH is false the caller passes a path
            // interned in `bun.fs.FileSystem` (process-lifetime); the borrow is
            // truly `'static`. Matches Zig's `else file_path` arm.
            Cow::Borrowed(unsafe { core::mem::transmute::<&[u8], &'static [u8]>(file_path) })
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
            // Zig builds the `[:0]const u8` from `file_path_` (the dupeZ'd copy when
            // clone_file_path=true), guaranteeing a trailing NUL for inotify. When
            // CLONE_FILE_PATH is true the caller's `file_path` is NOT NUL-terminated,
            // so we must copy into a NUL-terminated scratch buffer (mirrors the
            // directory branch below) instead of pointing at the caller's slice.
            let mut buf = bun_paths::path_buffer_pool::get();
            let slice: &ZStr = if CLONE_FILE_PATH {
                buf[0..file_path.len()].copy_from_slice(file_path);
                buf[file_path.len()] = 0;
                // SAFETY: buf[file_path.len()] == 0 written above
                unsafe { ZStr::from_raw(buf.as_ptr(), file_path.len()) }
            } else {
                // SAFETY: when CLONE_FILE_PATH is false the caller passes a path
                // interned in `bun.fs.FileSystem` with a NUL sentinel at [len];
                // Zig's `buf[0..file_path_.len :0]` assumed the same.
                unsafe { ZStr::from_raw(file_path.as_ptr(), file_path.len()) }
            };
            item.eventlist_index = self.platform.watch_path(slice)?;
        }

        // PERF(port): was assume_capacity
        self.watchlist.append_assume_capacity(item);
        Ok(())
    }

    fn append_directory_assume_capacity<const CLONE_FILE_PATH: bool>(
        &mut self,
        stored_fd: Fd,
        file_path: &[u8],
        hash: HashType,
    ) -> sys::Result<WatchItemIndex> {
        #[cfg(windows)]
        {
            let rel = bun_paths::resolve_path::is_parent_or_equal(self.top_level_dir(), file_path);
            if rel == bun_paths::resolve_path::ParentEqual::Unrelated {
                Output::warn(format_args!(
                    "Directory {} is not in the project directory and will not be watched\n",
                    bstr::BStr::new(file_path)
                ));
                return Ok(NO_WATCH_ITEM);
            }
        }

        let fd = if stored_fd.is_valid() {
            stored_fd
        } else {
            bun_sys::open_a(file_path, 0, 0)?
        };

        // Zig: `if (clone_file_path) bun.asByteSlice(bun.handleOom(allocator.dupeZ(u8, file_path))) else file_path`.
        // `WatchItem.file_path` is now an owning `Cow<'static, [u8]>` column so the
        // CLONE_FILE_PATH=true arm heap-dups (matching Zig's `dupeZ`) instead of
        // dangling once the caller's buffer is freed.
        let file_path_: Cow<'static, [u8]> = if CLONE_FILE_PATH {
            Cow::Owned(file_path.to_vec())
        } else {
            // SAFETY: when CLONE_FILE_PATH is false the caller passes a path
            // interned in `bun.fs.FileSystem` (process-lifetime); the borrow is
            // truly `'static`. Matches Zig's `else file_path` arm.
            Cow::Borrowed(unsafe { core::mem::transmute::<&[u8], &'static [u8]>(file_path) })
        };

        let parent_hash =
            Self::get_hash(bun_paths::fs::PathName::init(file_path).dir_with_trailing_slash());

        let watchlist_id = self.watchlist.len();

        let mut item = WatchItem {
            file_path: file_path_,
            fd,
            hash,
            count: 0,
            loader: Loader::File,
            parent_hash,
            kind: WatchItemKind::Directory,
            package_json: None,
            #[cfg(target_os = "linux")]
            eventlist_index: 0,
        };

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            self.add_file_descriptor_to_kqueue_without_checks(fd, watchlist_id);
        }
        #[cfg(target_os = "linux")]
        {
            let mut buf = bun_paths::path_buffer_pool::get();
            let path: &ZStr = if CLONE_FILE_PATH
                && !file_path.is_empty()
                && file_path[file_path.len() - 1] == 0
            {
                // SAFETY: last byte is 0, slice len excludes it
                unsafe { ZStr::from_raw(file_path.as_ptr(), file_path.len() - 1) }
            } else {
                let trailing_slash = if file_path.len() > 1 {
                    strings::trim_right(file_path, &[0, b'/'])
                } else {
                    file_path
                };
                buf[0..trailing_slash.len()].copy_from_slice(trailing_slash);
                buf[trailing_slash.len()] = 0;
                // SAFETY: buf[len] == 0 written above
                unsafe { ZStr::from_raw(buf.as_ptr(), trailing_slash.len()) }
            };

            item.eventlist_index = self
                .platform
                .watch_dir(path)
                .map_err(|e| e.with_path(file_path))?;
        }
        #[cfg(windows)]
        let _ = watchlist_id;

        // PERF(port): was assume_capacity
        self.watchlist.append_assume_capacity(item);
        Ok((self.watchlist.len() - 1) as WatchItemIndex)
    }

    // Below is platform-independent

    pub fn append_file_maybe_lock<const CLONE_FILE_PATH: bool, const LOCK: bool>(
        &mut self,
        fd: Fd,
        file_path: &[u8],
        hash: HashType,
        loader: Loader,
        dir_fd: Fd,
        package_json: Option<&'static PackageJSON>,
    ) -> sys::Result<()> {
        if LOCK {
            self.mutex.lock();
        }
        // TODO(port): errdefer — defer-unlock captures &mut self; needs RAII
        // MutexGuard. Until then, each early-return below hand-inlines
        // `if LOCK { self.mutex.unlock() }`.

        debug_assert!(file_path.len() > 1);
        let pathname = bun_paths::fs::PathName::init(file_path);

        let parent_dir = pathname.dir_with_trailing_slash();
        let parent_dir_hash: HashType = Self::get_hash(parent_dir);

        let mut parent_watch_item: Option<WatchItemIndex> = None;
        let autowatch_parent_dir =
            feature_flags::WATCH_DIRECTORIES && self.is_eligible_directory(parent_dir);
        if autowatch_parent_dir {
            let watchlist_slice = self.watchlist.slice();

            if dir_fd.is_valid() {
                let fds = watchlist_slice.items_fd();
                if let Some(i) = fds.iter().position(|f| *f == dir_fd) {
                    parent_watch_item = Some(i as WatchItemIndex);
                }
            }

            if parent_watch_item.is_none() {
                let hashes = watchlist_slice.items_hash();
                if let Some(i) = hashes.iter().position(|h| *h == parent_dir_hash) {
                    parent_watch_item = Some(i as WatchItemIndex);
                }
            }
        }
        // Zig: `bun.handleOom(this.watchlist.ensureUnusedCapacity(...))` — abort on OOM.
        // `MultiArrayList::ensure_unused_capacity` returns `Err(AllocError)` on
        // allocation failure (does NOT abort), so discarding it would let the
        // following `append_assume_capacity` write past capacity.
        self.watchlist
            .ensure_unused_capacity(1 + usize::from(parent_watch_item.is_none()))
            .unwrap_or_else(|_| bun_core::out_of_memory());

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

        if true {
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
        }

        if LOCK {
            self.mutex.unlock();
        }
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

    pub fn append_file<const CLONE_FILE_PATH: bool>(
        &mut self,
        fd: Fd,
        file_path: &[u8],
        hash: HashType,
        loader: Loader,
        dir_fd: Fd,
        package_json: Option<&'static PackageJSON>,
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
        file_path: &[u8],
        hash: HashType,
    ) -> sys::Result<WatchItemIndex> {
        self.mutex.lock();
        // TODO(port): use RAII guard for mutex
        let result = (|| {
            if let Some(idx) = self.index_of(hash) {
                return Ok(idx as WatchItemIndex);
            }
            // Zig: `bun.handleOom(this.watchlist.ensureUnusedCapacity(this.allocator, 1))`.
            self.watchlist
                .ensure_unused_capacity(1)
                .unwrap_or_else(|_| bun_core::out_of_memory());
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
    pub fn add_file_by_path_slow(&mut self, file_path: &[u8], loader: Loader) -> bool {
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
            let mut path_z = bun_paths::PathBuffer::uninit();
            if file_path.len() >= path_z.len() {
                return false;
            }
            path_z[..file_path.len()].copy_from_slice(file_path);
            path_z[file_path.len()] = 0;
            // SAFETY: path_z[file_path.len()] == 0 written above
            let z = unsafe { ZStr::from_raw(path_z.as_ptr(), file_path.len()) };
            match bun_sys::open(z, WATCH_OPEN_FLAGS, 0) {
                Ok(opened) => fd = opened,
                Err(_) => return false,
            }
        }

        let res = self.add_file::<true>(fd, file_path, hash, loader, Fd::INVALID, None);
        match res {
            Ok(()) => {
                #[cfg(any(target_os = "macos", target_os = "freebsd"))]
                if fd.is_valid() {
                    self.mutex.lock();
                    let maybe_idx = self.index_of(hash);
                    let stored_fd = if let Some(idx) = maybe_idx {
                        self.watchlist.items_fd()[idx as usize]
                    } else {
                        Fd::INVALID
                    };
                    self.mutex.unlock();
                    if maybe_idx.is_some() && stored_fd.native() != fd.native() {
                        let _ = bun_sys::close(fd);
                    }
                }
                true
            }
            Err(_) => {
                if fd.is_valid() {
                    let _ = bun_sys::close(fd);
                }
                false
            }
        }
    }

    pub fn add_file<const CLONE_FILE_PATH: bool>(
        &mut self,
        fd: Fd,
        file_path: &[u8],
        hash: HashType,
        loader: Loader,
        dir_fd: Fd,
        package_json: Option<&'static PackageJSON>,
    ) -> sys::Result<()> {
        // This must lock due to concurrent transpiler
        self.mutex.lock();

        if let Some(index) = self.index_of(hash) {
            if feature_flags::ATOMIC_FILE_WATCHER {
                // On Linux, the file descriptor might be out of date.
                if fd.is_valid() {
                    let fds = self.watchlist.items_fd_mut();
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
        for (i, other) in self.watchlist.items_hash().iter().enumerate() {
            if hash == *other {
                return Some(i as u32);
            }
        }
        None
    }

    pub fn remove(&mut self, hash: HashType) {
        self.mutex.lock();
        if let Some(index) = self.index_of(hash) {
            self.remove_at_index(WatchItemKind::File, index as WatchItemIndex, hash, &[]);
        }
        self.mutex.unlock();
    }

    // PORT NOTE: Zig used a comptime `kind: Kind` param. Rust const-generic
    // enum params need `adt_const_params` (nightly); the value is only
    // compared to `.Directory`, so a plain runtime parameter is fine.
    pub fn remove_at_index(
        &mut self,
        kind: WatchItemKind,
        index: WatchItemIndex,
        hash: HashType,
        parents: &[HashType],
    ) {
        debug_assert!(index != NO_WATCH_ITEM);

        self.evict_list[self.evict_list_i as usize] = index;
        self.evict_list_i += 1;

        if kind == WatchItemKind::Directory {
            for &parent in parents {
                if parent == hash {
                    self.evict_list[self.evict_list_i as usize] = parent as WatchItemIndex;
                    self.evict_list_i += 1;
                }
            }
        }
    }

    pub fn get_resolve_watcher(&mut self) -> AnyResolveWatcher {
        unsafe fn wrap(ctx: *mut (), dir_path: &[u8], dir_fd: Fd) {
            // SAFETY: ctx was stored from *mut Watcher in get_resolve_watcher()
            let this = unsafe { &mut *ctx.cast::<Watcher>() };
            Watcher::on_maybe_watch_directory(this, dir_path, dir_fd);
        }
        AnyResolveWatcher {
            context: std::ptr::from_mut::<Self>(self).cast::<()>(),
            callback: wrap,
        }
    }

    pub fn on_maybe_watch_directory(watch: &mut Self, file_path: &[u8], dir_fd: Fd) {
        // We don't want to watch:
        // - Directories outside the root directory
        // - Directories inside node_modules
        if !strings::contains(file_path, b"node_modules")
            && strings::contains(file_path, watch.top_level_dir())
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
    pub fn names<'b>(self, buf: &'b [ChangedFilePath]) -> &'b [ChangedFilePath] {
        if self.name_len == 0 {
            return &[];
        }
        &buf[self.name_off as usize..][..self.name_len as usize]
    }

    pub fn sort_by_index(event: &WatchEvent, rhs: &WatchEvent) -> core::cmp::Ordering {
        event.index.cmp(&rhs.index)
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

/// Lowercase Zig-field-name mapping for `Op` (matches `std.meta.fields(Op)` output).
pub const OP_NAMES: &[(Op, &str)] = &[
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
    pub loader: Loader,
    pub fd: Fd,
    pub count: u32,
    pub parent_hash: u32,
    pub kind: WatchItemKind,
    pub package_json: Option<&'static PackageJSON>,
    #[cfg(target_os = "linux")]
    pub eventlist_index: platform::EventListIndex,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WatchItemKind {
    File,
    Directory,
}

/// Typed SoA column accessors — thin safe wrappers over the reflection-backed
/// `MultiArrayList::items::<"name", T>()` so callers don't repeat the type.
/// Implemented locally so callers can write `watchlist.items_fd()` instead of
/// the unsafe generic `Slice::items::<F>(field)`.
pub trait WatchItemColumns {
    fn items_file_path(&self) -> &[Cow<'static, [u8]>];
    fn items_hash(&self) -> &[u32];
    fn items_fd(&self) -> &[Fd];
    fn items_fd_mut(&mut self) -> &mut [Fd];
    fn items_parent_hash(&self) -> &[u32];
    fn items_kind(&self) -> &[WatchItemKind];
    #[cfg(target_os = "linux")]
    fn items_eventlist_index(&self) -> &[platform::EventListIndex];
}

impl WatchItemColumns for WatchList {
    fn items_file_path(&self) -> &[Cow<'static, [u8]>] {
        self.items::<"file_path", Cow<'static, [u8]>>()
    }
    fn items_hash(&self) -> &[u32] {
        self.items::<"hash", u32>()
    }
    fn items_fd(&self) -> &[Fd] {
        self.items::<"fd", Fd>()
    }
    fn items_fd_mut(&mut self) -> &mut [Fd] {
        self.items_mut::<"fd", Fd>()
    }
    fn items_parent_hash(&self) -> &[u32] {
        self.items::<"parent_hash", u32>()
    }
    fn items_kind(&self) -> &[WatchItemKind] {
        self.items::<"kind", WatchItemKind>()
    }
    #[cfg(target_os = "linux")]
    fn items_eventlist_index(&self) -> &[platform::EventListIndex] {
        self.items::<"eventlist_index", platform::EventListIndex>()
    }
}

impl WatchItemColumns for bun_collections::multi_array_list::Slice<WatchItem> {
    fn items_file_path(&self) -> &[Cow<'static, [u8]>] {
        self.items::<"file_path", Cow<'static, [u8]>>()
    }
    fn items_hash(&self) -> &[u32] {
        self.items::<"hash", u32>()
    }
    fn items_fd(&self) -> &[Fd] {
        self.items::<"fd", Fd>()
    }
    fn items_fd_mut(&mut self) -> &mut [Fd] {
        self.items_mut::<"fd", Fd>()
    }
    fn items_parent_hash(&self) -> &[u32] {
        self.items::<"parent_hash", u32>()
    }
    fn items_kind(&self) -> &[WatchItemKind] {
        self.items::<"kind", WatchItemKind>()
    }
    #[cfg(target_os = "linux")]
    fn items_eventlist_index(&self) -> &[platform::EventListIndex] {
        self.items::<"eventlist_index", platform::EventListIndex>()
    }
}

// ported from: src/watcher/Watcher.zig
