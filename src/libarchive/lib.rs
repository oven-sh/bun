// @link "../deps/libarchive.a"
#![warn(unused_must_use)]
// ──────────────────────────────────────────────────────────────────────────
// Thin `extern "C"` wrappers over the libarchive C library live in `mod lib`
// below; higher-level extraction logic (`Archiver`, `BufferReadStream`) sits
// on top and uses `bun_sys` for I/O.
// ──────────────────────────────────────────────────────────────────────────
use core::ptr;

use bun_collections::StringArrayHashMap;
use bun_core::{MutableString, slice_to_nul, strings};
use bun_core::{Output, ZStr, slice_as_bytes};
#[cfg(unix)]
use bun_paths::PathBuffer;
use bun_paths::{OSPathChar, SEP, SEP_STR};
use bun_sys::{self, Fd, FdExt};
use bun_wyhash::hash;

pub mod error;
pub use error::{Error, Result};

// ──────────────────────────────────────────────────────────────────────────
// Local libarchive C-API surface. Thin safe(ish) wrappers over the raw
// `extern "C"` libarchive symbols. The opaque `Archive` / `Entry` types
// here are layout-compatible with libarchive's `struct archive` /
// `struct archive_entry` (zero-sized, `#[repr(C)]`, !Unpin).
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types)]
pub mod lib {
    use super::*;
    use core::ffi::{c_char, c_int, c_long, c_uint, c_void};

    pub type la_ssize_t = isize;
    pub(crate) type la_int64_t = i64;
    type time_t = isize;

    bun_opaque::opaque_ffi! {
        /// Opaque libarchive `struct archive`. Always used behind `*mut Archive`.
        /// Contains `UnsafeCell` so that `&Archive` does not assert immutability
        /// (libarchive mutates through every call), making `&self -> *mut Self`
        /// sound under Stacked Borrows.
        pub struct Archive;
        /// Opaque libarchive `struct archive_entry`. Always used behind `*mut Entry`.
        /// Contains `UnsafeCell` for the same reason as `Archive` — the C side
        /// mutates through getter/setter calls that take `&self` here.
        pub struct Entry;
    }

