//! Windows-only filesystem watcher backed by the native IOCP engine
//! (`bun_iocp::fsevent::FsEventHandle`, ReadDirectoryChangesW).

#![cfg(windows)]

use core::ffi::c_void;
use core::ptr;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{String as BunString, ZStr};
use bun_iocp::Loop;
use bun_iocp::fsevent::{FS_EVENT_RENAME, FS_EVENT_RESCAN, FsEventHandle};
use bun_jsc as jsc;
use bun_paths::{PathBuffer, string_paths};
use bun_sys as sys;
use bun_sys::windows::{Win32Error, win_error};
use bun_threading::Mutex;

use super::path_watcher::EventType;
// The callbacks are *associated functions* on `FSWatcher`, not free fns.
use crate::node::node_fs_watcher::{Event, FSWatcher, StringOrBytesToDecode};
#[allow(non_upper_case_globals)]
const on_path_update_fn: fn(Option<*mut c_void>, Event, bool) = FSWatcher::ON_PATH_UPDATE;
#[allow(non_upper_case_globals)]
const on_update_end_fn: fn(Option<*mut c_void>) = FSWatcher::on_update_end;

bun_output::declare_scope!(PathWatcherManager, visible);
// Rust identifiers cannot contain '.', so
// the static is declared by hand (instead of via `declare_scope!`) with the
// tag string, keeping `BUN_DEBUG_fs.watch` env matching and the
// `[fs.watch]` log prefix.
#[allow(non_upper_case_globals)]
pub static fs_watch: bun_output::ScopedLogger =
    bun_output::ScopedLogger::new("fs.watch", bun_output::Visibility::Visible);

// ──────────────────────────────────────────────────────────────────────────

// PORTING.md §Global mutable state: singleton ptr → `AtomicCell`, guarded by
// `DEFAULT_MANAGER_MUTEX`. `fs.watch()` is reachable from Worker JS threads
// (each Worker is its own OS thread + VM), so an unguarded read+write
// would be a data race. Mirror the posix
// `path_watcher.rs` pattern: every `DEFAULT_MANAGER` access holds the mutex.
// `AtomicCell<*mut _>` (Acquire/Release on the pointer word) means even an
// unsynchronized racing reader observes either null or a fully-published
// pointer — and lets every load/store be safe code (`RacyCell` required an
// `unsafe` block per access for the same single-word op).
//
// NOTE: the manager binds to one VM's event loop, so it is a per-VM resource —
// `watch()` allocates a fresh manager whenever the caller's `vm` differs from
// the one stored here (last caller wins the slot), so a Worker never mutates
// another VM's manager or drives its loop cross-thread. Promoting this to
// true per-VM storage (e.g. `RareData`) is the longer-term fix.
static DEFAULT_MANAGER: bun_core::AtomicCell<*mut PathWatcherManager> =
    bun_core::AtomicCell::new(ptr::null_mut());
static DEFAULT_MANAGER_MUTEX: Mutex = Mutex::new();

// TODO: make this a generic so we can reuse code with path_watcher
pub(crate) struct PathWatcherManager {
    // Keys are owned path bytes, values are raw heap
    // PathWatcher ptrs. `StringArrayHashMap` lets `get`/`insert` take `&[u8]` borrows.
    watchers: StringArrayHashMap<*mut PathWatcher>,
    // LIFETIMES.tsv: JSC_BORROW → `&VirtualMachine`. The manager is heap-allocated and stored in a
    // process-global, so we spell the borrow as `'static`; soundness relies on
    // the owning VM outliving the manager (watchers are torn down before the VM).
    vm: &'static jsc::VirtualMachineRef,
    deinit_on_last_watcher: bool,
}

impl PathWatcherManager {
    pub(crate) fn init(vm: &'static jsc::VirtualMachineRef) -> *mut PathWatcherManager {
        bun_core::heap::into_raw(Box::new(PathWatcherManager {
            watchers: StringArrayHashMap::default(),
            vm,
            // A manager can be displaced from `DEFAULT_MANAGER` by a `watch()`
            // call from a different VM; without this the displaced manager
            // would never be freed. Set here — on the owning thread, before the
            // pointer is published — to avoid a cross-thread write at
            // displacement time.
            deinit_on_last_watcher: true,
        }))
    }

