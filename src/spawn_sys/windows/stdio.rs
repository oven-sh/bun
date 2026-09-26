//! The child's stdio: the handles it inherits, the pipes to it, and the C
//! runtime's description of them.

use core::ptr;

use super::win32::{self, DWORD, HANDLE, INVALID_HANDLE_VALUE};

/// Flags of the C runtime's fd table (`lowio`), as far as a parent sets them.
pub const FOPEN: u8 = 0x01;
pub const FPIPE: u8 = 0x08;
pub const FDEV: u8 = 0x40;

/// The CRT's limit is 8192 and `cbReserved2` would allow 7281; this is libuv's
/// cap, kept.
pub const MAX_STDIO: usize = 255;

/// One fd of the child: the handle it inherits (`INVALID_HANDLE_VALUE` for a
/// closed fd) and its CRT flags (0 for a closed fd).
#[derive(Clone, Copy)]
pub struct ChildFd {
    pub handle: HANDLE,
    pub crt_flags: u8,
}

impl ChildFd {
    pub const CLOSED: ChildFd = ChildFd {
        handle: INVALID_HANDLE_VALUE,
        crt_flags: 0,
    };
}

/// `STARTUPINFOW.lpReserved2`: how the MSVCRT/UCRT startup code learns the
/// child's fds, the only way fds above 2 reach it. Packed, so the handle array
/// is unaligned:
///
/// ```text
/// i32  count
/// u8   crt_flags[count]
/// HANDLE os_handle[count]
/// ```
///
/// The CRT trusts `count` without checking it against `cbReserved2`, so the
/// block must be exactly this long.
pub fn make_crt_block(fds: &[ChildFd]) -> Vec<u8> {
    debug_assert!(fds.len() <= MAX_STDIO);
    let mut block = Vec::with_capacity(4 + fds.len() * (1 + size_of::<HANDLE>()));
    block.extend_from_slice(&(fds.len() as i32).to_ne_bytes());
    block.extend(fds.iter().map(|fd| fd.crt_flags));
    for fd in fds {
        block.extend_from_slice(&(fd.handle as usize).to_ne_bytes());
    }
    block
}

/// CRT flags for a handle of unknown kind. `FDEV` makes the child's `isatty()`
/// true, so it is only for character devices.
pub fn crt_flags_for(handle: HANDLE) -> Result<u8, DWORD> {
    match win32::GetFileType(handle) {
        win32::FILE_TYPE_DISK => Ok(FOPEN),
        win32::FILE_TYPE_PIPE => Ok(FOPEN | FPIPE),
        win32::FILE_TYPE_CHAR | win32::FILE_TYPE_REMOTE => Ok(FOPEN | FDEV),
        _ => match win32::GetLastError() {
            0 => Ok(FOPEN | FDEV),
            err => Err(err),
        },
    }
}

/// A duplicate of `handle`, not inheritable.
pub fn duplicate(handle: HANDLE) -> Result<HANDLE, DWORD> {
    // `_get_osfhandle` answers -2 for a stdio fd with no stream attached, and
    // `DuplicateHandle` would happily duplicate that pseudo handle.
    if handle == INVALID_HANDLE_VALUE || handle.is_null() || handle as isize == -2 {
        return Err(win32::ERROR_INVALID_HANDLE);
    }
    let mut dup: HANDLE = INVALID_HANDLE_VALUE;
    let process = win32::GetCurrentProcess();
    // SAFETY: `dup` is a valid out-pointer.
    if unsafe {
        win32::DuplicateHandle(
            process,
            handle,
            process,
            &mut dup,
            0,
            0,
            win32::DUPLICATE_SAME_ACCESS,
        )
    } == 0
    {
        return Err(win32::GetLastError());
    }
    Ok(dup)
}

/// Whether a child created with `bInheritHandles` gets `handle`. Only a spawn
/// holding [`InheritableHandles`](super::InheritableHandles) may set it.
///
/// For a handle the spawn made itself: its other flag, protect-from-close, is
/// clear, so both are written without the read `SetHandleInformation` does
/// first.
pub fn set_inheritable(handle: HANDLE, inheritable: bool) -> Result<(), DWORD> {
    let flags = win32::OBJECT_HANDLE_FLAG_INFORMATION {
        Inherit: u8::from(inheritable),
        ProtectFromClose: 0,
    };
    // SAFETY: `flags` is the structure `ObjectHandleFlagInformation` takes.
    let status = unsafe {
        win32::NtSetInformationObject(
            handle,
            win32::ObjectHandleFlagInformation,
            ptr::from_ref(&flags).cast(),
            size_of::<win32::OBJECT_HANDLE_FLAG_INFORMATION>() as DWORD,
        )
    };
    if status != win32::NTSTATUS::SUCCESS {
        return Err(win32::RtlNtStatusToDosError(status));
    }
    Ok(())
}

