//! Windows-only filesystem watcher backed by libuv `uv_fs_event_t`.
//!
//! Port of `src/runtime/node/win_watcher.zig`.

#![cfg(windows)]

use core::ffi::{c_char, c_int, c_void};
use core::ptr;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::Output;
use bun_core::{String as BunString, ZStr, strings};
use bun_jsc as jsc;
use bun_paths::PathBuffer;
use bun_sys::ReturnCodeExt as _;
use bun_sys::windows::libuv as uv;
use bun_sys::windows::libuv::UvHandle as _;
use bun_sys::{self as sys, windows};
use bun_threading::Mutex;

use super::path_watcher::EventType;
// Zig: `const onPathUpdateFn = jsc.Node.fs.Watcher.onPathUpdate;` (win_watcher.zig:306) —
// the callbacks are *associated functions* on `FSWatcher`, not free fns.
// lower_snake names mirror the Zig `onPathUpdateFn`/`onUpdateEndFn` decls.
use crate::node::node_fs_watcher::{Event, FSWatcher, StringOrBytesToDecode};
#[allow(non_upper_case_globals)]
const on_path_update_fn: fn(Option<*mut c_void>, Event, bool) = FSWatcher::ON_PATH_UPDATE;
#[allow(non_upper_case_globals)]
const on_update_end_fn: fn(Option<*mut c_void>) = FSWatcher::on_update_end;
// TODO(port): confirm crate for `bun.Watcher` → assuming `bun_watcher`.
use bun_watcher::Watcher;

bun_output::declare_scope!(PathWatcherManager, visible);
// Zig scope name is `.@"fs.watch"`; Rust identifiers cannot contain '.'.
// TODO(port): declare_scope! should accept the original "fs.watch" string for BUN_DEBUG env matching.
bun_output::declare_scope!(fs_watch, visible);

// ──────────────────────────────────────────────────────────────────────────

// PORTING.md §Global mutable state: singleton ptr → `AtomicCell`, guarded by
// `DEFAULT_MANAGER_MUTEX`. `fs.watch()` is reachable from Worker JS threads
// (each Worker is its own OS thread + VM), so the unguarded read+write the
// Zig original gets away with is a data race in Rust. Mirror the posix
// `path_watcher.rs` pattern: every `DEFAULT_MANAGER` access holds the mutex.
// `AtomicCell<*mut _>` (Acquire/Release on the pointer word) means even an
// unsynchronized racing reader observes either null or a fully-published
// pointer — and lets every load/store be safe code (`RacyCell` required an
// `unsafe` block per access for the same single-word op).
//
// NOTE: the manager binds to one VM's `uv_loop`, so even with the mutex this
// remains a per-VM resource — `watch()` debug-asserts the caller's `vm`
// matches the stored one. Promoting this to per-VM storage (e.g. `RareData`)
// is the longer-term fix; the mutex closes the UB window meanwhile.
static DEFAULT_MANAGER: bun_core::AtomicCell<*mut PathWatcherManager> =
    bun_core::AtomicCell::new(ptr::null_mut());
static DEFAULT_MANAGER_MUTEX: Mutex = Mutex::new();

// TODO: make this a generic so we can reuse code with path_watcher
// TODO: we probably should use native instead of libuv abstraction here for better performance
pub struct PathWatcherManager {
    // Keys are owned path bytes (Zig: `bun.StringArrayHashMapUnmanaged`), values are raw heap
    // PathWatcher ptrs. `StringArrayHashMap` lets `get`/`insert` take `&[u8]` borrows.
    watchers: StringArrayHashMap<*mut PathWatcher>,
    // LIFETIMES.tsv: JSC_BORROW → `&VirtualMachine`. The manager is heap-allocated and stored in a
    // process-global, so we spell the borrow as `'static`.
    // TODO(port): revisit once VirtualMachine lifetime plumbing lands in bun_jsc.
    vm: &'static jsc::VirtualMachineRef,
    deinit_on_last_watcher: bool,
}

impl PathWatcherManager {
    pub fn init(vm: &'static jsc::VirtualMachineRef) -> *mut PathWatcherManager {
        bun_core::heap::into_raw(Box::new(PathWatcherManager {
            watchers: StringArrayHashMap::default(),
            vm,
            deinit_on_last_watcher: false,
        }))
    }

