//! The incremental side of `Bun.Archive`: a live libarchive writer whose
//! output spills from memory to a temporary file once it grows past
//! `maxMemory`, plus the entry sources `Archive.append()` can stream from.

use core::ffi::{c_int, c_void};

use bun_core::ZBox;
use bun_libarchive::lib;
use bun_paths::PathBuffer;
use bun_resolver::fs::{FileSystem, RealFS};
use bun_sys;

use super::archive::{Compression, Format, Options};

/// libarchive `AE_IFREG` (== `S_IFREG`). The Rust `bun_libarchive::lib` port
/// does not yet expose `FileType`, so mirror the constant locally.
pub(crate) const FILETYPE_REGULAR: u32 = 0o100000;

/// Permission bits given to entries added through the object form or
/// `append()`.
const DEFAULT_ENTRY_PERM: u32 = 0o644;

/// Bytes read from disk at a time when streaming a file-backed entry.
const STREAM_CHUNK_SIZE: usize = 256 * 1024;

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub(crate) enum BuildError {
    /// A libarchive call failed; the payload is the stage that failed.
    Libarchive(&'static str),
    /// An I/O error while spilling output, or while reading a file entry.
    Sys(bun_sys::Error),
    OutOfMemory,
    /// A file shrank between `stat` and the end of the copy loop, so fewer
    /// bytes were written than the entry header declares.
    EntryChangedSize,
}

impl From<bun_sys::Error> for BuildError {
    fn from(err: bun_sys::Error) -> Self {
        BuildError::Sys(err)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Spill sink
// ──────────────────────────────────────────────────────────────────────────

/// The temporary file an oversized archive spills into.
///
/// On POSIX the file is unlinked the instant it is created, so a crash can
/// never leave it behind and nothing has to clean it up; the open descriptor
/// keeps the inode alive. Windows cannot unlink an open file, so the path is
/// kept and removed once the descriptor closes.
pub(crate) struct SpillFile {
    file: Option<bun_sys::File>,
    path: ZBox,
    len: u64,
}

impl SpillFile {
    fn create() -> Result<SpillFile, bun_sys::Error> {
        let mut name_buf = PathBuffer::uninit();
        let name = FileSystem::tmpname(
            b"bun-archive",
            name_buf.0.as_mut_slice(),
            bun_core::fast_random(),
        )
        .map_err(|_| bun_sys::Error::new(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open))?;
        let joined = bun_paths::resolve_path::join_abs_string_z::<bun_paths::platform::Auto>(
            RealFS::platform_temp_dir(),
            &[name.as_bytes()],
        );
        let path = ZBox::from_bytes(joined.as_bytes());
        let file = bun_sys::File::open(
            path.as_zstr(),
            bun_sys::O::CREAT | bun_sys::O::EXCL | bun_sys::O::RDWR | bun_sys::O::CLOEXEC,
            0o600,
        )?;

        #[cfg(unix)]
        {
            let _ = bun_sys::unlink(path.as_zstr());
            return Ok(SpillFile {
                file: Some(file),
                path: ZBox::from_bytes(b""),
                len: 0,
            });
        }
        #[cfg(not(unix))]
        Ok(SpillFile {
            file: Some(file),
            path,
            len: 0,
        })
    }

    fn write(&mut self, data: &[u8]) -> Result<(), bun_sys::Error> {
        let Some(file) = &self.file else {
            return Err(bun_sys::Error::new(bun_sys::E::EBADF, bun_sys::Tag::write));
        };
        file.write_all(data)?;
        self.len += data.len() as u64;
        Ok(())
    }

    #[cfg(unix)]
    #[inline]
    pub(crate) fn len(&self) -> u64 {
        self.len
    }

    /// Read the whole spill file back into memory. Only needed on platforms
    /// without a `bun_sys` file-mapping helper.
    #[cfg(not(unix))]
    pub(crate) fn read_to_vec(&self) -> Result<Vec<u8>, bun_sys::Error> {
        let Some(file) = &self.file else {
            return Err(bun_sys::Error::new(bun_sys::E::EBADF, bun_sys::Tag::read));
        };
        bun_sys::set_file_offset(file.fd(), 0)?;
        let len = usize::try_from(self.len).unwrap_or(usize::MAX);
        let mut out: Vec<u8> = Vec::new();
        out.try_reserve_exact(len)
            .map_err(|_| bun_sys::Error::new(bun_sys::E::ENOMEM, bun_sys::Tag::read))?;
        out.resize(len, 0);
        let mut read = 0usize;
        while read < len {
            let n = file.read_all(&mut out[read..])?;
            if n == 0 {
                break;
            }
            read += n;
        }
        out.truncate(read);
        Ok(out)
    }

    /// Map the spill file copy-on-write. The caller owns the mapping and must
    /// release it with `munmap` (`Blob.Store::init_mmap` wires that up).
    #[cfg(unix)]
    pub(crate) fn mmap(&self) -> Result<&'static mut [u8], bun_sys::Error> {
        let Some(file) = &self.file else {
            return Err(bun_sys::Error::new(bun_sys::E::EBADF, bun_sys::Tag::mmap));
        };
        let len = usize::try_from(self.len)
            .map_err(|_| bun_sys::Error::new(bun_sys::E::EINVAL, bun_sys::Tag::mmap))?;
        let ptr = bun_sys::mmap(
            core::ptr::null_mut(),
            len,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_PRIVATE,
            file.fd(),
            0,
        )?;
        // SAFETY: `mmap` returned a mapping of exactly `len` readable bytes.
        Ok(unsafe { core::slice::from_raw_parts_mut(ptr, len) })
    }

    /// Close the descriptor and remove the backing file. A no-op for the path
    /// on POSIX, where it was unlinked at creation.
    fn discard(&mut self) {
        drop(self.file.take());
        if !self.path.is_empty() {
            let _ = bun_sys::unlink(self.path.as_zstr());
            self.path = ZBox::from_bytes(b"");
        }
    }
}

impl Drop for SpillFile {
    fn drop(&mut self) {
        self.discard();
    }
}

/// What a finished [`Builder`] produced.
pub(crate) enum SinkOutput {
    Memory(Vec<u8>),
    Spilled(SpillFile),
}

/// libarchive's write sink: buffers in memory until the archive would exceed
/// `max_memory` bytes, then streams everything to a [`SpillFile`].
pub(crate) struct SpillSink {
    max_memory: u64,
    buf: Vec<u8>,
    spill: Option<SpillFile>,
    /// Set by the write callback, which can only report failure as `-1`.
    error: Option<BuildError>,
}

impl SpillSink {
    fn new(max_memory: u64) -> SpillSink {
        SpillSink {
            max_memory,
            buf: Vec::new(),
            spill: None,
            error: None,
        }
    }

    fn push(&mut self, data: &[u8]) -> Result<(), BuildError> {
        if let Some(spill) = &mut self.spill {
            spill.write(data)?;
            return Ok(());
        }
        if self.buf.len() as u64 + data.len() as u64 > self.max_memory {
            let mut spill = SpillFile::create()?;
            spill.write(&self.buf)?;
            // Release the buffer's capacity, not just its length.
            self.buf = Vec::new();
            spill.write(data)?;
            self.spill = Some(spill);
            return Ok(());
        }
        self.buf
            .try_reserve(data.len())
            .map_err(|_| BuildError::OutOfMemory)?;
        self.buf.extend_from_slice(data);
        Ok(())
    }

    fn take_output(&mut self) -> SinkOutput {
        match self.spill.take() {
            Some(file) => SinkOutput::Spilled(file),
            None => SinkOutput::Memory(core::mem::take(&mut self.buf)),
        }
    }

    unsafe extern "C" fn open_callback(_a: *mut lib::Archive, _client_data: *mut c_void) -> c_int {
        0
    }

    unsafe extern "C" fn write_callback(
        _a: *mut lib::Archive,
        client_data: *mut c_void,
        buff: *const c_void,
        length: usize,
    ) -> lib::la_ssize_t {
        // SAFETY: `client_data` is the `*mut SpillSink` registered with
        // `archive_write_open2`; libarchive never calls back concurrently.
        let this = unsafe { bun_core::callback_ctx::<SpillSink>(client_data) };
        if buff.is_null() || length == 0 {
            return 0;
        }
        // SAFETY: libarchive guarantees `buff[0..length]` is readable here.
        let data = unsafe { core::slice::from_raw_parts(buff.cast::<u8>(), length) };
        match this.push(data) {
            Ok(()) => lib::la_ssize_t::try_from(length).expect("int cast"),
            Err(err) => {
                this.error = Some(err);
                -1
            }
        }
    }

    unsafe extern "C" fn close_callback(_a: *mut lib::Archive, _client_data: *mut c_void) -> c_int {
        0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Builder
// ──────────────────────────────────────────────────────────────────────────

/// A live libarchive writer plus the sink it writes into.
///
/// Exactly one thread owns a `Builder` at a time: the owning `Archive` hands
/// it to a work-pool task for the duration of an `append()` and takes it back
/// when the task finishes on the JS thread.
pub(crate) struct Builder {
    /// `Option` only so `Drop` can free the archive (which flushes through the
    /// write callback) before the sink it writes into is destroyed.
    archive: Option<lib::WriteArchive>,
    /// Heap-owned `SpillSink`; this pointer is what libarchive hands back to
    /// the write callback. Destroyed by `Drop`, after `archive`.
    sink: *mut SpillSink,
    entry: lib::OwnedEntry,
    entries: u32,
    closed: bool,
}

// SAFETY: the libarchive handles and the sink are uniquely owned by the
// `Builder`. It is moved between the JS thread and one work-pool thread, never
// shared: the owning `Archive` relinquishes it for the duration of a task.
unsafe impl Send for Builder {}

impl Drop for Builder {
    fn drop(&mut self) {
        if let Some(archive) = &self.archive {
            if !self.closed {
                // This writer is being abandoned, so its output is thrown away.
                // Without poisoning it, `archive_write_free` runs a normal close,
                // and closing while an entry is half-written makes tar pad that
                // entry out to its declared size: a failed `append()` of a 600 MB
                // file would write 600 MB of NULs into the sink (spilling them to
                // a temp file) before the promise settles.
                archive.write_fail();
            }
        }
        // `archive_write_free` can still flush buffered bytes through the write
        // callback, which writes into `*sink`: free the archive first.
        drop(self.archive.take());
        // SAFETY: `sink` is the `heap::into_raw` allocation made in `open`,
        // destroyed exactly once here.
        unsafe { bun_core::heap::destroy(self.sink) };
    }
}

impl Builder {
    pub(crate) fn open(options: Options) -> Result<Builder, BuildError> {
        let sink = bun_core::heap::into_raw(Box::new(SpillSink::new(options.max_memory)));
        // From here on `sink` is owned by the `Builder` we return, or freed on
        // the error paths below.
        let guard = scopeguard::guard((), |()| {
            // SAFETY: `sink` is still the sole owner of the allocation; this
            // only runs when we return `Err` before constructing the `Builder`.
            unsafe { bun_core::heap::destroy(sink) };
        });

        let archive = lib::WriteArchive::new();
        configure_writer(&archive, options)?;

        let rc = lib::archive_write_open2(
            &archive,
            sink.cast(),
            Some(SpillSink::open_callback),
            Some(SpillSink::write_callback),
            Some(SpillSink::close_callback),
            None,
        );
        if rc != 0 {
            return Err(BuildError::Libarchive("ArchiveOpenError"));
        }

        scopeguard::ScopeGuard::into_inner(guard);
        Ok(Builder {
            archive: Some(archive),
            sink,
            entry: lib::OwnedEntry::new(),
            entries: 0,
            closed: false,
        })
    }

    #[inline]
    fn archive(&self) -> &lib::Archive {
        // Only `Drop` takes the handle out.
        self.archive.as_ref().expect("builder archive taken")
    }

    #[inline]
    fn sink_mut(&mut self) -> &mut SpillSink {
        // SAFETY: see `sink`; `&mut self` proves no other borrow is live.
        unsafe { &mut *self.sink }
    }

    #[inline]
    pub(crate) fn entries(&self) -> u32 {
        self.entries
    }

    /// Prefer the sink's own error (a spill `write()` failure) over the generic
    /// libarchive stage error, since the sink is the real cause.
    fn fail(&mut self, stage: &'static str) -> BuildError {
        self.sink_mut()
            .error
            .take()
            .unwrap_or(BuildError::Libarchive(stage))
    }

    fn write_header(&mut self, path: &ZBox, size: u64, mtime: i64) -> Result<(), BuildError> {
        let size = i64::try_from(size).map_err(|_| BuildError::EntryChangedSize)?;
        let entry = &self.entry;
        let _ = entry.clear();
        // Same platform split as `pack_command::add_archive_entry`: the process
        // locale is always "C", so libarchive's locale-keyed writers are only
        // lossless with raw bytes on POSIX and with the UTF-8 form on Windows.
        #[cfg(windows)]
        entry.set_pathname_utf8(path.as_zstr());
        #[cfg(not(windows))]
        entry.set_pathname(path.as_zstr());
        entry.set_size(size);
        entry.set_filetype(FILETYPE_REGULAR);
        entry.set_perm(DEFAULT_ENTRY_PERM);
        entry.set_mtime(isize::try_from(mtime).unwrap_or(0), 0);

        // `Warn` still wrote a header (libarchive fell back to a per-entry
        // binary hdrcharset); only `Failed`/`Fatal` mean no header was produced.
        if !self.archive().write_header(entry).succeeded() {
            return Err(self.fail("ArchiveHeaderError"));
        }
        Ok(())
    }

    fn write_data(&mut self, data: &[u8]) -> Result<(), BuildError> {
        if data.is_empty() {
            return Ok(());
        }
        if self.archive().write_data(data) < 0 {
            return Err(self.fail("ArchiveWriteError"));
        }
        Ok(())
    }

    fn finish_entry(&mut self) -> Result<(), BuildError> {
        if self.archive().write_finish_entry() != lib::Result::Ok {
            return Err(self.fail("ArchiveFinishEntryError"));
        }
        self.entries += 1;
        Ok(())
    }

    /// Write one complete entry whose bytes are already in memory.
    pub(crate) fn add_bytes(
        &mut self,
        path: &ZBox,
        data: &[u8],
        mtime: i64,
    ) -> Result<(), BuildError> {
        self.write_header(path, data.len() as u64, mtime)?;
        self.write_data(data)?;
        self.finish_entry()
    }

    /// Write one entry by streaming `len` bytes out of `source`, starting at
    /// `offset`, never holding more than [`STREAM_CHUNK_SIZE`] of it at once.
    pub(crate) fn add_file(
        &mut self,
        path: &ZBox,
        source: &ZBox,
        offset: u64,
        max_len: Option<u64>,
        mtime: i64,
    ) -> Result<(), BuildError> {
        let file = bun_sys::File::open(
            source.as_zstr(),
            bun_sys::O::RDONLY | bun_sys::O::CLOEXEC,
            0,
        )?;
        let file_size = u64::try_from(bun_sys::fstat(file.fd())?.st_size).unwrap_or(0);
        let start = offset.min(file_size);
        let available = file_size - start;
        let len = max_len.map_or(available, |l| l.min(available));

        if start > 0 {
            bun_sys::set_file_offset(file.fd(), start)?;
        }

        self.write_header(path, len, mtime)?;

        let mut buf = vec![0u8; STREAM_CHUNK_SIZE.min(usize::try_from(len).unwrap_or(usize::MAX))];
        let mut remaining = len;
        while remaining > 0 {
            let want = usize::try_from(remaining)
                .unwrap_or(usize::MAX)
                .min(buf.len());
            let read = file.read_all(&mut buf[..want])?;
            if read == 0 {
                return Err(BuildError::EntryChangedSize);
            }
            self.write_data(&buf[..read])?;
            remaining -= read as u64;
        }

        self.finish_entry()
    }

    /// Close the writer and take its output. Consumes the builder.
    pub(crate) fn close(mut self) -> Result<SinkOutput, BuildError> {
        if !self.closed {
            self.closed = true;
            if self.archive().write_close() != lib::Result::Ok {
                return Err(self.fail("ArchiveCloseError"));
            }
        }
        Ok(self.sink_mut().take_output())
    }
}

/// Apply `options` to a fresh `archive_write_new()` handle.
fn configure_writer(archive: &lib::Archive, options: Options) -> Result<(), BuildError> {
    match options.format {
        Format::Tar => {
            if archive.write_set_format_pax_restricted() != lib::Result::Ok {
                return Err(BuildError::Libarchive("ArchiveFormatError"));
            }
        }
        Format::Zip => {
            if archive.write_set_format_zip() != lib::Result::Ok {
                return Err(BuildError::Libarchive("ArchiveFormatError"));
            }
            // Without this libarchive zero-pads the output up to its 10240-byte
            // default block, so a 200-byte zip would be written as 10 KB.
            if archive.write_set_bytes_in_last_block(1) != lib::Result::Ok {
                return Err(BuildError::Libarchive("ArchiveFormatError"));
            }
            match options.compress {
                Compression::Store => {
                    if archive.write_zip_set_compression_store() != lib::Result::Ok {
                        return Err(BuildError::Libarchive("ArchiveFormatError"));
                    }
                }
                Compression::Deflate(level) => {
                    if archive.write_zip_set_compression_deflate() != lib::Result::Ok {
                        return Err(BuildError::Libarchive("ArchiveFormatError"));
                    }
                    let option = ZBox::from_bytes(format!("zip:compression-level={level}"));
                    if !archive.write_set_options(option.as_zstr()).succeeded() {
                        return Err(BuildError::Libarchive("ArchiveFormatError"));
                    }
                }
                Compression::None | Compression::Gzip(_) => {}
            }
        }
    }
    Ok(())
}
