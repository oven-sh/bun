//! Bun's filesystem watcher implementation for windows using kernel32

use core::mem::size_of;
use core::ptr;

use crate::watcher_impl::{Op, WatchEvent, WatchItemColumns, WatchItemIndex, Watcher};
use bun_core::strings;
use bun_paths::resolve_path::{ParentEqual, is_parent_or_equal};
use bun_paths::{PathBuffer, WPathBuffer};
use bun_ptr::{BackRef, RawSlice};

use bun_sys::windows as w;
use bun_sys::windows::HANDLE;

bun_core::declare_scope!(watcher, visible);

pub(crate) type Platform = WindowsWatcher;

pub struct WindowsWatcher {
    pub iocp: HANDLE,
    pub watcher: DirWatcher,
    pub buf: PathBuffer,
    pub base_idx: usize,
}

impl Default for WindowsWatcher {
    fn default() -> Self {
        Self {
            iocp: w::INVALID_HANDLE_VALUE,
            watcher: DirWatcher {
                overlapped: bun_core::ffi::zeroed(),
                buf: [0u8; 64 * 1024],
                dir_handle: w::INVALID_HANDLE_VALUE,
            },
            buf: PathBuffer::uninit(),
            base_idx: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, thiserror::Error)]
pub enum Error {
    #[error("IocpFailed")]
    IocpFailed,
    #[error("CreateFileFailed")]
    CreateFileFailed,
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Action {
    Added = w::FILE_ACTION_ADDED,
    Removed = w::FILE_ACTION_REMOVED,
    Modified = w::FILE_ACTION_MODIFIED,
    RenamedOld = w::FILE_ACTION_RENAMED_OLD_NAME,
    RenamedNew = w::FILE_ACTION_RENAMED_NEW_NAME,
}

pub(crate) struct FileEvent {
    pub action: Action,
    // [`RawSlice`] (not a lifetime-carrying `&'a [u16]`) so `FileEvent` carries no lifetime param;
    // the buffer is live until the next `prepare()` — encapsulated by the
    // `RawSlice` outlives-holder invariant so callers read via safe `.slice()`.
    pub filename: RawSlice<u16>,
}

#[repr(C)]
pub struct DirWatcher {
    /// must be initialized to zero (even though it's never read or written in our code),
    /// otherwise ReadDirectoryChangesW will fail with INVALID_HANDLE
    pub overlapped: w::OVERLAPPED,
    /// `FILE_NOTIFY_INFORMATION` is DWORD-aligned (4); the preceding
    /// `OVERLAPPED` (32 bytes, align 8) guarantees `buf` lands at offset 32,
    /// which the `assert_ffi_layout!` below locks in (and `32 % 4 == 0` is the
    /// alignment proof for the `FILE_NOTIFY_INFORMATION` cast in
    /// `EventIterator::next`).
    pub buf: [u8; 64 * 1024],
    pub dir_handle: HANDLE,
}

// `OVERLAPPED` = 32 bytes / align 8 on Win64; `buf` must be ≥ 4-aligned for
// the `*FILE_NOTIFY_INFORMATION` cast. Asserting the offset (not just the
// total size) is what proves that alignment requirement.
bun_core::assert_ffi_layout!(
    DirWatcher,
    32 + 64 * 1024 + ::core::mem::size_of::<HANDLE>(),
    ::core::mem::align_of::<w::OVERLAPPED>();
    overlapped @ 0, buf @ 32, dir_handle @ 32 + 64 * 1024,
);
const _: () = assert!(
    ::core::mem::offset_of!(DirWatcher, buf)
        % ::core::mem::align_of::<w::FILE_NOTIFY_INFORMATION>()
        == 0,
    "DirWatcher.buf must be FILE_NOTIFY_INFORMATION-aligned",
);

impl DirWatcher {
    /// invalidates any EventIterators
    fn prepare(&mut self) -> bun_sys::Result<()> {
        let filter = w::FileNotifyChangeFilter::FILE_NAME
            | w::FileNotifyChangeFilter::DIR_NAME
            | w::FileNotifyChangeFilter::LAST_WRITE
            | w::FileNotifyChangeFilter::CREATION;
        // SAFETY: dir_handle is a valid directory handle opened with FILE_LIST_DIRECTORY;
        // buf and overlapped are valid for the duration of the async operation (self-owned).
        if unsafe {
            w::kernel32::ReadDirectoryChangesW(
                self.dir_handle,
                self.buf.as_mut_ptr().cast(),
                self.buf.len() as u32,
                1,
                filter,
                ptr::null_mut(),
                &mut self.overlapped,
                None,
            )
        } == 0
        {
            let err = w::Win32Error::get();
            bun_core::scoped_log!(watcher, "failed to start watching directory: {}", err.0);
            return Err(bun_sys::Error {
                // Route the raw code through the `u32` `SystemErrnoInit` impl
                // (same Win32→errno table as `Win32ErrorExt::to_system_errno`).
                errno: bun_sys::SystemErrno::init(err.0 as u32)
                    .unwrap_or(bun_sys::SystemErrno::EINVAL) as _,
                syscall: bun_sys::Tag::watch,
                ..Default::default()
            });
        }
        bun_core::scoped_log!(watcher, "read directory changes!");
        Ok(())
    }
}

/// Iterates `FILE_NOTIFY_INFORMATION` records out of a `DirWatcher`'s buffer.
///
/// holds a [`BackRef<DirWatcher>`] instead of a lifetime-carrying
/// `&'a DirWatcher` so `WindowsWatcher::next` does not keep `&mut Watcher.platform`
/// borrowed across `watch_loop_cycle`'s inner loop (which mutates sibling
/// fields). The `BackRef` invariant — pointee outlives holder — is upheld
/// because the iterator is only advanced while the owning `DirWatcher` is
/// alive and `prepare()` has not been re-called; safe `Deref` replaces the
/// previously open-coded raw `(*self.watcher).buf` projection.
pub(crate) struct EventIterator {
    pub watcher: BackRef<DirWatcher>,
    pub offset: usize,
    pub has_next: bool,
}

impl EventIterator {
    pub(crate) fn next(&mut self) -> Option<FileEvent> {
        if !self.has_next {
            return None;
        }
        // The Rust binding includes `FileName: [WCHAR; 1]`, so `size_of` == 16
        // while the fixed record header is 12 bytes. Use the field offset, not the struct
        // size, to locate the variable-length filename.
        let name_offset = core::mem::offset_of!(w::FILE_NOTIFY_INFORMATION, FileName);
        // `self.watcher` is a `BackRef<DirWatcher>` — pointee live until the
        // next `prepare()` (see the struct-level note) — so reading `buf` is safe.
        let buf_ptr = self.watcher.buf.as_ptr();
        // SAFETY: `buf` was filled by ReadDirectoryChangesW with a sequence of
        // FILE_NOTIFY_INFORMATION records; `offset` is advanced only by
        // NextEntryOffset values returned by the kernel, so each cast targets a
        // properly-aligned record header.
        let info: &w::FILE_NOTIFY_INFORMATION = unsafe {
            &*(buf_ptr
                .add(self.offset)
                .cast::<w::FILE_NOTIFY_INFORMATION>())
        };
        // The variable-length filename begins at the `FileName` field of the
        // record; `FileNameLength` (kernel-set) bounds the trailing UTF-16
        // bytes which lie wholly inside `buf`. Safe bounds-checked sub-slice of
        // the owned `[u8; 64K]` buffer, then a `bytemuck`-checked u8→u16 view
        // (alignment holds: `buf` is DWORD-aligned per the static assert above,
        // `self.offset` advances by kernel `NextEntryOffset` which is DWORD-
        // aligned, and `name_offset` == 12). Wrap in `RawSlice` so callers
        // re-borrow without an open-coded raw deref.
        let name_start = self.offset + name_offset;
        let name_bytes = &self.watcher.buf[name_start..name_start + info.FileNameLength as usize];
        let filename: RawSlice<u16> = RawSlice::new(bun_core::cast_slice::<u8, u16>(name_bytes));

        // `transmute` into an exhaustive #[repr(u32)] enum is immediate UB on an unlisted
        // discriminant. Use a checked match — kernel docs guarantee 1..=5 today.
        let action: Action = match info.Action {
            w::FILE_ACTION_ADDED => Action::Added,
            w::FILE_ACTION_REMOVED => Action::Removed,
            w::FILE_ACTION_MODIFIED => Action::Modified,
            w::FILE_ACTION_RENAMED_OLD_NAME => Action::RenamedOld,
            w::FILE_ACTION_RENAMED_NEW_NAME => Action::RenamedNew,
            other => {
                debug_assert!(false, "unexpected FILE_NOTIFY_INFORMATION.Action = {other}");
                // Skip unknown action and advance to next record.
                if info.NextEntryOffset == 0 {
                    self.has_next = false;
                } else {
                    self.offset += info.NextEntryOffset as usize;
                }
                return self.next();
            }
        };

        if info.NextEntryOffset == 0 {
            self.has_next = false;
        } else {
            self.offset += info.NextEntryOffset as usize;
        }

        Some(FileEvent { action, filename })
    }
}

impl WindowsWatcher {
    // `self` is the pre-allocated `platform` slot inside crate::Watcher
    // (64KB+ buffers; avoid moving).
    pub(crate) fn init(&mut self, root: &[u8]) -> Result<(), crate::Error> {
        use bun_paths::string_paths as paths;
        let mut pathbuf = WPathBuffer::uninit();
        let wpath = paths::to_nt_path(&mut pathbuf, root);
        let path_len_bytes: u16 = (wpath.len() * 2) as u16;
        let mut nt_name = w::UNICODE_STRING {
            Length: path_len_bytes,
            MaximumLength: path_len_bytes,
            Buffer: wpath.as_ptr().cast_mut().cast::<u16>(),
        };
        let mut attr = w::OBJECT_ATTRIBUTES {
            Length: size_of::<w::OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: ptr::null_mut(),
            Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            ObjectName: &mut nt_name,
            SecurityDescriptor: ptr::null_mut(),
            SecurityQualityOfService: ptr::null_mut(),
        };
        let mut handle: HANDLE = w::INVALID_HANDLE_VALUE;
        let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        // SAFETY: all pointer params point to valid stack locals for the duration of the call.
        let rc = unsafe {
            w::ntdll::NtCreateFile(
                &mut handle,
                w::FILE_LIST_DIRECTORY,
                &mut attr,
                &mut io,
                ptr::null_mut(),
                0,
                w::FILE_SHARE_READ | w::FILE_SHARE_WRITE | w::FILE_SHARE_DELETE,
                w::FILE_OPEN,
                w::FILE_DIRECTORY_FILE | w::FILE_OPEN_FOR_BACKUP_INTENT,
                ptr::null_mut(),
                0,
            )
        };

        if rc != w::NTSTATUS::SUCCESS {
            let err = w::Win32Error::from_nt_status(rc);
            bun_core::scoped_log!(watcher, "failed to open directory for watching: {}", err.0);
            return Err(Error::CreateFileFailed.into());
        }
        let handle_guard = scopeguard::guard(handle, |h| unsafe {
            // SAFETY: handle was successfully opened by NtCreateFile above.
            let _ = w::CloseHandle(h);
        });

        self.iocp = w::CreateIoCompletionPort(*handle_guard, ptr::null_mut(), 0, 1)
            .map_err(|_| crate::Error::from(Error::IocpFailed))?;
        let iocp_guard = scopeguard::guard(self.iocp, |h| unsafe {
            // SAFETY: iocp handle was successfully created above.
            let _ = w::CloseHandle(h);
        });

        // Materializing an uninit `[u8; N]` by value is immediate UB, and constructing a 64KiB
        // `DirWatcher` temporary on the stack defeats the in-place-init intent. Assign fields in
        // place instead — `buf` was already zero-initialised by `Default` and is an output buffer
        // filled by ReadDirectoryChangesW before any read.
        self.watcher.overlapped = bun_core::ffi::zeroed::<w::OVERLAPPED>();
        self.watcher.dir_handle = *handle_guard;

        self.buf[..root.len()].copy_from_slice(root);
        let needs_slash = root.is_empty() || !paths::char_is_any_slash(root[root.len() - 1]);
        if needs_slash {
            self.buf[root.len()] = b'\\';
        }
        self.base_idx = if needs_slash {
            root.len() + 1
        } else {
            root.len()
        };

        // disarm the cleanup scopeguards on success
        scopeguard::ScopeGuard::into_inner(iocp_guard);
        scopeguard::ScopeGuard::into_inner(handle_guard);
        Ok(())
    }

