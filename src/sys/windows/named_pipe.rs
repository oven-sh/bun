//! On a synchronous end the system runs one call at a time: most of these wait for a read that has no data yet.

#![allow(
    clippy::not_unsafe_ptr_arg_deref,
    reason = "a `HANDLE` is only a number"
)]

use core::ptr;
use std::os::windows::io::{AsRawHandle as _, HandleOrInvalid, OwnedHandle};

use bun_core::WStr;
use bun_windows_sys::externs::{
    FILE_FLAG_OVERLAPPED, FILE_INFORMATION_CLASS, FILE_READ_ATTRIBUTES, FILE_WRITE_ATTRIBUTES,
    GENERIC_READ, GENERIC_WRITE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX, WAIT_OBJECT_0,
};

use super::{BOOL, DWORD, HANDLE, NT_ERROR, NTSTATUS, ULONG, Win32Error, kernel32, ntdll, sync_io};

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn GetNamedPipeClientProcessId(Pipe: HANDLE, ClientProcessId: &mut ULONG) -> BOOL;
    safe fn GetNamedPipeServerProcessId(Pipe: HANDLE, ServerProcessId: &mut ULONG) -> BOOL;
}

/// `FILE_PIPE_INFORMATION`
type PipeModes = [ULONG; 2];
const FILE_ACCESS_INFORMATION: FILE_INFORMATION_CLASS = FILE_INFORMATION_CLASS(8);
const FILE_MODE_INFORMATION: FILE_INFORMATION_CLASS = FILE_INFORMATION_CLASS(16);
const FILE_PIPE_INFORMATION: FILE_INFORMATION_CLASS = FILE_INFORMATION_CLASS(23);

fn query<const N: usize>(
    handle: HANDLE,
    class: FILE_INFORMATION_CLASS,
) -> Result<[ULONG; N], NTSTATUS> {
    let mut information = [0; N];
    // SAFETY: the buffer has the size that is passed. A query has ended when it returns.
    let status = unsafe {
        ntdll::NtQueryInformationFile(
            handle,
            &mut bun_core::ffi::zeroed(),
            information.as_mut_ptr().cast(),
            size_of_val(&information) as ULONG,
            class,
        )
    };
    if NT_ERROR(status) {
        Err(status)
    } else {
        Ok(information)
    }
}

