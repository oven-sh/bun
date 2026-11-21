//! The buffers of vectored I/O. They borrow their bytes for the system and give Rust no view of them, so they may overlap.

use core::marker::PhantomData;

#[cfg(unix)]
type Raw = libc::iovec;
#[cfg(windows)]
#[derive(Clone, Copy)]
struct Raw {
    iov_base: *mut core::ffi::c_void,
    iov_len: usize,
}

#[inline]
fn raw(base: *mut u8, len: usize) -> Raw {
    Raw {
        iov_base: base.cast(),
        iov_len: len,
    }
}

/// `raw` in pieces that one request can take. An empty buffer is one piece.
#[cfg(windows)]
fn parts(raw: Raw) -> impl Iterator<Item = (*mut u8, usize)> {
    use crate::MAX_COUNT;
    (0..raw.iov_len.max(1))
        .step_by(MAX_COUNT)
        .map(move |start| {
            let base = raw.iov_base.cast::<u8>().wrapping_add(start);
            (base, MAX_COUNT.min(raw.iov_len - start))
        })
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
        self.0.iov_len
    }

    #[cfg(unix)]
    #[inline]
    pub(crate) fn as_raw(vecs: &[Self]) -> *const Raw {
        vecs.as_ptr().cast()
    }

    #[cfg(windows)]
    pub(crate) fn parts(vecs: &[Self]) -> impl Iterator<Item = (*mut u8, usize)> {
        vecs.iter().flat_map(|vec| parts(vec.0))
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
        self.0.iov_len
    }

    #[cfg(unix)]
    #[inline]
    pub(crate) fn as_raw(vecs: &[Self]) -> *const Raw {
        vecs.as_ptr().cast()
    }

    #[cfg(windows)]
    pub(crate) fn parts(vecs: &[Self]) -> impl Iterator<Item = (*mut u8, usize)> {
        vecs.iter().flat_map(|vec| parts(vec.0))
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
