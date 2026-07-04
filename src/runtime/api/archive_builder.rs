//! The incremental side of `Bun.Archive`: a live libarchive writer whose output
//! accumulates in a [`Sink`], plus the entry sources `Archive.append()` can
//! stream from.

use core::ffi::{c_int, c_void};

use bun_core::ZBox;
use bun_libarchive::lib;
use bun_sys;

use super::archive::{Compression, Format, Options};

/// libarchive `AE_IFREG` (== `S_IFREG`). The Rust `bun_libarchive::lib` port
/// does not yet expose `FileType`, so mirror the constant locally.
pub(crate) const FILETYPE_REGULAR: u32 = 0o100000;

/// Permission bits given to entries added through the object form or
/// `append()`.
const DEFAULT_ENTRY_PERM: u32 = 0o644;

/// Bytes of an entry written per step. Also how much of a file-backed entry is
/// read from disk at a time.
pub(crate) const STREAM_CHUNK_SIZE: usize = 256 * 1024;

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub(crate) enum BuildError {
    /// A libarchive call failed; the payload is the stage that failed.
    Libarchive(&'static str),
    /// An I/O error while reading a file entry.
    Sys(bun_sys::Error),
    OutOfMemory,
    /// A file shrank between `stat` and the end of the copy loop, so fewer
    /// bytes were written than the entry header declares.
    EntryChangedSize,
    /// The `stream()` consumer cancelled, so there is nowhere left to write.
    StreamCancelled,
}

impl From<bun_sys::Error> for BuildError {
    fn from(err: bun_sys::Error) -> Self {
        BuildError::Sys(err)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Sink
// ──────────────────────────────────────────────────────────────────────────

/// Where libarchive's output goes. Bytes accumulate here until the owning
/// `Archive` takes them, either all at once when the archive is read, or a
/// chunk at a time when it is being streamed.
pub(crate) struct Sink {
    buf: Vec<u8>,
    /// Set by the write callback, which can only report failure as `-1`.
    error: Option<BuildError>,
}

impl Sink {
    fn new() -> Sink {
        Sink {
            buf: Vec::new(),
            error: None,
        }
    }

    fn push(&mut self, data: &[u8]) -> Result<(), BuildError> {
        self.buf
            .try_reserve(data.len())
            .map_err(|_| BuildError::OutOfMemory)?;
        self.buf.extend_from_slice(data);
        Ok(())
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
        // SAFETY: `client_data` is the `*mut Sink` registered with
        // `archive_write_open2`; libarchive never calls back concurrently.
        let this = unsafe { bun_core::callback_ctx::<Sink>(client_data) };
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
    /// Heap-owned `Sink`; this pointer is what libarchive hands back to the
    /// write callback. Destroyed by `Drop`, after `archive`.
    sink: *mut Sink,
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
                // file would write 600 MB of NULs into the sink before the
                // promise settles.
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
        let sink = bun_core::heap::into_raw(Box::new(Sink::new()));
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
            Some(Sink::open_callback),
            Some(Sink::write_callback),
            Some(Sink::close_callback),
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
    fn sink_mut(&mut self) -> &mut Sink {
        // SAFETY: see `sink`; `&mut self` proves no other borrow is live.
        unsafe { &mut *self.sink }
    }

    #[inline]
    pub(crate) fn entries(&self) -> u32 {
        self.entries
    }

    /// Prefer the sink's own error (an allocation failure) over the generic
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

    /// `archive_write_data` clamps its length to `INT_MAX` and returns the count
    /// it actually took, so a single call cannot be assumed to consume the whole
    /// slice: an entry over 2 GiB would otherwise be silently NUL-padded out to
    /// the size its header declared.
    fn write_data(&mut self, mut data: &[u8]) -> Result<(), BuildError> {
        while !data.is_empty() {
            let written = self.archive().write_data(data);
            if written <= 0 {
                return Err(self.fail("ArchiveWriteError"));
            }
            let written = usize::try_from(written).expect("int cast").min(data.len());
            data = &data[written..];
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

    /// Take the output produced so far, leaving the sink empty.
    #[inline]
    pub(crate) fn take_output(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.sink_mut().buf)
    }

    // ── Resumable entry ────────────────────────────────────────────────────
    //
    // `begin_entry` / `write_body` / `end_entry` let an entry be written a chunk
    // at a time, so the work can be handed back to the JS thread in between. The
    // all-at-once helpers below are those three calls in a loop.

    /// Write an entry's header, declaring a body of `size` bytes.
    #[inline]
    pub(crate) fn begin_entry(
        &mut self,
        path: &ZBox,
        size: u64,
        mtime: i64,
    ) -> Result<(), BuildError> {
        self.write_header(path, size, mtime)
    }

    /// Write the next slice of the current entry's body.
    #[inline]
    pub(crate) fn write_body(&mut self, data: &[u8]) -> Result<(), BuildError> {
        self.write_data(data)
    }

    /// Close the current entry, whose body must be fully written.
    #[inline]
    pub(crate) fn end_entry(&mut self) -> Result<(), BuildError> {
        self.finish_entry()
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
        let (file, len) = open_entry_file(source, offset, max_len)?;
        self.begin_entry(path, len, mtime)?;

        let mut buf = vec![0u8; STREAM_CHUNK_SIZE.min(usize::try_from(len).unwrap_or(usize::MAX))];
        let mut remaining = len;
        while remaining > 0 {
            let read = read_entry_chunk(&file, &mut buf, remaining)?;
            self.write_body(&buf[..read])?;
            remaining -= read as u64;
        }

        self.end_entry()
    }

    /// Close the writer and take its output. Consumes the builder.
    pub(crate) fn close(mut self) -> Result<Vec<u8>, BuildError> {
        if !self.closed {
            if self.archive().write_close() != lib::Result::Ok {
                return Err(self.fail("ArchiveCloseError"));
            }
            self.closed = true;
        }
        Ok(core::mem::take(&mut self.sink_mut().buf))
    }
}

/// Open a file-backed entry's source and work out how many of its bytes the
/// entry covers, seeking to `offset`.
pub(crate) fn open_entry_file(
    source: &ZBox,
    offset: u64,
    max_len: Option<u64>,
) -> Result<(bun_sys::File, u64), BuildError> {
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
    Ok((file, len))
}

/// Read the next slice of a file-backed entry, at most `remaining` bytes.
pub(crate) fn read_entry_chunk(
    file: &bun_sys::File,
    buf: &mut [u8],
    remaining: u64,
) -> Result<usize, BuildError> {
    let want = usize::try_from(remaining)
        .unwrap_or(usize::MAX)
        .min(buf.len());
    let read = file.read_all(&mut buf[..want])?;
    if read == 0 {
        // The file shrank between `fstat` and here, so the entry can no longer
        // match the size its header declares.
        return Err(BuildError::EntryChangedSize);
    }
    Ok(read)
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
