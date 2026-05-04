//! Windows-only filesystem watcher backed by libuv `uv_fs_event_t`.
//!
//! Port of `src/runtime/node/win_watcher.zig`.

#![cfg(windows)]

use core::ffi::{c_char, c_int, c_void};
use core::ptr;

use bun_collections::ArrayHashMap;
use bun_core::Output;
use bun_jsc as jsc;
use bun_paths::PathBuffer;
use bun_str::{self as strings, String as BunString, ZStr};
use bun_sys::{self as sys, windows};
use bun_sys::windows::libuv as uv;

use super::path_watcher::EventType;
// TODO(port): confirm exact module path for the node fs.Watcher (Zig: `bun.jsc.Node.fs.Watcher`).
use crate::node::node_fs_watcher::{FSWatcher, Event, on_path_update as on_path_update_fn, on_update_end as on_update_end_fn};
// TODO(port): confirm crate for `bun.Watcher` → assuming `bun_watcher`.
use bun_watcher::Watcher;

bun_output::declare_scope!(PathWatcherManager, visible);
// Zig scope name is `.@"fs.watch"`; Rust identifiers cannot contain '.'.
// TODO(port): declare_scope! should accept the original "fs.watch" string for BUN_DEBUG env matching.
bun_output::declare_scope!(fs_watch, visible);

// ──────────────────────────────────────────────────────────────────────────

static mut DEFAULT_MANAGER: Option<*mut PathWatcherManager> = None;

// TODO: make this a generic so we can reuse code with path_watcher
// TODO: we probably should use native instead of libuv abstraction here for better performance
pub struct PathWatcherManager {
    // Keys are owned NUL-terminated path bytes (Zig: `dupeZ`), values are raw heap PathWatcher ptrs.
    watchers: ArrayHashMap<Box<[u8]>, *mut PathWatcher>,
    // LIFETIMES.tsv: JSC_BORROW → `&VirtualMachine`. The manager is heap-allocated and stored in a
    // process-global, so we spell the borrow as `'static`.
    // TODO(port): revisit once VirtualMachine lifetime plumbing lands in bun_jsc.
    vm: &'static jsc::VirtualMachine,
    deinit_on_last_watcher: bool,
}

impl PathWatcherManager {
    pub fn init(vm: &'static jsc::VirtualMachine) -> *mut PathWatcherManager {
        Box::into_raw(Box::new(PathWatcherManager {
            watchers: ArrayHashMap::default(),
            vm,
            deinit_on_last_watcher: false,
        }))
    }

    /// unregister is always called from main thread
    fn unregister_watcher(&mut self, watcher: *mut PathWatcher, path: &ZStr) {
        let _guard = scopeguard::guard((), |_| {
            if self.deinit_on_last_watcher && self.watchers.len() == 0 {
                // SAFETY: self was Box::into_raw'd in `init`; no other live borrows after this point.
                unsafe { Self::deinit(self as *mut Self) };
            }
        });
        // TODO(port): errdefer — the closure above captures `&mut self`; Phase B may need to
        // restructure to avoid the overlapping borrow with the body below.

        if let Some(index) = self
            .watchers
            .values()
            .iter()
            .position(|&w| w == watcher)
        {
            #[cfg(debug_assertions)]
            {
                if !path.as_bytes().is_empty() {
                    debug_assert!(&*self.watchers.keys()[index] == path.as_bytes());
                }
            }

            // Key is `Box<[u8]>`; swap_remove drops it (replaces `allocator.free(keys[index])`).
            self.watchers.swap_remove_at(index);
        }
    }

