//! On a handle that was opened for overlapped I/O a request can outlast the call that starts it, and uses its buffers until it ends.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;
use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};
use core::time::Duration;
use std::os::windows::io::{
    AsRawHandle as _, BorrowedHandle, FromRawHandle as _, IntoRawHandle as _, OwnedHandle,
};

use bun_windows_sys::externs::{IO_STATUS_BLOCK, NT_SUCCESS, WAIT_TIMEOUT};

use super::kernel32::{
    CancelIoEx, GetCurrentThreadId, ReadFile, WaitForMultipleObjects, WaitForSingleObject,
    WriteFile,
};
use super::named_pipe::MAX_REMOTE_TRANSFER_LEN;
use super::{
    BOOL, DWORD, FALSE, FILE_TYPE_PIPE, GetFileType, HANDLE, INFINITE, NTSTATUS, OVERLAPPED,
    Win32Error, ntdll,
};
use crate::{Fd, IoVec, IoVecMut};

#[repr(align(64))]
struct EventSlot(AtomicPtr<c_void>);

/// Indexed by thread id. The crash handler writes through this path, so it must not lock or allocate.
static EVENT_CACHE: [EventSlot; 64] = [const { EventSlot(AtomicPtr::new(ptr::null_mut())) }; 64];

struct Event {
    handle: HANDLE,
    slot: &'static AtomicPtr<c_void>,
}

impl Event {
    fn acquire() -> Result<Event, Win32Error> {
        let slot = &EVENT_CACHE[GetCurrentThreadId() as usize / 4 % EVENT_CACHE.len()].0;
        // Relaxed: the slot publishes only the handle value.
        let mut handle = slot.swap(ptr::null_mut(), Ordering::Relaxed);
        if handle.is_null() {
            handle = super::CreateEventW()?.into_raw_handle();
        }
        Ok(Event { handle, slot })
    }

    /// A synchronous handle needs no event, and passing one costs a reset and a signal per request.
    fn acquire_if_needed(file: HANDLE) -> Result<Option<Event>, Win32Error> {
        let is_overlapped = overlapped_cache_slot(file).load(Ordering::Relaxed) == file;
        (is_overlapped || is_interruptible())
            .then(Event::acquire)
            .transpose()
    }

    fn wait(&self) {
        // The kernel uses the request's buffers until it signals the event.
        assert_eq!(WaitForSingleObject(self.handle, INFINITE), 0);
    }

    fn wait_or_cancel(&self, file: HANDLE, request: *mut IO_STATUS_BLOCK) {
        let handles = [self.handle, INTERRUPT_EVENT.get()];
        if !handles[1].is_null() {
            // SAFETY: `handles` has two elements, and `CancelIoEx` only compares the address of `request`.
            unsafe {
                if WaitForMultipleObjects(2, handles.as_ptr(), FALSE, INFINITE) != 0 {
                    CancelIoEx(file, request.cast());
                }
            }
        }
        self.wait();
    }
}

impl Drop for Event {
    fn drop(&mut self) {
        let evicted = self.slot.swap(self.handle, Ordering::Relaxed);
        if !evicted.is_null() {
            // SAFETY: swapping a handle out of its slot transfers ownership of it.
            drop(unsafe { OwnedHandle::from_raw_handle(evicted) });
        }
    }
}

thread_local! {
    static INTERRUPT_EVENT: Cell<HANDLE> = const { Cell::new(ptr::null_mut()) };
}

/// Signaling `event` cancels the overlapped request that `io` waits for, which `CancelSynchronousIo` cannot do.
pub fn with_interrupt_event<T>(event: BorrowedHandle<'_>, io: impl FnOnce() -> T) -> T {
    let previous = INTERRUPT_EVENT.replace(event.as_raw_handle());
    let result = io();
    INTERRUPT_EVENT.set(previous);
    result
}

pub(super) fn is_interruptible() -> bool {
    !INTERRUPT_EVENT.get().is_null()
}

fn is_interrupted() -> bool {
    is_interruptible() && WaitForSingleObject(INTERRUPT_EVENT.get(), 0) == 0
}

/// An `IO_STATUS_BLOCK` that the kernel writes after the initiating call has returned.
#[repr(C)]
#[derive(Default)]
pub struct StatusBlock {
    Status: AtomicUsize,
    Information: AtomicUsize,
}

bun_core::assert_ffi_layout!(StatusBlock = IO_STATUS_BLOCK; Status, Information);

