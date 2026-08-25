use crate::{AsFd, E, Error, File, Maybe, O, Tag};

/// Read-only contents of a whole file, mapped rather than read where possible.
/// Rewriting or truncating the file in place shows through the mapping;
/// replacing it (rename) does not.
pub struct MappedFile(Repr);

enum Repr {
    /// `PROT_READ` / `MAP_PRIVATE` mapping of the entire file.
    #[cfg(unix)]
    Mapped {
        ptr: *mut u8,
        len: usize,
    },
    Heap(Vec<u8>),
}

impl MappedFile {
    /// Maps `path` (relative to `dir`), falling back to a heap read where mmap
    /// is unavailable (Windows) or refused (empty files, some filesystems).
    pub fn open(dir: impl AsFd, path: &[u8]) -> Maybe<Self> {
        let file = File::openat(dir, path, O::RDONLY | O::CLOEXEC, 0)?;
        if let Ok(mapped) = Self::map_file(&file) {
            return Ok(mapped);
        }
        file.read_to_end().map(|bytes| Self(Repr::Heap(bytes)))
    }

    /// [`MappedFile::open`] without the heap fallback.
    pub fn map(dir: impl AsFd, path: &[u8]) -> Maybe<Self> {
        if cfg!(not(unix)) {
            return Err(Error::new(E::ENOTSUP, Tag::mmap));
        }
        let file = File::openat(dir, path, O::RDONLY | O::CLOEXEC, 0)?;
        Self::map_file(&file)
    }

    #[cfg(unix)]
    fn map_file(file: &File) -> Maybe<Self> {
        let len = file.get_end_pos()?;
        let ptr = crate::mmap(
            core::ptr::null_mut(),
            len,
            libc::PROT_READ,
            libc::MAP_PRIVATE,
            file.fd(),
            0,
        )?;
        Ok(Self(Repr::Mapped { ptr, len }))
    }

    /// A Windows file mapping would make `bun build` fail to overwrite its
    /// output (ERROR_USER_MAPPED_FILE) while a process is running it.
    #[cfg(not(unix))]
    fn map_file(_file: &File) -> Maybe<Self> {
        Err(Error::new(E::ENOTSUP, Tag::mmap))
    }

    pub fn as_slice(&self) -> &[u8] {
        match &self.0 {
            #[cfg(unix)]
            // SAFETY: `map_file` mapped `len` readable bytes at `ptr`; only
            // `Drop` unmaps them.
            Repr::Mapped { ptr, len } => unsafe { core::slice::from_raw_parts(*ptr, *len) },
            Repr::Heap(bytes) => bytes,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.as_slice().is_empty()
    }
}

impl Drop for MappedFile {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Repr::Mapped { ptr, len } = self.0 {
            let _ = crate::munmap(ptr, len);
        }
    }
}
