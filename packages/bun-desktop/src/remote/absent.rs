//! Nothing connects two processes on Windows yet.

use std::ffi::c_void;
use std::io;
use std::net::Shutdown;
use std::os::windows::io::{AsHandle, AsRawHandle as _, FromRawHandle as _};
pub use std::os::windows::io::{BorrowedHandle as BorrowedFd, OwnedHandle as OwnedFd};
use std::time::Duration;

use crate::win32::{
    CreateFileMappingW, FILE_MAP_WRITE, Handle, MapViewOfFile, PAGE_READWRITE, Str, UnmapViewOfFile,
};

pub struct UnixStream(OwnedFd);

pub const WITHOUT_WAITING: i32 = 0;

pub struct Part {
    pub iov_base: *mut c_void,
    pub iov_len: usize,
}

fn unsupported<T>() -> io::Result<T> {
    Err(io::ErrorKind::Unsupported.into())
}

impl UnixStream {
    pub fn pair() -> io::Result<(UnixStream, UnixStream)> {
        unsupported()
    }

    pub fn try_clone(&self) -> io::Result<UnixStream> {
        self.0.try_clone().map(UnixStream)
    }

    pub fn set_nonblocking(&self, _: bool) -> io::Result<()> {
        unsupported()
    }

    pub fn shutdown(&self, _: Shutdown) -> io::Result<()> {
        unsupported()
    }
}

pub trait AsFd {
    fn as_fd(&self) -> BorrowedFd<'_>;
}

impl<T: AsHandle> AsFd for T {
    fn as_fd(&self) -> BorrowedFd<'_> {
        self.as_handle()
    }
}

impl AsHandle for UnixStream {
    fn as_handle(&self) -> BorrowedFd<'_> {
        self.0.as_handle()
    }
}

impl From<OwnedFd> for UnixStream {
    fn from(it: OwnedFd) -> UnixStream {
        UnixStream(it)
    }
}

impl From<UnixStream> for OwnedFd {
    fn from(it: UnixStream) -> OwnedFd {
        it.0
    }
}

pub fn share(size: usize) -> Option<OwnedFd> {
    let memory = Some(CreateFileMappingW(
        -1,
        0,
        PAGE_READWRITE,
        0,
        size as u32,
        Str::NULL,
    ))
    .filter(|it| *it != 0)?;
    // SAFETY: it is new.
    Some(unsafe { OwnedFd::from_raw_handle(memory as *mut c_void) })
}

pub fn map(memory: &OwnedFd, size: usize) -> Option<*mut u8> {
    Some(MapViewOfFile(memory.as_raw_handle() as Handle, FILE_MAP_WRITE, 0, 0, size).cast::<u8>())
        .filter(|it| !it.is_null())
}

/// # Safety
/// Nothing refers to it any more.
pub unsafe fn unmap(start: *mut u8, _: usize) {
    // SAFETY: the caller's contract.
    unsafe { UnmapViewOfFile(start.cast()) };
}

/// # Safety
/// None.
pub unsafe fn adopt(_: i32) -> Option<OwnedFd> {
    None
}

/// # Safety
/// None.
pub unsafe fn borrow<'a>(_: i32) -> Option<BorrowedFd<'a>> {
    None
}

pub fn give_away(_: OwnedFd) -> i32 {
    -1
}

pub fn send_some(
    _: &UnixStream,
    _: &[Part],
    _: Option<BorrowedFd<'_>>,
    _: i32,
) -> io::Result<usize> {
    unsupported()
}

/// # Safety
/// None.
pub unsafe fn receive_into(
    _: &UnixStream,
    _: *mut u8,
    _: usize,
    _: i32,
) -> io::Result<(usize, Option<OwnedFd>)> {
    unsupported()
}

pub fn receive(_: &UnixStream, _: &mut [u8], _: i32) -> io::Result<Option<OwnedFd>> {
    unsupported()
}

pub fn wait_for(_: Option<isize>, _: &UnixStream, _: Option<Duration>) -> bool {
    true
}

pub mod sandbox {
    pub fn prepare() {}

    pub fn enter(_generates_code: bool) -> bool {
        false
    }
}

pub fn exit() -> ! {
    std::process::abort()
}

pub fn clock() -> u64 {
    0
}
