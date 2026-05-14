// @link "../deps/libarchive.a"
#![allow(unused, dead_code, clippy::all)]
#![warn(unused_must_use)]
// ──────────────────────────────────────────────────────────────────────────
// Phase D: libarchive FFI surface is fully wired. Thin `extern "C"` wrappers
// over the C library live in `mod lib` below; higher-level extraction logic
// (`Archiver`, `BufferReadStream`) sits on top and uses `bun_sys` for I/O.
// ──────────────────────────────────────────────────────────────────────────
#![warn(unreachable_pub)]
use core::ffi::{c_char, c_int, c_void};
use core::ptr;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{self as bun_str, MutableString, slice_to_nul, strings};
use bun_core::{Output, ZStr, slice_as_bytes};
use bun_paths::{self as path, OSPathBuffer, OSPathChar, PathBuffer, SEP, SEP_STR};
use bun_sys::{self, Fd, FdExt};
use bun_wyhash::hash;

// ──────────────────────────────────────────────────────────────────────────
// Local libarchive C-API surface. Thin safe(ish) wrappers over the raw
// `extern "C"` libarchive symbols, ported 1:1 from
// `src/libarchive_sys/bindings.zig`. The opaque `Archive` / `Entry` types
// here are layout-compatible with libarchive's `struct archive` /
// `struct archive_entry` (zero-sized, `#[repr(C)]`, !Unpin).
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types)]
pub mod lib {
    use super::*;
    use core::ffi::{c_char, c_int, c_long, c_uint, c_void};

    pub type la_ssize_t = isize;
    pub type la_int64_t = i64;
    type time_t = isize;