    /// wait until new events are available
    pub(crate) fn next(&mut self, timeout: Timeout) -> bun_sys::Result<Option<EventIterator>> {
        if let Err(err) = self.watcher.prepare() {
            bun_core::scoped_log!(watcher, "prepare() returned error");
            return Err(err);
        }

        let mut nbytes: w::DWORD = 0;
        let mut key: w::ULONG_PTR = 0;
        let mut overlapped: *mut w::OVERLAPPED = ptr::null_mut();
        loop {
            // SAFETY: iocp is a valid IOCP handle; out-params are valid stack locals.
            let rc = unsafe {
                w::kernel32::GetQueuedCompletionStatus(
                    self.iocp,
                    &mut nbytes,
                    &mut key,
                    &mut overlapped,
                    timeout as w::DWORD,
                )
            };
            if rc == 0 {
                let err = w::Win32Error::get();
                // `WAIT_TIMEOUT` (258) — not yet a named const on `bun_sys::windows::Win32Error`.
                if err == w::Win32Error::TIMEOUT || err == w::Win32Error(258) {
                    return Ok(None);
                } else {
                    bun_core::scoped_log!(watcher, "GetQueuedCompletionStatus failed: {}", err.0);
                    return Err(bun_sys::Error {
                        errno: bun_sys::SystemErrno::init(err.0 as u32)
                            .unwrap_or(bun_sys::SystemErrno::EINVAL)
                            as _,
                        syscall: bun_sys::Tag::watch,
                        ..Default::default()
                    });
                }
            }

            if !overlapped.is_null() {
                // ignore possible spurious events
                if overlapped != &mut self.watcher.overlapped as *mut w::OVERLAPPED {
                    continue;
                }
                if nbytes == 0 {
                    // ReadDirectoryChangesW internal change-buffer overflow — too many
                    // events arrived between drain and re-arm. This is NOT a shutdown
                    // signal: stop() closes the dir handle, which surfaces as rc==0 /
                    // ERROR_OPERATION_ABORTED above, never as rc!=0 && nbytes==0. Per
                    // MSDN, the function returns zero bytes when its internal buffer
                    // overflows. Drop the lost events, re-arm, and keep watching so
                    // --hot picks up the next change. Returning ESHUTDOWN here kills
                    // the watcher thread and the --hot child silently exits
                    // (hot.test.ts "should work with sourcemap generation" flake).
                    bun_core::scoped_log!(
                        watcher,
                        "ReadDirectoryChangesW buffer overflow (nbytes==0); re-arming"
                    );
                    if let Err(err) = self.watcher.prepare() {
                        return Err(err);
                    }
                    continue;
                }
                return Ok(Some(EventIterator {
                    watcher: BackRef::new(&self.watcher),
                    offset: 0,
                    has_next: true,
                }));
            } else {
                bun_core::scoped_log!(
                    watcher,
                    "GetQueuedCompletionStatus returned no overlapped event"
                );
                return Err(bun_sys::Error {
                    errno: bun_sys::SystemErrno::EINVAL as _,
                    syscall: bun_sys::Tag::watch,
                    ..Default::default()
                });
            }
        }
    }