impl StatusBlock {
    fn new_pending() -> StatusBlock {
        let this = StatusBlock::default();
        this.set(NTSTATUS::PENDING, 0);
        this
    }

    pub fn as_ptr(&self) -> *mut IO_STATUS_BLOCK {
        ptr::from_ref(self).cast_mut().cast()
    }

    pub fn set(&self, status: NTSTATUS, information: usize) {
        self.Status.store(status.0 as usize, Ordering::Relaxed);
        self.Information.store(information, Ordering::Relaxed);
    }

    /// The kernel writes `Status` after `Information`.
    pub fn get(&self) -> (NTSTATUS, usize) {
        let status = NTSTATUS(self.Status.load(Ordering::Acquire) as u32);
        (status, self.Information.load(Ordering::Relaxed))
    }
}

/// Returns when the request that `start` makes on `handle` has ended. It names no event, APC routine or context, so no completion port hears of it.
pub(crate) fn complete(
    handle: HANDLE,
    start: impl FnOnce(*mut IO_STATUS_BLOCK) -> NTSTATUS,
) -> (NTSTATUS, usize) {
    let io = StatusBlock::new_pending();
    wait(handle, None, &io, start(io.as_ptr()))
}

/// [`complete`] for a read or write. `start` passes the given event, which may be null, to the request.
pub(super) fn complete_transfer(
    handle: HANDLE,
    start: impl FnOnce(HANDLE, *mut IO_STATUS_BLOCK) -> NTSTATUS,
) -> (NTSTATUS, usize) {
    let Ok(event) = Event::acquire_if_needed(handle) else {
        return (NTSTATUS::INSUFFICIENT_RESOURCES, 0);
    };
    let io = StatusBlock::new_pending();
    let event_handle = event.as_ref().map_or(ptr::null_mut(), |event| event.handle);
    wait(
        handle,
        event.as_ref(),
        &io,
        start(event_handle, io.as_ptr()),
    )
}

/// Direct-mapped cache of the handles that have returned `STATUS_PENDING`.
fn overlapped_cache_slot(handle: HANDLE) -> &'static AtomicPtr<c_void> {
    static OVERLAPPED_HANDLES: [AtomicPtr<c_void>; 64] =
        [const { AtomicPtr::new(ptr::null_mut()) }; 64];
    &OVERLAPPED_HANDLES[handle.addr() / 4 % OVERLAPPED_HANDLES.len()]
}

