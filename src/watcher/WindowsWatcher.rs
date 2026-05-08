//! Bun's filesystem watcher implementation for windows using kernel32

use core::mem::size_of;
use core::ptr;

use bun_paths::{self as path, PathBuffer, WPathBuffer};
use bun_paths::resolve_path::{is_parent_or_equal, ParentEqual};
use bun_core::strings;
use bun_threading::Mutex;
use crate::watcher_impl::{Op, WatchEvent, WatchItemColumns, WatchItemIndex, Watcher};

use bun_sys::windows as w;
use bun_sys::windows::HANDLE;

bun_core::declare_scope!(watcher, visible);

pub type Platform = WindowsWatcher;

pub type EventListIndex = core::ffi::c_int;

pub struct WindowsWatcher {
    pub mutex: Mutex,
    pub iocp: HANDLE,
    pub watcher: DirWatcher,
    pub buf: PathBuffer,
    pub base_idx: usize,
}

impl Default for WindowsWatcher {
    fn default() -> Self {
        Self {
            mutex: Mutex::default(),
            iocp: w::INVALID_HANDLE_VALUE,
            watcher: DirWatcher {
                // SAFETY: all-zero is a valid OVERLAPPED (#[repr(C)] POD).
                overlapped: unsafe { core::mem::zeroed() },
                buf: [0u8; 64 * 1024],
                dir_handle: w::INVALID_HANDLE_VALUE,
            },
            buf: PathBuffer::uninit(),
            base_idx: 0,
        }
    }
}

#[derive(Debug, strum::IntoStaticStr)]
pub enum Error {
    IocpFailed,
    ReadDirectoryChangesFailed,
    CreateFileFailed,
    InvalidPath,
}
impl From<Error> for bun_core::Error {
    fn from(e: Error) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
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

pub struct FileEvent {
    pub action: Action,
    pub filename: *mut [u16],
    // TODO(port): lifetime — Zig `[]u16` borrows DirWatcher.buf; raw slice ptr to avoid
    // a struct lifetime param in Phase A. Callers in this file deref immediately.
}

#[repr(C)]
pub struct DirWatcher {
    /// must be initialized to zero (even though it's never read or written in our code),
    /// otherwise ReadDirectoryChangesW will fail with INVALID_HANDLE
    pub overlapped: w::OVERLAPPED,
    // TODO(port): Zig had `align(@alignOf(w.FILE_NOTIFY_INFORMATION))` on this field.
    // FILE_NOTIFY_INFORMATION is DWORD-aligned (4); preceding OVERLAPPED guarantees ≥ that,
    // but Phase B should add an explicit `#[repr(align(4))]` wrapper or static-assert.
    pub buf: [u8; 64 * 1024],
    pub dir_handle: HANDLE,
}

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
            bun_core::scoped_log!(
                watcher,
                "failed to start watching directory: {}",
                err.0
            );
            // TODO(b2-blocked): bun_sys::Tag::watch — full syscall enum not yet in subset.
            return Err(bun_sys::Error {
                // `bun_sys::windows::Win32Error` and `bun_errno::Win32Error`
                // are distinct u16 newtypes (consolidate in Phase B); route the
                // raw code through the `u32` `SystemErrnoInit` impl, which maps
                // via the same Win32→errno table.
                errno: bun_sys::SystemErrno::init(err.0 as u32)
                    .unwrap_or(bun_sys::SystemErrno::EINVAL) as _,
                syscall: bun_sys::Tag::TODO,
                ..Default::default()
            });
        }
        bun_core::scoped_log!(watcher, "read directory changes!");
        Ok(())
    }
}

/// Iterates `FILE_NOTIFY_INFORMATION` records out of a `DirWatcher`'s buffer.
///
/// PORT NOTE: holds a raw `*const DirWatcher` instead of a lifetime-carrying
/// `&'a DirWatcher` so `WindowsWatcher::next` does not keep `&mut Watcher.platform`
/// borrowed across `watch_loop_cycle`'s inner loop (which mutates sibling
/// fields). Safety invariant: the iterator is only advanced while the owning
/// `DirWatcher` is alive and `prepare()` has not been re-called.
pub struct EventIterator {
    pub watcher: *const DirWatcher,
    pub offset: usize,
    pub has_next: bool,
}