    /// Tear down the manager. Takes a raw pointer because it frees `self`.
    ///
    /// NOTE: not `impl Drop` — this type is always held via `*mut` (global static + BACKREF from
    /// PathWatcher) and self-frees via `Box::from_raw`.
    unsafe fn deinit(this: *mut PathWatcherManager) {
        // enable to create a new manager
        // SAFETY: single-threaded (JS main thread); see `watch()`.
        unsafe {
            if DEFAULT_MANAGER == Some(this) {
                DEFAULT_MANAGER = None;
            }
        }

        // SAFETY: caller guarantees `this` is a live Box::into_raw'd pointer (see `init`).
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
        // SAFETY: `this` was produced by Box::into_raw in `init`.
        drop(unsafe { Box::from_raw(this) });
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
    hash: Watcher::HashType,
    event_type: EventType,
    timestamp: u64,
}

impl Default for ChangeEvent {
    fn default() -> Self {
        // Match Zig field defaults: `hash = 0`, `event_type = .change`, `timestamp = 0`.
        Self { hash: 0, event_type: EventType::Change, timestamp: 0 }
    }
}

impl ChangeEvent {
    pub fn emit(
        &mut self,
        hash: Watcher::HashType,
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
        // SAFETY: libuv guarantees `event` is the handle we registered.
        let event_ref = unsafe { &mut *event };
        if event_ref.data.is_null() {
            Output::debug_warn("uvEventCallback called with null data");
            return;
        }
        // SAFETY: event points to PathWatcher.handle; recover the parent via offset_of.
        let this: *mut PathWatcher = unsafe {
            (event as *mut u8)
                .sub(core::mem::offset_of!(PathWatcher, handle))
                .cast::<PathWatcher>()
        };
        // SAFETY: `this` was Box::into_raw'd in `init` and is kept alive until uv_close fires.
        let this = unsafe { &mut *this };
        #[cfg(debug_assertions)]
        {
            debug_assert!(event_ref.data == this as *mut PathWatcher as *mut c_void);
        }

        // SAFETY: libuv contract — `loop_` is valid while the handle is open.
        let timestamp = unsafe { (*event_ref.loop_).time };

        if let Some(err) = status.to_error(sys::Tag::watch) {
            this.emit_in_progress = true;

            for &ctx in this.handlers.keys() {
                on_path_update_fn(ctx, Event::Error(err), false);
                on_update_end_fn(ctx);
            }

            this.emit_in_progress = false;
            this.maybe_deinit();
            return;
        }

        let Some(path) = (if filename.is_null() {
            None
        } else {
            // SAFETY: libuv passes a valid NUL-terminated string when non-null.
            Some(unsafe { ZStr::from_ptr(filename.cast::<u8>()) })
        }) else {
            return;
        };

        this.emit(
            path.as_bytes(),
            // @truncate — intentional wrap to Watcher::HashType
            event_ref.hash(path.as_bytes(), events, status) as Watcher::HashType,
            timestamp,
            !event_ref.is_dir(),
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
        hash: Watcher::HashType,
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
                let payload = match encoding {
                    crate::node::Encoding::Utf8 => Event::path_string(BunString::clone_utf8(path)),
                    _ => Event::path_bytes_to_free(ZStr::from_bytes(path).into_boxed()),
                    // TODO(port): exact `Event`/`EventType::to_event` shape — Zig builds a tagged
                    // payload `{ .string | .bytes_to_free }` then calls `event_type.toEvent(...)`.
                };
                on_path_update_fn(ctx.cast(), event_type.to_event(payload), is_file);
                #[cfg(debug_assertions)]
                {
                    debug_count += 1;
                }
                on_update_end_fn(ctx.cast());
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
        let event_path: &ZStr = match sys::readlink(path, &mut outbuf) {
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
            sys::Result::Ok(event_path) => event_path,
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
            // SAFETY: all-zero is a valid uv_fs_event_t (POD C struct).
            handle: unsafe { core::mem::zeroed() },
            manager: Some(manager_ptr),
            emit_in_progress: false,
            handlers: ArrayHashMap::default(),
        });
        let this = Box::into_raw(this_box);

        // uv_fs_event_init on Windows unconditionally returns 0 (vendor/libuv/src/win/fs-event.c).
        // bun.assert evaluates its argument before the inline early-return, so this runs in release too.
        // SAFETY: `this` is a freshly-allocated valid pointer; uv_loop comes from the VM.
        unsafe {
            let rc = uv::uv_fs_event_init(manager.vm.uv_loop(), &mut (*this).handle);
            debug_assert!(rc == uv::ReturnCode::zero());
            (*this).handle.data = this.cast::<c_void>();
        }

        // UV_FS_EVENT_RECURSIVE only works for Windows and OSX
        // SAFETY: `(*this).handle` was initialized by uv_fs_event_init above; event_path is NUL-terminated.
        let start_rc = unsafe {
            uv::uv_fs_event_start(
                &mut (*this).handle,
                Some(PathWatcher::uv_event_callback),
                event_path.as_ptr().cast::<c_char>(),
                if recursive { uv::UV_FS_EVENT_RECURSIVE } else { 0 },
            )
        };
        if let Some(err) = start_rc.to_error(sys::Tag::watch) {
            // `errdefer` doesn't fire on `return .{ .err = ... }` (that's a successful return of a
            // Maybe(T), not an error-union return). Clean up the map entry and the half-initialized
            // watcher inline. See #26254.
            // PORT NOTE: no map entry was inserted yet in the Rust version (see reshape above),
            // so there is nothing to swap_remove here.
            // SAFETY: `this` is the freshly Box::into_raw'd pointer above; deinit consumes it.
            unsafe {
                (*this).manager = None; // prevent deinit() from re-entering unregister_watcher
                PathWatcher::deinit(this);
            }
            return sys::Result::Err(err);
        }
        // we handle this in node_fs_watcher
        // SAFETY: handle is open (uv_fs_event_start succeeded); uv_unref only flips the ref flag.
        unsafe { uv::uv_unref(ptr::addr_of_mut!((*this).handle).cast()) };

        // Owned key: NUL-terminated dupe of event_path (Zig: `dupeZ`).
        manager.watchers
            .insert(ZStr::from_bytes(event_path.as_bytes()).into_boxed(), this);
        // TODO(port): `ZStr::from_bytes(..).into_boxed()` is a placeholder for `allocator.dupeZ(u8, ..)`
        // — confirm bun_str API for "owned NUL-terminated byte slice".

        sys::Result::Ok(this)
    }

