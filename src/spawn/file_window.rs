//! A window of a regular file that a `StaticPipeWriter` sends one chunk at a time.

use bun_core::ZStr;
use bun_sys::{self as sys, Fd, File, O};

pub struct FileWindow {
    file: File,
    /// Where the next chunk starts.
    offset: u64,
    /// Bytes of the window that no chunk has read. `None`: the window ends at EOF.
    remaining: Option<u64>,
    /// One buffer for every chunk. `chunk[..len]` holds the bytes of the chunk that is read.
    chunk: Box<[u8]>,
    len: usize,
    /// A positional read moves the file pointer, and a duplicate shares it with the caller's descriptor.
    #[cfg(windows)]
    restore_position: bool,
}

pub enum Opened {
    /// The first chunk is read.
    Window(Box<FileWindow>),
    /// The window holds no bytes.
    Empty,
    /// Only a regular file has a byte at an offset.
    NotRegular,
}

impl FileWindow {
    /// The most bytes of a window that the parent holds.
    const CHUNK_SIZE: u64 = 64 * 1024;

    /// `length` is `None` for a window that ends at EOF.
    pub fn open_path(path: &ZStr, offset: u64, length: Option<u64>) -> sys::Result<Opened> {
        // An open of a FIFO takes its writer out of `open(2)`, so the type is read first.
        let stat = sys::stat(path)?;
        if !sys::is_regular_file(stat.st_mode as _) {
            return Ok(Opened::NotRegular);
        }
        if Self::is_empty(offset, length, stat.st_size.max(0) as u64) {
            return Ok(Opened::Empty);
        }
        // The path can name a FIFO or a terminal by now. The open must not wait for a writer.
        let flags = O::RDONLY | O::CLOEXEC | O::NONBLOCK | O::NOCTTY;
        Self::with_first_chunk(File::open(path, flags, 0)?, offset, length, false)
    }

    /// `length` is `None` for a window that ends at EOF.
    pub fn open_fd(fd: Fd, offset: u64, length: Option<u64>) -> sys::Result<Opened> {
        let stat = sys::fstat(fd)?;
        if !sys::is_regular_file(stat.st_mode as _) {
            return Ok(Opened::NotRegular);
        }
        if Self::is_empty(offset, length, stat.st_size.max(0) as u64) {
            return Ok(Opened::Empty);
        }
        // The caller can close `fd` before the last chunk is read.
        let file = File::from_fd(sys::dup(fd)?);
        Self::with_first_chunk(file, offset, length, true)
    }

    /// A size of 0 is not a length: procfs reports it for a file that has bytes.
    fn is_empty(offset: u64, length: Option<u64>, size: u64) -> bool {
        length == Some(0) || (size != 0 && offset >= size)
    }

    fn with_first_chunk(
        file: File,
        offset: u64,
        length: Option<u64>,
        is_duplicate: bool,
    ) -> sys::Result<Opened> {
        #[cfg(not(windows))]
        let _ = is_duplicate;
        let capacity = length.unwrap_or(u64::MAX).min(Self::CHUNK_SIZE) as usize;
        let mut window = Box::new(FileWindow {
            file,
            offset,
            remaining: length,
            chunk: vec![0; capacity].into_boxed_slice(),
            len: 0,
            #[cfg(windows)]
            restore_position: is_duplicate,
        });
        Ok(match window.read_chunk()? {
            0 => Opened::Empty,
            _ => Opened::Window(window),
        })
    }

    /// Returns the length of the new chunk: 0 at the end of the window or of the file.
    fn read_chunk(&mut self) -> sys::Result<usize> {
        self.len = 0;
        let want = self
            .remaining
            .unwrap_or(u64::MAX)
            .min(self.chunk.len() as u64) as usize;
        if want == 0 {
            return Ok(0);
        }
        #[cfg(windows)]
        let position = if self.restore_position {
            Some(self.file.get_pos()?)
        } else {
            None
        };
        let read = self.file.pread_all(&mut self.chunk[..want], self.offset);
        #[cfg(windows)]
        if let Some(position) = position {
            self.file.seek_to(position)?;
        }
        let len = read?;
        self.len = len;
        self.offset += len as u64;
        if let Some(remaining) = &mut self.remaining {
            *remaining -= len as u64;
        }
        Ok(len)
    }

    pub(crate) fn slice(&self) -> &[u8] {
        &self.chunk[..self.len]
    }

    /// Replaces the chunk with the next one. `Ok(false)`: the window or the file has no more bytes.
    pub(crate) fn refill(&mut self) -> sys::Result<bool> {
        Ok(self.read_chunk()? != 0)
    }

    pub(crate) fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>() + self.chunk.len()
    }
}
