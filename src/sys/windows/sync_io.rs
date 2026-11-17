//! On a handle that was opened for overlapped I/O a request can outlast the call that starts it, and uses its buffers until it ends.

use core::mem::MaybeUninit;
use core::ptr;
use core::time::Duration;
use std::os::windows::io::AsRawHandle as _;

use bun_windows_sys::externs::{IO_STATUS_BLOCK, NT_SUCCESS, WAIT_TIMEOUT};

use super::kernel32::{ReadFile, WaitForSingleObject, WriteFile};
use super::{BOOL, DWORD, HANDLE, INFINITE, NTSTATUS, OVERLAPPED, Win32Error, ntdll};
use crate::Fd;

/// Returns when the request that `start` makes on `handle` has ended. It names no event, APC routine or context, so no completion port hears of it.
pub(crate) fn complete(
    handle: HANDLE,
    start: impl FnOnce(*mut IO_STATUS_BLOCK) -> NTSTATUS,
) -> (NTSTATUS, usize) {
    let mut io = IO_STATUS_BLOCK {
        Status: NTSTATUS::PENDING.0 as usize,
        Information: 0,
    };
    let io = &raw mut io;
    let status = start(io);
    // SAFETY: `io` is live until this function returns.
    unsafe { wait(handle, io, status) }
}

/// SAFETY: `io` is the live status block of the request on `handle` that answered `status`.
unsafe fn wait(
    handle: HANDLE,
    io: *const IO_STATUS_BLOCK,
    mut status: NTSTATUS,
) -> (NTSTATUS, usize) {
    while status == NTSTATUS::PENDING {
        // Every request on the handle resets its signal when it starts and sets it when it ends.
        let waited = WaitForSingleObject(handle, 100);
        // SAFETY: `io` is live. The system writes it from an APC on this thread.
        status = NTSTATUS(unsafe { (&raw const (*io).Status).read_volatile() } as u32);
        if status == NTSTATUS::PENDING && waited != WAIT_TIMEOUT {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    // SAFETY: `io` is live, and the request has ended.
    (status, unsafe { (*io).Information })
}

/// [`complete`] for a call of kernel32. The offset in the `OVERLAPPED` is 0.
pub(crate) fn complete_overlapped(
    start: impl FnOnce(*mut OVERLAPPED) -> BOOL,
) -> Result<(), Win32Error> {
    let event = super::CreateEventW()?;
    let mut overlapped: OVERLAPPED = bun_core::ffi::zeroed();
    // The low bit keeps the request from a completion port.
    overlapped.hEvent = event.as_raw_handle().map_addr(|handle| handle | 1);
    let overlapped = &raw mut overlapped;
    match super::check(start(overlapped)) {
        Err(Win32Error::IO_PENDING) => {}
        result => return result,
    }
    WaitForSingleObject(event.as_raw_handle(), INFINITE);
    // SAFETY: `overlapped` is live, and the request has ended.
    let status = NTSTATUS(unsafe { (*overlapped).Internal } as u32);
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
        // SAFETY: `buf` is writable for `len` bytes until `complete` returns.
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
        // SAFETY: `buf` is readable for `len` bytes until `complete` returns.
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