    #[repr(i32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Result {
        Eof = 1,
        Ok = 0,
        Retry = -10,
        Warn = -20,
        Failed = -25,
        Fatal = -30,
    }

    impl Result {
        /// `Ok` or `Warn`: the call completed. libarchive returns `Warn` for
        /// recoverable per-call issues while still producing a result, e.g. a
        /// `read_next_header` that fell back to the raw pathname bytes.
        #[inline]
        pub fn succeeded(self) -> bool {
            matches!(self, Result::Ok | Result::Warn)
        }
    }

    // ── raw libarchive C FFI ───────────────────────────────────────────────
    // Signatures match `vendor/libarchive/archive.h` exactly. `Result` is `#[repr(i32)]`
    // so it is ABI-compatible with the C `int` return values.
    unsafe extern "C" {
        // read side
        fn archive_read_new() -> *mut Archive;
        fn archive_read_close(a: *mut Archive) -> Result;
        fn archive_read_free(a: *mut Archive) -> Result;
        fn archive_read_support_format_tar(a: *mut Archive) -> Result;
        fn archive_read_support_format_gnutar(a: *mut Archive) -> Result;
        fn archive_read_support_filter_gzip(a: *mut Archive) -> Result;
        fn archive_read_set_options(a: *mut Archive, opts: *const c_char) -> Result;
        fn archive_read_open_memory(a: *mut Archive, buf: *const c_void, size: usize) -> Result;
        fn archive_read_next_header(a: *mut Archive, entry: *mut *mut Entry) -> Result;
        fn archive_read_data(a: *mut Archive, buf: *mut c_void, size: usize) -> la_ssize_t;
        fn archive_read_data_block(
            a: *mut Archive,
            buff: *mut *const c_void,
            size: *mut usize,
            offset: *mut la_int64_t,
        ) -> Result;
        fn archive_error_string(a: *mut Archive) -> *const c_char;
        fn archive_errno(a: *mut Archive) -> c_int;
        // streaming-read setup (used by TarballStream's resumable extractor)
        pub fn archive_read_set_format(a: *mut Archive, code: c_int) -> c_int;
        pub fn archive_read_append_filter(a: *mut Archive, code: c_int) -> c_int;
        pub fn archive_read_open(
            a: *mut Archive,
            client_data: *mut c_void,
            open: Option<archive_open_callback>,
            read: Option<archive_read_callback>,
            close: Option<archive_close_callback>,
        ) -> c_int;

        // write side
        fn archive_write_new() -> *mut Archive;
        fn archive_write_free(a: *mut Archive) -> Result;
        fn archive_write_close(a: *mut Archive) -> Result;
        fn archive_write_set_format_pax_restricted(a: *mut Archive) -> Result;
        fn archive_write_add_filter_gzip(a: *mut Archive) -> Result;
        fn archive_write_set_filter_option(
            a: *mut Archive,
            module: *const c_char,
            option: *const c_char,
            value: *const c_char,
        ) -> Result;
        fn archive_write_set_options(a: *mut Archive, opts: *const c_char) -> Result;
        fn archive_write_open_filename(a: *mut Archive, filename: *const c_char) -> Result;
        fn archive_write_header(a: *mut Archive, entry: *mut Entry) -> Result;
        fn archive_write_data(a: *mut Archive, data: *const c_void, size: usize) -> la_ssize_t;
        fn archive_write_finish_entry(a: *mut Archive) -> Result;
        #[link_name = "archive_write_open2"]
        fn archive_write_open2_raw(
            a: *mut Archive,
            client_data: *mut c_void,
            open: Option<archive_open_callback>,
            write: Option<archive_write_callback>,
            close: Option<archive_close_callback>,
            free: Option<archive_free_callback>,
        ) -> c_int;

        // entry
        fn archive_entry_new() -> *mut Entry;
        fn archive_entry_new2(a: *mut Archive) -> *mut Entry;
        fn archive_entry_free(e: *mut Entry);
        fn archive_entry_clear(e: *mut Entry) -> *mut Entry;
        fn archive_entry_pathname(e: *mut Entry) -> *const c_char;
        #[cfg(windows)]
        fn archive_entry_pathname_w(e: *mut Entry) -> *const u16;
        fn archive_entry_symlink(e: *mut Entry) -> *const c_char;
        fn archive_entry_perm(e: *mut Entry) -> bun_sys::Mode;
        fn archive_entry_size(e: *mut Entry) -> la_int64_t;
        fn archive_entry_filetype(e: *mut Entry) -> bun_sys::Mode;
        fn archive_entry_mtime(e: *mut Entry) -> time_t;
        fn archive_entry_set_pathname(e: *mut Entry, name: *const c_char);
        fn archive_entry_set_pathname_utf8(e: *mut Entry, name: *const c_char);
        fn archive_entry_set_size(e: *mut Entry, s: la_int64_t);
        fn archive_entry_set_filetype(e: *mut Entry, t: c_uint);
        fn archive_entry_set_perm(e: *mut Entry, p: bun_sys::Mode);
        fn archive_entry_set_mtime(e: *mut Entry, secs: time_t, nsecs: c_long);
    }

    /// One block from `archive_read_data_block`. `bytes` borrows libarchive's
    /// internal buffer (valid until the next read call on the owning archive).
    pub struct Block<'a> {
        pub bytes: &'a [u8],
        pub offset: i64,
        pub result: Result,
    }

    impl Archive {
        pub fn read_new() -> *mut Archive {
            // SAFETY: FFI call with no preconditions.
            let p = unsafe { archive_read_new() };
            // libarchive's `archive_read_new()` returns NULL on calloc failure.
            // Every caller immediately dereferences the result (forming
            // `&Archive`), so fail loudly here instead of invoking UB at the
            // first accessor call.
            assert!(!p.is_null(), "archive_read_new returned NULL (OOM)");
            p
        }
        pub fn read_close(&self) -> Result {
            // SAFETY: self came from archive_read_new().
            unsafe { archive_read_close(self.as_mut_ptr()) }
        }
        pub fn read_free(&self) -> Result {
            // SAFETY: self came from archive_read_new(); not used after this.
            unsafe { archive_read_free(self.as_mut_ptr()) }
        }
        pub fn read_support_format_tar(&self) -> Result {
            // SAFETY: self valid.
            unsafe { archive_read_support_format_tar(self.as_mut_ptr()) }
        }
        pub fn read_support_format_gnutar(&self) -> Result {
            // SAFETY: self valid.
            unsafe { archive_read_support_format_gnutar(self.as_mut_ptr()) }
        }
        pub fn read_support_filter_gzip(&self) -> Result {
            // SAFETY: self valid.
            unsafe { archive_read_support_filter_gzip(self.as_mut_ptr()) }
        }
        pub fn read_set_options(&self, opts: &core::ffi::CStr) -> Result {
            // SAFETY: self valid; opts is NUL-terminated.
            unsafe { archive_read_set_options(self.as_mut_ptr(), opts.as_ptr()) }
        }
        pub fn read_open_memory(&self, buf: &[u8]) -> Result {
            // SAFETY: self valid; buf outlives the archive (caller contract,
            // see `BufferReadStream::buf` field comment).
            unsafe { archive_read_open_memory(self.as_mut_ptr(), buf.as_ptr().cast(), buf.len()) }
        }
        pub fn read_next_header(&self, entry: &mut *mut Entry) -> Result {
            // SAFETY: self valid; entry is a valid out-ptr.
            unsafe {
                archive_read_next_header(self.as_mut_ptr(), std::ptr::from_mut::<*mut Entry>(entry))
            }
        }
        pub fn read_data(&self, buf: &mut [u8]) -> isize {
            // SAFETY: self valid; buf writable for buf.len().
            unsafe { archive_read_data(self.as_mut_ptr(), buf.as_mut_ptr().cast(), buf.len()) }
        }

        /// `archive_read_data_block` — returns `None` on EOF.
        pub fn next(&self, offset: &mut i64) -> Option<Block<'_>> {
            let mut buff: *const c_void = core::ptr::null();
            let mut size: usize = 0;
            // SAFETY: self valid; out-ptrs are valid stack locations.
            let r = unsafe {
                archive_read_data_block(self.as_mut_ptr(), &raw mut buff, &raw mut size, offset)
            };
            if r == Result::Eof {
                return None;
            }
            if r != Result::Ok {
                return Some(Block {
                    bytes: &[],
                    offset: *offset,
                    result: r,
                });
            }
            // SAFETY: on ARCHIVE_OK, libarchive guarantees buff[0..size] is
            // readable until the next read call on this archive.
            let bytes = unsafe { core::slice::from_raw_parts(buff.cast::<u8>(), size) };
            Some(Block {
                bytes,
                offset: *offset,
                result: r,
            })
        }

        pub fn write_zeros_to_file(file: &bun_sys::File, count: usize) -> Result {
            // Use a runtime memset (vs `[0u8; _]`) to keep .rodata small.
            let mut zero_buf = [0u8; 16 * 1024];
            zero_buf.fill(0);
            let mut remaining = count;
            while remaining > 0 {
                let to_write = &zero_buf[..remaining.min(zero_buf.len())];
                if file.write_all(to_write).is_err() {
                    return Result::Failed;
                }
                remaining -= to_write.len();
            }
            Result::Ok
        }

        /// Reads data from the archive and writes it to the given file
        /// descriptor. This is a port of libarchive's
        /// `archive_read_data_into_fd` with optimizations:
        /// - Uses pwrite when possible to avoid needing lseek for sparse file handling
        /// - Falls back to lseek + write if pwrite is not available
        /// - Falls back to writing zeros if lseek is not available
        /// - Truncates the file to the final size to handle trailing sparse holes
        pub(crate) fn read_data_into_fd(
            &self,
            fd: Fd,
            can_use_pwrite: &mut bool,
            can_use_lseek: &mut bool,
        ) -> Result {
            #[cfg(windows)]
            {
                *can_use_pwrite = false;
            }
            let mut target_offset: i64 = 0; // Updated by archive.next() — where this block should be written
            let mut actual_offset: i64 = 0; // Where we've actually written to (for write() path)
            let mut final_offset: i64 = 0; // Furthest point the file must extend to
            let file = bun_sys::File::borrow(&fd);

            while let Some(block) = self.next(&mut target_offset) {
                if block.result != Result::Ok {
                    return block.result;
                }
                let data = block.bytes;

                // Track the furthest point we need to write to (for final truncation)
                final_offset = final_offset.max(block.offset + data.len() as i64);

                #[cfg(unix)]
                {
                    // Try pwrite first — it handles sparse files without needing lseek
                    if *can_use_pwrite {
                        match file.pwrite_all(data, block.offset) {
                            Err(_) => {
                                *can_use_pwrite = false;
                                bun_core::debug_warn!(
                                    "libarchive: falling back to write() after pwrite() failure",
                                );
                                // Fall through to lseek+write path
                            }
                            Ok(()) => {
                                // pwrite doesn't update file position, but track logical position for fallback
                                actual_offset = actual_offset.max(block.offset + data.len() as i64);
                                continue;
                            }
                        }
                    }
                }

                // Handle mismatch between actual position and target position
                if block.offset != actual_offset {
                    'seek: {
                        if *can_use_lseek {
                            match bun_sys::set_file_offset(fd, block.offset as u64) {
                                Err(_) => *can_use_lseek = false,
                                Ok(()) => {
                                    actual_offset = block.offset;
                                    break 'seek;
                                }
                            }
                        }

                        // lseek failed or not available
                        if block.offset > actual_offset {
                            // Write zeros to fill the gap
                            let zero_count = (block.offset - actual_offset) as usize;
                            let zero_result = Self::write_zeros_to_file(file, zero_count);
                            if zero_result != Result::Ok {
                                return zero_result;
                            }
                            actual_offset = block.offset;
                        } else {
                            // Can't seek backward without lseek
                            return Result::Failed;
                        }
                    }
                }

                match file.write_all(data) {
                    Err(_) => return Result::Failed,
                    Ok(()) => {
                        actual_offset += data.len() as i64;
                    }
                }
            }

            // Handle trailing sparse hole by truncating file to final size.
            // This extends the file to include any trailing zeros without actually writing them.
            if final_offset > actual_offset {
                let _ = bun_sys::ftruncate(fd, final_offset);
            }

            Result::Ok
        }

        // `self` must be a live archive handle from `archive_{read,write}_new()`.
        // `Archive` is `opaque_ffi!`-backed (UnsafeCell), so `&self → *mut Self`
        // is sound; libarchive never returns null from `*_new()`.
        pub fn error_string(&self) -> &'static [u8] {
            // SAFETY: `self` is a live archive handle.
            let p = unsafe { archive_error_string(self.as_mut_ptr()) };
            if p.is_null() {
                return b"";
            }
            // SAFETY: libarchive owns the error string for the lifetime of the
            // archive; callers treat it as borrowed-until-next-call. The
            // `'static` here is a lifetime erasure — the caller must not let
            // the slice outlive the archive.
            unsafe { ZStr::from_c_ptr(p) }.as_bytes()
        }

        /// Last failure's error number: an OS `errno`, -1 (libarchive-internal) or 0 (unset).
        pub fn errno(&self) -> c_int {
            // SAFETY: `self` is a live archive handle.
            unsafe { archive_errno(self.as_mut_ptr()) }
        }

        // ── write side ─────────────────────────────────────────────────────
        pub fn write_new() -> *mut Archive {
            // SAFETY: FFI call with no preconditions.
            unsafe { archive_write_new() }
        }
        pub fn write_free(&self) -> Result {
            // SAFETY: self came from archive_write_new(); not used after this.
            unsafe { archive_write_free(self.as_mut_ptr()) }
        }
        pub fn write_close(&self) -> Result {
            // SAFETY: self valid.
            unsafe { archive_write_close(self.as_mut_ptr()) }
        }
        pub fn write_set_format_pax_restricted(&self) -> Result {
            // SAFETY: self valid.
            unsafe { archive_write_set_format_pax_restricted(self.as_mut_ptr()) }
        }
        pub fn write_add_filter_gzip(&self) -> Result {
            // SAFETY: self valid.
            unsafe { archive_write_add_filter_gzip(self.as_mut_ptr()) }
        }
        pub fn write_set_filter_option(
            &self,
            module: Option<&ZStr>,
            option: &ZStr,
            value: &ZStr,
        ) -> Result {
            // SAFETY: self valid; ZStr guarantees NUL-termination.
            unsafe {
                archive_write_set_filter_option(
                    self.as_mut_ptr(),
                    module.map_or(core::ptr::null(), |m| m.as_ptr().cast()),
                    option.as_ptr().cast(),
                    value.as_ptr().cast(),
                )
            }
        }
        pub fn write_set_options(&self, opts: &ZStr) -> Result {
            // SAFETY: self valid; ZStr guarantees NUL-termination.
            unsafe { archive_write_set_options(self.as_mut_ptr(), opts.as_ptr().cast()) }
        }
        pub fn write_open_filename(&self, filename: &ZStr) -> Result {
            // SAFETY: self valid; ZStr guarantees NUL-termination.
            unsafe { archive_write_open_filename(self.as_mut_ptr(), filename.as_ptr().cast()) }
        }
        pub fn write_header(&self, entry: &Entry) -> Result {
            // SAFETY: self valid; entry came from Entry::new()/read_next_header().
            // `Entry` has interior mutability so `&Entry -> *mut Entry` is sound.
            unsafe { archive_write_header(self.as_mut_ptr(), entry.as_mut_ptr()) }
        }
        pub fn write_data(&self, data: &[u8]) -> isize {
            // SAFETY: self valid; data readable for data.len().
            unsafe { archive_write_data(self.as_mut_ptr(), data.as_ptr().cast(), data.len()) }
        }
        pub fn write_finish_entry(&self) -> Result {
            // SAFETY: self valid.
            unsafe { archive_write_finish_entry(self.as_mut_ptr()) }
        }
    }

    impl Entry {
        pub fn pathname(&self) -> &ZStr {
            // SAFETY: self valid; returned string owned by libarchive for the
            // lifetime of this entry.
            unsafe { ZStr::from_c_ptr(archive_entry_pathname(self.as_mut_ptr())) }
        }
        #[cfg(windows)]
        pub fn pathname_w(&self) -> &bun_core::WStr {
            // SAFETY: self valid.
            unsafe { bun_core::WStr::from_ptr(archive_entry_pathname_w(self.as_mut_ptr())) }
        }
        pub fn symlink(&self) -> &ZStr {
            // SAFETY: self valid.
            unsafe { ZStr::from_c_ptr(archive_entry_symlink(self.as_mut_ptr())) }
        }
        pub fn perm(&self) -> u32 {
            // SAFETY: self valid.
            unsafe { archive_entry_perm(self.as_mut_ptr()) as u32 }
        }
        pub fn size(&self) -> i64 {
            // SAFETY: self valid.
            unsafe { archive_entry_size(self.as_mut_ptr()) }
        }
        pub fn filetype(&self) -> u32 {
            // SAFETY: self valid.
            unsafe { archive_entry_filetype(self.as_mut_ptr()) as u32 }
        }
        pub fn mtime(&self) -> i64 {
            // SAFETY: self valid.
            unsafe { archive_entry_mtime(self.as_mut_ptr()) as i64 }
        }

        // ── write side ─────────────────────────────────────────────────────
        pub(crate) fn new() -> *mut Entry {
            // SAFETY: FFI call with no preconditions.
            unsafe { archive_entry_new() }
        }
        /// `archive_entry_new2(archive)` — ties the entry to the archive's
        /// charset-conversion context (preferred over `new()` when an archive
        /// is available). `archive` is a live handle from `read_new()`/`write_new()`.
        pub fn new2(archive: &Archive) -> *mut Entry {
            // SAFETY: `archive` is a live handle (opaque_ffi! `&self → *mut Self`).
            unsafe { archive_entry_new2(archive.as_mut_ptr()) }
        }
        pub fn free(&self) {
            // SAFETY: self came from Entry::new(); not used after this.
            unsafe { archive_entry_free(self.as_mut_ptr()) }
        }
        pub fn clear(&self) -> *mut Entry {
            // SAFETY: self valid.
            unsafe { archive_entry_clear(self.as_mut_ptr()) }
        }
        /// Raw `archive_entry_set_pathname` — bytes are stored verbatim (no
        /// charset conversion).
        pub fn set_pathname(&self, name: &ZStr) {
            // SAFETY: self valid; name is NUL-terminated.
            unsafe { archive_entry_set_pathname(self.as_mut_ptr(), name.as_ptr()) }
        }
        pub fn set_pathname_utf8(&self, name: &ZStr) {
            // SAFETY: self valid; name is NUL-terminated.
            unsafe { archive_entry_set_pathname_utf8(self.as_mut_ptr(), name.as_ptr()) }
        }
        pub fn set_size(&self, s: i64) {
            // SAFETY: self valid.
            unsafe { archive_entry_set_size(self.as_mut_ptr(), s) }
        }
        pub fn set_filetype(&self, t: u32) {
            // SAFETY: self valid.
            unsafe { archive_entry_set_filetype(self.as_mut_ptr(), t as c_uint) }
        }
        pub fn set_perm(&self, p: u32) {
            // SAFETY: self valid.
            unsafe { archive_entry_set_perm(self.as_mut_ptr(), p as bun_sys::Mode) }
        }
        pub fn set_mtime(&self, secs: isize, nsecs: core::ffi::c_long) {
            // SAFETY: self valid.
            unsafe { archive_entry_set_mtime(self.as_mut_ptr(), secs as time_t, nsecs) }
        }
    }

    // ── RAII owners ────────────────────────────────────────────────────────
    //
    // The raw `*mut Archive` / `*mut Entry` constructors above mirror the C
    // API. These thin owners pair them with the matching `*_free` on `Drop`
    // so callers stop hand-rolling `defer { (*archive).read_free() }`.

    /// Owns a `*mut Archive` opened with [`Archive::read_new`]; calls
    /// `archive_read_free` on drop. Derefs to `&Archive`.
    pub struct ReadArchive(core::ptr::NonNull<Archive>);
    impl ReadArchive {
        #[inline]
        pub fn new() -> Self {
            Self(
                core::ptr::NonNull::new(Archive::read_new())
                    .expect("archive_read_new returned null"),
            )
        }
    }
    impl core::ops::Deref for ReadArchive {
        type Target = Archive;
        #[inline]
        fn deref(&self) -> &Archive {
            // SAFETY: handle is live until Drop; libarchive owns the storage.
            unsafe { self.0.as_ref() }
        }
    }
    impl Drop for ReadArchive {
        #[inline]
        fn drop(&mut self) {
            // SAFETY: handle came from archive_read_new() and is freed exactly once.
            let _ = unsafe { archive_read_free(self.0.as_ptr()) };
        }
    }

    /// Owns a `*mut Archive` opened with [`Archive::write_new`]; calls
    /// `archive_write_free` on drop. Derefs to `&Archive`.
    pub struct WriteArchive(core::ptr::NonNull<Archive>);
    impl WriteArchive {
        #[inline]
        pub fn new() -> Self {
            Self(
                core::ptr::NonNull::new(Archive::write_new())
                    .expect("archive_write_new returned null"),
            )
        }
    }
    impl core::ops::Deref for WriteArchive {
        type Target = Archive;
        #[inline]
        fn deref(&self) -> &Archive {
            // SAFETY: handle is live until Drop; libarchive owns the storage.
            unsafe { self.0.as_ref() }
        }
    }
    impl Drop for WriteArchive {
        #[inline]
        fn drop(&mut self) {
            // SAFETY: handle came from archive_write_new() and is freed exactly once.
            let _ = unsafe { archive_write_free(self.0.as_ptr()) };
        }
    }

    /// Owns a `*mut Entry` created with [`Entry::new`] / [`Entry::new2`];
    /// calls `archive_entry_free` on drop. Derefs to `&Entry`.
    pub struct OwnedEntry(core::ptr::NonNull<Entry>);
    impl OwnedEntry {
        #[inline]
        pub fn new() -> Self {
            Self(core::ptr::NonNull::new(Entry::new()).expect("archive_entry_new returned null"))
        }
    }
    impl core::ops::Deref for OwnedEntry {
        type Target = Entry;
        #[inline]
        fn deref(&self) -> &Entry {
            // SAFETY: handle is live until Drop; libarchive owns the storage.
            unsafe { self.0.as_ref() }
        }
    }
    impl Drop for OwnedEntry {
        #[inline]
        fn drop(&mut self) {
            // SAFETY: handle came from archive_entry_new()/new2() and is freed exactly once.
            unsafe { archive_entry_free(self.0.as_ptr()) };
        }
    }

    // ── Archive::Iterator ──────────────────────────────────────────────────
    //
    // Thin streaming reader over a tar.gz blob: `init` opens the archive in
    // memory, `next` yields one header at a time, `read_entry_data` slurps the
    // current entry's payload, `close` tears down. Errors are surfaced as the
    // libarchive `*mut Archive` plus a static message so callers can append
    // `Archive::error_string`.

    /// Generic result type used by [`ArchiveIterator`].
    pub enum IteratorResult<T> {
        Err {
            archive: *mut Archive,
            message: &'static [u8],
        },
        Result(T),
    }

    impl<T> IteratorResult<T> {
        #[inline]
        pub(crate) fn init_err(arch: *mut Archive, msg: &'static [u8]) -> Self {
            Self::Err {
                message: msg,
                archive: arch,
            }
        }
        #[inline]
        pub(crate) fn init_res(value: T) -> Self {
            Self::Result(value)
        }
    }

    /// Iterates over the entries of an open archive, skipping entries whose
    /// file kind has its bit set in `filter`.
    pub struct ArchiveIterator {
        pub archive: *mut Archive,
        // A u16 bitmask over
        // `bun_sys::FileKind` variants.
        pub(crate) filter: u16,
    }

    /// One entry returned from [`ArchiveIterator::next`].
    pub struct NextEntry {
        pub entry: *mut Entry,
        pub kind: bun_sys::FileKind,
    }

    impl NextEntry {
        /// The header `next()` just read; valid until the iterator advances.
        pub fn entry(&self) -> &Entry {
            // SAFETY: `entry` is the non-null header libarchive handed to `next()` and stays live until the next read.
            unsafe { &*self.entry }
        }
    }

    impl ArchiveIterator {
        /// Borrow the underlying libarchive handle.
        ///
        /// SAFETY (invariant): `self.archive` is set to a fresh non-null
        /// handle by `Archive::read_new()` in [`init`] and remains valid
        /// until `read_free()` in [`close`]. All `Archive` methods take
        /// `&self` (FFI interior mutability), so a shared borrow suffices.
        #[inline]
        pub fn archive(&self) -> &Archive {
            // SAFETY: see doc comment — non-null for the lifetime of `self`.
            unsafe { &*self.archive }
        }

        /// Reads the body of the entry `next()` just returned.
        pub fn read_entry_data(
            &mut self,
            next: &NextEntry,
        ) -> core::result::Result<IteratorResult<Box<[u8]>>, bun_core::OOM> {
            next.read_entry_data(self.archive())
        }

        pub fn init(tarball_bytes: &[u8]) -> IteratorResult<Self> {
            let archive = Archive::read_new();
            // SAFETY: archive_read_new() returns a non-null handle owned by libarchive.
            let a = unsafe { &*archive };

            match a.read_support_format_tar() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return IteratorResult::init_err(
                        archive,
                        b"failed to enable tar format support",
                    );
                }
                _ => {}
            }
            match a.read_support_format_gnutar() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return IteratorResult::init_err(
                        archive,
                        b"failed to enable gnutar format support",
                    );
                }
                _ => {}
            }
            match a.read_support_filter_gzip() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return IteratorResult::init_err(
                        archive,
                        b"failed to enable support for gzip compression",
                    );
                }
                _ => {}
            }
            match a.read_set_options(c"read_concatenated_archives") {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return IteratorResult::init_err(
                        archive,
                        b"failed to set option `read_concatenated_archives`",
                    );
                }
                _ => {}
            }
            match a.read_open_memory(tarball_bytes) {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return IteratorResult::init_err(archive, b"failed to read tarball");
                }
                _ => {}
            }

            IteratorResult::init_res(Self { archive, filter: 0 })
        }

        pub fn next(&mut self) -> IteratorResult<Option<NextEntry>> {
            let a = self.archive();
            let mut entry: *mut Entry = core::ptr::null_mut();
            loop {
                return match a.read_next_header(&mut entry) {
                    Result::Retry => continue,
                    Result::Eof => IteratorResult::init_res(None),
                    // `Warn` still yields a fully populated entry; see `Result::succeeded`.
                    Result::Ok | Result::Warn => {
                        let kind = bun_sys::kind_from_mode(
                            Entry::opaque_ref(entry).filetype() as bun_sys::Mode
                        );
                        if (self.filter & (1u16 << (kind as u8))) != 0 {
                            continue;
                        }
                        IteratorResult::init_res(Some(NextEntry { entry, kind }))
                    }
                    _ => IteratorResult::init_err(self.archive, b"failed to read archive header"),
                };
            }
        }

        /// Returns a `Result` the caller inspects, so this
        /// cannot be `Drop`. Explicit-close per PORTING.md §Idiom map.
        pub fn close(self) -> IteratorResult<()> {
            let a = self.archive();
            match a.read_close() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return IteratorResult::init_err(self.archive, b"failed to close archive read");
                }
                _ => {}
            }
            match a.read_free() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return IteratorResult::init_err(self.archive, b"failed to free archive read");
                }
                _ => {}
            }
            IteratorResult::init_res(())
        }
    }

    impl NextEntry {
        /// Reads this entry's full data into a heap buffer. `archive` is the
        /// live handle this `NextEntry` was yielded from.
        pub fn read_entry_data(
            &self,
            archive: &Archive,
        ) -> core::result::Result<IteratorResult<Box<[u8]>>, bun_core::OOM> {
            // SAFETY: self.entry is the libarchive-owned entry from read_next_header.
            let size = unsafe { (*self.entry).size() };
            let Ok(size) = usize::try_from(size) else {
                return Ok(IteratorResult::init_err(
                    archive.as_mut_ptr(),
                    b"invalid archive entry size",
                ));
            };
            // Read data incrementally so untrusted entry sizes don't drive allocation.
            let mut buf: Vec<u8> = Vec::new();
            while buf.len() < size {
                let to_read = (size - buf.len()).min(64 * 1024);
                buf.try_reserve(to_read).map_err(|_| bun_core::AllocError)?;
                // SAFETY: `archive_read_data` only writes into the slice; the written prefix is committed below.
                let dest = unsafe { &mut bun_core::vec::spare_bytes_mut(&mut buf)[..to_read] };
                let read = archive.read_data(dest);
                if read < 0 {
                    return Ok(IteratorResult::init_err(
                        archive.as_mut_ptr(),
                        b"failed to read archive data",
                    ));
                }
                if read == 0 {
                    break;
                }
                // SAFETY: `archive_read_data` returns exactly the byte count it wrote (`<= to_read`).
                unsafe {
                    bun_core::vec::commit_spare(&mut buf, usize::try_from(read).expect("int cast"))
                };
            }
            Ok(IteratorResult::init_res(buf.into_boxed_slice()))
        }
    }

    // ── write-open callback surface (libarchive `archive_write_open2`) ─────
    type archive_open_callback = unsafe extern "C" fn(*mut Archive, *mut c_void) -> c_int;
    pub type archive_read_callback =
        unsafe extern "C" fn(*mut Archive, *mut c_void, *mut *const c_void) -> la_ssize_t;
    type archive_write_callback =
        unsafe extern "C" fn(*mut Archive, *mut c_void, *const c_void, usize) -> la_ssize_t;
    type archive_close_callback = unsafe extern "C" fn(*mut Archive, *mut c_void) -> c_int;
    type archive_free_callback = unsafe extern "C" fn(*mut Archive, *mut c_void) -> c_int;

    /// `a` is a live `archive_write_new()` handle. `client_data` is forwarded
    /// opaquely to the callbacks (never dereferenced here); its lifetime must
    /// outlast the registered callbacks.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn archive_write_open2(
        a: &Archive,
        client_data: *mut c_void,
        open: Option<archive_open_callback>,
        write: Option<archive_write_callback>,
        close: Option<archive_close_callback>,
        free: Option<archive_free_callback>,
    ) -> c_int {
        // SAFETY: `a` is a live handle (`opaque_ffi!` `&self → *mut Self`);
        // `client_data` is opaque to libarchive until a callback dereferences it.
        unsafe { archive_write_open2_raw(a.as_mut_ptr(), client_data, open, write, close, free) }
    }

    /// Growing memory buffer for archive writes with libarchive callbacks.
    pub struct GrowingBuffer {
        pub(crate) list: Vec<u8>,
        pub(crate) had_error: bool,
    }

    impl GrowingBuffer {
        pub fn init() -> GrowingBuffer {
            GrowingBuffer {
                list: Vec::new(),
                had_error: false,
            }
        }

        pub fn to_owned_slice(&mut self) -> core::result::Result<Vec<u8>, bun_core::OOM> {
            if self.had_error {
                return Err(bun_core::AllocError);
            }
            Ok(core::mem::take(&mut self.list))
        }

        pub unsafe extern "C" fn open_callback(
            _a: *mut Archive,
            client_data: *mut c_void,
        ) -> c_int {
            // SAFETY: client_data is a *mut GrowingBuffer registered via archive_write_open2.
            let this = unsafe { bun_core::callback_ctx::<GrowingBuffer>(client_data) };
            this.list.clear();
            this.had_error = false;
            0
        }

        pub unsafe extern "C" fn write_callback(
            _a: *mut Archive,
            client_data: *mut c_void,
            buff: *const c_void,
            length: usize,
        ) -> la_ssize_t {
            // SAFETY: client_data is a *mut GrowingBuffer registered via archive_write_open2.
            let this = unsafe { bun_core::callback_ctx::<GrowingBuffer>(client_data) };
            if buff.is_null() || length == 0 {
                return 0;
            }
            // SAFETY: buff[0..length] is valid for reads per libarchive contract.
            let data = unsafe { core::slice::from_raw_parts(buff.cast::<u8>(), length) };
            if this.list.try_reserve(length).is_err() {
                this.had_error = true;
                return -1;
            }
            this.list.extend_from_slice(data);
            la_ssize_t::try_from(length).expect("int cast")
        }

        pub unsafe extern "C" fn close_callback(
            _a: *mut Archive,
            _client_data: *mut c_void,
        ) -> c_int {
            0
        }
    }

    // ── Archive::Iterator ──────────────────────────────────────────────────
    // Thin
    // wrapper that opens a tarball from memory and yields one
    // `IteratorEntry` per `next()`, used by `bun publish <tarball>`.
}

