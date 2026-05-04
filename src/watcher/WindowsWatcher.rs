//! Bun's filesystem watcher implementation for windows using kernel32

use core::mem::size_of;
use core::ptr;

use bun_paths::{self as path, PathBuffer, WPathBuffer};
use bun_str::strings;
use bun_sys::windows as w;
use bun_sys::windows::HANDLE;
use bun_threading::Mutex;
use bun_watcher::{WatchEvent, WatchItemIndex, Watcher};

bun_output::declare_scope!(watcher, visible);

pub struct WindowsWatcher {
    pub mutex: Mutex,
    pub iocp: HANDLE,
    pub watcher: DirWatcher,
    pub buf: PathBuffer,
    pub base_idx: usize,
}

pub type EventListIndex = core::ffi::c_int;

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum Error {
    #[error("IocpFailed")]
    IocpFailed,
    #[error("ReadDirectoryChangesFailed")]
    ReadDirectoryChangesFailed,
    #[error("CreateFileFailed")]
    CreateFileFailed,
    #[error("InvalidPath")]
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
            // SAFETY: GetLastError has no preconditions; reads thread-local last-error.
            let err = unsafe { w::kernel32::GetLastError() };
            bun_output::scoped_log!(
                watcher,
                "failed to start watching directory: {}",
                <&'static str>::from(err)
            );
            return bun_sys::Result::Err(bun_sys::Error {
                errno: bun_sys::SystemErrno::init(err)
                    .unwrap_or(bun_sys::SystemErrno::EINVAL) as _,
                syscall: bun_sys::Syscall::Watch,
                ..Default::default()
            });
        }
        bun_output::scoped_log!(watcher, "read directory changes!");
        bun_sys::Result::Ok(())
    }
}

pub struct EventIterator<'a> {
    pub watcher: &'a DirWatcher,
    pub offset: usize,
    pub has_next: bool,
}