    extern "C" fn uv_closed_callback(handler: *mut c_void) {
        bun_output::scoped_log!(fs_watch, "onClose");
        let event = handler.cast::<uv::uv_fs_event_t>();
        // SAFETY: event.data was set to the PathWatcher* in `init`.
        let this = unsafe { (*event).data.cast::<PathWatcher>() };
        // SAFETY: `this` was Box::into_raw'd in `init`.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn detach(&mut self, handler: *mut c_void) {
        if self.handlers.swap_remove(&handler).is_some() {
            self.maybe_deinit();
        }
    }

    fn maybe_deinit(&mut self) {
        if self.handlers.len() == 0 && !self.emit_in_progress {
            // SAFETY: self was Box::into_raw'd in `init`; no other live borrows after this point.
            unsafe { Self::deinit(self as *mut Self) };
        }
    }

    /// NOTE: not `impl Drop` — destruction is deferred through `uv_close` and the close callback
    /// frees the box, so this type is always managed via raw `*mut PathWatcher`.
    unsafe fn deinit(this: *mut PathWatcher) {
        bun_output::scoped_log!(fs_watch, "deinit");
        // SAFETY: caller guarantees `this` is a live Box::into_raw'd pointer (see `init`).
        let me = unsafe { &mut *this };
        me.handlers.clear();
        // PERF(port): was clearAndFree (shrinks capacity) — profile in Phase B.

        if let Some(manager) = me.manager.take() {
            let path: &ZStr = if !me.handle.path.is_null() {
                // SAFETY: handle.path is a NUL-terminated C string owned by libuv.
                unsafe { ZStr::from_ptr(me.handle.path.cast::<u8>()) }
            } else {
                ZStr::EMPTY
            };
            // SAFETY: manager backref is valid until the manager deinits (see PathWatcherManager::deinit).
            unsafe { (*manager).unregister_watcher(this, path) };
        }

        // SAFETY: handle was initialized via uv_fs_event_init; uv_is_closed only reads flags.
        if unsafe { uv::uv_is_closed(ptr::addr_of!(me.handle).cast()) } {
            // SAFETY: `this` was Box::into_raw'd in `init`.
            drop(unsafe { Box::from_raw(this) });
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
    vm: &'static jsc::VirtualMachine,
    path: &ZStr,
    recursive: bool,
    // PORT NOTE: Zig takes `comptime callback` / `comptime updateEnd` and `@compileError`s if they
    // are not exactly `onPathUpdateFn` / `onUpdateEndFn`. There is only one valid value for each,
    // so the Rust port drops the parameters entirely.
    ctx: *mut c_void,
) -> sys::Result<*mut PathWatcher> {
    #[cfg(not(windows))]
    compile_error!("win_watcher should only be used on Windows");

    // SAFETY: single-threaded — only ever called from the JS main thread.
    let manager = unsafe {
        match DEFAULT_MANAGER {
            Some(m) => m,
            None => {
                let m = PathWatcherManager::init(vm);
                DEFAULT_MANAGER = Some(m);
                m
            }
        }
    };

    // SAFETY: `manager` is a live Box::into_raw'd pointer stored in DEFAULT_MANAGER (JS main thread only).
    let watcher = match PathWatcher::init(unsafe { &mut *manager }, path, recursive) {
        sys::Result::Err(err) => return sys::Result::Err(err),
        sys::Result::Ok(w) => w,
    };
    // SAFETY: watcher is a valid freshly-returned heap pointer.
    unsafe {
        (*watcher)
            .handlers
            .insert(ctx, ChangeEvent::default());
    }
    sys::Result::Ok(watcher)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/win_watcher.zig (310 lines)
//   confidence: medium
//   todos:      7
//   notes:      Heavy raw-ptr/libuv FFI; getOrPut reshaped to lookup+insert; FSWatcher/Event import paths and scopeguard self-borrow need Phase-B fixup.
// ──────────────────────────────────────────────────────────────────────────