use lib::Archive;

pub struct BufferReadStream {
    buf: *const [u8],

    archive: *mut Archive,
}

impl BufferReadStream {
    /// Construct a stream over `buf`.
    ///
    /// # Safety
    /// `buf` is type-erased to a raw `*const [u8]` (no lifetime parameter on
    /// `BufferReadStream` — see field comment). The caller
    /// **must** guarantee that the slice `buf` points to remains valid and
    /// unmoved for the entire lifetime of the returned `BufferReadStream`
    /// (including its `Drop`). Violating this makes [`buf()`], [`buf_left()`],
    /// and [`open_read()`] dereference a dangling pointer (UB).
    pub(crate) unsafe fn init(buf: &[u8]) -> Self {
        // was an out-param constructor (`this.* = ...`)
        Self {
            buf: std::ptr::from_ref::<[u8]>(buf),
            archive: Archive::read_new(),
        }
    }

    /// Borrow the underlying libarchive handle.
    ///
    /// SAFETY (invariant): `self.archive` is set to a fresh non-null handle by
    /// `Archive::read_new()` in `init()` (asserted there) and remains valid
    /// until `read_free()` in `Drop`. All `Archive` methods take `&self`
    /// (FFI interior mutability), so a shared borrow is sufficient.
    #[inline]
    fn archive(&self) -> &Archive {
        // SAFETY: see doc comment — non-null for the lifetime of `self`.
        unsafe { &*self.archive }
    }

