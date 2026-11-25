use core::ffi::c_void;
use core::ptr::NonNull;

use crate::{E, Error, Fd, Maybe, Tag};

/// A mapping at an address of the system's choice. Unmapped on drop.
pub struct Mmap {
    /// In the first page of the mapping, where `offset` is in its page of the file.
    ptr: NonNull<u8>,
    len: usize,
}

impl Mmap {
    /// `offset` need not be a multiple of the page size. Panics if `flags` has `MAP_FIXED`.
    #[cfg(unix)]
    pub fn new(len: usize, prot: i32, flags: i32, fd: Fd, offset: i64) -> Maybe<Mmap> {
        assert!(flags & libc::MAP_FIXED == 0);
        if len == 0 {
            return Err(Error::from_code(E::EINVAL, Tag::mmap));
        }
        let no_memory = || Error::from_code(E::ENOMEM, Tag::mmap);
        let skipped = offset.rem_euclid(crate::page_size() as i64);
        let (offset, skipped) = (offset - skipped, skipped as usize);
        let mapped = len.checked_add(skipped).ok_or_else(no_memory)?;
        // SAFETY: not `MAP_FIXED`.
        let page = unsafe { crate::mmap(core::ptr::null_mut(), mapped, prot, flags, fd, offset) }?;
        let ptr = NonNull::new(page.wrapping_add(skipped)).ok_or_else(no_memory)?;
        Ok(Mmap { ptr, len })
    }

    #[cfg(windows)]
    pub fn new(_len: usize, _prot: i32, _flags: i32, _fd: Fd, _offset: i64) -> Maybe<Mmap> {
        Err(Error::from_code(E::ENOTSUP, Tag::mmap))
    }

    /// The pages stay mapped. [`Self::from_raw`] and [`Self::unmap_raw`] take them back.
    pub fn into_raw(self) -> NonNull<[u8]> {
        let this = core::mem::ManuallyDrop::new(self);
        NonNull::slice_from_raw_parts(this.ptr, this.len)
    }

    /// SAFETY: the pages that hold `bytes` are from `mmap`, and they become this value's.
    pub unsafe fn from_raw(bytes: NonNull<[u8]>) -> Mmap {
        Mmap {
            ptr: bytes.cast(),
            len: bytes.len(),
        }
    }

    /// A deallocator for C, whose context is the length.
    ///
    /// SAFETY: as [`Self::from_raw`] for the `len` bytes at `ptr`, and nothing refers to them any more.
    pub unsafe extern "C" fn unmap_raw(ptr: *mut c_void, len: *mut c_void) {
        if let Some(ptr) = NonNull::new(ptr.cast()) {
            // SAFETY: the caller's contract.
            drop(unsafe { Mmap::from_raw(NonNull::slice_from_raw_parts(ptr, len.addr())) });
        }
    }

    pub fn as_ptr(&self) -> *mut u8 {
        self.ptr.as_ptr()
    }

    pub fn size(&self) -> usize {
        self.len
    }

    /// SAFETY: the mapping is readable, its file covers it, and nothing else changes the file meanwhile.
    pub unsafe fn as_slice(&self) -> &[u8] {
        // SAFETY: the caller's contract. The pages stay mapped until `drop`.
        unsafe { core::slice::from_raw_parts(self.as_ptr(), self.len) }
    }

    /// SAFETY: as [`Self::as_slice`], and the mapping is writable.
    pub unsafe fn as_mut_slice(&mut self) -> &mut [u8] {
        // SAFETY: the caller's contract. The pages stay mapped until `drop`.
        unsafe { core::slice::from_raw_parts_mut(self.as_ptr(), self.len) }
    }
}

impl Drop for Mmap {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            let skipped = self.as_ptr().addr() % crate::page_size();
            let page = self.as_ptr().wrapping_sub(skipped);
            // SAFETY: the pages are this value's, and what borrowed it is gone.
            let _ = unsafe { crate::munmap(page, self.len + skipped) };
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::File;

    fn file_of(bytes: &[u8]) -> File {
        // SAFETY: the name ends in a NUL.
        let fd = unsafe { libc::memfd_create(c"mmap".as_ptr(), libc::MFD_ALLOW_SEALING) };
        let file = File::from_fd(Fd::from_native(fd));
        file.write_all(bytes).unwrap();
        file
    }

    /// While a page maps a file for writing, the file refuses this seal.
    fn is_mapped(file: &File) -> bool {
        // SAFETY: F_ADD_SEALS takes an integer.
        unsafe { crate::fcntl_unchecked(file.fd(), libc::F_ADD_SEALS, libc::F_SEAL_WRITE as isize) }
            .inspect_err(|err| assert_eq!(err.get_errno(), E::EBUSY))
            .is_err()
    }

    const ACCESS: i32 = libc::PROT_READ | libc::PROT_WRITE;

    #[test]
    fn maps_and_unmaps_from_any_offset() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let page = crate::page_size();
        let bytes: Vec<u8> = (0..page * 3).map(|i| (i % 251) as u8).collect();
        for (offset, len) in [
            (0, 1),
            (1, page),
            (page - 1, 2),
            (page, page),
            (page + 7, page * 2 - 7),
        ] {
            let file = file_of(&bytes);
            let map = Mmap::new(len, ACCESS, libc::MAP_SHARED, file.fd(), offset as i64).unwrap();
            // SAFETY: nothing else has the file.
            assert_eq!(unsafe { map.as_slice() }, &bytes[offset..offset + len]);
            assert!(is_mapped(&file));
            drop(map);
            assert!(!is_mapped(&file));
        }
    }

    #[test]
    fn raw_pages_stay_mapped_until_they_are_taken_back() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let page = crate::page_size();
        let file = file_of(&vec![1; page * 2]);
        let map = Mmap::new(page, ACCESS, libc::MAP_SHARED, file.fd(), 5).unwrap();
        let raw = map.into_raw();
        assert!(is_mapped(&file));
        let len = core::ptr::without_provenance_mut(raw.len());
        // SAFETY: from `into_raw`.
        unsafe { Mmap::unmap_raw(raw.as_ptr().cast(), len) };
        assert!(!is_mapped(&file));
    }

    #[test]
    fn refuses_nothing_to_map() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let file = file_of(b"bytes");
        let errno = |len, offset| {
            let map = Mmap::new(len, ACCESS, libc::MAP_SHARED, file.fd(), offset);
            map.err().map(|err| err.get_errno())
        };
        assert_eq!(errno(0, 3), Some(E::EINVAL));
        assert_eq!(errno(usize::MAX, 3), Some(E::ENOMEM));
    }

    #[test]
    #[should_panic]
    fn refuses_a_fixed_address() {
        let flags = libc::MAP_PRIVATE | libc::MAP_ANON | libc::MAP_FIXED;
        let _ = Mmap::new(1, libc::PROT_NONE, flags, Fd::from_native(-1), 0);
    }
}
