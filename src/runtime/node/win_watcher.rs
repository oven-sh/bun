//! Windows-only filesystem watcher backed by libuv `uv_fs_event_t`.

#![cfg(windows)]

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::ptr;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{String as BunString, ZStr};
use bun_jsc as jsc;
use bun_jsc::JsCell;
use bun_paths::PathBuffer;
use bun_sys as sys;
use bun_sys::ReturnCodeExt as _;
use bun_sys::windows::libuv as uv;
use bun_sys::windows::libuv::UvHandle as _;
use bun_threading::Mutex;

use super::node_fs_watcher::WatchEventKind;
use crate::node::node_fs_watcher::{Event, FSWatcher, StringOrBytesToDecode};
use bun_ptr::BackRef;

bun_output::declare_scope!(PathWatcherManager, visible);
// Rust identifiers cannot contain '.', so
// the static is declared by hand (instead of via `declare_scope!`) with the
// tag string, keeping `BUN_DEBUG_fs.watch` env matching and the
// `[fs.watch]` log prefix.
#[allow(non_upper_case_globals)]
pub(crate) static fs_watch: bun_output::ScopedLogger =
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
// NOTE: the manager binds to one VM's `uv_loop`, so it is a per-VM resource —
// `watch()` allocates a fresh manager whenever the caller's `vm` differs from
// the one stored here (last caller wins the slot), so a Worker never mutates
// another VM's manager or drives its uv_loop cross-thread. Promoting this to
// true per-VM storage (e.g. `RareData`) is the longer-term fix.
static DEFAULT_MANAGER: bun_core::AtomicCell<*mut PathWatcherManager> =
    bun_core::AtomicCell::new(ptr::null_mut());
static DEFAULT_MANAGER_MUTEX: Mutex = Mutex::new();

// TODO: make this a generic so we can reuse code with path_watcher
// TODO: we probably should use native instead of libuv abstraction here for better performance
pub(crate) struct PathWatcherManager {
    // Keys are owned path bytes, values are raw heap
    // PathWatcher ptrs. `StringArrayHashMap` lets `get`/`insert` take `&[u8]` borrows.
    watchers: JsCell<StringArrayHashMap<*mut PathWatcher>>,
    // LIFETIMES.tsv: JSC_BORROW → `&VirtualMachine`. The manager is heap-allocated and stored in a
    // process-global, so we spell the borrow as `'static`; soundness relies on
    // the owning VM outliving the manager (watchers are torn down before the VM).
    vm: &'static jsc::VirtualMachineRef,
    deinit_on_last_watcher: Cell<bool>,
}

impl PathWatcherManager {
    fn init(vm: &'static jsc::VirtualMachineRef) -> *mut PathWatcherManager {
        bun_core::heap::into_raw(Box::new(PathWatcherManager {
            watchers: JsCell::new(StringArrayHashMap::default()),
            vm,
            // A manager can be displaced from `DEFAULT_MANAGER` by a `watch()`
            // call from a different VM; without this the displaced manager
            // would never be freed. Set here — on the owning thread, before the
            // pointer is published — to avoid a cross-thread write at
            // displacement time.
            deinit_on_last_watcher: Cell::new(true),
        }))
    }

