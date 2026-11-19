//! The buffers of vectored I/O. They borrow their bytes for the system and give Rust no view of them, so they may overlap.

use core::marker::PhantomData;

#[cfg(unix)]
type Raw = libc::iovec;
#[cfg(windows)]
type Raw = bun_libuv_sys::uv_buf_t;

#[inline]
fn raw(base: *mut u8, len: usize) -> Raw {
    #[cfg(unix)]
    return Raw {
        iov_base: base.cast(),
        iov_len: len,
    };
    #[cfg(windows)]
    return Raw {
        len: len as bun_libuv_sys::ULONG,
        base,
    };
}

#[inline]
fn raw_len(raw: &Raw) -> usize {
    #[cfg(unix)]
    return raw.iov_len;
    #[cfg(windows)]
    return raw.len as usize;
}

/// Bytes that the system reads.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct IoVec<'a>(Raw, PhantomData<&'a [u8]>);

impl<'a> IoVec<'a> {
    #[inline]
    pub fn new(bytes: &'a [u8]) -> Self {
        Self(raw(bytes.as_ptr().cast_mut(), bytes.len()), PhantomData)
    }

    #[inline]
    pub fn size(&self) -> usize {
        raw_len(&self.0)
    }

    /// An array of `iovec`, or of `uv_buf_t` on Windows.
    #[inline]
    pub fn as_raw(vecs: &[Self]) -> *const Raw {
        vecs.as_ptr().cast()
    }
}

/// Bytes that the system writes.
#[repr(transparent)]
pub struct IoVecMut<'a>(Raw, PhantomData<&'a mut [u8]>);

impl<'a> IoVecMut<'a> {
    #[cfg(windows)]
    #[inline]
    pub(crate) fn new(bytes: &'a mut [core::mem::MaybeUninit<u8>]) -> Self {
        Self(raw(bytes.as_mut_ptr().cast(), bytes.len()), PhantomData)
    }

    /// SAFETY: during `'a`, the `len` bytes at `base` may be written, and no reference to them is used.
    #[inline]
    pub unsafe fn from_raw(base: *mut u8, len: usize) -> Self {
        Self(raw(base, len), PhantomData)
    }

    /// SAFETY: the bytes are initialized.
    #[inline]
    pub unsafe fn assume_init(vecs: &[Self]) -> &[IoVec<'_>] {
        // SAFETY: both types are `repr(transparent)` over `Raw`.
        unsafe { core::slice::from_raw_parts(vecs.as_ptr().cast(), vecs.len()) }
    }

    #[inline]
    pub fn size(&self) -> usize {
        raw_len(&self.0)
    }

    /// As [`IoVec::as_raw`].
    #[inline]
    pub fn as_raw(vecs: &[Self]) -> *const Raw {
        vecs.as_ptr().cast()
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::{File, MemfdFlags};

    #[test]
    fn gathers_and_scatters() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let file =
            File::from_fd(crate::memfd_create(c"iovec".into(), MemfdFlags::NonExecutable).unwrap());
        let fd = file.fd();
        let parts = [IoVec::new(b"ab"), IoVec::new(b""), IoVec::new(b"cde")];
        assert_eq!(crate::writev(fd, &parts).unwrap(), 5);
        assert_eq!(crate::pwritev(fd, &parts[2..], 5).unwrap(), 3);

        let mut bytes = [0u8; 5];
        let start = bytes.as_mut_ptr();
        // SAFETY: both lie in `bytes`, which is not used again.
        let overlapping = unsafe {
            [
                IoVecMut::from_raw(start, 2),
                IoVecMut::from_raw(start.add(1), 4),
            ]
        };
        assert_eq!(crate::preadv(fd, &overlapping, 1).unwrap(), 6);
        assert_eq!(crate::readv(fd, &overlapping[..1]).unwrap(), 2);
        // SAFETY: initialized above.
        let filled = unsafe { IoVecMut::assume_init(&overlapping) };
        assert_eq!(filled.iter().map(IoVec::size).sum::<usize>(), 6);
        assert_eq!(crate::pwritev(fd, filled, 8).unwrap(), 6);

        let mut written = [0; 15];
        let len = crate::pread(fd, &mut written, 0).unwrap();
        assert_eq!(&written[..len], b"abcdecdecddecd");
    }
}