impl EventIterator {
    pub fn next(&mut self) -> Option<FileEvent> {
        if !self.has_next {
            return None;
        }
        // PORT NOTE: Zig std's FILE_NOTIFY_INFORMATION omits the flexible FileName member
        // (so `@sizeOf` == 12 == offset of FileName); the Rust binding includes
        // `FileName: [WCHAR; 1]`, so `size_of` == 16. Use the field offset, not the struct
        // size, to locate the variable-length filename.
        let name_offset = core::mem::offset_of!(w::FILE_NOTIFY_INFORMATION, FileName);
        // SAFETY: `self.watcher` points at a live DirWatcher whose `buf` was filled by
        // ReadDirectoryChangesW with a sequence of FILE_NOTIFY_INFORMATION records;
        // `offset` is advanced only by NextEntryOffset values returned by the kernel,
        // so each cast targets a properly-aligned record header.
        let buf_ptr = unsafe { (*self.watcher).buf.as_ptr() };
        let info: &w::FILE_NOTIFY_INFORMATION =
            unsafe { &*(buf_ptr.add(self.offset).cast::<w::FILE_NOTIFY_INFORMATION>()) };
        // SAFETY: the variable-length filename begins at the FileName field of the record.
        let name_ptr: *mut u16 =
            unsafe { buf_ptr.add(self.offset + name_offset).cast::<u16>() as *mut u16 };
        let filename: *mut [u16] = core::ptr::slice_from_raw_parts_mut(
            name_ptr,
            (info.FileNameLength as usize) / size_of::<u16>(),
        );

        // PORT NOTE: Zig `@enumFromInt` is safety-checked in debug; Rust `transmute`
        // into an exhaustive #[repr(u32)] enum is immediate UB on an unlisted
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
    // TODO(port): in-place init — `self` is the pre-allocated `platform` slot inside
    // crate::Watcher (64KB+ buffers; avoid moving). Zig sig: `fn init(this, root) !void`.
    pub fn init(&mut self, root: &[u8]) -> Result<(), bun_core::Error> {
        use bun_string::strings::paths;
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
        let mut io: w::IO_STATUS_BLOCK = unsafe {
            // SAFETY: IO_STATUS_BLOCK is a #[repr(C)] POD output parameter; NtCreateFile
            // writes it before any read.
            core::mem::zeroed()
        };
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
            bun_core::scoped_log!(
                watcher,
                "failed to open directory for watching: {}",
                err.0
            );
            return Err(Error::CreateFileFailed.into());
        }
        let handle_guard = scopeguard::guard(handle, |h| unsafe {
            // SAFETY: handle was successfully opened by NtCreateFile above.
            let _ = w::CloseHandle(h);
        });

        self.iocp = w::CreateIoCompletionPort(*handle_guard, ptr::null_mut(), 0, 1)
            .map_err(|_| bun_core::Error::from(Error::IocpFailed))?;
        let iocp_guard = scopeguard::guard(self.iocp, |h| unsafe {
            // SAFETY: iocp handle was successfully created above.
            let _ = w::CloseHandle(h);
        });

        self.watcher = DirWatcher {
            // SAFETY: all-zero is a valid OVERLAPPED (#[repr(C)] POD; kernel treats zero as "no event/offset").
            overlapped: unsafe { core::mem::zeroed::<w::OVERLAPPED>() },
            // SAFETY: buf is an output buffer filled by ReadDirectoryChangesW before read.
            buf: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
            dir_handle: *handle_guard,
        };

        self.buf[..root.len()].copy_from_slice(root);
        let needs_slash = root.is_empty() || !paths::char_is_any_slash(root[root.len() - 1]);
        if needs_slash {
            self.buf[root.len()] = b'\\';
        }
        self.base_idx = if needs_slash { root.len() + 1 } else { root.len() };

        // disarm errdefer guards on success
        scopeguard::ScopeGuard::into_inner(iocp_guard);
        scopeguard::ScopeGuard::into_inner(handle_guard);
        Ok(())
    }