/// A handle to `NUL`. A child started without one of fds 0-2 can misbehave, so
/// an ignored one gets this instead of nothing.
pub fn open_nul(writable: bool) -> Result<HANDLE, DWORD> {
    const NUL: [u16; 4] = [b'N' as u16, b'U' as u16, b'L' as u16, 0];
    let access = if writable {
        win32::FILE_GENERIC_WRITE | win32::FILE_READ_ATTRIBUTES
    } else {
        win32::FILE_GENERIC_READ
    };
    // SAFETY: `NUL` is NUL-terminated.
    let handle = unsafe {
        win32::CreateFileW(
            NUL.as_ptr(),
            access,
            win32::FILE_SHARE_READ | win32::FILE_SHARE_WRITE,
            ptr::null_mut(),
            win32::OPEN_EXISTING,
            0,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(win32::GetLastError());
    }
    Ok(handle)
}

/// How the child uses its end of a pipe.
#[derive(Clone, Copy)]
pub struct ChildPipe {
    pub readable: bool,
    pub writable: bool,
    /// The child's end is synchronous unless this is set: programs doing plain
    /// `ReadFile`/`_read` on an overlapped handle lose data or crash as soon as
    /// two of their threads use it at once.
    pub overlapped: bool,
}

/// Neither end is inheritable: a child inherits every inheritable handle of
/// this process, so an end is made inheritable only by the spawn it is for,
/// while that holds [`InheritableHandles`](super::InheritableHandles).
pub struct PipePair {
    /// Overlapped, not associated with a completion port.
    pub parent: HANDLE,
    pub child: HANDLE,
}

/// A connected named-pipe pair for one stdio slot.
pub fn create_pipe_pair(child: ChildPipe) -> Result<PipePair, DWORD> {
    use std::io::Write as _;

    // The parent end always gets read access: it carries the
    // FILE_READ_ATTRIBUTES needed to query the pipe's state when writing.
    let mut server_access = win32::PIPE_ACCESS_INBOUND
        | win32::FILE_FLAG_OVERLAPPED
        | win32::FILE_FLAG_FIRST_PIPE_INSTANCE
        | win32::WRITE_DAC;
    if child.readable {
        server_access |= win32::PIPE_ACCESS_OUTBOUND;
    }
    let client_access = win32::WRITE_DAC
        | if child.readable {
            win32::GENERIC_READ
        } else {
            win32::FILE_READ_ATTRIBUTES
        }
        | if child.writable {
            win32::GENERIC_WRITE
        } else {
            win32::FILE_WRITE_ATTRIBUTES
        };

    let pid = win32::GetCurrentProcessId();
    // An AppContainer may only create pipes under `\pipe\LOCAL\`.
    let local = if bun_sys::windows::is_app_container() {
        "LOCAL\\"
    } else {
        ""
    };

    let mut name_w = [0u16; 64];
    let server = loop {
        let serial = bun_sys::windows::fs::next_pipe_serial();
        let mut name = [0u8; 63];
        let len = {
            let mut cursor = &mut name[..];
            let _ = write!(cursor, "\\\\?\\pipe\\{local}bun\\{pid}-{serial}");
            63 - cursor.len()
        };
        for (w, &b) in name_w.iter_mut().zip(&name[..len]) {
            *w = u16::from(b);
        }
        name_w[len] = 0;

        // SAFETY: `name_w` is NUL-terminated.
        let server = unsafe {
            win32::CreateNamedPipeW(
                name_w.as_ptr(),
                server_access,
                win32::PIPE_TYPE_BYTE
                    | win32::PIPE_READMODE_BYTE
                    | win32::PIPE_WAIT
                    | win32::PIPE_REJECT_REMOTE_CLIENTS,
                1,
                65536,
                65536,
                0,
                ptr::null_mut(),
            )
        };
        if server != INVALID_HANDLE_VALUE {
            break server;
        }
        match win32::GetLastError() {
            // The name is taken: FILE_FLAG_FIRST_PIPE_INSTANCE refuses to join
            // someone else's pipe. Try the next one.
            win32::ERROR_PIPE_BUSY | win32::ERROR_ACCESS_DENIED => {}
            err => return Err(err),
        }
    };

    // SAFETY: `name_w` is NUL-terminated.
    let client = unsafe {
        win32::CreateFileW(
            name_w.as_ptr(),
            client_access,
            0,
            ptr::null_mut(),
            win32::OPEN_EXISTING,
            win32::SECURITY_SQOS_PRESENT
                | win32::SECURITY_ANONYMOUS
                | if child.overlapped {
                    win32::FILE_FLAG_OVERLAPPED
                } else {
                    0
                },
            ptr::null_mut(),
        )
    };
    if client == INVALID_HANDLE_VALUE {
        let err = win32::GetLastError();
        // SAFETY: `server` is a handle this function owns.
        unsafe { win32::CloseHandle(server) };
        return Err(err);
    }

    Ok(PipePair {
        parent: server,
        child: client,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(v: usize) -> HANDLE {
        v as HANDLE
    }

    #[test]
    fn crt_block_layout_is_packed() {
        let fds = [
            ChildFd {
                handle: h(0x1111),
                crt_flags: FOPEN | FDEV,
            },
            ChildFd {
                handle: h(0x2222),
                crt_flags: FOPEN | FPIPE,
            },
            ChildFd::CLOSED,
            ChildFd {
                handle: h(0x4444),
                crt_flags: FOPEN,
            },
        ];
        let block = make_crt_block(&fds);
        let ptr_size = size_of::<usize>();
        assert_eq!(block.len(), 4 + 4 + 4 * ptr_size);
        assert_eq!(block[..4], 4i32.to_ne_bytes());
        assert_eq!(block[4..8], [0x41, 0x09, 0x00, 0x01]);
        let handle_at = |i: usize| {
            let start = 8 + i * ptr_size;
            usize::from_ne_bytes(block[start..start + ptr_size].try_into().unwrap())
        };
        assert_eq!(handle_at(0), 0x1111);
        assert_eq!(handle_at(1), 0x2222);
        assert_eq!(handle_at(2), usize::MAX);
        assert_eq!(handle_at(3), 0x4444);
    }

    #[test]
    fn largest_block_fits_cb_reserved2() {
        let fds = [ChildFd::CLOSED; MAX_STDIO];
        assert!(u16::try_from(make_crt_block(&fds).len()).is_ok());
    }
}
