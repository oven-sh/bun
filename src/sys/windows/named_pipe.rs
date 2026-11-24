//! Windows serializes calls on a synchronous handle, so most of these functions block behind a pending read.

#![allow(
    clippy::not_unsafe_ptr_arg_deref,
    reason = "a `HANDLE` is an opaque value and is never dereferenced"
)]

use core::ptr;
use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;
use std::os::windows::io::{AsRawHandle as _, HandleOrInvalid, OwnedHandle};

use bun_core::WStr;
use bun_windows_sys::externs::{
    FILE_ACCESS_INFORMATION, FILE_FLAG_OVERLAPPED, FILE_FS_DEVICE_INFORMATION,
    FILE_MODE_INFORMATION, FILE_PIPE_INFORMATION, FILE_PIPE_LOCAL_INFORMATION,
    FILE_PIPE_QUEUE_OPERATION, FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SYNCHRONOUS_IO_NONALERT,
    FILE_WRITE_ATTRIBUTES, GENERIC_READ, GENERIC_WRITE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
    WAIT_OBJECT_0,
};

use super::{
    BOOL, DWORD, HANDLE, NT_ERROR, NTSTATUS, ULONG, Win32Error, kernel32, nt, ntdll, sync_io,
};

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn GetNamedPipeClientProcessId(Pipe: HANDLE, ClientProcessId: &mut ULONG) -> BOOL;
    safe fn GetNamedPipeServerProcessId(Pipe: HANDLE, ServerProcessId: &mut ULONG) -> BOOL;
}

/// Non-blocking snapshot of whether `handle` has no request in progress.
pub fn is_idle(handle: HANDLE) -> bool {
    kernel32::WaitForSingleObject(handle, 0) == WAIT_OBJECT_0
}

static HAS_CONCURRENT_READER: AtomicBool = AtomicBool::new(false);

/// Records that another process may read from a pipe end that this process reads.
pub fn mark_concurrent_reader() {
    HAS_CONCURRENT_READER.store(true, Ordering::Relaxed);
}