impl<'a> EventIterator<'a> {
    pub fn next(&mut self) -> Option<FileEvent> {
        if !self.has_next {
            return None;
        }
        let info_size = size_of::<w::FILE_NOTIFY_INFORMATION>();
        // SAFETY: self.watcher.buf was filled by ReadDirectoryChangesW with a sequence of
        // FILE_NOTIFY_INFORMATION records; offset is advanced only by NextEntryOffset values
        // returned by the kernel, so each cast targets a properly-aligned record header.
        let info: &w::FILE_NOTIFY_INFORMATION = unsafe {
            &*(self.watcher.buf.as_ptr().add(self.offset) as *const w::FILE_NOTIFY_INFORMATION)
        };
        // SAFETY: the variable-length filename immediately follows the fixed header.
        let name_ptr: *mut u16 = unsafe {
            self.watcher
                .buf
                .as_ptr()
                .add(self.offset + info_size)
                .cast::<u16>() as *mut u16
        };
        let filename: *mut [u16] = core::ptr::slice_from_raw_parts_mut(
            name_ptr,
            (info.FileNameLength as usize) / size_of::<u16>(),
        );

        // SAFETY: info.Action is one of FILE_ACTION_* (1..=5), all of which are Action variants.
        let action: Action = unsafe { core::mem::transmute::<u32, Action>(info.Action) };

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
    // bun_watcher::Watcher (64KB+ buffers; avoid moving). Zig sig: `fn init(this, root) !void`.
    pub fn init(&mut self, root: &[u8]) -> Result<(), bun_core::Error> {
        let mut pathbuf = WPathBuffer::uninit();
        let wpath = strings::to_nt_path(&mut pathbuf, root);
        let path_len_bytes: u16 = (wpath.len() * 2) as u16;
        let mut nt_name = w::UNICODE_STRING {
            Length: path_len_bytes,
            MaximumLength: path_len_bytes,
            Buffer: wpath.as_ptr() as *mut u16,
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
            bun_output::scoped_log!(
                watcher,
                "failed to open directory for watching: {}",
                <&'static str>::from(err)
            );
            return Err(Error::CreateFileFailed.into());
        }
        let handle_guard = scopeguard::guard(handle, |h| unsafe {
            // SAFETY: handle was successfully opened by NtCreateFile above.
            let _ = w::CloseHandle(h);
        });

        // TODO(port): narrow error set — Zig `try w.CreateIoCompletionPort` returns a Zig std error.
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
        let needs_slash = root.is_empty() || !strings::char_is_any_slash(root[root.len() - 1]);
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
    pub fn next(&mut self, timeout: Timeout) -> bun_sys::Result<Option<EventIterator<'_>>> {
        match self.watcher.prepare() {
            bun_sys::Result::Err(err) => {
                bun_output::scoped_log!(watcher, "prepare() returned error");
                return bun_sys::Result::Err(err);
            }
            bun_sys::Result::Ok(()) => {}
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
                // SAFETY: GetLastError has no preconditions; reads thread-local last-error.
                let err = unsafe { w::kernel32::GetLastError() };
                if err == w::Win32Error::TIMEOUT || err == w::Win32Error::WAIT_TIMEOUT {
                    return bun_sys::Result::Ok(None);
                } else {
                    bun_output::scoped_log!(
                        watcher,
                        "GetQueuedCompletionStatus failed: {}",
                        <&'static str>::from(err)
                    );
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::SystemErrno::init(err)
                            .unwrap_or(bun_sys::SystemErrno::EINVAL)
                            as _,
                        syscall: bun_sys::Syscall::Watch,
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
                    bun_output::scoped_log!(watcher, "shutdown notification in WindowsWatcher.next");
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::SystemErrno::ESHUTDOWN as _,
                        syscall: bun_sys::Syscall::Watch,
                        ..Default::default()
                    });
                }
                return bun_sys::Result::Ok(Some(EventIterator {
                    watcher: &self.watcher,
                    offset: 0,
                    has_next: true,
                }));
            } else {
                bun_output::scoped_log!(
                    watcher,
                    "GetQueuedCompletionStatus returned no overlapped event"
                );
                return bun_sys::Result::Err(bun_sys::Error {
                    errno: bun_sys::E::INVAL as _,
                    syscall: bun_sys::Syscall::Watch,
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
        let mut iter = match this.platform.next(timeout) {
            bun_sys::Result::Err(err) => return bun_sys::Result::Err(err),
            bun_sys::Result::Ok(iter) => match iter {
                Some(it) => it,
                None => break,
            },
        };
        // after the first wait, we want to coalesce further events but don't want to wait for them
        // NOTE: using a 1ms timeout would be ideal, but that actually makes the thread wait for at least 10ms more than it should
        // Instead we use a 0ms timeout, which may not do as much coalescing but is more responsive.
        timeout = Timeout::None;
        let item_paths = this.watchlist.items_file_path();
        bun_output::scoped_log!(watcher, "number of watched items: {}", item_paths.len());
        while let Some(event) = iter.next() {
            // SAFETY: event.filename points into this.platform.watcher.buf which is live for
            // the duration of this iteration (no prepare() called until outer loop reiterates).
            let filename: &[u16] = unsafe { &*event.filename };
            let buf = &mut this.platform.buf;
            let convert_res = strings::copy_utf16_into_utf8(&mut buf[base_idx..], filename);
            let eventpath = &buf[0..base_idx + convert_res.written];

            bun_output::scoped_log!(
                watcher,
                "watcher update event: (filename: {}, action: {}",
                bstr::BStr::new(eventpath),
                <&'static str>::from(event.action)
            );

            // TODO this probably needs a more sophisticated search algorithm in the future
            // Possible approaches:
            // - Keep a sorted list of the watched paths and perform a binary search. We could use a bool to keep
            //   track of whether the list is sorted and only sort it when we detect a change.
            // - Use a prefix tree. Potentially more efficient for large numbers of watched paths, but complicated
            //   to implement and maintain.
            // - others that i'm not thinking of

            for (item_idx, path) in item_paths.iter().enumerate() {
                // check if the current change applies to this item
                // if so, add it to the eventlist
                let rel = path::is_parent_or_equal(path, eventpath);
                bun_output::scoped_log!(
                    watcher,
                    "checking path: {} = .{}",
                    bstr::BStr::new(path),
                    <&'static str>::from(rel)
                );
                // skip unrelated items
                if rel == path::ParentEqual::Unrelated {
                    continue;
                }
                // if the event is for a parent dir of the item, only emit it if it's a delete or rename

                // Check if we're about to exceed the watch_events array capacity
                if event_id >= this.watch_events.len() {
                    // Process current batch of events
                    match process_watch_event_batch(this, event_id) {
                        bun_sys::Result::Err(err) => return bun_sys::Result::Err(err),
                        bun_sys::Result::Ok(()) => {}
                    }
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
        match process_watch_event_batch(this, event_id) {
            bun_sys::Result::Err(err) => return bun_sys::Result::Err(err),
            bun_sys::Result::Ok(()) => {}
        }
    }

    bun_sys::Result::Ok(())
}

fn process_watch_event_batch(this: &mut Watcher, event_count: usize) -> bun_sys::Result<()> {
    if event_count == 0 {
        return bun_sys::Result::Ok(());
    }

    // log("event_count: {d}\n", .{event_count});

    let all_events = &mut this.watch_events[0..event_count];
    all_events.sort_unstable_by(WatchEvent::sort_by_index);

    let mut last_event_index: usize = 0;
    let mut last_event_id: u32 = u32::MAX;

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
        return bun_sys::Result::Ok(());
    }
    let all_events = &mut this.watch_events[0..last_event_index + 1];

    bun_output::scoped_log!(
        watcher,
        "calling onFileUpdate (all_events.len = {})",
        all_events.len()
    );

    this.write_trace_events(all_events, &this.changed_filepaths[0..last_event_index + 1]);
    (this.on_file_update)(
        this.ctx,
        all_events,
        &this.changed_filepaths[0..last_event_index + 1],
        &this.watchlist,
    );

    bun_sys::Result::Ok(())
}

pub fn create_watch_event(event: &FileEvent, index: WatchItemIndex) -> WatchEvent {
    WatchEvent {
        op: bun_watcher::WatchEventOp {
            delete: event.action == Action::Removed,
            rename: event.action == Action::RenamedOld,
            write: event.action == Action::Modified,
            ..Default::default()
        },
        index,
        ..Default::default()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/watcher/WindowsWatcher.zig (323 lines)
//   confidence: medium
//   todos:      4
//   notes:      Windows FFI types (OVERLAPPED, FILE_NOTIFY_INFORMATION, kernel32/ntdll fns) assumed in bun_sys::windows; watch_loop_cycle reshaped for borrowck (buf/platform/watchlist overlap); buf alignment + in-place init flagged.
// ──────────────────────────────────────────────────────────────────────────
