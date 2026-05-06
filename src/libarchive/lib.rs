// @link "../deps/libarchive.a"
#![allow(unused, dead_code, clippy::all)]

// ──────────────────────────────────────────────────────────────────────────
// Phase B-2: un-gated. Phase-A draft is now compiled directly. Function
// bodies that depend on still-gated lower-tier surfaces (bun_libarchive_sys
// bindings, bun_sys directory ops) are individually re-gated with
// `// TODO(b2-blocked): ...` markers and a `todo!()` fallback.
// ──────────────────────────────────────────────────────────────────────────

use core::ffi::{c_char, c_int, c_void};
use core::ptr;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{Output, ZStr};
use bun_paths::{self as path, OSPathBuffer, OSPathChar, PathBuffer, SEP, SEP_STR};
use bun_string::{self as bun_str, strings, MutableString};
use bun_sys::{self, Fd, FdExt};
use bun_wyhash::hash;

// ──────────────────────────────────────────────────────────────────────────
// Local libarchive C-API surface. The real bindings live in
// `bun_libarchive_sys::bindings`, which is still `#[cfg(any())]`-gated at
// tier 0. This module provides the *type-level* surface needed for
// `bun_libarchive` to compile; every method body is a `todo!()` so a real
// build that reaches FFI will panic loudly until the sys crate un-gates.
// TODO(b2-blocked): bun_libarchive_sys::bindings
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types)]
pub mod lib {
    use super::*;

    pub type la_ssize_t = isize;
    pub type la_int64_t = i64;

    /// Opaque libarchive `struct archive`. Always used behind `*mut Archive`.
    #[repr(C)]
    pub struct Archive {
        _p: [u8; 0],
        _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
    }

    /// Opaque libarchive `struct archive_entry`. Always used behind `*mut Entry`.
    #[repr(C)]
    pub struct Entry {
        _p: [u8; 0],
        _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
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

    impl Archive {
        pub fn read_new() -> *mut Archive {
            // TODO(b2-blocked): bun_libarchive_sys::archive_read_new
            todo!("bun_libarchive_sys::bindings gated")
        }
        pub fn read_close(&self) -> Result { todo!("bun_libarchive_sys gated") }
        pub fn read_free(&self) -> Result { todo!("bun_libarchive_sys gated") }
        pub fn read_support_format_tar(&self) -> Result { todo!("bun_libarchive_sys gated") }
        pub fn read_support_format_gnutar(&self) -> Result { todo!("bun_libarchive_sys gated") }
        pub fn read_support_filter_gzip(&self) -> Result { todo!("bun_libarchive_sys gated") }
        pub fn read_set_options(&self, _opts: &core::ffi::CStr) -> Result {
            todo!("bun_libarchive_sys gated")
        }
        pub fn read_open_memory(&self, _buf: &[u8]) -> Result {
            todo!("bun_libarchive_sys gated")
        }
        pub fn read_next_header(&self, _entry: &mut *mut Entry) -> Result {
            todo!("bun_libarchive_sys gated")
        }
        pub fn read_data(&self, _buf: &mut [u8]) -> isize {
            todo!("bun_libarchive_sys gated")
        }
        pub fn read_data_into_fd(
            &self,
            _fd: Fd,
            _use_pwrite: &mut bool,
            _use_lseek: &mut bool,
        ) -> Result {
            todo!("bun_libarchive_sys gated")
        }
        pub fn error_string(_this: *mut Archive) -> &'static [u8] {
            todo!("bun_libarchive_sys gated")
        }
    }

    impl Entry {
        pub fn pathname(&self) -> &ZStr { todo!("bun_libarchive_sys gated") }
        #[cfg(windows)]
        pub fn pathname_w(&self) -> &bun_core::WStr { todo!("bun_libarchive_sys gated") }
        pub fn symlink(&self) -> &ZStr { todo!("bun_libarchive_sys gated") }
        pub fn perm(&self) -> u32 { todo!("bun_libarchive_sys gated") }
        pub fn size(&self) -> i64 { todo!("bun_libarchive_sys gated") }
        pub fn filetype(&self) -> u32 { todo!("bun_libarchive_sys gated") }
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
    pub fn init(buf: &[u8]) -> Self {
        // PORT NOTE: was an out-param constructor (`this.* = ...`)
        Self {
            buf: buf as *const [u8],
            pos: 0,
            block_size: 16384,
            archive: Archive::read_new(),
            reading: false,
        }
    }