    fn unregister_watcher(this: *mut PathWatcherManager, watcher: *mut PathWatcher, path: &ZStr) {
        #[cfg(not(debug_assertions))]
        let _ = path;
        let should_deinit = {
            // SAFETY: `this` is the live heap pointer produced by `init`; the
            // borrow ends before `deinit` may free it.
            let me = unsafe { &*this };
            me.watchers.with_mut(|watchers| {
                if let Some(index) = watchers.values().iter().position(|&w| w == watcher) {
                    #[cfg(debug_assertions)]
                    {
                        if !path.as_bytes().is_empty() {
                            debug_assert!(&*watchers.keys()[index] == path.as_bytes());
                        }
                    }

                    // Key is `Box<[u8]>`; swap_remove drops it (replaces `allocator.free(keys[index])`).
                    watchers.swap_remove_at(index);
                }
            });
            me.deinit_on_last_watcher.get() && me.watchers.get().len() == 0
        };
        if should_deinit {
            // SAFETY: `this` was heap-allocated in `init`; no borrow of it is live here.
            unsafe { Self::deinit(this) };
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

        {
            // SAFETY: caller guarantees `this` is a live heap-allocated pointer (see `init`);
            // the borrow ends before the free below.
            let me = unsafe { &*this };

            if me.watchers.get().len() != 0 {
                me.deinit_on_last_watcher.set(true);
                return;
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
    handle: uv::uv_fs_event_t,
    // LIFETIMES.tsv: BACKREF → Option<*mut PathWatcherManager>
    manager: Cell<Option<*mut PathWatcherManager>>,
    emit_in_progress: Cell<bool>,
    /// The JS `FSWatcher`s sharing this watch, keyed by address. Each removes
    /// itself (drops its [`Registration`]) before it goes away.
    handlers: JsCell<ArrayHashMap<usize, (BackRef<FSWatcher>, ChangeEvent)>>,
}

#[inline]
fn handler_key(owner: &FSWatcher) -> usize {
    core::ptr::from_ref(owner) as usize
}

#[derive(Clone, Copy)]
pub(crate) struct ChangeEvent {
    hash: bun_watcher::HashType,
    event_type: WatchEventKind,
    timestamp: u64,
}

impl Default for ChangeEvent {
    fn default() -> Self {
        Self {
            hash: 0,
            event_type: WatchEventKind::Change,
            timestamp: 0,
        }
    }
}

impl ChangeEvent {
    fn emit(
        &mut self,
        hash: bun_watcher::HashType,
        timestamp: u64,
        event_type: WatchEventKind,
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

impl PathWatcher {
    extern "C" fn uv_event_callback(
        event: *mut uv::uv_fs_event_t,
        filename: *const c_char,
        events: c_int,
        status: uv::ReturnCode,
    ) {
        // SAFETY: libuv guarantees `event` is the handle we registered.
        if unsafe { (*event).data }.is_null() {
            bun_core::debug_warn!("uvEventCallback called with null data");
            return;
        }
        // SAFETY: event points to PathWatcher.handle; recover the parent via offset_of.
        let this: *mut PathWatcher =
            unsafe { bun_core::from_field_ptr!(PathWatcher, handle, event) };
        // SAFETY: `this` was heap-allocated in `init` and is kept alive until
        // uv_close fires; only shared access is taken and `me` is not used past
        // any call that can free it.
        let me = unsafe { &*this };
        #[cfg(debug_assertions)]
        {
            debug_assert!(me.handle.data == this.cast::<c_void>());
        }

        // SAFETY: libuv contract — `loop_` is valid while the handle is open.
        let timestamp = unsafe { (*me.handle.loop_).time };

        if let Some(err) = status.to_error(sys::Tag::watch) {
            me.emit_in_progress.set(true);

            let keys: Vec<_> = me.handlers.get().keys().iter().copied().collect();
            for key in keys {
                let Some(owner) = me.handlers.get().get(&key).map(|(owner, _)| *owner) else {
                    continue;
                };
                owner.on_path_update_windows(
                    Event::Error {
                        err: err.clone(),
                        close: true,
                    },
                    false,
                );
                owner.on_update_end();
            }

            me.emit_in_progress.set(false);
            Self::maybe_deinit(this);
            return;
        }

        let event_type = if events & uv::UV_RENAME != 0 {
            WatchEventKind::Rename
        } else {
            WatchEventKind::Change
        };

        if filename.is_null() {
            // ReadDirectoryChangesW overflowed and changes were lost (always
            // UV_CHANGE), or libuv could not convert the name to UTF-8.
            // Forward `(event, null)` to every handler like node, unsuppressed.
            me.emit_in_progress.set(true);
            let keys: Vec<_> = me.handlers.get().keys().iter().copied().collect();
            for key in keys {
                let Some(owner) = me.handlers.get().get(&key).map(|(owner, _)| *owner) else {
                    continue;
                };
                owner.on_path_update_windows(Event::NoFilename(event_type), false);
                owner.on_update_end();
            }
            me.emit_in_progress.set(false);
            Self::maybe_deinit(this);
            return;
        }
        // SAFETY: libuv passes a valid NUL-terminated string when non-null.
        let path = ZStr::from_cstr(unsafe { core::ffi::CStr::from_ptr(filename) });

        // Intentional wrap to bun_watcher::HashType
        let hash = me.handle.hash(path.as_bytes(), events, status) as bun_watcher::HashType;
        let is_file = !me.handle.is_dir();
        Self::emit(this, path.as_bytes(), hash, timestamp, is_file, event_type);
    }

    fn emit(
        this: *mut PathWatcher,
        path: &[u8],
        hash: bun_watcher::HashType,
        timestamp: u64,
        is_file: bool,
        event_type: WatchEventKind,
    ) {
        {
            // SAFETY: `this` is the live heap pointer from `init`; the borrow ends
            // before `maybe_deinit` may free it.
            let me = unsafe { &*this };
            me.emit_in_progress.set(true);
            #[cfg(debug_assertions)]
            let mut debug_count: usize = 0;

            let keys: Vec<_> = me.handlers.get().keys().iter().copied().collect();
            for key in keys {
                let Some(owner) = me.handlers.with_mut(|h| {
                    h.get_mut(&key).and_then(|(owner, change)| {
                        change.emit(hash, timestamp, event_type).then_some(*owner)
                    })
                }) else {
                    continue;
                };
                // `EventPathString` on Windows is `StringOrBytesToDecode`.
                let payload = match owner.encoding {
                    crate::node::Encoding::Utf8 => {
                        StringOrBytesToDecode::String(BunString::clone_utf8(path))
                    }
                    _ => StringOrBytesToDecode::BytesToFree(Box::<[u8]>::from(path)),
                };
                owner.on_path_update_windows(event_type.to_event(payload), is_file);
                #[cfg(debug_assertions)]
                {
                    debug_count += 1;
                }
                owner.on_update_end();
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

            me.emit_in_progress.set(false);
        }
        Self::maybe_deinit(this);
    }

    fn init(
        manager: *mut PathWatcherManager,
        path: &ZStr,
        recursive: bool,
    ) -> sys::Result<*mut PathWatcher> {
        let mut outbuf = PathBuffer::uninit();
        // Windows `sys::readlink` returns the byte length; the link target is
        // written into `outbuf[..len]` with `outbuf[len] == 0` (sys_uv NUL-terminates). Reconstruct
        // the NUL-terminated string via `ZStr::from_buf`.
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

        // SAFETY: `manager` is the live heap pointer for the calling VM's
        // manager; `watch()` holds DEFAULT_MANAGER_MUTEX, serializing this
        // registration against concurrent Worker `watch()` calls.
        let mgr = unsafe { &*manager };

        if let Some(&existing) = mgr.watchers.get().get(event_path.as_bytes()) {
            return sys::Result::Ok(existing);
        }

        let this_box = Box::new(PathWatcher {
            handle: bun_core::ffi::zeroed(),
            manager: Cell::new(Some(manager)),
            emit_in_progress: Cell::new(false),
            handlers: JsCell::new(ArrayHashMap::default()),
        });
        let this = bun_core::heap::into_raw(this_box);

        // uv_fs_event_init on Windows unconditionally returns 0 (vendor/libuv/src/win/fs-event.c).
        // bun.assert evaluates its argument before the inline early-return, so this runs in release too.
        // SAFETY: `this` is a freshly-allocated valid pointer; uv_loop comes from the VM.
        unsafe {
            // `ptr::addr_of_mut!` (not `&mut (*this).handle`): libuv stashes this pointer and
            // hands it back to `uv_event_callback`, which `from_field_ptr!`-offsets it to recover
            // the parent `PathWatcher`. Deriving via `addr_of_mut!` keeps `this`'s whole-allocation
            // provenance so that container-of access stays in-bounds under Stacked Borrows.
            let rc = uv::uv_fs_event_init(mgr.vm.uv_loop(), ptr::addr_of_mut!((*this).handle));
            debug_assert!(rc == uv::ReturnCode::zero());
            (*this).handle.data = this.cast::<c_void>();
        }

        // UV_FS_EVENT_RECURSIVE only works for Windows and OSX
        // SAFETY: `(*this).handle` was initialized by uv_fs_event_init above; event_path is NUL-terminated.
        let start_rc = unsafe {
            uv::uv_fs_event_start(
                ptr::addr_of_mut!((*this).handle),
                Some(PathWatcher::uv_event_callback),
                event_path.as_ptr().cast::<c_char>(),
                if recursive {
                    uv::UV_FS_EVENT_RECURSIVE as u32
                } else {
                    0
                },
            )
        };
        if let Some(err) = start_rc.to_error(sys::Tag::watch) {
            // Clean up the half-initialized watcher inline (see #26254). No map
            // entry was inserted yet (see reshape above), so there is nothing
            // to swap_remove here.
            // SAFETY: `this` is the freshly heap-allocated pointer above; deinit consumes it.
            unsafe {
                (*this).manager.set(None); // prevent deinit() from re-entering unregister_watcher
                PathWatcher::deinit(this);
            }
            return sys::Result::Err(err);
        }
        // we handle this in node_fs_watcher
        // SAFETY: handle is open (uv_fs_event_start succeeded); uv_unref only flips the ref flag.
        unsafe { uv::uv_unref(ptr::addr_of_mut!((*this).handle).cast()) };

        // Owned key: dupe of event_path bytes (the sentinel NUL is not part of the
        // slice's `.len`, so the StringArrayHashMap key compares equal to `event_path.as_bytes()`).
        mgr.watchers.with_mut(|watchers| {
            watchers.insert(event_path.as_bytes(), this);
        });

        sys::Result::Ok(this)
    }

    extern "C" fn uv_closed_callback(handler: *mut uv::uv_handle_t) {
        // Body discharges its own preconditions; safe `extern "C" fn` coerces
        // to libuv's `uv_close_cb` pointer type.
        bun_output::scoped_log!(fs_watch, "onClose");
        // SAFETY: `uv_fs_event_t` is `#[repr(C)]` and prefixed with `uv_handle_t` (UvHandle impl);
        // libuv passes back the same pointer registered in `uv_close`.
        let event = handler.cast::<uv::uv_fs_event_t>();
        // SAFETY: event.data was set to the PathWatcher* in `init`.
        let this = unsafe { (*event).data.cast::<PathWatcher>() };
        // SAFETY: `this` was heap-allocated in `init`.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// JS-thread entry point from [`Registration`]'s drop.
    fn detach(this: *mut PathWatcher, handler: usize) {
        // SAFETY: `this` is the live `heap::alloc`'d pointer returned from `watch()`;
        // it stays valid until `maybe_deinit` self-destroys on the last handler.
        let removed = unsafe { &*this }
            .handlers
            .with_mut(|h| h.swap_remove(&handler));
        if removed {
            Self::maybe_deinit(this);
        }
    }

    fn maybe_deinit(this: *mut PathWatcher) {
        // SAFETY: `this` is the live heap pointer from `init`; the borrow ends
        // before `deinit` may free it.
        let should_deinit = {
            let me = unsafe { &*this };
            me.handlers.get().len() == 0 && !me.emit_in_progress.get()
        };
        if should_deinit {
            // SAFETY: `this` was heap-allocated in `init`; no borrow of it is live here.
            unsafe { Self::deinit(this) };
        }
    }

    /// NOTE: not `impl Drop` — destruction is deferred through `uv_close` and the close callback
    /// frees the box, so this type is always managed via raw `*mut PathWatcher`.
    unsafe fn deinit(this: *mut PathWatcher) {
        bun_output::scoped_log!(fs_watch, "deinit");
        {
            // SAFETY: caller guarantees `this` is a live heap-allocated pointer (see `init`);
            // the borrow ends before the free below.
            let me = unsafe { &*this };
            me.handlers.with_mut(|h| h.clear());

            if let Some(manager) = me.manager.take() {
                let path: &ZStr = if !me.handle.path.is_null() {
                    // SAFETY: handle.path is a NUL-terminated C string owned by libuv.
                    ZStr::from_cstr(unsafe { core::ffi::CStr::from_ptr(me.handle.path) })
                } else {
                    ZStr::EMPTY
                };
                PathWatcherManager::unregister_watcher(manager, this, path);
            }
        }

        // `UvHandle::is_closed` reads `flags & UV_HANDLE_CLOSED` via the handle prefix.
        // SAFETY: `this` is still the live heap allocation from `init`.
        if unsafe { (*this).handle.is_closed() } {
            // SAFETY: `this` was heap-allocated in `init`.
            drop(unsafe { bun_core::heap::take(this) });
        } else {
            // SAFETY: handle is open and not yet closing; stop/close are valid in that state.
            unsafe {
                uv::uv_fs_event_stop(ptr::addr_of_mut!((*this).handle));
                uv::uv_close(
                    ptr::addr_of_mut!((*this).handle).cast(),
                    Some(PathWatcher::uv_closed_callback),
                );
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// One `FSWatcher`'s handler on a shared [`PathWatcher`]. Dropping it detaches
/// the handler (and with the last handler, the libuv watch).
pub(crate) struct Registration {
    watcher: *mut PathWatcher,
    handler: usize,
}

impl Drop for Registration {
    fn drop(&mut self) {
        PathWatcher::detach(self.watcher, self.handler);
    }
}

/// Attach `owner` to the (shared, per path) libuv watch for `path`, creating
/// it if this is the first. `owner` keeps the returned registration for as
/// long as — and no longer than — it lives at that address.
pub(crate) fn watch(
    vm: &'static jsc::VirtualMachineRef,
    path: &ZStr,
    recursive: bool,
    owner: BackRef<FSWatcher>,
) -> sys::Result<Registration> {
    #[cfg(not(windows))]
    compile_error!("win_watcher should only be used on Windows");

    // DEFAULT_MANAGER is only read/written while holding DEFAULT_MANAGER_MUTEX
    // (see static decl). The guard covers the whole registration — not just the
    // slot load — because `PathWatcher::init` below mutates the manager's
    // `watchers` map, and `fs.watch()` is reachable from Worker threads.
    let _g = DEFAULT_MANAGER_MUTEX.lock_guard();
    let existing = DEFAULT_MANAGER.load();
    // The manager is bound to one VM's uv_loop; reusing it from a different VM
    // (Worker) would mutate its watcher map and drive libuv cross-thread.
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

    let watcher = match PathWatcher::init(manager, path, recursive) {
        sys::Result::Err(err) => return sys::Result::Err(err),
        sys::Result::Ok(w) => w,
    };
    let handler = handler_key(&owner);
    // SAFETY: watcher is a valid freshly-returned heap pointer.
    unsafe { &*watcher }.handlers.with_mut(|h| {
        h.insert(handler, (owner, ChangeEvent::default()));
    });
    sys::Result::Ok(Registration { watcher, handler })
}