fn wait(
    handle: HANDLE,
    event: Option<&Event>,
    io: &StatusBlock,
    status: NTSTATUS,
) -> (NTSTATUS, usize) {
    if status != NTSTATUS::PENDING {
        return (status, io.get().1);
    }
    if let Some(event) = event {
        event.wait_or_cancel(handle, io.as_ptr());
        return io.get();
    }
    overlapped_cache_slot(handle).store(handle, Ordering::Relaxed);
    loop {
        // Every request on the handle resets its signal when it starts and sets it when it ends.
        let waited = WaitForSingleObject(handle, 100);
        if io.get().0 != NTSTATUS::PENDING {
            return io.get();
        }
        if waited != WAIT_TIMEOUT {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

/// [`complete`] for a call of kernel32. The offset in the `OVERLAPPED` is 0.
pub(crate) fn complete_overlapped(
    start: impl FnOnce(*mut OVERLAPPED) -> BOOL,
) -> Result<(), Win32Error> {
    let mut overlapped: OVERLAPPED = bun_core::ffi::zeroed();
    let event = Event::acquire()?;
    // The low bit keeps the request from a completion port.
    overlapped.hEvent = event.handle.map_addr(|handle| handle | 1);
    match super::check(start(&raw mut overlapped)) {
        Err(Win32Error::IO_PENDING) => event.wait(),
        result => return result,
    }
    transferred((NTSTATUS(overlapped.Internal as u32), 0)).map(|_| ())
}

fn transferred((status, bytes): (NTSTATUS, usize)) -> Result<usize, Win32Error> {
    if NT_SUCCESS(status) {
        return Ok(bytes);
    }
    Err(Win32Error::from_ntstatus(status))
}

/// A console is never overlapped, and terminals such as ConEmu hook `ReadFile` and `WriteFile` for it.
fn is_console(handle: HANDLE) -> bool {
    use bun_core::output::{is_stderr_tty, is_stdin_tty, is_stdout_tty};
    (is_stdout_tty() && handle == Fd::stdout().native())
        || (is_stderr_tty() && handle == Fd::stderr().native())
        || (is_stdin_tty() && handle == Fd::stdin().native())
}

/// Issues one request per chunk. After a partial transfer, an error is left for the next call to report.
fn transfer_chunks(
    chunks: impl Iterator<Item = (*mut u8, usize)>,
    offset: Option<i64>,
    mut request: impl FnMut(*mut u8, DWORD, *const i64) -> Result<usize, Win32Error>,
) -> Result<usize, Win32Error> {
    let mut total = 0;
    for (base, len) in chunks {
        let offset = offset.map(|offset| offset.saturating_add_unsigned(total as u64));
        let offset = offset.as_ref().map_or(ptr::null(), ptr::from_ref);
        // A `CancelSynchronousIo` that raced with the previous request's completion would wait for this request.
        let result = if is_interrupted() {
            Err(Win32Error::OPERATION_ABORTED)
        } else {
            request(base, len as DWORD, offset)
        };
        match result {
            Ok(bytes) if bytes < len => return Ok(total + bytes),
            Ok(_) => total += len,
            Err(_) if total > 0 => break,
            Err(error) => return Err(error),
        }
    }
    Ok(total)
}

/// `ReadFile`, but the end of a file is `HANDLE_EOF` with or without an offset.
pub(crate) fn readv(
    handle: HANDLE,
    vecs: &[IoVecMut<'_>],
    offset: Option<i64>,
) -> Result<usize, Win32Error> {
    let null = ptr::null_mut();
    let is_console = is_console(handle);
    transfer_chunks(IoVecMut::chunks(vecs), offset, |buf, len, offset| {
        if is_console {
            let mut read = 0;
            // SAFETY: `buf` is writable for `len` bytes, and the call is synchronous.
            let rc = unsafe { ReadFile(handle, buf, len, &raw mut read, null) };
            return super::check(rc).map(|()| read as usize);
        }
        let result = complete_transfer(handle, |event, io| {
            // SAFETY: `buf` is writable for `len` bytes, and `io` is live, until `complete_transfer` returns.
            unsafe {
                ntdll::NtReadFile(
                    handle,
                    event,
                    null,
                    null,
                    io,
                    buf.cast(),
                    len,
                    offset,
                    ptr::null(),
                )
            }
        });
        match result {
            // A partial message read: the next read returns the remainder.
            (NTSTATUS::BUFFER_OVERFLOW, bytes) => Ok(bytes),
            result => transferred(result),
        }
    })
}

/// `WriteFile`.
pub(crate) fn writev(
    handle: HANDLE,
    vecs: &[IoVec<'_>],
    offset: Option<i64>,
) -> Result<usize, Win32Error> {
    let null = ptr::null_mut();
    let is_console = is_console(handle);
    transfer_chunks(IoVec::chunks(vecs), offset, |buf, len, offset| {
        if is_console {
            let mut written = 0;
            // SAFETY: `buf` is readable for `len` bytes, and the call is synchronous.
            let rc = unsafe { WriteFile(handle, buf, len, &raw mut written, null) };
            return super::check(rc).map(|()| written as usize);
        }
        // SAFETY: `buf` is readable for `len` bytes, and `offset` is null or from `transfer_chunks`.
        transferred(unsafe { write(handle, buf, len, offset) })
    })
}

/// SAFETY: `buf` is readable for `len` bytes, and `offset` is null or readable.
pub(super) unsafe fn write(
    handle: HANDLE,
    buf: *const u8,
    len: DWORD,
    offset: *const i64,
) -> (NTSTATUS, usize) {
    let issue_write = |len| {
        complete_transfer(handle, |event, io| {
            let null = ptr::null_mut();
            // SAFETY: fn contract. It holds, and `io` is live, until `complete_transfer` returns.
            unsafe {
                ntdll::NtWriteFile(
                    handle,
                    event,
                    null,
                    null,
                    io,
                    buf.cast(),
                    len,
                    offset,
                    ptr::null(),
                )
            }
        })
    };
    match issue_write(len) {
        (NTSTATUS::INVALID_PARAMETER, _)
            if len as usize > MAX_REMOTE_TRANSFER_LEN && GetFileType(handle) == FILE_TYPE_PIPE =>
        {
            issue_write(MAX_REMOTE_TRANSFER_LEN as DWORD)
        }
        result => result,
    }
}