    /// Borrow the input buffer.
    ///
    /// SAFETY (invariant): `self.buf` is a fat pointer captured from the
    /// `&[u8]` passed to `init()`; the caller guarantees it outlives `self`
    /// (see field comment). Never null, never mutated.
    #[inline]
    fn buf(&self) -> &[u8] {
        // SAFETY: see doc comment — borrowed for `self`'s lifetime.
        unsafe { &*self.buf }
    }

    pub(crate) fn open_read(&mut self) -> lib::Result {
        let archive = self.archive();

        let _ = archive.read_support_format_tar();
        let _ = archive.read_support_format_gnutar();
        let _ = archive.read_support_filter_gzip();

        // Ignore zeroed blocks in the archive, which occurs when multiple tar archives
        // have been concatenated together.
        // Without this option, only the contents of
        // the first concatenated archive would be read.
        let _ = archive.read_set_options(c"read_concatenated_archives");

        archive.read_open_memory(self.buf())
    }
}

impl Drop for BufferReadStream {
    fn drop(&mut self) {
        let _ = self.archive().read_close();
        let _ = self.archive().read_free();
    }
}

/// `mkdirat` mode for a directory entry. `perm` is whatever the header
/// encoded (a GNU base-256 field need not fit in `0o7777`), so mask it, then
/// make readable directories listable like node-tar does:
/// https://github.com/npm/node-tar/blob/main/lib/mode-fix.js
#[cfg(not(windows))]
pub fn directory_mode(perm: bun_sys::Mode) -> bun_sys::Mode {
    let mut mode = perm & 0o7777;
    if (mode & 0o400) != 0 {
        mode |= 0o100;
    }
    if (mode & 0o40) != 0 {
        mode |= 0o10;
    }
    if (mode & 0o4) != 0 {
        mode |= 0o1;
    }
    mode
}

/// Validates that a symlink target doesn't escape the extraction directory.
/// Returns true if the symlink is safe (target stays within extraction dir),
/// false if it would escape (e.g., via ../ traversal or absolute path).
///
/// The check works by normalizing `symlink_dir/link_target` as a relative
/// path with leading `..` preserved; the target is unsafe if the result
/// climbs above the extraction root.
#[cfg(unix)]
pub fn is_symlink_target_safe(
    symlink_path: &[u8],
    link_target: &ZStr,
    symlink_join_buf: &mut Option<bun_paths::path_buffer_pool::Guard>,
) -> bool {
    // Absolute symlink targets are never safe - they could point anywhere
    let link_target_bytes = link_target.as_bytes();
    if link_target_bytes.is_empty() || link_target_bytes[0] == b'/' {
        return false;
    }

    let mut seen_named_component = false;
    for component in strings::split(link_target_bytes, b"/") {
        match component {
            b"" | b"." => {}
            b".." => {
                if seen_named_component {
                    return false;
                }
            }
            _ => seen_named_component = true,
        }
    }

    // Get the directory containing the symlink
    let symlink_dir = bun_paths::dirname_simple(symlink_path);

    let join_buf: &mut PathBuffer =
        symlink_join_buf.get_or_insert_with(bun_paths::path_buffer_pool::get);

    // Normalize symlink_dir/link_target as a relative path. An absolute fake
    // root cannot be used here: POSIX normalization clamps excess `..` at `/`,
    // so a target like `../../../packages/x` would normalize back under any
    // fake root that happens to match a real ancestor directory name.
    if symlink_dir.len() + 1 + link_target_bytes.len() >= join_buf.len() {
        return false;
    }
    let mut written = 0usize;
    if !symlink_dir.is_empty() {
        join_buf[..symlink_dir.len()].copy_from_slice(symlink_dir);
        written = symlink_dir.len();
        join_buf[written] = b'/';
        written += 1;
    }
    join_buf[written..written + link_target_bytes.len()].copy_from_slice(link_target_bytes);
    written += link_target_bytes.len();

    let mut norm_buf = bun_paths::path_buffer_pool::get();
    let resolved = bun_paths::resolve_path::normalize_string_generic_t::<u8, true, false>(
        &join_buf[..written],
        &mut norm_buf[..],
        b'/',
        |c| c == b'/',
    );

    !(strings::eql(resolved, b"..") || strings::has_prefix_comptime(resolved, b"../"))
}

#[cfg(unix)]
pub struct DeferredSymlink {
    path: bun_core::ZBox,
    target: bun_core::ZBox,
}

#[cfg(unix)]
impl DeferredSymlink {
    pub fn new(path: &[u8], target: &[u8]) -> Self {
        Self {
            path: bun_core::ZBox::from_bytes(path),
            target: bun_core::ZBox::from_bytes(target),
        }
    }
}

/// `("a/b", 4..5)` for `"a/b/c/"`: the parent, then where the last component is.
#[cfg(not(windows))]
fn split_entry_parent(path: &[u8]) -> Option<(&[u8], core::ops::Range<usize>)> {
    let mut end = path.len();
    while end > 0 && path[end - 1] == b'/' {
        end -= 1;
    }
    if end == 0 {
        return None;
    }
    match strings::last_index_of_char(&path[..end], b'/') {
        Some(i) => Some((&path[..i], i + 1..end)),
        None => Some((b"", 0..end)),
    }
}

/// The one answer to a symlink in the destination where the entry `path` needs a directory.
#[cfg(not(windows))]
pub fn link_in_the_way(path: &[u8], log: bool) -> crate::Error {
    if log {
        bun_core::warn!(
            "Refusing to extract through a symlink in the destination: {}\n",
            bstr::BStr::new(path),
        );
    }
    crate::Error::LinkInTheWay(Box::from(path))
}

/// Creates entries below `root` through no symlink that is already there. `Ok(None)`: `link_in_the_way`.
#[cfg(not(windows))]
pub struct ContainedDir {
    root: Fd,
    /// `false` once `openat_no_symlinks` said `None`. Then parents are walked with `O_NOFOLLOW` and cached.
    kernel: bool,
    /// The innermost directory the walk keeps open, relative to `root`.
    path: Vec<u8>,
    /// One level per component of `path`, outermost first.
    dirs: Vec<WalkedDir>,
    /// How many levels the walk keeps open. Fewer after EMFILE.
    limit: usize,
    /// The parent of the last call, when `dirs` does not own it. The next call closes it.
    spill: Option<Fd>,
}

#[cfg(not(windows))]
struct WalkedDir {
    /// Where this component ends in `ContainedDir::path`.
    end: usize,
    fd: Fd,
    /// The walk made the directory, so a child is created without a lookup first.
    created: bool,
}

#[cfg(not(windows))]
impl ContainedDir {
    /// One fd per level the walk keeps open. Deeper levels are reopened per call.
    const MAX_DEPTH: usize = 128;

    /// For the open that refuses symlinks itself. The walk adds `O_NOFOLLOW`.
    const FILE_FLAGS: i32 = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;

    /// `O_PATH` or `O_SEARCH`: the `*at` calls need search permission on the directory, not read.
    const DIR_FLAGS: i32 =
        bun_sys::O::PATH | bun_sys::O::SEARCH | bun_sys::O::DIRECTORY | bun_sys::O::CLOEXEC;

    pub const fn new(root: Fd) -> ContainedDir {
        ContainedDir {
            root,
            kernel: true,
            path: Vec::new(),
            dirs: Vec::new(),
            limit: Self::MAX_DEPTH,
            spill: None,
        }
    }

    /// Creates or truncates the file `path`. A symlink under its own name is replaced, as tar does.
    pub fn create_file(&mut self, path: &ZStr, mode: bun_sys::Mode) -> bun_sys::Maybe<Option<Fd>> {
        use bun_sys::E;
        let (dirname, name) = Self::split(path, false)?;
        self.close_spill();
        let Some(first) = self.open_in_kernel(path, Self::FILE_FLAGS, mode) else {
            return self.create_file_by_walk(dirname, name, mode);
        };
        let opened = match first {
            Err(err) if err.get_errno() == E::ENOENT && !dirname.is_empty() => {
                if !self.make_missing(dirname)? {
                    return Ok(None);
                }
                self.open_in_kernel(path, Self::FILE_FLAGS, mode)
                    .unwrap_or(Err(err))
            }
            first => first,
        };
        match opened {
            Ok(fd) => Ok(Some(fd)),
            // The symlink is the name itself only if the parent opens.
            Err(err) if matches!(err.get_errno(), E::ELOOP | E::EMLINK) => {
                let Some((parent, _)) = self.parent(dirname, false)? else {
                    return Ok(None);
                };
                Self::replace_symlink(parent, name, mode).map(Some)
            }
            Err(err) => Err(err),
        }
    }

    /// Makes the directory `path`. `mode` gets whether its parent had to be made.
    pub fn make_dir(
        &mut self,
        path: &ZStr,
        mode: impl FnOnce(bool) -> bun_sys::Mode,
    ) -> bun_sys::Maybe<Option<()>> {
        let (dirname, name) = Self::split(path, true)?;
        let Some((parent, made)) = self.parent(dirname, true)? else {
            return Ok(None);
        };
        // With a trailing `/`, POSIX lets `mkdirat` go through a symlink under the name.
        let mut bare = name.as_bytes();
        while let [rest @ .., b'/'] = bare {
            bare = rest;
        }
        let mut name_buf = bun_paths::path_buffer_pool::get();
        let name = Self::z(bare, &mut name_buf[..])?;
        bun_sys::mkdirat_z(parent, name, mode(made)).map(Some)
    }

