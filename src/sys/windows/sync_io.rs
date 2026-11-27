//! On a handle that was opened for overlapped I/O a request can outlast the call that starts it, and uses its buffers until it ends.

use core::mem::MaybeUninit;
use core::ptr;
use core::sync::atomic::{AtomicUsize, Ordering};
use core::time::Duration;
use std::os::windows::io::AsRawHandle as _;

use bun_windows_sys::externs::{IO_STATUS_BLOCK, NT_SUCCESS, WAIT_TIMEOUT};

use super::kernel32::{ReadFile, WaitForSingleObject, WriteFile};
use super::{BOOL, DWORD, HANDLE, INFINITE, NTSTATUS, OVERLAPPED, Win32Error, ntdll};
use crate::Fd;

/// `IO_STATUS_BLOCK`, whose status is read while the system may write it from an APC on this thread.
#[repr(C)]
struct PolledStatusBlock {
    Status: AtomicUsize,
    Information: usize,
}
bun_opaque::assert_ffi_layout!(PolledStatusBlock = IO_STATUS_BLOCK; Status, Information);

/// Returns when the request that `start` makes on `handle` has ended. It names no event, APC routine or context, so no completion port hears of it.
pub(crate) fn complete(
    handle: HANDLE,
    start: impl FnOnce(*mut IO_STATUS_BLOCK) -> NTSTATUS,
) -> (NTSTATUS, usize) {
    let mut io = PolledStatusBlock {
        Status: AtomicUsize::new(NTSTATUS::PENDING.0 as usize),
        Information: 0,
    };
    let status = start((&raw mut io).cast());
    let status = wait(handle, &io.Status, status);
    (status, io.Information)
}

/// `io_status` is that of the request on `handle` that answered `status`.
fn wait(handle: HANDLE, io_status: &AtomicUsize, mut status: NTSTATUS) -> NTSTATUS {
    while status == NTSTATUS::PENDING {
        // Every request on the handle resets its signal when it starts and sets it when it ends.
        let waited = WaitForSingleObject(handle, 100);
        // Relaxed: the writer is an APC on this thread.
        status = NTSTATUS(io_status.load(Ordering::Relaxed) as u32);
        if status == NTSTATUS::PENDING && waited != WAIT_TIMEOUT {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    status
}

/// [`complete`] for a call of kernel32. The offset in the `OVERLAPPED` is 0.
pub(crate) fn complete_overlapped(
    start: impl FnOnce(*mut OVERLAPPED) -> BOOL,
) -> Result<(), Win32Error> {
    let event = super::CreateEventW()?;
    let mut overlapped: OVERLAPPED = bun_core::ffi::zeroed();
    // The low bit keeps the request from a completion port.
    overlapped.hEvent = event.as_raw_handle().map_addr(|handle| handle | 1);
    match super::check(start(&raw mut overlapped)) {
        Err(Win32Error::IO_PENDING) => {}
        result => return result,
    }
    WaitForSingleObject(event.as_raw_handle(), INFINITE);
    let status = NTSTATUS(overlapped.Internal as u32);
    transferred((status, 0)).map(|_| ())
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

/// `ReadFile`, but the end of a file is `HANDLE_EOF` with or without an offset.
pub(crate) fn read(
    handle: HANDLE,
    buf: &mut [MaybeUninit<u8>],
    offset: Option<i64>,
) -> Result<usize, Win32Error> {
    let len = buf.len().min(crate::MAX_COUNT) as DWORD;
    let buf = buf.as_mut_ptr();
    let null = ptr::null_mut();
    if offset.is_none() && is_console(handle) {
        let mut read = 0;
        // SAFETY: `buf` is writable for `len` bytes, and the call is synchronous.
        let rc = unsafe { ReadFile(handle, buf.cast(), len, &raw mut read, null) };
        return super::check(rc).map(|()| read as usize);
    }
    let offset = offset.as_ref().map_or(ptr::null(), ptr::from_ref);
    transferred(complete(handle, |io| {
        // SAFETY: `buf` is writable for `len` bytes, and `io` is live, until `complete` returns.
        unsafe {
            ntdll::NtReadFile(
                handle,
                null,
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
}

/// `WriteFile`.
pub(crate) fn write(handle: HANDLE, buf: &[u8], offset: Option<i64>) -> Result<usize, Win32Error> {
    let len = buf.len().min(crate::MAX_COUNT) as DWORD;
    let buf = buf.as_ptr();
    let null = ptr::null_mut();
    if offset.is_none() && is_console(handle) {
        let mut written = 0;
        // SAFETY: `buf` is readable for `len` bytes, and the call is synchronous.
        let rc = unsafe { WriteFile(handle, buf, len, &raw mut written, null) };
        return super::check(rc).map(|()| written as usize);
    }
    let offset = offset.as_ref().map_or(ptr::null(), ptr::from_ref);
    transferred(complete(handle, |io| {
        // SAFETY: `buf` is readable for `len` bytes, and `io` is live, until `complete` returns.
        unsafe {
            ntdll::NtWriteFile(
                handle,
                null,
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
}
