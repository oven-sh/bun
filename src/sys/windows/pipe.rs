//! Anonymous pipe pairs.

use core::ptr;
use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
use std::sync::OnceLock;

use bun_windows_sys::externs as w;

use super::{HANDLE, IO_STATUS_BLOCK, NT_SUCCESS, NTSTATUS, Win32Error, nt, ntdll};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PipeMode {
    Overlapped,
    Synchronous,
}

impl PipeMode {
    fn create_options(self) -> u32 {
        match self {
            Self::Overlapped => 0,
            Self::Synchronous => w::FILE_SYNCHRONOUS_IO_NONALERT,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PipeDirection {
    /// From `theirs` to `ours`.
    Inbound,
    /// From `ours` to `theirs`.
    Outbound,
    Duplex,
}

/// Neither handle is inheritable. `ours` is the server end.
pub struct PipePair {
    pub ours: OwnedHandle,
    pub theirs: OwnedHandle,
}

const PIPE_QUOTA: u32 = 64 * 1024;
const READ_ACCESS: u32 = w::GENERIC_READ | w::FILE_WRITE_ATTRIBUTES | w::SYNCHRONIZE;
const WRITE_ACCESS: u32 = w::GENERIC_WRITE | w::FILE_READ_ATTRIBUTES | w::SYNCHRONIZE;

/// `open` writes the new handle to its first argument.
fn create_nt_handle(
    root: Option<HANDLE>,
    name: Option<&[u16]>,
    open: impl FnOnce(*mut HANDLE, *const w::OBJECT_ATTRIBUTES, *mut IO_STATUS_BLOCK) -> NTSTATUS,
) -> Result<OwnedHandle, Win32Error> {
    let mut io: IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    let mut handle = ptr::null_mut();
    let status = nt::with_object_attributes(root, name, |attributes| {
        open(&raw mut handle, attributes, &raw mut io)
    });
    if !NT_SUCCESS(status) {
        return Err(Win32Error::from_ntstatus(status));
    }
    // SAFETY: the call succeeded, so this is a new handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn open_file(
    root: Option<HANDLE>,
    name: Option<&[u16]>,
    access: u32,
    options: u32,
) -> Result<OwnedHandle, Win32Error> {
    create_nt_handle(root, name, |handle, attributes, io| {
        let share = w::FILE_SHARE_READ | w::FILE_SHARE_WRITE;
        // SAFETY: the pointers are valid for the call.
        unsafe { ntdll::NtOpenFile(handle, access, attributes, io, share, options) }
    })
}

pub fn open_pipe_file_system(mode: PipeMode) -> Result<OwnedHandle, Win32Error> {
    let name = bun_core::wstr!("\\Device\\NamedPipe\\").as_slice();
    let access = w::GENERIC_READ | w::SYNCHRONIZE;
    open_file(None, Some(name), access, mode.create_options())
}

fn pipe_file_system() -> Result<HANDLE, Win32Error> {
    static ROOT: OnceLock<OwnedHandle> = OnceLock::new();
    if let Some(root) = ROOT.get() {
        return Ok(root.as_raw_handle());
    }
    let root = open_pipe_file_system(PipeMode::Synchronous)?;
    Ok(ROOT.get_or_init(|| root).as_raw_handle())
}

pub fn create_pipe_pair(
    our_mode: PipeMode,
    their_mode: PipeMode,
    direction: PipeDirection,
) -> Result<PipePair, Win32Error> {
    // The server's share access determines the access that the client can request.
    let (our_access, their_access, share) = match direction {
        PipeDirection::Inbound => (READ_ACCESS, WRITE_ACCESS, w::FILE_SHARE_WRITE),
        PipeDirection::Outbound => (WRITE_ACCESS, READ_ACCESS, w::FILE_SHARE_READ),
        PipeDirection::Duplex => (
            READ_ACCESS | WRITE_ACCESS,
            READ_ACCESS | WRITE_ACCESS,
            w::FILE_SHARE_READ | w::FILE_SHARE_WRITE,
        ),
    };
    let server = create_nt_handle(Some(pipe_file_system()?), None, |handle, attributes, io| {
        // Required, but only used to wait for an instance by name. 50 ms is the `CreateNamedPipeW` default.
        let default_timeout: i64 = -500_000;
        // SAFETY: the pointers are valid for the call.
        unsafe {
            ntdll::NtCreateNamedPipeFile(
                handle,
                our_access,
                attributes,
                io,
                share,
                w::FILE_CREATE,
                our_mode.create_options(),
                w::FILE_PIPE_BYTE_STREAM_TYPE,
                w::FILE_PIPE_BYTE_STREAM_MODE,
                w::FILE_PIPE_QUEUE_OPERATION,
                1,
                PIPE_QUOTA,
                PIPE_QUOTA,
                &raw const default_timeout,
            )
        }
    })?;
    let client = open_file(
        Some(server.as_raw_handle()),
        None,
        their_access,
        w::FILE_NON_DIRECTORY_FILE | their_mode.create_options(),
    )?;
    Ok(PipePair {
        ours: server,
        theirs: client,
    })
}

#[cfg(test)]
mod tests {
    use core::mem::MaybeUninit;

    use super::super::sync_io;
    use super::*;
    use crate::{IoVec, IoVecMut};

    fn read(reader: &OwnedHandle) -> Result<usize, Win32Error> {
        let mut buf = [MaybeUninit::uninit(); 8];
        sync_io::readv(reader.as_raw_handle(), &[IoVecMut::new(&mut buf)], None)
    }

    fn write_and_read(writer: &OwnedHandle, reader: &OwnedHandle) -> Result<usize, Win32Error> {
        sync_io::writev(writer.as_raw_handle(), &[IoVec::new(b"abc")], None)?;
        read(reader)
    }

    #[test]
    fn data_flows_only_in_requested_direction() {
        use PipeDirection::*;
        for our_mode in [PipeMode::Overlapped, PipeMode::Synchronous] {
            for their_mode in [PipeMode::Overlapped, PipeMode::Synchronous] {
                for (direction, outbound_result, inbound_result) in [
                    (Inbound, Err(Win32Error::ACCESS_DENIED), Ok(3)),
                    (Outbound, Ok(3), Err(Win32Error::ACCESS_DENIED)),
                    (Duplex, Ok(3), Ok(3)),
                ] {
                    let pair = create_pipe_pair(our_mode, their_mode, direction).unwrap();
                    assert_eq!(write_and_read(&pair.ours, &pair.theirs), outbound_result);
                    assert_eq!(write_and_read(&pair.theirs, &pair.ours), inbound_result);
                }
            }
        }
    }

    #[test]
    fn read_fails_with_broken_pipe_after_peer_closes() {
        let mode = PipeMode::Overlapped;
        let pair = create_pipe_pair(mode, mode, PipeDirection::Inbound).unwrap();
        drop(pair.theirs);
        assert_eq!(read(&pair.ours), Err(Win32Error::BROKEN_PIPE));
    }
}