    /// Opaque libarchive `struct archive`. Always used behind `*mut Archive`.
    /// Contains `UnsafeCell` so that `&Archive` does not assert immutability
    /// (libarchive mutates through every call), making `&self -> *mut Self`
    /// sound under Stacked Borrows.
    bun_opaque::opaque_ffi! {
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

    // ── raw libarchive C FFI ───────────────────────────────────────────────
    // Signatures match `vendor/libarchive/archive.h` /
    // `src/libarchive_sys/bindings.zig` exactly. `Result` is `#[repr(i32)]`
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
        fn archive_entry_pathname_utf8(e: *mut Entry) -> *const c_char;
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
            // Use a runtime memset (vs `[0u8; _]`) to keep .rodata small,
            // matching the Zig (`@memset(&zero_buf, 0)`).
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
        pub fn read_data_into_fd(
            &self,
            fd: Fd,
            can_use_pwrite: &mut bool,
            can_use_lseek: &mut bool,
        ) -> Result {
            let mut target_offset: i64 = 0; // Updated by archive.next() — where this block should be written
            let mut actual_offset: i64 = 0; // Where we've actually written to (for write() path)
            let mut final_offset: i64 = 0; // Furthest point the file must extend to
            let file = bun_sys::File { handle: fd };

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
                                bun_core::output::debug_warn(
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
                            let zero_result = Self::write_zeros_to_file(&file, zero_count);
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

        pub fn error_string(this: *mut Archive) -> &'static [u8] {
            // SAFETY: `this` came from archive_{read,write}_new().
            let p = unsafe { archive_error_string(this) };
            if p.is_null() {
                return b"";
            }
            // SAFETY: libarchive owns the error string for the lifetime of the
            // archive; callers treat it as borrowed-until-next-call. The
            // `'static` here mirrors Zig's `[]const u8` — caller must not
            // outlive the archive (same as the Zig API).
            unsafe { ZStr::from_c_ptr(p) }.as_bytes()
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
        pub fn pathname_utf8(&self) -> &ZStr {
            // SAFETY: self valid.
            unsafe { ZStr::from_c_ptr(archive_entry_pathname_utf8(self.as_mut_ptr())) }
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
        pub fn new() -> *mut Entry {
            // SAFETY: FFI call with no preconditions.
            unsafe { archive_entry_new() }
        }
        /// `archive_entry_new2(archive)` — ties the entry to the archive's
        /// charset-conversion context (preferred over `new()` when an archive
        /// is available).
        pub fn new2(archive: *mut Archive) -> *mut Entry {
            // SAFETY: `archive` came from `Archive::read_new()`/`write_new()`.
            unsafe { archive_entry_new2(archive) }
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
        /// charset conversion). Matches Zig's `setPathname` on POSIX.
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
        #[inline]
        pub fn as_ptr(&self) -> *mut Archive {
            self.0.as_ptr()
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
        #[inline]
        pub fn as_ptr(&self) -> *mut Archive {
            self.0.as_ptr()
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
        #[inline]
        pub fn new2(archive: *mut Archive) -> Self {
            Self(
                core::ptr::NonNull::new(Entry::new2(archive))
                    .expect("archive_entry_new2 returned null"),
            )
        }
        #[inline]
        pub fn as_ptr(&self) -> *mut Entry {
            self.0.as_ptr()
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

    // ── Archive::Iterator (port of `libarchive_sys/bindings.zig` Iterator) ─
    //
    // Thin streaming reader over a tar.gz blob: `init` opens the archive in
    // memory, `next` yields one header at a time, `read_entry_data` slurps the
    // current entry's payload, `close` tears down. Errors are surfaced as the
    // libarchive `*mut Archive` plus a static message so callers can append
    // `Archive::error_string`.

    /// Generic result type used by [`ArchiveIterator`] (Zig: `Iterator.Result(T)`).
    pub enum IteratorResult<T> {
        Err {
            archive: *mut Archive,
            message: &'static [u8],
        },
        Result(T),
    }

    impl<T> IteratorResult<T> {
        #[inline]
        pub fn init_err(arch: *mut Archive, msg: &'static [u8]) -> Self {
            Self::Err {
                message: msg,
                archive: arch,
            }
        }
        #[inline]
        pub fn init_res(value: T) -> Self {
            Self::Result(value)
        }
    }

    /// Port of `Archive.Iterator` (src/libarchive_sys/bindings.zig).
    pub struct ArchiveIterator {
        pub archive: *mut Archive,
        // Zig: `std.EnumSet(std.fs.File.Kind)`; mapped to a u16 bitmask over
        // `bun_sys::FileKind` variants.
        pub filter: u16,
    }

    /// One entry returned from [`ArchiveIterator::next`].
    pub struct NextEntry {
        pub entry: *mut Entry,
        pub kind: bun_sys::FileKind,
    }

    impl ArchiveIterator {
        /// Borrow the underlying libarchive handle.
        ///
        /// SAFETY (invariant): `self.archive` is set to a fresh non-null
        /// handle by `Archive::read_new()` in [`init`] and remains valid
        /// until `read_free()` in [`close`]. All `Archive` methods take
        /// `&self` (FFI interior mutability), so a shared borrow suffices.
        #[inline]
        fn archive(&self) -> &Archive {
            // SAFETY: see doc comment — non-null for the lifetime of `self`.
            unsafe { &*self.archive }
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
                    Result::Ok => {
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

        /// Port of `Iterator.deinit` — Zig returned `Result(void)`, so this
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
        /// Port of `Iterator.NextEntry.readEntryData`.
        pub fn read_entry_data(
            &self,
            archive: *mut Archive,
        ) -> core::result::Result<IteratorResult<Box<[u8]>>, bun_core::OOM> {
            // SAFETY: self.entry is the libarchive-owned entry from read_next_header.
            let size = unsafe { (*self.entry).size() };
            if size < 0 || size > 64 * 1024 * 1024 {
                return Ok(IteratorResult::init_err(
                    archive,
                    b"invalid archive entry size",
                ));
            }
            let mut buf = vec![0u8; usize::try_from(size).expect("int cast")];
            // SAFETY: archive is valid for the lifetime of the iterator.
            let read = unsafe { &*archive }.read_data(&mut buf);
            if read < 0 {
                return Ok(IteratorResult::init_err(
                    archive,
                    b"failed to read archive data",
                ));
            }
            buf.truncate(usize::try_from(read).expect("int cast"));
            Ok(IteratorResult::init_res(buf.into_boxed_slice()))
        }
    }

    // ── write-open callback surface (libarchive `archive_write_open2`) ─────
    pub type archive_open_callback = unsafe extern "C" fn(*mut Archive, *mut c_void) -> c_int;
    pub type archive_read_callback =
        unsafe extern "C" fn(*mut Archive, *mut c_void, *mut *const c_void) -> la_ssize_t;
    pub type archive_write_callback =
        unsafe extern "C" fn(*mut Archive, *mut c_void, *const c_void, usize) -> la_ssize_t;
    pub type archive_close_callback = unsafe extern "C" fn(*mut Archive, *mut c_void) -> c_int;
    pub type archive_free_callback = unsafe extern "C" fn(*mut Archive, *mut c_void) -> c_int;

    pub fn archive_write_open2(
        a: *mut Archive,
        client_data: *mut c_void,
        open: Option<archive_open_callback>,
        write: Option<archive_write_callback>,
        close: Option<archive_close_callback>,
        free: Option<archive_free_callback>,
    ) -> c_int {
        // SAFETY: `a` came from archive_write_new(); callbacks have correct
        // ABI; client_data lifetime is caller's responsibility.
        unsafe { archive_write_open2_raw(a, client_data, open, write, close, free) }
    }

    /// Growing memory buffer for archive writes with libarchive callbacks.
    pub struct GrowingBuffer {
        pub list: Vec<u8>,
        pub had_error: bool,
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
    // Port of `Archive.Iterator` (src/libarchive_sys/bindings.zig). Thin
    // wrapper that opens a tarball from memory and yields one
    // `IteratorEntry` per `next()`, used by `bun publish <tarball>`.

    /// Port of `Iterator.Result(T).err` payload.
    pub struct IteratorError {
        pub archive: *mut Archive,
        pub message: &'static [u8],
    }
    impl IteratorError {
        #[inline]
        pub fn error_string(&self) -> &[u8] {
            Archive::error_string(self.archive)
        }
    }
    /// `Iterator.Result(T)` for the std-`Result`-shaped iterator below. Named
    /// distinctly from the legacy `IteratorResult` enum higher in this module
    /// (kept for `ArchiveIterator`); callers of `Iterator` use this alias.
    pub type IterResult<T> = core::result::Result<T, IteratorError>;

    /// Port of `Iterator.NextEntry` (bindings.zig).
    pub struct IteratorEntry {
        pub entry: *mut Entry,
        pub kind: bun_sys::FileKind,
    }
    impl IteratorEntry {
        /// Borrow the libarchive entry. Valid until the next `next()` call.
        #[inline]
        pub fn entry(&self) -> &Entry {
            // SAFETY: `entry` was just written by `archive_read_next_header`;
            // libarchive guarantees it stays valid until the next header read.
            unsafe { &*self.entry }
        }
        /// Port of `NextEntry.readEntryData` (bindings.zig). Allocates `size`
        /// bytes and reads the current entry's data into it.
        pub fn read_entry_data(
            &self,
            archive: *mut Archive,
        ) -> core::result::Result<IterResult<Vec<u8>>, bun_core::OOM> {
            let size = self.entry().size();
            if size < 0 || size > 64 * 1024 * 1024 {
                return Ok(Err(IteratorError {
                    archive,
                    message: b"invalid archive entry size",
                }));
            }
            let mut buf = vec![0u8; usize::try_from(size).expect("int cast")];
            // SAFETY: `archive` came from `Archive::read_new()`.
            let read = unsafe { &*archive }.read_data(&mut buf);
            if read < 0 {
                return Ok(Err(IteratorError {
                    archive,
                    message: b"failed to read archive data",
                }));
            }
            buf.truncate(usize::try_from(read).expect("int cast"));
            Ok(Ok(buf))
        }
    }

    /// Port of `Archive.Iterator` (src/libarchive_sys/bindings.zig).
    pub struct Iterator {
        pub archive: *mut Archive,
        // PORT NOTE: Zig had a `filter: std.EnumSet(std.fs.File.Kind)` field
        // that every caller leaves at `.initEmpty()` and never sets. Dropped
        // here (would need `EnumSetType` on `FileKind`); re-add if a caller
        // ever needs it.
    }
    impl Iterator {
        /// Borrow the underlying libarchive handle.
        ///
        /// SAFETY (invariant): `self.archive` is set to a fresh non-null
        /// handle by `Archive::read_new()` in [`init`] and remains valid
        /// until `read_free()` in [`deinit`]. All `Archive` methods take
        /// `&self` (FFI interior mutability), so a shared borrow suffices.
        #[inline]
        fn archive(&self) -> &Archive {
            // SAFETY: see doc comment — non-null for the lifetime of `self`.
            unsafe { &*self.archive }
        }

        /// Port of `Iterator.init` (bindings.zig). Opens `tarball_bytes` as a
        /// gzip-compressed (gnu)tar archive.
        pub fn init(tarball_bytes: &[u8]) -> IterResult<Self> {
            let archive = Archive::read_new();
            // SAFETY: `archive` is a fresh non-null `*mut Archive`.
            let a = unsafe { &*archive };

            match a.read_support_format_tar() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return Err(IteratorError {
                        archive,
                        message: b"failed to enable tar format support",
                    });
                }
                _ => {}
            }
            match a.read_support_format_gnutar() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return Err(IteratorError {
                        archive,
                        message: b"failed to enable gnutar format support",
                    });
                }
                _ => {}
            }
            match a.read_support_filter_gzip() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return Err(IteratorError {
                        archive,
                        message: b"failed to enable support for gzip compression",
                    });
                }
                _ => {}
            }
            match a.read_set_options(c"read_concatenated_archives") {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return Err(IteratorError {
                        archive,
                        message: b"failed to set option `read_concatenated_archives`",
                    });
                }
                _ => {}
            }
            match a.read_open_memory(tarball_bytes) {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return Err(IteratorError {
                        archive,
                        message: b"failed to read tarball",
                    });
                }
                _ => {}
            }

            Ok(Iterator { archive })
        }

        /// Port of `Iterator.next` (bindings.zig).
        pub fn next(&mut self) -> IterResult<Option<IteratorEntry>> {
            let a = self.archive();
            let mut entry: *mut Entry = core::ptr::null_mut();
            loop {
                match a.read_next_header(&mut entry) {
                    Result::Retry => continue,
                    Result::Eof => return Ok(None),
                    Result::Ok => {
                        let kind = bun_sys::kind_from_mode(
                            Entry::opaque_ref(entry).filetype() as bun_sys::Mode
                        );
                        return Ok(Some(IteratorEntry { entry, kind }));
                    }
                    _ => {
                        return Err(IteratorError {
                            archive: self.archive,
                            message: b"failed to read archive header",
                        });
                    }
                }
            }
        }

        /// Port of `Iterator.deinit` (bindings.zig). Closes & frees the
        /// underlying `*mut Archive`. NOT a `Drop` impl because the Zig
        /// returns a `Result` the caller inspects for error reporting.
        pub fn deinit(&mut self) -> IterResult<()> {
            let a = self.archive();
            match a.read_close() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return Err(IteratorError {
                        archive: self.archive,
                        message: b"failed to close archive read",
                    });
                }
                _ => {}
            }
            match a.read_free() {
                Result::Failed | Result::Fatal | Result::Warn => {
                    return Err(IteratorError {
                        archive: self.archive,
                        message: b"failed to free archive read",
                    });
                }
                _ => {}
            }
            Ok(())
        }
    }
}

use lib::Archive;

#[repr(i32)] // c_int
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Seek {
    // values are POSIX SEEK_SET/CUR/END constants
    Set = 0,
    Current = 1,
    End = 2,
}

pub struct BufferReadStream {
    // TODO(port): lifetime — `buf` is borrowed for the stream's lifetime (callers
    // construct on stack, init, defer deinit). Stored as raw fat ptr to avoid
    // a struct lifetime param in Phase A.
    buf: *const [u8],
    pos: usize,