/// Returns at once. Whether no call was under way a moment ago.
pub fn is_idle(handle: HANDLE) -> bool {
    kernel32::WaitForSingleObject(handle, 0) == WAIT_OBJECT_0
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Kind {
    Synchronous,
    Overlapped,
    /// `GetFileType` says `FILE_TYPE_PIPE` for a socket too.
    NotAPipe,
}

pub fn kind(handle: HANDLE) -> Kind {
    const FILE_SYNCHRONOUS_IO: ULONG = 0x10 | 0x20;
    match query::<2>(handle, FILE_PIPE_INFORMATION) {
        Ok(_) | Err(NTSTATUS::ACCESS_DENIED) => {}
        Err(_) => return Kind::NotAPipe,
    }
    match query(handle, FILE_MODE_INFORMATION) {
        Ok([mode]) if mode & FILE_SYNCHRONOUS_IO == 0 => Kind::Overlapped,
        _ => Kind::Synchronous,
    }
}

pub fn is_duplex(handle: HANDLE) -> bool {
    const FILE_READ_AND_WRITE_DATA: ULONG = 1 | 2;
    query(handle, FILE_ACCESS_INFORMATION)
        .is_ok_and(|[access]| access & FILE_READ_AND_WRITE_DATA == FILE_READ_AND_WRITE_DATA)
}

/// Undoes `PIPE_NOWAIT`.
pub fn set_blocking(handle: HANDLE) -> Result<(), NTSTATUS> {
    let [read_mode, _] = query(handle, FILE_PIPE_INFORMATION).unwrap_or_default();
    let mut modes: PipeModes = [read_mode, 0];
    // SAFETY: as in `query`.
    let status = unsafe {
        ntdll::NtSetInformationFile(
            handle,
            &mut bun_core::ffi::zeroed(),
            modes.as_mut_ptr().cast(),
            size_of_val(&modes) as ULONG,
            FILE_PIPE_INFORMATION,
        )
    };
    if NT_ERROR(status) {
        Err(status)
    } else {
        Ok(())
    }
}

/// How much to try next. With `PIPE_NOWAIT` a write of `len` bytes takes all or nothing.
pub fn after_empty_write(handle: HANDLE, len: usize) -> usize {
    set_blocking(handle).map_or_else(|_| len.div_ceil(2), |()| usize::MAX)
}

/// Whether a read would return at once with data or an empty message.
pub fn has_input(handle: HANDLE) -> Result<bool, NTSTATUS> {
    const FSCTL_PIPE_PEEK: ULONG = 0x0011_400C;
    // The head of `FILE_PIPE_PEEK_BUFFER`.
    let mut peek: [ULONG; 4] = [0; 4];
    let (status, _) = sync_io::complete(handle, |io| {
        // SAFETY: the buffer has the size that is passed, and outlasts `complete`.
        unsafe {
            ntdll::NtFsControlFile(
                handle,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                io,
                FSCTL_PIPE_PEEK,
                ptr::null_mut(),
                0,
                peek.as_mut_ptr().cast(),
                size_of_val(&peek) as ULONG,
            )
        }
    });
    let [_state, bytes, messages, _message_len] = peek;
    if NT_ERROR(status) {
        Err(status)
    } else {
        Ok(bytes > 0 || messages > 0)
    }
}

/// Appends at most `max_len` bytes to `buffer`, within its capacity. With 0 it waits for data, and leaves it there.
pub fn read(handle: HANDLE, buffer: &mut Vec<u8>, max_len: usize) -> Result<NTSTATUS, NTSTATUS> {
    let spare = buffer.spare_capacity_mut();
    let len = spare.len().min(max_len).min(crate::MAX_COUNT);
    let (status, read) = sync_io::complete_transfer(handle, |event, io| {
        // SAFETY: `spare` is writable for `len` bytes, and outlasts the request.
        unsafe {
            ntdll::NtReadFile(
                handle,
                event,
                ptr::null_mut(),
                ptr::null_mut(),
                io,
                spare.as_mut_ptr().cast(),
                len as ULONG,
                ptr::null(),
                ptr::null(),
            )
        }
    });
    if NT_ERROR(status) {
        return Err(status);
    }
    // SAFETY: the system wrote as many bytes as it reports.
    unsafe { bun_core::vec::commit_spare(buffer, read.min(len)) };
    Ok(status)
}

/// Returns how much of `bytes` it took.
pub fn write(handle: HANDLE, bytes: &[u8]) -> Result<usize, NTSTATUS> {
    let len = bytes.len().min(crate::MAX_COUNT);
    let (status, written) = sync_io::complete_transfer(handle, |event, io| {
        // SAFETY: `bytes` is readable for `len` bytes, and outlasts the request.
        unsafe {
            ntdll::NtWriteFile(
                handle,
                event,
                ptr::null_mut(),
                ptr::null_mut(),
                io,
                bytes.as_ptr().cast(),
                len as ULONG,
                ptr::null(),
                ptr::null(),
            )
        }
    });
    if NT_ERROR(status) {
        Err(status)
    } else {
        Ok(written.min(len))
    }
}

/// One more end for a client to connect to, for overlapped I/O. The first fails if there is a pipe of that name.
pub fn create_instance(name: &WStr, is_first: bool) -> Result<OwnedHandle, Win32Error> {
    const FILE_FLAG_FIRST_PIPE_INSTANCE: DWORD = 0x0008_0000;
    const PIPE_TYPE_BYTE: DWORD = 0;
    const PIPE_UNLIMITED_INSTANCES: DWORD = 255;
    const BUFFER_SIZE: DWORD = 64 * 1024;
    let first = if is_first {
        FILE_FLAG_FIRST_PIPE_INSTANCE
    } else {
        0
    };
    // SAFETY: `name` ends with a NUL. The result is a new handle or `INVALID_HANDLE_VALUE`.
    let handle = unsafe {
        HandleOrInvalid::from_raw_handle(kernel32::CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | first,
            PIPE_TYPE_BYTE,
            PIPE_UNLIMITED_INSTANCES,
            BUFFER_SIZE,
            BUFFER_SIZE,
            0,
            ptr::null_mut(),
        ))
    };
    OwnedHandle::try_from(handle).map_err(|_| Win32Error::get())
}

/// For overlapped I/O, in the directions that the pipe allows. `PIPE_BUSY` if every instance has a client.
pub fn connect(name: &WStr) -> Result<OwnedHandle, Win32Error> {
    const SECURITY_SQOS_PRESENT: DWORD = 0x0010_0000;
    const SECURITY_IDENTIFICATION: DWORD = 0x0001_0000;
    let open = |access| {
        let flags = FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION;
        super::CreateFileW(name, access, 0, OPEN_EXISTING, flags)
    };
    let mut result = open(GENERIC_READ | GENERIC_WRITE);
    for access in [
        GENERIC_READ | FILE_WRITE_ATTRIBUTES,
        GENERIC_WRITE | FILE_READ_ATTRIBUTES,
    ] {
        if let Err(Win32Error::ACCESS_DENIED) = result {
            result = open(access);
        }
    }
    let handle = result?;
    if super::GetFileType(handle.as_raw_handle()) != super::FILE_TYPE_PIPE {
        return Err(Win32Error::WSAENOTSOCK);
    }
    Ok(handle)
}

/// `FILE_PIPE_WAIT_FOR_BUFFER`. `name` is what follows `\\.\pipe\`.
pub fn wait_request(name: &[u16], timeout_ms: u32) -> Vec<u8> {
    let timeout = i64::from(timeout_ms) * -10_000;
    let has_timeout = [1, 0];
    let name = bun_core::slice_as_bytes(name);
    let len = name.len() as u32;
    [
        &timeout.to_le_bytes(),
        &len.to_le_bytes()[..],
        &has_timeout,
        name,
    ]
    .concat()
}

/// The process that opened the other end, or both.
pub fn peer_process_id(handle: HANDLE) -> Option<u32> {
    let mut id = 0;
    if GetNamedPipeClientProcessId(handle, &mut id) != 0 && id != super::GetCurrentProcessId() {
        return Some(id);
    }
    (GetNamedPipeServerProcessId(handle, &mut id) != 0).then_some(id)
}