    /// Makes the directory that the entry `path` goes in.
    fn make_parent(&mut self, path: &ZStr) -> bun_sys::Maybe<Option<()>> {
        let (dirname, _) = Self::split(path, false)?;
        Ok(self.parent(dirname, true)?.map(|_| ()))
    }

    /// Makes the symlink `path`. Its parent is made when it is missing.
    pub fn symlink(&mut self, path: &ZStr, target: &ZStr) -> bun_sys::Maybe<Option<()>> {
        let (dirname, name) = Self::split(path, false)?;
        let Some((parent, _)) = self.parent(dirname, true)? else {
            return Ok(None);
        };
        bun_sys::symlinkat(target, parent, name).map(Some)
    }

    /// Removes the file `path`.
    pub fn unlink(&mut self, path: &ZStr) -> bun_sys::Maybe<Option<()>> {
        let (dirname, name) = Self::split(path, false)?;
        let Some((parent, _)) = self.parent(dirname, false)? else {
            return Ok(None);
        };
        bun_sys::unlinkat(parent, name).map(Some)
    }

    /// Opens what is at `path`, creates nothing. `Ok(None)` also for a symlink under the name itself.
    pub fn open_existing(&mut self, path: &ZStr, flags: i32) -> bun_sys::Maybe<Option<Fd>> {
        use bun_sys::E;
        let (dirname, name) = Self::split(path, false)?;
        self.close_spill();
        let opened = match self.open_in_kernel(path, flags, 0) {
            Some(opened) => opened,
            None => {
                let Some((parent, _)) = self.parent(dirname, false)? else {
                    return Ok(None);
                };
                bun_sys::openat(parent, name, flags | bun_sys::O::NOFOLLOW, 0)
            }
        };
        match opened {
            Ok(fd) => Ok(Some(fd)),
            Err(err) if matches!(err.get_errno(), E::ELOOP | E::EMLINK) => Ok(None),
            Err(err) => Err(err),
        }
    }

    fn invalid(errno: bun_sys::E) -> bun_sys::Error {
        bun_sys::Error::from_code(errno, bun_sys::Tag::open)
    }

    /// The parent of `path` and its name. Refuses a leading `/` and `..`: the kernel arm would follow them.
    fn split(path: &ZStr, directory: bool) -> bun_sys::Maybe<(&[u8], &ZStr)> {
        use bun_sys::E;
        let bytes = path.as_bytes();
        let escapes = bytes.starts_with(b"/")
            || (strings::contains(bytes, b"..")
                && strings::split(bytes, b"/").any(|component| strings::eql(component, b"..")));
        let Some((dirname, name)) = split_entry_parent(bytes).filter(|_| !escapes) else {
            return Err(Self::invalid(E::EINVAL));
        };
        // With a trailing `/`, the kernel can resolve the name through a symlink.
        if !directory && name.end != bytes.len() {
            return Err(Self::invalid(E::EISDIR));
        }
        let name = ZStr::from_slice_with_nul(&path.as_bytes_with_nul()[name.start..]);
        Ok((dirname, name))
    }

    /// `name`, NUL-terminated in `buf`.
    fn z<'b>(name: &[u8], buf: &'b mut [u8]) -> bun_sys::Maybe<&'b ZStr> {
        if name.len() >= buf.len() {
            return Err(Self::invalid(bun_sys::E::ENAMETOOLONG));
        }
        buf[..name.len()].copy_from_slice(name);
        buf[name.len()] = 0;
        Ok(ZStr::from_slice_with_nul(&buf[..=name.len()]))
    }

    /// One component of a directory path, NUL-terminated in `buf`.
    fn component<'b>(name: &[u8], buf: &'b mut [u8]) -> bun_sys::Maybe<&'b ZStr> {
        if name.is_empty() || strings::eql(name, b".") || strings::eql(name, b"..") {
            return Err(Self::invalid(bun_sys::E::EINVAL));
        }
        Self::z(name, buf)
    }

    /// `None`: the kernel cannot refuse symlinks, so the walk has to.
    fn open_in_kernel(
        &mut self,
        path: &ZStr,
        flags: i32,
        mode: bun_sys::Mode,
    ) -> Option<bun_sys::Maybe<Fd>> {
        if !self.kernel {
            return None;
        }
        let opened = bun_sys::openat_no_symlinks(self.root, path, flags, mode);
        self.kernel = opened.is_some();
        opened
    }

    fn close_spill(&mut self) {
        if let Some(fd) = self.spill.take() {
            fd.close();
        }
    }

    /// `Ok(None)` if `name` is a symlink: ELOOP, EMLINK or ENOTDIR by platform. A file is ENOTDIR too.
    fn unless_symlink<T>(
        parent: Fd,
        name: &ZStr,
        err: bun_sys::Error,
    ) -> bun_sys::Maybe<Option<T>> {
        use bun_sys::E;
        let is_symlink = match err.get_errno() {
            E::ELOOP | E::EMLINK => true,
            E::ENOTDIR => bun_sys::lstatat(parent, name).is_ok_and(|st| {
                bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode) == bun_sys::FileKind::SymLink
            }),
            _ => false,
        };
        if is_symlink { Ok(None) } else { Err(err) }
    }

    /// A symlink holds the name. The file takes its place.
    fn replace_symlink(parent: Fd, name: &ZStr, mode: bun_sys::Mode) -> bun_sys::Maybe<Fd> {
        let _ = bun_sys::unlinkat(parent, name);
        let flags =
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::EXCL | bun_sys::O::NOFOLLOW;
        bun_sys::openat(parent, name, flags, mode)
    }

    /// The directory `dirname` and whether this call made it. The fd is good until the next call.
    fn parent(&mut self, dirname: &[u8], create: bool) -> bun_sys::Maybe<Option<(Fd, bool)>> {
        self.close_spill();
        if dirname.is_empty() {
            return Ok(Some((self.root, false)));
        }
        if let Some(parent) = self.parent_from_kernel(dirname, create) {
            return parent;
        }
        loop {
            match self.walk(dirname, create) {
                Err(err) if Self::out_of_fds(&err) && self.shed() => {}
                parent => return parent,
            }
        }
    }

    fn parent_from_kernel(
        &mut self,
        dirname: &[u8],
        create: bool,
    ) -> Option<bun_sys::Maybe<Option<(Fd, bool)>>> {
        use bun_sys::E;
        if !self.kernel {
            return None;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let path = match Self::z(dirname, &mut buf[..]) {
            Ok(path) => path,
            Err(err) => return Some(Err(err)),
        };
        let mut made = false;
        loop {
            let err = match self.open_in_kernel(path, Self::DIR_FLAGS, 0)? {
                Ok(fd) => {
                    self.spill = Some(fd);
                    return Some(Ok(Some((fd, made))));
                }
                Err(err) => err,
            };
            return Some(match err.get_errno() {
                E::ELOOP | E::EMLINK => Ok(None),
                E::ENOENT if create && !made => match self.make_missing(dirname) {
                    Ok(true) => {
                        made = true;
                        continue;
                    }
                    Ok(false) => Ok(None),
                    Err(err) => Err(err),
                },
                _ => Err(err),
            });
        }
    }

    /// Makes the missing components of `dirname` for the kernel arm. `false`: one is a symlink.
    fn make_missing(&mut self, dirname: &[u8]) -> bun_sys::Maybe<bool> {
        use bun_sys::E;
        let mut buf = bun_paths::path_buffer_pool::get();
        Self::z(dirname, &mut buf[..])?;

        // The deepest ancestor that exists. The root always does.
        let (mut current, mut owned) = (self.root, false);
        let mut missing_from = 0usize;
        let mut end = dirname.len();
        while let Some(slash) = strings::last_index_of_char(&dirname[..end], b'/') {
            buf[slash] = 0;
            let ancestor = ZStr::from_slice_with_nul(&buf[..=slash]);
            match self.open_in_kernel(ancestor, Self::DIR_FLAGS, 0) {
                Some(Ok(fd)) => {
                    (current, owned) = (fd, true);
                    missing_from = slash + 1;
                    break;
                }
                Some(Err(err)) => match err.get_errno() {
                    E::ENOENT => end = slash,
                    E::ELOOP | E::EMLINK => return Ok(false),
                    _ => return Err(err),
                },
                None => return Err(Self::invalid(E::ENOSYS)),
            }
        }

        // `O_NOFOLLOW` refuses a symlink put where this loop just made a directory.
        let mut components = strings::split(&dirname[missing_from..], b"/").peekable();
        let mut made = Ok(true);
        while let Some(component) = components.next() {
            let name = match Self::component(component, &mut buf[..]) {
                Ok(name) => name,
                Err(err) => {
                    made = Err(err);
                    break;
                }
            };
            // 0o755: what `mkdir_recursive_at` gave these parents before.
            if let Err(err) = bun_sys::mkdirat_z(current, name, 0o755)
                && err.get_errno() != E::EEXIST
            {
                made = Err(err);
                break;
            }
            if components.peek().is_none() {
                break;
            }
            let flags = Self::DIR_FLAGS | bun_sys::O::NOFOLLOW;
            let next = match bun_sys::openat(current, name, flags, 0) {
                Ok(fd) => Ok(Some(fd)),
                Err(err) => Self::unless_symlink(current, name, err),
            };
            if owned {
                current.close();
            }
            match next {
                Ok(Some(fd)) => (current, owned) = (fd, true),
                Ok(None) => return Ok(false),
                Err(err) => return Err(err),
            }
        }
        if owned {
            current.close();
        }
        made
    }

    fn create_file_by_walk(
        &mut self,
        dirname: &[u8],
        name: &ZStr,
        mode: bun_sys::Mode,
    ) -> bun_sys::Maybe<Option<Fd>> {
        use bun_sys::E;
        loop {
            let Some((parent, _)) = self.parent(dirname, true)? else {
                return Ok(None);
            };
            let flags = Self::FILE_FLAGS | bun_sys::O::NOFOLLOW;
            let opened = match bun_sys::openat(parent, name, flags, mode) {
                Err(err) if matches!(err.get_errno(), E::ELOOP | E::EMLINK) => {
                    Self::replace_symlink(parent, name, mode)
                }
                opened => opened,
            };
            match opened {
                Ok(fd) => return Ok(Some(fd)),
                Err(err) if Self::out_of_fds(&err) && self.shed() => {}
                Err(err) => return Err(err),
            }
        }
    }

    fn truncate(&mut self, len: usize) {
        while self.dirs.len() > len {
            if let Some(dir) = self.dirs.pop() {
                dir.fd.close();
            }
        }
        self.path
            .truncate(self.dirs.last().map_or(0, |dir| dir.end));
    }

    fn out_of_fds(err: &bun_sys::Error) -> bool {
        matches!(err.get_errno(), bun_sys::E::EMFILE | bun_sys::E::ENFILE)
    }

    /// Keeps half as many directories open. `false` when none is open.
    fn shed(&mut self) -> bool {
        if self.dirs.is_empty() {
            return false;
        }
        self.limit = self.dirs.len() / 2;
        self.truncate(self.limit);
        true
    }

    /// The fd of `name` and whether this call made the directory.
    fn open_component(
        parent: Fd,
        parent_created: bool,
        name: &ZStr,
        create: bool,
    ) -> bun_sys::Maybe<Option<(Fd, bool)>> {
        use bun_sys::E;
        let open = || bun_sys::openat(parent, name, Self::DIR_FLAGS | bun_sys::O::NOFOLLOW, 0);

        if !(create && parent_created) {
            match open() {
                Ok(fd) => return Ok(Some((fd, false))),
                Err(err) if create && err.get_errno() == E::ENOENT => {}
                Err(err) => return Self::unless_symlink(parent, name, err),
            }
        }
        // 0o755: what `mkdir_recursive_at` gave these parents before.
        let created = match bun_sys::mkdirat_z(parent, name, 0o755) {
            Ok(()) => true,
            Err(err) if err.get_errno() == E::EEXIST => false,
            Err(err) => return Err(err),
        };
        match open() {
            Ok(fd) => Ok(Some((fd, created))),
            Err(err) => Self::unless_symlink(parent, name, err),
        }
    }

    fn walk(&mut self, dirname: &[u8], create: bool) -> bun_sys::Maybe<Option<(Fd, bool)>> {
        self.close_spill();
        // Most entries sit beside the one before them.
        if let Some(dir) = self.dirs.last()
            && strings::eql(dirname, &self.path)
        {
            return Ok(Some((dir.fd, false)));
        }

        let mut reused = 0usize;
        let mut offset = 0usize;
        for component in strings::split(dirname, b"/") {
            let end = offset + component.len();
            match self.dirs.get(reused) {
                Some(dir) if dir.end == end && strings::eql(&self.path[offset..end], component) => {
                    reused += 1;
                    offset = end + 1;
                }
                _ => break,
            }
        }
        self.truncate(reused);

        let (mut current, mut created) = self
            .dirs
            .last()
            .map_or((self.root, false), |dir| (dir.fd, dir.created));
        let mut remaining = strings::split(dirname, b"/").skip(reused).peekable();
        if remaining.peek().is_none() {
            return Ok(Some((current, false)));
        }

        let mut name_buf = bun_paths::path_buffer_pool::get();
        for component in remaining {
            let name = Self::component(component, &mut name_buf[..])?;
            let Some((fd, made)) = Self::open_component(current, created, name, create)? else {
                return Ok(None);
            };
            if self.dirs.len() < self.limit {
                if !self.path.is_empty() {
                    self.path.push(b'/');
                }
                self.path.extend_from_slice(component);
                self.dirs.push(WalkedDir {
                    end: self.path.len(),
                    fd,
                    created: made,
                });
            } else if let Some(previous) = self.spill.replace(fd) {
                previous.close();
            }
            (current, created) = (fd, made);
        }

        Ok(Some((current, created)))
    }
}