/// Best-effort check that a call will not block behind a concurrent reader. The caller has no request in progress on `handle`.
pub fn is_sole_reader(handle: HANDLE) -> bool {
    if !HAS_CONCURRENT_READER.load(Ordering::Relaxed) && !is_idle(handle) {
        mark_concurrent_reader();
    }
    !HAS_CONCURRENT_READER.load(Ordering::Relaxed)
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Kind {
    Synchronous,
    Overlapped,
    /// `GetFileType` also reports `FILE_TYPE_PIPE` for sockets.
    NotAPipe,
}

pub fn kind(handle: HANDLE) -> Kind {
    const FILE_SYNCHRONOUS_IO_ALERT: ULONG = 0x10;
    const SYNCHRONOUS_IO: ULONG = FILE_SYNCHRONOUS_IO_ALERT | FILE_SYNCHRONOUS_IO_NONALERT;
    match nt::query_file_info::<FILE_PIPE_INFORMATION>(handle) {
        Ok(_) | Err(NTSTATUS::ACCESS_DENIED) => {}
        Err(_) => return Kind::NotAPipe,
    }
    match nt::query_file_info::<FILE_MODE_INFORMATION>(handle) {
        Ok(info) if info.Mode & SYNCHRONOUS_IO == 0 => Kind::Overlapped,
        _ => Kind::Synchronous,
    }
}

pub fn is_duplex(handle: HANDLE) -> bool {
    const FILE_WRITE_DATA: ULONG = 0x2;
    const READ_WRITE: ULONG = FILE_READ_DATA | FILE_WRITE_DATA;
    nt::query_file_info::<FILE_ACCESS_INFORMATION>(handle)
        .is_ok_and(|info| info.AccessFlags & READ_WRITE == READ_WRITE)
}

/// A remote pipe rejects longer writes and discards the excess bytes of longer reads.
pub(super) const MAX_REMOTE_TRANSFER_LEN: usize = 64 * 1024;

pub fn max_transfer_len(handle: HANDLE) -> usize {
    const FILE_REMOTE_DEVICE: ULONG = 0x10;
    match nt::query_volume_info::<FILE_FS_DEVICE_INFORMATION>(handle) {
        Ok(device) if device.Characteristics & FILE_REMOTE_DEVICE != 0 => MAX_REMOTE_TRANSFER_LEN,
        _ => usize::MAX,
    }
}

/// Bytes that the pipe buffers for this end before a writer blocks.
pub fn input_quota(handle: HANDLE) -> Result<usize, NTSTATUS> {
    const FILE_PIPE_SERVER_END: ULONG = 1;
    let info = nt::query_file_info::<FILE_PIPE_LOCAL_INFORMATION>(handle)?;
    Ok(match info.NamedPipeEnd {
        FILE_PIPE_SERVER_END => info.InboundQuota,
        _ => info.OutboundQuota,
    } as usize)
}

/// Clears `PIPE_NOWAIT`.
pub fn set_blocking(handle: HANDLE) -> Result<(), NTSTATUS> {
    let info = FILE_PIPE_INFORMATION {
        ReadMode: nt::query_file_info::<FILE_PIPE_INFORMATION>(handle)
            .map_or(0, |current| current.ReadMode),
        CompletionMode: FILE_PIPE_QUEUE_OPERATION,
    };
    nt::set_file_info(handle, info)
}

/// `None` if a read would block. An empty message yields `Some(0)`.
pub fn peek_available(handle: HANDLE) -> Result<Option<usize>, NTSTATUS> {
    let [_state, available_len, message_count, _message_len] = nt::peek_pipe(handle)?;
    Ok((available_len > 0 || message_count > 0).then_some(available_len as usize))
}

/// Appends up to `max_len` bytes within the capacity of `buffer`. A zero-length read waits for data without consuming it.
pub fn read(handle: HANDLE, buffer: &mut Vec<u8>, max_len: usize) -> Result<NTSTATUS, NTSTATUS> {
    read_device(handle, buffer, max_len, None)
}

/// [`read`] for other devices. An overlapped device rejects a request without an offset.
pub fn read_device(
    handle: HANDLE,
    buffer: &mut Vec<u8>,
    max_len: usize,
    offset: Option<i64>,
) -> Result<NTSTATUS, NTSTATUS> {
    let spare = buffer.spare_capacity_mut();
    let len = spare.len().min(max_len).min(crate::MAX_COUNT);
    let (status, bytes_read) = sync_io::complete_transfer(handle, |event, io| {
        // SAFETY: `spare` is writable for `len` bytes and outlives the request.
        unsafe {
            ntdll::NtReadFile(
                handle,
                event,
                ptr::null_mut(),
                ptr::null_mut(),
                io,
                spare.as_mut_ptr().cast(),
                len as ULONG,
                offset.as_ref().map_or(ptr::null(), ptr::from_ref),
                ptr::null(),
            )
        }
    });
    if NT_ERROR(status) {
        return Err(status);
    }
    // SAFETY: the kernel initialized the number of bytes it reports.
    unsafe { bun_core::vec::commit_spare(buffer, bytes_read.min(len)) };
    Ok(status)
}

/// The write may be short.
pub fn write(handle: HANDLE, bytes: &[u8]) -> Result<usize, NTSTATUS> {
    let len = bytes.len().min(crate::MAX_COUNT);
    // SAFETY: `bytes` is readable for `len` bytes.
    let (status, written) =
        unsafe { sync_io::write(handle, bytes.as_ptr(), len as DWORD, ptr::null()) };
    if NT_ERROR(status) {
        Err(status)
    } else {
        Ok(written.min(len))
    }
}

/// Creates an overlapped server instance. With `is_first`, fails if a pipe called `name` already exists.
pub fn create_instance(name: &WStr, is_first: bool) -> Result<OwnedHandle, Win32Error> {
    const FILE_FLAG_FIRST_PIPE_INSTANCE: DWORD = 0x0008_0000;
    const PIPE_TYPE_BYTE: DWORD = 0;
    const PIPE_UNLIMITED_INSTANCES: DWORD = 255;
    const BUFFER_SIZE: DWORD = 64 * 1024;
    let first_instance_flag = if is_first {
        FILE_FLAG_FIRST_PIPE_INSTANCE
    } else {
        0
    };
    // SAFETY: `name` is NUL-terminated; the result is a new handle or `INVALID_HANDLE_VALUE`.
    let handle = unsafe {
        HandleOrInvalid::from_raw_handle(kernel32::CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | first_instance_flag,
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

/// Opens an overlapped client end: duplex, else read-only, else write-only. `PIPE_BUSY` if every instance has a client.
pub fn connect(name: &WStr) -> Result<OwnedHandle, Win32Error> {
    let open = |access| super::CreateFileW(name, access, 0, OPEN_EXISTING, FILE_FLAG_OVERLAPPED);
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

/// Serializes a `FILE_PIPE_WAIT_FOR_BUFFER`. `name` excludes the `\\.\pipe\` prefix.
pub fn build_wait_request(name: &[u16], timeout: Duration) -> Vec<u8> {
    // Only a negative value is a relative time.
    let timeout_ticks = -1 - (timeout.as_nanos() / 100) as i64;
    let timeout_specified = [1, 0];
    let name = bun_core::slice_as_bytes(name);
    let name_len = name.len() as u32;
    [
        &timeout_ticks.to_le_bytes(),
        &name_len.to_le_bytes()[..],
        &timeout_specified,
        name,
    ]
    .concat()
}

/// The process that opened the other end, or that opened both ends.
pub fn peer_process_id(handle: HANDLE) -> Option<u32> {
    let mut id = 0;
    if GetNamedPipeClientProcessId(handle, &mut id) != 0 && id != super::GetCurrentProcessId() {
        return Some(id);
    }
    (GetNamedPipeServerProcessId(handle, &mut id) != 0).then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_quota_depends_on_pipe_end() {
        let name = format!(r"\\.\pipe\bun-quota-{}", std::process::id());
        let name: Vec<u16> = name.encode_utf16().chain([0]).collect();
        let out_buffer_size = 4096;
        let in_buffer_size = 8192;
        // SAFETY: `name` is NUL-terminated; the result is a new handle or `INVALID_HANDLE_VALUE`.
        let server = unsafe {
            HandleOrInvalid::from_raw_handle(kernel32::CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                0,
                1,
                out_buffer_size,
                in_buffer_size,
                0,
                ptr::null_mut(),
            ))
        };
        let server = OwnedHandle::try_from(server).unwrap();
        let client = connect(WStr::from_slice_with_nul(&name)).unwrap();
        let quotas = [&client, &server].map(|end| input_quota(end.as_raw_handle()));
        assert_eq!(quotas, [Ok(4096), Ok(8192)]);
    }
}