    /// wait until new events are available
    pub fn next(&mut self, timeout: Timeout) -> bun_sys::Result<Option<EventIterator>> {
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
                    bun_core::scoped_log!(
                        watcher,
                        "GetQueuedCompletionStatus failed: {}",
                        err.0
                    );
                    // TODO(b2-blocked): bun_sys::Tag::watch
                    return Err(bun_sys::Error {
                        errno: bun_sys::SystemErrno::init(err.0 as u32)
                            .unwrap_or(bun_sys::SystemErrno::EINVAL)
                            as _,
                        syscall: bun_sys::Tag::TODO,
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
                    // shutdown notification
                    // TODO close handles?
                    bun_core::scoped_log!(watcher, "shutdown notification in WindowsWatcher.next");
                    return Err(bun_sys::Error {
                        errno: bun_sys::SystemErrno::ESHUTDOWN as _,
                        syscall: bun_sys::Tag::TODO,
                        ..Default::default()
                    });
                }
                return Ok(Some(EventIterator {
                    watcher: &self.watcher as *const DirWatcher,
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
                    syscall: bun_sys::Tag::TODO,
                    ..Default::default()
                });
            }
        }
    }

    pub fn stop(&mut self) {
        // SAFETY: handles were opened in init() and are valid until stop() is called once.
        unsafe {
            w::CloseHandle(self.watcher.dir_handle);
            w::CloseHandle(self.iocp);
        }
    }
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Timeout {
    Infinite = w::INFINITE,
    Minimal = 1,
    None = 0,
}

pub fn watch_loop_cycle(this: &mut Watcher) -> bun_sys::Result<()> {
    // PORT NOTE: reshaped for borrowck — Zig held `&this.platform.buf` across the loop while
    // also calling `this.platform.next()`. We re-borrow buf inside the inner loop instead.
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
        bun_core::scoped_log!(
            watcher,
            "number of watched items: {}",
            this.watchlist.items_file_path().len()
        );
        while let Some(event) = iter.next() {
            // SAFETY: event.filename points into this.platform.watcher.buf which is live for
            // the duration of this iteration (no prepare() called until outer loop reiterates).
            let filename: &[u16] = unsafe { &*event.filename };
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

            let n_items = this.watchlist.items_file_path().len();
            for item_idx in 0..n_items {
                // PORT NOTE: reshaped for borrowck — `rel` is computed in a scoped
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
                    continue;
                }
                // if the event is for a parent dir of the item, only emit it if it's a delete or rename

                // Check if we're about to exceed the watch_events array capacity
                if event_id >= this.watch_events.len() {
                    // Process current batch of events
                    process_watch_event_batch(this, event_id)?;
                    // Reset event_id to start a new batch
                    event_id = 0;
                }

                this.watch_events[event_id] =
                    create_watch_event(&event, item_idx as WatchItemIndex);
                event_id += 1;
            }
        }
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
    all_events.sort_unstable_by(WatchEvent::sort_by_index);

    let mut last_event_index: usize = 0;
    let mut last_event_id: WatchItemIndex = WatchItemIndex::MAX;

    for i in 0..all_events.len() {
        if all_events[i].index == last_event_id {
            // PORT NOTE: reshaped for borrowck — copy then merge to avoid two &mut into all_events.
            let ev = all_events[i];
            all_events[last_event_index].merge(ev);
            continue;
        }
        last_event_index = i;
        last_event_id = all_events[i].index;
    }
    if all_events.is_empty() {
        return Ok(());
    }
    // PORT NOTE: reshaped for borrowck — copy the (small) deduped slice into a
    // local so `this` is no longer mutably borrowed via `watch_events` when we
    // call `write_trace_events` / `on_file_update`. Mirrors INotifyWatcher.
    let mut deduped: Vec<WatchEvent> = all_events[..last_event_index + 1].to_vec();

    bun_core::scoped_log!(
        watcher,
        "calling onFileUpdate (all_events.len = {})",
        deduped.len()
    );

    let changed = &this.changed_filepaths[0..last_event_index + 1];
    this.write_trace_events(&deduped, changed);
    (this.on_file_update)(this.ctx, &mut deduped, changed, &this.watchlist);

    Ok(())
}

pub fn create_watch_event(event: &FileEvent, index: WatchItemIndex) -> WatchEvent {
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

// ported from: src/watcher/WindowsWatcher.zig