#[cfg(not(windows))]
impl Drop for ContainedDir {
    fn drop(&mut self) {
        self.close_spill();
        self.truncate(0);
    }
}

/// Creates the symlinks of an archive after its other entries. Returns how many, or `link_in_the_way`.
#[cfg(unix)]
pub fn create_deferred_symlinks(
    dir_fd: Fd,
    symlinks: &[DeferredSymlink],
    log: bool,
) -> crate::Result<u32> {
    let warn_not_created = |symlink: &DeferredSymlink| {
        if log {
            bun_core::warn!(
                "Skipping symlink that could not be created: {} -> {}\n",
                bstr::BStr::new(symlink.path.as_bytes()),
                bstr::BStr::new(symlink.target.as_bytes()),
            );
        }
    };
    let mut destination = ContainedDir::new(dir_fd);
    let mut refused: Option<&DeferredSymlink> = None;

    // Parents first: no symlink of this archive is then in the way of another one.
    let mut skip = vec![false; symlinks.len()];
    for (symlink, skip) in symlinks.iter().zip(&mut skip) {
        match destination.make_parent(symlink.path.as_zstr()) {
            Ok(Some(())) => {}
            Ok(None) => {
                *skip = true;
                refused.get_or_insert(symlink);
            }
            Err(_) => {
                *skip = true;
                warn_not_created(symlink);
            }
        }
    }

    let mut created: u32 = 0;
    for (symlink, skip) in symlinks.iter().zip(skip) {
        if skip {
            continue;
        }
        match destination.symlink(symlink.path.as_zstr(), symlink.target.as_zstr()) {
            Ok(Some(())) => created += 1,
            Ok(None) => {
                refused.get_or_insert(symlink);
            }
            Err(_) => warn_not_created(symlink),
        }
    }
    match refused {
        Some(symlink) => Err(link_in_the_way(symlink.path.as_bytes(), log)),
        None => Ok(created),
    }
}

/// Recursive mkdir over a WTF-16 path: component-iterates the
/// wide path and `NtCreateFile`s each prefix with `FILE_OPEN_IF`, walking back
/// on `FileNotFound` and forward again on success. This stays in WTF-16
/// throughout (no UTF-8 round-trip — `bun_sys::make_path_w` is the *different*
/// `bun.makePathW` helper which transcodes via `from_w_path` and would lose
/// lone surrogates / skip `\??\` long-path prefixing).
#[cfg(windows)]
fn make_path_u16(dir_fd: Fd, sub_path: &[u16]) -> crate::Result<()> {
    use bun_sys::{E, WindowsOpenDirOp, WindowsOpenDirOptions, open_dir_at_windows};
    // Access mask (`STANDARD_RIGHTS_READ | FILE_READ_ATTRIBUTES |
    // FILE_READ_EA | SYNCHRONIZE | FILE_TRAVERSE`) is selected by setting `read_only`,
    // and `FILE_OPEN_IF` via `OpenOrCreate`.
    let opts = WindowsOpenDirOptions {
        op: WindowsOpenDirOp::OpenOrCreate,
        ..Default::default()
    };
    // tar entry paths are dir-relative (no drive/UNC/`\??\`) so `init` never
    // returns BadPathName here.
    let it = bun_paths::ComponentIterator::init(sub_path, bun_paths::PathFormat::Windows)?;
    bun_paths::make_path_with(it, |prefix| {
        match open_dir_at_windows(dir_fd, prefix, opts) {
            Ok(fd) => {
                fd.close();
                Ok(bun_paths::MakePathStep::Created)
            }
            Err(e) if e.get_errno() == E::ENOENT => Ok(bun_paths::MakePathStep::NotFound(e.into())),
            Err(e) => Err(e.into()),
        }
    })
}

pub struct Archiver;

pub mod archiver {
    use super::*;

    pub struct Context {
        pub pluckers: Vec<Plucker>,
        pub overwrite_list: StringArrayHashMap<()>,
    }

    pub struct Plucker {
        pub contents: MutableString,
        pub(crate) filename_hash: u64,
        pub found: bool,
        pub fd: Fd,
    }

    impl Plucker {
        pub fn init(filepath: &[OSPathChar], estimated_size: usize) -> crate::Result<Plucker> {
            Ok(Plucker {
                contents: MutableString::init(estimated_size)?,
                filename_hash: hash(slice_as_bytes(filepath)),
                fd: Fd::INVALID,
                found: false,
            })
        }
    }

    /// What can already be in the directory an archive is extracted into.
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub enum DestinationKind {
        /// Anything, a symlink included. No entry is created through one.
        #[default]
        CallerProvided,
        /// Only what this extraction puts there. Each entry is created with one call on its whole path.
        PrivateFresh,
    }

    #[derive(Clone, Copy)]
    pub struct ExtractOptions {
        pub depth_to_skip: usize,
        pub close_handles: bool,
        pub log: bool,
        pub npm: bool,
        pub destination: DestinationKind,
    }

    impl Default for ExtractOptions {
        fn default() -> Self {
            Self {
                depth_to_skip: 0,
                close_handles: true,
                log: false,
                npm: false,
                destination: DestinationKind::CallerProvided,
            }
        }
    }
}

pub use archiver::{Context, DestinationKind, ExtractOptions, Plucker};

pub trait ArchiveAppender {
    /// Mirrors `@hasDecl(Child, "onFirstDirectoryName")`.
    const HAS_ON_FIRST_DIRECTORY_NAME: bool = false;

    fn needs_first_dirname(&self) -> bool {
        false
    }
    fn on_first_directory_name(&mut self, _name: &[u8]) {}

    fn append(&mut self, path: &[u8]) -> crate::Result<&[u8]> {
        let _ = path;
        unreachable!()
    }
}

impl ArchiveAppender for () {}

impl Archiver {
    pub fn get_overwriting_file_list<A: ArchiveAppender, const DEPTH_TO_SKIP: usize>(
        file_buffer: &[u8],
        root: &[u8],
        ctx: &mut Context,
        appender: &mut A,
    ) -> crate::Result<()> {
        let mut entry: *mut lib::Entry = ptr::null_mut();

        // SAFETY: `file_buffer` outlives `stream` (stack-local, dropped at fn exit).
        let mut stream = unsafe { BufferReadStream::init(file_buffer) };
        let _ = stream.open_read();
        let archive = stream.archive;

        // Uses the bun_sys directory-fd helpers (open_dir_absolute / open_dir_at).
        let dir: Fd = 'brk: {
            let cwd = Fd::cwd();

            // if the destination doesn't exist, we skip the whole thing since nothing can overwrite it.
            if bun_paths::is_absolute(root) {
                let Ok(d) = bun_sys::open_dir_absolute(root) else {
                    return Ok(());
                };
                break 'brk d;
            } else {
                let Ok(d) = bun_sys::open_dir_at(cwd, root) else {
                    return Ok(());
                };
                break 'brk d;
            }
        };
        // Fd has no Drop impl; close explicitly on every return path to avoid leaking
        // a directory HANDLE on Windows. Mirrors the guard pattern in extract_to_disk.
        let _close_dir_guard = scopeguard::guard(dir, |d| d.close());

        #[cfg(not(windows))]
        let mut destination = ContainedDir::new(dir);

        let mut normalized_buf = bun_paths::path_buffer_pool::get();

        'loop_: loop {
            // SAFETY: archive valid for stream lifetime
            let r = unsafe { (*archive).read_next_header(&mut entry) };

