//! Windows-only filesystem watcher backed by libuv `uv_fs_event_t`.

#![cfg(windows)]

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{String as BunString, ZStr};
use bun_jsc as jsc;
use bun_jsc::JsCell;
use bun_sys as sys;
use bun_sys::ReturnCodeExt as _;
use bun_sys::windows::libuv as uv;

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
pub(crate) type PathWatchers =
    [JsCell<StringArrayHashMap<uv::Owned<uv::uv_fs_event_t, PathWatcher>>>; 2];

type FsEvent = uv::Handle<uv::uv_fs_event_t, PathWatcher>;

/// Names an entry of [`PathWatchers`].
#[derive(Clone, Copy)]
pub(crate) struct Handle {
    recursive: bool,
    /// Only compared.
    address: *const FsEvent,
}

impl Handle {
    fn of(watcher: &FsEvent) -> Self {
        Self {
            recursive: watcher.data.recursive,
            address: watcher,
        }
    }
}

// TODO: we probably should use native instead of libuv abstraction here for better performance
pub(crate) struct PathWatcher {
    recursive: bool,
    emit_in_progress: Cell<bool>,
    handlers: JsCell<ArrayHashMap<*mut c_void, ChangeEvent>>,
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
    fn uv_event_callback(
        this: &FsEvent,
        filename: Option<&ZStr>,
        events: c_int,
        status: uv::ReturnCode,
    ) {
        let me = &this.data;
        let timestamp = this.get_loop().now();

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

        let Some(path) = filename else {
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
        };

        // Intentional wrap to bun_watcher::HashType
        let hash = this.hash(path.as_bytes(), events, status) as bun_watcher::HashType;
        let is_file = !this.is_dir();
        Self::emit(this, path.as_bytes(), hash, timestamp, is_file, event_type);
    }

    fn emit(
        this: &FsEvent,
        path: &[u8],
        hash: bun_watcher::HashType,
        timestamp: u64,
        is_file: bool,
        event_type: WatchEventKind,
    ) {
        let me = &this.data;
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
        Self::maybe_deinit(this);
    }

    fn init(
        vm: &jsc::VirtualMachineRef,
        path: &ZStr,
        recursive: bool,
        ctx: *mut c_void,
    ) -> sys::Result<Handle> {
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
            return sys::Result::Ok(Self::add_handler(existing, ctx));
        }

        let watcher = uv::uv_fs_event_t::start(
            vm.uv_loop(),
            event_path,
            // UV_FS_EVENT_RECURSIVE only works for Windows and OSX
            if recursive {
                uv::UV_FS_EVENT_RECURSIVE as u32
            } else {
                0
            },
            PathWatcher {
                recursive,
                emit_in_progress: Cell::new(false),
                handlers: JsCell::new(ArrayHashMap::default()),
            },
            PathWatcher::uv_event_callback,
        )
        .map_err(|rc| sys::Error::from_uv(rc, sys::Tag::watch))?;
        // we handle this in node_fs_watcher
        watcher.unref();

        let handle = Self::add_handler(&watcher, ctx);
        watchers.with_mut(|watchers| watchers.insert(event_path.as_bytes(), watcher));
        sys::Result::Ok(handle)
    }

    fn add_handler(this: &FsEvent, handler: *mut c_void) -> Handle {
        this.data.handlers.with_mut(|h| {
            h.insert(handler, ChangeEvent::default());
        });
        Handle::of(this)
    }

    /// JS-thread entry point from `FSWatcher.detach()`.
    pub(crate) fn detach(this: Handle, handler: *mut c_void) {
        path_watchers()[usize::from(this.recursive)].with_mut(|watchers| {
            let values = watchers.values();
            let Some(index) = values.iter().position(|w| ptr::eq(&**w, this.address)) else {
                return;
            };
            let me = &values[index].data;
            me.handlers.with_mut(|h| h.swap_remove(&handler));
            if me.handlers.get().len() == 0 && !me.emit_in_progress.get() {
                bun_output::scoped_log!(fs_watch, "deinit");
                watchers.swap_remove_at(index);
            }
        });
    }

    fn maybe_deinit(this: &FsEvent) {
        if this.data.handlers.get().len() == 0 {
            // No handler is null: this only removes the watcher.
            Self::detach(Handle::of(this), ptr::null_mut());
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub(crate) fn watch(
    vm: &jsc::VirtualMachineRef,
    path: &ZStr,
    recursive: bool,
    ctx: *mut c_void,
) -> sys::Result<Handle> {
    PathWatcher::init(vm, path, recursive, ctx)
}
