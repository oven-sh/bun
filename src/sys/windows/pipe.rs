//! Connected pipe ends that have no name.

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
    OursReads,
    OursWrites,
    Duplex,
}

/// Neither is inheritable. `ours` is the server end.
pub struct PipePair {
    pub ours: OwnedHandle,
    pub theirs: OwnedHandle,
}

const QUOTA: u32 = 64 * 1024;
const READ: u32 = w::GENERIC_READ | w::FILE_WRITE_ATTRIBUTES | w::SYNCHRONIZE;
const WRITE: u32 = w::GENERIC_WRITE | w::FILE_READ_ATTRIBUTES | w::SYNCHRONIZE;

/// Calls `open` with the place for the new handle and the attributes that name `name` below `root`.
fn open_with(
    root: Option<HANDLE>,
    name: Option<&[u16]>,
    open: impl FnOnce(*mut HANDLE, *const w::OBJECT_ATTRIBUTES, *mut IO_STATUS_BLOCK) -> NTSTATUS,
) -> Result<OwnedHandle, Win32Error> {
    let mut io: IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    let mut handle = ptr::null_mut();
    let status = nt::with_attributes(root, name, |attributes| {
        open(&raw mut handle, attributes, &raw mut io)
    });
    if !NT_SUCCESS(status) {
        return Err(Win32Error::from_ntstatus(status));
    }
    // SAFETY: the call succeeded, so this is a new handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn open_below(
    root: Option<HANDLE>,
    name: Option<&[u16]>,
    access: u32,
    options: u32,
) -> Result<OwnedHandle, Win32Error> {
    open_with(root, name, |handle, attributes, io| {
        let share = w::FILE_SHARE_READ | w::FILE_SHARE_WRITE;
        // SAFETY: the pointers are valid for the call.
        unsafe { ntdll::NtOpenFile(handle, access, attributes, io, share, options) }
    })
}

pub fn open_pipe_file_system(mode: PipeMode) -> Result<OwnedHandle, Win32Error> {
    let name = bun_core::wstr!("\\Device\\NamedPipe\\").as_slice();
    let access = w::GENERIC_READ | w::SYNCHRONIZE;
    open_below(None, Some(name), access, mode.create_options())
}

fn pipe_file_system() -> Result<HANDLE, Win32Error> {
    static ROOT: OnceLock<OwnedHandle> = OnceLock::new();
    if let Some(root) = ROOT.get() {
        return Ok(root.as_raw_handle());
    }
    let root = open_pipe_file_system(PipeMode::Synchronous)?;
    Ok(ROOT.get_or_init(|| root).as_raw_handle())
}

pub fn pipe_pair(
    ours: PipeMode,
    theirs: PipeMode,
    direction: PipeDirection,
) -> Result<PipePair, Win32Error> {
    // What the server shares is what the client may do.
    let (our_access, their_access, share) = match direction {
        PipeDirection::OursReads => (READ, WRITE, w::FILE_SHARE_WRITE),
        PipeDirection::OursWrites => (WRITE, READ, w::FILE_SHARE_READ),
        PipeDirection::Duplex => (
            READ | WRITE,
            READ | WRITE,
            w::FILE_SHARE_READ | w::FILE_SHARE_WRITE,
        ),
    };
    let server = open_with(Some(pipe_file_system()?), None, |handle, attributes, io| {
        // Required, and only used to wait for an instance by name. 50 ms is what `CreateNamedPipeW` has.
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
                ours.create_options(),
                w::FILE_PIPE_BYTE_STREAM_TYPE,
                w::FILE_PIPE_BYTE_STREAM_MODE,
                w::FILE_PIPE_QUEUE_OPERATION,
                1,
                QUOTA,
                QUOTA,
                &raw const default_timeout,
            )
        }
    })?;
    let client = open_below(
        Some(server.as_raw_handle()),
        None,
        their_access,
        w::FILE_NON_DIRECTORY_FILE | theirs.create_options(),
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

    fn receive(to: &OwnedHandle) -> Result<usize, Win32Error> {
        let mut buf = [MaybeUninit::uninit(); 8];
        sync_io::readv(to.as_raw_handle(), &[IoVecMut::new(&mut buf)], None)
    }

    fn send(from: &OwnedHandle, to: &OwnedHandle) -> Result<usize, Win32Error> {
        sync_io::writev(from.as_raw_handle(), &[IoVec::new(b"abc")], None)?;
        receive(to)
    }

    #[test]
    fn carries_bytes_in_the_directions_asked_for() {
        use PipeDirection::*;
        for ours in [PipeMode::Overlapped, PipeMode::Synchronous] {
            for theirs in [PipeMode::Overlapped, PipeMode::Synchronous] {
                for (direction, out, back) in [
                    (OursReads, Err(Win32Error::ACCESS_DENIED), Ok(3)),
                    (OursWrites, Ok(3), Err(Win32Error::ACCESS_DENIED)),
                    (Duplex, Ok(3), Ok(3)),
                ] {
                    let pair = pipe_pair(ours, theirs, direction).unwrap();
                    assert_eq!(send(&pair.ours, &pair.theirs), out);
                    assert_eq!(send(&pair.theirs, &pair.ours), back);
                }
            }
        }
    }

    #[test]
    fn closing_one_end_breaks_the_other() {
        let mode = PipeMode::Overlapped;
        let pair = pipe_pair(mode, mode, PipeDirection::OursReads).unwrap();
        drop(pair.theirs);
        assert_eq!(receive(&pair.ours), Err(Win32Error::BROKEN_PIPE));
    }
}