            match r {
                lib::Result::Eof => break 'loop_,
                lib::Result::Retry => continue 'loop_,
                lib::Result::Failed | lib::Result::Fatal => {
                    return Err(crate::Error::Fail);
                }
                _ => {
                    // do not use the utf8 name there
                    // it will require us to pull in libiconv
                    // though we should probably validate the utf8 here nonetheless
                    // SAFETY: entry was just populated by read_next_header
                    let pathname_full = lib::Entry::opaque_ref(entry).pathname();
                    let pathname_bytes = pathname_full.as_bytes();

                    // Tokenizer semantics: `next()` skips leading
                    // separators and returns None only when no token remains;
                    // the rest-of-input slice also skips leading separators.
                    let mut remaining = pathname_bytes;
                    let mut depth_i = 0usize;
                    while depth_i < DEPTH_TO_SKIP {
                        // skip leading separators
                        while let [first, rest @ ..] = remaining {
                            if *first == SEP {
                                remaining = rest;
                            } else {
                                break;
                            }
                        }
                        if remaining.is_empty() {
                            continue 'loop_;
                        }
                        match strings::index_of_char_usize(remaining, SEP) {
                            Some(i) => remaining = &remaining[i..],
                            None => remaining = &remaining[remaining.len()..],
                        }
                        depth_i += 1;
                    }
                    // skip leading separators (tokenizer.rest() does this)
                    while let [first, rest @ ..] = remaining {
                        if *first == SEP {
                            remaining = rest;
                        } else {
                            break;
                        }
                    }

                    // pathname = sliceTo(remaining[..len :0], 0)
                    let pathname = slice_to_nul(remaining);
                    if pathname.is_empty() || pathname.len() >= normalized_buf.len() {
                        continue 'loop_;
                    }
                    let normalized = bun_paths::resolve_path::normalize_buf_t::<
                        u8,
                        bun_paths::platform::Auto,
                    >(pathname, &mut normalized_buf[..]);
                    let normalized_len = normalized.len();
                    normalized_buf[normalized_len] = 0;
                    let pathname: &[u8] = &normalized_buf[..normalized_len];
                    if pathname.is_empty() || pathname == b"." {
                        continue 'loop_;
                    }
                    #[cfg(windows)]
                    if bun_paths::is_absolute_windows(pathname) {
                        continue 'loop_;
                    }
                    let dirname =
                        strings::trim(bun_paths::dirname_simple(pathname), SEP_STR.as_bytes());

                    // SAFETY: entry valid
                    let size: usize =
                        usize::try_from(lib::Entry::opaque_ref(entry).size().max(0)).unwrap();
                    if size > 0 {
                        #[cfg(windows)]
                        let existing = match bun_sys::openat_a(dir, pathname, bun_sys::O::WRONLY, 0)
                        {
                            Ok(opened) => Some(opened),
                            Err(_) => continue 'loop_,
                        };
                        // `None`: a symlink. `O_NONBLOCK`: a FIFO without a reader does not block.
                        #[cfg(not(windows))]
                        let existing = match destination.open_existing(
                            ZStr::from_slice_with_nul(&normalized_buf[..=normalized_len]),
                            bun_sys::O::WRONLY | bun_sys::O::NONBLOCK,
                        ) {
                            Ok(existing) => existing,
                            Err(_) => continue 'loop_,
                        };
                        // A symlink conflicts too: the extraction replaces it or stops at it.
                        let conflicts = match existing {
                            Some(opened) => {
                                let _close_guard = scopeguard::guard(opened, |fd| fd.close());
                                bun_sys::get_file_size(opened)? > 0
                            }
                            None => true,
                        };

                        if conflicts {
                            let is_already_top_level = dirname.is_empty();
                            let path_to_use_: &[u8] = 'brk: {
                                let __pathname: &[u8] = pathname;

                                if is_already_top_level {
                                    break 'brk __pathname;
                                }

                                let index = strings::index_of_char_usize(__pathname, SEP).unwrap();
                                break 'brk &__pathname[..index];
                            };
                            let mut temp_buf = [0u8; 1024];
                            temp_buf[..path_to_use_.len()].copy_from_slice(path_to_use_);
                            let path_to_use: &[u8] = if !is_already_top_level {
                                temp_buf[path_to_use_.len()] = SEP;
                                &temp_buf[..path_to_use_.len() + 1]
                            } else {
                                &temp_buf[..path_to_use_.len()]
                            };

                            let overwrite_entry = ctx.overwrite_list.get_or_put(path_to_use)?;
                            if !overwrite_entry.found_existing {
                                *overwrite_entry.key_ptr = Box::from(appender.append(path_to_use)?);
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    pub fn extract_to_dir<A: ArchiveAppender>(
        file_buffer: &[u8],
        dir: Fd,
        ctx: Option<&mut Context>,
        appender: &mut A,
        options: ExtractOptions,
    ) -> crate::Result<u32> {
        let mut entry: *mut lib::Entry = ptr::null_mut();

        // SAFETY: `file_buffer` outlives `stream` (stack-local, dropped at fn exit).
        let mut stream = unsafe { BufferReadStream::init(file_buffer) };
        let _ = stream.open_read();
        let archive = stream.archive;
        let mut count: u32 = 0;
        let dir_fd = dir;

        // reshaped for borrowck — ctx is Option<&mut>, rebound as needed
        let mut ctx = ctx;

        #[cfg(unix)]
        let mut symlink_join_buf: Option<bun_paths::path_buffer_pool::Guard> = None;

        #[cfg(unix)]
        let mut deferred_symlinks: Vec<DeferredSymlink> = Vec::new();

        #[cfg(not(windows))]
        let mut contained = match options.destination {
            DestinationKind::CallerProvided => Some(ContainedDir::new(dir_fd)),
            DestinationKind::PrivateFresh => None,
        };

        let mut normalized_buf = bun_paths::os_path_buffer_pool::get();
        let mut use_pwrite = cfg!(unix);
        let mut use_lseek = true;

        'loop_: loop {
            // SAFETY: archive valid for stream lifetime
            let r = unsafe { (*archive).read_next_header(&mut entry) };

            match r {
                lib::Result::Eof => break 'loop_,
                lib::Result::Retry => continue 'loop_,
                lib::Result::Failed | lib::Result::Fatal => {
                    return Err(crate::Error::Fail);
                }
                _ => {
                    // TODO:
                    // Due to path separator replacement and other copies that happen internally, libarchive changes the
                    // storage type of paths on windows to wide character strings. Using `archive_entry_pathname` or `archive_entry_pathname_utf8`
                    // on an wide character string will return null if there are non-ascii characters.
                    // (this can be seen by installing @fastify/send, which has a path "@fastify\send\test\fixtures\snow ☃")
                    //
                    // Ideally, we find a way to tell libarchive to not convert the strings to wide characters and also to not
                    // replace path separators. We can do both of these with our own normalization and utf8/utf16 string conversion code.
                    // SAFETY: entry was just populated by read_next_header
                    #[cfg(windows)]
                    let pathname_z = lib::Entry::opaque_ref(entry).pathname_w();
                    // SAFETY: entry was just populated by read_next_header
                    #[cfg(not(windows))]
                    let pathname_z = lib::Entry::opaque_ref(entry).pathname();

                    if A::HAS_ON_FIRST_DIRECTORY_NAME {
                        if appender.needs_first_dirname() {
                            #[cfg(windows)]
                            {
                                let result = strings::to_utf8_list_with_type(
                                    Vec::new(),
                                    pathname_z.as_slice(),
                                )?;
                                // onFirstDirectoryName copies the contents of pathname to another buffer, safe to free
                                appender.on_first_directory_name(strings::without_trailing_slash(
                                    &result,
                                ));
                            }
                            #[cfg(not(windows))]
                            {
                                appender.on_first_directory_name(strings::without_trailing_slash(
                                    pathname_z.as_bytes(),
                                ));
                            }
                        }
                    }

                    // SAFETY: entry valid
                    let kind = bun_sys::kind_from_mode(lib::Entry::opaque_ref(entry).filetype());

                    if options.npm {
                        // - ignore entries other than files (`true` can only be returned if type is file)
                        //   https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L419-L441
                        if kind != bun_sys::FileKind::File {
                            continue;
                        }

                        // TODO: .npmignore, or .gitignore if it doesn't exist
                        // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L434
                    }

                    // strip and normalize the path
                    // `pathname_z` is `&ZStr` on POSIX (`as_bytes() → &[u8]`)
                    // and `&WStr` on Windows (`as_slice() → &[u16]`); both
                    // deref to `&[OSPathChar]`.
                    let pathname_slice: &[OSPathChar] = &pathname_z[..];
                    let mut remaining: &[OSPathChar] = pathname_slice;
                    {
                        let sep: OSPathChar = b'/' as OSPathChar;
                        let mut i = 0usize;
                        while i < options.depth_to_skip {
                            while let [first, rest @ ..] = remaining {
                                if *first == sep {
                                    remaining = rest;
                                } else {
                                    break;
                                }
                            }
                            if remaining.is_empty() {
                                continue 'loop_;
                            }
                            match strings::index_of_scalar(remaining, sep) {
                                Some(j) => remaining = &remaining[j..],
                                None => remaining = &remaining[remaining.len()..],
                            }
                            i += 1;
                        }
                        while let [first, rest @ ..] = remaining {
                            if *first == sep {
                                remaining = rest;
                            } else {
                                break;
                            }
                        }
                    }
                    // pathname = rest.ptr[0..rest.len :0]  (NUL is at original buffer end)
                    // SAFETY: `remaining` is a tail slice of `pathname_z`, which is NUL-terminated
                    // at its original `.len()`; therefore `remaining[remaining.len()] == 0`.
                    let pathname: &[OSPathChar] = remaining;

                    if pathname.len() >= normalized_buf.len() {
                        if options.log {
                            bun_core::warn!(
                                "Skipping entry with a path longer than the maximum path length: {}\n",
                                bun_core::fmt::fmt_os_path(pathname, Default::default()),
                            );
                        }
                        continue;
                    }

                    let normalized = bun_paths::resolve_path::normalize_buf_t::<
                        OSPathChar,
                        bun_paths::platform::Auto,
                    >(pathname, &mut normalized_buf[..]);
                    let normalized_len = normalized.len();
                    normalized_buf[normalized_len] = 0;
                    // SAFETY: we just wrote a NUL at normalized_buf[normalized_len]
                    let path: &mut [OSPathChar] = &mut normalized_buf[..normalized_len];
                    if path.is_empty() || (path.len() == 1 && path[0] == b'.' as OSPathChar) {
                        continue;
                    }

                    // Skip entries whose normalized path is absolute on Windows.
                    // `openatWindows` ignores `dir_fd` for absolute inputs (drive
                    // letter or UNC), so without this guard a tar entry could
                    // resolve outside the extraction directory. On POSIX the
                    // tokenize-on-'/' step already strips any leading separators,
                    // so `normalizeBufT` cannot produce an absolute output.
                    #[cfg(windows)]
                    {
                        if bun_paths::is_absolute_windows_t::<u16>(path) {
                            continue 'loop_;
                        }
                    }

                    #[cfg(windows)]
                    if options.npm {
                        // When writing files on Windows, translate the characters to their
                        // 0xf000 higher-encoded versions.
                        // https://github.com/isaacs/node-tar/blob/0510c9ea6d000c40446d56674a7efeec8e72f052/lib/winchars.js
                        let mut remain: &mut [OSPathChar] = path;
                        if strings::starts_with_windows_drive_letter_t::<OSPathChar>(remain) {
                            // don't encode `:` from the drive letter
                            // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/tar/lib/unpack.js#L327
                            remain = &mut remain[2..];
                        }

                        for ch in remain.iter_mut() {
                            match *ch {
                                c if c == b'|' as OSPathChar
                                    || c == b'<' as OSPathChar
                                    || c == b'>' as OSPathChar
                                    || c == b'?' as OSPathChar
                                    || c == b':' as OSPathChar =>
                                {
                                    *ch += 0xf000;
                                }
                                _ => {}
                            }
                        }
                    }

                    let path_slice: &[OSPathChar] = &path[..];

                    if options.log {
                        bun_core::prettyln!(
                            " {}",
                            bun_core::fmt::fmt_os_path(path_slice, Default::default())
                        );
                    }

                    // SAFETY: normalized_buf[path_slice.len()] == 0 (written above),
                    // so path_slice is a NUL-terminated [:0]u8.
                    #[cfg(not(windows))]
                    let path_z: &ZStr =
                        unsafe { ZStr::from_raw(path_slice.as_ptr(), path_slice.len()) };

                    count += 1;

                    match kind {
                        bun_sys::FileKind::Directory => {
                            #[cfg(windows)]
                            {
                                make_path_u16(dir, path_slice)?;
                            }
                            #[cfg(not(windows))]
                            {
                                // SAFETY: entry valid
                                let mode = directory_mode(lib::Entry::opaque_ref(entry).perm());
                                let made = match &mut contained {
                                    None => bun_sys::mkdirat_z(dir_fd, path_z, mode),
                                    Some(destination) => {
                                        // The mode of the retry below: 0o755 if the name ends in `/`.
                                        let retry = if path_slice.ends_with(b"/") {
                                            0o755
                                        } else {
                                            0o777
                                        };
                                        let mode =
                                            |parent_made| if parent_made { retry } else { mode };
                                        match destination.make_dir(path_z, mode) {
                                            Ok(Some(())) => Ok(()),
                                            Ok(None) => {
                                                return Err(link_in_the_way(
                                                    path_slice,
                                                    options.log,
                                                ));
                                            }
                                            Err(err) => Err(err),
                                        }
                                    }
                                };
                                match made {
                                    Ok(()) => {}
                                    Err(err) => {
                                        // It's possible for some tarballs to return a directory twice, with and
                                        // without `./` in the beginning. So if it already exists, continue to the
                                        // next entry.
                                        match err.get_errno() {
                                            bun_sys::E::EEXIST | bun_sys::E::ENOTDIR => continue,
                                            _ => {}
                                        }
                                        let dirname = bun_paths::dirname_simple(path_slice);
                                        if dirname.is_empty() || contained.is_some() {
                                            return Err(err.into());
                                        }
                                        let _ = dir.make_path_u8(dirname);
                                        let _ = bun_sys::mkdirat_z(dir_fd, path_z, 0o777);
                                    }
                                }
                            }
                        }
                        bun_sys::FileKind::SymLink => {
                            // SAFETY: entry valid
                            let link_target = lib::Entry::opaque_ref(entry).symlink();
                            #[cfg(unix)]
                            {
                                // Validate that the symlink target doesn't escape the extraction directory.
                                // This prevents path traversal attacks where a malicious tarball creates a symlink
                                // pointing outside (e.g., to /tmp), then writes files through that symlink.
                                if !is_symlink_target_safe(
                                    path_slice,
                                    link_target,
                                    &mut symlink_join_buf,
                                ) {
                                    // Skip symlinks that would escape the extraction directory
                                    if options.log {
                                        bun_core::warn!(
                                            "Skipping symlink with unsafe target: {} -> {}\n",
                                            bun_core::fmt::fmt_os_path(
                                                path_slice,
                                                Default::default(),
                                            ),
                                            bstr::BStr::new(link_target.as_bytes()),
                                        );
                                    }
                                    continue;
                                }
                                deferred_symlinks
                                    .push(DeferredSymlink::new(path_slice, link_target.as_bytes()));
                            }
                            #[cfg(not(unix))]
                            {
                                let _ = link_target;
                            }
                        }
                        bun_sys::FileKind::File => {
                            // first https://github.com/npm/cli/blob/feb54f7e9a39bd52519221bae4fafc8bc70f235e/node_modules/pacote/lib/fetcher.js#L65-L66
                            // this.fmode = opts.fmode || 0o666
                            //
                            // then https://github.com/npm/cli/blob/feb54f7e9a39bd52519221bae4fafc8bc70f235e/node_modules/pacote/lib/fetcher.js#L402-L411
                            //
                            // we simplify and turn it into `entry.mode || 0o666` because we aren't accepting a umask or fmask option.
                            #[cfg(not(windows))]
                            let mode: bun_sys::Mode = bun_sys::Mode::try_from(
                                // SAFETY: entry valid
                                (lib::Entry::opaque_ref(entry).perm() & 0o777) | 0o666,
                            )
                            .unwrap();

                            let flags = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;

                            #[cfg(windows)]
                            let file_handle_native: Fd =
                                match bun_sys::openat_windows(dir_fd, path_slice, flags, 0) {
                                    Ok(fd) => fd,
                                    Err(e) => match e.get_errno() {
                                        bun_sys::E::EPERM | bun_sys::E::ENOENT => {
                                            // `Dirname::dirname` strips
                                            // trailing separators.
                                            let Some(dirname) =
                                                bun_paths::Dirname::dirname(path_slice)
                                            else {
                                                return Err(e.into());
                                            };
                                            let _ = make_path_u16(dir, dirname);
                                            bun_sys::openat_windows(dir_fd, path_slice, flags, 0)?
                                        }
                                        _ => return Err(e.into()),
                                    },
                                };

                            #[cfg(not(windows))]
                            let file_handle_native: Fd = match &mut contained {
                                Some(destination) => match destination.create_file(path_z, mode)? {
                                    Some(fd) => fd,
                                    None => return Err(link_in_the_way(path_slice, options.log)),
                                },
                                // dir.createFileZ(.{truncate, mode}) → bun_sys::openat
                                None => match bun_sys::openat(dir_fd, path_z, flags, mode) {
                                    Ok(fd) => fd,
                                    Err(err) => match err.get_errno() {
                                        bun_sys::E::EACCES
                                        | bun_sys::E::EPERM
                                        | bun_sys::E::ENOENT => {
                                            let dirname = bun_paths::dirname_simple(path_slice);
                                            if dirname.is_empty() {
                                                return Err(err.into());
                                            }
                                            let _ = dir.make_path_u8(dirname);
                                            bun_sys::openat(dir_fd, path_z, flags, mode)?
                                        }
                                        _ => return Err(err.into()),
                                    },
                                },
                            };

                            let file_handle: Fd = {
                                // errdefer file_handle_native.close()
                                let guard = scopeguard::guard(file_handle_native, |fd| {
                                    fd.close();
                                });
                                let owned = (*guard).make_lib_uv_owned()?;
                                scopeguard::ScopeGuard::into_inner(guard);
                                owned
                            };

                            // reshaped for borrowck — `plucked_file` is captured by
                            // the guard tuple; mutate via close_guard.1.
                            let mut close_guard =
                                scopeguard::guard((file_handle, false), |(fh, plucked)| {
                                    if options.close_handles && !plucked {
                                        // On windows, AV hangs these closes really badly.
                                        // 'bun i @mui/icons-material' takes like 20 seconds to extract
                                        // mostly spend on waiting for things to close closing
                                        //
                                        // Using Async.Closer defers closing the file to a different thread,
                                        // which can make the NtSetInformationFile call fail.
                                        //
                                        // Using async closing doesnt actually improve end user performance
                                        // probably because our process is still waiting on AV to do it's thing.
                                        //
                                        // But this approach does not actually solve the problem, it just
                                        // defers the close to a different thread. And since we are already
                                        // on a worker thread, that doesn't help us.
                                        fh.close();
                                    }
                                });
                            let (file_handle, plucked_file) = &mut *close_guard;

                            // SAFETY: entry valid
                            let size: usize =
                                usize::try_from(lib::Entry::opaque_ref(entry).size().max(0))
                                    .unwrap();

                            if size > 0 {
                                if let Some(ctx_) = ctx.as_deref_mut() {
                                    let h: u64 = if !ctx_.pluckers.is_empty() {
                                        hash(slice_as_bytes(path_slice))
                                    } else {
                                        0u64
                                    };

                                    for plucker_ in ctx_.pluckers.iter_mut() {
                                        if plucker_.filename_hash == h {
                                            plucker_.contents.inflate(size)?;
                                            let cap = plucker_.contents.list.capacity();
                                            plucker_.contents.list.resize(cap, 0);
                                            // SAFETY: archive valid
                                            let read = unsafe {
                                                (*archive).read_data(
                                                    plucker_.contents.list.as_mut_slice(),
                                                )
                                            };
                                            if read < 0 {
                                                if options.log {
                                                    // SAFETY: `archive` is the live
                                                    // `read_new()` handle this
                                                    // extraction loop is iterating.
                                                    let archive_error = slice_to_nul(
                                                        unsafe { &*archive }.error_string(),
                                                    );
                                                    Output::err(
                                                        "libarchive error",
                                                        "extracting {}: {}",
                                                        (
                                                            bun_core::fmt::fmt_os_path(
                                                                path_slice,
                                                                Default::default(),
                                                            ),
                                                            bstr::BStr::new(archive_error),
                                                        ),
                                                    );
                                                }
                                                return Err(crate::Error::Fail);
                                            }
                                            plucker_.contents.inflate(
                                                usize::try_from(read).expect("int cast"),
                                            )?;
                                            plucker_.found = read > 0;
                                            plucker_.fd = *file_handle;
                                            *plucked_file = true;
                                            continue 'loop_;
                                        }
                                    }
                                }
                                // archive_read_data_into_fd reads in chunks of 1 MB
                                // #define    MAX_WRITE    (1024 * 1024)
                                #[cfg(any(target_os = "linux", target_os = "android"))]
                                {
                                    if size > 1_000_000 {
                                        let _ = bun_sys::preallocate_file(
                                            file_handle.native(),
                                            0,
                                            i64::try_from(size).expect("int cast"),
                                        );
                                    }
                                }

                                let mut retries_remaining: u8 = 5;

                                'possibly_retry: while retries_remaining != 0 {
                                    // SAFETY: archive valid
                                    match unsafe {
                                        (*archive).read_data_into_fd(
                                            *file_handle,
                                            &mut use_pwrite,
                                            &mut use_lseek,
                                        )
                                    } {
                                        lib::Result::Eof => break 'loop_,
                                        lib::Result::Ok => break 'possibly_retry,
                                        lib::Result::Retry => {
                                            if options.log {
                                                Output::err(
                                                    "libarchive error",
                                                    "extracting {}, retry {} / {}",
                                                    (
                                                        bun_core::fmt::fmt_os_path(
                                                            path_slice,
                                                            Default::default(),
                                                        ),
                                                        retries_remaining,
                                                        5,
                                                    ),
                                                );
                                            }
                                        }
                                        _ => {
                                            if options.log {
                                                // SAFETY: `archive` is the live
                                                // `read_new()` handle this
                                                // extraction loop is iterating.
                                                let archive_error = slice_to_nul(
                                                    unsafe { &*archive }.error_string(),
                                                );
                                                Output::err(
                                                    "libarchive error",
                                                    "extracting {}: {}",
                                                    (
                                                        bun_core::fmt::fmt_os_path(
                                                            path_slice,
                                                            Default::default(),
                                                        ),
                                                        bstr::BStr::new(archive_error),
                                                    ),
                                                );
                                            }
                                            return Err(crate::Error::Fail);
                                        }
                                    }
                                    retries_remaining -= 1;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        // Its descriptors are free for the directories of the symlinks.
        #[cfg(not(windows))]
        drop(contained);

        #[cfg(unix)]
        create_deferred_symlinks(dir_fd, &deferred_symlinks, options.log)?;

        Ok(count)
    }

    pub fn extract_to_disk<A: ArchiveAppender>(
        file_buffer: &[u8],
        root: &[u8],
        ctx: Option<&mut Context>,
        appender: &mut A,
        options: ExtractOptions,
    ) -> crate::Result<u32> {
        let dir: Fd = 'brk: {
            let cwd = Fd::cwd();
            let _ = cwd.make_path_u8(root);

            if bun_paths::is_absolute(root) {
                break 'brk bun_sys::open_dir_absolute(root)?;
            } else {
                break 'brk bun_sys::open_dir_at(cwd, root)?;
            }
        };

        let _close_guard = scopeguard::guard(dir, |d| {
            if options.close_handles {
                d.close();
            }
        });

        Self::extract_to_dir(file_buffer, dir, ctx, appender, options)
    }
}
