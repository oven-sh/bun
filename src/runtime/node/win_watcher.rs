//! Windows-only filesystem watcher backed by libuv `uv_fs_event_t`.

#![cfg(windows)]

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::ptr;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{String as BunString, ZStr};
use bun_jsc as jsc;
use bun_jsc::JsCell;
use bun_sys as sys;
use bun_sys::ReturnCodeExt as _;
use bun_sys::windows::libuv as uv;
use bun_sys::windows::libuv::UvHandle as _;

use super::node_fs_watcher::WatchEventKind;
use crate::jsc_hooks::path_watchers;
// The callbacks are *associated functions* on `FSWatcher`, not free fns.
use crate::node::node_fs_watcher::{Event, FSWatcher, StringOrBytesToDecode};
#[allow(non_upper_case_globals)]
const on_path_update_fn: fn(Option<*mut c_void>, Event, bool) = FSWatcher::ON_PATH_UPDATE;
#[allow(non_upper_case_globals)]
const on_update_end_fn: fn(Option<*mut c_void>) = FSWatcher::on_update_end;

// Rust identifiers cannot contain '.', so
// the static is declared by hand (instead of via `declare_scope!`) with the
// tag string, keeping `BUN_DEBUG_fs.watch` env matching and the
// `[fs.watch]` log prefix.
#[allow(non_upper_case_globals)]
pub(crate) static fs_watch: bun_output::ScopedLogger =
    bun_output::ScopedLogger::new("fs.watch", bun_output::Visibility::Visible);

// ──────────────────────────────────────────────────────────────────────────

/// A VM's watchers, by `recursive` and path.
pub(crate) type PathWatchers = [JsCell<StringArrayHashMap<uv::Owned<PathWatcher>>>; 2];

pub(crate) type Handle = *mut PathWatcher;

// TODO: we probably should use native instead of libuv abstraction here for better performance
#[repr(C)]
pub(crate) struct PathWatcher {
    handle: uv::uv_fs_event_t,
    recursive: bool,
    emit_in_progress: Cell<bool>,
    handlers: JsCell<ArrayHashMap<*mut c_void, ChangeEvent>>,
}

// SAFETY: `#[repr(C)]` with the handle first.
unsafe impl uv::UvHandle for PathWatcher {}

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
            for ctx in keys {
                if !me.handlers.get().contains_key(&ctx) {
                    continue;
                }
                on_path_update_fn(
                    Some(ctx),
                    Event::Error {
                        err: err.clone(),
                        close: true,
                    },
                    false,
                );
                on_update_end_fn(Some(ctx));
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
            for ctx in keys {
                if !me.handlers.get().contains_key(&ctx) {
                    continue;
                }
                on_path_update_fn(Some(ctx), Event::NoFilename(event_type), false);
                on_update_end_fn(Some(ctx));
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
                let Some(fire) = me
                    .handlers
                    .with_mut(|h| h.get_mut(&key).map(|v| v.emit(hash, timestamp, event_type)))
                else {
                    continue;
                };
                if fire {
                    let ctx: *mut FSWatcher = key.cast::<FSWatcher>();
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

            me.emit_in_progress.set(false);
        }
        Self::maybe_deinit(this);
    }

    fn init(
        vm: &jsc::VirtualMachineRef,
        path: &ZStr,
        recursive: bool,
    ) -> sys::Result<*mut PathWatcher> {
        let mut outbuf = bun_paths::path_buffer_pool::get();
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

        let watchers = &path_watchers()[usize::from(recursive)];
        if let Some(existing) = watchers.get().get(event_path.as_bytes()) {
            return sys::Result::Ok(existing.as_ptr());
        }

        let mut owned = uv::Owned::new(PathWatcher {
            handle: bun_core::ffi::zeroed(),
            recursive,
            emit_in_progress: Cell::new(false),
            handlers: JsCell::new(ArrayHashMap::default()),
        });
        let this = owned.as_ptr();

        // uv_fs_event_init on Windows unconditionally returns 0 (vendor/libuv/src/win/fs-event.c).
        // bun.assert evaluates its argument before the inline early-return, so this runs in release too.
        // SAFETY: `this` is a freshly-allocated valid pointer; uv_loop comes from the VM.
        unsafe {
            // `ptr::addr_of_mut!` (not `&mut (*this).handle`): libuv stashes this pointer and
            // hands it back to `uv_event_callback`, which `from_field_ptr!`-offsets it to recover
            // the parent `PathWatcher`. Deriving via `addr_of_mut!` keeps `this`'s whole-allocation
            // provenance so that container-of access stays in-bounds under Stacked Borrows.
            let rc = uv::uv_fs_event_init(vm.uv_loop(), ptr::addr_of_mut!((*this).handle));
            debug_assert!(rc == uv::ReturnCode::zero());
            (*this).handle.data = this.cast::<c_void>();
        }

        // UV_FS_EVENT_RECURSIVE only works for Windows and OSX
        // SAFETY: `(*this).handle` was initialized by uv_fs_event_init above; event_path is NUL-terminated.
        unsafe {
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
        }
        .to_result(sys::Tag::watch)?;
        // we handle this in node_fs_watcher
        owned.unref();

        watchers.with_mut(|watchers| watchers.insert(event_path.as_bytes(), owned));
        sys::Result::Ok(this)
    }

    /// JS-thread entry point from `FSWatcher.detach()`.
    pub(crate) fn detach(this: Handle, handler: *mut c_void) {
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
        // SAFETY: `this` is the live heap pointer from `init`, not used once it is dropped.
        let me = unsafe { &*this };
        if me.handlers.get().len() != 0 || me.emit_in_progress.get() {
            return;
        }
        bun_output::scoped_log!(fs_watch, "deinit");
        path_watchers()[usize::from(me.recursive)].with_mut(|watchers| {
            if let Some(index) = watchers.values().iter().position(|w| w.as_ptr() == this) {
                watchers.swap_remove_at(index);
            }
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub(crate) fn watch(
    vm: &jsc::VirtualMachineRef,
    path: &ZStr,
    recursive: bool,
    ctx: *mut c_void,
) -> sys::Result<Handle> {
    let watcher = PathWatcher::init(vm, path, recursive)?;
    // SAFETY: watcher is a valid freshly-returned heap pointer.
    unsafe { &*watcher }.handlers.with_mut(|h| {
        h.insert(ctx, ChangeEvent::default());
    });
    sys::Result::Ok(watcher)
}