    /// unregister is always called from main thread
    fn unregister_watcher(&mut self, watcher: *mut PathWatcher, path: &[u8]) {
        if let Some(index) = self.watchers.values().iter().position(|&w| w == watcher) {
            debug_assert!(&*self.watchers.keys()[index] == path);

            // Key is `Box<[u8]>`; swap_remove drops it (replaces `allocator.free(keys[index])`).
            self.watchers.swap_remove_at(index);
        }

        // No early returns above, so this runs unconditionally — and avoids the
        // overlapping `&mut self` borrow a closure-based guard would require.
        if self.deinit_on_last_watcher && self.watchers.len() == 0 {
            // SAFETY: self was heap-allocated in `init`; no other live borrows after this point.
            unsafe { Self::deinit(core::ptr::from_mut(self)) };
        }
    }

    /// Tear down the manager. Takes a raw pointer because it frees `self`.
    ///
    /// NOTE: not `impl Drop` — this type is always held via `*mut` (global static + BACKREF from
    /// PathWatcher) and self-frees via `heap::take`.
    unsafe fn deinit(this: *mut PathWatcherManager) {
        // enable to create a new manager
        {
            let _g = DEFAULT_MANAGER_MUTEX.lock_guard();
            if DEFAULT_MANAGER.load() == this {
                DEFAULT_MANAGER.store(ptr::null_mut());
            }
        }

        // SAFETY: caller guarantees `this` is a live heap-allocated pointer (see `init`).
        let me = unsafe { &mut *this };

        if me.watchers.len() != 0 {
            me.deinit_on_last_watcher = true;
            return;
        }

        for &watcher in me.watchers.values() {
            // SAFETY: watcher pointers are valid until their own deinit runs.
            unsafe {
                (*watcher).manager = None;
                PathWatcher::deinit(watcher);
            }
        }

        // Keys (`Box<[u8]>`) are dropped by the map's Drop — replaces the explicit
        // `allocator.free(path)` loop + `watchers.deinit(allocator)`.
        // SAFETY: `this` was produced by heap::alloc in `init`.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct PathWatcher {
    /// Engine watcher; heap-pinned, freed only in `fs_event_closed_callback`
    /// (the engine's close protocol — the kernel owns its buffer until then).
    handle: *mut FsEventHandle,
    /// Watched path (post-readlink, WTF-8) — the manager-map key bytes and
    /// the dedupe-hash seed.
    path: Box<[u8]>,
    // LIFETIMES.tsv: BACKREF → Option<*mut PathWatcherManager>
    manager: Option<*mut PathWatcherManager>,
    emit_in_progress: bool,
    handlers: ArrayHashMap<*mut c_void, ChangeEvent>,
}

#[derive(Clone, Copy)]
pub(crate) struct ChangeEvent {
    hash: bun_watcher::HashType,
    event_type: EventType,
    timestamp: u64,
}

impl Default for ChangeEvent {
    fn default() -> Self {
        Self {
            hash: 0,
            event_type: EventType::Change,
            timestamp: 0,
        }
    }
}

impl ChangeEvent {
    pub(crate) fn emit(
        &mut self,
        hash: bun_watcher::HashType,
        timestamp: u64,
        event_type: EventType,
    ) -> bool {
        let time_diff = timestamp.saturating_sub(self.timestamp);
        // skip consecutive exact duplicates (same path and event type) only
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

pub type Callback = fn(ctx: Option<*mut c_void>, event: Event, is_file: bool);

impl PathWatcher {
    /// Engine event callback (`FsEventCb`). `filename` is raw WTF-16,
    /// relative to the watch root, and valid only for this call.
    unsafe fn fs_event_callback(
        loop_: &mut Loop,
        data: *mut c_void,
        filename: &[u16],
        events: u32,
        err: Win32Error,
    ) {
        // SAFETY: `data` is the heap-pinned PathWatcher registered in `init`;
        // the engine fires no callback after stop/close, so it is live here.
        let this = unsafe { &mut *data.cast::<PathWatcher>() };

        if err != Win32Error::SUCCESS {
            // Terminal: the engine parks the watcher; the JS side closes in
            // response to the error event, which detaches handlers → deinit.
            let error = sys::Error::new(win_error::translate(err), sys::Tag::watch);
            this.emit_in_progress = true;

            for &ctx in this.handlers.keys() {
                on_path_update_fn(Some(ctx), Event::Error(error.clone()), false);
                on_update_end_fn(Some(ctx));
            }

            // The guard is still `true` when `maybe_deinit` checks it (always a no-op there).
            this.maybe_deinit();
            this.emit_in_progress = false;
            return;
        }

        // SAFETY: the engine handle outlives every event callback (freed only
        // after its close callback runs).
        let is_file = !unsafe { (*this.handle).is_directory_watch() };

        if events & FS_EVENT_RESCAN != 0 {
            // Overflow: changes were LOST. Deliver Node's rescan signal —
            // 'change' with filename === null — to every handler, bypassing the
            // ChangeEvent dedupe so no rescan is collapsed. // quirk: SIGEV-43
            this.emit_in_progress = true;
            for &ctx in this.handlers.keys() {
                on_path_update_fn(
                    Some(ctx),
                    Event::Change(StringOrBytesToDecode::BytesToFree(Box::default())),
                    is_file,
                );
                on_update_end_fn(Some(ctx));
            }
            this.emit_in_progress = false;
            this.maybe_deinit();
            return;
        }

        // The engine's name slice dies with this callback: encode to WTF-8
        // (lone surrogates preserved) before queuing. // quirk: SIGEV-50
        let mut name: Vec<u8> = Vec::new();
        bun_core::strings::convert_wtf16_to_wtf8_append(&mut name, filename);

        let timestamp = loop_.now_ms();
        // Intentional wrap to bun_watcher::HashType
        let hash = this.event_hash(&name, events) as bun_watcher::HashType;
        this.emit(
            &name,
            hash,
            timestamp,
            is_file,
            if events & FS_EVENT_RENAME != 0 {
                EventType::Rename
            } else {
                EventType::Change
            },
        );
    }

    /// Wyhash over the watched path, event bits, and event filename — the
    /// per-handler dedupe key fed to [`ChangeEvent::emit`].
    fn event_hash(&self, filename: &[u8], events: u32) -> u64 {
        let mut hasher = bun_wyhash::Wyhash::init(0);
        hasher.update(&self.path);
        hasher.update(&events.to_ne_bytes());
        hasher.update(filename);
        hasher.final_()
    }

    pub(crate) fn emit(
        &mut self,
        path: &[u8],
        hash: bun_watcher::HashType,
        timestamp: u64,
        is_file: bool,
        event_type: EventType,
    ) {
        self.emit_in_progress = true;
        #[cfg(debug_assertions)]
        let mut debug_count: usize = 0;

        for i in 0..self.handlers.len() {
            let event = &mut self.handlers.values_mut()[i];
            if event.emit(hash, timestamp, event_type) {
                let ctx: *mut FSWatcher = self.handlers.keys()[i].cast::<FSWatcher>();
                // SAFETY: handlers keys are `*mut FSWatcher` erased to `*mut c_void` in `watch()`.
                let encoding = unsafe { (*ctx).encoding };
                // `EventPathString` on Windows is `StringOrBytesToDecode`.
                let payload = match encoding {
                    crate::node::Encoding::Utf8 => {
                        StringOrBytesToDecode::String(BunString::clone_utf8(path))
                    }
                    _ => StringOrBytesToDecode::BytesToFree(Box::<[u8]>::from(path)),
                };
                on_path_update_fn(Some(ctx.cast()), event_type.to_event(payload), is_file);
                #[cfg(debug_assertions)]
                {
                    debug_count += 1;
                }
                on_update_end_fn(Some(ctx.cast()));
            }
        }

        #[cfg(debug_assertions)]
        bun_output::scoped_log!(
            fs_watch,
            "emit({}, {}, {}, at {}) x {}",
            bstr::BStr::new(path),
            if is_file { "file" } else { "dir" },
            <&'static str>::from(event_type),
            timestamp,
            debug_count,
        );

        self.emit_in_progress = false;
        self.maybe_deinit();
    }

    pub(crate) fn init(
        manager: &mut PathWatcherManager,
        path: &ZStr,
        recursive: bool,
    ) -> sys::Result<*mut PathWatcher> {
        let mut outbuf = PathBuffer::uninit();
        // Windows `sys::readlink` returns the byte length; the link target is
        // written into `outbuf[..len]` with `outbuf[len] == 0` (the wrapper
        // NUL-terminates). Reconstruct the string via `ZStr::from_buf`.
        let readlink_result = sys::readlink(path, &mut outbuf);
        let event_path: &ZStr = match readlink_result {
            sys::Result::Err(err) => 'brk: {
                if err.errno == sys::E::NOENT as _ {
                    return sys::Result::Err(sys::Error {
                        errno: err.errno,
                        syscall: sys::Tag::open,
                        ..Default::default()
                    });
                }
                break 'brk path;
            }
            sys::Result::Ok(len) => ZStr::from_buf(outbuf.as_slice(), len),
        };

        // BACKREF field stays raw (LIFETIMES.tsv); capture the pointer once before further &mut use.
        let manager_ptr: *mut PathWatcherManager = manager as *mut PathWatcherManager;

        if let Some(&existing) = manager.watchers.get(event_path.as_bytes()) {
            return sys::Result::Ok(existing);
        }

        // The engine takes UTF-16 verbatim (no `\\?\` rewrite), so reported
        // event names keep the user's path spelling.
        if !string_paths::fits_in_wide_path_buffer(event_path.as_bytes()) {
            return sys::Result::Err(sys::Error::new(sys::E::NAMETOOLONG, sys::Tag::watch));
        }
        let mut wbuf = bun_paths::os_path_buffer_pool::get();
        let wide = string_paths::to_w_path(&mut *wbuf, event_path.as_bytes());

        // SAFETY: `uws_loop` is the calling VM's live loop pointer; the loop
        // outlives every watcher (watchers are torn down before the VM).
        let lp = unsafe { bun_iocp::usockets::native_loop(manager.vm.uws_loop().cast()) };
        // SAFETY: `lp` outlives the handle (above); the box stays alive until
        // `fs_event_closed_callback` frees it (engine close protocol).
        let handle = bun_core::heap::into_raw(unsafe { FsEventHandle::new(lp) });

        let this = bun_core::heap::into_raw(Box::new(PathWatcher {
            handle,
            path: Box::from(event_path.as_bytes()),
            manager: Some(manager_ptr),
            emit_in_progress: false,
            handlers: ArrayHashMap::default(),
        }));

        // SAFETY: `handle`/`this` are live heap pointers; `this` stays valid
        // for every event callback until the close callback frees it.
        let start_result = unsafe {
            (*handle).start(
                wide.as_slice(),
                recursive,
                PathWatcher::fs_event_callback,
                this.cast::<c_void>(),
            )
        };
        if let Err(w) = start_result {
            // Clean up the half-initialized watcher inline (see #26254). No map
            // entry was inserted yet (see reshape above), so there is nothing
            // to swap_remove here.
            // SAFETY: `this` is the freshly heap-allocated pointer above; deinit consumes it.
            unsafe {
                (*this).manager = None; // prevent deinit() from re-entering unregister_watcher
                PathWatcher::deinit(this);
            }
            return sys::Result::Err(sys::Error::new(win_error::translate(w), sys::Tag::watch));
        }
        // we handle keep-alive in node_fs_watcher
        // SAFETY: handle is live and started; unref only drops the loop keep-alive.
        unsafe { (*handle).unref() };

        // Owned key: dupe of event_path bytes (the sentinel NUL is not part of the
        // slice's `.len`, so the StringArrayHashMap key compares equal to `event_path.as_bytes()`).
        manager.watchers.insert(event_path.as_bytes(), this);

        sys::Result::Ok(this)
    }

    /// Engine close callback: the in-flight RDCW (if any) has drained, so
    /// freeing the handle box — and the watcher that owns it — is now safe.
    unsafe fn fs_event_closed_callback(_loop: &mut Loop, data: *mut c_void) {
        bun_output::scoped_log!(fs_watch, "onClose");
        let this = data.cast::<PathWatcher>();
        // SAFETY: `data` was set to the heap-pinned PathWatcher in `deinit`;
        // both boxes were heap-allocated in `init` and are freed exactly here.
        unsafe {
            bun_core::heap::destroy((*this).handle);
            bun_core::heap::destroy(this);
        }
    }

    /// JS-thread entry point from `FSWatcher.detach()`. Signature matches the posix
    /// `path_watcher::PathWatcher::detach` (associated fn over `*mut Self`) so the
    /// caller in `node_fs_watcher.rs` is platform-agnostic.
    pub(crate) fn detach(this: *mut PathWatcher, handler: *mut c_void) {
        // SAFETY: `this` is the live `heap::alloc`'d pointer returned from `watch()`;
        // it stays valid until `maybe_deinit` self-destroys on the last handler.
        let me = unsafe { &mut *this };
        if me.handlers.swap_remove(&handler) {
            me.maybe_deinit();
        }
    }

    fn maybe_deinit(&mut self) {
        if self.handlers.len() == 0 && !self.emit_in_progress {
            // SAFETY: self was heap-allocated in `init`; no other live borrows after this point.
            unsafe { Self::deinit(core::ptr::from_mut(self)) };
        }
    }

    /// NOTE: not `impl Drop` — destruction is deferred through the engine's
    /// close protocol; `fs_event_closed_callback` frees the boxes, so this
    /// type is always managed via raw `*mut PathWatcher`.
    unsafe fn deinit(this: *mut PathWatcher) {
        bun_output::scoped_log!(fs_watch, "deinit");
        // SAFETY: caller guarantees `this` is a live heap-allocated pointer (see `init`).
        let me = unsafe { &mut *this };
        me.handlers.clear();

        if let Some(manager) = me.manager.take() {
            // SAFETY: manager backref is valid until the manager deinits (see PathWatcherManager::deinit).
            unsafe { (*manager).unregister_watcher(this, &me.path) };
        }

        // stop() is synchronously effective (no event callback after it);
        // close() defers the frees to `fs_event_closed_callback` once the
        // in-flight completion drains. Deinit runs once, so close is too.
        // SAFETY: `me.handle` is the live engine handle owned by this watcher.
        unsafe {
            (*me.handle).stop();
            (*me.handle).close(
                Some(PathWatcher::fs_event_closed_callback),
                this.cast::<c_void>(),
            );
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub fn watch(
    vm: &'static jsc::VirtualMachineRef,
    path: &ZStr,
    recursive: bool,
    ctx: *mut c_void,
) -> sys::Result<*mut PathWatcher> {
    #[cfg(not(windows))]
    compile_error!("win_watcher should only be used on Windows");

    // DEFAULT_MANAGER is only read/written while holding DEFAULT_MANAGER_MUTEX
    // (see static decl). The guard covers the whole registration — not just the
    // slot load — because `PathWatcher::init` below mutates the manager's
    // `watchers` map, and `fs.watch()` is reachable from Worker threads: two
    // Workers releasing the lock before that mutation would alias `&mut *manager`.
    let _g = DEFAULT_MANAGER_MUTEX.lock_guard();
    let existing = DEFAULT_MANAGER.load();
    // The manager is bound to one VM's event loop; reusing it from a different
    // VM (Worker) would mutate its watcher map and drive the loop cross-thread.
    // Allocate a fresh manager for this VM instead; the displaced one frees
    // itself once its last watcher unregisters (`deinit_on_last_watcher`).
    // SAFETY: `existing` is a non-null pointer published under
    // DEFAULT_MANAGER_MUTEX (which we hold) by `init` below on a prior call;
    // the allocation lives until `deinit` clears the slot, so it is valid here.
    // `vm` is written once at construction and never mutated, so reading it
    // cannot race with the owning VM's thread.
    let manager = if existing.is_null() || !core::ptr::eq(unsafe { (*existing).vm }, vm) {
        let m = PathWatcherManager::init(vm);
        DEFAULT_MANAGER.store(m);
        m
    } else {
        existing
    };

    // SAFETY: `manager` is a live heap-allocated pointer bound to the calling
    // VM (created above or matched by `vm`). All other mutation of this manager
    // happens on this VM's thread, and concurrent `watch()` calls from other
    // Workers are serialized by DEFAULT_MANAGER_MUTEX (still held here), so
    // this `&mut` is unaliased for the call.
    let watcher = match PathWatcher::init(unsafe { &mut *manager }, path, recursive) {
        sys::Result::Err(err) => return sys::Result::Err(err),
        sys::Result::Ok(w) => w,
    };
    // SAFETY: watcher is a valid freshly-returned heap pointer.
    unsafe {
        (*watcher).handlers.insert(ctx, ChangeEvent::default());
    }
    sys::Result::Ok(watcher)
}
