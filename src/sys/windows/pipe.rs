//! Pipes without a name, the `socketpair` of Windows: they work where the `\\.\pipe\` namespace is off limits.

use core::ffi::c_void;
use core::mem::take;
use core::ptr::{from_mut, null, null_mut};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_core::ffi::zeroed;
use bun_core::w;
use bun_windows_sys::externs::{
    CloseHandle, FALSE, FILE_CREATE, FILE_INFORMATION_CLASS, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
    FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_SYNCHRONOUS_IO_NONALERT, GENERIC_READ, GENERIC_WRITE,
    NT_SUCCESS, OBJECT_ATTRIBUTES, OVERLAPPED, SYNCHRONIZE, TRUE, UNICODE_STRING,
};

use super::{
    BOOL, DWORD, HANDLE, INFINITE, IO_STATUS_BLOCK, NTSTATUS, ULONG, Win32Error, kernel32, ntdll,
};
use crate::{Error, Fd, FdExt as _, Maybe, Tag};

const OBJ_INHERIT: ULONG = 0x2;
const OBJ_CASE_INSENSITIVE: ULONG = 0x40;
const FILE_PIPE_BYTE_STREAM_TYPE: ULONG = 0;
const FILE_PIPE_BYTE_STREAM_MODE: ULONG = 0;
const FILE_PIPE_QUEUE_OPERATION: ULONG = 0;
const WRITE_DAC: ULONG = 0x40000;
/// What libuv asks for, so a child finds the rights that it finds under Node.js.
const DUPLEX: ULONG = GENERIC_READ | GENERIC_WRITE | SYNCHRONIZE | WRITE_DAC;

/// How much either side can write before the other has read any of it.
pub const BUFFER_SIZE: ULONG = 65536;

#[link(name = "ntdll")]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn NtCreateNamedPipeFile(
        handle: *mut HANDLE,
        access: ULONG,
        attributes: *mut OBJECT_ATTRIBUTES,
        io: *mut IO_STATUS_BLOCK,
        share: ULONG,
        disposition: ULONG,
        options: ULONG,
        pipe_type: ULONG,
        read_mode: ULONG,
        completion_mode: ULONG,
        max_instances: ULONG,
        inbound_quota: ULONG,
        outbound_quota: ULONG,
        default_timeout: *mut i64,
    ) -> NTSTATUS;
    fn GetOverlappedResult(
        file: HANDLE,
        overlapped: *mut OVERLAPPED,
        transferred: *mut DWORD,
        wait: BOOL,
    ) -> BOOL;
}

/// Clears `PIPE_NOWAIT` for everybody who has this end, as libuv does. `false`: not a pipe, or it stays in that mode.
pub(super) fn make_writes_wait(handle: HANDLE) -> bool {
    /// `FILE_PIPE_INFORMATION`
    #[repr(C)]
    struct Information {
        read_mode: ULONG,
        completion_mode: ULONG,
    }
    const CLASS: FILE_INFORMATION_CLASS = FILE_INFORMATION_CLASS::FilePipeInformation;
    const SIZE: ULONG = size_of::<Information>() as ULONG;
    let mut io = zeroed::<IO_STATUS_BLOCK>();
    let mut information = Information {
        read_mode: FILE_PIPE_BYTE_STREAM_MODE,
        completion_mode: FILE_PIPE_QUEUE_OPERATION,
    };
    let pointer = (&raw mut information).cast::<c_void>();
    // SAFETY: `io` and `information` are valid for the call, and the size is that of the latter.
    let status =
        unsafe { ntdll::NtQueryInformationFile(handle, &raw mut io, pointer, SIZE, CLASS) };
    if status != NTSTATUS::SUCCESS {
        return false;
    }
    if information.completion_mode == FILE_PIPE_QUEUE_OPERATION {
        return true;
    }
    let mut information = Information {
        completion_mode: FILE_PIPE_QUEUE_OPERATION,
        ..information
    };
    let pointer = (&raw mut information).cast::<c_void>();
    // SAFETY: as above.
    unsafe {
        ntdll::NtSetInformationFile(handle, &raw mut io, pointer, SIZE, CLASS) == NTSTATUS::SUCCESS
    }
}

#[derive(Clone, Copy)]
pub struct End {
    /// Takes an `OVERLAPPED`: what the event loop needs, and what a program cannot cope with in a standard handle.
    pub overlapped: bool,
    pub inheritable: bool,
}

impl End {
    fn options(self) -> ULONG {
        if self.overlapped {
            0
        } else {
            FILE_SYNCHRONOUS_IO_NONALERT
        }
    }

