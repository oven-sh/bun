//! Bun's filesystem watcher implementation for windows using kernel32

use core::mem::size_of;
use core::ptr;

use crate::watcher_impl::{
    Op, WatchEvent, WatchItemColumns, WatchItemIndex, Watcher, WatcherThread,
};
use bun_core::strings;
use bun_paths::PathBuffer;
use bun_paths::resolve_path::{ParentEqual, is_parent_or_equal};

use bun_collections::index_sort;
use bun_sys::windows as w;
use bun_sys::windows::HANDLE;

bun_core::declare_scope!(watcher, visible);

pub(crate) type Platform = WindowsWatcher;

pub struct WindowsWatcher {
    pub(crate) iocp: HANDLE,
    pub(crate) watcher: DirWatcher,
    pub(crate) buf: PathBuffer,
    pub(crate) base_idx: usize,
}

// SAFETY: handles belong to the process, and `overlapped` points at nothing.
unsafe impl Send for WindowsWatcher {}

impl Default for WindowsWatcher {
    fn default() -> Self {
        Self {
            iocp: w::INVALID_HANDLE_VALUE,
            watcher: DirWatcher {
                overlapped: bun_core::ffi::zeroed(),
                buf: [0u8; 64 * 1024],
                dir_handle: w::INVALID_HANDLE_VALUE,
                read_pending: false,
            },
            buf: PathBuffer::ZEROED,
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

struct FileEvent<'a> {
    pub action: Action,
    pub filename: &'a [u16],
}

#[repr(C)]
pub struct DirWatcher {
    /// must be initialized to zero (even though it's never read or written in our code),
    /// otherwise ReadDirectoryChangesW will fail with INVALID_HANDLE
    pub(crate) overlapped: w::OVERLAPPED,
    /// `FILE_NOTIFY_INFORMATION` is DWORD-aligned (4); the preceding
    /// `OVERLAPPED` (32 bytes, align 8) guarantees `buf` lands at offset 32,
    /// which the `assert_ffi_layout!` below locks in (and `32 % 4 == 0` is the
    /// alignment proof for the cast of the name in
    /// `EventIterator::next`).
    pub(crate) buf: [u8; 64 * 1024],
    pub(crate) dir_handle: HANDLE,
    /// True while a read is in flight. The kernel owns `buf` and `overlapped` until it completes.
    read_pending: bool,
}

// `OVERLAPPED` = 32 bytes / align 8 on Win64; `buf` must be ≥ 4-aligned for
// `ReadDirectoryChangesW`. Asserting the offset (not just the
// total size) is what proves that alignment requirement.
bun_core::assert_ffi_layout!(
    DirWatcher,
    32 + 64 * 1024 + ::core::mem::size_of::<HANDLE>() + ::core::mem::align_of::<w::OVERLAPPED>(),
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
    /// invalidates any EventIterators. No-op if the previous read is still pending, which happens
    /// after a poll times out.
    fn prepare(&mut self) -> bun_sys::Result<()> {
        if self.read_pending {
            return Ok(());
        }
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
            return Err(bun_sys::Error::from_win32(err, bun_sys::Tag::watch));
        }
        bun_core::scoped_log!(watcher, "read directory changes!");
        self.read_pending = true;
        Ok(())
    }
}

/// Iterates `FILE_NOTIFY_INFORMATION` records out of a `DirWatcher`'s buffer.
struct EventIterator {
    pub offset: usize,
    pub has_next: bool,
}

impl EventIterator {
    fn next<'a>(&mut self, buf: &'a [u8]) -> Option<FileEvent<'a>> {
        if !self.has_next {
            return None;
        }
        const NAME_OFFSET: usize = core::mem::offset_of!(w::FILE_NOTIFY_INFORMATION, FileName);
        let record = &buf[self.offset..];
        let [next_entry_offset, action, name_len]: [u32; 3] = bun_core::read_prefix(record)?;
        let filename = bun_core::cast_slice(&record[NAME_OFFSET..][..name_len as usize]);
        self.has_next = next_entry_offset != 0;
        self.offset += next_entry_offset as usize;

        // `transmute` into an exhaustive #[repr(u32)] enum is immediate UB on an unlisted
        // discriminant. Use a checked match — kernel docs guarantee 1..=5 today.
        let action: Action = match action {
            w::FILE_ACTION_ADDED => Action::Added,
            w::FILE_ACTION_REMOVED => Action::Removed,
            w::FILE_ACTION_MODIFIED => Action::Modified,
            w::FILE_ACTION_RENAMED_OLD_NAME => Action::RenamedOld,
            w::FILE_ACTION_RENAMED_NEW_NAME => Action::RenamedNew,
            other => {
                debug_assert!(false, "unexpected FILE_NOTIFY_INFORMATION.Action = {other}");
                return self.next(buf);
            }
        };

        Some(FileEvent { action, filename })
    }
}

impl WindowsWatcher {
    // `Self` carries the 64 KiB `DirWatcher` buffer inline; it is moved once
    // into `Box::new(WatcherThread { .. })` in `Watcher::init`.
    #[allow(clippy::large_unopt_stack_frames)]
    pub(crate) fn new(root: &[u8]) -> crate::Result<Self> {
        let mut this = Self::default();
        this.init(root)?;
        Ok(this)
    }

    fn init(&mut self, root: &[u8]) -> Result<(), crate::Error> {
        use bun_paths::string_paths as paths;
        let mut pathbuf = bun_paths::w_path_buffer_pool::get();
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
        self.watcher.dir_handle = handle;

        self.iocp = w::CreateIoCompletionPort(handle, ptr::null_mut(), 0, 1)
            .map_err(|_| crate::Error::from(Error::IocpFailed))?;

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

        Ok(())
    }