    /// unregister is always called from main thread
    fn unregister_watcher(&mut self, watcher: *mut PathWatcher, path: &ZStr) {
        if let Some(index) = self.watchers.values().iter().position(|&w| w == watcher) {
            #[cfg(debug_assertions)]
            {
                if !path.as_bytes().is_empty() {
                    debug_assert!(&*self.watchers.keys()[index] == path.as_bytes());
                }
            }

            // Key is `Box<[u8]>`; swap_remove drops it (replaces `allocator.free(keys[index])`).
            self.watchers.swap_remove_at(index);
        }

        // Zig: `defer { if (deinit_on_last_watcher and count == 0) this.deinit(); }`.
        // No early returns above, so this runs in the same place a defer would — and avoids the
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
    handle: uv::uv_fs_event_t,
    // LIFETIMES.tsv: BACKREF → Option<*mut PathWatcherManager>
    manager: Option<*mut PathWatcherManager>,
    emit_in_progress: bool,
    handlers: ArrayHashMap<*mut c_void, ChangeEvent>,
}

#[derive(Clone, Copy)]
pub struct ChangeEvent {
    hash: bun_watcher::HashType,
    event_type: EventType,
    timestamp: u64,
}

impl Default for ChangeEvent {
    fn default() -> Self {
        // Match Zig field defaults: `hash = 0`, `event_type = .change`, `timestamp = 0`.
        Self {
            hash: 0,
            event_type: EventType::Change,
            timestamp: 0,
        }
    }
}

impl ChangeEvent {
    pub fn emit(
        &mut self,
        hash: bun_watcher::HashType,
        timestamp: u64,
        event_type: EventType,
    ) -> bool {
        let time_diff = timestamp.saturating_sub(self.timestamp);
        // skip consecutive duplicates
        if (self.timestamp == 0 || time_diff > 1)
            || (self.event_type != event_type && self.hash != hash)
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
pub type UpdateEndCallback = fn(ctx: Option<*mut c_void>);

impl PathWatcher {
    extern "C" fn uv_event_callback(
        event: *mut uv::uv_fs_event_t,
        filename: *const c_char,
        events: c_int,
        status: uv::ReturnCode,
    ) {
        // SAFETY: libuv guarantees `event` is the handle we registered; read `.data`
        // through the raw pointer so we don't form a `&mut uv_fs_event_t` that would
        // alias the `&mut PathWatcher` we derive below (Stacked Borrows).
        if unsafe { (*event).data }.is_null() {
            Output::debug_warn("uvEventCallback called with null data");
            return;
        }
        // SAFETY: event points to PathWatcher.handle; recover the parent via offset_of.
        let this: *mut PathWatcher =
            unsafe { bun_core::from_field_ptr!(PathWatcher, handle, event) };
        // SAFETY: `this` was heap-allocated in `init` and is kept alive until uv_close fires.
        // This is the *only* live `&mut` covering the embedded handle for the rest of this fn.
        let this = unsafe { &mut *this };
        #[cfg(debug_assertions)]
        {
            debug_assert!(this.handle.data == this as *mut PathWatcher as *mut c_void);
        }

        // SAFETY: libuv contract — `loop_` is valid while the handle is open.
        let timestamp = unsafe { (*this.handle.loop_).time };

        if let Some(err) = status.to_error(sys::Tag::watch) {
            this.emit_in_progress = true;

            for &ctx in this.handlers.keys() {
                // Zig: `bun.sys.Error` is a value type — implicitly copied per handler.
                on_path_update_fn(Some(ctx), Event::Error(err.clone()), false);
                on_update_end_fn(Some(ctx));
            }

            // Zig: `defer this.emit_in_progress = false;` fires AFTER `this.maybeDeinit()`, so
            // the guard is still `true` when `maybeDeinit` checks it (always a no-op there).
            this.maybe_deinit();
            this.emit_in_progress = false;
            return;
        }

        let Some(path) = (if filename.is_null() {
            None
        } else {
            // SAFETY: libuv passes a valid NUL-terminated string when non-null.
            Some(ZStr::from_cstr(unsafe {
                core::ffi::CStr::from_ptr(filename)
            }))
        }) else {
            return;
        };

        // @truncate — intentional wrap to bun_watcher::HashType
        let hash = this.handle.hash(path.as_bytes(), events, status) as bun_watcher::HashType;
        let is_file = !this.handle.is_dir();
        this.emit(
            path.as_bytes(),
            hash,
            timestamp,
            is_file,
            if events & uv::UV_RENAME != 0 {
                EventType::Rename
            } else {
                EventType::Change
            },
        );
    }

    pub fn emit(
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

        // PORT NOTE: reshaped for borrowck — Zig iterates `values()` while indexing `keys()[i]`;
        // here we snapshot `keys()` length-contract via index iteration.
        for i in 0..self.handlers.len() {
            let event = &mut self.handlers.values_mut()[i];
            if event.emit(hash, timestamp, event_type) {
                let ctx: *mut FSWatcher = self.handlers.keys()[i].cast::<FSWatcher>();
                // SAFETY: handlers keys are `*mut FSWatcher` erased to `*mut c_void` in `watch()`.
                let encoding = unsafe { (*ctx).encoding };
                // Zig builds the tagged payload `{ .string | .bytes_to_free }` then calls
                // `event_type.toEvent(..)` — `EventPathString` on Windows is `StringOrBytesToDecode`.
                let payload = match encoding {
                    crate::node::Encoding::Utf8 => {
                        StringOrBytesToDecode::String(BunString::clone_utf8(path))
                    }
                    // Zig: `bun.default_allocator.dupeZ(u8, path)` — owned copy; the trailing NUL is
                    // a sentinel only (slice `.len` excludes it), so `Box<[u8]>::from(path)` is the
                    // semantic equivalent for the Rust `BytesToFree` payload.
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

    pub fn init(
        manager: &mut PathWatcherManager,
        path: &ZStr,
        recursive: bool,
    ) -> sys::Result<*mut PathWatcher> {
        let mut outbuf = PathBuffer::uninit();
        // Windows `sys::readlink` returns the byte length (`Maybe<usize>`); the link target is
        // written into `outbuf[..len]` with `outbuf[len] == 0` (sys_uv NUL-terminates). Reconstruct
        // the `[:0]const u8` Zig sees from `Maybe([:0]u8)` via `ZStr::from_buf`.
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

        // PORT NOTE: reshaped for borrowck — Zig uses `getOrPut` with a borrowed key, then
        // overwrites `key_ptr.*` with an owned dupe on the not-found path. Rust maps own their
        // keys, so we do lookup-then-insert instead.
        if let Some(&existing) = manager.watchers.get(event_path.as_bytes()) {
            return sys::Result::Ok(existing);
        }

        let this_box = Box::new(PathWatcher {
            handle: bun_core::ffi::zeroed(),
            manager: Some(manager_ptr),
            emit_in_progress: false,
            handlers: ArrayHashMap::default(),
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
            let rc = uv::uv_fs_event_init(manager.vm.uv_loop(), ptr::addr_of_mut!((*this).handle));
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
            // `errdefer` doesn't fire on `return .{ .err = ... }` (that's a successful return of a
            // Maybe(T), not an error-union return). Clean up the map entry and the half-initialized
            // watcher inline. See #26254.
            // PORT NOTE: no map entry was inserted yet in the Rust version (see reshape above),
            // so there is nothing to swap_remove here.
            // SAFETY: `this` is the freshly heap-allocated pointer above; deinit consumes it.
            unsafe {
                (*this).manager = None; // prevent deinit() from re-entering unregister_watcher
                PathWatcher::deinit(this);
            }
            return sys::Result::Err(err);
        }
        // we handle this in node_fs_watcher
        // SAFETY: handle is open (uv_fs_event_start succeeded); uv_unref only flips the ref flag.
        unsafe { uv::uv_unref(ptr::addr_of_mut!((*this).handle).cast()) };

        // Owned key: dupe of event_path bytes (Zig: `dupeZ` — the sentinel NUL is not part of the
        // slice's `.len`, so the StringArrayHashMap key compares equal to `event_path.as_bytes()`).
        manager.watchers.insert(event_path.as_bytes(), this);

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

    /// JS-thread entry point from `FSWatcher.detach()`. Signature matches the posix
    /// `path_watcher::PathWatcher::detach` (associated fn over `*mut Self`) so the
    /// caller in `node_fs_watcher.rs` is platform-agnostic.
    pub fn detach(this: *mut PathWatcher, handler: *mut c_void) {
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

    /// NOTE: not `impl Drop` — destruction is deferred through `uv_close` and the close callback
    /// frees the box, so this type is always managed via raw `*mut PathWatcher`.
    unsafe fn deinit(this: *mut PathWatcher) {
        bun_output::scoped_log!(fs_watch, "deinit");
        // SAFETY: caller guarantees `this` is a live heap-allocated pointer (see `init`).
        let me = unsafe { &mut *this };
        me.handlers.clear();
        // PERF(port): was clearAndFree (shrinks capacity) — profile in Phase B.

        if let Some(manager) = me.manager.take() {
            let path: &ZStr = if !me.handle.path.is_null() {
                // SAFETY: handle.path is a NUL-terminated C string owned by libuv.
                ZStr::from_cstr(unsafe { core::ffi::CStr::from_ptr(me.handle.path) })
            } else {
                ZStr::EMPTY
            };
            // SAFETY: manager backref is valid until the manager deinits (see PathWatcherManager::deinit).
            unsafe { (*manager).unregister_watcher(this, path) };
        }

        // `UvHandle::is_closed` reads `flags & UV_HANDLE_CLOSED` via the handle prefix.
        if me.handle.is_closed() {
            // SAFETY: `this` was heap-allocated in `init`.
            drop(unsafe { bun_core::heap::take(this) });
        } else {
            // SAFETY: handle is open and not yet closing; stop/close are valid in that state.
            unsafe {
                uv::uv_fs_event_stop(&mut me.handle);
                uv::uv_close(
                    ptr::addr_of_mut!(me.handle).cast(),
                    Some(PathWatcher::uv_closed_callback),
                );
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub fn watch(
    vm: &'static jsc::VirtualMachineRef,
    path: &ZStr,
    recursive: bool,
    // PORT NOTE: Zig takes `comptime callback` / `comptime updateEnd` and `@compileError`s if they
    // are not exactly `onPathUpdateFn` / `onUpdateEndFn`. There is only one valid value for each,
    // so the Rust port drops the parameters entirely.
    ctx: *mut c_void,
) -> sys::Result<*mut PathWatcher> {
    #[cfg(not(windows))]
    compile_error!("win_watcher should only be used on Windows");

    let manager = {
        let _g = DEFAULT_MANAGER_MUTEX.lock_guard();
        // DEFAULT_MANAGER is only read/written while holding
        // DEFAULT_MANAGER_MUTEX (see static decl). `fs.watch()` is reachable
        // from Worker threads, so an unguarded read+write here would be a data
        // race — the prior "JS main thread only" claim was false.
        let m = DEFAULT_MANAGER.load();
        if m.is_null() {
            let m = PathWatcherManager::init(vm);
            DEFAULT_MANAGER.store(m);
            m
        } else {
            // The manager is bound to one VM's uv_loop; reusing it from a
            // different VM (Worker) would drive libuv cross-thread. Catch
            // that in debug until this becomes per-VM storage.
            debug_assert!(
                // SAFETY: `m` is a non-null pointer published under
                // DEFAULT_MANAGER_MUTEX (which we hold) by `init` above on a
                // prior call; the allocation lives until `deinit` clears the
                // slot, so it is valid here.
                core::ptr::eq(unsafe { (*m).vm }, vm),
                "win_watcher PathWatcherManager reused across VMs (Worker fs.watch)",
            );
            m
        }
    };

    // SAFETY: `manager` is a live heap-allocated pointer published under
    // DEFAULT_MANAGER_MUTEX; per the debug_assert above all callers share the
    // same VM thread, so this `&mut` is unaliased for the call.
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

// ported from: src/runtime/node/win_watcher.zig
