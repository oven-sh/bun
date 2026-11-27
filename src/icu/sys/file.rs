//! Files, by calls that do not end the process for want of memory: the errors of `bun_sys` copy the path. ICU4C: umapfile.cpp

use crate::common::memory::set_oom;
use bun_sys::{CloseOnDrop, E, File, Maybe};
use std::ffi::CStr;
use std::ops::Deref;

#[cfg(unix)]
pub(crate) use unix::*;
#[cfg(windows)]
pub(crate) use windows::*;

/// `Result::ok` that sets the OOM flag if the system is out of memory.
pub(crate) fn ok_or_oom<T>(result: Maybe<T>) -> Option<T> {
    if result
        .as_ref()
        .is_err_and(|error| error.get_errno() == E::ENOMEM)
    {
        set_oom(());
    }
    result.ok()
}

#[cfg(unix)]
mod unix {
    use super::{CStr, CloseOnDrop, E, File, ok_or_oom, set_oom};
    use crate::sys::host::cstr_to_vec;
    use bun_sys::{Dir, Fd, Mmap, last_error};
    use libc::{O_CLOEXEC, O_DIRECTORY, O_NOCTTY, O_NONBLOCK, O_RDONLY, c_int};

    const PATH_MAX: usize = libc::PATH_MAX as usize;

    fn note_oom() {
        if last_error() == E::ENOMEM {
            set_oom(());
        }
    }

    fn open_fd(path: &CStr, flags: c_int) -> Option<Fd> {
        loop {
            // SAFETY: `path` is NUL-terminated, and only `O_CREAT` and `O_TMPFILE` need a mode.
            let fd = unsafe { libc::open(path.as_ptr(), O_RDONLY | O_CLOEXEC | flags) };
            if fd >= 0 {
                return Some(Fd::from_native(fd));
            } else if last_error() != E::EINTR {
                note_oom();
                return None;
            }
        }
    }

    /// Does not wait for the writer of a pipe.
    pub(crate) fn open(path: &CStr) -> Option<CloseOnDrop> {
        open_fd(path, O_NOCTTY | O_NONBLOCK).map(CloseOnDrop::new)
    }

    pub(crate) fn open_directory(path: &CStr) -> Option<Dir> {
        open_fd(path, O_DIRECTORY).map(Dir::from_fd)
    }

    pub(crate) fn real_path(path: &CStr) -> Option<Vec<u8>> {
        let mut buffer = [0; PATH_MAX];
        // SAFETY: `path` is NUL-terminated and `buffer` has `PATH_MAX` bytes. The result is null or `buffer`, NUL-terminated.
        unsafe {
            let resolved = libc::realpath(path.as_ptr(), buffer.as_mut_ptr());
            if resolved.is_null() {
                note_oom();
            }
            cstr_to_vec(resolved)
        }
    }

    pub(crate) fn link_target(path: &CStr) -> Option<Vec<u8>> {
        let mut buffer = [0; PATH_MAX];
        // SAFETY: `path` is NUL-terminated. The call leaves the last byte of `buffer` 0.
        unsafe {
            let length = libc::readlink(path.as_ptr(), buffer.as_mut_ptr(), PATH_MAX - 1);
            if length < 0 {
                note_oom();
            }
            (length > 0).then(|| cstr_to_vec(buffer.as_ptr()))?
        }
    }

    pub(crate) struct Mapping(Mmap);

    impl Mapping {
        pub(crate) fn new(file: &File, length: usize) -> Option<Self> {
            let (access, flags) = (libc::PROT_READ, libc::MAP_SHARED);
            ok_or_oom(Mmap::new(length, access, flags, file.fd(), 0)).map(Self)
        }

        pub(super) fn start(&self) -> (*const u8, usize) {
            (self.0.as_ptr(), self.0.size())
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::{CStr, CloseOnDrop, File, set_oom};
    use crate::common::memory::{defer_oom, try_filled};
    use bun_core::WStr;
    use bun_core::strings::try_convert_utf8_to_utf16_in_buffer;
    use bun_sys::windows::*;
    use std::ffi::c_void;
    use std::os::windows::io::{AsHandle, BorrowedHandle, HandleOrNull, OwnedHandle};

    type Null = Option<&'static std::convert::Infallible>;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn CreateFileMappingW(
            file: HANDLE,
            security_attributes: Null,
            protect: u32,
            size_high: u32,
            size_low: u32,
            name: Null,
        ) -> HandleOrNull;
        safe fn MapViewOfFile(
            object: BorrowedHandle<'_>,
            access: u32,
            offset_high: u32,
            offset_low: u32,
            length: usize,
        ) -> *mut c_void;
        fn UnmapViewOfFile(start: *const c_void) -> i32;
    }

    fn note_oom(error: Win32Error) {
        if matches!(
            error,
            Win32Error::OUTOFMEMORY | Win32Error::NOT_ENOUGH_MEMORY
        ) {
            set_oom(());
        }
    }

    /// `File::openat` does not resolve `\tz`, `D:tz` and `\\?\UNC\server\share`.
    pub(crate) fn open(path: &CStr) -> Option<CloseOnDrop> {
        let path = path.to_bytes();
        let mut wide = defer_oom(try_filled(0, path.len() + 1))?;
        let length = try_convert_utf8_to_utf16_in_buffer(&mut wide, path)?.len();
        *wide.get_mut(length)? = 0;
        let file = CreateFileW(
            WStr::from_buf(&wide, length),
            GENERIC_READ,
            FILE_SHARE_READ,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
        );
        Some(File::from(file.map_err(note_oom).ok()?).into())
    }

    pub(crate) struct Mapping(*const u8, usize);

    impl Mapping {
        /// The view keeps the file open.
        pub(crate) fn new(file: &File, length: usize) -> Option<Self> {
            const PAGE_READONLY: u32 = 2;
            const FILE_MAP_READ: u32 = 4;
            let object = CreateFileMappingW(file.fd().native(), None, PAGE_READONLY, 0, 0, None);
            let object = OwnedHandle::try_from(object);
            let view = object.as_ref().map_or(std::ptr::null_mut(), |object| {
                MapViewOfFile(object.as_handle(), FILE_MAP_READ, 0, 0, length)
            });
            if view.is_null() {
                note_oom(Win32Error::get());
                return None;
            }
            Some(Self(view.cast(), length))
        }

        pub(super) fn start(&self) -> (*const u8, usize) {
            (self.0, self.1)
        }
    }

    impl Drop for Mapping {
        fn drop(&mut self) {
            // SAFETY: `new` has made the view, and what borrowed it is gone.
            unsafe { UnmapViewOfFile(self.0.cast()) };
        }
    }
}

// SAFETY: it owns the pages, which any thread can unmap.
unsafe impl Send for Mapping {}
// SAFETY: the pages are only read.
unsafe impl Sync for Mapping {}

impl Deref for Mapping {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        let (start, length) = self.start();
        // SAFETY: the pages stay mapped until `drop`. Whoever sets `ICU_DATA` leaves a package alone while it is in use.
        unsafe { std::slice::from_raw_parts(start, length) }
    }
}
