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
use super::{BOOL, DWORD, FALSE, HANDLE, INFINITE, NTSTATUS, OVERLAPPED, Win32Error, ntdll};
use crate::{Fd, IoVec, IoVecMut};

#[repr(align(64))]
struct SpareEvent(AtomicPtr<c_void>);

/// By thread id. The crash handler writes through here, so this takes no lock and no memory.
static SPARE_EVENTS: [SpareEvent; 64] = [const { SpareEvent(AtomicPtr::new(ptr::null_mut())) }; 64];

struct Event {
    handle: HANDLE,
    spare: &'static AtomicPtr<c_void>,
}

impl Event {
    fn take() -> Result<Event, Win32Error> {
        let spare = &SPARE_EVENTS[GetCurrentThreadId() as usize / 4 % SPARE_EVENTS.len()].0;
        // The cell holds the handle alone, which the system gives to one thread at a time.
        let mut handle = spare.swap(ptr::null_mut(), Ordering::Relaxed);
        if handle.is_null() {
            handle = super::CreateEventW()?.into_raw_handle();
        }
        Ok(Event { handle, spare })
    }

    /// A synchronous handle needs none, and the system would reset and set it every time.
    fn take_for(file: HANDLE) -> Result<Option<Event>, Win32Error> {
        let is_overlapped = overlapped_note(file).load(Ordering::Relaxed) == file;
        (is_overlapped || !INTERRUPT.get().is_null())
            .then(Event::take)
            .transpose()
    }

    fn wait(&self) {
        // The buffers are not free before the signal.
        assert_eq!(WaitForSingleObject(self.handle, INFINITE), 0);
    }

    fn wait_or_cancel(&self, file: HANDLE, request: *mut IO_STATUS_BLOCK) {
        let either = [self.handle, INTERRUPT.get()];
        if !either[1].is_null() {
            // SAFETY: an array of two handles, and an address that is only compared.
            unsafe {
                if WaitForMultipleObjects(2, either.as_ptr(), FALSE, INFINITE) != 0 {
                    CancelIoEx(file, request.cast());
                }
            }
        }
        self.wait();
    }
}

impl Drop for Event {
    fn drop(&mut self) {
        let extra = self.spare.swap(self.handle, Ordering::Relaxed);
        if !extra.is_null() {
            // SAFETY: whoever takes an event out of the table owns it.
            drop(unsafe { OwnedHandle::from_raw_handle(extra) });
        }
    }
}

thread_local! {
    static INTERRUPT: Cell<HANDLE> = const { Cell::new(ptr::null_mut()) };
}

/// A signal of `interrupt` cancels what `io` waits for on an overlapped handle, which `CancelSynchronousIo` does not.
pub fn interruptible<T>(interrupt: BorrowedHandle<'_>, io: impl FnOnce() -> T) -> T {
    let outer = INTERRUPT.replace(interrupt.as_raw_handle());
    let result = io();
    INTERRUPT.set(outer);
    result
}

/// The `IO_STATUS_BLOCK` of a request that outlasts the call that starts it.
#[repr(C)]
#[derive(Default)]
pub struct StatusBlock {
    status: AtomicUsize,
    information: AtomicUsize,
}

const _: () = assert!(size_of::<StatusBlock>() == size_of::<IO_STATUS_BLOCK>());

impl StatusBlock {
    fn pending() -> StatusBlock {
        let this = StatusBlock::default();
        this.set(NTSTATUS::PENDING, 0);
        this
    }

    pub fn as_ptr(&self) -> *mut IO_STATUS_BLOCK {
        ptr::from_ref(self).cast_mut().cast()
    }

    pub fn set(&self, status: NTSTATUS, information: usize) {
        self.status.store(status.0 as usize, Ordering::Relaxed);
        self.information.store(information, Ordering::Relaxed);
    }