    /// wait until new events are available
    fn next(&mut self, timeout: Timeout) -> bun_sys::Result<Option<EventIterator>> {
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
            // A failed read still dequeues its completion.
            if overlapped == &raw mut self.watcher.overlapped {
                self.watcher.read_pending = false;
            }
            if rc == 0 {
                let err = w::Win32Error::get();
                // `WAIT_TIMEOUT` (258) — not yet a named const on `bun_sys::windows::Win32Error`.
                if err == w::Win32Error::TIMEOUT || err == w::Win32Error(258) {
                    return Ok(None);
                } else {
                    bun_core::scoped_log!(watcher, "GetQueuedCompletionStatus failed: {}", err.0);
                    return Err(bun_sys::Error::from_win32(err, bun_sys::Tag::watch));
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
                    // signal: a closed dir handle surfaces as rc==0 /
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
}

impl Drop for WindowsWatcher {
    fn drop(&mut self) {
        let (mut nbytes, mut key, mut overlapped) = (0, 0, ptr::null_mut());
        // SAFETY: `self` owns both handles, and closing `INVALID_HANDLE_VALUE` does nothing.
        unsafe {
            w::CloseHandle(self.watcher.dir_handle);
            // Closing `dir_handle` completes the read; until then the kernel may write to `buf`.
            if self.watcher.read_pending {
                w::kernel32::GetQueuedCompletionStatus(
                    self.iocp,
                    &mut nbytes,
                    &mut key,
                    &mut overlapped,
                    w::INFINITE,
                );
            }
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

pub(crate) fn watch_loop_cycle(this: &Watcher, thread: &mut WatcherThread) -> bun_sys::Result<()> {
    let base_idx = thread.platform.base_idx;

    let mut event_id: usize = 0;

    // first wait has infinite timeout - we're waiting for the next event and don't want to spin
    let mut timeout = Timeout::Infinite;
    loop {
        let mut iter = match thread.platform.next(timeout)? {
            Some(it) => it,
            None => break,
        };
        // after the first wait, we want to coalesce further events but don't want to wait for them
        // NOTE: using a 1ms timeout would be ideal, but that actually makes the thread wait for at least 10ms more than it should
        // Instead we use a 0ms timeout, which may not do as much coalescing but is more responsive.
        timeout = Timeout::None;
        while let Some(FileEvent { action, filename }) = iter.next(&thread.platform.watcher.buf) {
            let convert_res =
                strings::copy_utf16_into_utf8(&mut thread.platform.buf[base_idx..], filename);
            let eventpath_len = base_idx + convert_res.written;

            bun_core::scoped_log!(
                watcher,
                "watcher update event: (filename: {}, action: {}",
                bstr::BStr::new(&thread.platform.buf[..eventpath_len]),
                <&'static str>::from(action)
            );

            // TODO this probably needs a more sophisticated search algorithm in the future
            // Possible approaches:
            // - Keep a sorted list of the watched paths and perform a binary search. We could use a bool to keep
            //   track of whether the list is sorted and only sort it when we detect a change.
            // - Use a prefix tree. Potentially more efficient for large numbers of watched paths, but complicated
            //   to implement and maintain.
            // - others that i'm not thinking of

            let mut item_idx = usize::MAX;
            loop {
                {
                    // Other threads append to the watchlist under this mutex, which can reallocate it.
                    let watchlist = &this.state.lock().watchlist;
                    // Eviction is a swap-remove, so walk from the end to avoid skipping items.
                    item_idx = item_idx.min(watchlist.len());
                    let eventpath = &thread.platform.buf[..eventpath_len];
                    while item_idx > 0 && event_id < thread.watch_events.len() {
                        item_idx -= 1;
                        let path = &watchlist.items_file_path()[item_idx];
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
                        if rel == ParentEqual::Unrelated {
                            continue;
                        }
                        thread.watch_events[event_id] =
                            create_watch_event(action, item_idx as WatchItemIndex);
                        event_id += 1;
                    }
                }
                if item_idx == 0 {
                    break;
                }
                process_watch_event_batch(this, thread, event_id)?;
                event_id = 0;
            }
        }
    }

    // Process any remaining events in the final batch
    if event_id > 0 {
        process_watch_event_batch(this, thread, event_id)?;
    }

    Ok(())
}

fn process_watch_event_batch(
    this: &Watcher,
    thread: &mut WatcherThread,
    event_count: usize,
) -> bun_sys::Result<()> {
    if event_count == 0 {
        return Ok(());
    }

    // log("event_count: {d}\n", .{event_count});

    let all_events = &mut thread.watch_events[0..event_count];
    index_sort::sort_slice_unstable_by(all_events, |a, b| WatchEvent::sort_by_index(*a, *b));

    let mut last_event_index: usize = 0;
    let mut last_event_id: WatchItemIndex = WatchItemIndex::MAX;

    for i in 0..all_events.len() {
        if all_events[i].index == last_event_id {
            // reshaped for borrowck — copy then merge to avoid two &mut into all_events.
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

    bun_core::scoped_log!(
        watcher,
        "calling onFileUpdate (all_events.len = {})",
        last_event_index + 1
    );

    this.dispatch_file_updates(thread, last_event_index + 1, &[]);
    Ok(())
}

fn create_watch_event(action: Action, index: WatchItemIndex) -> WatchEvent {
    let mut op = Op::empty();
    if action == Action::Removed {
        op |= Op::DELETE;
    }
    if action == Action::RenamedOld {
        op |= Op::RENAME;
    }
    if action == Action::Modified {
        op |= Op::WRITE;
    }
    WatchEvent {
        op,
        index,
        ..Default::default()
    }
}