    pub fn open_read(&mut self) -> lib::Result {
        // lib.archive_read_set_open_callback(this.archive, this.);
        // _ = lib.archive_read_set_read_callback(this.archive, archive_read_callback);
        // _ = lib.archive_read_set_seek_callback(this.archive, archive_seek_callback);
        // _ = lib.archive_read_set_skip_callback(this.archive, archive_skip_callback);
        // _ = lib.archive_read_set_close_callback(this.archive, archive_close_callback);
        // // lib.archive_read_set_switch_callback(this.archive, this.archive_s);
        // _ = lib.archive_read_set_callback_data(this.archive, this);

        // SAFETY: archive was created by Archive::read_new() and is valid until Drop
        let archive = unsafe { &mut *self.archive };

        let _ = archive.read_support_format_tar();
        let _ = archive.read_support_format_gnutar();
        let _ = archive.read_support_filter_gzip();

        // Ignore zeroed blocks in the archive, which occurs when multiple tar archives
        // have been concatenated together.
        // Without this option, only the contents of
        // the first concatenated archive would be read.
        let _ = archive.read_set_options(c"read_concatenated_archives");

        // _ = lib.archive_read_support_filter_none(this.archive);

        // SAFETY: buf outlives self (see field comment)
        let rc = archive.read_open_memory(unsafe { &*self.buf });

        self.reading = (rc as c_int) > -1;

        // _ = lib.archive_read_support_compression_all(this.archive);

        rc
    }

    #[inline]
    pub fn buf_left(&self) -> &[u8] {
        // SAFETY: buf outlives self (see field comment)
        unsafe { &(&*self.buf)[self.pos..] }
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
        let this = unsafe { &mut *Self::from_ctx(ctx_) };
        let remaining = this.buf_left();
        if remaining.is_empty() {
            return 0;
        }

        let diff = remaining.len().min(this.block_size);
        // SAFETY: buffer is a non-null out-param provided by libarchive
        unsafe { *buffer = remaining[..diff].as_ptr().cast::<c_void>() };
        this.pos += diff;
        isize::try_from(diff).unwrap()
    }

    pub extern "C" fn archive_skip_callback(
        _: *mut Archive,
        ctx_: *mut c_void,
        offset: lib::la_int64_t,
    ) -> lib::la_int64_t {
        // SAFETY: ctx is the *mut BufferReadStream we registered
        let this = unsafe { &mut *Self::from_ctx(ctx_) };

        // SAFETY: buf outlives self (see field comment)
        let buflen = isize::try_from(unsafe { &*this.buf }.len()).unwrap();
        let pos = isize::try_from(this.pos).unwrap();

        let proposed = pos + isize::try_from(offset).unwrap();
        let new_pos = proposed.max(0).min(buflen - 1);
        this.pos = usize::try_from(new_pos).unwrap();
        (new_pos - pos) as lib::la_int64_t
    }

