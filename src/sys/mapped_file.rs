use crate::{AsFd, E, Error, File, Maybe, O, Tag};

/// Read-only contents of a whole file.
///
/// Mapping keeps the bytes out of the heap: a page becomes resident only once
/// something reads it, and the pages belong to the page cache, shared with
/// every other process mapping the same file. Replacing the file on disk is
/// safe (the mapping keeps the old inode alive); truncating or rewriting it in
/// place is visible through the mapping.
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
    /// Maps `path` (resolved against `dir`), reading it into memory instead
    /// where it cannot be mapped: Windows (see [`MappedFile::map`]),
    /// filesystems without mmap support, and empty files (`mmap` rejects a
    /// zero-length mapping).
    pub fn open(dir: impl AsFd, path: &[u8]) -> Maybe<Self> {
        let file = File::openat(dir, path, O::RDONLY | O::CLOEXEC, 0)?;
        if let Ok(mapped) = Self::map_file(&file) {
            return Ok(mapped);
        }
        file.read_to_end().map(|bytes| Self(Repr::Heap(bytes)))
    }

    /// Like [`MappedFile::open`], but fails instead of copying when `path`
    /// cannot be mapped.
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

    /// `crate::mmap` is a stub on Windows. A Windows file mapping would also
    /// make rewriting the file fail (ERROR_USER_MAPPED_FILE) for as long as
    /// some process has it loaded, e.g. `bun build` over its previous output.
    #[cfg(not(unix))]
    fn map_file(_file: &File) -> Maybe<Self> {
        Err(Error::new(E::ENOTSUP, Tag::mmap))
    }

    pub fn as_slice(&self) -> &[u8] {
        match &self.0 {
            #[cfg(unix)]
            // SAFETY: `mmap` succeeded in `map_file`, so `ptr` is a non-null
            // mapping of `len` readable bytes, and only `Drop` unmaps it.
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
            // `munmap` only fails for a bogus `(ptr, len)`, and this pair is the
            // one `mmap` returned.
            let _ = crate::munmap(ptr, len);
        }
    }
}