    pub(crate) fn stop(&mut self) {
        // SAFETY: handles were opened in init() and are valid until stop() is called once.
        unsafe {
            w::CloseHandle(self.watcher.dir_handle);
            w::CloseHandle(self.iocp);
        }
    }
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum Timeout {
    Infinite = w::INFINITE,
    None = 0,
}

pub(crate) fn watch_loop_cycle(this: &mut Watcher) -> bun_sys::Result<()> {
    // We re-borrow buf inside the inner loop instead of holding `&this.platform.buf`
    // across calls to `this.platform.next()`.
    let base_idx = this.platform.base_idx;

    let mut event_id: usize = 0;

    // first wait has infinite timeout - we're waiting for the next event and don't want to spin
    let mut timeout = Timeout::Infinite;
    loop {
        let mut iter = match this.platform.next(timeout)? {
            Some(it) => it,
            None => break,
        };
        // after the first wait, we want to coalesce further events but don't want to wait for them
        // NOTE: using a 1ms timeout would be ideal, but that actually makes the thread wait for at least 10ms more than it should
        // Instead we use a 0ms timeout, which may not do as much coalescing but is more responsive.
        timeout = Timeout::None;
        // PORT NOTE: locked — diverges from Zig spec (which scanned the
        // `file_path` column unlocked; `WindowsWatcher.zig:217`). The JS
        // thread, transpiler workers and the bundle thread append watch items
        // under `this.mutex`, which can grow the MultiArrayList — freeing the
        // old backing slab mid-scan — so the unlocked `items_file_path()` read
        // raced the realloc and `is_parent_or_equal` dereferenced freed
        // memory. Mirrors the locked snapshot in INotifyWatcher's
        // `watch_loop_cycle`. The guard is dropped and re-acquired around
        // `process_watch_event_batch`, which takes the same (non-recursive)
        // mutex internally. This never holds the lock across a blocking wait:
        // `platform.next()` runs before the guard is taken and `iter.next()`
        // only parses the already-filled completion buffer.
        let mut guard = this.mutex.lock_guard();
        bun_core::scoped_log!(
            watcher,
            "number of watched items: {}",
            this.watchlist.items_file_path().len()
        );
        while let Some(event) = iter.next() {
            // `event.filename` is a `RawSlice<u16>` into `this.platform.watcher.buf`,
            // live for the duration of this iteration (no `prepare()` until the
            // outer loop reiterates) — encapsulated by the `RawSlice` invariant.
            let filename: &[u16] = event.filename.slice();
            let convert_res =
                strings::copy_utf16_into_utf8(&mut this.platform.buf[base_idx..], filename);
            let eventpath_len = base_idx + convert_res.written as usize;

            bun_core::scoped_log!(
                watcher,
                "watcher update event: (filename: {}, action: {}",
                bstr::BStr::new(&this.platform.buf[..eventpath_len]),
                <&'static str>::from(event.action)
            );

            // TODO this probably needs a more sophisticated search algorithm in the future
            // Possible approaches:
            // - Keep a sorted list of the watched paths and perform a binary search. We could use a bool to keep
            //   track of whether the list is sorted and only sort it when we detect a change.
            // - Use a prefix tree. Potentially more efficient for large numbers of watched paths, but complicated
            //   to implement and maintain.
            // - others that i'm not thinking of

            // The length is re-read every iteration: releasing the lock around
            // `process_watch_event_batch` lets `on_file_update` evict entries
            // and compact the watchlist. Known trade-off: that compaction is
            // `swap_remove`-based, so a mid-batch flush can move a not-yet-
            // scanned tail entry into a slot behind `item_idx`, skipping it
            // for the *current* OS event (requires 128+ matches for one event
            // plus a concurrent eviction below the cursor). Rescanning from 0
            // instead would risk duplicate notifications; a missed coalesced
            // event is the safer failure mode, and the next event for that
            // path re-delivers.
            let mut item_idx: usize = 0;
            while item_idx < this.watchlist.items_file_path().len() {
                // reshaped for borrowck — `rel` is computed in a scoped
                // block so the borrows of `this.watchlist` / `this.platform.buf`
                // are released before we touch `this.watch_events` or hand the
                // whole `&mut Watcher` to `process_watch_event_batch`.
                let rel = {
                    let eventpath = &this.platform.buf[..eventpath_len];
                    let path = &this.watchlist.items_file_path()[item_idx];
                    let rel = is_parent_or_equal(path.as_ref(), eventpath);
                    bun_core::scoped_log!(
                        watcher,
                        "checking path: {} = .{}",
                        bstr::BStr::new(path.as_ref()),
                        match rel {
                            ParentEqual::Parent => "parent",
                            ParentEqual::Equal => "equal",
                            ParentEqual::Unrelated => "unrelated",
                        }
                    );
                    rel
                };
                // skip unrelated items
                if rel == ParentEqual::Unrelated {
                    item_idx += 1;
                    continue;
                }
                // if the event is for a parent dir of the item, only emit it if it's a delete or rename

                // Check if we're about to exceed the watch_events array capacity
                if event_id >= this.watch_events.len() {
                    // Process current batch of events; it locks `this.mutex`
                    // itself, so release our guard first (non-recursive mutex).
                    drop(guard);
                    process_watch_event_batch(this, event_id)?;
                    // passing `this: &mut Watcher` above materialises a fresh Unique
                    // borrow over the whole `Watcher`, which under Stacked Borrows pops the
                    // SharedReadOnly tag that `iter.watcher` (a `*const DirWatcher` derived from
                    // an earlier `&this.platform.watcher`) carries. The next `iter.next()` would
                    // then dereference a pointer with invalidated provenance — UB that MIRI flags.
                    // The callee never touches `platform.watcher`, so re-deriving the pointer
                    // here from the now-current `&mut Watcher` restores valid provenance.
                    iter.watcher = BackRef::new(&this.platform.watcher);
                    // Reset event_id to start a new batch
                    event_id = 0;
                    guard = this.mutex.lock_guard();
                    continue;
                }

                this.watch_events[event_id] =
                    create_watch_event(&event, item_idx as WatchItemIndex);
                event_id += 1;
                item_idx += 1;
            }
        }
        drop(guard);
    }

    // Process any remaining events in the final batch
    if event_id > 0 {
        process_watch_event_batch(this, event_id)?;
    }

    Ok(())
}

fn process_watch_event_batch(this: &mut Watcher, event_count: usize) -> bun_sys::Result<()> {
    if event_count == 0 {
        return Ok(());
    }

    // log("event_count: {d}\n", .{event_count});

    let all_events = &mut this.watch_events[0..event_count];
    all_events.sort_unstable_by(|a, b| WatchEvent::sort_by_index(*a, *b));

    let mut last_event_index: usize = 0;
    // The sentinel must be wider than
    // WatchItemIndex (u16) so it can never collide with a real index (incl. no_watch_item=65535).
    let mut last_event_id: u32 = u32::MAX;

    for i in 0..all_events.len() {
        if all_events[i].index as u32 == last_event_id {
            // reshaped for borrowck — copy then merge to avoid two &mut into all_events.
            let ev = all_events[i];
            all_events[last_event_index].merge(ev);
            continue;
        }
        last_event_index = i;
        last_event_id = all_events[i].index as u32;
    }
    if all_events.is_empty() {
        return Ok(());
    }
    // reshaped for borrowck — copy the (small) deduped slice into a
    // local so `this` is no longer mutably borrowed via `watch_events` when we
    // call `write_trace_events` / `on_file_update`. Mirrors INotifyWatcher.
    let mut deduped: Vec<WatchEvent> = all_events[..last_event_index + 1].to_vec();

    bun_core::scoped_log!(
        watcher,
        "calling onFileUpdate (all_events.len = {})",
        deduped.len()
    );

    // Hold `this.mutex` for the on_file_update dispatch — mirrors
    // KEventWatcher.rs:138 / INotifyWatcher.rs:555. `on_file_update` impls
    // defer `flush_evictions()`, which assumes the lock is held to serialize
    // its close+swap_remove against the JS thread's
    // `snapshot_fd_and_package_json` / `append_file_maybe_lock<true>`.
    let _guard = this.mutex.lock_guard();
    if !this.running.load() {
        return Ok(());
    }
    let changed = &this.changed_filepaths[0..last_event_index + 1];
    this.write_trace_events(&deduped, changed);
    (this.on_file_update)(this.ctx, &mut deduped, changed, &this.watchlist);

    Ok(())
}

pub(crate) fn create_watch_event(event: &FileEvent, index: WatchItemIndex) -> WatchEvent {
    let mut op = Op::empty();
    if event.action == Action::Removed {
        op |= Op::DELETE;
    }
    if event.action == Action::RenamedOld {
        op |= Op::RENAME;
    }
    if event.action == Action::Modified {
        op |= Op::WRITE;
    }
    WatchEvent {
        op,
        index,
        ..Default::default()
    }
}