    pub extern "C" fn archive_seek_callback(
        _: *mut Archive,
        ctx_: *mut c_void,
        offset: lib::la_int64_t,
        whence: c_int,
    ) -> lib::la_int64_t {
        // SAFETY: ctx is the *mut BufferReadStream we registered
        let this = unsafe { &mut *Self::from_ctx(ctx_) };

        // SAFETY: buf outlives self (see field comment)
        let buflen = isize::try_from(unsafe { &*this.buf }.len()).unwrap();
        let pos = isize::try_from(this.pos).unwrap();
        let offset = isize::try_from(offset).unwrap();

        // SAFETY: whence is one of SEEK_SET/CUR/END from libarchive
        match unsafe { core::mem::transmute::<c_int, Seek>(whence) } {
            Seek::Current => {
                let new_pos = (pos + offset).min(buflen - 1).max(0);
                this.pos = usize::try_from(new_pos).unwrap();
                new_pos as lib::la_int64_t
            }
            Seek::End => {
                let new_pos = (buflen - offset).min(buflen).max(0);
                this.pos = usize::try_from(new_pos).unwrap();
                new_pos as lib::la_int64_t
            }
            Seek::Set => {
                let new_pos = offset.min(buflen - 1).max(0);
                this.pos = usize::try_from(new_pos).unwrap();
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
        // SAFETY: archive was created by Archive::read_new() and not yet freed
        unsafe {
            let _ = (*self.archive).read_close();
            let _ = (*self.archive).read_free();
        }
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
            Self { depth_to_skip: 0, close_handles: true, log: false, npm: false }
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

        let mut stream = BufferReadStream::init(file_buffer);
        let _ = stream.open_read();
        let archive = stream.archive;

        // PORT NOTE: std.fs.Dir / openDirAbsolute / cwd().openDir — mapped to
        // bun_sys directory-fd helpers (open_dir_absolute / open_dir_at).
        let dir: Fd = 'brk: {
            let cwd = Fd::cwd();

            // if the destination doesn't exist, we skip the whole thing since nothing can overwrite it.
            if bun_paths::is_absolute(root) {
                let Ok(d) = bun_sys::open_dir_absolute(root) else { return Ok(()) };
                break 'brk d;
            } else {
                let Ok(d) = bun_sys::open_dir_at(cwd, root) else { return Ok(()) };
                break 'brk d;
            }
        };

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
                    let pathname_full = unsafe { (*entry).pathname() };
                    let pathname_bytes = pathname_full.as_bytes();

                    // TODO(port): std.mem.tokenizeScalar + .rest() — approximated by
                    // skipping DEPTH_TO_SKIP separator-delimited tokens then taking the
                    // remainder. Phase B: verify edge cases (leading/trailing seps).
                    let mut remaining = pathname_bytes;
                    let mut depth_i = 0usize;
                    while depth_i < DEPTH_TO_SKIP {
                        // skip leading separators
                        while let [first, rest @ ..] = remaining {
                            if *first == SEP { remaining = rest; } else { break; }
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
                        if *first == SEP { remaining = rest; } else { break; }
                    }

                    // pathname = sliceTo(remaining[..len :0], 0)
                    let pathname = slice_to_nul(remaining);
                    let dirname =
                        strings::trim(bun_paths::dirname_simple(pathname), SEP_STR.as_bytes());

                    // SAFETY: entry valid
                    let size: usize =
                        usize::try_from(unsafe { (*entry).size() }.max(0)).unwrap();
                    if size > 0 {
                        // PORT NOTE: Zig used `dir.openFile(pathname, .{ .mode = .write_only })`.
                        let Ok(opened) =
                            bun_sys::openat_a(dir, pathname, bun_sys::O::WRONLY, 0)
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

                                let index =
                                    __pathname.iter().position(|&b| b == SEP).unwrap();
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

        let mut stream = BufferReadStream::init(file_buffer);
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
                    let pathname_z = unsafe { (*entry).pathname_w() };
                    // SAFETY: entry was just populated by read_next_header
                    #[cfg(not(windows))]
                    let pathname_z = unsafe { (*entry).pathname() };

                    if A::HAS_ON_FIRST_DIRECTORY_NAME {
                        if appender.needs_first_dirname() {
                            #[cfg(windows)]
                            {
                                let result = strings::to_utf8_list_with_type(
                                    Vec::new(),
                                    pathname_z.as_slice(),
                                )?;
                                // onFirstDirectoryName copies the contents of pathname to another buffer, safe to free
                                appender.on_first_directory_name(
                                    strings::without_trailing_slash(&result),
                                );
                            }
                            #[cfg(not(windows))]
                            {
                                appender.on_first_directory_name(
                                    strings::without_trailing_slash(pathname_z.as_bytes()),
                                );
                            }
                        }
                    }

                    // SAFETY: entry valid
                    let kind = bun_sys::kind_from_mode(unsafe { (*entry).filetype() });

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
                    let pathname_slice: &[OSPathChar] = pathname_z.as_bytes();
                    let mut remaining: &[OSPathChar] = pathname_slice;
                    {
                        let sep: OSPathChar = b'/' as OSPathChar;
                        let mut i = 0usize;
                        while i < options.depth_to_skip {
                            while let [first, rest @ ..] = remaining {
                                if *first == sep { remaining = rest; } else { break; }
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
                            if *first == sep { remaining = rest; } else { break; }
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
                            let mut mode = i32::try_from(unsafe { (*entry).perm() }).unwrap();

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
                                bun_sys::make_path_w(dir, path_slice)?;
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
                                    bun_sys::Mode::try_from(mode).unwrap(),
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
                            let link_target = unsafe { (*entry).symlink() };
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
                                        Output::warn(format_args!(
                                            "Skipping symlink with unsafe target: {} -> {}\n",
                                            bun_core::fmt::fmt_os_path(
                                                path_slice,
                                                Default::default()
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
                                unsafe { (*entry).perm() } | 0o666,
                            )
                            .unwrap();

                            let flags =
                                bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;

                            #[cfg(windows)]
                            let file_handle_native: Fd = match bun_sys::openat_windows(
                                dir_fd, path_slice, flags, 0,
                            ) {
                                Ok(fd) => fd,
                                Err(e) => match e.get_errno() {
                                    bun_sys::E::EPERM | bun_sys::E::ENOENT => {
                                        // PORT NOTE: Zig `bun.Dirname.dirname(u16, ...)`.
                                        let dirname =
                                            bun_paths::resolve_path::dirname_w(path_slice);
                                        if dirname.is_empty() {
                                            return Err(e.into());
                                        }
                                        let _ = bun_sys::make_path_w(dir, dirname);
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
                            let mut close_guard = scopeguard::guard(
                                (file_handle, false),
                                |(fh, plucked)| {
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
                                },
                            );
                            let (file_handle, plucked_file) = &mut *close_guard;

                            // SAFETY: entry valid
                            let size: usize =
                                usize::try_from(unsafe { (*entry).size() }.max(0)).unwrap();

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
                                            // SAFETY: archive valid
                                            let read = unsafe {
                                                (*archive).read_data(
                                                    plucker_.contents.list.as_mut_slice(),
                                                )
                                            };
                                            plucker_
                                                .contents
                                                .inflate(usize::try_from(read).unwrap())?;
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
                                            i64::try_from(size).unwrap(),
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
                                                    format_args!(
                                                        "extracting {}, retry {} / {}",
                                                        bun_core::fmt::fmt_os_path(
                                                            path_slice,
                                                            Default::default()
                                                        ),
                                                        retries_remaining,
                                                        5,
                                                    ),
                                                );
                                            }
                                        }
                                        _ => {
                                            if options.log {
                                                let archive_error = slice_to_nul(
                                                    Archive::error_string(archive),
                                                );
                                                Output::err(
                                                    "libarchive error",
                                                    format_args!(
                                                        "extracting {}: {}",
                                                        bun_core::fmt::fmt_os_path(
                                                            path_slice,
                                                            Default::default()
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

// Helper: std.mem.sliceAsBytes equivalent for OSPathChar slices.
#[inline]
fn slice_as_bytes(s: &[OSPathChar]) -> &[u8] {
    // SAFETY: OSPathChar is u8 on posix / u16 on windows; both are POD with no padding.
    unsafe {
        core::slice::from_raw_parts(s.as_ptr().cast::<u8>(), core::mem::size_of_val(s))
    }
}

// Helper: std.mem.sliceTo(slice, 0) — return prefix up to (excluding) the
// first NUL, or the whole slice if no NUL is present.
#[inline]
fn slice_to_nul(s: &[u8]) -> &[u8] {
    match s.iter().position(|&b| b == 0) {
        Some(i) => &s[..i],
        None => s,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/libarchive/libarchive.zig (688 lines)
//   confidence: medium
//   todos:      see TODO(b2-blocked) markers above
//   notes:      std.fs.Dir ops mapped to bun_sys placeholders; @hasDecl
//               duck-typing → ArchiveAppender trait; tokenizer.rest()
//               hand-rolled; defer-close of file_handle uses awkward
//               scopeguard — restructure in Phase B.
// ──────────────────────────────────────────────────────────────────────────