    /// The system writes the status last.
    pub fn get(&self) -> (NTSTATUS, usize) {
        let status = NTSTATUS(self.status.load(Ordering::Acquire) as u32);
        (status, self.information.load(Ordering::Relaxed))
    }
}

/// Returns when the request that `start` makes on `handle` has ended. It names no event, APC routine or context, so no completion port hears of it.
pub(crate) fn complete(
    handle: HANDLE,
    start: impl FnOnce(*mut IO_STATUS_BLOCK) -> NTSTATUS,
) -> (NTSTATUS, usize) {
    let io = StatusBlock::pending();
    wait(handle, None, &io, start(io.as_ptr()))
}

/// [`complete`] for a read or a write, which names the event. That can be null.
pub(super) fn complete_transfer(
    handle: HANDLE,
    start: impl FnOnce(HANDLE, *mut IO_STATUS_BLOCK) -> NTSTATUS,
) -> (NTSTATUS, usize) {
    let Ok(event) = Event::take_for(handle) else {
        return (NTSTATUS::INSUFFICIENT_RESOURCES, 0);
    };
    let io = StatusBlock::pending();
    let signal = event.as_ref().map_or(ptr::null_mut(), |it| it.handle);
    wait(handle, event.as_ref(), &io, start(signal, io.as_ptr()))
}

/// The handle itself, if one of its requests has outlasted the call.
fn overlapped_note(handle: HANDLE) -> &'static AtomicPtr<c_void> {
    static NOTES: [AtomicPtr<c_void>; 64] = [const { AtomicPtr::new(ptr::null_mut()) }; 64];
    &NOTES[handle.addr() / 4 % NOTES.len()]
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
    overlapped_note(handle).store(handle, Ordering::Relaxed);
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
    let event = Event::take()?;
    // The low bit keeps the request from a completion port.
    overlapped.hEvent = event.handle.map_addr(|handle| handle | 1);
    match super::check(start(&raw mut overlapped)) {
        Err(Win32Error::IO_PENDING) => event.wait(),
        result => return result,
    }
    transferred((NTSTATUS(overlapped.Internal as u32), 0)).map(|_| ())
}

fn transferred((status, bytes): (NTSTATUS, usize)) -> Result<usize, Win32Error> {
    // The rest of a message that does not fit waits for the next read.
    if NT_SUCCESS(status) || status == NTSTATUS::BUFFER_OVERFLOW {
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

/// One request for each part. An error behind some bytes is left for the next call.
fn each_part(
    parts: impl Iterator<Item = (*mut u8, usize)>,
    offset: Option<i64>,
    mut request: impl FnMut(*mut u8, DWORD, *const i64) -> Result<usize, Win32Error>,
) -> Result<usize, Win32Error> {
    let mut total = 0;
    for (base, len) in parts {
        let offset = offset.map(|offset| offset.saturating_add_unsigned(total as u64));
        let offset = offset.as_ref().map_or(ptr::null(), ptr::from_ref);
        match request(base, len as DWORD, offset) {
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
    each_part(IoVecMut::parts(vecs), offset, |buf, len, offset| {
        if is_console {
            let mut read = 0;
            // SAFETY: `buf` is writable for `len` bytes, and the call is synchronous.
            let rc = unsafe { ReadFile(handle, buf, len, &raw mut read, null) };
            return super::check(rc).map(|()| read as usize);
        }
        transferred(complete_transfer(handle, |event, io| {
            // SAFETY: `buf` is writable for `len` bytes until that returns.
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
        }))
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
    each_part(IoVec::parts(vecs), offset, |buf, len, offset| {
        if is_console {
            let mut written = 0;
            // SAFETY: `buf` is readable for `len` bytes, and the call is synchronous.
            let rc = unsafe { WriteFile(handle, buf, len, &raw mut written, null) };
            return super::check(rc).map(|()| written as usize);
        }
        transferred(complete_transfer(handle, |event, io| {
            // SAFETY: `buf` is readable for `len` bytes until that returns.
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
        }))
    })
}