    block_size: usize,

    archive: *mut Archive,
    reading: bool,
}

impl BufferReadStream {
    /// Construct a stream over `buf`.
    ///
    /// # Safety
    /// `buf` is type-erased to a raw `*const [u8]` (no lifetime parameter on
    /// `BufferReadStream` — see field comment / Phase-B TODO). The caller
    /// **must** guarantee that the slice `buf` points to remains valid and
    /// unmoved for the entire lifetime of the returned `BufferReadStream`
    /// (including its `Drop`). Violating this makes [`buf()`], [`buf_left()`],
    /// and [`open_read()`] dereference a dangling pointer (UB).
    pub unsafe fn init(buf: &[u8]) -> Self {
        // PORT NOTE: was an out-param constructor (`this.* = ...`)
        Self {
            buf: std::ptr::from_ref::<[u8]>(buf),
            pos: 0,
            block_size: 16384,
            archive: Archive::read_new(),
            reading: false,
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

    pub fn open_read(&mut self) -> lib::Result {
        // lib.archive_read_set_open_callback(this.archive, this.);
        // _ = lib.archive_read_set_read_callback(this.archive, archive_read_callback);
        // _ = lib.archive_read_set_seek_callback(this.archive, archive_seek_callback);
        // _ = lib.archive_read_set_skip_callback(this.archive, archive_skip_callback);
        // _ = lib.archive_read_set_close_callback(this.archive, archive_close_callback);
        // // lib.archive_read_set_switch_callback(this.archive, this.archive_s);
        // _ = lib.archive_read_set_callback_data(this.archive, this);

        let archive = self.archive();

        let _ = archive.read_support_format_tar();
        let _ = archive.read_support_format_gnutar();
        let _ = archive.read_support_filter_gzip();

        // Ignore zeroed blocks in the archive, which occurs when multiple tar archives
        // have been concatenated together.
        // Without this option, only the contents of
        // the first concatenated archive would be read.
        let _ = archive.read_set_options(c"read_concatenated_archives");

        // _ = lib.archive_read_support_filter_none(this.archive);

        let rc = archive.read_open_memory(self.buf());

        self.reading = (rc as c_int) > -1;

        // _ = lib.archive_read_support_compression_all(this.archive);

        rc
    }

    #[inline]
    pub fn buf_left(&self) -> &[u8] {
        &self.buf()[self.pos..]
    }

    #[inline]
    pub unsafe fn from_ctx(ctx: *mut c_void) -> *mut Self {
        ctx.cast::<Self>()
    }

    pub extern "C" fn archive_close_callback(_: *mut Archive, _: *mut c_void) -> c_int {
        0
    }

    pub extern "C" fn archive_read_callback(
        _: *mut Archive,
        ctx_: *mut c_void,
        buffer: *mut *const c_void,
    ) -> lib::la_ssize_t {
        // SAFETY: libarchive passes back the ctx we registered (a *mut BufferReadStream)
        let this = unsafe { bun_core::callback_ctx::<Self>(ctx_) };
        let remaining = this.buf_left();
        if remaining.is_empty() {
            return 0;
        }

        let diff = remaining.len().min(this.block_size);
        // SAFETY: buffer is a non-null out-param provided by libarchive
        unsafe { *buffer = remaining[..diff].as_ptr().cast::<c_void>() };
        this.pos += diff;
        isize::try_from(diff).expect("int cast")
    }

    pub extern "C" fn archive_skip_callback(
        _: *mut Archive,
        ctx_: *mut c_void,
        offset: lib::la_int64_t,
    ) -> lib::la_int64_t {
        // SAFETY: ctx is the *mut BufferReadStream we registered
        let this = unsafe { bun_core::callback_ctx::<Self>(ctx_) };

        let buflen = isize::try_from(this.buf().len()).expect("int cast");
        let pos = isize::try_from(this.pos).expect("int cast");

        let proposed = pos + isize::try_from(offset).expect("int cast");
        let new_pos = proposed.max(0).min(buflen - 1);
        this.pos = usize::try_from(new_pos).expect("int cast");
        (new_pos - pos) as lib::la_int64_t
    }

    pub extern "C" fn archive_seek_callback(
        _: *mut Archive,
        ctx_: *mut c_void,
        offset: lib::la_int64_t,
        whence: c_int,
    ) -> lib::la_int64_t {
        // SAFETY: ctx is the *mut BufferReadStream we registered
        let this = unsafe { bun_core::callback_ctx::<Self>(ctx_) };

        let buflen = isize::try_from(this.buf().len()).expect("int cast");
        let pos = isize::try_from(this.pos).expect("int cast");
        let offset = isize::try_from(offset).expect("int cast");

        // libarchive only ever passes SEEK_SET/CUR/END; trap on anything
        // else (matches Zig safety-checked `@enumFromInt(whence)` and the
        // diff's own convention for out-of-range bitfield decode).
        let whence = match whence {
            0 => Seek::Set,
            1 => Seek::Current,
            2 => Seek::End,
            n => unreachable!("invalid libarchive whence {n}"),
        };
        match whence {
            Seek::Current => {
                let new_pos = (pos + offset).min(buflen - 1).max(0);
                this.pos = usize::try_from(new_pos).expect("int cast");
                new_pos as lib::la_int64_t
            }
            Seek::End => {
                let new_pos = (buflen - offset).min(buflen).max(0);
                this.pos = usize::try_from(new_pos).expect("int cast");
                new_pos as lib::la_int64_t
            }
            Seek::Set => {
                let new_pos = offset.min(buflen - 1).max(0);
                this.pos = usize::try_from(new_pos).expect("int cast");
                new_pos as lib::la_int64_t
            }
        }
    }

    // pub fn archive_write_callback(
    //     archive: *Archive,
    //     ctx_: *anyopaque,
    //     buffer: *const anyopaque,
    //     len: usize,
    // ) callconv(.c) lib.la_ssize_t {
    //     var this = fromCtx(ctx_);
    // }

    // pub fn archive_close_callback(
    //     archive: *Archive,
    //     ctx_: *anyopaque,
    // ) callconv(.c) c_int {
    //     var this = fromCtx(ctx_);
    // }
    // pub fn archive_free_callback(
    //     archive: *Archive,
    //     ctx_: *anyopaque,
    // ) callconv(.c) c_int {
    //     var this = fromCtx(ctx_);
    // }

    // pub fn archive_switch_callback(
    //     archive: *Archive,
    //     ctx1: *anyopaque,
    //     ctx2: *anyopaque,
    // ) callconv(.c) c_int {
    //     var this = fromCtx(ctx1);
    //     var that = fromCtx(ctx2);
    // }
}

impl Drop for BufferReadStream {
    fn drop(&mut self) {
        let _ = self.archive().read_close();
        let _ = self.archive().read_free();
    }
}

/// Validates that a symlink target doesn't escape the extraction directory.
/// Returns true if the symlink is safe (target stays within extraction dir),
/// false if it would escape (e.g., via ../ traversal or absolute path).
///
/// The check works by resolving the symlink target relative to the symlink's
/// directory location using a fake root, then checking if the result stays
/// within that fake root.
fn is_symlink_target_safe(
    symlink_path: &[u8],
    link_target: &ZStr,
    symlink_join_buf: &mut Option<bun_paths::path_buffer_pool::Guard>,
) -> bool {
    // Absolute symlink targets are never safe - they could point anywhere
    let link_target_bytes = link_target.as_bytes();
    if !link_target_bytes.is_empty() && link_target_bytes[0] == b'/' {
        return false;
    }

    // Get the directory containing the symlink
    let symlink_dir = bun_paths::dirname_simple(symlink_path);

    // Use a fake root to resolve the path and check if it escapes
    let fake_root: &[u8] = b"/packages/";

    let join_buf: &mut PathBuffer =
        symlink_join_buf.get_or_insert_with(bun_paths::path_buffer_pool::get);

    let resolved = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Posix>(
        fake_root,
        &mut join_buf[..],
        &[symlink_dir, link_target_bytes],
    );

    // If the resolved path doesn't start with our fake root, it escaped
    resolved.starts_with(fake_root)
}

/// Port of `bun.MakePath.makePath(u16, dir, sub_path)` (bun.zig:2481) — the
/// Windows arm calls `makeOpenPathAccessMaskW`, which component-iterates the
/// wide path and `NtCreateFile`s each prefix with `FILE_OPEN_IF`, walking back
/// on `FileNotFound` and forward again on success. This stays in WTF-16
/// throughout (no UTF-8 round-trip — `bun_sys::make_path_w` is the *different*
/// `bun.makePathW` helper which transcodes via `from_w_path` and would lose
/// lone surrogates / skip `\??\` long-path prefixing).
#[cfg(windows)]
fn make_path_u16(dir_fd: Fd, sub_path: &[u16]) -> Result<(), bun_core::Error> {
    use bun_sys::{E, WindowsOpenDirOp, WindowsOpenDirOptions, open_dir_at_windows};
    // Match Zig's access mask (`STANDARD_RIGHTS_READ | FILE_READ_ATTRIBUTES |
    // FILE_READ_EA | SYNCHRONIZE | FILE_TRAVERSE`) by setting `read_only`,
    // and `FILE_OPEN_IF` via `OpenOrCreate`.
    let opts = WindowsOpenDirOptions {
        op: WindowsOpenDirOp::OpenOrCreate,
        read_only: true,
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
        pub all_files: EntryMap,
    }

    // TODO(port): Zig used a custom U64Context (hash = truncate u64→u32, eql = ==).
    // bun_collections::ArrayHashMap should accept a custom hasher; encode that here.
    pub type EntryMap = ArrayHashMap<u64, *mut u8>;

    pub struct U64Context;
    impl bun_collections::array_hash_map::ArrayHashAdapter<u64, u64> for U64Context {
        #[inline]
        fn hash(&self, k: &u64) -> u32 {
            *k as u32 // @truncate
        }
        #[inline]
        fn eql(&self, a: &u64, b: &u64, _: usize) -> bool {
            a == b
        }
    }

    pub struct Plucker {
        pub contents: MutableString,
        pub filename_hash: u64,
        pub found: bool,
        pub fd: Fd,
    }

    impl Plucker {
        pub fn init(
            filepath: &[OSPathChar],
            estimated_size: usize,
        ) -> Result<Plucker, bun_core::Error> {
            // TODO(port): narrow error set
            Ok(Plucker {
                contents: MutableString::init(estimated_size)?,
                filename_hash: hash(slice_as_bytes(filepath)),
                fd: Fd::INVALID,
                found: false,
            })
        }
    }

    #[derive(Clone, Copy)]
    pub struct ExtractOptions {
        pub depth_to_skip: usize,
        pub close_handles: bool,
        pub log: bool,
        pub npm: bool,
    }

    impl Default for ExtractOptions {
        fn default() -> Self {
            Self {
                depth_to_skip: 0,
                close_handles: true,
                log: false,
                npm: false,
            }
        }
    }
}

pub use archiver::{Context, ExtractOptions, Plucker};

// TODO(port): Zig used `comptime FilePathAppender: type` + `@hasDecl` duck-typing
// for `onFirstDirectoryName` / `appendMutable` / `append`. Model as a trait with
// default no-op impls; the `void` ContextType becomes `()` which uses the defaults.
pub trait ArchiveAppender {
    /// Mirrors `@hasDecl(Child, "onFirstDirectoryName")`.
    const HAS_ON_FIRST_DIRECTORY_NAME: bool = false;
    /// Mirrors `@hasDecl(Child, "appendMutable")`.
    const HAS_APPEND_MUTABLE: bool = false;

    fn needs_first_dirname(&self) -> bool {
        false
    }
    fn on_first_directory_name(&mut self, _name: &[u8]) {}

    fn append(&mut self, path: &[u8]) -> Result<&[u8], bun_core::Error> {
        let _ = path;
        unreachable!()
    }
    fn append_mutable(
        &mut self,
        path: &[OSPathChar],
    ) -> Result<&mut [OSPathChar], bun_core::Error> {
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
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut entry: *mut lib::Entry = ptr::null_mut();

        // SAFETY: `file_buffer` outlives `stream` (stack-local, dropped at fn exit).
        let mut stream = unsafe { BufferReadStream::init(file_buffer) };
        let _ = stream.open_read();
        let archive = stream.archive;

        // PORT NOTE: std.fs.Dir / openDirAbsolute / cwd().openDir — mapped to
        // bun_sys directory-fd helpers (open_dir_absolute / open_dir_at).
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
        // PORT NOTE: Zig spec also lacks `defer dir.close()` here (pre-existing leak).
        // Fd has no Drop impl; close explicitly on every return path to avoid leaking
        // a directory HANDLE on Windows. Mirrors the guard pattern in extract_to_disk.
        let _close_dir_guard = scopeguard::guard(dir, |d| d.close());

        'loop_: loop {
            // SAFETY: archive valid for stream lifetime
            let r = unsafe { (*archive).read_next_header(&mut entry) };

            match r {
                lib::Result::Eof => break 'loop_,
                lib::Result::Retry => continue 'loop_,
                lib::Result::Failed | lib::Result::Fatal => {
                    return Err(bun_core::err!("Fail"));
                }
                _ => {
                    // do not use the utf8 name there
                    // it will require us to pull in libiconv
                    // though we should probably validate the utf8 here nonetheless
                    // SAFETY: entry was just populated by read_next_header
                    let pathname_full = lib::Entry::opaque_ref(entry).pathname();
                    let pathname_bytes = pathname_full.as_bytes();

                    // TODO(port): std.mem.tokenizeScalar + .rest() — approximated by
                    // skipping DEPTH_TO_SKIP separator-delimited tokens then taking the
                    // remainder. Phase B: verify edge cases (leading/trailing seps).
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
                        match remaining.iter().position(|&b| b == SEP) {
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
                    let dirname =
                        strings::trim(bun_paths::dirname_simple(pathname), SEP_STR.as_bytes());

                    // SAFETY: entry valid
                    let size: usize =
                        usize::try_from(lib::Entry::opaque_ref(entry).size().max(0)).unwrap();
                    if size > 0 {
                        // PORT NOTE: Zig used `dir.openFile(pathname, .{ .mode = .write_only })`.
                        let Ok(opened) = bun_sys::openat_a(dir, pathname, bun_sys::O::WRONLY, 0)
                        else {
                            continue 'loop_;
                        };
                        // PORT NOTE: defer opened.close()
                        let _close_guard = scopeguard::guard(opened, |fd| fd.close());
                        // PORT NOTE: Zig `opened.getEndPos()` → bun_sys::get_file_size.
                        let stat_size = bun_sys::get_file_size(opened)?;

                        if stat_size > 0 {
                            let is_already_top_level = dirname.is_empty();
                            let path_to_use_: &[u8] = 'brk: {
                                let __pathname: &[u8] = pathname;

                                if is_already_top_level {
                                    break 'brk __pathname;
                                }

                                let index = __pathname.iter().position(|&b| b == SEP).unwrap();
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
                                // TODO(port): key ownership semantics — Zig stored the
                                // appender-owned slice as the map key. StringArrayHashMap
                                // already boxed `path_to_use` on insert; overwrite with the
                                // appender-owned bytes to match Zig lifetime intent.
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
    ) -> Result<u32, bun_core::Error> {
        // TODO(port): narrow error set
        let mut entry: *mut lib::Entry = ptr::null_mut();

        // SAFETY: `file_buffer` outlives `stream` (stack-local, dropped at fn exit).
        let mut stream = unsafe { BufferReadStream::init(file_buffer) };
        let _ = stream.open_read();
        let archive = stream.archive;
        let mut count: u32 = 0;
        let dir_fd = dir;

        // PORT NOTE: reshaped for borrowck — ctx is Option<&mut>, rebound as needed
        let mut ctx = ctx;

        let mut symlink_join_buf: Option<bun_paths::path_buffer_pool::Guard> = None;
        // (guard Drop puts the buffer back to the pool)

        let mut normalized_buf = OSPathBuffer::uninit();
        let mut use_pwrite = cfg!(unix);
        let mut use_lseek = true;

        'loop_: loop {
            // SAFETY: archive valid for stream lifetime
            let r = unsafe { (*archive).read_next_header(&mut entry) };

            match r {
                lib::Result::Eof => break 'loop_,
                lib::Result::Retry => continue 'loop_,
                lib::Result::Failed | lib::Result::Fatal => {
                    return Err(bun_core::err!("Fail"));
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
                    // TODO(port): std.mem.tokenizeScalar(OSPathChar, pathname, '/') + .rest()
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
                            match remaining.iter().position(|&c| c == sep) {
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

                    let normalized = bun_paths::resolve_path::normalize_buf_t::<
                        OSPathChar,
                        bun_paths::platform::Auto,
                    >(pathname, &mut normalized_buf[..]);
                    let normalized_len = normalized.len();
                    normalized_buf[normalized_len] = 0;
                    // SAFETY: we just wrote a NUL at normalized_buf[normalized_len]
                    let path: &mut [OSPathChar] = &mut normalized_buf[..normalized_len];
                    // TODO(port): Zig had `[:0]OSPathChar` here; the NUL is at path.len()
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

                    count += 1;

                    match kind {
                        bun_sys::FileKind::Directory => {
                            // SAFETY: entry valid
                            let mut mode = i32::try_from(lib::Entry::opaque_ref(entry).perm())
                                .expect("int cast");

                            // if dirs are readable, then they should be listable
                            // https://github.com/npm/node-tar/blob/main/lib/mode-fix.js
                            if (mode & 0o400) != 0 {
                                mode |= 0o100;
                            }
                            if (mode & 0o40) != 0 {
                                mode |= 0o10;
                            }
                            if (mode & 0o4) != 0 {
                                mode |= 0o1;
                            }

                            #[cfg(windows)]
                            {
                                // Zig: `try bun.MakePath.makePath(u16, dir, path);`
                                make_path_u16(dir, path_slice)?;
                                let _ = mode;
                            }
                            #[cfg(not(windows))]
                            {
                                // SAFETY: normalized_buf[path_slice.len()] == 0 (written above),
                                // so path_slice is a NUL-terminated [:0]u8.
                                let path_z: &ZStr = unsafe {
                                    ZStr::from_raw(path_slice.as_ptr(), path_slice.len())
                                };
                                match bun_sys::mkdirat_z(
                                    dir_fd,
                                    path_z,
                                    bun_sys::Mode::try_from(mode).expect("int cast"),
                                ) {
                                    Ok(()) => {}
                                    Err(err) => {
                                        // It's possible for some tarballs to return a directory twice, with and
                                        // without `./` in the beginning. So if it already exists, continue to the
                                        // next entry.
                                        // PORT NOTE: Zig matched error.PathAlreadyExists / error.NotDir.
                                        match err.get_errno() {
                                            bun_sys::E::EEXIST | bun_sys::E::ENOTDIR => continue,
                                            _ => {}
                                        }
                                        let dirname = bun_paths::dirname_simple(path_slice);
                                        if dirname.is_empty() {
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
                                        Output::warn(&format_args!(
                                            "Skipping symlink with unsafe target: {} -> {}\n",
                                            bun_core::fmt::fmt_os_path(
                                                path_slice,
                                                Default::default(),
                                            ),
                                            bstr::BStr::new(link_target.as_bytes()),
                                        ));
                                    }
                                    continue;
                                }
                                // SAFETY: normalized_buf[path_slice.len()] == 0 (written above),
                                // so path_slice is a NUL-terminated [:0]u8.
                                let path_z: &ZStr = unsafe {
                                    ZStr::from_raw(path_slice.as_ptr(), path_slice.len())
                                };
                                match bun_sys::symlinkat(link_target, dir_fd, path_z) {
                                    Ok(()) => {}
                                    // PORT NOTE: Zig matched error.EPERM / error.ENOENT (errnoToZigErr maps 1:1).
                                    Err(err) => match err.get_errno() {
                                        bun_sys::E::EPERM | bun_sys::E::ENOENT => {
                                            let dirname = bun_paths::dirname_simple(path_slice);
                                            if dirname.is_empty() {
                                                return Err(err.into());
                                            }
                                            let _ = dir.make_path_u8(dirname);
                                            bun_sys::symlinkat(link_target, dir_fd, path_z)?;
                                        }
                                        _ => return Err(err.into()),
                                    },
                                }
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
                            #[cfg(windows)]
                            let mode: bun_sys::Mode = 0;
                            #[cfg(not(windows))]
                            let mode: bun_sys::Mode = bun_sys::Mode::try_from(
                                // SAFETY: entry valid
                                lib::Entry::opaque_ref(entry).perm() | 0o666,
                            )
                            .unwrap();

                            let flags = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;

                            #[cfg(windows)]
                            let file_handle_native: Fd =
                                match bun_sys::openat_windows(dir_fd, path_slice, flags, 0) {
                                    Ok(fd) => fd,
                                    Err(e) => match e.get_errno() {
                                        bun_sys::E::EPERM | bun_sys::E::ENOENT => {
                                            // Zig: `bun.Dirname.dirname(u16, path_slice) orelse
                                            //        return bun.errnoToZigErr(e.errno)` —
                                            // `std.fs.path.dirnameWindows` semantics (strips
                                            // trailing separators), NOT `bun.path.dirnameW`.
                                            let Some(dirname) =
                                                bun_paths::Dirname::dirname(path_slice)
                                            else {
                                                return Err(e.into());
                                            };
                                            // Zig: `bun.MakePath.makePath(u16, dir, …) catch {};`
                                            let _ = make_path_u16(dir, dirname);
                                            bun_sys::openat_windows(dir_fd, path_slice, flags, 0)?
                                        }
                                        _ => return Err(e.into()),
                                    },
                                };

                            #[cfg(not(windows))]
                            let file_handle_native: Fd = {
                                // PORT NOTE: dir.createFileZ(.{truncate, mode}) → bun_sys::openat
                                // SAFETY: normalized_buf[path_slice.len()] == 0 (written above).
                                let path_z: &ZStr = unsafe {
                                    ZStr::from_raw(path_slice.as_ptr(), path_slice.len())
                                };
                                match bun_sys::openat(dir_fd, path_z, flags, mode) {
                                    Ok(fd) => fd,
                                    // PORT NOTE: Zig matched error.AccessDenied / error.FileNotFound.
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
                                }
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

                            // PORT NOTE: reshaped for borrowck — `plucked_file` is captured by
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

                                    if A::HAS_APPEND_MUTABLE {
                                        let result = ctx_
                                            .all_files
                                            .get_or_put_adapted(h, archiver::U64Context)
                                            .expect("unreachable");
                                        if !result.found_existing {
                                            *result.value_ptr = appender
                                                .append_mutable(path_slice)?
                                                .as_mut_ptr()
                                                .cast::<u8>();
                                        }
                                    }

                                    for plucker_ in ctx_.pluckers.iter_mut() {
                                        if plucker_.filename_hash == h {
                                            plucker_.contents.inflate(size)?;
                                            // Zig: plucker_.contents.list.expandToCapacity()
                                            let cap = plucker_.contents.list.capacity();
                                            plucker_.contents.list.resize(cap, 0);
                                            // SAFETY: archive valid
                                            let read = unsafe {
                                                (*archive).read_data(
                                                    plucker_.contents.list.as_mut_slice(),
                                                )
                                            };
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
                                #[cfg(target_os = "linux")]
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
                                                let archive_error =
                                                    slice_to_nul(Archive::error_string(archive));
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
                                            return Err(bun_core::err!("Fail"));
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

        Ok(count)
    }

    pub fn extract_to_disk<A: ArchiveAppender>(
        file_buffer: &[u8],
        root: &[u8],
        ctx: Option<&mut Context>,
        appender: &mut A,
        options: ExtractOptions,
    ) -> Result<u32, bun_core::Error> {
        // TODO(port): `options` was `comptime` in Zig — not used in a type position,
        // so demoted to runtime. // PERF(port): was comptime monomorphization — profile in Phase B
        // TODO(port): narrow error set
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

// ported from: src/libarchive/libarchive.zig