    /// `name` relative to `root`.
    fn attributes(self, root: HANDLE, name: &mut UNICODE_STRING) -> OBJECT_ATTRIBUTES {
        OBJECT_ATTRIBUTES {
            Length: size_of::<OBJECT_ATTRIBUTES>() as ULONG,
            RootDirectory: root,
            ObjectName: from_mut(name),
            Attributes: OBJ_CASE_INSENSITIVE | if self.inheritable { OBJ_INHERIT } else { 0 },
            SecurityDescriptor: null_mut(),
            SecurityQualityOfService: null_mut(),
        }
    }
}

// Some hooks of `NtCreateFile` expect a NUL behind the name: null here, a NUL below.
const NO_NAME: UNICODE_STRING = UNICODE_STRING {
    Length: 0,
    MaximumLength: 0,
    Buffer: null_mut(),
};

fn open(
    access: ULONG,
    attributes: &mut OBJECT_ATTRIBUTES,
    options: ULONG,
) -> Result<HANDLE, NTSTATUS> {
    let mut handle: HANDLE = null_mut();
    let mut io: IO_STATUS_BLOCK = zeroed();
    // SAFETY: `attributes` and what it points to outlive the call, as do both out-params.
    let status = unsafe {
        ntdll::NtCreateFile(
            &raw mut handle,
            access,
            attributes,
            &raw mut io,
            null_mut(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_OPEN,
            options,
            null_mut(),
            0,
        )
    };
    if NT_SUCCESS(status) {
        Ok(handle)
    } else {
        Err(status)
    }
}

/// The root directory of the named pipe file system, opened once and kept.
fn file_system() -> Result<HANDLE, NTSTATUS> {
    static ROOT: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

    let root = ROOT.load(Ordering::Acquire);
    if !root.is_null() {
        return Ok(root);
    }
    // Without the trailing backslash this is the device, which makes no unnamed pipes.
    let path = w!("\\Device\\NamedPipe\\\0");
    let mut name = UNICODE_STRING {
        Length: (path.len() * 2 - 2) as u16,
        MaximumLength: (path.len() * 2) as u16,
        Buffer: path.as_ptr().cast_mut(),
    };
    let end = End {
        overlapped: false,
        inheritable: false,
    };
    let opened = open(
        GENERIC_READ | SYNCHRONIZE,
        &mut end.attributes(null_mut(), &mut name),
        end.options(),
    )?;
    match ROOT.compare_exchange(null_mut(), opened, Ordering::AcqRel, Ordering::Acquire) {
        Ok(_) => Ok(opened),
        Err(winner) => {
            // SAFETY: opened above, and nothing else has seen it.
            let _ = unsafe { CloseHandle(opened) };
            Ok(winner)
        }
    }
}

fn pair_nt(first: End, second: End) -> Result<[HANDLE; 2], NTSTATUS> {
    let root = file_system()?;

    let mut name = NO_NAME;
    let mut server: HANDLE = null_mut();
    let mut io: IO_STATUS_BLOCK = zeroed();
    // Only `WaitNamedPipe` looks at it, which takes a name. 50 ms, in units of 100 ns.
    let mut timeout: i64 = -500_000;
    // SAFETY: every pointer is to a local that outlives the call.
    let status = unsafe {
        NtCreateNamedPipeFile(
            &raw mut server,
            DUPLEX,
            &mut first.attributes(root, &mut name),
            &raw mut io,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_CREATE,
            first.options(),
            FILE_PIPE_BYTE_STREAM_TYPE,
            FILE_PIPE_BYTE_STREAM_MODE,
            FILE_PIPE_QUEUE_OPERATION,
            1,
            BUFFER_SIZE,
            BUFFER_SIZE,
            &raw mut timeout,
        )
    };
    if !NT_SUCCESS(status) {
        return Err(status);
    }

    match open(
        DUPLEX,
        &mut second.attributes(server, &mut name),
        second.options() | FILE_NON_DIRECTORY_FILE,
    ) {
        Ok(client) => Ok([server, client]),
        Err(status) => {
            // SAFETY: created above, and nothing else has seen it.
            let _ = unsafe { CloseHandle(server) };
            Err(status)
        }
    }
}

/// A connected pipe that carries bytes both ways.
pub fn pair(first: End, second: End) -> Maybe<[Fd; 2]> {
    pair_nt(first, second)
        .map(|handles| handles.map(Fd::from_system))
        .map_err(|status| Error::from_win32(Win32Error::from_ntstatus(status), Tag::pipe))
}

/// `[ours, theirs]`: ours is for the event loop, theirs for a program that reads and writes without an `OVERLAPPED`. Neither is inheritable.
pub fn pair_with_program() -> Maybe<[Fd; 2]> {
    let end = |overlapped| End {
        overlapped,
        inheritable: false,
    };
    pair(end(true), end(false))
}

const MAXIMUM_WAIT_OBJECTS: usize = 64;

/// One of the pipes of [`read_to_end`]. It stays where it is while a read is in flight.
struct Read {
    pipe: Fd,
    /// Set once the read in flight is through.
    event: HANDLE,
    overlapped: OVERLAPPED,
    is_in_flight: bool,
    bytes: Vec<u8>,
}

impl Read {
    fn new(pipe: Fd) -> Self {
        Self {
            pipe,
            event: null_mut(),
            overlapped: zeroed(),
            is_in_flight: false,
            bytes: Vec::new(),
        }
    }

    /// `Ok` if `code` is how a read says that the other end is closed.
    fn is_end(code: Win32Error) -> Maybe<()> {
        match code {
            Win32Error::BROKEN_PIPE | Win32Error::HANDLE_EOF => Ok(()),
            code => Err(Error::from_win32(code, Tag::read)),
        }
    }

    /// Leaves no read in flight if there is nothing more to come.
    fn start(&mut self) -> Maybe<()> {
        self.bytes.reserve(BUFFER_SIZE as usize);
        let spare = self.bytes.spare_capacity_mut();
        self.overlapped = OVERLAPPED {
            hEvent: self.event,
            ..zeroed()
        };
        // SAFETY: `spare` and `overlapped` are the kernel's until the read is through, which
        // `finish` or `drop` has seen before either is looked at, moved or freed.
        let is_through = unsafe {
            kernel32::ReadFile(
                self.pipe.native(),
                spare.as_mut_ptr().cast(),
                spare.len().min(DWORD::MAX as usize) as DWORD,
                null_mut(),
                from_mut(&mut self.overlapped).cast(),
            )
        } != FALSE;
        // The event is set in either case.
        if !is_through {
            match Win32Error::get() {
                Win32Error::IO_PENDING => {}
                code => return Self::is_end(code),
            }
        }
        self.is_in_flight = true;
        Ok(())
    }

    /// Takes what the read that set `event` has brought. `false`: there is nothing more to come.
    fn finish(&mut self) -> Maybe<bool> {
        self.is_in_flight = false;
        let mut len: DWORD = 0;
        // SAFETY: `overlapped` is the one that the read was started with.
        if unsafe {
            GetOverlappedResult(
                self.pipe.native(),
                &raw mut self.overlapped,
                &raw mut len,
                FALSE,
            )
        } == FALSE
        {
            return Self::is_end(Win32Error::get()).map(|()| false);
        }
        // SAFETY: the kernel has written that many bytes to the spare capacity.
        unsafe { bun_core::vec::commit_spare(&mut self.bytes, len as usize) };
        Ok(true)
    }
}

impl Drop for Read {
    fn drop(&mut self) {
        if self.is_in_flight {
            let mut len: DWORD = 0;
            // SAFETY: as in `finish`. This waits until the kernel is done with the buffer.
            unsafe {
                let _ = kernel32::CancelIoEx(self.pipe.native(), &raw mut self.overlapped);
                let _ = GetOverlappedResult(
                    self.pipe.native(),
                    &raw mut self.overlapped,
                    &raw mut len,
                    TRUE,
                );
            }
        }
        if !self.event.is_null() {
            // SAFETY: created in `read_to_end`, and nothing waits for it any more.
            let _ = unsafe { CloseHandle(self.event) };
        }
        self.pipe.close();
    }
}

/// Blocks: reads each of `pipes` ([`End::overlapped`]) until its other end is closed, then closes it.
pub fn read_to_end<const N: usize>(pipes: [Option<Fd>; N]) -> Maybe<[Vec<u8>; N]> {
    const { assert!(N <= MAXIMUM_WAIT_OBJECTS) };
    let failed = || Error::from_win32(Win32Error::get(), Tag::read);

    let mut reads = pipes.map(|pipe| pipe.map(Read::new));
    for read in reads.iter_mut().flatten() {
        // SAFETY: no attributes and no name.
        read.event = unsafe { kernel32::CreateEventW(null_mut(), TRUE, FALSE, null()) };
        if read.event.is_null() {
            return Err(failed());
        }
        read.start()?;
    }
    loop {
        let mut events: [HANDLE; N] = [null_mut(); N];
        let mut count = 0;
        for read in reads.iter().flatten().filter(|read| read.is_in_flight) {
            events[count] = read.event;
            count += 1;
        }
        if count == 0 {
            break;
        }
        // SAFETY: the first `count` of `events` are open handles.
        let index = unsafe {
            kernel32::WaitForMultipleObjects(count as DWORD, events.as_ptr(), FALSE, INFINITE)
        };
        let Some(&event) = events[..count].get(index as usize) else {
            return Err(failed());
        };
        for read in reads.iter_mut().flatten() {
            if read.event == event && read.finish()? {
                read.start()?;
            }
        }
    }
    Ok(reads.map(|read| read.map_or_else(Vec::new, |mut read| take(&mut read.bytes))))
}
