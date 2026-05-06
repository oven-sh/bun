#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_sys` — B-1 minimal compiling surface.
//! Full Phase-A draft (5500 lines, all syscall wrappers) preserved in
//! `lib_draft_b1.rs` on disk for B-2 move-in reference. Draft module dropped
//! from build (duplicate of live per-syscall impls below).

// #[path = "lib_draft_b1.rs"] mod draft;
// RESOLVED (B-2 round 7): `Fd` struct + pure-data accessors hoisted to
// `bun_core::Fd` (canonical T0). `fd.rs` is now `pub trait FdExt` over that.
pub mod fd;
pub use fd::{FdExt, FdOptionalExt, ErrorCase, MakeLibUvOwnedError, HashMapContext, MovableIfWindowsFd, FdT, UvFile, RawFd};
// `File.rs` (Phase-A draft) stays gated: the inline `impl File` below is the
// canonical, downstream-consumed surface (`read_to_end() -> Maybe<Vec<u8>>`,
// `from_fd`, `create`, `read_from(Fd, &ZStr)`) and File.rs's shapes diverge
// (`read_to_end() -> ReadToEndResult`, `read_from(impl Into<File>, &ZStr)`).
// Swapping breaks T2+ callers. File.rs additionally blocked on
// `bun_paths::OsPathZ` (T0, missing) and the `top_level_dir()` resolver hook.
// B-2 follow-up: cherry-pick File.rs-only methods (`make_openat`, `kind`,
// `is_tty`, `read_file_from`, `close_and_move_to`) into the inline impl as
// higher tiers demand them. Draft module dropped from build; inline `impl File`
// below + `pub mod file { pub use super::File; }` are canonical.
// #[path = "File.rs"] pub mod file;
#[path = "Error.rs"] mod error;
pub use error::Error;
// `bun_sys::Error` is the rich syscall error (errno+tag+path); `bun_core::Error`
// is the lightweight NonZeroU16 code. They are distinct types (matching Zig:
// `bun.sys.Error` vs `anyerror`). Downstream that just wants "an error" gets the
// code via `From`.
impl From<Error> for bun_core::Error {
    #[inline]
    fn from(e: Error) -> bun_core::Error {
        // Encode as the errno's name (e.g., "ENOENT") in the interned table.
        bun_core::Error::from_errno(e.errno as i32)
    }
}
// Stub: `SystemError` is the JS-facing rich error (path/dest/syscall as bun.String).
// Full def lives in `bun_jsc` (TYPE_ONLY move-in pending per CYCLEBREAK).
#[derive(Default)]
pub struct SystemError {
    // PORT NOTE: full Display lives in src/jsc/SystemError.zig (rich JS-side
    // formatting). For T1 we provide a minimal impl so `bun_sys::Error` can
    // delegate; Display matches `SystemError.format` shell-variant shape.
    pub errno: i32,
    pub code: bun_string::String,
    pub message: bun_string::String,
    pub path: bun_string::String,
    pub dest: bun_string::String,
    pub syscall: bun_string::String,
    pub fd: i32,
    pub hostname: bun_string::String,
}
impl core::fmt::Display for SystemError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // TODO(b2): match SystemError.zig writeFormat exactly (color, syscall, fd).
        // Minimal: "<code>: <message> '<path>'"
        write!(f, "SystemError(errno={})", self.errno)
    }
}
pub mod walker_skippable;
// `copy_file.rs` — full ioctl_ficlone / copy_file_range / sendfile / r-w-loop
// state machine (port of `src/sys/copy_file.zig`). Un-gated B-2: raw kernel
// thunks live in `crate::linux`, errno tags use the prefixed `E::E*` form,
// kernel-version probe goes through `bun_core::linux_kernel_version()`.
#[path = "copy_file.rs"] pub mod copy_file;

// `std.fs.Dir.Entry.Kind` — same set as `bun_core::FileKind`.
pub use bun_core::FileKind as EntryKind;

// `bun.DirIterator` — ported from `src/runtime/node/dir_iterator.zig`.
//
// This is copied from std.fs.Dir.Iterator. Differences:
// - returns errors in `bun_sys::Result` (preserves errno + syscall tag)
// - doesn't mark BADF as unreachable
// - entry name is owned (`Name`) in OS-native encoding, NUL-terminated
// - Windows uses the `.u16` path (`NewWrappedIterator(.u16)` in Zig)
//
// The high-tier `bun_runtime::node::dir_iterator` shares this surface; the
// readdir loop lives here so `walker_skippable` / `bun_glob` / resolver can
// iterate without pulling `bun_runtime` up-tier.
pub mod dir_iterator {
    use super::{EntryKind, Error, Fd, Result, Tag};
    use bun_paths::OSPathChar;

    const BUF_SIZE: usize = 8192;

    /// Native-encoding directory entry returned by `WrappedIterator::next()`.
    pub struct IteratorResult {
        pub name: Name,
        pub kind: EntryKind,
    }

    /// Length-known, NUL-terminated entry name in OS-native encoding.
    /// Backing storage is `[name..., 0]`; `slice()` excludes the trailing NUL.
    ///
    /// On Windows the native encoding is UTF-16, but the Zig `.u8`
    /// `NewWrappedIterator` (which `bun.glob` consumes) eagerly transcodes
    /// `dir_info.FileName` to UTF-8 via `strings.fromWPath` and exposes the
    /// result as `name.slice() : []const u8`. We mirror that here by caching
    /// the UTF-8 form alongside the native u16 buffer so `slice_u8()` can
    /// hand out a borrowed `&[u8]` on every platform.
    pub struct Name {
        native: Vec<OSPathChar>,
        #[cfg(windows)]
        utf8: Vec<u8>,
    }
    impl Name {
        #[inline]
        fn from_slice(s: &[OSPathChar]) -> Name {
            let mut v = Vec::with_capacity(s.len() + 1);
            v.extend_from_slice(s);
            v.push(0);
            #[cfg(windows)]
            {
                // Zig: `strings.fromWPath(self.name_data[0..], dir_info_name)` —
                // "Trust that Windows gives us valid UTF-16LE".
                let utf8 = bun_core::strings::convert_utf16_to_utf8(Vec::new(), s);
                Name { native: v, utf8 }
            }
            #[cfg(not(windows))]
            { Name { native: v } }
        }
        /// Zig: `name.slice()` — borrow the name as `&[OSPathChar]` (no NUL).
        #[inline] pub fn slice(&self) -> &[OSPathChar] { &self.native[..self.native.len() - 1] }
        #[inline] pub fn as_slice(&self) -> &[OSPathChar] { self.slice() }
        /// Borrow the entry name as UTF-8 bytes (no NUL). On POSIX this is the
        /// native slice; on Windows it is the cached `fromWPath` transcode.
        #[cfg(not(windows))]
        #[inline] pub fn slice_u8(&self) -> &[u8] { self.slice() }
        #[cfg(windows)]
        #[inline] pub fn slice_u8(&self) -> &[u8] { &self.utf8 }
        /// Zig: `name.sliceAssumeZ()` — `[:0]const u8` on POSIX.
        #[cfg(not(windows))]
        #[inline] pub fn as_zstr(&self) -> &bun_core::ZStr {
            // SAFETY: trailing NUL pushed in `from_slice`.
            unsafe { bun_core::ZStr::from_raw(self.native.as_ptr(), self.native.len() - 1) }
        }
        #[cfg(windows)]
        #[inline] pub fn as_zstr(&self) -> &bun_core::WStr {
            // SAFETY: trailing NUL pushed in `from_slice`.
            unsafe { bun_core::WStr::from_raw(self.native.as_ptr(), self.native.len() - 1) }
        }
    }

    // 8-byte alignment matches `@alignOf(linux.dirent64)` / Darwin dirent /
    // FILE_DIRECTORY_INFORMATION's LONGLONG-boundary requirement.
    #[repr(C, align(8))]
    struct AlignedBuf([u8; BUF_SIZE]);

    /// `posix.DT.* → Entry.Kind` (Linux/Darwin/FreeBSD share the BSD `DT_*` values).
    #[cfg(unix)]
    #[inline]
    fn kind_from_dt(dt: u8) -> EntryKind {
        match dt {
            libc::DT_BLK  => EntryKind::BlockDevice,
            libc::DT_CHR  => EntryKind::CharacterDevice,
            libc::DT_DIR  => EntryKind::Directory,
            libc::DT_FIFO => EntryKind::NamedPipe,
            libc::DT_LNK  => EntryKind::SymLink,
            libc::DT_REG  => EntryKind::File,
            libc::DT_SOCK => EntryKind::UnixDomainSocket,
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            libc::DT_WHT  => EntryKind::Whiteout,
            // DT_UNKNOWN: some filesystems (bind mounts, FUSE, NFS) don't
            // provide d_type. Callers should lstatat() to resolve when needed.
            _ => EntryKind::Unknown,
        }
    }

    // ── Linux ────────────────────────────────────────────────────────────
    #[cfg(target_os = "linux")]
    struct State {
        buf: Box<AlignedBuf>,
        index: usize,
        end_index: usize,
    }
    #[cfg(target_os = "linux")]
    impl State {
        #[inline] fn new() -> State {
            State { buf: Box::new(AlignedBuf([0u8; BUF_SIZE])), index: 0, end_index: 0 }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult>> {
            loop {
                if self.index >= self.end_index {
                    // glibc doesn't expose getdents64; go straight to the syscall
                    // (matches Zig's `linux.getdents64` raw-syscall path).
                    // SAFETY: buf is valid for BUF_SIZE bytes; fd is a plain c_int.
                    let rc = unsafe {
                        libc::syscall(
                            libc::SYS_getdents64,
                            dir.native() as libc::c_long,
                            self.buf.0.as_mut_ptr(),
                            BUF_SIZE,
                        )
                    };
                    if rc < 0 {
                        return Err(Error::from_code_int(super::last_errno(), Tag::getdents64));
                    }
                    if rc == 0 { return Ok(None); }
                    self.index = 0;
                    self.end_index = rc as usize;
                }
                // struct linux_dirent64 { u64 d_ino; i64 d_off; u16 d_reclen;
                //                         u8 d_type; char d_name[]; }
                let base = self.index;
                let p = self.buf.0.as_ptr();
                // SAFETY: kernel guarantees a complete record fits in [base..end_index).
                let reclen = unsafe {
                    core::ptr::read_unaligned(p.add(base + 16) as *const u16)
                } as usize;
                let d_type = unsafe { *p.add(base + 18) };
                self.index = base + reclen;

                // d_name is NUL-terminated within the record.
                let name_ptr = unsafe { p.add(base + 19) };
                let max = reclen.saturating_sub(19);
                let mut len = 0usize;
                // SAFETY: name_ptr[..max] lies inside the record.
                while len < max && unsafe { *name_ptr.add(len) } != 0 { len += 1; }
                let name = unsafe { core::slice::from_raw_parts(name_ptr, len) };

                // skip . and .. entries
                if name == b"." || name == b".." { continue; }

                return Ok(Some(IteratorResult {
                    name: Name::from_slice(name),
                    kind: kind_from_dt(d_type),
                }));
            }
        }
    }

    // ── macOS ────────────────────────────────────────────────────────────
    #[cfg(target_os = "macos")]
    struct State {
        buf: Box<AlignedBuf>,
        seek: i64,
        index: usize,
        end_index: usize,
        received_eof: bool,
    }
    #[cfg(target_os = "macos")]
    impl State {
        #[inline] fn new() -> State {
            State {
                buf: Box::new(AlignedBuf([0u8; BUF_SIZE])),
                seek: 0, index: 0, end_index: 0, received_eof: false,
            }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult>> {
            unsafe extern "C" {
                // Private libsystem symbol; same one Zig's `posix.system.__getdirentries64` hits.
                fn __getdirentries64(
                    fd: libc::c_int, buf: *mut u8, nbytes: usize, basep: *mut i64,
                ) -> isize;
            }
            loop {
                if self.index >= self.end_index {
                    if self.received_eof { return Ok(None); }

                    // getdirentries64() writes to the last 4 bytes of the
                    // buffer to indicate EOF. If that value is not zero, we
                    // have reached the end of the directory and can skip the
                    // extra syscall.
                    // https://github.com/apple-oss-distributions/xnu/blob/94d3b452840153a99b38a3a9659680b2a006908e/bsd/vfs/vfs_syscalls.c#L10444-L10470
                    const GETDIRENTRIES64_EXTENDED_BUFSIZE: usize = 1024;
                    const _: () = assert!(BUF_SIZE >= GETDIRENTRIES64_EXTENDED_BUFSIZE);
                    self.received_eof = false;
                    // Always zero the bytes where the flag will be written so
                    // we don't confuse garbage with EOF.
                    self.buf.0[BUF_SIZE - 4..].copy_from_slice(&[0, 0, 0, 0]);

                    // SAFETY: buf is valid for BUF_SIZE bytes; seek is a valid *mut i64.
                    let rc = unsafe {
                        __getdirentries64(dir.native(), self.buf.0.as_mut_ptr(), BUF_SIZE, &mut self.seek)
                    };
                    if rc < 1 {
                        if rc == 0 {
                            self.received_eof = true;
                            return Ok(None);
                        }
                        return Err(Error::from_code_int(super::last_errno(), Tag::getdirentries64));
                    }
                    self.index = 0;
                    self.end_index = rc as usize;
                    let flag = u32::from_ne_bytes(
                        self.buf.0[BUF_SIZE - 4..].try_into().unwrap()
                    );
                    self.received_eof = self.end_index <= (BUF_SIZE - 4) && flag == 1;
                }
                // Darwin `struct dirent` (64-bit ino):
                //   u64 d_ino; u64 d_seekoff; u16 d_reclen; u16 d_namlen;
                //   u8 d_type; char d_name[];
                let base = self.index;
                let p = self.buf.0.as_ptr();
                // SAFETY: kernel guarantees a complete record fits in [base..end_index).
                let d_ino = unsafe {
                    core::ptr::read_unaligned(p.add(base) as *const u64)
                };
                let reclen = unsafe {
                    core::ptr::read_unaligned(p.add(base + 16) as *const u16)
                } as usize;
                let namlen = unsafe {
                    core::ptr::read_unaligned(p.add(base + 18) as *const u16)
                } as usize;
                let d_type = unsafe { *p.add(base + 20) };
                self.index = base + reclen;

                let name = unsafe {
                    core::slice::from_raw_parts(p.add(base + 21), namlen)
                };

                if name == b"." || name == b".." || d_ino == 0 { continue; }

                return Ok(Some(IteratorResult {
                    name: Name::from_slice(name),
                    kind: kind_from_dt(d_type),
                }));
            }
        }
    }

    // ── FreeBSD ──────────────────────────────────────────────────────────
    #[cfg(target_os = "freebsd")]
    struct State {
        buf: Box<AlignedBuf>,
        index: usize,
        end_index: usize,
    }
    #[cfg(target_os = "freebsd")]
    impl State {
        #[inline] fn new() -> State {
            State { buf: Box::new(AlignedBuf([0u8; BUF_SIZE])), index: 0, end_index: 0 }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult>> {
            unsafe extern "C" {
                fn getdents(fd: libc::c_int, buf: *mut u8, nbytes: usize) -> isize;
            }
            loop {
                if self.index >= self.end_index {
                    // SAFETY: buf is valid for BUF_SIZE bytes.
                    let rc = unsafe { getdents(dir.native(), self.buf.0.as_mut_ptr(), BUF_SIZE) };
                    if rc < 0 {
                        let e = super::last_errno();
                        // FreeBSD reports ENOENT when iterating an unlinked
                        // but still-open directory.
                        if e == libc::ENOENT { return Ok(None); }
                        return Err(Error::from_code_int(e, Tag::getdents64));
                    }
                    if rc == 0 { return Ok(None); }
                    self.index = 0;
                    self.end_index = rc as usize;
                }
                // FreeBSD 12+ `struct dirent` (ino64):
                //   u64 d_fileno; i64 d_off; u16 d_reclen; u8 d_type; u8 pad0;
                //   u16 d_namlen; u16 pad1; char d_name[];
                let base = self.index;
                let p = self.buf.0.as_ptr();
                let fileno = unsafe { core::ptr::read_unaligned(p.add(base) as *const u64) };
                let reclen = unsafe {
                    core::ptr::read_unaligned(p.add(base + 16) as *const u16)
                } as usize;
                let d_type = unsafe { *p.add(base + 18) };
                let namlen = unsafe {
                    core::ptr::read_unaligned(p.add(base + 20) as *const u16)
                } as usize;
                self.index = base + reclen;

                let name = unsafe {
                    core::slice::from_raw_parts(p.add(base + 24), namlen)
                };

                if name == b"." || name == b".." || fileno == 0 { continue; }

                return Ok(Some(IteratorResult {
                    name: Name::from_slice(name),
                    kind: kind_from_dt(d_type),
                }));
            }
        }
    }

    // ── Windows ──────────────────────────────────────────────────────────
    // dir_iterator.zig:233-417 — `NtQueryDirectoryFile` +
    // `FILE_DIRECTORY_INFORMATION` walk.
    #[cfg(windows)]
    struct State {
        // > This structure must be aligned on a LONGLONG (8-byte) boundary. If
        // > a buffer contains two or more of these structures, the
        // > NextEntryOffset value in each entry, except the last, falls on an
        // > 8-byte boundary.
        // https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_directory_information
        buf: Box<AlignedBuf>,
        index: usize,
        end_index: usize,
        first: bool,
        /// Optional kernel-side wildcard filter passed to NtQueryDirectoryFile.
        /// Evaluated by `FsRtlIsNameInExpression` (case-insensitive, supports
        /// `*` and `?`). Only honored on the first call (RestartScan=TRUE);
        /// sticky for the handle lifetime.
        name_filter: Option<Vec<u16>>,
    }
    #[cfg(windows)]
    impl State {
        #[inline] fn new() -> State {
            State {
                buf: Box::new(AlignedBuf([0u8; BUF_SIZE])),
                index: 0, end_index: 0, first: true,
                name_filter: None,
            }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult>> {
            use bun_windows_sys::externs as w;
            use crate::windows::Win32Error;
            // `offset_of!(FILE_DIRECTORY_INFORMATION, FileName)` — fixed by the
            // Win32 layout (4+4 + 6×8 + 4+4 = 64).
            const NAME_OFFSET: usize = 64;
            loop {
                if self.index >= self.end_index {
                    // The I/O manager only fills the IO_STATUS_BLOCK on IRP
                    // completion. When NtQueryDirectoryFile fails with an
                    // NT_ERROR status (e.g. parameter validation), the block
                    // is left untouched, so zero-initialize it rather than
                    // reading uninitialized stack if the call fails.
                    // SAFETY: all-zero is a valid IO_STATUS_BLOCK.
                    let mut io: w::IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
                    if self.first {
                        // > Any bytes inserted for alignment SHOULD be set to
                        // > zero, and the receiver MUST ignore them.
                        self.buf.0.fill(0);
                    }
                    let mut filter_us = w::UNICODE_STRING {
                        Length: 0, MaximumLength: 0, Buffer: core::ptr::null_mut(),
                    };
                    let filter_ptr: *mut w::UNICODE_STRING = match &self.name_filter {
                        Some(f) => {
                            let len_bytes = (f.len() * 2) as u16;
                            filter_us.Length = len_bytes;
                            filter_us.MaximumLength = len_bytes;
                            filter_us.Buffer = f.as_ptr() as *mut u16;
                            &mut filter_us
                        }
                        None => core::ptr::null_mut(),
                    };
                    // SAFETY: FFI; all pointer args are valid for the call.
                    let rc = unsafe {
                        w::ntdll::NtQueryDirectoryFile(
                            dir.cast(),
                            core::ptr::null_mut(),
                            core::ptr::null_mut(),
                            core::ptr::null_mut(),
                            &mut io,
                            self.buf.0.as_mut_ptr().cast(),
                            BUF_SIZE as u32,
                            w::FILE_INFORMATION_CLASS::FileDirectoryInformation,
                            0, // FALSE — return many entries per call
                            filter_ptr,
                            if self.first { 1 } else { 0 },
                        )
                    };
                    self.first = false;

                    // If the handle is not a directory, we'll get
                    // STATUS_INVALID_PARAMETER.
                    if rc == w::NTSTATUS::INVALID_PARAMETER {
                        return Err(Error::from_code(
                            super::E::ENOTDIR, Tag::NtQueryDirectoryFile,
                        ));
                    }
                    // NO_SUCH_FILE is returned on the first call when a
                    // FileName filter matches nothing; NO_MORE_FILES on
                    // subsequent calls. Both mean "done".
                    if rc == w::NTSTATUS::NO_MORE_FILES || rc == w::NTSTATUS::NO_SUCH_FILE {
                        return Ok(None);
                    }
                    if rc != w::NTSTATUS::SUCCESS {
                        let errno = Win32Error::from_nt_status(rc)
                            .to_system_errno()
                            .unwrap_or(super::E::EUNKNOWN);
                        return Err(Error::from_code(errno, Tag::NtQueryDirectoryFile));
                    }
                    if io.Information == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = io.Information;
                }

                let entry_offset = self.index;
                let p = self.buf.0.as_ptr();
                // While the official api docs guarantee FILE_DIRECTORY_INFORMATION
                // to be aligned properly, this may not always be the case (e.g.
                // due to faulty VM/Sandboxing tools) — read fields unaligned.
                // SAFETY: entry_offset < end_index ≤ BUF_SIZE; struct header
                // (NAME_OFFSET = 64 bytes) is fully within the buffer per the
                // NtQueryDirectoryFile contract on STATUS_SUCCESS.
                let next_off = unsafe {
                    core::ptr::read_unaligned(p.add(entry_offset) as *const u32)
                } as usize;
                let file_attrs = unsafe {
                    core::ptr::read_unaligned(p.add(entry_offset + 56) as *const u32)
                };
                let name_len_bytes = unsafe {
                    core::ptr::read_unaligned(p.add(entry_offset + 60) as *const u32)
                } as usize;
                self.index = if next_off != 0 {
                    entry_offset + next_off
                } else {
                    BUF_SIZE
                };

                // Some filesystem / filter drivers have been observed
                // returning FILE_DIRECTORY_INFORMATION entries with an
                // out-of-range FileNameLength (well beyond the 255-WCHAR NTFS
                // component limit). Clamp to what remains in `buf` so a
                // misbehaving driver cannot walk us past the end of the buffer.
                let name_byte_offset = entry_offset + NAME_OFFSET;
                let buf_remaining_u16 = BUF_SIZE.saturating_sub(name_byte_offset) / 2;
                let name_len_u16 = (name_len_bytes / 2).min(buf_remaining_u16);
                // SAFETY: name_byte_offset + name_len_u16*2 ≤ BUF_SIZE by clamp.
                let dir_info_name = unsafe {
                    core::slice::from_raw_parts(
                        p.add(name_byte_offset) as *const u16,
                        name_len_u16,
                    )
                };

                if dir_info_name == [b'.' as u16]
                    || dir_info_name == [b'.' as u16, b'.' as u16]
                {
                    continue;
                }

                let kind = {
                    let isdir = (file_attrs & w::FILE_ATTRIBUTE_DIRECTORY) != 0;
                    let islink = (file_attrs & w::FILE_ATTRIBUTE_REPARSE_POINT) != 0;
                    // On Windows, symlinks can be directories too. We
                    // prioritize the "sym_link" kind over the "directory"
                    // kind; this will coerce into either .file or .directory
                    // later once the symlink is read.
                    if islink {
                        EntryKind::SymLink
                    } else if isdir {
                        EntryKind::Directory
                    } else {
                        EntryKind::File
                    }
                };

                return Ok(Some(IteratorResult {
                    name: Name::from_slice(dir_info_name),
                    kind,
                }));
            }
        }
    }

    /// `DirIterator.NewWrappedIterator(if windows .u16 else .u8)`
    pub struct WrappedIterator {
        dir: Fd,
        // Windows: NtQueryDirectoryFile filter (UNICODE_STRING). On POSIX,
        // ignored (kernel readdir has no name filter; callers post-filter).
        // PORT NOTE: stored on `State` on Windows so `next()` can pass it.
        #[cfg(not(windows))]
        #[allow(dead_code)]
        name_filter: Option<Vec<u16>>,
        state: State,
    }
    impl WrappedIterator {
        #[inline] pub fn dir(&self) -> Fd { self.dir }
        /// Windows-only kernel-side name filter (passed to `NtQueryDirectoryFile`).
        /// On POSIX this is a no-op; callers must filter themselves.
        #[inline]
        pub fn set_name_filter(&mut self, filter: Option<&[u16]>) {
            #[cfg(windows)] { self.state.name_filter = filter.map(|f| f.to_vec()); }
            #[cfg(not(windows))] { self.name_filter = filter.map(|f| f.to_vec()); }
        }
        /// Memory such as file names referenced in this returned entry becomes
        /// invalid with subsequent calls to `next`, as well as when this `Dir`
        /// is deinitialized.
        // PORT NOTE: `Name` owns its buffer here (heap copy of d_name), so the
        // Zig invalidation note is conservative; kept for API parity.
        #[inline]
        pub fn next(&mut self) -> Result<Option<IteratorResult>> {
            self.state.next(self.dir)
        }
    }

    pub fn iterate(dir: Fd) -> WrappedIterator {
        #[cfg(not(windows))]
        { WrappedIterator { dir, name_filter: None, state: State::new() } }
        #[cfg(windows)]
        { WrappedIterator { dir, state: State::new() } }
    }
}

/// `bun.openDirForIterationOSPath` — `openat(dir, path, O_DIRECTORY|O_RDONLY)`
/// on POSIX; `CreateFileW` with `FILE_FLAG_BACKUP_SEMANTICS` on Windows.
pub fn open_dir_for_iteration_os_path(dir: Fd, path: &bun_paths::OSPathSlice) -> Result<Fd> {
    #[cfg(not(windows))] {
        // PORT NOTE: Zig `openDirForIterationOSPath` uses
        // `O_DIRECTORY | O_RDONLY | O_CLOEXEC` (`| O_NONBLOCK` on Linux).
        let mut buf = bun_paths::PathBuffer::default();
        // bun.zig:883 → `sys.openatA` → `std.posix.toPosixPath`: ENAMETOOLONG on
        // overflow, never silently truncate (would open the wrong directory).
        if path.len() >= buf.len() {
            return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::open).with_path(path));
        }
        let len = path.len();
        buf[..len].copy_from_slice(path);
        buf[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = unsafe { ZStr::from_raw(buf.as_ptr(), len) };
        // bun.zig:883 — exactly `O_DIRECTORY | O_CLOEXEC | O_RDONLY` (no NONBLOCK).
        let flags = libc::O_DIRECTORY | libc::O_RDONLY | libc::O_CLOEXEC;
        openat(dir, z, flags, 0)
    }
    #[cfg(windows)] {
        // bun.zig:884 → `sys.openDirAtWindowsA(dir, path, .{ .iterable = true,
        // .read_only = true })`.
        open_dir_at_windows(dir, path, WindowsOpenDirOptions {
            iterable: true,
            read_only: true,
            ..Default::default()
        })
    }
}

pub fn lstatat(fd: Fd, path: &ZStr) -> Result<Stat> {
    #[cfg(not(windows))] {
        let mut st = core::mem::MaybeUninit::<libc::stat>::uninit();
        // sys.zig:874 — `bun.invalid_fd` means cwd-relative.
        let dirfd = if fd.is_valid() { fd.native() } else { libc::AT_FDCWD };
        // SAFETY: path is NUL-terminated; st is written on success.
        let rc = unsafe {
            libc::fstatat(dirfd, path.as_ptr().cast(), st.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW)
        };
        if rc == 0 {
            Ok(unsafe { st.assume_init() })
        } else {
            // sys.zig:877 — `lstatat` tags as `.fstatat`.
            Err(Error::from_code_int(last_errno(), Tag::fstatat).with_path(path.as_bytes()))
        }
    }
    #[cfg(windows)] {
        // sys.zig:879 — open with `O.NOFOLLOW` (→ `FILE_OPEN_REPARSE_POINT`),
        // `fstat` the handle, then close.
        match openat_windows_a(fd, path.as_bytes(), O::NOFOLLOW, 0) {
            Ok(file) => {
                let r = fstat(file);
                let _ = close(file);
                r
            }
            Err(err) => Err(err),
        }
    }
}
/// `bun.getcwdAlloc(allocator)` (bun.zig:1256) — read cwd into a stack
/// `PathBuffer`, then duplicate into a heap-owned NUL-terminated `ZBox`.
pub fn getcwd_alloc() -> Maybe<bun_core::ZBox> {
    let mut buf = [0u8; bun_core::MAX_PATH_BYTES];
    let len = getcwd(&mut buf[..])?;
    Ok(bun_core::ZBox::from_bytes(&buf[..len]))
}

/// `bun.sys.getcwdZ(buf)` (sys.zig:349) — `getcwd` returning a NUL-terminated
/// borrow into `buf`. POSIX `getcwd(3)` already NUL-terminates; on Windows
/// the libuv path does too.
pub fn getcwd_z(buf: &mut bun_paths::PathBuffer) -> Maybe<&ZStr> {
    let len = getcwd(&mut buf[..])?;
    debug_assert!(len < buf.len());
    buf[len] = 0;
    // SAFETY: NUL written at buf[len]; slice is within buf.
    Ok(unsafe { ZStr::from_raw(buf.as_ptr(), len) })
}

pub mod coreutils_error_map;
pub mod libuv_error_map;
#[path = "SignalCode.rs"] pub mod signal_code;
pub use signal_code::SignalCode;
pub mod tmp;
pub use tmp::Tmpfile;
// `windows/mod.rs` is `#![cfg(windows)]`-gated internally; on POSIX this
// declares an empty module so `bun_sys::windows::*` paths still resolve under
// `#[cfg(windows)]` arms in dependents.
pub mod windows;

use core::ffi::{c_char, c_int, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from lower-tier crates (PORTING.md crate map).
// ──────────────────────────────────────────────────────────────────────────
pub use bun_core::{Fd, FdNative, FdKind, FdOptional, Stdio, Mode, FileKind, kind_from_mode};
/// `std.posix.socket_t` — `c_int` on POSIX, `SOCKET` (`usize`) on Windows.
#[cfg(not(windows))] pub type SocketT = core::ffi::c_int;
#[cfg(windows)] pub type SocketT = usize;
pub use bun_errno::{E, S, SystemErrno, get_errno, GetErrno};

/// Exported for `headers-handwritten.h` `Bun__errnoName`. Returns the static
/// upper-case errno name (e.g. `"ENOENT"`) or null for an unrecognised code.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__errnoName(err: core::ffi::c_int) -> *const core::ffi::c_char {
    match SystemErrno::init(err as _) {
        Some(e) => <&'static str>::from(e).as_ptr() as *const core::ffi::c_char,
        None => core::ptr::null(),
    }
}

/// Small "fire and forget" wrapper around unlink for C usage that handles
/// EINTR, Windows path conversion, etc. Zig: `export fn Bun__unlink(ptr, len)`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__unlink(ptr: *const u8, len: usize) {
    // SAFETY: caller (C++) guarantees `ptr[0..=len]` is a valid NUL-terminated
    // path slice for the duration of the call.
    let path = unsafe { ZStr::from_raw(ptr, len) };
    let _ = unlink(path);
}

// libuv-style error constants (negated errno on posix, UV_* on Windows). The
// per-platform `bun_errno` module defines this as `mod uv_e`; re-export under
// the canonical Zig name so callers can write `bun_sys::UV_E::NOENT`.
pub use bun_errno::uv_e as UV_E;
// `bun_errno::posix` is the small move-down stub (mode_t/E/S/errno). The full
// `std.posix` surface dependents need (`Sigaction`, `getrlimit`, `tcgetattr`,
// raw `read`/`write`/`poll`, …) is widened below in this crate's own `posix`
// module which re-exports the errno stub and layers libc on top.

/// `Maybe(T)` — Zig's `union(enum) { result: T, err: Error }`. In Rust this is
/// just `Result<T, Error>`; keep the alias so Phase-A drafts type-check.
pub type Maybe<T> = core::result::Result<T, Error>;
pub type Result<T> = core::result::Result<T, Error>;

/// Flags for [`renameat2`]. Port of `bun.sys.RenameAt2Flags` (sys.zig:2472).
/// On Linux maps to `RENAME_EXCHANGE`/`RENAME_NOREPLACE`; on macOS maps to
/// `RENAME_SWAP`/`RENAME_EXCL`/`RENAME_NOFOLLOW_ANY`.
#[derive(Clone, Copy, Default)]
pub struct Renameat2Flags {
    pub exchange: bool,
    pub exclude: bool,
    pub nofollow: bool,
}

impl Renameat2Flags {
    #[inline]
    pub fn int(self) -> u32 {
        let mut flags: u32 = 0;
        #[cfg(target_os = "macos")]
        {
            // <sys/stdio.h>: RENAME_SWAP=2, RENAME_EXCL=4, RENAME_NOFOLLOW_ANY=0x10
            if self.exchange { flags |= 2; }
            if self.exclude { flags |= 4; }
            if self.nofollow { flags |= 0x10; }
        }
        #[cfg(target_os = "linux")]
        {
            if self.exchange { flags |= libc::RENAME_EXCHANGE; }
            if self.exclude { flags |= libc::RENAME_NOREPLACE; }
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            if self.exchange { flags |= 1; }
            if self.exclude { flags |= 2; }
            let _ = self.nofollow;
        }
        flags
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Syscall tag — `enum(u8)` in spec (sys.zig:218-326). Newtype-over-u8 here so
// the discriminants match Zig's positional ordinals 1:1 for FFI / cross-lang
// comparison. PORTING.md §Forbidden flags wrong-discriminants as a logic-bug.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Tag(pub u8);
pub mod syscall {
    pub use super::Tag;
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.O` — open flags. cfg-per-platform; values match libc.
// ──────────────────────────────────────────────────────────────────────────
pub mod O {
    pub const RDONLY: i32 = libc::O_RDONLY;
    pub const WRONLY: i32 = libc::O_WRONLY;
    pub const RDWR: i32 = libc::O_RDWR;
    pub const CREAT: i32 = libc::O_CREAT;
    pub const TRUNC: i32 = libc::O_TRUNC;
    pub const APPEND: i32 = libc::O_APPEND;
    pub const EXCL: i32 = libc::O_EXCL;
    pub const NONBLOCK: i32 = libc::O_NONBLOCK;
    pub const CLOEXEC: i32 = libc::O_CLOEXEC;
    #[cfg(unix)] pub const DIRECTORY: i32 = libc::O_DIRECTORY;
    #[cfg(windows)] pub const DIRECTORY: i32 = 0;
    #[cfg(target_os = "linux")] pub const PATH: i32 = libc::O_PATH;
    #[cfg(target_os = "linux")] pub const NOATIME: i32 = libc::O_NOATIME;
    #[cfg(target_os = "linux")] pub const TMPFILE: i32 = libc::O_TMPFILE;
    #[cfg(not(target_os = "linux"))] pub const PATH: i32 = 0;
    #[cfg(not(target_os = "linux"))] pub const NOATIME: i32 = 0;
    #[cfg(not(target_os = "linux"))] pub const TMPFILE: i32 = 0;
    // sys.zig:66-216 — defined for every platform; Darwin-only flags map to 0
    // elsewhere so `flags & O.EVTONLY` etc. compile and are no-ops.
    #[cfg(unix)] pub const NOFOLLOW: i32 = libc::O_NOFOLLOW;
    #[cfg(windows)] pub const NOFOLLOW: i32 = 0o400000;
    #[cfg(unix)] pub const SYNC: i32 = libc::O_SYNC;
    #[cfg(windows)] pub const SYNC: i32 = 0o4010000;
    #[cfg(unix)] pub const DSYNC: i32 = libc::O_DSYNC;
    #[cfg(windows)] pub const DSYNC: i32 = 0o10000;
    #[cfg(unix)] pub const NOCTTY: i32 = libc::O_NOCTTY;
    #[cfg(windows)] pub const NOCTTY: i32 = 0;
    #[cfg(unix)] pub const ACCMODE: i32 = libc::O_ACCMODE;
    #[cfg(windows)] pub const ACCMODE: i32 = 3;
    #[cfg(target_os = "macos")] pub const SYMLINK: i32 = libc::O_SYMLINK;
    #[cfg(not(target_os = "macos"))] pub const SYMLINK: i32 = 0;
    #[cfg(target_os = "macos")] pub const EVTONLY: i32 = libc::O_EVTONLY;
    #[cfg(not(target_os = "macos"))] pub const EVTONLY: i32 = 0;
}

// ──────────────────────────────────────────────────────────────────────────
// `File` — high-level handle. B-1 stub; B-2 wires read/write/stat.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
pub struct File { pub handle: Fd }
impl File {
    #[inline] pub fn from_fd(fd: Fd) -> Self { Self { handle: fd } }
    #[inline] pub fn handle(&self) -> Fd { self.handle }
    /// `bun.sys.File.from(.stdin())` — wrap the cached stdin fd. Do not close.
    #[inline] pub fn stdin() -> Self { Self { handle: Fd::stdin() } }
    #[inline] pub fn stdout() -> Self { Self { handle: Fd::stdout() } }
    #[inline] pub fn stderr() -> Self { Self { handle: Fd::stderr() } }
}
/// `bun.sys.File` is also reachable as `bun_sys::file::File` (Zig: `sys.File`).
pub mod file {
    pub use super::File;
    /// Port of `bun.sys.File.ReadToEndResult` — `{ bytes, err? }` pair so
    /// callers can recover the partially-read buffer even on error (Zig
    /// returns the buffer regardless and tags `.err`).
    #[derive(Default)]
    pub struct ReadToEndResult {
        pub bytes: Vec<u8>,
        pub err: Option<super::Error>,
    }
    impl ReadToEndResult {
        #[inline]
        pub fn unwrap(self) -> core::result::Result<Vec<u8>, super::Error> {
            match self.err { Some(e) => Err(e), None => Ok(self.bytes) }
        }
    }
}

/// `std.fs.cwd()` — Zig callers do `bun_sys::cwd()` for the process cwd `Dir`.
#[inline] pub fn cwd() -> Dir { Dir::cwd() }

pub type Stat = libc::stat;

// ──────────────────────────────────────────────────────────────────────────
// Syscall surface — real posix libc FFI. Windows path stays gated in
// `lib_draft_b1.rs` (NT/kernel32/libuv triad); these `#[cfg(unix)]` impls
// match `src/sys/sys.zig` posix arms 1:1.
// ──────────────────────────────────────────────────────────────────────────
use bun_core::ZStr;

/// Read thread-local libc errno (set by the failing syscall).
#[cfg(unix)]
#[inline]
pub fn last_errno() -> i32 {
    // SAFETY: __errno_location()/__error() return a valid thread-local int*.
    unsafe { *errno_ptr() }
}
#[cfg(target_os = "linux")]
#[inline] unsafe fn errno_ptr() -> *mut i32 { unsafe { libc::__errno_location() } }
#[cfg(target_os = "macos")]
#[inline] unsafe fn errno_ptr() -> *mut i32 { unsafe { libc::__error() } }
#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
#[inline] unsafe fn errno_ptr() -> *mut i32 { unsafe { libc::__errno_location() } }
#[cfg(windows)]
#[inline] fn last_errno() -> i32 { 0 /* TODO(b2-windows): GetLastError() */ }

/// `std.c._errno()` — pointer to thread-local errno. Prefer `last_errno()`
/// for the value; this exists for callers that match the Zig `*_errno()` API
/// shape (`unsafe { *bun_sys::errno() }`).
#[cfg(unix)]
#[inline]
pub unsafe fn errno() -> *mut i32 { unsafe { errno_ptr() } }

/// `std.posix.toPosixPath` — copy `path` into a NUL-terminated buffer.
/// Returns `NameTooLong` if `path` contains an interior NUL.
#[inline]
pub fn to_posix_path(path: &[u8]) -> core::result::Result<std::ffi::CString, bun_core::Error> {
    std::ffi::CString::new(path).map_err(|_| bun_core::err!("NameTooLong"))
}

#[inline]
fn err_with(tag: Tag) -> Error {
    Error::from_code_int(last_errno(), tag)
}
#[inline]
fn err_with_path(tag: Tag, path: &ZStr) -> Error {
    err_with(tag).with_path(path.as_bytes())
}

// Syscall tags — discriminants MUST match `sys.zig:218-326` positional
// ordinals exactly (FFI-observable). Do not reorder; append-only.
impl Tag {
    pub const TODO: Tag = Tag(0);
    pub const dup: Tag = Tag(1);
    pub const access: Tag = Tag(2);
    pub const connect: Tag = Tag(3);
    pub const chmod: Tag = Tag(4);
    pub const chown: Tag = Tag(5);
    pub const clonefile: Tag = Tag(6);
    pub const clonefileat: Tag = Tag(7);
    pub const close: Tag = Tag(8);
    pub const copy_file_range: Tag = Tag(9);
    pub const copyfile: Tag = Tag(10);
    pub const fchmod: Tag = Tag(11);
    pub const fchmodat: Tag = Tag(12);
    pub const fchown: Tag = Tag(13);
    pub const fcntl: Tag = Tag(14);
    pub const fdatasync: Tag = Tag(15);
    pub const fstat: Tag = Tag(16);
    pub const fstatat: Tag = Tag(17);
    pub const fsync: Tag = Tag(18);
    pub const ftruncate: Tag = Tag(19);
    pub const futimens: Tag = Tag(20);
    pub const getdents64: Tag = Tag(21);
    pub const getdirentries64: Tag = Tag(22);
    pub const lchmod: Tag = Tag(23);
    pub const lchown: Tag = Tag(24);
    pub const link: Tag = Tag(25);
    pub const lseek: Tag = Tag(26);
    pub const lstat: Tag = Tag(27);
    pub const lutime: Tag = Tag(28);
    pub const mkdir: Tag = Tag(29);
    pub const mkdtemp: Tag = Tag(30);
    pub const fnctl: Tag = Tag(31);
    pub const memfd_create: Tag = Tag(32);
    pub const mmap: Tag = Tag(33);
    pub const munmap: Tag = Tag(34);
    pub const open: Tag = Tag(35);
    pub const pread: Tag = Tag(36);
    pub const pwrite: Tag = Tag(37);
    pub const read: Tag = Tag(38);
    pub const readlink: Tag = Tag(39);
    pub const rename: Tag = Tag(40);
    pub const stat: Tag = Tag(41);
    pub const statfs: Tag = Tag(42);
    pub const symlink: Tag = Tag(43);
    pub const symlinkat: Tag = Tag(44);
    pub const unlink: Tag = Tag(45);
    pub const utime: Tag = Tag(46);
    pub const utimensat: Tag = Tag(47);
    pub const write: Tag = Tag(48);
    pub const getcwd: Tag = Tag(49);
    pub const getenv: Tag = Tag(50);
    pub const chdir: Tag = Tag(51);
    pub const fcopyfile: Tag = Tag(52);
    pub const recv: Tag = Tag(53);
    pub const send: Tag = Tag(54);
    pub const sendfile: Tag = Tag(55);
    pub const sendmmsg: Tag = Tag(56);
    pub const splice: Tag = Tag(57);
    pub const rmdir: Tag = Tag(58);
    pub const truncate: Tag = Tag(59);
    pub const realpath: Tag = Tag(60);
    pub const futime: Tag = Tag(61);
    pub const pidfd_open: Tag = Tag(62);
    pub const poll: Tag = Tag(63);
    pub const ppoll: Tag = Tag(64);
    pub const watch: Tag = Tag(65);
    pub const scandir: Tag = Tag(66);
    pub const kevent: Tag = Tag(67);
    pub const kqueue: Tag = Tag(68);
    pub const epoll_ctl: Tag = Tag(69);
    pub const kill: Tag = Tag(70);
    pub const waitpid: Tag = Tag(71);
    pub const posix_spawn: Tag = Tag(72);
    pub const getaddrinfo: Tag = Tag(73);
    pub const writev: Tag = Tag(74);
    pub const pwritev: Tag = Tag(75);
    pub const readv: Tag = Tag(76);
    pub const preadv: Tag = Tag(77);
    pub const ioctl_ficlone: Tag = Tag(78);
    pub const accept: Tag = Tag(79);
    pub const bind2: Tag = Tag(80);
    pub const connect2: Tag = Tag(81);
    pub const listen: Tag = Tag(82);
    pub const pipe: Tag = Tag(83);
    pub const try_write: Tag = Tag(84);
    pub const socketpair: Tag = Tag(85);
    pub const setsockopt: Tag = Tag(86);
    pub const statx: Tag = Tag(87);
    pub const rm: Tag = Tag(88);
    pub const uv_spawn: Tag = Tag(89);
    pub const uv_pipe: Tag = Tag(90);
    pub const uv_tty_set_mode: Tag = Tag(91);
    pub const uv_open_osfhandle: Tag = Tag(92);
    pub const uv_os_homedir: Tag = Tag(93);
    pub const WriteFile: Tag = Tag(94);
    pub const NtQueryDirectoryFile: Tag = Tag(95);
    pub const NtSetInformationFile: Tag = Tag(96);
    pub const GetFinalPathNameByHandle: Tag = Tag(97);
    pub const CloseHandle: Tag = Tag(98);
    pub const SetFilePointerEx: Tag = Tag(99);
    pub const SetEndOfFile: Tag = Tag(100);
    // ── PORT NOTE: tags below this line are Rust-port-only (no Zig ordinal).
    // They sit above the Zig range so a Zig-produced `Tag` never collides.
    // TODO(port): upstream these into sys.zig's `Tag` enum, then realign.
    pub const dup2: Tag = Tag(101);
    pub const fchdir: Tag = Tag(102);
    pub const fchownat: Tag = Tag(103);
    pub const ioctl: Tag = Tag(104);
    // PORT NOTE: sys.zig folds `inotify_init1`/`inotify_add_watch` under the
    // generic `.watch` tag; `INotifyWatcher.rs` was ported against the
    // draft-b1 enum that had a distinct `.inotify` variant. Alias to `.watch`
    // so the JS-facing `err.syscall == "watch"` string stays node-compatible.
    pub const inotify: Tag = Tag::watch;

    /// `@tagName(self)` — must match sys.zig spelling exactly (JS-facing
    /// `err.syscall` string; node-compat code matches on it).
    pub fn name(self) -> &'static str {
        const NAMES: [&str; 105] = [
            "TODO", "dup", "access", "connect", "chmod", "chown", "clonefile",
            "clonefileat", "close", "copy_file_range", "copyfile", "fchmod",
            "fchmodat", "fchown", "fcntl", "fdatasync", "fstat", "fstatat",
            "fsync", "ftruncate", "futimens", "getdents64", "getdirentries64",
            "lchmod", "lchown", "link", "lseek", "lstat", "lutime", "mkdir",
            "mkdtemp", "fnctl", "memfd_create", "mmap", "munmap", "open",
            "pread", "pwrite", "read", "readlink", "rename", "stat", "statfs",
            "symlink", "symlinkat", "unlink", "utime", "utimensat", "write",
            "getcwd", "getenv", "chdir", "fcopyfile", "recv", "send",
            "sendfile", "sendmmsg", "splice", "rmdir", "truncate", "realpath",
            "futime", "pidfd_open", "poll", "ppoll", "watch", "scandir",
            "kevent", "kqueue", "epoll_ctl", "kill", "waitpid", "posix_spawn",
            "getaddrinfo", "writev", "pwritev", "readv", "preadv",
            "ioctl_ficlone", "accept", "bind2", "connect2", "listen", "pipe",
            "try_write", "socketpair", "setsockopt", "statx", "rm", "uv_spawn",
            "uv_pipe", "uv_tty_set_mode", "uv_open_osfhandle", "uv_os_homedir",
            "WriteFile", "NtQueryDirectoryFile", "NtSetInformationFile",
            "GetFinalPathNameByHandle", "CloseHandle", "SetFilePointerEx",
            "SetEndOfFile",
            // port-only
            "dup2", "fchdir", "fchownat", "ioctl",
        ];
        NAMES.get(self.0 as usize).copied().unwrap_or("unknown")
    }

    /// sys.zig:327-329 — `Tag.isWindows`: tags strictly above `WriteFile`
    /// belong to the Windows-only block. Bounded by `SetEndOfFile` so the
    /// Rust-port-only POSIX tags (`dup2`/`fchdir`/`fchownat`/`ioctl`) parked
    /// above the Zig range don't read as Windows.
    #[inline]
    pub const fn is_windows(self) -> bool {
        self.0 > Self::WriteFile.0 && self.0 <= Self::SetEndOfFile.0
    }
}
impl From<Tag> for &'static str {
    #[inline] fn from(t: Tag) -> &'static str { t.name() }
}

/// Max single read/write count (sys.zig:1832): Linux caps at 0x7ffff000;
/// Darwin/BSD use signed 32-bit byte counts.
#[cfg(target_os = "linux")]
pub const MAX_COUNT: usize = 0x7ffff000;
#[cfg(all(unix, not(target_os = "linux")))]
pub const MAX_COUNT: usize = i32::MAX as usize;
#[cfg(windows)]
pub const MAX_COUNT: usize = u32::MAX as usize;

// ── Darwin `$NOCANCEL` syscall variants (sys.zig:1708,1853,2077,2139,2253,2297)
// — the plain libc symbols are pthread cancellation points; a cancelled thread
// torn down mid-syscall leaks fds / corrupts state. Bun always uses the
// non-cancellable variants on macOS (`bun.darwin.nocancel`).
#[cfg(target_os = "macos")]
mod nocancel {
    use core::ffi::c_int;
    unsafe extern "C" {
        #[link_name = "open$NOCANCEL"]
        pub fn open(path: *const libc::c_char, flags: c_int, mode: libc::c_uint) -> c_int;
        #[link_name = "openat$NOCANCEL"]
        pub fn openat(dirfd: c_int, path: *const libc::c_char, flags: c_int, mode: libc::c_uint) -> c_int;
        #[link_name = "read$NOCANCEL"]
        pub fn read(fd: c_int, buf: *mut libc::c_void, count: usize) -> isize;
        #[link_name = "write$NOCANCEL"]
        pub fn write(fd: c_int, buf: *const libc::c_void, count: usize) -> isize;
        #[link_name = "pread$NOCANCEL"]
        pub fn pread(fd: c_int, buf: *mut libc::c_void, count: usize, off: libc::off_t) -> isize;
        #[link_name = "pwrite$NOCANCEL"]
        pub fn pwrite(fd: c_int, buf: *const libc::c_void, count: usize, off: libc::off_t) -> isize;
        #[link_name = "pwritev$NOCANCEL"]
        pub fn pwritev(fd: c_int, iov: *const libc::iovec, iovcnt: c_int, off: libc::off_t) -> isize;
        #[link_name = "preadv$NOCANCEL"]
        pub fn preadv(fd: c_int, iov: *const libc::iovec, iovcnt: c_int, off: libc::off_t) -> isize;
        #[link_name = "readv$NOCANCEL"]
        pub fn readv(fd: c_int, iov: *const libc::iovec, iovcnt: c_int) -> isize;
        #[link_name = "writev$NOCANCEL"]
        pub fn writev(fd: c_int, iov: *const libc::iovec, iovcnt: c_int) -> isize;
        #[link_name = "recvfrom$NOCANCEL"]
        pub fn recvfrom(fd: c_int, buf: *mut libc::c_void, len: usize, flags: c_int, addr: *mut libc::sockaddr, alen: *mut libc::socklen_t) -> isize;
        #[link_name = "sendto$NOCANCEL"]
        pub fn sendto(fd: c_int, buf: *const libc::c_void, len: usize, flags: c_int, addr: *const libc::sockaddr, alen: libc::socklen_t) -> isize;
        #[link_name = "poll$NOCANCEL"]
        pub fn poll(fds: *mut libc::pollfd, nfds: libc::nfds_t, timeout: c_int) -> c_int;
        #[link_name = "ppoll$NOCANCEL"]
        pub fn ppoll(fds: *mut libc::pollfd, nfds: libc::nfds_t, ts: *const libc::timespec, sigmask: *const libc::sigset_t) -> c_int;
        // darwin.zig:12-17 + fd.zig:273 — remaining `$NOCANCEL` variants Bun
        // links against (close via Zig's std.c on Darwin).
        #[link_name = "close$NOCANCEL"]
        pub fn close(fd: c_int) -> c_int;
        #[link_name = "fcntl$NOCANCEL"]
        pub fn fcntl(fd: c_int, cmd: c_int, ...) -> c_int;
        #[link_name = "connect$NOCANCEL"]
        pub fn connect(sockfd: c_int, addr: *const libc::sockaddr, alen: libc::socklen_t) -> c_int;
        #[link_name = "accept$NOCANCEL"]
        pub fn accept(sockfd: c_int, addr: *mut libc::sockaddr, alen: *mut libc::socklen_t) -> c_int;
        #[link_name = "accept4$NOCANCEL"]
        pub fn accept4(sockfd: c_int, addr: *mut libc::sockaddr, alen: *mut libc::socklen_t, flags: libc::c_uint) -> c_int;
    }
}

#[cfg(unix)]
mod posix_impl {
    use super::*;
    // Per-platform raw syscall dispatch — macOS uses `$NOCANCEL`, everything
    // else goes straight to libc.
    #[inline] unsafe fn sys_open(p: *const libc::c_char, f: i32, m: libc::c_uint) -> i32 {
        #[cfg(target_os = "macos")] { unsafe { super::nocancel::open(p, f, m) } }
        #[cfg(not(target_os = "macos"))] { unsafe { libc::open(p, f, m) } }
    }
    #[inline] unsafe fn sys_openat(d: i32, p: *const libc::c_char, f: i32, m: libc::c_uint) -> i32 {
        #[cfg(target_os = "macos")] { unsafe { super::nocancel::openat(d, p, f, m) } }
        #[cfg(not(target_os = "macos"))] { unsafe { libc::openat(d, p, f, m) } }
    }
    #[inline] unsafe fn sys_read(fd: i32, buf: *mut libc::c_void, n: usize) -> isize {
        #[cfg(target_os = "macos")] { unsafe { super::nocancel::read(fd, buf, n) } }
        #[cfg(not(target_os = "macos"))] { unsafe { libc::read(fd, buf, n) } }
    }
    #[inline] unsafe fn sys_write(fd: i32, buf: *const libc::c_void, n: usize) -> isize {
        #[cfg(target_os = "macos")] { unsafe { super::nocancel::write(fd, buf, n) } }
        #[cfg(not(target_os = "macos"))] { unsafe { libc::write(fd, buf, n) } }
    }
    #[inline] unsafe fn sys_pread(fd: i32, buf: *mut libc::c_void, n: usize, off: i64) -> isize {
        #[cfg(target_os = "macos")] { unsafe { super::nocancel::pread(fd, buf, n, off) } }
        #[cfg(not(target_os = "macos"))] { unsafe { libc::pread(fd, buf, n, off) } }
    }
    #[inline] unsafe fn sys_pwrite(fd: i32, buf: *const libc::c_void, n: usize, off: i64) -> isize {
        #[cfg(target_os = "macos")] { unsafe { super::nocancel::pwrite(fd, buf, n, off) } }
        #[cfg(not(target_os = "macos"))] { unsafe { libc::pwrite(fd, buf, n, off) } }
    }
    #[inline] unsafe fn sys_recv(fd: i32, buf: *mut libc::c_void, n: usize, flags: i32) -> isize {
        #[cfg(target_os = "macos")] { unsafe { super::nocancel::recvfrom(fd, buf, n, flags, core::ptr::null_mut(), core::ptr::null_mut()) } }
        #[cfg(not(target_os = "macos"))] { unsafe { libc::recv(fd, buf, n, flags) } }
    }
    #[inline] unsafe fn sys_send(fd: i32, buf: *const libc::c_void, n: usize, flags: i32) -> isize {
        #[cfg(target_os = "macos")] { unsafe { super::nocancel::sendto(fd, buf, n, flags, core::ptr::null(), 0) } }
        #[cfg(not(target_os = "macos"))] { unsafe { libc::send(fd, buf, n, flags) } }
    }
    // EINTR-retry: most sys.zig wrappers loop `while (true) { …; if errno ==
    // .INTR continue; }`. NOT all — the macOS `$NOCANCEL` arms for open/openat/
    // read/write/recv/send (sys.zig:1706-1712,1851-1860,2138-2147,2252-2262,
    // 2294-2306) issue exactly one call and surface EINTR to the caller without
    // looping. `check!` keeps the retry for the common path; `check_once!`
    // matches the spec's single-shot Darwin arms.
    macro_rules! check { ($rc:expr, $tag:expr) => {{
        loop {
            let rc = $rc;
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, $tag));
            }
            break rc;
        }
    }}}
    macro_rules! check_p { ($rc:expr, $tag:expr, $path:expr) => {{
        loop {
            let rc = $rc;
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, $tag).with_path($path.as_bytes()));
            }
            break rc;
        }
    }}}
    // `errnoSysFP` (runtime/node.zig:296) — attaches BOTH `.fd` and `.path`.
    macro_rules! check_fp { ($rc:expr, $tag:expr, $fd:expr, $path:expr) => {{
        loop {
            let rc = $rc;
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, $tag).with_fd($fd).with_path($path.as_bytes()));
            }
            break rc;
        }
    }}}
    // Single-shot: no EINTR retry (Darwin `$NOCANCEL` arms).
    macro_rules! check_once { ($rc:expr, $tag:expr) => {{
        let rc = $rc;
        if rc < 0 { return Err(Error::from_code_int(last_errno(), $tag)); }
        rc
    }}}
    macro_rules! check_once_p { ($rc:expr, $tag:expr, $path:expr) => {{
        let rc = $rc;
        if rc < 0 { return Err(Error::from_code_int(last_errno(), $tag).with_path($path.as_bytes())); }
        rc
    }}}

    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        // sys.zig:1706 — .mac arm: single `open$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let rc = check_once_p!(unsafe { sys_open(path.as_ptr(), flags, mode as libc::c_uint) }, Tag::open, path);
        #[cfg(not(target_os = "macos"))]
        let rc = check_p!(unsafe { sys_open(path.as_ptr(), flags, mode as libc::c_uint) }, Tag::open, path);
        Ok(Fd::from_native(rc))
    }
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        // sys.zig:1706-1712 — .mac arm: single `openat$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let rc = check_once_p!(unsafe { sys_openat(dir.native(), path.as_ptr(), flags, mode as libc::c_uint) }, Tag::open, path);
        #[cfg(not(target_os = "macos"))]
        let rc = check_p!(unsafe { sys_openat(dir.native(), path.as_ptr(), flags, mode as libc::c_uint) }, Tag::open, path);
        Ok(Fd::from_native(rc))
    }
    pub fn close(fd: Fd) -> Maybe<()> {
        // fd.zig:266 — call close ONCE; never retry on EINTR (Linux may have already
        // released the fd, retrying would close someone else's). Only EBADF surfaces.
        // fd.zig:273 — Darwin uses `close$NOCANCEL` (avoid pthread cancellation point).
        // SAFETY: fd is a valid open descriptor owned by caller.
        #[cfg(target_os = "macos")]
        let rc = unsafe { super::nocancel::close(fd.native()) };
        #[cfg(not(target_os = "macos"))]
        let rc = unsafe { libc::close(fd.native()) };
        if rc < 0 && last_errno() == libc::EBADF {
            return Err(Error::from_code_int(libc::EBADF, Tag::close).with_fd(fd));
        }
        Ok(())
    }
    pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        // sys.zig:2138-2147 — .mac arm: single `read$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let n = check_once!(unsafe { sys_read(fd.native(), buf.as_mut_ptr().cast(), len) }, Tag::read);
        #[cfg(not(target_os = "macos"))]
        let n = check!(unsafe { sys_read(fd.native(), buf.as_mut_ptr().cast(), len) }, Tag::read);
        Ok(n as usize)
    }
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        // sys.zig:1851-1860 — .mac arm: single `write$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let n = check_once!(unsafe { sys_write(fd.native(), buf.as_ptr().cast(), len) }, Tag::write);
        #[cfg(not(target_os = "macos"))]
        let n = check!(unsafe { sys_write(fd.native(), buf.as_ptr().cast(), len) }, Tag::write);
        Ok(n as usize)
    }
    pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        let n = check!(unsafe { sys_pread(fd.native(), buf.as_mut_ptr().cast(), len, off) }, Tag::pread);
        Ok(n as usize)
    }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        let n = check!(unsafe { sys_pwrite(fd.native(), buf.as_ptr().cast(), len, off) }, Tag::pwrite);
        Ok(n as usize)
    }
    pub fn stat(path: &ZStr) -> Maybe<Stat> {
        let mut st = core::mem::MaybeUninit::<Stat>::uninit();
        check_p!(unsafe { libc::stat(path.as_ptr(), st.as_mut_ptr()) }, Tag::stat, path);
        Ok(unsafe { st.assume_init() })
    }
    pub fn fstat(fd: Fd) -> Maybe<Stat> {
        let mut st = core::mem::MaybeUninit::<Stat>::uninit();
        check!(unsafe { libc::fstat(fd.native(), st.as_mut_ptr()) }, Tag::fstat);
        Ok(unsafe { st.assume_init() })
    }
    pub fn lstat(path: &ZStr) -> Maybe<Stat> {
        let mut st = core::mem::MaybeUninit::<Stat>::uninit();
        check_p!(unsafe { libc::lstat(path.as_ptr(), st.as_mut_ptr()) }, Tag::lstat, path);
        Ok(unsafe { st.assume_init() })
    }
    pub fn mkdir(path: &ZStr, mode: Mode) -> Maybe<()> {
        check_p!(unsafe { libc::mkdir(path.as_ptr(), mode) }, Tag::mkdir, path); Ok(())
    }
    pub fn mkdirat(dir: Fd, path: &ZStr, mode: Mode) -> Maybe<()> {
        // sys.zig:809 — `mkdiratZ` tags errors as `.mkdir` (not `.mkdirat`).
        check_p!(unsafe { libc::mkdirat(dir.native(), path.as_ptr(), mode) }, Tag::mkdir, path); Ok(())
    }
    /// `bun.makePath` — `mkdirat` walking up parents on ENOENT, like `mkdir -p`.
    /// Port of std.fs.Dir.makePath (Zig std/fs/Dir.zig).
    pub fn mkdir_recursive_at(dir: Fd, sub_path: &[u8]) -> Maybe<()> {
        // PERF(port): Zig leaves the buffer `undefined`; zero-fill here for
        // simplicity. Stack-local, no heap.
        let mut buf = [0u8; bun_core::MAX_PATH_BYTES];
        if sub_path.len() >= buf.len() {
            // sys.zig:809 — `mkdiratZ` tags as `.mkdir`; keep consistent here.
            return Err(Error::from_code_int(E::ENAMETOOLONG as _, Tag::mkdir).with_path(sub_path));
        }
        buf[..sub_path.len()].copy_from_slice(sub_path);
        let mut end = sub_path.len();
        while end > 0 && buf[end - 1] == bun_core::SEP { end -= 1; } // trim trailing seps
        buf[end] = 0;
        // Stack of separator positions we NUL'd while peeling back, so each
        // can be restored before re-creating its component on the way up.
        // Worst case: every other byte is a separator (`a/a/a/...`), so the
        // stack can hold at most `MAX_PATH_BYTES / 2` entries — `sub_path` is
        // bounds-checked against `MAX_PATH_BYTES` above so this never overflows.
        let mut nuls = [0u16; bun_core::MAX_PATH_BYTES / 2];
        let mut nuls_len = 0usize;
        let mut peel = end;
        // Walk down: try mkdirat; on ENOENT, peel one component.
        loop {
            // SAFETY: buf[0..=peel] is NUL-terminated (initial buf[end]=0 or a
            // peeled '/' overwritten below).
            let z = unsafe { ZStr::from_raw(buf.as_ptr(), peel) };
            match mkdirat(dir, z, 0o755) {
                Ok(()) => break,
                Err(e) if e.get_errno() == E::EEXIST => break,
                Err(e) if e.get_errno() == E::ENOENT => {
                    let Some(slash) = buf[..peel].iter().rposition(|&b| b == bun_core::SEP) else {
                        return Err(e);
                    };
                    if slash == 0 { return Err(e); }
                    peel = slash;
                    buf[peel] = 0;
                    nuls[nuls_len] = peel as u16;
                    nuls_len += 1;
                }
                Err(e) => return Err(e),
            }
        }
        // Walk back up, restoring each '/' and creating that prefix.
        while nuls_len > 0 {
            nuls_len -= 1;
            let pos = nuls[nuls_len] as usize;
            buf[pos] = bun_core::SEP;
            // The only remaining NUL above `pos` is the next entry on the
            // stack (or `end`), which is exactly the next component boundary.
            let next_end = if nuls_len > 0 { nuls[nuls_len - 1] as usize } else { end };
            // SAFETY: buf[next_end] == 0 (still un-restored or the original sentinel).
            let z = unsafe { ZStr::from_raw(buf.as_ptr(), next_end) };
            match mkdirat(dir, z, 0o755) {
                Ok(()) => {}
                Err(e) if e.get_errno() == E::EEXIST => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
    pub fn unlink(path: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::unlink(path.as_ptr()) }, Tag::unlink, path); Ok(())
    }
    pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::rename(from.as_ptr(), to.as_ptr()) }, Tag::rename, from); Ok(())
    }
    pub fn renameat(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::renameat(from_dir.native(), from.as_ptr(), to_dir.native(), to.as_ptr()) }, Tag::rename, from);
        Ok(())
    }
    /// `renameat2(2)` (Linux) / `renameatx_np` (macOS). FreeBSD and any other
    /// unix without an atomic-exchange rename get `ENOSYS` when flags are set,
    /// matching `bun.sys.renameat2` (sys.zig:2503).
    pub fn renameat2(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr, flags: Renameat2Flags) -> Maybe<()> {
        #[cfg(target_os = "linux")]
        {
            // SAFETY: FFI; all pointers/fds valid for the duration of the call.
            check_p!(
                unsafe {
                    libc::syscall(
                        libc::SYS_renameat2,
                        from_dir.native() as libc::c_long,
                        from.as_ptr(),
                        to_dir.native() as libc::c_long,
                        to.as_ptr(),
                        flags.int() as libc::c_long,
                    )
                },
                Tag::rename, from
            );
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" {
                fn renameatx_np(
                    fromfd: libc::c_int, from: *const libc::c_char,
                    tofd: libc::c_int, to: *const libc::c_char,
                    flags: libc::c_uint,
                ) -> libc::c_int;
            }
            // SAFETY: FFI; all pointers/fds valid for the duration of the call.
            check_p!(
                unsafe { renameatx_np(from_dir.native(), from.as_ptr(), to_dir.native(), to.as_ptr(), flags.int()) },
                Tag::rename, from
            );
            return Ok(());
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            if flags.int() != 0 {
                return Err(Error::from_code_int(libc::ENOSYS, Tag::rename).with_path(from.as_bytes()));
            }
            renameat(from_dir, from, to_dir, to)
        }
    }
    /// sys.zig:2884 `unlinkatWithFlags` — explicit `flags` (e.g. `AT_REMOVEDIR`).
    /// Zig builds the error via `errnoSysFP(.., .unlink, dirfd, to)` so the
    /// surfaced `SystemError` carries BOTH the dirfd and the path.
    pub fn unlinkat_with_flags(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()> {
        check_fp!(unsafe { libc::unlinkat(dir.native(), path.as_ptr(), flags) }, Tag::unlink, dir, path); Ok(())
    }
    /// sys.zig:2912 `unlinkat` — 2-arg form (`flags = 0`). Zig's surface is
    /// 2-arg; the 3-arg variant is `unlinkatWithFlags`.
    #[inline]
    pub fn unlinkat(dir: Fd, path: &ZStr) -> Maybe<()> {
        unlinkat_with_flags(dir, path, 0)
    }
    pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::symlink(target.as_ptr(), link.as_ptr()) }, Tag::symlink, link); Ok(())
    }
    pub fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let n = check_p!(unsafe { libc::readlink(path.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) }, Tag::readlink, path);
        let n = n as usize;
        // sys.zig:2368 — truncation guard + NUL-terminate.
        if n >= buf.len() {
            return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::readlink).with_path(path.as_bytes()));
        }
        buf[n] = 0;
        Ok(n)
    }
    /// sys.zig:3897 — `fcntl(F_DUPFD_CLOEXEC, 0)` so the dup'd fd doesn't leak
    /// to children. NOT `dup(2)` (which lacks CLOEXEC).
    pub fn dup(fd: Fd) -> Maybe<Fd> {
        // sys.zig:959 `errnoSysFd(.., .fcntl, fd)` — attach the fd on error.
        loop {
            let rc = unsafe { libc::fcntl(fd.native(), libc::F_DUPFD_CLOEXEC, 0) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, Tag::fcntl).with_fd(fd));
            }
            return Ok(Fd::from_native(rc));
        }
    }
    pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
        check!(unsafe { libc::fchmod(fd.native(), mode) }, Tag::fchmod); Ok(())
    }
    pub fn fchown(fd: Fd, uid: u32, gid: u32) -> Maybe<()> {
        check!(unsafe { libc::fchown(fd.native(), uid, gid) }, Tag::fchown); Ok(())
    }
    pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()> {
        check!(unsafe { libc::ftruncate(fd.native(), len) }, Tag::ftruncate); Ok(())
    }
    pub fn getcwd(buf: &mut [u8]) -> Maybe<usize> {
        let p = unsafe { libc::getcwd(buf.as_mut_ptr().cast(), buf.len()) };
        if p.is_null() { return Err(err_with(Tag::getcwd)); }
        Ok(unsafe { libc::strlen(p) })
    }
    pub fn page_size() -> usize {
        unsafe { libc::sysconf(libc::_SC_PAGESIZE) as usize }
    }

    // ── B-2 round 9: link/perm/time/access group (sys.zig:406-3973 posix arms) ──
    pub fn link(src: &ZStr, dest: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::link(src.as_ptr(), dest.as_ptr()) }, Tag::link, src); Ok(())
    }
    pub fn linkat(src_dir: Fd, src: &ZStr, dest_dir: Fd, dest: &ZStr) -> Maybe<()> {
        // sys.zig:3963 — `linkatZ` tags as `.link`.
        check_p!(
            unsafe { libc::linkat(src_dir.native(), src.as_ptr(), dest_dir.native(), dest.as_ptr(), 0) },
            Tag::link, src
        );
        Ok(())
    }
    /// `linkatTmpfile` (sys.zig:3973): materialize an `O_TMPFILE` fd. Fast path
    /// uses `linkat(tmpfd, "", dirfd, name, AT_EMPTY_PATH)` (requires
    /// CAP_DAC_READ_SEARCH); falls back to `/proc/self/fd/N` + AT_SYMLINK_FOLLOW.
    /// Linux-only; on other unix this errors with EOPNOTSUPP (Zig same).
    #[cfg(target_os = "linux")]
    pub fn linkat_tmpfile(tmpfd: Fd, dirfd: Fd, name: &ZStr) -> Maybe<()> {
        // 0=unknown, 1=have CAP_DAC_READ_SEARCH, -1=no cap → use /proc fallback.
        static CAP_STATUS: core::sync::atomic::AtomicI32 = core::sync::atomic::AtomicI32::new(0);
        loop {
            let status = CAP_STATUS.load(core::sync::atomic::Ordering::Relaxed);
            let rc = if status != -1 {
                // SAFETY: tmpfd/dirfd valid; "" with AT_EMPTY_PATH names tmpfd itself.
                unsafe {
                    libc::linkat(tmpfd.native(), c"".as_ptr(), dirfd.native(), name.as_ptr(), libc::AT_EMPTY_PATH)
                }
            } else {
                let mut buf = [0u8; 32];
                let n = {
                    use std::io::Write as _;
                    let mut c = std::io::Cursor::new(&mut buf[..]);
                    let _ = write!(c, "/proc/self/fd/{}\0", tmpfd.native());
                    c.position() as usize - 1
                };
                let _ = n;
                // SAFETY: NUL written by the format string above.
                unsafe {
                    libc::linkat(
                        libc::AT_FDCWD, buf.as_ptr().cast(), dirfd.native(), name.as_ptr(),
                        libc::AT_SYMLINK_FOLLOW,
                    )
                }
            };
            if rc < 0 {
                let e = last_errno();
                match e {
                    libc::EINTR => continue,
                    libc::EISDIR | libc::ENOENT | libc::EOPNOTSUPP | libc::EPERM | libc::EINVAL if status == 0 => {
                        // sys.zig:4013 — first failure on AT_EMPTY_PATH ⇒ no cap; retry via /proc.
                        CAP_STATUS.store(-1, core::sync::atomic::Ordering::Relaxed);
                        continue;
                    }
                    _ => return Err(Error::from_code_int(e, Tag::link).with_fd(tmpfd)),
                }
            }
            if status == 0 {
                CAP_STATUS.store(1, core::sync::atomic::Ordering::Relaxed);
            }
            return Ok(());
        }
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    pub fn linkat_tmpfile(_tmpfd: Fd, _dirfd: Fd, name: &ZStr) -> Maybe<()> {
        // sys.zig:4010 — `linkatTmpfile` tags as `.link` (matches Linux arm).
        Err(Error::from_code_int(libc::EOPNOTSUPP, Tag::link).with_path(name.as_bytes()))
    }
    pub fn symlinkat(target: &ZStr, dirfd: Fd, dest: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::symlinkat(target.as_ptr(), dirfd.native(), dest.as_ptr()) }, Tag::symlinkat, dest);
        Ok(())
    }
    pub fn readlinkat(fd: Fd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        // sys.zig:2390 — tags as `.readlink`.
        let n = check_p!(
            unsafe { libc::readlinkat(fd.native(), path.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) },
            Tag::readlink, path
        );
        let n = n as usize;
        if n >= buf.len() {
            return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::readlink).with_path(path.as_bytes()));
        }
        buf[n] = 0;
        Ok(n)
    }
    pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        check_p!(unsafe { libc::chmod(path.as_ptr(), mode) }, Tag::chmod, path); Ok(())
    }
    pub fn fchmodat(dir: Fd, path: &ZStr, mode: Mode, flags: i32) -> Maybe<()> {
        check_p!(unsafe { libc::fchmodat(dir.native(), path.as_ptr(), mode, flags) }, Tag::fchmodat, path); Ok(())
    }
    /// `lchmod` is BSD/Darwin-only; Linux: `fchmodat(.., AT_SYMLINK_NOFOLLOW)` (sys.zig:434).
    pub fn lchmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        { check_p!(unsafe { libc::lchmod(path.as_ptr(), mode) }, Tag::lchmod, path); Ok(()) }
        #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
        { fchmodat(Fd::cwd(), path, mode, libc::AT_SYMLINK_NOFOLLOW) }
    }
    pub fn chown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        check_p!(unsafe { libc::chown(path.as_ptr(), uid, gid) }, Tag::chown, path); Ok(())
    }
    pub fn lchown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        check_p!(unsafe { libc::lchown(path.as_ptr(), uid, gid) }, Tag::lchown, path); Ok(())
    }
    pub fn fchownat(dir: Fd, path: &ZStr, uid: u32, gid: u32, flags: i32) -> Maybe<()> {
        check_p!(unsafe { libc::fchownat(dir.native(), path.as_ptr(), uid, gid, flags) }, Tag::fchownat, path); Ok(())
    }
    pub fn fstatat(fd: Fd, path: &ZStr) -> Maybe<Stat> {
        let mut st = core::mem::MaybeUninit::<Stat>::uninit();
        // sys.zig:848 — `bun.invalid_fd` means cwd-relative.
        let dirfd = if fd.is_valid() { fd.native() } else { libc::AT_FDCWD };
        check_p!(unsafe { libc::fstatat(dirfd, path.as_ptr(), st.as_mut_ptr(), 0) }, Tag::fstatat, path);
        Ok(unsafe { st.assume_init() })
    }
    pub fn access(path: &ZStr, mode: i32) -> Maybe<()> {
        check_p!(unsafe { libc::access(path.as_ptr(), mode) }, Tag::access, path); Ok(())
    }
    /// sys.zig:3504 — never returns `.err`; any non-zero rc → `Ok(false)`.
    pub fn faccessat(dir: Fd, sub: &ZStr) -> Maybe<bool> {
        let rc = unsafe { libc::faccessat(dir.native(), sub.as_ptr(), libc::F_OK, 0) };
        Ok(rc == 0)
    }
    pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check!(unsafe { libc::futimens(fd.native(), ts.as_ptr()) }, Tag::futimens); Ok(())
    }
    pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check_p!(
            unsafe { libc::utimensat(libc::AT_FDCWD, path.as_ptr(), ts.as_ptr(), 0) },
            Tag::utimensat, path
        );
        Ok(())
    }
    pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check_p!(
            unsafe { libc::utimensat(libc::AT_FDCWD, path.as_ptr(), ts.as_ptr(), libc::AT_SYMLINK_NOFOLLOW) },
            Tag::utimensat, path
        );
        Ok(())
    }
    /// sys.zig:1748 — Windows uses `GetFileAttributesW`; posix is plain `access`.
    pub fn exists_z(path: &ZStr) -> bool {
        unsafe { libc::access(path.as_ptr(), libc::F_OK) == 0 }
    }
    pub fn exists_at(dir: Fd, sub: &ZStr) -> bool {
        unsafe { libc::faccessat(dir.native(), sub.as_ptr(), libc::F_OK, 0) == 0 }
    }
    /// sys.zig:3767 — calls extern C `is_executable_file` (c-bindings.cpp:72-89).
    /// We FFI to the same symbol so the behaviour is identical.
    pub fn is_executable_file_path(path: &ZStr) -> bool {
        unsafe extern "C" {
            fn is_executable_file(path: *const i8) -> bool;
        }
        unsafe { is_executable_file(path.as_ptr()) }
    }
    /// sys.zig:4152 — `fstat` then `@max(st_size, 0)` (clamp negative).
    pub fn get_file_size(fd: Fd) -> Maybe<u64> {
        Ok(fstat(fd)?.st_size.max(0) as u64)
    }
    /// `realpath` — `realpath$DARWIN_EXTSN` on macOS for proper symlink resolution
    /// (Zig: `bun.c.realpath`). Writes into `buf` and returns the written slice.
    pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Maybe<&'a [u8]> {
        #[cfg(target_os = "macos")]
        unsafe extern "C" {
            #[link_name = "realpath$DARWIN_EXTSN"]
            fn _realpath(path: *const i8, resolved: *mut i8) -> *mut i8;
        }
        #[cfg(not(target_os = "macos"))]
        use libc::realpath as _realpath;
        let p = unsafe { _realpath(path.as_ptr(), buf.0.as_mut_ptr().cast()) };
        if p.is_null() { return Err(err_with_path(Tag::realpath, path)); }
        let len = unsafe { libc::strlen(p) };
        Ok(&buf.0[..len])
    }

    // ── B-2 round 9: fcntl/dup/pipe/io group ──
    pub type FcntlInt = isize;
    pub fn fcntl(fd: Fd, cmd: i32, arg: isize) -> Maybe<FcntlInt> {
        // sys.zig:959-971 — `errnoSysFd(result, .fcntl, fd)`: attach the fd to the error.
        loop {
            let rc = unsafe { libc::fcntl(fd.native(), cmd, arg) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, Tag::fcntl).with_fd(fd));
            }
            return Ok(rc as isize);
        }
    }
    pub fn dup2(old: Fd, new: Fd) -> Maybe<Fd> {
        let rc = check!(unsafe { libc::dup2(old.native(), new.native()) }, Tag::dup2);
        Ok(Fd::from_native(rc))
    }
    /// sys.zig:3839 — plain `pipe(&fds)`, NO CLOEXEC. Callers that want CLOEXEC
    /// set it themselves (matches Zig).
    pub fn pipe() -> Maybe<[Fd; 2]> {
        let mut fds = [0i32; 2];
        check!(unsafe { libc::pipe(fds.as_mut_ptr()) }, Tag::pipe);
        Ok([Fd::from_native(fds[0]), Fd::from_native(fds[1])])
    }
    pub fn isatty(fd: Fd) -> bool {
        unsafe { libc::isatty(fd.native()) == 1 }
    }
    pub fn fsync(fd: Fd) -> Maybe<()> {
        check!(unsafe { libc::fsync(fd.native()) }, Tag::fsync); Ok(())
    }
    pub fn fdatasync(fd: Fd) -> Maybe<()> {
        // node_fs.zig:3921 — calls `system.fdatasync` directly on all Unix
        // (macOS has had fdatasync(2) since 10.7). The libc crate omits the
        // Apple binding, so declare it locally.
        #[cfg(target_os = "macos")]
        extern "C" { fn fdatasync(fd: libc::c_int) -> libc::c_int; }
        #[cfg(not(target_os = "macos"))]
        use libc::fdatasync;
        check!(unsafe { fdatasync(fd.native()) }, Tag::fdatasync); Ok(())
    }
    pub fn lseek(fd: Fd, offset: i64, whence: i32) -> Maybe<i64> {
        let rc = check!(unsafe { libc::lseek(fd.native(), offset, whence) }, Tag::lseek);
        Ok(rc)
    }
    pub fn chdir(path: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::chdir(path.as_ptr()) }, Tag::chdir, path); Ok(())
    }
    pub fn fchdir(fd: Fd) -> Maybe<()> {
        check!(unsafe { libc::fchdir(fd.native()) }, Tag::fchdir); Ok(())
    }
    pub fn umask(mode: Mode) -> Mode {
        unsafe { libc::umask(mode) }
    }

    // ── B-2 round 9: socket primitives (recv/send/socketpair) ──
    // Full networking lives in `bun_uws_sys`; these are the bare libc wrappers
    // sys.zig exposes for shell/pipe IPC.
    pub fn recv(fd: Fd, buf: &mut [u8], flags: i32) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        // sys.zig:2252-2262 — isMac arm: single `recvfrom$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let n = check_once!(unsafe { sys_recv(fd.native(), buf.as_mut_ptr().cast(), len, flags) }, Tag::recv);
        #[cfg(not(target_os = "macos"))]
        let n = check!(unsafe { sys_recv(fd.native(), buf.as_mut_ptr().cast(), len, flags) }, Tag::recv);
        Ok(n as usize)
    }
    pub fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize> {
        // sys.zig:2294-2322 — passes `buf.len` un-clamped (only `recv` clamps via
        // `adjusted_len`); forward the full length and let the kernel decide.
        // isMac arm: single `sendto$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let n = check_once!(unsafe { sys_send(fd.native(), buf.as_ptr().cast(), buf.len(), flags) }, Tag::send);
        #[cfg(not(target_os = "macos"))]
        let n = check!(unsafe { sys_send(fd.native(), buf.as_ptr().cast(), buf.len(), flags) }, Tag::send);
        Ok(n as usize)
    }
    pub fn recv_non_block(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
        recv(fd, buf, MSG_DONTWAIT)
    }
    /// sys.zig:2205 — `MSG_DONTWAIT | MSG_NOSIGNAL` so a broken-pipe write
    /// returns EPIPE instead of raising SIGPIPE.
    pub fn send_non_block(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        send(fd, buf, SEND_FLAGS_NONBLOCK)
    }
    #[cfg(unix)]
    pub const MSG_DONTWAIT: i32 = libc::MSG_DONTWAIT;
    // sys.zig:2205 — `MSG_DONTWAIT | MSG_NOSIGNAL` on all Unix including macOS
    // (Darwin defines MSG_NOSIGNAL=0x80000; std/c/darwin.zig:1591).
    #[cfg(unix)]
    pub const SEND_FLAGS_NONBLOCK: i32 = libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL;
    /// sys.zig:3138 `socketpairImpl` — Linux uses `SOCK_CLOEXEC|SOCK_NONBLOCK`
    /// type flags; non-Linux sets CLOEXEC + nonblock + (Darwin) `SO_NOSIGPIPE`
    /// per-fd, closing both on any post-step error.
    pub fn socketpair(domain: i32, ty: i32, proto: i32, nonblock: bool) -> Maybe<[Fd; 2]> {
        let mut fds = [0i32; 2];
        #[cfg(target_os = "linux")]
        {
            let ty = ty | libc::SOCK_CLOEXEC | if nonblock { libc::SOCK_NONBLOCK } else { 0 };
            check!(unsafe { libc::socketpair(domain, ty, proto, fds.as_mut_ptr()) }, Tag::socketpair);
        }
        #[cfg(not(target_os = "linux"))]
        {
            check!(unsafe { libc::socketpair(domain, ty, proto, fds.as_mut_ptr()) }, Tag::socketpair);
            let close_both = |e| {
                unsafe { libc::close(fds[0]); libc::close(fds[1]); }
                Err::<[Fd; 2], _>(Error::from_code_int(e, Tag::socketpair))
            };
            for &fd in &fds {
                // CLOEXEC
                if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
                    return close_both(last_errno());
                }
                // O_NONBLOCK via GETFL→OR→SETFL (don't clobber existing flags).
                if nonblock {
                    let fl = unsafe { libc::fcntl(fd, libc::F_GETFL) };
                    if fl < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, fl | libc::O_NONBLOCK) } < 0 {
                        return close_both(last_errno());
                    }
                }
                // Darwin: SO_NOSIGPIPE so writes return EPIPE instead of SIGPIPE.
                #[cfg(target_os = "macos")]
                {
                    let on: libc::c_int = 1;
                    if unsafe {
                        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_NOSIGPIPE,
                            (&on as *const i32).cast(), core::mem::size_of::<i32>() as u32)
                    } < 0 {
                        return close_both(last_errno());
                    }
                }
            }
        }
        Ok([Fd::from_native(fds[0]), Fd::from_native(fds[1])])
    }

    // ── B-2 round 9: macOS clonefile / copyfile ──
    #[cfg(target_os = "macos")]
    mod darwin_copy {
        use super::*;
        unsafe extern "C" {
            fn clonefile(src: *const i8, dst: *const i8, flags: u32) -> i32;
            fn clonefileat(src_dir: i32, src: *const i8, dst_dir: i32, dst: *const i8, flags: u32) -> i32;
            fn copyfile(from: *const i8, to: *const i8, state: *mut core::ffi::c_void, flags: u32) -> i32;
            fn fcopyfile(from: i32, to: i32, state: *mut core::ffi::c_void, flags: u32) -> i32;
        }
        pub fn clonefile_(from: &ZStr, to: &ZStr) -> Maybe<()> {
            check_p!(unsafe { clonefile(from.as_ptr(), to.as_ptr(), 0) }, Tag::clonefile, from); Ok(())
        }
        pub fn clonefileat_(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
            check_p!(
                unsafe { clonefileat(from_dir.native(), from.as_ptr(), to_dir.native(), to.as_ptr(), 0) },
                Tag::clonefile, from
            );
            Ok(())
        }
        pub fn copyfile_(from: &ZStr, to: &ZStr, flags: u32) -> Maybe<()> {
            check_p!(unsafe { copyfile(from.as_ptr(), to.as_ptr(), core::ptr::null_mut(), flags) }, Tag::copyfile, from);
            Ok(())
        }
        pub fn fcopyfile_(from: Fd, to: Fd, flags: u32) -> Maybe<()> {
            check!(unsafe { fcopyfile(from.native(), to.native(), core::ptr::null_mut(), flags) }, Tag::fcopyfile);
            Ok(())
        }
    }
    #[cfg(target_os = "macos")]
    pub use darwin_copy::{clonefile_ as clonefile, clonefileat_ as clonefileat, copyfile_ as copyfile, fcopyfile_ as fcopyfile};

    // ── B-2 round 9: mmap/munmap ──
    pub fn mmap(addr: *mut u8, len: usize, prot: i32, flags: i32, fd: Fd, off: i64) -> Maybe<*mut u8> {
        let p = unsafe { libc::mmap(addr.cast(), len, prot, flags, fd.native(), off) };
        if p == libc::MAP_FAILED { return Err(err_with(Tag::mmap)); }
        Ok(p.cast())
    }
    pub fn munmap(ptr: *mut u8, len: usize) -> Maybe<()> {
        check!(unsafe { libc::munmap(ptr.cast(), len) }, Tag::munmap); Ok(())
    }

    /// `bun.sys.mmapFile` — open `path` RDWR, fstat for size, mmap [offset, offset+len).
    /// Returns a process-lifetime `&'static mut [u8]`; caller is responsible for
    /// `munmap`. Mirrors Zig `mmapFile` (sys.zig).
    pub fn mmap_file(
        path: &ZStr,
        flags: libc::c_int,
        wanted_size: Option<usize>,
        offset: usize,
    ) -> Maybe<&'static mut [u8]> {
        let fd = match open(path, O::RDWR, 0) {
            Ok(fd) => fd,
            Err(err) => return Err(err),
        };
        // close fd regardless of mmap outcome (the mapping outlives the fd).
        let _close = scopeguard::guard((), |_| { let _ = fd.close(); });

        let stat_size = match fstat(fd) {
            Ok(result) => usize::try_from(result.st_size).unwrap_or(0),
            Err(err) => return Err(err),
        };
        let mut size = stat_size.saturating_sub(offset);
        if let Some(size_) = wanted_size {
            size = size.min(size_);
        }

        match mmap(
            core::ptr::null_mut(),
            size,
            libc::PROT_READ | libc::PROT_WRITE,
            flags,
            fd,
            offset as i64,
        ) {
            Ok(ptr) => {
                // SAFETY: mmap returned a valid mapping of `size` bytes.
                Ok(unsafe { core::slice::from_raw_parts_mut(ptr, size) })
            }
            Err(err) => Err(err),
        }
    }

    // ── memfd (Linux only) — sys.zig:3237-3296 ──
    /// `bun.sys.MemfdFlags` (Zig: `enum(u32)`).
    #[cfg(target_os = "linux")]
    #[derive(Clone, Copy, PartialEq, Eq)]
    #[repr(u32)]
    pub enum MemfdFlags {
        /// `MFD_EXEC | MFD_ALLOW_SEALING | MFD_CLOEXEC`
        Executable = 0x0010 | libc::MFD_ALLOW_SEALING | libc::MFD_CLOEXEC,
        /// `MFD_NOEXEC_SEAL | MFD_ALLOW_SEALING | MFD_CLOEXEC`
        NonExecutable = 0x0008 | libc::MFD_ALLOW_SEALING | libc::MFD_CLOEXEC,
        /// `MFD_NOEXEC_SEAL`
        CrossProcess = 0x0008,
    }
    #[cfg(target_os = "linux")]
    impl MemfdFlags {
        #[inline]
        fn older_kernel_flag(self) -> u32 {
            match self {
                MemfdFlags::NonExecutable | MemfdFlags::Executable => libc::MFD_CLOEXEC,
                MemfdFlags::CrossProcess => 0,
            }
        }
    }

    /// `memfd_create` requires kernel ≥ 3.17. Latched true on first ENOSYS so
    /// callers can take their existing fallback (heap buffer / pipe / socketpair)
    /// without retrying the syscall on every Blob/spawn.
    #[cfg(target_os = "linux")]
    static MEMFD_ENOSYS: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

    /// `bun.sys.canUseMemfd()` — false on non-Linux; on Linux, false once
    /// `memfd_create` has returned ENOSYS/EPERM/EACCES.
    #[cfg(target_os = "linux")]
    #[inline]
    pub fn can_use_memfd() -> bool {
        // TODO(port): also gate on `BUN_FEATURE_FLAG_DISABLE_MEMFD`.
        !MEMFD_ENOSYS.load(core::sync::atomic::Ordering::Relaxed)
    }
    #[cfg(not(target_os = "linux"))]
    #[inline]
    pub fn can_use_memfd() -> bool { false }

    /// `bun.sys.memfd_create(name, flags)` — Linux only.
    /// Retries on EINTR; on EINVAL retries once with the pre-6.3 flag set
    /// (drops `MFD_EXEC`/`MFD_NOEXEC_SEAL`); on ENOSYS/EPERM/EACCES latches
    /// [`can_use_memfd`] to false.
    #[cfg(target_os = "linux")]
    pub fn memfd_create(name: &core::ffi::CStr, flags_: MemfdFlags) -> Maybe<Fd> {
        let mut flags: u32 = flags_ as u32;
        loop {
            // SAFETY: `name` is a valid NUL-terminated C string.
            let rc = unsafe { libc::memfd_create(name.as_ptr(), flags) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                if e == libc::EINVAL && flags == flags_ as u32 {
                    // MFD_EXEC / MFD_NOEXEC_SEAL require Linux 6.3.
                    flags = flags_.older_kernel_flag();
                    continue;
                }
                if e == libc::ENOSYS || e == libc::EPERM || e == libc::EACCES {
                    MEMFD_ENOSYS.store(true, core::sync::atomic::Ordering::Relaxed);
                }
                return Err(Error::from_code_int(e, Tag::memfd_create));
            }
            return Ok(Fd::from_native(rc));
        }
    }

    /// sys.zig:504 — `sendfile(src, dest, len)`. Clamps `len` (avoid EINVAL on
    /// >2GB), EINTR-retries, and attaches the *source* fd to the error
    /// (sys.zig:513 `errnoSysFd(rc, .sendfile, src)`).
    #[cfg(target_os = "linux")]
    pub fn sendfile(src: Fd, dest: Fd, len: usize) -> Maybe<usize> {
        let len = len.min(i32::MAX as usize - 1);
        loop {
            let rc = unsafe { libc::sendfile(dest.native(), src.native(), core::ptr::null_mut(), len) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, Tag::sendfile).with_fd(src));
            }
            return Ok(rc as usize);
        }
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    pub fn sendfile(src: Fd, _dest: Fd, _len: usize) -> Maybe<usize> {
        // sys.zig:513 `errnoSysFd(rc, .sendfile, src)` — attach the *source* fd.
        Err(Error::from_code_int(libc::ENOSYS, Tag::sendfile).with_fd(src))
    }
}
#[cfg(unix)]
pub use posix_impl::*;

/// `bun.jsc.Node.TimeLike` — `timespec` shape, decoupled from JSC (T6).
/// sys.zig takes this for futimens/utimens; the JSC binding constructs it from
/// JS Date/number. T1 owns the data shape.
#[derive(Clone, Copy, Debug, Default)]
#[repr(C)]
pub struct TimeLike {
    pub sec: i64,
    pub nsec: i64,
}
impl TimeLike {
    pub const NOW: Self = Self { sec: 0, nsec: UTIME_NOW };
    pub const OMIT: Self = Self { sec: 0, nsec: UTIME_OMIT };
    #[inline]
    pub fn to_timespec(self) -> libc::timespec {
        libc::timespec { tv_sec: self.sec as _, tv_nsec: self.nsec as _ }
    }
}
#[cfg(unix)]
pub const UTIME_NOW: i64 = libc::UTIME_NOW as i64;
#[cfg(unix)]
pub const UTIME_OMIT: i64 = libc::UTIME_OMIT as i64;
#[cfg(windows)]
pub const UTIME_NOW: i64 = -1;
#[cfg(windows)]
pub const UTIME_OMIT: i64 = -2;

#[cfg(windows)]
#[path = "sys_uv.rs"]
pub mod sys_uv;

#[cfg(windows)]
mod windows_impl {
    // PORT: NT/kernel32/libuv triad (sys.zig + sys_uv.zig). The libuv-backed ops
    // delegate to `crate::sys_uv`; the rest are the windows arms of `sys.zig`.
    use super::*;
    use super::windows as w;
    use super::windows::libuv as uv;
    use bun_paths::WPathBuffer;

    // ── libuv-backed (sys_uv.zig) ────────────────────────────────────────
    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> { sys_uv::open(path, flags, mode) }
    pub fn close(fd: Fd) -> Maybe<()> {
        match sys_uv::close(fd) { Some(e) => Err(e), None => Ok(()) }
    }
    pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize> { sys_uv::read(fd, buf) }
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> { sys_uv::write(fd, buf) }
    pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize> { sys_uv::pread(fd, buf, off) }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> { sys_uv::pwrite(fd, buf, off) }
    pub fn stat(path: &ZStr) -> Maybe<Stat> { sys_uv::stat(path) }
    pub fn fstat(fd: Fd) -> Maybe<Stat> { sys_uv::fstat(fd) }
    pub fn lstat(path: &ZStr) -> Maybe<Stat> { sys_uv::lstat(path) }
    pub fn mkdir(path: &ZStr, mode: Mode) -> Maybe<()> { sys_uv::mkdir(path, mode) }
    pub fn unlink(path: &ZStr) -> Maybe<()> { sys_uv::unlink(path) }
    pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> { sys_uv::rename(from, to) }
    pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
        // sys.zig:2629 — windows uses `sys_uv.symlinkUV(target, dest, 0)`.
        sys_uv::symlink_uv(target, link, 0)
    }
    pub fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        sys_uv::readlink(path, buf).map(|s| s.len())
    }
    pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> { sys_uv::fchmod(fd, mode) }
    pub fn fchown(fd: Fd, uid: u32, gid: u32) -> Maybe<()> { sys_uv::fchown(fd, uid as _, gid as _) }
    pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()> {
        // sys.zig:2403-2419 — windows arm calls `NtSetInformationFile(..,
        // FileEndOfFileInformation)` directly on the HANDLE (NOT via libuv —
        // sys_uv::ftruncate requires a CRT fd via `fd.uv()`, which fails for
        // HANDLE-backed `Fd`s that have no uv mapping).
        // SAFETY: all-zero is a valid IO_STATUS_BLOCK.
        let mut io: w::IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
        let mut eof = bun_windows_sys::FILE_END_OF_FILE_INFORMATION { EndOfFile: len };
        // SAFETY: FFI; fd is a valid HANDLE, eof/io valid for the call.
        let rc = unsafe {
            w::ntdll::NtSetInformationFile(
                fd.cast(),
                &mut io,
                (&mut eof) as *mut _ as *mut core::ffi::c_void,
                core::mem::size_of::<bun_windows_sys::FILE_END_OF_FILE_INFORMATION>() as u32,
                w::FILE_INFORMATION_CLASS::FileEndOfFileInformation,
            )
        };
        if rc != bun_windows_sys::NTSTATUS::SUCCESS {
            let errno = w::Win32Error::from_nt_status(rc)
                .to_system_errno()
                .unwrap_or(E::EUNKNOWN);
            return Err(Error::new(errno, Tag::ftruncate).with_fd(fd));
        }
        Ok(())
    }
    pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> { sys_uv::chmod(path, mode) }
    pub fn chown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> { sys_uv::chown(path, uid as _, gid as _) }
    pub fn link(src: &ZStr, dest: &ZStr) -> Maybe<()> { sys_uv::link(src, dest) }
    pub fn fsync(fd: Fd) -> Maybe<()> { sys_uv::fsync(fd) }
    pub fn fdatasync(fd: Fd) -> Maybe<()> { sys_uv::fdatasync(fd) }

    // ── kernel32 / ntdll arms (sys.zig windows branches) ─────────────────
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        // sys.zig:1773 — on windows `openat` re-routes through `openatWindowsT`.
        // PORT NOTE: full NtCreateFile triad lives in `lib_draft_b1.rs::open_file_at_windows_nt_path`;
        // until that lands at this layer, resolve `dir`+`path` to an absolute and `open()` it.
        if path.as_bytes().first().map(|&b| b == b'/' || b == b'\\').unwrap_or(false)
            || (path.len() >= 2 && path.as_bytes()[1] == b':')
            || dir == Fd::cwd()
        {
            return open(path, flags, mode);
        }
        let mut dirbuf = bun_core::PathBuffer::default();
        let dir_path = super::get_fd_path(dir, &mut dirbuf)?;
        let mut joined = bun_core::PathBuffer::default();
        let abs = bun_paths::join_string_buf_z(&mut joined.0, &[dir_path, path.as_bytes()], bun_paths::Platform::Windows);
        open(abs, flags, mode)
    }
    pub fn dup(fd: Fd) -> Maybe<Fd> {
        // sys.zig:3911 — DuplicateHandle on the underlying HANDLE.
        let process = unsafe { w::kernel32::GetCurrentProcess() };
        let mut target: w::HANDLE = core::ptr::null_mut();
        let out = unsafe {
            w::kernel32::DuplicateHandle(
                process,
                fd.native() as w::HANDLE,
                process,
                &mut target,
                0,
                w::TRUE,
                w::DUPLICATE_SAME_ACCESS,
            )
        };
        if out == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::dup).with_fd(fd));
        }
        Ok(Fd::from_native(target as FdNative))
    }
    pub fn dup2(old: Fd, new: Fd) -> Maybe<Fd> {
        // No POSIX dup2 on Windows; sys.zig only dispatches via libuv c-runtime fds.
        // Return ENOTSUP so callers that branch on platform fall back.
        let _ = (old, new);
        Err(Error::new(E::ENOTSUP, Tag::dup2))
    }
    pub fn getcwd(buf: &mut [u8]) -> Maybe<usize> {
        // sys.zig:349 — GetCurrentDirectoryW + WTF16→UTF8.
        let mut wbuf = WPathBuffer::default();
        let len = unsafe { w::kernel32::GetCurrentDirectoryW(wbuf.len() as u32, wbuf.as_mut_ptr()) };
        if len == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::getcwd));
        }
        let utf8 = bun_str::strings::from_w_path(buf, &wbuf[..len as usize]);
        Ok(utf8.len())
    }
    pub fn page_size() -> usize {
        let mut info = core::mem::MaybeUninit::<w::SYSTEM_INFO>::uninit();
        unsafe { w::kernel32::GetSystemInfo(info.as_mut_ptr()) };
        unsafe { info.assume_init() }.dwPageSize as usize
    }
    pub fn mkdirat(dir: Fd, path: &ZStr, _mode: Mode) -> Maybe<()> {
        // sys.zig: routes to `mkdiratW` (CreateDirectoryW relative to a HANDLE).
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_str::strings::to_nt_path(&mut wbuf, path.as_bytes());
        super::windows::ntdll_mkdirat(dir, wpath)
    }
    pub fn renameat(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
        // sys.zig:2572 — windows arm goes through renameAtW.
        let mut wf = WPathBuffer::default();
        let mut wt = WPathBuffer::default();
        let from_w = bun_str::strings::to_nt_path(&mut wf, from.as_bytes());
        let to_w = bun_str::strings::to_nt_path(&mut wt, to.as_bytes());
        super::windows::rename_at_w(from_dir, from_w, to_dir, to_w, true)
    }
    pub fn renameat2(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr, flags: Renameat2Flags) -> Maybe<()> {
        // sys.zig:2538 — `renameat2` collapses to `renameat` on windows; the
        // `noreplace`/`exchange` flags are not honored by NTFS rename.
        let _ = flags;
        renameat(from_dir, from, to_dir, to)
    }
    pub fn unlinkat_with_flags(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()> {
        // sys.zig:2884-2896 `unlinkatWithFlags` windows arm: convert to NT path
        // and call `DeleteFileBun` with `.dir = if (dirfd != bun.invalid_fd)
        // dirfd.cast() else null` and `.remove_dir = flags & AT.REMOVEDIR != 0`.
        // `std.posix.AT.REMOVEDIR` on Windows = 0x200 (std/c.zig).
        const AT_REMOVEDIR: i32 = 0x200;
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_str::strings::to_nt_path(&mut wbuf, path.as_bytes());
        super::windows::DeleteFileBun(wpath, super::windows::DeleteFileOptions {
            dir: if dir.is_valid() { Some(dir) } else { None },
            remove_dir: (flags & AT_REMOVEDIR) != 0,
        })
    }
    /// sys.zig:2912 `unlinkat` — 2-arg form (`flags = 0`).
    #[inline]
    pub fn unlinkat(dir: Fd, path: &ZStr) -> Maybe<()> {
        unlinkat_with_flags(dir, path, 0)
    }
    pub fn mkdir_recursive_at(dir: Fd, sub: &[u8]) -> Maybe<()> {
        // Port of `bun.makePath` — split on sep and create each component.
        let mut buf = bun_core::PathBuffer::default();
        let mut n = 0usize;
        for comp in sub.split(|&b| b == b'/' || b == b'\\') {
            if comp.is_empty() { continue; }
            if n > 0 { buf.0[n] = b'\\'; n += 1; }
            buf.0[n..n + comp.len()].copy_from_slice(comp);
            n += comp.len();
            buf.0[n] = 0;
            // SAFETY: NUL-terminated above; `n` bytes valid in `buf`.
            let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), n) };
            match mkdirat(dir, z, 0o777) {
                Ok(()) => {}
                Err(e) if e.get_errno() == E::EEXIST => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
    pub fn linkat(src_dir: Fd, src: &ZStr, dest_dir: Fd, dest: &ZStr) -> Maybe<()> {
        // No native `linkat` on Windows — resolve to absolute and CreateHardLinkW.
        let mut sb = bun_core::PathBuffer::default();
        let mut db = bun_core::PathBuffer::default();
        let s = super::get_fd_path(src_dir, &mut sb)?;
        let d = super::get_fd_path(dest_dir, &mut db)?;
        let mut sj = bun_core::PathBuffer::default();
        let mut dj = bun_core::PathBuffer::default();
        let s_abs = bun_paths::join_string_buf_z(&mut sj.0, &[s, src.as_bytes()], bun_paths::Platform::Windows);
        let d_abs = bun_paths::join_string_buf_z(&mut dj.0, &[d, dest.as_bytes()], bun_paths::Platform::Windows);
        link(s_abs, d_abs)
    }
    pub fn linkat_tmpfile(_tmpfd: Fd, _dirfd: Fd, _name: &ZStr) -> Maybe<()> {
        // sys.zig:3973 — `if (!Environment.isLinux) @compileError("Linux only")`.
        Err(Error::new(E::ENOTSUP, Tag::link))
    }
    pub fn symlinkat(target: &ZStr, dirfd: Fd, dest: &ZStr) -> Maybe<()> {
        // sys.zig:2641 — windows: resolve `dest` against `dirfd`, then symlinkUV.
        let mut db = bun_core::PathBuffer::default();
        let d = super::get_fd_path(dirfd, &mut db)?;
        let mut dj = bun_core::PathBuffer::default();
        let d_abs = bun_paths::join_string_buf_z(&mut dj.0, &[d, dest.as_bytes()], bun_paths::Platform::Windows);
        sys_uv::symlink_uv(target, d_abs, 0)
    }
    pub fn readlinkat(fd: Fd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        // No `readlinkat` on Windows — resolve and call `readlink`.
        let mut db = bun_core::PathBuffer::default();
        let d = super::get_fd_path(fd, &mut db)?;
        let mut dj = bun_core::PathBuffer::default();
        let abs = bun_paths::join_string_buf_z(&mut dj.0, &[d, path.as_bytes()], bun_paths::Platform::Windows);
        readlink(abs, buf)
    }
    pub fn fchmodat(dir: Fd, path: &ZStr, mode: Mode, _flags: i32) -> Maybe<()> {
        let mut db = bun_core::PathBuffer::default();
        let d = super::get_fd_path(dir, &mut db)?;
        let mut dj = bun_core::PathBuffer::default();
        let abs = bun_paths::join_string_buf_z(&mut dj.0, &[d, path.as_bytes()], bun_paths::Platform::Windows);
        chmod(abs, mode)
    }
    pub fn lchmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        // Windows has no lchmod; libuv chmod follows symlinks. Match Node: fall through.
        chmod(path, mode)
    }
    pub fn lchown(_path: &ZStr, _uid: u32, _gid: u32) -> Maybe<()> {
        // Windows has no ownership model; libuv uv_fs_lchown is a no-op success.
        Ok(())
    }
    pub fn fchownat(_dir: Fd, _path: &ZStr, _uid: u32, _gid: u32, _flags: i32) -> Maybe<()> {
        // See `lchown` — no-op on Windows.
        Ok(())
    }
    pub fn fstatat(fd: Fd, path: &ZStr) -> Maybe<Stat> {
        // sys.zig:838-846 — windows arm: `openatWindowsA(fd, path, 0, 0)` (flags=0
        // → FOLLOWS reparse points) then `fstat(file)`. Do NOT use `lstat` here —
        // that's the `lstatat` (sys.zig:863) no-follow variant.
        let file = openat(fd, path, 0, 0)?;
        let r = fstat(file);
        let _ = close(file);
        r
    }
    pub fn access(path: &ZStr, mode: i32) -> Maybe<()> {
        // sys.zig:1748-1768 — windows arm: GetFileAttributesW, then if
        // `(mode & W_OK) != 0` AND the file is read-only AND it is NOT a
        // directory, return `.err = EPERM`.
        const W_OK: i32 = 2;
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_str::strings::to_kernel32_path(&mut wbuf, path.as_bytes());
        let attrs = unsafe { w::kernel32::GetFileAttributesW(wpath.as_ptr()) };
        if attrs == w::INVALID_FILE_ATTRIBUTES {
            return Err(Error::new(w::get_last_errno(), Tag::access).with_path(path.as_bytes()));
        }
        let is_readonly = (attrs & w::FILE_ATTRIBUTE_READONLY) != 0;
        let is_directory = (attrs & w::FILE_ATTRIBUTE_DIRECTORY) != 0;
        if (mode & W_OK) != 0 && is_readonly && !is_directory {
            return Err(Error::new(E::EPERM, Tag::access).with_path(path.as_bytes()));
        }
        Ok(())
    }
    pub fn faccessat(dir: Fd, sub: &ZStr) -> Maybe<bool> {
        // sys.zig:3504-3531 — `faccessat` NEVER returns `.err`: rc==0 → `.result
        // = true`, else → `.result = false` regardless of errno. There is no
        // dedicated windows arm in the spec; collapse all errors to `Ok(false)`.
        match openat(dir, sub, O::RDONLY, 0) {
            Ok(fd) => { let _ = close(fd); Ok(true) }
            Err(_) => Ok(false),
        }
    }
    pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        // sys.zig:3544 — `uv_fs_futime`.
        let a = atime.sec as f64 + atime.nsec as f64 / 1e9;
        let m = mtime.sec as f64 + mtime.nsec as f64 / 1e9;
        let mut req = uv::fs_t::uninitialized();
        let rc = unsafe { uv::uv_fs_futime(core::ptr::null_mut(), &mut req, fd.uv(), a, m, None) };
        if let Some(err) = Error::from_uv_rc(rc, Tag::futimens) { return Err(err.with_fd(fd)); }
        Ok(())
    }
    pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let a = atime.sec as f64 + atime.nsec as f64 / 1e9;
        let m = mtime.sec as f64 + mtime.nsec as f64 / 1e9;
        let mut req = uv::fs_t::uninitialized();
        let rc = unsafe { uv::uv_fs_utime(core::ptr::null_mut(), &mut req, path.as_ptr() as *const _, a, m, None) };
        if let Some(err) = Error::from_uv_rc(rc, Tag::utimes) { return Err(err.with_path(path.as_bytes())); }
        Ok(())
    }
    pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let a = atime.sec as f64 + atime.nsec as f64 / 1e9;
        let m = mtime.sec as f64 + mtime.nsec as f64 / 1e9;
        let mut req = uv::fs_t::uninitialized();
        let rc = unsafe { uv::uv_fs_lutime(core::ptr::null_mut(), &mut req, path.as_ptr() as *const _, a, m, None) };
        if let Some(err) = Error::from_uv_rc(rc, Tag::lutimes) { return Err(err.with_path(path.as_bytes())); }
        Ok(())
    }
    pub fn exists_z(path: &ZStr) -> bool {
        // sys.zig:3482 — windows arm: GetFileAttributesW != INVALID.
        access(path, 0).is_ok()
    }
    pub fn exists_at(dir: Fd, sub: &ZStr) -> bool {
        // sys.zig:3726-3731 — windows arm: `existsAtType(fd, subpath) == .file`.
        // Directories yield `false` (resolver/install code uses `existsAt` to
        // mean "a *file* exists here").
        matches!(super::exists_at_type(dir, sub), Ok(super::ExistsAtType::File))
    }
    pub fn is_executable_file_path(path: &ZStr) -> bool {
        // sys.zig:3779-3784 — windows arm: convert to wide and call
        // `bun.windows.SaferiIsExecutableFileType(path, FALSE)`. Honors the
        // system security policy and recognizes `.js/.lnk/.pif/.pl/.shs/.url/
        // .vbs/...` in addition to `.exe/.cmd/.bat/.com` (per the comment block
        // at sys.zig:3744-3761). Do NOT hand-roll an extension whitelist —
        // PORTING.md §Forbidden bars re-implementing linked OS API surface.
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_str::strings::to_w_path(&mut wbuf, path.as_bytes());
        // `bFromShellExecute = FALSE` so `.exe` files are included
        // (https://learn.microsoft.com/en-us/windows/win32/api/winsafer/nf-winsafer-saferiisexecutablefiletype).
        // SAFETY: FFI; wpath is NUL-terminated and valid for the call.
        unsafe { w::SaferiIsExecutableFileType(wpath.as_ptr(), 0) != w::FALSE }
    }
    pub fn get_file_size(fd: Fd) -> Maybe<u64> {
        // sys.zig:4140 — GetFileSizeEx.
        let mut size: i64 = 0;
        let ok = unsafe { w::kernel32::GetFileSizeEx(fd.native() as w::HANDLE, &mut size) };
        if ok == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::fstat).with_fd(fd));
        }
        Ok(size as u64)
    }
    pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Maybe<&'a [u8]> {
        // sys_uv.rs:216 — open + GetFinalPathNameByHandle (uv_fs_realpath edge cases).
        let fd = open(path, O::RDONLY, 0)?;
        let r = super::get_fd_path(fd, buf);
        let _ = close(fd);
        r
    }
    pub fn fcntl(_fd: Fd, _cmd: i32, _arg: isize) -> Maybe<isize> {
        // sys.zig:959 — `if (Environment.isWindows) @compileError("not implemented")`.
        Err(Error::new(E::ENOTSUP, Tag::fcntl))
    }
    pub fn pipe() -> Maybe<[Fd; 2]> {
        // sys.zig:3839 — windows: uv_pipe(fds, 0, 0).
        let mut fds: [uv::uv_file; 2] = [-1, -1];
        let rc = unsafe { uv::uv_pipe(fds.as_mut_ptr(), 0, 0) };
        if let Some(err) = Error::from_uv_rc(rc, Tag::pipe) { return Err(err); }
        Ok([Fd::from_uv(fds[0]), Fd::from_uv(fds[1])])
    }
    pub fn isatty(fd: Fd) -> bool {
        // sys.zig — windows: uv_guess_handle == UV_TTY.
        unsafe { uv::uv_guess_handle(fd.uv()) == uv::UV_TTY }
    }
    pub fn lseek(fd: Fd, offset: i64, whence: i32) -> Maybe<i64> {
        // sys.zig:2339 — windows: SetFilePointerEx.
        let mut new: i64 = 0;
        let ok = unsafe { w::SetFilePointerEx(fd.native() as w::HANDLE, offset, &mut new, whence as u32) };
        if ok == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::lseek).with_fd(fd));
        }
        Ok(new)
    }
    pub fn chdir(path: &ZStr) -> Maybe<()> {
        // sys.zig:452-455 — windows: `SetCurrentDirectoryW(toWDirPath(..))`.
        // `toWDirPath` appends a trailing backslash so e.g. `"C:"` is treated
        // as the drive root, not the drive's saved cwd.
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_str::strings::to_w_dir_path(&mut wbuf, path.as_bytes());
        if unsafe { w::SetCurrentDirectoryW(wpath.as_ptr()) } == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::chdir).with_path(path.as_bytes()));
        }
        Ok(())
    }
    pub fn fchdir(fd: Fd) -> Maybe<()> {
        let mut buf = bun_core::PathBuffer::default();
        let p = super::get_fd_path(fd, &mut buf)?;
        let mut zb = bun_core::PathBuffer::default();
        zb.0[..p.len()].copy_from_slice(p);
        zb.0[p.len()] = 0;
        // SAFETY: NUL-terminated above.
        chdir(unsafe { ZStr::from_raw(zb.0.as_ptr(), p.len()) })
    }
    pub fn umask(mode: Mode) -> Mode {
        // sys.zig: `_umask` (msvcrt).
        unsafe extern "C" { fn _umask(m: core::ffi::c_int) -> core::ffi::c_int; }
        unsafe { _umask(mode as core::ffi::c_int) as Mode }
    }
    pub fn recv(fd: Fd, buf: &mut [u8], flags: i32) -> Maybe<usize> {
        // sys.zig:2243-2244 — windows: winsock `recv` with `adjusted_len =
        // @min(buf.len, max_count)` so the `usize → i32` cast can't wrap.
        let len = buf.len().min(MAX_COUNT) as i32;
        let rc = unsafe { w::ws2_32::recv(fd.native() as _, buf.as_mut_ptr() as *mut _, len, flags) };
        if rc < 0 {
            return Err(Error::new(w::WSAGetLastError().unwrap_or(E::EUNKNOWN), Tag::recv).with_fd(fd));
        }
        Ok(rc as usize)
    }
    pub fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize> {
        // sys.zig:2294 — windows: winsock `send`. Clamp to `i32::MAX` so the
        // `usize → i32` cast can't wrap to a negative length on huge buffers.
        let len = buf.len().min(MAX_COUNT) as i32;
        let rc = unsafe { w::ws2_32::send(fd.native() as _, buf.as_ptr() as *const _, len, flags) };
        if rc < 0 {
            return Err(Error::new(w::WSAGetLastError().unwrap_or(E::EUNKNOWN), Tag::send).with_fd(fd));
        }
        Ok(rc as usize)
    }
    pub fn recv_non_block(fd: Fd, buf: &mut [u8]) -> Maybe<usize> { recv(fd, buf, 0) }
    pub fn send_non_block(fd: Fd, buf: &[u8]) -> Maybe<usize> { send(fd, buf, 0) }
    pub fn socketpair(_domain: i32, _ty: i32, _proto: i32, _nonblock: bool) -> Maybe<[Fd; 2]> {
        // sys.zig:3103 — `if (Environment.isWindows) @compileError("use spawnIPCSocket on Windows")`.
        Err(Error::new(E::ENOTSUP, Tag::socketpair))
    }
    pub fn mmap(_addr: *mut u8, _len: usize, _prot: i32, _flags: i32, _fd: Fd, _off: i64) -> Maybe<*mut u8> {
        // sys.zig:3006 — `if (Environment.isWindows) @compileError("not implemented")`.
        Err(Error::new(E::ENOTSUP, Tag::mmap))
    }
    pub fn munmap(_ptr: *mut u8, _len: usize) -> Maybe<()> {
        // sys.zig:3231 — `if (Environment.isWindows) @compileError("not implemented")`.
        Err(Error::new(E::ENOTSUP, Tag::munmap))
    }
    pub fn sendfile(src: Fd, _dest: Fd, _len: usize) -> Maybe<usize> {
        // sys.zig:504 has NO Windows arm — `bun.sys.sendfile` is Linux-only
        // (`std.os.linux.sendfile` with a *null* offset so the kernel advances
        // the source fd's file position). The previous port called
        // `uv_fs_sendfile(..., in_offset=0, ...)`, which (a) re-reads byte 0
        // on every iteration of a chunked copy loop and (b) returned the int
        // rc (always `0` on success) instead of `req.result`. Surface ENOSYS
        // so callers fall back to the read/write copy loop, matching the
        // non-Linux posix arm above.
        Err(Error::new(E::ENOSYS, Tag::sendfile).with_fd(src))
    }
    pub type FcntlInt = isize;
    pub const MSG_DONTWAIT: i32 = 0;
    pub const SEND_FLAGS_NONBLOCK: i32 = 0;
}
#[cfg(windows)]
pub use windows_impl::*;

// `File` high-level helpers — wrap the syscall surface above.
impl File {
    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Self> {
        open(path, flags, mode).map(Self::from_fd)
    }
    /// File.zig `openat` — accepts a non-sentinel `&[u8]` (Zig: `path: anytype`
    /// dispatches to `openatA` for non-sentinel slices). `&ZStr` callers
    /// deref-coerce to `&[u8]`.
    pub fn openat(dir: Fd, path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        openat_a(dir, path, flags, mode).map(Self::from_fd)
    }
    /// snake_case alias (Zig: `File.openat`).
    #[inline]
    pub fn open_at(dir: Fd, path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        Self::openat(dir, path, flags, mode)
    }
    /// `std.fs.cwd().createFile(path, .{ .truncate })` replacement.
    pub fn create(dir: Fd, path: &[u8], truncate: bool) -> Maybe<Self> {
        let flags = O::WRONLY | O::CREAT | O::CLOEXEC | if truncate { O::TRUNC } else { 0 };
        openat_a(dir, path, flags, 0o666).map(Self::from_fd)
    }
    pub fn read(&self, buf: &mut [u8]) -> Maybe<usize> { read(self.handle, buf) }
    pub fn write(&self, buf: &[u8]) -> Maybe<usize> { write(self.handle, buf) }
    pub fn write_all(&self, mut buf: &[u8]) -> Maybe<()> {
        while !buf.is_empty() {
            let n = write(self.handle, buf)?;
            // File.zig:118-133 — `if (amt == 0) return .success;` (matches Zig).
            if n == 0 { return Ok(()); }
            buf = &buf[n..];
        }
        Ok(())
    }
    /// `File.readAll(buf: []u8)` — loop `read()` into a **fixed** caller-owned
    /// slice until EOF or full. Returns total bytes read (sys.zig `readAll`).
    pub fn read_all(&self, buf: &mut [u8]) -> Maybe<usize> {
        let mut rest = &mut *buf;
        let mut total_read: usize = 0;
        while !rest.is_empty() {
            let n = read(self.handle, rest)?;
            if n == 0 { break; }
            rest = &mut rest[n..];
            total_read += n;
        }
        Ok(total_read)
    }
    /// Growable-`Vec` variant (was previously misnamed `read_all`). Kept for
    /// callers that want cursor-relative streaming into an existing `Vec`.
    pub fn read_to_end_into(&self, buf: &mut Vec<u8>) -> Maybe<usize> {
        let start = buf.len();
        loop {
            if buf.capacity() == buf.len() { buf.reserve(8192); }
            let spare = buf.spare_capacity_mut();
            // SAFETY: read() writes initialized bytes; we set_len to exactly what was written.
            let n = read(self.handle, unsafe {
                core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast(), spare.len())
            })?;
            if n == 0 { return Ok(buf.len() - start); }
            unsafe { buf.set_len(buf.len() + n); }
        }
    }
    pub fn read_to_end(&self) -> Maybe<Vec<u8>> {
        let mut v = Vec::new();
        // File.zig `readToEnd` — fstat-presized, pread-from-0; not a cursor read.
        self.read_to_end_with_array_list(&mut v, SizeHint::UnknownSize)?;
        Ok(v)
    }
    /// `File.getEndPos()` — file size via fstat.
    pub fn get_end_pos(&self) -> Maybe<usize> {
        Ok(fstat(self.handle)?.st_size as usize)
    }
    /// `File.readToEndWithArrayList(buf, hint)` — like `read_all` but takes a
    /// `SizeHint` so callers can pre-reserve. Returns the borrowed slice.
    pub fn read_to_end_with_array_list<'a>(&self, buf: &'a mut Vec<u8>, hint: SizeHint) -> Maybe<&'a [u8]> {
        // File.zig:298 — `probably_small` reserves 64; `unknown_size` fstats and
        // reserves `size+16`.
        match hint {
            SizeHint::ProbablySmall => buf.reserve(64),
            SizeHint::UnknownSize => {
                let size = self.get_end_pos()?;
                if buf.capacity() < size + 16 {
                    buf.reserve(size + 16 - buf.len());
                }
            }
        }
        let start = buf.len();
        let mut total: i64 = 0;
        loop {
            if buf.capacity() == buf.len() { buf.reserve(16); }
            let spare = buf.spare_capacity_mut();
            // SAFETY: pread()/read() write initialized bytes; we set_len to exactly what was written.
            let dst = unsafe {
                core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast::<u8>(), spare.len())
            };
            #[cfg(unix)]
            let n = pread(self.handle, dst, total)?;
            #[cfg(not(unix))]
            let n = read(self.handle, dst)?;
            if n == 0 { break; }
            // SAFETY: `n` bytes were just initialized by the syscall.
            unsafe { buf.set_len(buf.len() + n); }
            total += n as i64;
        }
        Ok(&buf[start..])
    }
    pub fn pwrite_all(&self, mut buf: &[u8], mut off: i64) -> Maybe<()> {
        while !buf.is_empty() {
            let n = pwrite(self.handle, buf, off)?;
            if n == 0 { return Ok(()); }
            buf = &buf[n..];
            off += n as i64;
        }
        Ok(())
    }
    /// `std.fs.File.preadAll` — loop `pread()` from `offset` until `buf` is
    /// full or EOF. Returns total bytes read (may be `< buf.len()` on EOF).
    pub fn pread_all(&self, buf: &mut [u8], offset: u64) -> Maybe<usize> {
        let mut off = offset as i64;
        let mut total: usize = 0;
        while total < buf.len() {
            let n = pread(self.handle, &mut buf[total..], off)?;
            if n == 0 { break; }
            total += n;
            off += n as i64;
        }
        Ok(total)
    }
    /// `std.fs.File.seekTo` — `lseek(SEEK_SET)`.
    #[inline]
    pub fn seek_to(&self, offset: u64) -> Maybe<()> {
        set_file_offset(self.handle, offset)
    }
    pub fn stat(&self) -> Maybe<Stat> { fstat(self.handle) }
    pub fn close(self) -> Maybe<()> { close(self.handle) }
    /// `bun.sys.File.readFrom` — open + read + close. Accepts `&[u8]` (Zig:
    /// `path: anytype`); `&ZStr` callers deref-coerce.
    /// Port of `bun.sys.File.readFillBuf` (src/sys/File.zig). Reads until
    /// `buf` is full or EOF; returns the filled prefix.
    pub fn read_fill_buf<'b>(&self, buf: &'b mut [u8]) -> Maybe<&'b mut [u8]> {
        let mut read_amount: usize = 0;
        while read_amount < buf.len() {
            match read(self.handle, &mut buf[read_amount..]) {
                Err(err) => return Err(err),
                Ok(0) => break,
                Ok(n) => read_amount += n,
            }
        }
        Ok(&mut buf[..read_amount])
    }
    pub fn read_from(dir: Fd, path: &[u8]) -> Maybe<Vec<u8>> {
        let f = Self::openat(dir, path, O::RDONLY, 0)?;
        // File.zig: closes the fd on the error path too (no leak on read failure).
        let v = f.read_to_end();
        let _ = close(f.handle);
        v
    }
    /// `bun.sys.File.readFileFrom` (File.zig:381) — open + read; returns BOTH
    /// the open `File` handle and the bytes. Caller owns the fd and must
    /// `close()` it. On read error the fd is closed before returning (no leak).
    pub fn read_file_from(dir: Fd, path: &[u8]) -> core::result::Result<(Self, Vec<u8>), bun_core::Error> {
        let f = Self::openat(dir, path, O::RDONLY, 0).map_err(Into::<bun_core::Error>::into)?;
        match f.read_to_end() {
            Ok(bytes) => Ok((f, bytes)),
            Err(e) => {
                let _ = close(f.handle);
                Err(e.into())
            }
        }
    }
    /// `bun.sys.File.getPath` — `getFdPath(self.handle, buf)`.
    #[inline]
    pub fn get_path<'a>(&self, buf: &'a mut bun_paths::PathBuffer)
        -> core::result::Result<&'a [u8], bun_core::Error>
    {
        get_fd_path(self.handle, buf).map(|s| &*s).map_err(Into::into)
    }
    /// `bun.sys.File.readFromUserInput` (File.zig:367) — normalize a
    /// user-provided relative path against the resolver's cached
    /// `top_level_dir` (NOT a fresh `getcwd()`), then `readFrom`.
    ///
    /// Zig reads `bun.fs.FileSystem.instance.top_level_dir` directly; in the
    /// Rust crate map that lives in `bun_resolver::fs` (T5) which `bun_sys`
    /// (T1) must not depend on (PORTING.md §Forbidden: no fn-ptr hooks to
    /// break dep cycles). Callers pass `top_level_dir` explicitly instead.
    pub fn read_from_user_input(dir: Fd, top_level_dir: &[u8], input_path: &[u8]) -> Maybe<Vec<u8>> {
        let mut buf = bun_paths::PathBuffer::default();
        let normalized = bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::platform::Loose>(
            top_level_dir, &mut buf.0, &[input_path],
        );
        Self::read_from(dir, normalized.as_bytes())
    }
    /// `bun.sys.File.writeFile` — open + write + close.
    pub fn write_file(dir: Fd, path: &ZStr, data: &[u8]) -> Maybe<()> {
        // File.zig:141 — mode 0o664; `defer file.close()` (close on all paths).
        let f = Self::openat(dir, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)?;
        let r = f.write_all(data);
        let _ = close(f.handle);
        r
    }
    /// `File.bufferedWriter()` — `std.io.BufferedWriter` wrapping this fd.
    pub fn buffered_writer(&self) -> std::io::BufWriter<FileWriter> {
        std::io::BufWriter::new(FileWriter(self.handle))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.PlatformIOVecConst` / `bun.platformIOVecConstCreate` — POSIX
// `iovec_const` (= `struct iovec` with the writev contract that `base` is
// not written through). On Windows the Zig original aliases `uv_buf_t`;
// that arm lands with the libuv triad in `lib_draft_b1.rs`.
// Layout matches `libc::iovec` (`{ *void, usize }`) so a `&[PlatformIoVecConst]`
// can be passed straight to `pwritev(2)`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct PlatformIoVecConst {
    pub base: *const u8,
    pub len: usize,
}
#[cfg(unix)]
const _: () = assert!(
    core::mem::size_of::<PlatformIoVecConst>() == core::mem::size_of::<libc::iovec>()
        && core::mem::align_of::<PlatformIoVecConst>() == core::mem::align_of::<libc::iovec>()
);

#[inline]
pub fn platform_iovec_const_create(buf: &[u8]) -> PlatformIoVecConst {
    PlatformIoVecConst { base: buf.as_ptr(), len: buf.len() }
}

/// `bun.sys.pwritev` — gather-write at `offset`. Returns bytes written
/// (may be less than the sum of `vecs` lengths on a short write).
pub fn pwritev(fd: Fd, vecs: &[PlatformIoVecConst], offset: i64) -> Maybe<usize> {
    #[cfg(unix)]
    {
        // SAFETY: `PlatformIoVecConst` is layout-compatible with `libc::iovec`
        // (asserted above); `pwritev(2)` only reads through `iov_base`.
        // sys.zig:2064 — Darwin uses `pwritev$NOCANCEL` (avoid cancellation point).
        #[cfg(target_os = "macos")]
        {
            // sys.zig:1955-1964 — `.mac` arm: single `pwritev$NOCANCEL`, no
            // EINTR retry (surfaces EINTR to caller).
            let rc = unsafe {
                nocancel::pwritev(
                    fd.native(),
                    vecs.as_ptr().cast::<libc::iovec>(),
                    vecs.len() as core::ffi::c_int,
                    offset,
                )
            };
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), Tag::pwritev));
            }
            return Ok(rc as usize);
        }
        #[cfg(not(target_os = "macos"))]
        loop {
            let rc = unsafe {
                libc::pwritev(
                    fd.native(),
                    vecs.as_ptr().cast::<libc::iovec>(),
                    vecs.len() as core::ffi::c_int,
                    offset,
                )
            };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, Tag::pwritev));
            }
            return Ok(rc as usize);
        }
    }
    #[cfg(not(unix))]
    {
        // TODO(b2-windows): route through `uv_fs_write` with `uv_buf_t[]`.
        let _ = (fd, vecs, offset);
        Err(Error::from_code_int(libc::ENOSYS, Tag::pwritev))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.PlatformIOVec` — mutable iovec (`{ *void, usize }` on POSIX,
// `uv_buf_t` on Windows). Layout-compatible with `libc::iovec` so a
// `&[PlatformIoVec]` can be passed straight to `readv(2)`/`writev(2)`.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(unix)]
pub type PlatformIoVec = libc::iovec;
#[cfg(not(unix))]
#[repr(C)]
#[derive(Clone, Copy)]
pub struct PlatformIoVec {
    pub base: *mut u8,
    pub len: usize,
}

#[inline]
pub fn platform_iovec_create(buf: &mut [u8]) -> PlatformIoVec {
    #[cfg(unix)]
    { PlatformIoVec { iov_base: buf.as_mut_ptr().cast(), iov_len: buf.len() } }
    #[cfg(not(unix))]
    { PlatformIoVec { base: buf.as_mut_ptr(), len: buf.len() } }
}

/// `bun.sys.writev` — gather-write. macOS uses `writev$NOCANCEL` with no
/// EINTR retry (sys.zig:1923-1934); other POSIX retries on EINTR.
pub fn writev(fd: Fd, vecs: &[PlatformIoVec]) -> Maybe<usize> {
    #[cfg(unix)]
    {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `PlatformIoVec` is `libc::iovec`; writev(2) only reads
            // the descriptor table. sys.zig:1925 — single shot, surfaces EINTR.
            let rc = unsafe {
                nocancel::writev(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int)
            };
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), Tag::writev).with_fd(fd));
            }
            return Ok(rc as usize);
        }
        #[cfg(not(target_os = "macos"))]
        loop {
            // SAFETY: see above.
            let rc = unsafe {
                libc::writev(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int)
            };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, Tag::writev).with_fd(fd));
            }
            return Ok(rc as usize);
        }
    }
    #[cfg(not(unix))]
    {
        // TODO(b2-windows): route through `uv_fs_write` with `uv_buf_t[]`.
        let _ = (fd, vecs);
        Err(Error::from_code_int(libc::ENOSYS, Tag::writev))
    }
}

/// `bun.sys.readv` — scatter-read. macOS uses `readv$NOCANCEL` with no
/// EINTR retry (sys.zig:1982-2014); other POSIX retries on EINTR.
pub fn readv(fd: Fd, vecs: &[PlatformIoVec]) -> Maybe<usize> {
    #[cfg(debug_assertions)]
    if vecs.is_empty() {
        bun_core::Output::debug_warn("readv() called with 0 length buffer");
    }
    #[cfg(unix)]
    {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: vecs.ptr is `*const iovec`; the kernel writes through
            // each `iov_base`, never the array itself. sys.zig:1991 — single shot.
            let rc = unsafe {
                nocancel::readv(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int)
            };
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), Tag::readv).with_fd(fd));
            }
            return Ok(rc as usize);
        }
        #[cfg(not(target_os = "macos"))]
        loop {
            // SAFETY: see above.
            let rc = unsafe {
                libc::readv(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int)
            };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, Tag::readv).with_fd(fd));
            }
            return Ok(rc as usize);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (fd, vecs);
        Err(Error::from_code_int(libc::ENOSYS, Tag::readv))
    }
}

/// `bun.sys.preadv` — scatter-read at `position`. macOS uses
/// `preadv$NOCANCEL` with no EINTR retry (sys.zig:2016-2048).
pub fn preadv(fd: Fd, vecs: &[PlatformIoVec], position: i64) -> Maybe<usize> {
    #[cfg(debug_assertions)]
    if vecs.is_empty() {
        bun_core::Output::debug_warn("preadv() called with 0 length buffer");
    }
    #[cfg(unix)]
    {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: see `readv`. sys.zig:2025 — single shot.
            let rc = unsafe {
                nocancel::preadv(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int, position)
            };
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), Tag::preadv).with_fd(fd));
            }
            return Ok(rc as usize);
        }
        #[cfg(not(target_os = "macos"))]
        loop {
            // SAFETY: see `readv`.
            let rc = unsafe {
                libc::preadv(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int, position)
            };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, Tag::preadv).with_fd(fd));
            }
            return Ok(rc as usize);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (fd, vecs, position);
        Err(Error::from_code_int(libc::ENOSYS, Tag::preadv))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.StatFS` / `bun.sys.statfs` — sys.zig:547-571.
// On POSIX `bun.StatFS` aliases `struct statfs` (Linux/macOS/FreeBSD); on
// Windows it is `uv_statfs_t` populated from `GetDiskFreeSpace` (handled in
// `sys_uv`).
// ──────────────────────────────────────────────────────────────────────────
#[cfg(unix)]
pub type StatFS = libc::statfs;
#[cfg(not(unix))]
pub type StatFS = self::windows::libuv::uv_statfs_t;

/// `bun.sys.statfs` — query filesystem stats for `path`. Retries on EINTR.
pub fn statfs(path: &ZStr) -> Maybe<StatFS> {
    #[cfg(unix)]
    loop {
        // SAFETY: all-zero is a valid `struct statfs` (kernel writes every
        // field on success); `path` is NUL-terminated by `ZStr`.
        let mut st: StatFS = unsafe { core::mem::zeroed() };
        let rc = unsafe { libc::statfs(path.as_ptr(), &mut st) };
        if rc < 0 {
            let e = last_errno();
            if e == libc::EINTR { continue; }
            return Err(Error::from_code_int(e, Tag::statfs).with_path(path.as_bytes()));
        }
        return Ok(st);
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(Error::from_code(E::NOSYS, Tag::statfs))
    }
}

/// `bun.timespec` — re-exported from `bun_core` so `PosixStat.rs` can spell
/// `crate::Timespec` (matching the Zig `bun.timespec` namespacing).
pub use bun_core::Timespec;

/// `bun.sys.selfProcessMemoryUsage()` — returns the resident set size of the
/// current process in bytes, or `None` on failure. Thin wrapper around the
/// C++ `getRSS` shim (lives in `src/jsc/bindings/memory.cpp`).
pub fn self_process_memory_usage() -> Option<usize> {
    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        fn getRSS(rss: *mut usize) -> ::core::ffi::c_int;
    }
    let mut rss: usize = 0;
    // SAFETY: FFI call; `rss` is a valid `*mut usize` for the duration of the call.
    if unsafe { getRSS(&mut rss) } != 0 {
        return None;
    }
    Some(rss)
}

/// `bun.sys.PosixStat` — uv-shaped stat struct (`src/sys/PosixStat.zig`).
/// Re-exported here so dependents (`node_fs.rs`, `Stat.rs`) can spell
/// `bun_sys::PosixStat` exactly as the Zig source spells `bun.sys.PosixStat`.
#[path = "PosixStat.rs"]
pub mod posix_stat;
pub use posix_stat::PosixStat;

/// `std::io::Write` adapter for `Fd` (used by `File::buffered_writer`).
pub struct FileWriter(pub Fd);
impl std::io::Write for FileWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        write(self.0, buf).map_err(|e| std::io::Error::from_raw_os_error(e.errno as i32))
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — additional surface unblocked for dependents.
// Symbols are real posix wrappers (sys.zig posix arms 1:1); Windows arms route
// through the libuv/kernel32 layer in `windows_impl` above.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.sys.Error.Int` — backing integer for `errno`.
pub type ErrorInt = error::Int;
/// `std.posix.E` — un-prefixed errno enum (`.SUCCESS`, `.AGAIN`, ...).
/// PORT NOTE: aliased to `bun_errno::E` (= `SystemErrno`); variants currently
/// keep the `E` prefix (`EAGAIN` not `AGAIN`). Unprefixed associated consts
/// live on `SystemErrno` directly (errno crate); callers comparing against
/// `Errno::AGAIN`/`Errno::EXIST` rely on those.
pub type Errno = E;

/// `bun.sys.File.SizeHint` — pre-reserve hint for `read_to_end_with_array_list`.
/// Mirrors Zig's `enum { probably_small, unknown_size }` (File.zig:298).
#[derive(Clone, Copy, Debug)]
pub enum SizeHint {
    /// Reserve a small fixed buffer (64B).
    ProbablySmall,
    /// `fstat()` the fd to pre-size the buffer.
    UnknownSize,
}

/// `std.process.EnvMap` — owned `KEY → VALUE` map of environment variables.
/// Minimal real def (no Zig hash-map semantics needed; Rust callers iterate).
pub type EnvMap = std::collections::HashMap<String, String>;

/// `bun.sys.syslog` — debug-scoped log under `SYS` (Zig: `Output.scoped(.SYS)`).
/// PORT NOTE: `bun_core::scoped_log!` only accepts a bare `$scope:ident`, so we
/// re-expand its body verbatim here with the qualified `$crate::fd::SYS` path
/// and `::bun_core::` helpers — keeping the `[sys] ` tag prefix, trailing-`\n`
/// append, and `pretty_fmt!` ANSI rewrite (output.zig:893-933) that
/// `ScopedLogger::log()` does *not* add on its own.
#[macro_export]
macro_rules! syslog {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        // Gate on `debug_assertions` (== `Environment::ENABLE_LOGS`) — matches
        // bun_core::scoped_log!; there is no `debug_logs` Cargo feature.
        if cfg!(debug_assertions) && $crate::fd::SYS.is_visible() {
            const __NL: &str =
                ::bun_core::output::_needs_nl(::bun_core::pretty_fmt!($fmt, false));
            // Branch on ANSI *before* `format_args!` so each `$arg` evaluates
            // exactly once (Zig builds the args tuple once — output.zig:922-933).
            if ::bun_core::output::_scoped_use_ansi() {
                $crate::fd::SYS.log(::core::format_args!(
                    concat!(
                        "\x1b[0m\x1b[2m[{}]\x1b[0m ",
                        ::bun_core::pretty_fmt!($fmt, true),
                        "{}",
                    ),
                    ::bun_core::output::_LowerTag($crate::fd::SYS.tagname),
                    $($arg,)*
                    __NL
                ));
            } else {
                $crate::fd::SYS.log(::core::format_args!(
                    concat!(
                        "[{}] ",
                        ::bun_core::pretty_fmt!($fmt, false),
                        "{}",
                    ),
                    ::bun_core::output::_LowerTag($crate::fd::SYS.tagname),
                    $($arg,)*
                    __NL
                ));
            }
        }
    };
}

// ── `bun.c` — raw libc surface (no `Maybe` wrapping). ──
pub mod c {
    use core::ffi::{c_char, c_int, c_void};
    pub use libc::stat as Stat;
    pub use libc::{fchmod, memcmp};
    #[cfg(unix)] pub use libc::{getuid, getgid, geteuid, getegid};
    /// `std.c.fd_t` / `std.posix.fd_t` — native fd backing int (c_int on POSIX,
    /// HANDLE on Windows). Use `bun_sys::Fd` everywhere else; this raw alias
    /// exists only for direct libc FFI (e.g. `socketpair`).
    #[cfg(unix)] #[allow(non_camel_case_types)] pub type fd_t = c_int;
    #[cfg(windows)] #[allow(non_camel_case_types)] pub type fd_t = bun_core::FdNative;
    /// `bun.c.struct_statfs` — raw `struct statfs` (POSIX) / `uv_statfs_t` (Windows).
    /// Aliased here so `bun.StatFS` (bun.zig:1703) resolves through `bun_sys::c`.
    pub use super::StatFS as struct_statfs;

    /// libc `dlsym` (RTLD_DEFAULT when `handle` is null).
    #[cfg(unix)]
    pub unsafe fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void {
        unsafe { libc::dlsym(handle, name) }
    }
    #[cfg(unix)]
    pub use libc::memmem;
    /// libc `__errno_location()` / `__error()` — pointer to thread-local errno.
    #[inline]
    pub unsafe fn errno_location() -> *mut c_int { unsafe { super::errno_ptr() } }

    /// `bun.c.kevent` — raw BSD kqueue event syscall (Darwin/FreeBSD only).
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub unsafe fn kevent(
        kq: c_int,
        changelist: *const libc::kevent,
        nchanges: c_int,
        eventlist: *mut libc::kevent,
        nevents: c_int,
        timeout: *const libc::timespec,
    ) -> c_int {
        unsafe { libc::kevent(kq, changelist, nchanges, eventlist, nevents, timeout) }
    }

    /// Darwin `sendfile(fd, s, off, *len, *hdtr, flags)`.
    /// NOTE (SendFile.zig:67): on `EINTR`/`EAGAIN` the kernel still writes the
    /// bytes-sent count back through `*len` before returning -1 — callers MUST
    /// advance their offset by `*len` even on error. This wrapper is raw (no
    /// EINTR retry); the caller owns the offset bookkeeping.
    #[cfg(target_os = "macos")]
    pub unsafe fn sendfile(
        fd: c_int, s: c_int, off: i64, len: *mut i64,
        hdtr: *mut c_void, flags: c_int,
    ) -> c_int {
        unsafe { libc::sendfile(fd, s, off, len, hdtr.cast(), flags) }
    }
    /// FreeBSD `sendfile(fd, s, off, nbytes, *hdtr, *sbytes, flags)`.
    #[cfg(target_os = "freebsd")]
    pub unsafe fn sendfile(
        fd: c_int, s: c_int, off: i64, nbytes: usize,
        hdtr: *mut c_void, sbytes: *mut i64, flags: c_int,
    ) -> c_int {
        unsafe { libc::sendfile(fd, s, off, nbytes, hdtr.cast(), sbytes, flags) }
    }

    /// `bun.c.dlsymWithHandle` — see macro `dlsym_with_handle!` for the cached
    /// per-symbol form. This is the uncached runtime variant.
    pub unsafe fn dlsym_with_handle(handle: *mut c_void, name: *const c_char) -> *mut c_void {
        #[cfg(unix)] { unsafe { libc::dlsym(handle, name) } }
        #[cfg(windows)] { unsafe { core::ptr::null_mut() } /* GetProcAddress in windows mod */ }
    }

    /// `fork(2)` — POSIX only.
    #[cfg(unix)]
    #[inline] pub unsafe fn fork() -> libc::pid_t { unsafe { libc::fork() } }

    // ── Darwin libproc — process introspection (`<libproc.h>`). ──
    /// `struct proc_bsdinfo` (PROC_PIDTBSDINFO flavour). Fields match the SDK
    /// header; only `pbi_ppid` is currently consumed.
    #[cfg(target_os = "macos")]
    #[repr(C)]
    pub struct struct_proc_bsdinfo {
        pub pbi_flags: u32,
        pub pbi_status: u32,
        pub pbi_xstatus: u32,
        pub pbi_pid: u32,
        pub pbi_ppid: u32,
        pub pbi_uid: u32,
        pub pbi_gid: u32,
        pub pbi_ruid: u32,
        pub pbi_rgid: u32,
        pub pbi_svuid: u32,
        pub pbi_svgid: u32,
        pub rfu_1: u32,
        pub pbi_comm: [u8; 16],
        pub pbi_name: [u8; 32],
        pub pbi_nfiles: u32,
        pub pbi_pgid: u32,
        pub pbi_pjobc: u32,
        pub e_tdev: u32,
        pub e_tpgid: u32,
        pub pbi_nice: i32,
        pub pbi_start_tvsec: u64,
        pub pbi_start_tvusec: u64,
    }
    #[cfg(target_os = "macos")]
    pub const PROC_PIDTBSDINFO: c_int = 3;
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        /// `proc_pidinfo(pid, flavor, arg, buffer, buffersize)` — bytes written or ≤0.
        pub fn proc_pidinfo(pid: c_int, flavor: c_int, arg: u64, buffer: *mut c_void, buffersize: c_int) -> c_int;
        /// `proc_listchildpids(ppid, buffer, buffersize)` — count of pids written.
        pub fn proc_listchildpids(ppid: c_int, buffer: *mut c_void, buffersize: c_int) -> c_int;
    }
}

// ── `bun.linux` / `std.os.linux` — raw kernel syscalls (Linux only). ──
#[cfg(target_os = "linux")]
pub mod linux {
    use core::ffi::{c_char, c_int, c_uint, c_void};
    pub use libc::pollfd;
    pub use libc::epoll_event;

    /// `std.os.linux.timespec` — Zig-shape (`sec`/`nsec`, no `tv_` prefix).
    /// Layout-identical to `libc::timespec` so a `*const timespec` can be
    /// passed straight to `syscall(SYS_futex, ..)`.
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct timespec {
        pub sec: libc::time_t,
        pub nsec: libc::c_long,
    }

    /// `std.os.linux.E` — errno; aliased to `bun_errno::E`.
    pub type Errno = super::E;
    #[inline] pub fn errno() -> c_int { super::last_errno() }

    /// `std.os.linux.E` — kernel errno enum with unprefixed variants and
    /// `init(rc)` decoding the `-errno`-in-return-value Linux raw-syscall ABI.
    /// Newtype (not an alias of `bun_errno::E`) because callers match on
    /// `E::AGAIN`/`E::INTR` (no `E` prefix).
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct E(pub u16);
    impl E {
        pub const SUCCESS:  E = E(0);
        pub const PERM:     E = E(libc::EPERM as u16);
        pub const NOENT:    E = E(libc::ENOENT as u16);
        pub const INTR:     E = E(libc::EINTR as u16);
        pub const AGAIN:    E = E(libc::EAGAIN as u16);
        pub const NOMEM:    E = E(libc::ENOMEM as u16);
        pub const FAULT:    E = E(libc::EFAULT as u16);
        pub const INVAL:    E = E(libc::EINVAL as u16);
        pub const NOSYS:    E = E(libc::ENOSYS as u16);
        pub const TIMEDOUT: E = E(libc::ETIMEDOUT as u16);
        /// Decode a raw Linux syscall return (`-errno` on failure, ≥0 on success).
        #[inline]
        pub fn init(rc: isize) -> E {
            // Zig: `if (rc > -4096) @enumFromInt(-rc) else .SUCCESS`.
            let u = rc as usize;
            if u > (-4096isize) as usize { E((u.wrapping_neg()) as u16) } else { E::SUCCESS }
        }
    }
    impl From<E> for &'static str {
        fn from(e: E) -> &'static str {
            bun_errno::SystemErrno::init(e.0 as i64).map(<&str>::from).unwrap_or("UNKNOWN")
        }
    }

    // ── epoll ──
    /// `std.os.linux.EPOLL` — flag/op constants. Exposed both as a module
    /// (`linux::EPOLL::IN`) and flat (`linux::EPOLL_IN`) since callers use both.
    pub mod EPOLL {
        pub const IN:      u32 = libc::EPOLLIN as u32;
        pub const OUT:     u32 = libc::EPOLLOUT as u32;
        pub const ERR:     u32 = libc::EPOLLERR as u32;
        pub const HUP:     u32 = libc::EPOLLHUP as u32;
        pub const RDHUP:   u32 = libc::EPOLLRDHUP as u32;
        pub const ET:      u32 = libc::EPOLLET as u32;
        pub const ONESHOT: u32 = libc::EPOLLONESHOT as u32;
        pub const CTL_ADD: i32 = libc::EPOLL_CTL_ADD;
        pub const CTL_MOD: i32 = libc::EPOLL_CTL_MOD;
        pub const CTL_DEL: i32 = libc::EPOLL_CTL_DEL;
    }
    pub const EPOLL_IN:      u32 = EPOLL::IN;
    pub const EPOLL_OUT:     u32 = EPOLL::OUT;
    pub const EPOLL_ERR:     u32 = EPOLL::ERR;
    pub const EPOLL_HUP:     u32 = EPOLL::HUP;
    pub const EPOLL_RDHUP:   u32 = EPOLL::RDHUP;
    pub const EPOLL_ET:      u32 = EPOLL::ET;
    pub const EPOLL_ONESHOT: u32 = EPOLL::ONESHOT;
    pub const EPOLL_CTL_ADD: i32 = EPOLL::CTL_ADD;
    pub const EPOLL_CTL_MOD: i32 = EPOLL::CTL_MOD;
    pub const EPOLL_CTL_DEL: i32 = EPOLL::CTL_DEL;

    // ── futex ──
    /// `std.os.linux.FUTEX` op (cmd + private flag), packed as Zig does.
    #[derive(Clone, Copy)]
    pub struct FutexOp { pub cmd: FutexCmd, pub private: bool }
    impl FutexOp {
        #[inline] fn raw(self) -> c_int {
            self.cmd as c_int | if self.private { libc::FUTEX_PRIVATE_FLAG } else { 0 }
        }
    }
    #[derive(Clone, Copy)] #[repr(i32)]
    pub enum FutexCmd {
        WAIT = libc::FUTEX_WAIT,
        WAKE = libc::FUTEX_WAKE,
        REQUEUE = libc::FUTEX_REQUEUE,
        WAIT_BITSET = libc::FUTEX_WAIT_BITSET,
        WAKE_BITSET = libc::FUTEX_WAKE_BITSET,
    }
    /// `syscall(SYS_futex, uaddr, op, val)` — 3-arg form (WAKE).
    /// Returns the raw kernel rc (decode with `E::init`).
    #[inline]
    pub unsafe fn futex_3arg(uaddr: *const u32, op: FutexOp, val: u32) -> isize {
        unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val) as isize }
    }
    /// `syscall(SYS_futex, uaddr, op, val, timeout)` — 4-arg form (WAIT).
    #[inline]
    pub unsafe fn futex_4arg(
        uaddr: *const u32, op: FutexOp, val: u32, timeout: *const timespec,
    ) -> isize {
        unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val, timeout) as isize }
    }

    /// inotify mask flags (`std.os.linux.IN`).
    pub mod IN {
        pub const ACCESS: u32        = libc::IN_ACCESS;
        pub const MODIFY: u32        = libc::IN_MODIFY;
        pub const ATTRIB: u32        = libc::IN_ATTRIB;
        pub const CLOSE_WRITE: u32   = libc::IN_CLOSE_WRITE;
        pub const CLOSE_NOWRITE: u32 = libc::IN_CLOSE_NOWRITE;
        pub const OPEN: u32          = libc::IN_OPEN;
        pub const MOVED_FROM: u32    = libc::IN_MOVED_FROM;
        pub const MOVED_TO: u32      = libc::IN_MOVED_TO;
        pub const CREATE: u32        = libc::IN_CREATE;
        pub const DELETE: u32        = libc::IN_DELETE;
        pub const DELETE_SELF: u32   = libc::IN_DELETE_SELF;
        pub const MOVE_SELF: u32     = libc::IN_MOVE_SELF;
        pub const ONLYDIR: u32       = libc::IN_ONLYDIR;
        pub const DONT_FOLLOW: u32   = libc::IN_DONT_FOLLOW;
        pub const EXCL_UNLINK: u32   = libc::IN_EXCL_UNLINK;
        pub const MASK_ADD: u32      = libc::IN_MASK_ADD;
        pub const ISDIR: u32         = libc::IN_ISDIR;
        pub const ONESHOT: u32       = libc::IN_ONESHOT;
        pub const IGNORED: u32       = libc::IN_IGNORED;
        pub const CLOEXEC: c_int     = libc::IN_CLOEXEC;
        pub const NONBLOCK: c_int    = libc::IN_NONBLOCK;
        use core::ffi::c_int;
    }

    #[inline]
    pub unsafe fn inotify_init1(flags: c_int) -> c_int {
        unsafe { libc::inotify_init1(flags) }
    }
    #[inline]
    pub unsafe fn inotify_add_watch(fd: c_int, path: *const c_char, mask: u32) -> c_int {
        unsafe { libc::inotify_add_watch(fd, path, mask) }
    }
    #[inline]
    pub unsafe fn inotify_rm_watch(fd: c_int, wd: c_int) -> c_int {
        unsafe { libc::inotify_rm_watch(fd, wd) }
    }
    /// Raw `read(2)` returning kernel `usize` (Zig: `std.os.linux.read`).
    #[inline]
    pub unsafe fn read(fd: c_int, buf: *mut u8, count: usize) -> isize {
        unsafe { libc::read(fd, buf.cast(), count) }
    }
    /// Raw `sendfile(out, in, *offset, count)` (Zig: `std.os.linux.sendfile`).
    #[inline]
    pub unsafe fn sendfile(out_fd: c_int, in_fd: c_int, offset: *mut i64, count: usize) -> isize {
        unsafe { libc::sendfile(out_fd, in_fd, offset, count) }
    }
    /// Raw `ppoll(fds, nfds, *timeout, *sigmask)`.
    #[inline]
    pub unsafe fn ppoll(
        fds: *mut pollfd, nfds: usize,
        timeout: *const libc::timespec, sigmask: *const libc::sigset_t,
    ) -> c_int {
        unsafe { libc::ppoll(fds, nfds as _, timeout, sigmask) }
    }
    #[inline]
    pub unsafe fn epoll_ctl(epfd: c_int, op: c_int, fd: c_int, event: *mut epoll_event) -> c_int {
        unsafe { libc::epoll_ctl(epfd, op, fd, event) }
    }

    // ── `std.os.linux.*` syscall thunks ──
    // PORT NOTE: Zig's `std.os.linux.ioctl`/`copy_file_range` are *true* raw
    // syscalls returning the kernel `-errno`-in-`usize` ABI. glibc's
    // `libc::syscall()` is NOT — it returns `-1` and sets thread-local errno
    // on failure. Returning `isize` here routes callers through the
    // libc-convention `GetErrno for isize` impl (reads `errno`), instead of
    // the kernel-convention `GetErrno for usize` impl which would mis-decode
    // every failure as EPERM (`-1 as usize` → errno 1).

    /// `bun.linux.ioctl_ficlone` (platform/linux.zig:71): raw FICLONE ioctl.
    /// Support for FICLONE is dependent on the filesystem driver.
    #[inline]
    pub fn ioctl_ficlone(dest_fd: super::Fd, src_fd: super::Fd) -> isize {
        // FICLONE = _IOW(0x94, 9, c_int). Value matches Zig's `bun.c.FICLONE`.
        const FICLONE: libc::c_ulong = 0x40049409;
        // SAFETY: raw `ioctl(2)`; both fds owned by caller.
        unsafe {
            libc::syscall(libc::SYS_ioctl, dest_fd.native() as libc::c_long, FICLONE, src_fd.native() as libc::c_long) as isize
        }
    }

    /// `std.os.linux.copy_file_range` raw syscall.
    #[inline]
    pub unsafe fn copy_file_range(
        in_: c_int, off_in: *mut i64, out: c_int, off_out: *mut i64, len: usize, flags: u32,
    ) -> isize {
        // SAFETY: raw `copy_file_range(2)`; caller owns fds, offset ptrs may be null.
        unsafe {
            libc::syscall(
                libc::SYS_copy_file_range,
                in_ as libc::c_long, off_in, out as libc::c_long, off_out, len, flags as libc::c_long,
            ) as isize
        }
    }

    // `std.os.linux.sendfile` — use the existing `linux::sendfile` (libc
    // wrapper, isize return) defined above; `get_errno::<isize>` decodes it.

    /// `bun.linux.RWFFlagSupport` — runtime probe for `RWF_NOWAIT` (kernel ≥ 4.14).
    pub struct RWFFlagSupport;
    static RWF_STATE: core::sync::atomic::AtomicI8 = core::sync::atomic::AtomicI8::new(0);
    impl RWFFlagSupport {
        /// 0 = unknown, 1 = yes, -1 = no. On first call (unknown), checks for
        /// the buggy 5.9/5.10 kernels and the env-flag override before resolving.
        #[inline]
        pub fn is_maybe_supported() -> bool {
            match RWF_STATE.load(core::sync::atomic::Ordering::Relaxed) {
                0 => {
                    // platform/linux.zig:44 — kernels 5.9/5.10 have a buggy
                    // RWF_NOWAIT (returns EAGAIN spuriously); disable on those.
                    let v = bun_core::linux_kernel_version();
                    let buggy = v.major == 5 && (v.minor == 9 || v.minor == 10);
                    // BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK env override.
                    let env_off = bun_core::getenv_z(
                        bun_core::zstr!("BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK"),
                    ).is_some();
                    let r = if buggy || env_off { -1 } else { 1 };
                    RWF_STATE.store(r, core::sync::atomic::Ordering::Relaxed);
                    r > 0
                }
                s => s > 0,
            }
        }
        #[inline]
        pub fn disable() {
            RWF_STATE.store(-1, core::sync::atomic::Ordering::Relaxed);
        }
    }
}
#[cfg(not(target_os = "linux"))]
pub mod linux {
    // Empty on non-Linux; callers gate on `cfg(target_os = "linux")`.
}

// ── `bun.darwin` — Darwin-only platform surface. ──
#[cfg(target_os = "macos")]
pub mod darwin {
    use core::ffi::{c_char, c_void};
    use core::marker::{PhantomData, PhantomPinned};

    /// Opaque `os_log_t` handle (`<os/log.h>`).
    #[repr(C)]
    pub struct OSLog {
        _p: [u8; 0],
        _m: PhantomData<(*mut u8, PhantomPinned)>,
    }
    impl OSLog {
        /// `os_log_create("com.bun.bun", "PointsOfInterest")` — null on failure.
        pub fn init() -> Option<core::ptr::NonNull<OSLog>> {
            unsafe extern "C" {
                fn os_log_create(subsystem: *const c_char, category: *const c_char) -> *mut OSLog;
            }
            // SAFETY: static C-string literals.
            let p = unsafe { os_log_create(c"com.bun.bun".as_ptr(), c"PointsOfInterest".as_ptr()) };
            core::ptr::NonNull::new(p)
        }
        #[inline] pub fn as_ptr(&self) -> *const OSLog { self as *const _ }
        /// Full signpost API lives in `bun_platform::darwin`; this stub lets
        /// `bun_perf` compile its Darwin arm without pulling that crate up-tier.
        pub fn signpost(&self, name: i32) -> os_log::Signpost<'_> {
            os_log::Signpost { log: self, name }
        }
    }
    /// `std.c.EVFILT` — kqueue filter constants.
    pub mod EVFILT {
        pub const READ:   i16 = libc::EVFILT_READ;
        pub const WRITE:  i16 = libc::EVFILT_WRITE;
        pub const VNODE:  i16 = libc::EVFILT_VNODE;
        pub const PROC:   i16 = libc::EVFILT_PROC;
        pub const SIGNAL: i16 = libc::EVFILT_SIGNAL;
        pub const TIMER:  i16 = libc::EVFILT_TIMER;
        pub const USER:   i16 = libc::EVFILT_USER;
        pub const MACHPORT: i16 = libc::EVFILT_MACHPORT;
    }
    /// `std.c.EV` — kqueue event flags (Darwin).
    pub mod EV {
        pub const ADD:      u16 = libc::EV_ADD;
        pub const DELETE:   u16 = libc::EV_DELETE;
        pub const ENABLE:   u16 = libc::EV_ENABLE;
        pub const DISABLE:  u16 = libc::EV_DISABLE;
        pub const ONESHOT:  u16 = libc::EV_ONESHOT;
        pub const CLEAR:    u16 = libc::EV_CLEAR;
        pub const RECEIPT:  u16 = libc::EV_RECEIPT;
        pub const DISPATCH: u16 = libc::EV_DISPATCH;
        pub const EOF:      u16 = libc::EV_EOF;
        pub const ERROR:    u16 = libc::EV_ERROR;
    }
    /// `std.c.NOTE` — kqueue fflags (Darwin).
    pub mod NOTE {
        pub const EXIT:       u32 = libc::NOTE_EXIT;
        pub const EXITSTATUS: u32 = libc::NOTE_EXITSTATUS;
        pub const SIGNAL:     u32 = libc::NOTE_SIGNAL;
        pub const FORK:       u32 = libc::NOTE_FORK;
        pub const EXEC:       u32 = libc::NOTE_EXEC;
        pub const TRIGGER:    u32 = libc::NOTE_TRIGGER;
        pub const DELETE:     u32 = libc::NOTE_DELETE;
        pub const WRITE:      u32 = libc::NOTE_WRITE;
        pub const EXTEND:     u32 = libc::NOTE_EXTEND;
        pub const ATTRIB:     u32 = libc::NOTE_ATTRIB;
        pub const LINK:       u32 = libc::NOTE_LINK;
        pub const RENAME:     u32 = libc::NOTE_RENAME;
        pub const REVOKE:     u32 = libc::NOTE_REVOKE;
    }
    /// Darwin `struct kevent64_s` (extended kevent with 2-slot `ext[]`).
    pub use libc::kevent64_s;
    /// `kevent64()` — Darwin's wider kevent. Thin re-export so callers don't
    /// need a direct `libc` dep.
    #[inline]
    pub unsafe fn kevent64(
        kq: core::ffi::c_int,
        changelist: *const kevent64_s, nchanges: core::ffi::c_int,
        eventlist: *mut kevent64_s, nevents: core::ffi::c_int,
        flags: core::ffi::c_uint, timeout: *const libc::timespec,
    ) -> core::ffi::c_int {
        unsafe { libc::kevent64(kq, changelist, nchanges, eventlist, nevents, flags, timeout) }
    }

    pub mod os_log {
        pub struct Signpost<'a> { pub log: &'a super::OSLog, pub name: i32 }
        impl<'a> Signpost<'a> {
            pub fn interval(&self, _cat: signpost::Category) -> signpost::Interval {
                signpost::Interval { _p: () }
            }
        }
        pub mod signpost {
            #[derive(Clone, Copy)] #[repr(u8)]
            pub enum Category { PointsOfInterest = 0 }
            pub struct Interval { pub(crate) _p: () }
            impl Interval { pub fn end(&self) {} }
        }
    }
}
#[cfg(not(target_os = "macos"))]
pub mod darwin {}

// ── `std.DynLib` — cross-platform dynamic library handle. ──
pub struct DynLib {
    handle: *mut c_void,
}
unsafe impl Send for DynLib {}
unsafe impl Sync for DynLib {}
impl DynLib {
    /// `dlopen(path, RTLD_LAZY)` / `LoadLibraryA(path)`.
    pub fn open(path: &[u8]) -> core::result::Result<Self, bun_core::Error> {
        let mut buf = bun_paths::PathBuffer::default();
        // `std.DynLib.open` returns `error.NameTooLong`; never truncate (could
        // dlopen a different library whose path is a prefix of the requested one).
        if path.len() >= buf.0.len() {
            return Err(bun_core::err!("NameTooLong"));
        }
        let len = path.len();
        buf.0[..len].copy_from_slice(path);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), len) };
        match dlopen(z, RTLD::LAZY) {
            Some(h) => Ok(Self { handle: h }),
            None => Err(bun_core::err!("FileNotFound")),
        }
    }
    /// `dlsym` typed lookup.
    pub fn lookup<T>(&self, name: &ZStr) -> Option<T> {
        let p = dlsym_impl(Some(self.handle), name)?;
        // SAFETY: caller asserts `T` is a fn-pointer or `*mut c_void`-shaped type
        // matching the symbol's ABI (same as Zig `bun.cast(T, ptr)`).
        Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&p) })
    }
    pub fn close(self) {
        #[cfg(unix)]
        unsafe { libc::dlclose(self.handle); }
        // Windows: FreeLibrary via windows mod; intentionally leaked here
        // (Zig `DynLib.close` on Windows is a no-op in our usage).
    }
    #[inline] pub fn handle(&self) -> *mut c_void { self.handle }
}

/// `std.c.RTLD` flags for `dlopen`.
pub mod RTLD {
    pub const LAZY:   i32 = libc::RTLD_LAZY;
    pub const NOW:    i32 = libc::RTLD_NOW;
    pub const GLOBAL: i32 = libc::RTLD_GLOBAL;
    pub const LOCAL:  i32 = libc::RTLD_LOCAL;
}

/// sys.zig:4557 — `dlopen(filename, flags)`. Windows → `LoadLibraryA`.
pub fn dlopen(filename: &ZStr, flags: i32) -> Option<*mut c_void> {
    #[cfg(unix)] {
        // SAFETY: filename is NUL-terminated.
        let p = unsafe { libc::dlopen(filename.as_ptr(), flags) };
        if p.is_null() { None } else { Some(p) }
    }
    #[cfg(windows)] {
        let _ = flags;
        // SAFETY: filename is NUL-terminated.
        let p = unsafe { bun_windows_sys::externs::LoadLibraryA(filename.as_ptr()) };
        if p.is_null() { None } else { Some(p.cast()) }
    }
}
/// sys.zig:4565 — `dlsym(handle, name)`.
pub fn dlsym_impl(handle: Option<*mut c_void>, name: &ZStr) -> Option<*mut c_void> {
    #[cfg(unix)] {
        let h = handle.unwrap_or(core::ptr::null_mut());
        // SAFETY: name is NUL-terminated; dlsym accepts NULL handle as RTLD_DEFAULT.
        let p = unsafe { libc::dlsym(h, name.as_ptr()) };
        if p.is_null() { None } else { Some(p) }
    }
    #[cfg(windows)] {
        // sys.zig:4565 — Windows arm calls `GetProcAddressA` (which widens
        // `name` to UTF-16 and forwards to kernel32 `GetProcAddress`).
        windows::GetProcAddressA(handle, name)
    }
}
/// `bun.c.dlsymWithHandle` — once-cached typed lookup. The Zig version
/// monomorphises per `(Type, name, handle_getter)`; in Rust this is a macro.
#[macro_export]
macro_rules! dlsym_with_handle {
    ($T:ty, $name:literal, $handle:expr) => {{
        static ONCE: ::std::sync::Once = ::std::sync::Once::new();
        static mut PTR: *mut ::core::ffi::c_void = ::core::ptr::null_mut();
        ONCE.call_once(|| {
            if let Some(p) = $crate::dlsym_impl($handle, ::bun_core::zstr!($name)) {
                // SAFETY: only mutated once under Once.
                unsafe { PTR = p; }
            }
        });
        // SAFETY: read-only after Once; caller asserts `$T` is fn-ptr-shaped.
        let p = unsafe { PTR };
        if p.is_null() { None } else {
            Some(unsafe { ::core::mem::transmute_copy::<*mut ::core::ffi::c_void, $T>(&p) })
        }
    }};
}

// ── open helpers (sys.zig posix arms) ──

/// `openA` — like `open` but takes a non-NUL-terminated slice.
pub fn open_a(path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    openat_a(Fd::cwd(), path, flags, perm)
}
/// `openatA` — like `openat` but takes a non-NUL-terminated slice.
pub fn openat_a(dir: Fd, path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    let mut buf = bun_paths::PathBuffer::default();
    if path.len() >= buf.0.len() {
        return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::open).with_path(path));
    }
    buf.0[..path.len()].copy_from_slice(path);
    buf.0[path.len()] = 0;
    // SAFETY: NUL-terminated above.
    let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), path.len()) };
    openat(dir, z, flags, perm)
}
/// sys.zig:1705 `openatOSPath` — `openat` taking a platform-native path
/// (`OSPathSliceZ` = `ZStr` on POSIX, `WStr` on Windows). On POSIX this is
/// identical to `openat`; on Windows it routes through the NT openat path.
#[cfg(not(windows))]
#[inline]
pub fn openat_os_path(dirfd: Fd, file_path: &bun_paths::OSPathSliceZ, flags: i32, perm: Mode) -> Maybe<Fd> {
    openat(dirfd, file_path, flags, perm)
}
#[cfg(windows)]
#[inline]
pub fn openat_os_path(dirfd: Fd, file_path: &bun_paths::OSPathSliceZ, flags: i32, perm: Mode) -> Maybe<Fd> {
    openat_windows(dirfd, file_path.as_slice(), flags, perm)
}
/// `mkdiratZ` — `mkdirat` with already-NUL-terminated path. Same as `mkdirat`.
#[inline]
pub fn mkdirat_z(dir: Fd, path: &ZStr, mode: Mode) -> Maybe<()> {
    mkdirat(dir, path, mode)
}
/// bun.zig:879 `openDirA` — open a path as an iterable directory fd.
pub fn open_dir_at(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    openat_a(dir, path, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0)
}
/// bun.zig:890 `openDirAbsolute`. PORT NOTE: returns `Fd`, not `std.fs.Dir`.
pub fn open_dir_absolute(path: &[u8]) -> Maybe<Fd> {
    open_a(path, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0)
}
/// sys.zig:2615 `symlinkRunningExecutable` — same as `symlink`, except it
/// handles ETXTBSY/EBUSY by unlinking the destination and retrying once.
pub fn symlink_running_executable(target: &ZStr, dest: &ZStr) -> Maybe<()> {
    match symlink(target, dest) {
        Err(err) => match err.get_errno() {
            E::EBUSY | E::ETXTBSY => {
                let _ = unlink(dest);
                symlink(target, dest)
            }
            _ => Err(err),
        },
        Ok(()) => Ok(()),
    }
}
/// `std.fs.deleteTreeAbsolute` — best-effort recursive delete of an absolute
/// path. Routes through `Dir::delete_tree` on the parent directory.
pub fn delete_tree_absolute(path: &[u8]) -> core::result::Result<(), bun_core::Error> {
    let parent = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(path);
    let base = bun_paths::basename(path);
    if parent.is_empty() || base.is_empty() {
        // Nothing sensible to do (root or empty); mirror Zig's silent success on ENOENT.
        return Ok(());
    }
    let dir = open_dir_absolute(parent).map(Dir::from_fd).map_err(bun_core::Error::from)?;
    let res = dir.delete_tree(base);
    dir.close();
    res
}
/// bun.zig:899 — Windows variant skips `DELETE` access; on POSIX identical.
pub fn open_dir_absolute_not_for_deleting_or_renaming(path: &[u8]) -> Maybe<Fd> {
    open_dir_absolute(path)
}
/// `openFileReadOnly` — `open(path, O_RDONLY|O_CLOEXEC)`.
pub fn open_file_read_only(path: &[u8]) -> Maybe<Fd> {
    open_a(path, O::RDONLY | O::CLOEXEC, 0)
}
/// `openatReadOnly` — `openat(dir, path, O_RDONLY|O_CLOEXEC)`.
pub fn openat_read_only(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    openat_a(dir, path, O::RDONLY | O::CLOEXEC, 0)
}
// ──────────────────────────────────────────────────────────────────────────
// `openatWindows` family — sys.zig:1217-1490. Maps POSIX-style `O::*` flags
// onto an `NtCreateFile` call (or `openDirAtWindows` when `O_DIRECTORY` is
// set). On POSIX this is a `@compileError` in Zig; the surface is gated.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
const FILE_SHARE: u32 = bun_windows_sys::FILE_SHARE_READ
    | bun_windows_sys::FILE_SHARE_WRITE
    | bun_windows_sys::FILE_SHARE_DELETE;

/// sys.zig:1217 `WindowsOpenDirOptions`.
#[cfg(windows)]
#[derive(Clone, Copy, Default)]
pub struct WindowsOpenDirOptions {
    pub iterable: bool,
    pub no_follow: bool,
    pub can_rename_or_delete: bool,
    pub op: WindowsOpenDirOp,
    pub read_only: bool,
}
#[cfg(windows)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum WindowsOpenDirOp {
    #[default] OnlyOpen,
    OnlyCreate,
    OpenOrCreate,
}

/// sys.zig:1457 `NtCreateFileOptions`.
#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct NtCreateFileOptions {
    pub access_mask: u32,
    pub disposition: u32,
    pub options: u32,
    pub attributes: u32,
    pub sharing_mode: u32,
}
#[cfg(windows)]
impl Default for NtCreateFileOptions {
    fn default() -> Self {
        Self {
            access_mask: 0,
            disposition: 0,
            options: 0,
            attributes: bun_windows_sys::FILE_ATTRIBUTE_NORMAL,
            sharing_mode: FILE_SHARE,
        }
    }
}

/// sys.zig:1129 `normalizePathWindows` — convert a (possibly relative) path
/// into an NT object path suitable for `NtCreateFile` against `dir_fd`.
/// PORT NOTE: u16-only here; the u8 entry points pre-convert via
/// `bun_str::strings::to_nt_path` and call this with the resulting wide slice.
#[cfg(windows)]
fn normalize_path_windows<'a>(
    dir_fd: Fd,
    path: &[u16],
    buf: &'a mut [u16],
) -> Maybe<&'a bun_core::WStr> {
    use bun_core::WStr;
    let too_long = || Error::from_code(E::ENAMETOOLONG, Tag::open);

    if bun_paths::is_absolute_windows_wtf16(path) {
        // Absolute → add `\??\` (idempotent if already present), normalize
        // separators/`..` and NUL-terminate.
        let nt = bun_str::strings::to_nt_path16(buf, path);
        return Ok(nt);
    }

    // Relative path with no separators or `.` can be passed straight through
    // to `NtCreateFile` against `RootDirectory`.
    if !path.iter().any(|&c| c == b'\\' as u16 || c == b'/' as u16 || c == b'.' as u16) {
        if path.len() >= buf.len() { return Err(too_long()); }
        buf[..path.len()].copy_from_slice(path);
        buf[path.len()] = 0;
        // SAFETY: NUL written at buf[path.len()].
        return Ok(unsafe { WStr::from_raw(buf.as_ptr(), path.len()) });
    }

    // Otherwise: resolve `dir_fd` to its full path, join, normalize.
    let base_fd = if dir_fd.is_valid() { dir_fd.cast() } else { Fd::cwd().cast() };
    let mut base_buf = bun_paths::w_path_buffer_pool::get();
    let base = match windows::GetFinalPathNameByHandle(
        base_fd,
        Default::default(),
        &mut base_buf.0[..],
    ) {
        Ok(p) => p,
        Err(_) => return Err(Error::from_code(E::EBADF, Tag::open)),
    };

    // Strip a leading drive letter (`C:`) on the relative part (sys.zig:1204).
    let mut rel = path;
    if rel.len() >= 2 && bun_paths::is_drive_letter_t::<u16>(rel[0]) && rel[1] == b':' as u16 {
        rel = &rel[2..];
    }

    let mut joined = bun_paths::w_path_buffer_pool::get();
    let joined_len = base.len() + 1 + rel.len();
    if joined_len > joined.0.len() { return Err(too_long()); }
    joined.0[..base.len()].copy_from_slice(base);
    joined.0[base.len()] = b'\\' as u16;
    joined.0[base.len() + 1..joined_len].copy_from_slice(rel);
    let nt = bun_str::strings::to_nt_path16(buf, &joined.0[..joined_len]);
    Ok(nt)
}

/// sys.zig:1382 — open a `\\.\…` device path via kernel32 `CreateFileW`
/// (NtCreateFile cannot open device paths).
#[cfg(windows)]
fn open_windows_device_path(
    path: &bun_core::WStr,
    desired_access: u32,
    creation_disposition: u32,
    flags_and_attributes: u32,
) -> Maybe<Fd> {
    use bun_windows_sys::externs as w;
    // SAFETY: path is NUL-terminated UTF-16.
    let rc = unsafe {
        w::CreateFileW(
            path.as_ptr(),
            desired_access,
            FILE_SHARE,
            core::ptr::null_mut(),
            creation_disposition,
            flags_and_attributes,
            core::ptr::null_mut(),
        )
    };
    if rc == bun_windows_sys::INVALID_HANDLE_VALUE {
        let errno = windows::Win32Error::get()
            .to_system_errno()
            .unwrap_or(E::EUNKNOWN);
        return Err(Error::from_code(errno, Tag::open));
    }
    Ok(Fd::from_native(rc))
}

/// sys.zig:1231 `openDirAtWindowsNtPath` — `NtCreateFile` with
/// `FILE_DIRECTORY_FILE`.
#[cfg(windows)]
pub fn open_dir_at_windows_nt_path(
    dir_fd: Fd,
    path: &bun_core::WStr,
    options: WindowsOpenDirOptions,
) -> Maybe<Fd> {
    use bun_windows_sys::externs as w;
    let base_flags = w::STANDARD_RIGHTS_READ | w::FILE_READ_ATTRIBUTES | w::FILE_READ_EA
        | w::SYNCHRONIZE | w::FILE_TRAVERSE;
    let iterable_flag: u32 = if options.iterable { w::FILE_LIST_DIRECTORY } else { 0 };
    let rename_flag: u32 = if options.can_rename_or_delete { w::DELETE } else { 0 };
    let read_only_flag: u32 =
        if options.read_only { 0 } else { w::FILE_ADD_FILE | w::FILE_ADD_SUBDIRECTORY };
    let flags = iterable_flag | base_flags | rename_flag | read_only_flag;
    let open_reparse: u32 = if options.no_follow { w::FILE_OPEN_REPARSE_POINT } else { 0 };

    // NtCreateFile seems to not function on device paths. Since it is
    // absolute, it can just use CreateFileW.
    let p = path.as_slice();
    if p.len() >= 4
        && p[0] == b'\\' as u16 && p[1] == b'\\' as u16
        && p[2] == b'.' as u16 && p[3] == b'\\' as u16
    {
        return open_windows_device_path(
            path,
            flags,
            if options.op != WindowsOpenDirOp::OnlyOpen { w::FILE_OPEN_IF } else { w::FILE_OPEN },
            w::FILE_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT
                | windows::FILE_OPEN_FOR_BACKUP_INTENT | open_reparse,
        );
    }

    let path_len_bytes = (p.len() * 2) as u16;
    let mut nt_name = w::UNICODE_STRING {
        Length: path_len_bytes,
        MaximumLength: path_len_bytes,
        Buffer: p.as_ptr() as *mut u16,
    };
    let mut attr = w::OBJECT_ATTRIBUTES {
        Length: core::mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: if bun_paths::is_absolute_windows_wtf16(p) {
            core::ptr::null_mut()
        } else if dir_fd.is_valid() {
            dir_fd.cast()
        } else {
            Fd::cwd().cast()
        },
        Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        ObjectName: &mut nt_name,
        SecurityDescriptor: core::ptr::null_mut(),
        SecurityQualityOfService: core::ptr::null_mut(),
    };
    let mut fd: w::HANDLE = bun_windows_sys::INVALID_HANDLE_VALUE;
    // SAFETY: all-zero is a valid IO_STATUS_BLOCK.
    let mut io: w::IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
    // SAFETY: FFI; all pointer args valid for the call.
    let rc = unsafe {
        w::ntdll::NtCreateFile(
            &mut fd,
            flags,
            &mut attr,
            &mut io,
            core::ptr::null_mut(),
            0,
            FILE_SHARE,
            match options.op {
                WindowsOpenDirOp::OnlyOpen => w::FILE_OPEN,
                WindowsOpenDirOp::OnlyCreate => w::FILE_CREATE,
                WindowsOpenDirOp::OpenOrCreate => w::FILE_OPEN_IF,
            },
            w::FILE_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT
                | windows::FILE_OPEN_FOR_BACKUP_INTENT | open_reparse,
            core::ptr::null_mut(),
            0,
        )
    };
    match windows::Win32Error::from_nt_status(rc) {
        windows::Win32Error::SUCCESS => Ok(Fd::from_native(fd)),
        code => Err(Error::from_code(
            code.to_system_errno().unwrap_or(E::EUNKNOWN),
            Tag::open,
        )),
    }
}

/// sys.zig:1467 `openFileAtWindowsNtPath`.
///
/// For this function to open an absolute path, it must start with `\??\`.
/// Otherwise you need a reference file descriptor; the "invalid_fd" file
/// descriptor signifies that the current working directory should be used.
#[cfg(windows)]
pub fn open_file_at_windows_nt_path(
    dir: Fd,
    path: &bun_core::WStr,
    options: NtCreateFileOptions,
) -> Maybe<Fd> {
    use bun_windows_sys::externs as w;
    let p = path.as_slice();
    let mut result: w::HANDLE = core::ptr::null_mut();
    let path_len_bytes = match u16::try_from(p.len() * 2) {
        Ok(v) => v,
        Err(_) => return Err(Error::from_code(E::ENOMEM, Tag::open)),
    };
    let mut nt_name = w::UNICODE_STRING {
        Length: path_len_bytes,
        MaximumLength: path_len_bytes,
        Buffer: p.as_ptr() as *mut u16,
    };
    let has_nt_prefix = p.len() >= 4
        && p[0] == b'\\' as u16 && p[1] == b'?' as u16
        && p[2] == b'?' as u16 && p[3] == b'\\' as u16;
    let mut attr = w::OBJECT_ATTRIBUTES {
        Length: core::mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
        // [ObjectName] must be a fully qualified file specification or the
        // name of a device object, unless it is the name of a file relative
        // to the directory specified by RootDirectory.
        ObjectName: &mut nt_name,
        RootDirectory: if has_nt_prefix {
            core::ptr::null_mut()
        } else if dir.is_valid() {
            dir.cast()
        } else {
            Fd::cwd().cast()
        },
        Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        SecurityDescriptor: core::ptr::null_mut(),
        SecurityQualityOfService: core::ptr::null_mut(),
    };
    // SAFETY: all-zero is a valid IO_STATUS_BLOCK.
    let mut io: w::IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };

    let mut attributes = options.attributes;
    loop {
        // SAFETY: FFI; all pointer args valid for the call.
        let rc = unsafe {
            w::ntdll::NtCreateFile(
                &mut result,
                options.access_mask,
                &mut attr,
                &mut io,
                core::ptr::null_mut(),
                attributes,
                options.sharing_mode,
                options.disposition,
                options.options,
                core::ptr::null_mut(),
                0,
            )
        };

        if rc == w::NTSTATUS::ACCESS_DENIED
            && attributes == w::FILE_ATTRIBUTE_NORMAL
            && (options.access_mask & (w::GENERIC_READ | w::GENERIC_WRITE)) == w::GENERIC_WRITE
        {
            // > If CREATE_ALWAYS and FILE_ATTRIBUTE_NORMAL are specified,
            // > CreateFile fails and sets the last error to ERROR_ACCESS_DENIED
            // > if the file exists and has the FILE_ATTRIBUTE_HIDDEN or
            // > FILE_ATTRIBUTE_SYSTEM attribute. To avoid the error, specify
            // > the same attributes as the existing file.
            //
            // The above also applies to NtCreateFile. We retry, but only when
            // the file was opened for writing.
            //
            // See https://github.com/oven-sh/bun/issues/6820
            //     https://github.com/libuv/libuv/pull/3380
            attributes = w::FILE_ATTRIBUTE_HIDDEN;
            continue;
        }

        return match windows::Win32Error::from_nt_status(rc) {
            windows::Win32Error::SUCCESS => {
                if (options.access_mask & w::FILE_APPEND_DATA) != 0 {
                    // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfilepointerex
                    // SAFETY: FFI; result is a valid handle.
                    if unsafe {
                        w::SetFilePointerEx(result, 0, core::ptr::null_mut(), w::FILE_END)
                    } == 0 {
                        return Err(Error::from_code(E::EUNKNOWN, Tag::SetFilePointerEx));
                    }
                }
                Ok(Fd::from_native(result))
            }
            code => Err(Error::from_code(
                code.to_system_errno().unwrap_or(E::EUNKNOWN),
                Tag::open,
            )),
        };
    }
}

#[cfg(windows)]
pub fn open_dir_at_windows(dir_fd: Fd, path: &[u16], options: WindowsOpenDirOptions) -> Maybe<Fd> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir_fd, path, &mut wbuf.0[..])?;
    open_dir_at_windows_nt_path(dir_fd, norm, options)
}
#[cfg(windows)]
#[inline(never)]
pub fn open_dir_at_windows_a(dir_fd: Fd, path: &[u8], options: WindowsOpenDirOptions) -> Maybe<Fd> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let nt = bun_str::strings::to_nt_path(&mut wbuf.0[..], path);
    // PORT NOTE: re-borrow as &[u16] then re-normalize for the relative case.
    let mut buf2 = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir_fd, nt.as_slice(), &mut buf2.0[..])?;
    open_dir_at_windows_nt_path(dir_fd, norm, options)
}
#[cfg(windows)]
pub fn open_file_at_windows(dir_fd: Fd, path: &[u16], opts: NtCreateFileOptions) -> Maybe<Fd> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir_fd, path, &mut wbuf.0[..])?;
    open_file_at_windows_nt_path(dir_fd, norm, opts)
}

/// sys.zig:1608 `openatWindowsTMaybeNormalize` — POSIX-flag → NtCreateFile
/// translation.
#[cfg(windows)]
fn openat_windows_impl(
    dir: Fd,
    norm: &bun_core::WStr,
    flags: i32,
    perm: Mode,
) -> Maybe<Fd> {
    use bun_windows_sys::externs as w;
    if (flags & O::DIRECTORY) != 0 {
        // We interpret `O_PATH` as meaning "no iteration".
        return open_dir_at_windows_nt_path(dir, norm, WindowsOpenDirOptions {
            iterable: (flags & O::PATH) == 0,
            no_follow: (flags & O::NOFOLLOW) != 0,
            can_rename_or_delete: false,
            ..Default::default()
        });
    }

    let nonblock = (flags & O::NONBLOCK) != 0;
    let overwrite = (flags & O::WRONLY) != 0 && (flags & O::APPEND) == 0;

    let mut access_mask: u32 = w::READ_CONTROL | w::FILE_WRITE_ATTRIBUTES | w::SYNCHRONIZE;
    if (flags & O::RDWR) != 0 {
        access_mask |= w::GENERIC_READ | w::GENERIC_WRITE;
    } else if (flags & O::APPEND) != 0 {
        access_mask |= w::GENERIC_WRITE | w::FILE_APPEND_DATA;
    } else if (flags & O::WRONLY) != 0 {
        access_mask |= w::GENERIC_WRITE;
    } else {
        access_mask |= w::GENERIC_READ;
    }

    let disposition: u32 = 'blk: {
        if (flags & O::CREAT) != 0 {
            if (flags & O::EXCL) != 0 { break 'blk w::FILE_CREATE; }
            break 'blk if overwrite { w::FILE_OVERWRITE_IF } else { w::FILE_OPEN_IF };
        }
        if overwrite { w::FILE_OVERWRITE } else { w::FILE_OPEN }
    };

    let blocking_flag: u32 = if !nonblock { w::FILE_SYNCHRONOUS_IO_NONALERT } else { 0 };
    let follow = (flags & O::NOFOLLOW) == 0;
    let opts: u32 = if follow {
        blocking_flag
    } else {
        w::FILE_OPEN_REPARSE_POINT
    };

    let mut attributes: u32 = w::FILE_ATTRIBUTE_NORMAL;
    if (flags & O::CREAT) != 0 && (perm & 0x80) == 0 && perm != 0 {
        attributes |= w::FILE_ATTRIBUTE_READONLY;
    }

    open_file_at_windows_nt_path(dir, norm, NtCreateFileOptions {
        access_mask,
        disposition,
        options: opts,
        attributes,
        ..Default::default()
    })
}

/// sys.zig:1685 `openatWindows` — UTF-16 input.
#[cfg(windows)]
pub fn openat_windows(dir: Fd, path: &[u16], flags: i32, perm: Mode) -> Maybe<Fd> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir, path, &mut wbuf.0[..])?;
    openat_windows_impl(dir, norm, flags, perm)
}
/// sys.zig:1690 `openatWindowsA` — UTF-8 input.
#[cfg(windows)]
#[inline(never)]
pub fn openat_windows_a(dir: Fd, path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let nt = bun_str::strings::to_nt_path(&mut wbuf.0[..], path);
    let mut buf2 = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir, nt.as_slice(), &mut buf2.0[..])?;
    openat_windows_impl(dir, norm, flags, perm)
}

// ── existence checks ──

/// sys.zig:3447 — `access(path, F_OK) == 0`. `file_only` ignored on POSIX.
pub fn exists_os_path(path: &bun_paths::OSPathSliceZ, file_only: bool) -> bool {
    #[cfg(not(windows))] {
        let _ = file_only;
        // SAFETY: path is NUL-terminated.
        unsafe { libc::access(path.as_ptr().cast(), libc::F_OK) == 0 }
    }
    #[cfg(windows)] {
        use bun_windows_sys::externs as w;
        // sys.zig:3454 — `getFileAttributes(path)`; if `file_only` reject dirs;
        // if reparse point, open the target with `OPEN_EXISTING` to follow.
        // SAFETY: path is NUL-terminated UTF-16.
        let attrs = unsafe { w::GetFileAttributesW(path.as_ptr()) };
        if attrs == windows::INVALID_FILE_ATTRIBUTES { return false; }
        if file_only && (attrs & w::FILE_ATTRIBUTE_DIRECTORY) != 0 {
            return false;
        }
        if (attrs & w::FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            // Check if the underlying file exists by opening it.
            // SAFETY: path is NUL-terminated; null security/template handles.
            let rc = unsafe {
                w::CreateFileW(
                    path.as_ptr(),
                    0,
                    0,
                    core::ptr::null_mut(),
                    w::OPEN_EXISTING,
                    w::FILE_FLAG_BACKUP_SEMANTICS,
                    core::ptr::null_mut(),
                )
            };
            if rc == bun_windows_sys::INVALID_HANDLE_VALUE { return false; }
            // SAFETY: rc is a valid handle from CreateFileW.
            unsafe { let _ = w::CloseHandle(rc); }
            return true;
        }
        true
    }
}
/// sys.zig:3636 `ExistsAtType`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExistsAtType { File, Directory }
/// sys.zig:3640 — `fstatat` then `S_ISDIR`.
pub fn exists_at_type(dir: Fd, sub: &ZStr) -> Maybe<ExistsAtType> {
    #[cfg(unix)] {
        let st = fstatat(dir, sub)?;
        Ok(if S::ISDIR(st.st_mode as _) { ExistsAtType::Directory } else { ExistsAtType::File })
    }
    #[cfg(windows)] {
        use bun_windows_sys::externs as w;
        // sys.zig:3648 — `NtQueryAttributesFile` against an OBJECT_ATTRIBUTES
        // built from the (optionally NT-prefixed) wide path.
        let mut wbuf = bun_paths::w_path_buffer_pool::get();
        let mut path = bun_str::strings::to_nt_path(&mut wbuf.0[..], sub.as_bytes()).as_slice();
        // Trim leading `.\` — NtQueryAttributesFile expects relative paths
        // without it.
        if path.len() > 2 && path[0] == b'.' as u16 && path[1] == b'\\' as u16 {
            path = &path[2..];
        }
        let path_len_bytes = (path.len() * 2) as u16;
        let mut nt_name = w::UNICODE_STRING {
            Length: path_len_bytes,
            MaximumLength: path_len_bytes,
            Buffer: path.as_ptr() as *mut u16,
        };
        let attr = w::OBJECT_ATTRIBUTES {
            Length: core::mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: if bun_paths::is_absolute_windows_wtf16(path) {
                core::ptr::null_mut()
            } else if dir.is_valid() {
                dir.cast()
            } else {
                Fd::cwd().cast()
            },
            Attributes: 0,
            ObjectName: &mut nt_name,
            SecurityDescriptor: core::ptr::null_mut(),
            SecurityQualityOfService: core::ptr::null_mut(),
        };
        // SAFETY: all-zero is a valid FILE_BASIC_INFORMATION.
        let mut basic_info: w::FILE_BASIC_INFORMATION = unsafe { core::mem::zeroed() };
        // SAFETY: FFI; attr/basic_info valid for the call duration.
        let rc = unsafe { w::ntdll::NtQueryAttributesFile(&attr, &mut basic_info) };
        if rc != w::NTSTATUS::SUCCESS {
            let errno = windows::Win32Error::from_nt_status(rc)
                .to_system_errno()
                .unwrap_or(E::EUNKNOWN);
            return Err(Error::from_code(errno, Tag::access));
        }
        let attrs = basic_info.FileAttributes;
        // From libuv: directories cannot be read-only.
        // https://github.com/libuv/libuv/blob/eb5af8e3/src/win/fs.c#L2144-L2146
        let is_dir = attrs != windows::INVALID_FILE_ATTRIBUTES
            && (attrs & w::FILE_ATTRIBUTE_DIRECTORY) != 0
            && (attrs & w::FILE_ATTRIBUTE_READONLY) == 0;
        let is_regular = attrs != windows::INVALID_FILE_ATTRIBUTES
            && ((attrs & w::FILE_ATTRIBUTE_DIRECTORY) == 0
                || (attrs & w::FILE_ATTRIBUTE_READONLY) == 0);
        if is_dir {
            Ok(ExistsAtType::Directory)
        } else if is_regular {
            Ok(ExistsAtType::File)
        } else {
            Err(Error::from_code(E::EUNKNOWN, Tag::access))
        }
    }
}
/// sys.zig:3533 — `directoryExistsAt(dir, sub)`. ENOENT → `Ok(false)`.
pub fn directory_exists_at(dir: Fd, sub: &ZStr) -> Maybe<bool> {
    match exists_at_type(dir, sub) {
        Ok(t) => Ok(t == ExistsAtType::Directory),
        Err(e) if e.get_errno() == E::ENOENT => Ok(false),
        Err(e) => Err(e),
    }
}

// ── fcntl / nonblocking / dup ──

/// sys.zig:3599 — `fcntl(fd, F_GETFL, 0)`.
#[cfg(unix)]
pub fn get_fcntl_flags(fd: Fd) -> Maybe<FcntlInt> {
    fcntl(fd, libc::F_GETFL, 0)
}
#[cfg(windows)]
pub fn get_fcntl_flags(_fd: Fd) -> Maybe<FcntlInt> {
    Err(Error::from_code_int(libc::ENOSYS, Tag::fcntl))
}
/// sys.zig:3614.
#[inline]
pub fn set_nonblocking(fd: Fd) -> Maybe<()> { update_nonblocking(fd, true) }
/// sys.zig:3618 — GETFL → toggle O_NONBLOCK → SETFL (only if changed).
pub fn update_nonblocking(fd: Fd, nonblocking: bool) -> Maybe<()> {
    #[cfg(unix)] {
        let cur = get_fcntl_flags(fd)? as i32;
        let new = if nonblocking { cur | O::NONBLOCK } else { cur & !O::NONBLOCK };
        if new != cur { fcntl(fd, libc::F_SETFL, new as isize)?; }
        Ok(())
    }
    #[cfg(windows)] {
        let _ = (fd, nonblocking); Ok(())
    }
}
/// sys.zig:3873 — `fcntl(F_DUPFD_CLOEXEC)` (POSIX) / `DuplicateHandle` (Win).
/// `_flags` is ignored (Zig signature parity).
#[inline]
pub fn dup_with_flags(fd: Fd, _flags: i32) -> Maybe<Fd> { dup(fd) }

/// sys.zig:3788 — `lseek(fd, offset, SEEK_SET)`; result discarded.
pub fn set_file_offset(fd: Fd, offset: u64) -> Maybe<()> {
    lseek(fd, offset as i64, libc::SEEK_SET).map(|_| ())
}

// ── nonblocking read/write (preadv2/pwritev2 RWF_NOWAIT on Linux) ──

#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn sys_preadv2(fd: c_int, iov: *const libc::iovec, iovcnt: c_int, off: i64, flags: u32) -> isize;
    fn sys_pwritev2(fd: c_int, iov: *const libc::iovec, iovcnt: c_int, off: i64, flags: u32) -> isize;
}
#[cfg(target_os = "linux")]
const RWF_NOWAIT: u32 = 0x00000008;

/// sys.zig:4046 — Linux: `preadv2(.., RWF_NOWAIT)`; else plain `read`.
pub fn read_nonblocking(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
    #[cfg(target_os = "linux")]
    while linux::RWFFlagSupport::is_maybe_supported() {
        let iov = [libc::iovec { iov_base: buf.as_mut_ptr().cast(), iov_len: buf.len() }];
        // SAFETY: fd valid; iov points at a live stack array.
        let rc = unsafe { sys_preadv2(fd.native(), iov.as_ptr(), 1, -1, RWF_NOWAIT) };
        if rc < 0 {
            let e = last_errno();
            match e {
                libc::EOPNOTSUPP | libc::ENOSYS | libc::EPERM | libc::EACCES => {
                    linux::RWFFlagSupport::disable();
                    // sys.zig:4070 — only fall through to BLOCKING read if the fd is
                    // actually readable now; otherwise return retry (EAGAIN).
                    return match bun_core::is_readable(fd) {
                        bun_core::Pollable::Ready | bun_core::Pollable::Hup => read(fd, buf),
                        _ => Err(Error::retry().with_fd(fd)),
                    };
                }
                libc::EINTR => continue,
                _ => return Err(Error::from_code_int(e, Tag::read).with_fd(fd)),
            }
        }
        return Ok(rc as usize);
    }
    read(fd, buf)
}
/// sys.zig:4099 — Linux: `pwritev2(.., RWF_NOWAIT)`; else plain `write`.
pub fn write_nonblocking(fd: Fd, buf: &[u8]) -> Maybe<usize> {
    #[cfg(target_os = "linux")]
    while linux::RWFFlagSupport::is_maybe_supported() {
        let iov = [libc::iovec { iov_base: buf.as_ptr() as *mut _, iov_len: buf.len() }];
        // SAFETY: fd valid; iov points at a live stack array.
        let rc = unsafe { sys_pwritev2(fd.native(), iov.as_ptr(), 1, -1, RWF_NOWAIT) };
        if rc < 0 {
            let e = last_errno();
            match e {
                libc::EOPNOTSUPP | libc::ENOSYS | libc::EPERM | libc::EACCES => {
                    linux::RWFFlagSupport::disable();
                    // sys.zig:4123 — poll before issuing a blocking write.
                    return match bun_core::is_writable(fd) {
                        bun_core::Pollable::Ready | bun_core::Pollable::Hup => write(fd, buf),
                        _ => {
                            let mut e = Error::retry();
                            e.syscall = Tag::write;
                            Err(e.with_fd(fd))
                        }
                    };
                }
                libc::EINTR => continue,
                _ => return Err(Error::from_code_int(e, Tag::write).with_fd(fd)),
            }
        }
        return Ok(rc as usize);
    }
    write(fd, buf)
}

/// sys.zig:4536 — `fallocate(fd, 0, offset, len)` on Linux, result discarded; no-op elsewhere.
pub fn preallocate_file(fd: FdNative, offset: i64, len: i64) -> core::result::Result<(), bun_core::Error> {
    #[cfg(target_os = "linux")] {
        // SAFETY: fd is a valid open descriptor owned by caller. Result intentionally
        // discarded (Zig: `_ = std.os.linux.fallocate(...)`) — preallocation is best-effort.
        let _ = unsafe { libc::fallocate(fd, 0, offset, len) };
    }
    let _ = (fd, offset, len);
    Ok(())
}

/// `kqueue()` — BSD kernel event queue (Darwin/FreeBSD only).
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub fn kqueue() -> Maybe<Fd> {
    // SAFETY: kqueue(2) takes no args.
    let rc = unsafe { libc::kqueue() };
    if rc < 0 { return Err(err_with(Tag::kqueue)); }
    Ok(Fd::from_native(rc))
}

/// `clonefile` — macOS-only CoW copy. On non-Darwin returns ENOTSUP so
/// callers can fall back to `copy_file`.
#[cfg(not(target_os = "macos"))]
pub fn clonefile(from: &ZStr, to: &ZStr) -> Maybe<()> {
    Err(Error::from_code_int(libc::ENOTSUP, Tag::clonefile).with_path_dest(from.as_bytes(), to.as_bytes()))
}

/// `clonefileat` — macOS-only CoW copy relative to directory fds. On
/// non-Darwin returns ENOTSUP so callers can fall back to a manual copy.
#[cfg(not(target_os = "macos"))]
pub fn clonefileat(_from_dir: Fd, from: &ZStr, _to_dir: Fd, to: &ZStr) -> Maybe<()> {
    Err(Error::from_code_int(libc::ENOTSUP, Tag::clonefileat).with_path_dest(from.as_bytes(), to.as_bytes()))
}

// ── getFdPath ──

/// sys.zig:632 `LinuxKernel.get()` — cached probe of `/proc/version` for
/// "freebsd" (linprocfs hardcodes "des@freebsd.org"). Under FreeBSD's
/// Linuxulator `/proc/self/fd/*` doesn't readlink, but `/dev/fd/*` does.
#[cfg(target_os = "linux")]
fn linux_kernel_is_freebsd() -> bool {
    use core::sync::atomic::{AtomicU8, Ordering};
    static CACHED: AtomicU8 = AtomicU8::new(0); // 0=unknown, 1=linux, 2=freebsd
    let v = CACHED.load(Ordering::Acquire);
    if v != 0 { return v == 2; }
    let detected: u8 = 'detect: {
        // SAFETY: literal is NUL-terminated.
        let z = unsafe { ZStr::from_raw(b"/proc/version\0".as_ptr(), 13) };
        let Ok(fd) = open(z, O::RDONLY | O::NOCTTY, 0) else { break 'detect 1 };
        let mut buf = [0u8; 512];
        let n = read(fd, &mut buf).unwrap_or(0);
        let _ = close(fd);
        if buf[..n].windows(7).any(|w| w.eq_ignore_ascii_case(b"freebsd")) { 2 } else { 1 }
    };
    CACHED.store(detected, Ordering::Release);
    detected == 2
}

/// sys.zig:2940 — fd → absolute path. Linux: readlink `/proc/self/fd/N`;
/// macOS: `fcntl(F_GETPATH)`; Windows: `GetFinalPathNameByHandle`.
pub fn get_fd_path<'a>(fd: Fd, out: &'a mut bun_paths::PathBuffer) -> Maybe<&'a mut [u8]> {
    #[cfg(target_os = "linux")] {
        let mut proc = [0u8; 32];
        let n = {
            use std::io::Write as _;
            let mut c = std::io::Cursor::new(&mut proc[..]);
            let _ = write!(c, "/proc/self/fd/{}\0", fd.native());
            c.position() as usize - 1
        };
        // SAFETY: NUL written above.
        let z = unsafe { ZStr::from_raw(proc.as_ptr(), n) };
        match readlink(z, &mut out.0) {
            Ok(len) => return Ok(&mut out.0[..len]),
            Err(e) => {
                // sys.zig:2975 — under FreeBSD Linuxulator, fall back to
                // `getFdPathFreeBSDLinuxulator` (`/dev/fd/N`).
                if linux_kernel_is_freebsd() {
                    let mut dev = [0u8; 32];
                    let n = {
                        use std::io::Write as _;
                        let mut c = std::io::Cursor::new(&mut dev[..]);
                        let _ = write!(c, "/dev/fd/{}\0", fd.native());
                        c.position() as usize - 1
                    };
                    // SAFETY: NUL written above.
                    let z = unsafe { ZStr::from_raw(dev.as_ptr(), n) };
                    let len = readlink(z, &mut out.0)?;
                    return Ok(&mut out.0[..len]);
                }
                return Err(e);
            }
        }
    }
    #[cfg(target_os = "macos")] {
        out.0.fill(0);
        fcntl(fd, libc::F_GETPATH, out.0.as_mut_ptr() as isize)?;
        // SAFETY: F_GETPATH writes a NUL-terminated string into `out`.
        let len = unsafe { libc::strlen(out.0.as_ptr().cast()) };
        return Ok(&mut out.0[..len]);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))] {
        let _ = (fd, out);
        Err(Error::from_code_int(libc::ENOSYS, Tag::readlink))
    }
}

// ── environ ──

/// `std.os.environ` — borrowed slice of `KEY=VALUE\0` C strings.
/// SAFETY note: the returned slice borrows the libc `environ` global; do not
/// mutate the environment concurrently.
pub fn environ() -> &'static [*const c_char] {
    #[cfg(unix)] {
        unsafe extern "C" { static mut environ: *const *const c_char; }
        // SAFETY: `environ` is a process-global NULL-terminated array.
        unsafe {
            let mut n = 0usize;
            let base = environ;
            if base.is_null() { return &[]; }
            while !(*base.add(n)).is_null() { n += 1; }
            core::slice::from_raw_parts(base, n)
        }
    }
    #[cfg(windows)] { &[] }
}

/// `std.os.environ.ptr` — raw NULL-terminated `**c_char` for FFI envp args
/// (e.g. `posix_spawn`). Unlike [`environ()`] this returns the raw libc
/// global pointer (already NULL-terminated) rather than a length-bounded
/// borrowed slice, so it is suitable to pass directly as `envp`.
pub fn environ_ptr() -> *const *const c_char {
    #[cfg(unix)] {
        unsafe extern "C" { static mut environ: *const *const c_char; }
        // SAFETY: `environ` is a process-global; we only read the pointer.
        unsafe { environ }
    }
    #[cfg(windows)] { core::ptr::null() }
}

// ── moveFileZWithHandle (sys.zig:4266) ──

/// `renameat`; on EISDIR removes the dest dir and retries; on EXDEV falls back
/// to copy-then-unlink. Port of `bun.sys.moveFileZWithHandle`.
pub fn move_file_z_with_handle(
    from_handle: Fd, from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr,
) -> core::result::Result<(), bun_core::Error> {
    match renameat(from_dir, filename, to_dir, destination) {
        Ok(()) => Ok(()),
        Err(e) if e.get_errno() == E::EISDIR => {
            #[cfg(unix)]
            // SAFETY: destination is NUL-terminated.
            let _ = unsafe { libc::unlinkat(to_dir.native(), destination.as_ptr(), libc::AT_REMOVEDIR) };
            renameat(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) if e.get_errno() == E::EXDEV => {
            // Cross-device: full `copyFileZSlowWithHandle` (sys.zig:4305).
            let st = fstat(from_handle).map_err(bun_core::Error::from)?;
            // Unlink dest first — fixes ETXTBUSY on Linux.
            let _ = unlinkat(to_dir, destination);
            let dst = openat(
                to_dir, destination,
                O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC, 0o644,
            ).map_err(bun_core::Error::from)?;
            #[cfg(target_os = "linux")] {
                // SAFETY: dst is a valid open fd; preallocation is best-effort.
                let _ = unsafe { libc::fallocate(dst.native(), 0, 0, st.st_size) };
            }
            // Seek input to 0 — caller may have left offset at EOF after writing.
            let _ = lseek(from_handle, 0, libc::SEEK_SET);
            let r = copy_file(from_handle, dst);
            // sys.zig:4349 — only stamp mode/owner on success; on copy error
            // the partially-written dest keeps its openat() defaults.
            if r.is_ok() {
                // SAFETY: dst is a valid open fd.
                let _ = unsafe { libc::fchmod(dst.native(), st.st_mode) };
                let _ = unsafe { libc::fchown(dst.native(), st.st_uid, st.st_gid) };
            }
            let _ = close(dst);
            r.map_err(bun_core::Error::from)?;
            let _ = unlinkat(from_dir, filename);
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// `bun.sys.copyFile` — fd→fd full transfer using the best available kernel
/// fast path (ioctl_ficlone / copy_file_range / sendfile / read-write loop).
#[inline]
#[cfg(not(windows))]
pub fn copy_file(in_: Fd, out: Fd) -> Maybe<()> {
    copy_file::copy_file(in_, out)
}
#[cfg(windows)]
pub fn copy_file(in_: Fd, out: Fd) -> Maybe<()> {
    // Windows `bun.copyFile` takes paths, not fds; fd-based callers (e.g.
    // `move_file_z_with_handle`'s EXDEV fallback) get the read/write loop.
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = read(in_, &mut buf)?;
        if n == 0 { return Ok(()); }
        let mut wrote = 0;
        while wrote < n {
            let w = write(out, &buf[wrote..n])?;
            if w == 0 { return Err(Error::from_code_int(libc::EIO, Tag::write)); }
            wrote += w;
        }
    }
}

/// `bun.makePath` — free-fn form taking a `Dir` (Zig: `bun.makePath(dir, sub)`).
#[inline]
pub fn make_path(dir: Dir, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
    mkdir_recursive_at(dir.fd, sub_path).map_err(Into::into)
}
/// `bun.mkdirRecursive` — like `make_path` but cwd-relative, taking a slice.
#[inline]
pub fn mkdir_recursive(sub_path: &[u8]) -> Maybe<()> {
    mkdir_recursive_at(Fd::cwd(), sub_path)
}
/// bun.zig:2319 — Windows-only `makePath` over UTF-16. On POSIX, transcodes
/// to UTF-8 and delegates to `mkdir_recursive_at`.
pub fn make_path_w(dir: Fd, sub_path: &[u16]) -> Maybe<()> {
    // bun.zig:2319-2324 — "was going to copy/paste makePath and use all W
    // versions but they didn't all exist and this buffer was needed anyway":
    // transcode UTF-16 → UTF-8, then call `makePath` (`mkdir_recursive_at`).
    let mut buf = bun_paths::PathBuffer::default();
    let utf8 = bun_string::strings::paths::from_w_path(&mut buf.0[..], sub_path);
    mkdir_recursive_at(dir, utf8.as_bytes())
}

// ──────────────────────────────────────────────────────────────────────────
// `std.posix` — wider surface than `bun_errno::posix` (which only has
// mode_t/E/S/errno). Dependents (`bun_resolver`, `bun_md`, `bun_crash`,
// `bun_threading`) reach for `Sigaction`, `getrlimit`, `tcgetattr`, raw
// `read`/`write`/`poll`, `dl_iterate_phdr` etc. We re-export the errno stub
// and layer the libc bits on top so `bun_sys::posix::*` is the single import.
// ──────────────────────────────────────────────────────────────────────────
pub mod posix {
    use core::ffi::{c_int, c_void};
    pub use bun_errno::posix::*;

    // ── stat mode-kind tests (Zig: `std.posix.S.ISLNK` etc.) ──
    #[cfg(unix)]
    #[inline] pub const fn s_islnk(m: u32) -> bool { (m & libc::S_IFMT) == libc::S_IFLNK }
    #[cfg(unix)]
    #[inline] pub const fn s_isdir(m: u32) -> bool { (m & libc::S_IFMT) == libc::S_IFDIR }
    #[cfg(unix)]
    #[inline] pub const fn s_isreg(m: u32) -> bool { (m & libc::S_IFMT) == libc::S_IFREG }

    // ── signals ──
    #[cfg(unix)] pub use libc::sigaction as Sigaction;
    #[cfg(unix)] pub use libc::siginfo_t;
    #[cfg(unix)] pub use libc::sigset_t;
    /// `std.posix.sigaction(sig, &act, *oact)`.
    #[cfg(unix)]
    #[inline]
    pub unsafe fn sigaction(
        sig: c_int, act: *const Sigaction, oact: *mut Sigaction,
    ) -> c_int {
        unsafe { libc::sigaction(sig, act, oact) }
    }

    // ── time ──
    #[cfg(unix)] pub use libc::timespec;
    #[cfg(windows)]
    #[repr(C)] #[derive(Clone, Copy, Default)]
    pub struct timespec { pub tv_sec: i64, pub tv_nsec: i64 }

    // ── raw I/O (no `Maybe` wrapping; Zig: `std.posix.read/write`) ──
    #[cfg(unix)]
    #[inline]
    pub unsafe fn read(fd: c_int, buf: *mut u8, count: usize) -> isize {
        unsafe { libc::read(fd, buf.cast(), count) }
    }
    #[cfg(unix)]
    #[inline]
    pub unsafe fn write(fd: c_int, buf: *const u8, count: usize) -> isize {
        unsafe { libc::write(fd, buf.cast(), count) }
    }

    // ── poll ──
    /// `std.posix.pollfd`.
    #[cfg(unix)]
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct PollFd { pub fd: c_int, pub events: i16, pub revents: i16 }
    #[cfg(unix)] pub const POLL_IN: i16 = libc::POLLIN;
    #[cfg(unix)] pub const POLL_OUT: i16 = libc::POLLOUT;
    /// `bun.sys.poll` (sys.zig:2211-2225) — `poll$NOCANCEL` on Darwin,
    /// EINTR-retried, tagged `.poll` (NOT `.ppoll`).
    #[cfg(unix)]
    pub fn poll(fds: &mut [PollFd], timeout_ms: c_int) -> core::result::Result<c_int, super::Error> {
        loop {
            // SAFETY: PollFd is layout-identical to libc::pollfd.
            #[cfg(target_os = "macos")]
            let rc = unsafe { super::nocancel::poll(fds.as_mut_ptr().cast(), fds.len() as _, timeout_ms) };
            #[cfg(not(target_os = "macos"))]
            let rc = unsafe { libc::poll(fds.as_mut_ptr().cast(), fds.len() as _, timeout_ms) };
            if rc < 0 {
                let e = super::last_errno();
                if e == libc::EINTR { continue; }
                return Err(super::Error::from_code_int(e, super::Tag::poll));
            }
            return Ok(rc);
        }
    }

    // ── termios ──
    #[cfg(unix)] pub use libc::termios as Termios;
    #[cfg(unix)]
    #[derive(Clone, Copy)] #[repr(i32)]
    pub enum TCSA { Now = libc::TCSANOW, Drain = libc::TCSADRAIN, Flush = libc::TCSAFLUSH }
    #[cfg(unix)]
    pub fn tcgetattr(fd: c_int) -> core::result::Result<Termios, super::Error> {
        let mut t = core::mem::MaybeUninit::<Termios>::uninit();
        // SAFETY: tcgetattr fully initializes `t` on success.
        let rc = unsafe { libc::tcgetattr(fd, t.as_mut_ptr()) };
        if rc < 0 { return Err(super::err_with(super::Tag::ioctl)); }
        Ok(unsafe { t.assume_init() })
    }
    #[cfg(unix)]
    pub fn tcsetattr(fd: c_int, action: TCSA, t: &Termios) -> core::result::Result<(), super::Error> {
        // SAFETY: t is a valid termios.
        let rc = unsafe { libc::tcsetattr(fd, action as c_int, t) };
        if rc < 0 { return Err(super::err_with(super::Tag::ioctl)); }
        Ok(())
    }

    // ── rlimit ──
    #[cfg(unix)]
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct Rlimit { pub cur: u64, pub max: u64 }
    #[cfg(unix)]
    #[derive(Clone, Copy)] #[repr(i32)]
    pub enum RlimitResource {
        NOFILE = libc::RLIMIT_NOFILE as _,
        STACK  = libc::RLIMIT_STACK as _,
        CORE   = libc::RLIMIT_CORE as _,
    }
    #[cfg(unix)]
    pub fn getrlimit(res: RlimitResource) -> core::result::Result<Rlimit, super::Error> {
        let mut r = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
        // SAFETY: r is written on success.
        let rc = unsafe { libc::getrlimit(res as _, &mut r) };
        if rc < 0 { return Err(super::err_with(super::Tag::TODO)); }
        Ok(Rlimit { cur: r.rlim_cur as u64, max: r.rlim_max as u64 })
    }
    #[cfg(unix)]
    pub fn setrlimit(res: RlimitResource, lim: Rlimit) -> core::result::Result<(), super::Error> {
        let r = libc::rlimit { rlim_cur: lim.cur as _, rlim_max: lim.max as _ };
        // SAFETY: r is a valid rlimit.
        let rc = unsafe { libc::setrlimit(res as _, &r) };
        if rc < 0 { return Err(super::err_with(super::Tag::TODO)); }
        Ok(())
    }

    // ── dynamic loading (Linux/FreeBSD) ──
    /// `std.posix.dl_iterate_phdr` — iterate loaded ELF objects.
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    #[inline]
    pub unsafe fn dl_iterate_phdr(
        callback: unsafe extern "C" fn(*mut libc::dl_phdr_info, usize, *mut c_void) -> c_int,
        data: *mut c_void,
    ) -> c_int {
        unsafe { libc::dl_iterate_phdr(Some(callback), data) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `std.net` — socket address. Minimal port of Zig's `std.net.Address`
// (just the sockaddr union + a couple of constructors; full resolver lives in
// `bun_dns`). Dependents only need the data shape + Display.
// ──────────────────────────────────────────────────────────────────────────
pub mod net {
    use core::fmt;

    /// `std.net.Address` — tagged union over sockaddr_in/in6/un.
    #[derive(Clone, Copy)]
    pub struct Address {
        /// Generic storage; `family()` discriminates.
        pub any: libc::sockaddr_storage,
    }
    impl Address {
        /// Construct from a borrowed `*const sockaddr` (Zig: `Address.initPosix`).
        /// SAFETY: `addr` must point at a valid sockaddr of the family it declares.
        pub unsafe fn init_posix(addr: *const libc::sockaddr) -> Self {
            let mut storage: libc::sockaddr_storage = unsafe { core::mem::zeroed() };
            let len = match unsafe { (*addr).sa_family } as i32 {
                libc::AF_INET => core::mem::size_of::<libc::sockaddr_in>(),
                libc::AF_INET6 => core::mem::size_of::<libc::sockaddr_in6>(),
                _ => core::mem::size_of::<libc::sockaddr>(),
            };
            unsafe {
                core::ptr::copy_nonoverlapping(
                    addr.cast::<u8>(),
                    (&mut storage as *mut libc::sockaddr_storage).cast::<u8>(),
                    len,
                );
            }
            Self { any: storage }
        }
        #[inline] pub fn family(&self) -> i32 { self.any.ss_family as i32 }
        #[inline] pub fn as_sockaddr(&self) -> *const libc::sockaddr {
            (&self.any as *const libc::sockaddr_storage).cast()
        }
        #[inline] pub fn sock_len(&self) -> u32 {
            match self.family() {
                libc::AF_INET => core::mem::size_of::<libc::sockaddr_in>() as u32,
                libc::AF_INET6 => core::mem::size_of::<libc::sockaddr_in6>() as u32,
                _ => core::mem::size_of::<libc::sockaddr_storage>() as u32,
            }
        }
    }
    impl Default for Address {
        fn default() -> Self { Self { any: unsafe { core::mem::zeroed() } } }
    }
    impl fmt::Debug for Address {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            fmt::Display::fmt(self, f)
        }
    }
    impl fmt::Display for Address {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            // PORT NOTE: Zig's std.net.Address.format prints "ip:port"/"[ip6]:port".
            // Minimal: print family for now; full impl in `bun_dns::address_to_string`.
            match self.family() {
                libc::AF_INET => {
                    // SAFETY: family checked.
                    let v4 = unsafe { &*(self.as_sockaddr().cast::<libc::sockaddr_in>()) };
                    let octets = v4.sin_addr.s_addr.to_ne_bytes();
                    write!(f, "{}.{}.{}.{}:{}", octets[0], octets[1], octets[2], octets[3], u16::from_be(v4.sin_port))
                }
                _ => write!(f, "<addr family={}>", self.family()),
            }
        }
    }
}

/// `std.elf` constants (just what `bun_exe_format`/`bun_crash` need).
pub mod elf {
    pub const PT_NULL: u32 = 0;
    pub const PT_LOAD: u32 = 1;
    pub const PT_DYNAMIC: u32 = 2;
    pub const PT_INTERP: u32 = 3;
    pub const PT_NOTE: u32 = 4;
    pub const PT_PHDR: u32 = 6;
    pub const PT_TLS: u32 = 7;
    pub const PT_GNU_STACK: u32 = 0x6474e551;
}

/// FreeBSD platform surface.
#[cfg(target_os = "freebsd")]
pub mod freebsd {
    use core::ffi::c_int;
    /// `struct kevent` (FreeBSD).
    pub type Kevent = libc::kevent;
    /// `std.c.EVFILT` — kqueue filter constants (FreeBSD).
    pub mod EVFILT {
        pub const READ:   i16 = libc::EVFILT_READ;
        pub const WRITE:  i16 = libc::EVFILT_WRITE;
        pub const VNODE:  i16 = libc::EVFILT_VNODE;
        pub const PROC:   i16 = libc::EVFILT_PROC;
        pub const SIGNAL: i16 = libc::EVFILT_SIGNAL;
        pub const TIMER:  i16 = libc::EVFILT_TIMER;
        pub const USER:   i16 = libc::EVFILT_USER;
    }
    /// `std.c.EV` — kqueue event flags (FreeBSD).
    pub mod EV {
        pub const ADD:      u16 = libc::EV_ADD;
        pub const DELETE:   u16 = libc::EV_DELETE;
        pub const ENABLE:   u16 = libc::EV_ENABLE;
        pub const DISABLE:  u16 = libc::EV_DISABLE;
        pub const ONESHOT:  u16 = libc::EV_ONESHOT;
        pub const CLEAR:    u16 = libc::EV_CLEAR;
        pub const RECEIPT:  u16 = libc::EV_RECEIPT;
        pub const DISPATCH: u16 = libc::EV_DISPATCH;
        pub const EOF:      u16 = libc::EV_EOF;
        pub const ERROR:    u16 = libc::EV_ERROR;
    }
    /// `std.c.NOTE` — kqueue fflags (FreeBSD).
    pub mod NOTE {
        pub const EXIT:    u32 = libc::NOTE_EXIT;
        pub const FORK:    u32 = libc::NOTE_FORK;
        pub const EXEC:    u32 = libc::NOTE_EXEC;
        pub const TRIGGER: u32 = libc::NOTE_TRIGGER;
        pub const DELETE:  u32 = libc::NOTE_DELETE;
        pub const WRITE:   u32 = libc::NOTE_WRITE;
        pub const EXTEND:  u32 = libc::NOTE_EXTEND;
        pub const ATTRIB:  u32 = libc::NOTE_ATTRIB;
        pub const LINK:    u32 = libc::NOTE_LINK;
        pub const RENAME:  u32 = libc::NOTE_RENAME;
        pub const REVOKE:  u32 = libc::NOTE_REVOKE;
    }
    /// `kevent()` syscall — thin re-export so callers don't need a direct
    /// `libc` dep. SAFETY: caller upholds the kernel contract.
    #[inline]
    pub unsafe fn kevent(
        kq: c_int,
        changelist: *const Kevent, nchanges: c_int,
        eventlist: *mut Kevent, nevents: c_int,
        timeout: *const libc::timespec,
    ) -> c_int {
        unsafe { libc::kevent(kq, changelist, nchanges, eventlist, nevents, timeout) }
    }
}
#[cfg(not(target_os = "freebsd"))]
pub mod freebsd {}

// ──────────────────────────────────────────────────────────────────────────
// `Dir` — `std.fs.Dir` replacement. Thin wrapper over `Fd`; close on Drop is
// NOT done (matches Zig — callers explicitly `.close()` or hold for lifetime).
// ──────────────────────────────────────────────────────────────────────────
#[derive(Clone, Copy)]
pub struct Dir { pub fd: Fd }

/// Options for `Dir::make_open_path` (Zig: `std.fs.Dir.OpenOptions`).
#[derive(Clone, Copy, Default)]
pub struct OpenDirOptions {
    pub iterate: bool,
    pub no_follow: bool,
}

impl Dir {
    #[inline] pub fn from_fd(fd: Fd) -> Self { Self { fd } }
    #[inline] pub fn fd(&self) -> Fd { self.fd }
    #[inline] pub fn cwd() -> Self { Self { fd: Fd::cwd() } }
    #[inline] pub fn close(self) { let _ = close(self.fd); }

    /// `std.fs.Dir.makePath` — `mkdir -p` relative to this dir.
    #[inline]
    pub fn make_path(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        mkdir_recursive_at(self.fd, sub_path).map_err(Into::into)
    }
    /// `std.fs.Dir.makeOpenPath` — `makePath` then `openDir`.
    pub fn make_open_path(&self, sub_path: &[u8], _opts: OpenDirOptions)
        -> core::result::Result<Dir, bun_core::Error>
    {
        mkdir_recursive_at(self.fd, sub_path)?;
        open_dir_at(self.fd, sub_path).map(Dir::from_fd).map_err(Into::into)
    }
    /// `std.fs.Dir.makeDir` — single `mkdirat` (not recursive), mode `0o755`.
    pub fn make_dir(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        let mut buf = bun_paths::PathBuffer::default();
        let len = sub_path.len().min(buf.0.len() - 1);
        buf.0[..len].copy_from_slice(&sub_path[..len]);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), len) };
        mkdirat(self.fd, z, 0o755).map_err(Into::into)
    }
    /// `std.fs.Dir.symLink` — `symlinkat(target, self.fd, sub_path)`. The
    /// `is_directory` flag is a no-op on POSIX (only Windows distinguishes
    /// directory junctions); callers on Windows should route via
    /// `sys_uv::symlink_uv` with `UV_FS_SYMLINK_JUNCTION` instead.
    #[cfg(not(windows))]
    pub fn sym_link(
        &self,
        target: &[u8],
        sub_path: &[u8],
        _is_directory: bool,
    ) -> core::result::Result<(), bun_core::Error> {
        let mut tbuf = bun_paths::PathBuffer::default();
        let tlen = target.len().min(tbuf.0.len() - 1);
        tbuf.0[..tlen].copy_from_slice(&target[..tlen]);
        tbuf.0[tlen] = 0;
        let mut pbuf = bun_paths::PathBuffer::default();
        let plen = sub_path.len().min(pbuf.0.len() - 1);
        pbuf.0[..plen].copy_from_slice(&sub_path[..plen]);
        pbuf.0[plen] = 0;
        // SAFETY: both NUL-terminated above.
        let tz = unsafe { ZStr::from_raw(tbuf.0.as_ptr(), tlen) };
        let pz = unsafe { ZStr::from_raw(pbuf.0.as_ptr(), plen) };
        symlinkat(tz, self.fd, pz).map_err(Into::into)
    }
    /// `std.fs.Dir.deleteTree` — recursive `rm -rf`. Port stub: routes via
    /// `walker_skippable` once that lands; for now best-effort `unlinkat`.
    pub fn delete_tree(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        // TODO(b2): full recursive walk (Zig std.fs.Dir.deleteTree). For B-2
        // surface this is best-effort: try `rmdir`, then `unlink`, ignoring ENOENT.
        let mut buf = bun_paths::PathBuffer::default();
        let len = sub_path.len().min(buf.0.len() - 1);
        buf.0[..len].copy_from_slice(&sub_path[..len]);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), len) };
        #[cfg(unix)]
        match unlinkat_with_flags(self.fd, z, libc::AT_REMOVEDIR) {
            Ok(()) => return Ok(()),
            Err(e) if e.get_errno() == E::ENOENT => return Ok(()),
            Err(e) if e.get_errno() == E::ENOTDIR => {
                return unlinkat(self.fd, z).map_err(Into::into);
            }
            Err(e) if e.get_errno() == E::ENOTEMPTY => {
                // Full recursive impl pending; surface the error so callers can react.
                return Err(e.into());
            }
            Err(e) => return Err(e.into()),
        }
        #[cfg(windows)]
        Err(bun_core::err!("Unimplemented"))
    }
}

/// `std.fs.File.CreateFlags` — subset used by `Dir::createFileZ` callers
/// (e.g. `repository.zig:649`, `PackageManagerDirectories.zig`).
#[derive(Clone, Copy, Default)]
pub struct CreateFlags {
    pub truncate: bool,
    /// Open for reading as well as writing (Zig: `read: bool = false`).
    pub read: bool,
}

impl Dir {
    /// `std.fs.Dir.makeDir` — single-level `mkdirat` (mode 0o755) relative to
    /// this dir. Unlike `make_path`, does NOT create intermediate directories
    /// and surfaces `error.PathAlreadyExists` for callers to branch on.
    pub fn make_dir(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        let mut buf = bun_paths::PathBuffer::default();
        let len = sub_path.len().min(buf.0.len() - 1);
        buf.0[..len].copy_from_slice(&sub_path[..len]);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), len) };
        match mkdirat(self.fd, z, 0o755) {
            Ok(()) => Ok(()),
            Err(e) if e.get_errno() == E::EEXIST => Err(bun_core::err!("PathAlreadyExists")),
            Err(e) => Err(e.into()),
        }
    }

    /// `std.fs.Dir.symLink` — `symlinkat(target, self.fd, link)`. The
    /// `is_directory` flag is a no-op on POSIX (kept for parity with Zig's
    /// `SymLinkFlags`); on Windows it selects junction vs. file-symlink and
    /// callers route through `sys_uv::symlink_uv` instead.
    pub fn sym_link(
        &self,
        target: &[u8],
        link_name: &[u8],
        _is_directory: bool,
    ) -> core::result::Result<(), bun_core::Error> {
        let mut tbuf = bun_paths::PathBuffer::default();
        let tlen = target.len().min(tbuf.0.len() - 1);
        tbuf.0[..tlen].copy_from_slice(&target[..tlen]);
        tbuf.0[tlen] = 0;
        // SAFETY: NUL-terminated above.
        let tz = unsafe { ZStr::from_raw(tbuf.0.as_ptr(), tlen) };

        let mut lbuf = bun_paths::PathBuffer::default();
        let llen = link_name.len().min(lbuf.0.len() - 1);
        lbuf.0[..llen].copy_from_slice(&link_name[..llen]);
        lbuf.0[llen] = 0;
        // SAFETY: NUL-terminated above.
        let lz = unsafe { ZStr::from_raw(lbuf.0.as_ptr(), llen) };

        symlinkat(tz, self.fd, lz).map_err(Into::into)
    }

    /// `std.fs.Dir.createFileZ` — create (or truncate) `sub_path` relative to
    /// this dir and return a `File` handle. Zig stdlib semantics: `O_CREAT`,
    /// `O_WRONLY` (or `O_RDWR` if `flags.read`), `O_TRUNC` if `flags.truncate`.
    pub fn create_file_z(&self, sub_path: &ZStr, flags: CreateFlags)
        -> core::result::Result<File, bun_core::Error>
    {
        let mut o = O::CREAT | O::CLOEXEC;
        o |= if flags.read { O::RDWR } else { O::WRONLY };
        if flags.truncate { o |= O::TRUNC; }
        let fd = openat(self.fd, sub_path, o, 0o666)?;
        Ok(File::from_fd(fd))
    }

    /// `std.fs.Dir.deleteFileZ` — `unlinkat(self.fd, sub_path, 0)`.
    #[inline]
    pub fn delete_file_z(&self, sub_path: &ZStr) -> core::result::Result<(), bun_core::Error> {
        unlinkat(self.fd, sub_path).map_err(Into::into)
    }

    /// `std.fs.Dir.openDirZ` — open `sub_path` (NUL-terminated) relative to
    /// this dir as a `Dir` handle. Zig stdlib semantics: `O_DIRECTORY |
    /// O_RDONLY | O_CLOEXEC` (handled by `open_dir_at`).
    #[inline]
    pub fn open_dir_z(&self, sub_path: &ZStr) -> core::result::Result<Dir, bun_core::Error> {
        open_dir_at(self.fd, sub_path.as_bytes()).map(Dir::from_fd).map_err(Into::into)
    }
}

/// bun.zig — `bun.openDir(dir, path)`. Opens `path` relative to `dir` as a
/// directory `Dir` handle.
#[inline]
pub fn open_dir(dir: Dir, path: &[u8]) -> core::result::Result<Dir, bun_core::Error> {
    open_dir_at(dir.fd, path).map(Dir::from_fd).map_err(Into::into)
}

/// `std.fs.Dir.makeOpenPath` reachable as a module (Zig callers do
/// `bun.makePath` / `bun.makeOpenPath`).
pub mod make_path {
    use super::*;
    #[inline]
    pub fn make_open_path(dir: Dir, sub_path: &[u8], opts: OpenDirOptions)
        -> core::result::Result<Dir, bun_core::Error>
    {
        dir.make_open_path(sub_path, opts)
    }

    /// Dispatch trait for `make_path::<T>` over `u8` (POSIX) / `u16` (Windows).
    /// Mirrors Zig's `std.fs.Dir.makePath` taking `OSPathSlice`.
    pub trait PathChar: Copy {
        fn make_path_at(dir: Fd, sub: &[Self]) -> core::result::Result<(), bun_core::Error>;
    }
    impl PathChar for u8 {
        #[inline]
        fn make_path_at(dir: Fd, sub: &[u8]) -> core::result::Result<(), bun_core::Error> {
            mkdir_recursive_at(dir, sub).map_err(Into::into)
        }
    }
    impl PathChar for u16 {
        #[inline]
        fn make_path_at(dir: Fd, sub: &[u16]) -> core::result::Result<(), bun_core::Error> {
            make_path_w(dir, sub).map_err(Into::into)
        }
    }
    /// `bun.makePath` — `mkdir -p` relative to `dir`, generic over path-char
    /// width so callers can pass `OSPathChar` slices unchanged.
    #[inline]
    pub fn make_path<T: PathChar>(dir: Dir, sub_path: &[T])
        -> core::result::Result<(), bun_core::Error>
    {
        T::make_path_at(dir.fd, sub_path)
    }
    /// Explicit UTF-16 form (Windows). On POSIX transcodes via `make_path_w`.
    #[inline]
    pub fn make_path_u16(dir: Dir, sub_path: &[u16])
        -> core::result::Result<(), bun_core::Error>
    {
        make_path_w(dir.fd, sub_path).map_err(Into::into)
    }
}
/// Port of `WindowsSymlinkOptions` (sys.zig:2653) — Windows-only flag struct
/// plus a process-global "symlink creation has failed once" sticky bit. The
/// flag is checked by the install linker to decide whether to fall back to
/// junctions; on POSIX the flag is harmless dead state. Only the sticky bit
/// is needed cross-platform (`PackageManager::init` sets it when
/// `BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS` is on).
#[derive(Default, Clone, Copy)]
pub struct WindowsSymlinkOptions {
    pub directory: bool,
}
/// Zig: `pub var has_failed_to_create_symlink = false;` (sys.zig:2669).
pub static WINDOWS_SYMLINK_HAS_FAILED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);
impl WindowsSymlinkOptions {
    #[inline]
    pub fn set_has_failed_to_create_symlink(v: bool) {
        WINDOWS_SYMLINK_HAS_FAILED.store(v, core::sync::atomic::Ordering::Relaxed);
    }
    #[inline]
    pub fn has_failed_to_create_symlink() -> bool {
        WINDOWS_SYMLINK_HAS_FAILED.load(core::sync::atomic::Ordering::Relaxed)
    }
}

/// Type-style alias so callers can write `bun_sys::MakePath::make_path::<T>(..)`
/// (Zig: `bun.MakePath` namespace re-export).
pub use make_path as MakePath;

// `Fd` parity: `Fd::cwd().make_open_path(..)` / `.make_path(..)` are used by
// `bun_install` and `bun_bundler` directly on `Fd`. Extension trait so we
// don't fight with `bun_core`'s inherent impl.
pub trait FdDirExt: Copy {
    fn make_path(self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error>;
    fn make_open_path(self, sub_path: &[u8]) -> core::result::Result<Dir, bun_core::Error>;
    fn from_std_dir(dir: &Dir) -> Self;
}
impl FdDirExt for Fd {
    #[inline]
    fn make_path(self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        mkdir_recursive_at(self, sub_path).map_err(Into::into)
    }
    #[inline]
    fn make_open_path(self, sub_path: &[u8]) -> core::result::Result<Dir, bun_core::Error> {
        Dir::from_fd(self).make_open_path(sub_path, OpenDirOptions::default())
    }
    #[inline]
    fn from_std_dir(dir: &Dir) -> Fd { dir.fd }
}

// ──────────────────────────────────────────────────────────────────────────
// open helpers (additional)
// ──────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    /// `std.fs.File.OpenFlags` — convenience flagset for `open_file*` helpers.
    #[derive(Clone, Copy, Default)]
    pub struct OpenFlags: i32 {
        const READ_ONLY  = O::RDONLY;
        const WRITE_ONLY = O::WRONLY;
        const READ_WRITE = O::RDWR;
        const CREATE     = O::CREAT;
        const TRUNCATE   = O::TRUNC;
        const APPEND     = O::APPEND;
        const EXCLUSIVE  = O::EXCL;
    }
}

/// `std.fs.openFileAbsoluteZ` — open an absolute, NUL-terminated path.
#[inline]
pub fn open_file_absolute_z(path: &ZStr, flags: OpenFlags) -> Maybe<File> {
    open(path, flags.bits() | O::CLOEXEC, 0).map(File::from_fd)
}
/// `std.fs.cwd().openFile` — non-NUL-terminated convenience.
#[inline]
pub fn open_file(path: &[u8], flags: OpenFlags) -> Maybe<File> {
    open_a(path, flags.bits() | O::CLOEXEC, 0).map(File::from_fd)
}
/// bun.zig:883 — `openDirForIteration(dir, sub)`.
#[inline]
pub fn open_dir_for_iteration(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    open_dir_at(dir, path)
}
/// bun.zig:1303 — `bun.getFdPathZ(fd, buf)`. Wraps [`get_fd_path`] then
/// NUL-terminates in-place so callers receive a `&ZStr`.
pub fn get_fd_path_z<'a>(fd: Fd, out: &'a mut bun_paths::PathBuffer) -> Maybe<&'a ZStr> {
    let len = get_fd_path(fd, out)?.len();
    out.0[len] = 0;
    // SAFETY: NUL written at out[len]; bytes [0..len] initialised by get_fd_path.
    Ok(unsafe { ZStr::from_raw(out.0.as_ptr(), len) })
}

/// `&[u8]`-taking convenience over [`renameat_concurrently`] — Z-terminates both
/// paths into stack buffers (Zig signature is `[:0]const u8`).
pub fn renameat_concurrently_a(
    from_dir_fd: Fd,
    from: &[u8],
    to_dir_fd: Fd,
    to: &[u8],
    opts: RenameatConcurrentlyOptions,
) -> Maybe<()> {
    // Z-terminate both paths into stack buffers (Zig signature is `[:0]const u8`).
    let mut from_buf = bun_paths::PathBuffer::default();
    let from_len = from.len().min(from_buf.0.len() - 1);
    from_buf.0[..from_len].copy_from_slice(&from[..from_len]);
    from_buf.0[from_len] = 0;
    // SAFETY: NUL-terminated above.
    let from_z = unsafe { ZStr::from_raw(from_buf.0.as_ptr(), from_len) };

    let mut to_buf = bun_paths::PathBuffer::default();
    let to_len = to.len().min(to_buf.0.len() - 1);
    to_buf.0[..to_len].copy_from_slice(&to[..to_len]);
    to_buf.0[to_len] = 0;
    // SAFETY: NUL-terminated above.
    let to_z = unsafe { ZStr::from_raw(to_buf.0.as_ptr(), to_len) };

    renameat_concurrently(from_dir_fd, from_z, to_dir_fd, to_z, opts)
}
/// `bun.iterateDir(dir)` — convenience wrapper around `dir_iterator::iterate`.
#[inline]
pub fn iterate_dir(dir: Fd) -> dir_iterator::WrappedIterator {
    dir_iterator::iterate(dir)
}
/// sys.zig:3482 — `bun.sys.exists`. Non-NUL-terminated convenience over
/// [`exists_z`]: copies into a stack `PathBuffer`, NUL-terminates, then
/// `access(path, F_OK)` (POSIX) / `GetFileAttributesW` (Windows).
pub fn exists(path: &[u8]) -> bool {
    let mut buf = bun_paths::PathBuffer::default();
    if path.len() >= buf.0.len() {
        // Zig: `std.posix.toPosixPath(path) catch return false`
        return false;
    }
    buf.0[..path.len()].copy_from_slice(path);
    buf.0[path.len()] = 0;
    // SAFETY: NUL-terminated above.
    let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), path.len()) };
    exists_z(z)
}
/// sys.zig:4246 — `moveFileZ`. Tries the rename first (no source open on the
/// hot path); on EISDIR removes the dest dir and retries; on EXDEV falls back
/// to the slow open+copy path. Only opens the source inside the EXDEV branch.
pub fn move_file_z(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr)
    -> core::result::Result<(), bun_core::Error>
{
    // TODO(port): renameatConcurrentlyWithoutFallback (renameat2 NOREPLACE →
    // EXCHANGE → deleteTree) — sys.zig:2480. Plain `renameat` for now.
    match renameat(from_dir, filename, to_dir, destination) {
        Ok(()) => Ok(()),
        Err(e) if e.get_errno() == E::EISDIR => {
            #[cfg(unix)]
            // SAFETY: destination is NUL-terminated.
            let _ = unsafe { libc::unlinkat(to_dir.native(), destination.as_ptr(), libc::AT_REMOVEDIR) };
            renameat(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) if e.get_errno() == E::EXDEV => {
            move_file_z_slow(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) => Err(e.into()),
    }
}
/// sys.zig:4291 — `moveFileZSlow`: open source, unlink, copy to dest.
pub fn move_file_z_slow(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr) -> Maybe<()> {
    let in_handle = openat(
        from_dir, filename,
        O::RDONLY | O::CLOEXEC,
        if cfg!(windows) { 0 } else { 0o644 },
    )?;
    let _ = unlinkat(from_dir, filename);
    let r = copy_file_z_slow_with_handle(in_handle, to_dir, destination);
    let _ = close(in_handle);
    r
}
/// sys.zig:4305 — `copyFileZSlowWithHandle` (POSIX read/write fallback arm).
pub fn copy_file_z_slow_with_handle(in_handle: Fd, to_dir: Fd, destination: &ZStr) -> Maybe<()> {
    let st = fstat(in_handle)?;
    // Unlink dest first — fixes ETXTBUSY on Linux.
    let _ = unlinkat(to_dir, destination);
    let dst = openat(to_dir, destination, O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC, 0o644)?;
    #[cfg(target_os = "linux")] {
        // SAFETY: dst is a valid open fd; preallocation is best-effort.
        let _ = unsafe { libc::fallocate(dst.native(), 0, 0, st.st_size) };
    }
    let _ = lseek(in_handle, 0, libc::SEEK_SET);
    let r = copy_file(in_handle, dst);
    // sys.zig:4349 — only stamp mode/owner on success; on copy error the
    // partially-written dest keeps its openat() defaults.
    if r.is_ok() {
        // SAFETY: dst is a valid open fd.
        let _ = unsafe { libc::fchmod(dst.native(), st.st_mode) };
        let _ = unsafe { libc::fchown(dst.native(), st.st_uid, st.st_gid) };
    }
    let _ = close(dst);
    r
}
/// `renameatZ` alias (bun_install reaches for it as the NUL-terminated form).
#[inline]
pub fn renameat_z(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
    renameat(from_dir, from, to_dir, to)
}

/// sys.zig:2461 — option struct for [`renameat_concurrently`]. Zig used a
/// `comptime` anonymous struct param `{ move_fallback: bool = false }`; Rust
/// surfaces it as a runtime options struct so callers can build it inline.
#[derive(Default, Clone, Copy)]
pub struct RenameatConcurrentlyOptions {
    pub move_fallback: bool,
}
/// Alias: `bun_install` Phase-A drafts spelled this `RenameOptions`.
pub type RenameOptions = RenameatConcurrentlyOptions;

/// sys.zig:4296 — `moveFileZSlowMaybe`. Thin wrapper kept for source parity
/// with Zig callers (`renameatConcurrently` falls back through here).
#[inline]
pub fn move_file_z_slow_maybe(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr) -> Maybe<()> {
    move_file_z_slow(from_dir, filename, to_dir, destination)
}

/// sys.zig:2461 — `renameatConcurrently`. Tries an atomic NOREPLACE rename,
/// then EXCHANGE, then a racy delete-tree + rename. With `move_fallback` set,
/// an EXDEV result falls through to a slow open/copy.
pub fn renameat_concurrently(
    from_dir_fd: Fd,
    from: &ZStr,
    to_dir_fd: Fd,
    to: &ZStr,
    opts: RenameatConcurrentlyOptions,
) -> Maybe<()> {
    match renameat_concurrently_without_fallback(from_dir_fd, from, to_dir_fd, to) {
        Ok(()) => Ok(()),
        Err(e) => {
            if opts.move_fallback && e.get_errno() == E::EXDEV {
                bun_core::output::debug_warn(
                    "renameatConcurrently() failed with E.XDEV, falling back to moveFileZSlowMaybe()",
                );
                return move_file_z_slow_maybe(from_dir_fd, from, to_dir_fd, to);
            }
            Err(e)
        }
    }
}

/// sys.zig:2480 — `renameatConcurrentlyWithoutFallback`.
pub fn renameat_concurrently_without_fallback(
    from_dir_fd: Fd,
    from: &ZStr,
    to_dir_fd: Fd,
    to: &ZStr,
) -> Maybe<()> {
    let mut did_atomically_replace = false;
    let _ = did_atomically_replace; // tracked for parity with Zig

    'attempt: {
        {
            // Happy path: the folder doesn't exist in the cache dir, so we can
            // just rename it. We don't need to delete anything.
            let err = match renameat2(
                from_dir_fd,
                from,
                to_dir_fd,
                to,
                Renameat2Flags { exclude: true, ..Default::default() },
            ) {
                // if ENOENT don't retry
                Err(err) => {
                    if err.get_errno() == E::ENOENT {
                        return Err(err);
                    }
                    err
                }
                Ok(()) => break 'attempt,
            };

            // Windows doesn't have any equivalent of renameat with swap
            #[cfg(not(windows))]
            {
                // Fallback path: the folder exists in the cache dir, it might be in a strange state
                // let's attempt to atomically replace it with the temporary folder's version
                if matches!(err.get_errno(), E::EEXIST | E::ENOTEMPTY | E::EOPNOTSUPP) {
                    did_atomically_replace = true;
                    match renameat2(
                        from_dir_fd,
                        from,
                        to_dir_fd,
                        to,
                        Renameat2Flags { exchange: true, ..Default::default() },
                    ) {
                        Err(_) => {}
                        Ok(()) => break 'attempt,
                    }
                    did_atomically_replace = false;
                }
            }
            #[cfg(windows)]
            { let _ = err; }
        }

        //  sad path: let's try to delete the folder and then rename it
        if to_dir_fd.is_valid() {
            let _ = Dir::from_fd(to_dir_fd).delete_tree(to.as_bytes());
        } else {
            // TODO(port): `std.fs.deleteTreeAbsolute(to)` — full recursive
            // walk pending alongside `Dir::delete_tree` (B-2).
            let _ = Dir::cwd().delete_tree(to.as_bytes());
        }
        match renameat(from_dir_fd, from, to_dir_fd, to) {
            Err(err) => return Err(err),
            Ok(()) => {}
        }
    }

    Ok(())
}

/// Linux `eventfd(initval, flags)` — kernel notification fd.
#[cfg(target_os = "linux")]
pub fn eventfd(initval: u32, flags: i32) -> Maybe<Fd> {
    // SAFETY: eventfd(2) is safe to call with any args.
    let rc = unsafe { libc::eventfd(initval, flags) };
    if rc < 0 { return Err(err_with(Tag::open)); }
    Ok(Fd::from_native(rc))
}

/// `bun.Output.stderrWriter()` — `std::io::Write` over stderr fd. Used by
/// callers that want a borrowed writer without going through `bun_core::Output`.
#[inline]
pub fn stderr_writer() -> FileWriter { FileWriter(Fd::stderr()) }

// ──────────────────────────────────────────────────────────────────────────
// `NodeFS::writeFileWithPathBuffer` — CYCLEBREAK MOVE_DOWN landing.
//
// Real impl lives in `bun_runtime::node::node_fs` (T6, takes JS encodings,
// JSArrayBuffer, etc). Bundler (T4) needs a sync write that doesn't pull JSC.
// This is the minimal shape: `Buffer` data + `Path` target → openat+write+close.
// ──────────────────────────────────────────────────────────────────────────

/// Data payload for `write_file_with_path_buffer`.
pub enum WriteFileData<'a> {
    Buffer { buffer: &'a [u8] },
    // T6 adds `String { value, encoding }` / `ArrayBuffer { .. }`.
}
/// Encoding tag (only `Buffer` is honoured at T1).
#[derive(Clone, Copy, Default)]
pub enum WriteFileEncoding { #[default] Buffer }
/// Target — path (relative to `dirfd`) or an already-open fd.
pub enum PathOrFileDescriptor {
    Path(bun_string::PathString),
    Fd(Fd),
}
impl Default for PathOrFileDescriptor {
    fn default() -> Self { PathOrFileDescriptor::Fd(Fd::INVALID) }
}
/// Args struct (Zig: anon-struct init at call sites).
pub struct WriteFileArgs<'a> {
    pub data: WriteFileData<'a>,
    pub encoding: WriteFileEncoding,
    pub dirfd: Fd,
    pub file: PathOrFileDescriptor,
    pub mode: Mode,
}
impl<'a> Default for WriteFileArgs<'a> {
    fn default() -> Self {
        Self {
            data: WriteFileData::Buffer { buffer: &[] },
            encoding: WriteFileEncoding::Buffer,
            dirfd: Fd::cwd(),
            file: PathOrFileDescriptor::default(),
            mode: 0o666,
        }
    }
}
/// `NodeFS::writeFileWithPathBuffer` — sync `openat(CREAT|TRUNC)` + write_all.
/// `path_buf` is a scratch buffer for NUL-terminating the relative path.
pub fn write_file_with_path_buffer(
    path_buf: &mut bun_paths::PathBuffer,
    args: WriteFileArgs<'_>,
) -> Maybe<usize> {
    let WriteFileData::Buffer { buffer } = args.data;
    let fd = match args.file {
        PathOrFileDescriptor::Fd(fd) => fd,
        PathOrFileDescriptor::Path(ref p) => {
            let bytes = p.slice();
            if bytes.len() >= path_buf.0.len() {
                return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::open).with_path(bytes));
            }
            path_buf.0[..bytes.len()].copy_from_slice(bytes);
            path_buf.0[bytes.len()] = 0;
            // SAFETY: NUL-terminated above.
            let z = unsafe { ZStr::from_raw(path_buf.0.as_ptr(), bytes.len()) };
            openat(args.dirfd, z, O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC, args.mode)?
        }
    };
    let r = File::from_fd(fd).write_all(buffer);
    if !matches!(args.file, PathOrFileDescriptor::Fd(_)) { let _ = close(fd); }
    r.map(|_| buffer.len())
}

/// `bun.fetchCacheDirectoryPath` — resolve `$BUN_INSTALL_CACHE_DIR` /
/// `$XDG_CACHE_HOME/.bun/install/cache` / `$HOME/.bun/install/cache`.
/// PORT NOTE: full env-override chain lives in `bun_install`; this is the
/// fallback so the symbol resolves at T1. Returns an owned path (caller frees).
pub fn fetch_cache_directory_path() -> Vec<u8> {
    if let Some(v) = bun_core::getenv_z(bun_core::zstr!("BUN_INSTALL_CACHE_DIR")) {
        return v.to_vec();
    }
    if let Some(home) = bun_core::getenv_z(bun_core::zstr!("HOME")) {
        let mut p = home.to_vec();
        p.extend_from_slice(b"/.bun/install/cache");
        return p;
    }
    b".bun-cache".to_vec()
}

// ── `bun.fs` — forward stubs for the resolver-FS singleton (T4). ──
// CYCLEBREAK: real defs live in `bun_resolver::fs`; this gives `bun_install`
// a stable import path so its `use bun_sys::fs::FileSystem` lines resolve.
// The vtable is installed at runtime by the resolver crate.
pub mod fs {
    use core::sync::atomic::{AtomicPtr, Ordering};

    /// Cold-path vtable (§Dispatch) installed by `bun_resolver::fs` at init.
    /// All `*const Entry` / `*const DirEntry` arguments are erased
    /// `*const bun_resolver::fs::{Entry,DirEntry}` cast across the seam by
    /// callers (the opaque `#[repr(C)]` ZST handle pattern).
    /// PERF(port): was inline field reads on a known struct.
    pub struct FsVTable {
        pub instance: fn() -> *const FileSystem,
        /// Zig: `f.top_level_dir` — cached process cwd captured at
        /// `FileSystem::init`. Needed for `abs_buf` (fs.zig:495).
        pub top_level_dir: unsafe fn(*const FileSystem) -> &'static [u8],
        /// Zig: `FileSystem.setMaxFd` (fs.zig:62) — `max_fd = @max(fd, max_fd)`.
        pub set_max_fd: fn(super::FdNative),
        /// Returned slice may point INTO `*p` (tiny-string inline buffer,
        /// immutable.zig:548) — caller must not promote past the `Entry`
        /// borrow. Encoded as raw `(*const u8, usize)` to avoid laundering a
        /// fake `'static` across the seam (PORTING.md §Forbidden).
        pub entry_base: unsafe fn(*const Entry) -> (*const u8, usize),
        pub entry_base_lowercase: unsafe fn(*const Entry) -> (*const u8, usize),
        pub entry_dir: unsafe fn(*const Entry) -> &'static [u8],
        pub entry_abs_path: unsafe fn(*const Entry) -> bun_string::PathString,
        pub entry_set_abs_path: unsafe fn(*mut Entry, bun_string::PathString),
        pub entry_cache: unsafe fn(*const Entry) -> EntryCache,
        pub entry_kind: unsafe fn(*mut Entry, *mut core::ffi::c_void, bool) -> FsEntryKind,
        pub dir_entry_has_comptime_query: unsafe fn(*const DirEntry, &'static [u8]) -> bool,
        /// Zig: `dir_entry.fd` (fs.zig:121) — cached open directory fd, or
        /// `bun.invalid_fd` when not retained.
        pub dir_entry_fd: unsafe fn(*const DirEntry) -> super::Fd,
        pub dir_entry_data: unsafe fn(*const DirEntry) -> *const (),
        /// Snapshot the directory listing's value pointers into `out`.
        /// PERF(port): was `data.iterator()` — collected to flatten the
        /// `std::collections::hash_map::Values` type across the crate seam.
        pub dir_entry_collect: unsafe fn(*const DirEntry, *mut Vec<*mut Entry>),
        /// Zig: `FileSystem.dirname_store` (fs.zig:76) — the resolver's
        /// process-static `BSSStringList` instance.
        pub dirname_store: unsafe fn(*const FileSystem) -> *const DirnameStore,
        pub dirname_store_append:
            unsafe fn(*const DirnameStore, &[u8]) -> core::result::Result<&'static [u8], bun_alloc::AllocError>,
        pub dirname_store_append_lower_case:
            unsafe fn(*const DirnameStore, &[u8]) -> core::result::Result<&'static [u8], bun_alloc::AllocError>,
        /// Zig: `FileSystem.RealFS.getDefaultTempDir()` (fs.zig) — `BUN_TMPDIR`
        /// or the platform fallback. Process-static once-computed.
        pub get_default_temp_dir: fn() -> &'static [u8],
        /// Zig: `fs.fs.readDirectory(dir, null, generation, store_fd)`
        /// (fs.zig:872 `RealFS.readDirectory`). Returns the cached
        /// `*EntriesOption` slot projected by-value across the seam; the
        /// `*DirEntry` pointee is owned by the resolver's BSSMap singleton
        /// (process-lifetime).
        pub read_directory:
            unsafe fn(*const FileSystem, &[u8], u16, bool) -> core::result::Result<EntriesOption, bun_core::Error>,
        /// Zig: `f.top_level_dir = <slice>` (PackageManager.zig:776) — install
        /// rewrites the cached cwd after `chdir` to the workspace root.
        pub set_top_level_dir: unsafe fn(*const FileSystem, &'static [u8]),
    }

    /// Installed by `bun_resolver::fs::install_sys_fs_vtable()` at startup.
    /// `null` ⇒ the resolver crate hasn't been initialized; accessor calls
    /// abort with a clear message instead of UB.
    pub static FS_VTABLE: AtomicPtr<FsVTable> = AtomicPtr::new(core::ptr::null_mut());

    /// One-shot registration (mirrors `bun_core::output::install_output_sink`).
    #[inline]
    pub fn install_fs_vtable(v: &'static FsVTable) {
        // SAFETY(const→mut): `AtomicPtr<T>` only accepts `*mut T`, but the
        // pointee is never written through — `vtable()` is the sole consumer
        // and it materializes a `&'static FsVTable` (shared read). Casting a
        // `&'static` to `*mut` here is therefore provenance-preserving and
        // sound; no `&mut`/write is ever derived from the stored pointer.
        FS_VTABLE.store((v as *const FsVTable).cast_mut(), Ordering::Release);
    }

    #[inline]
    fn vtable() -> &'static FsVTable {
        let p = FS_VTABLE.load(Ordering::Acquire);
        if p.is_null() {
            // Surfaces mis-ordered init the same way the old `panic!` stubs did,
            // but with a single actionable message instead of per-method noise.
            panic!("bun_sys::fs accessed before bun_resolver::fs::install_sys_fs_vtable()");
        }
        // SAFETY: written exactly once at startup with a `&'static FsVTable`;
        // ordering guarantees the pointee is fully visible.
        unsafe { &*p }
    }

    /// Opaque handle to `bun_resolver::fs::FileSystem`. Dependents that need
    /// the concrete type must downcast via the resolver crate.
    #[repr(C)]
    pub struct FileSystem { _opaque: [u8; 0] }
    impl FileSystem {
        /// Installed by `bun_resolver::fs` at init (cold-path vtable §Dispatch).
        pub fn instance() -> &'static FileSystem {
            // SAFETY: `instance` returns the resolver's process-static singleton
            // (an erased `*const bun_resolver::fs::FileSystem`); never null once
            // `FileSystem::init()` ran.
            unsafe { &*(vtable().instance)() }
        }
        /// Zig: `FileSystem.tmpname` (fs.zig). Static — does not touch the
        /// vtable; delegates to the move-down impl in `bun_paths::fs` so
        /// callers can use either `bun_paths::fs::FileSystem::tmpname` or
        /// this opaque handle interchangeably.
        #[inline]
        pub fn tmpname<'b>(
            extname: &[u8],
            buf: &'b mut [u8],
            hash: u64,
        ) -> core::result::Result<&'b mut bun_core::ZStr, bun_core::Error> {
            bun_paths::fs::FileSystem::tmpname(extname, buf, hash)
        }
        /// Zig: `f.top_level_dir` — cached cwd captured at `FileSystem::init`.
        #[inline] pub fn top_level_dir(&self) -> &'static [u8] {
            // SAFETY: `self` is the resolver's process-static singleton.
            unsafe { (vtable().top_level_dir)(self) }
        }
        /// Zig: `FileSystem.normalize` (fs.zig:415) —
        /// `path_handler.normalizeString(str, true, .auto)`. Result borrows a
        /// thread-local buffer (valid until the next call on this thread).
        #[inline]
        pub fn normalize<'a>(&self, str: &'a [u8]) -> &'a [u8] {
            bun_paths::resolve_path::normalize_string::<true, bun_paths::platform::Auto>(str)
        }
        /// Zig: `FileSystem.relative` (fs.zig:439) —
        /// `path_handler.relative(from, to)`. Result borrows a thread-local
        /// buffer (caller must copy before the next call on this thread).
        #[inline]
        pub fn relative(&self, from: &[u8], to: &[u8]) -> &'static [u8] {
            bun_paths::resolve_path::relative(from, to)
        }
        /// Zig: `topLevelDirWithoutTrailingSlash`.
        pub fn top_level_dir_without_trailing_slash(&self) -> &'static [u8] {
            let d = self.top_level_dir();
            if d.len() > 1 && d.last() == Some(&bun_paths::SEP) {
                &d[..d.len() - 1]
            } else {
                d
            }
        }
        /// `fs.abs(parts)` — join `parts` against the cached `top_level_dir`.
        /// Zig (fs.zig:489): `joinAbsString(f.top_level_dir, parts, .loose)`.
        pub fn abs(&self, parts: &[&[u8]]) -> Vec<u8> {
            let mut buf = bun_paths::PathBuffer::default();
            self.abs_buf(parts, &mut buf.0).to_vec()
        }
        /// `fs.absBuf(parts, &mut buf)` (fs.zig:495):
        /// `path_handler.joinAbsStringBuf(f.top_level_dir, buf, parts, .loose)`.
        /// Uses the cached `top_level_dir` (NOT a fresh `getcwd()` — Zig
        /// captures it once at init so post-`chdir` resolution stays stable),
        /// and `Platform::Loose` so both separator styles and Windows drive
        /// letters are recognized as absolute.
        pub fn abs_buf<'a>(&self, parts: &[&[u8]], buf: &'a mut [u8]) -> &'a [u8] {
            let cwd = self.top_level_dir();
            bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Loose>(
                cwd, buf, parts,
            )
        }
        /// `fs.dirnameStore` — interned-string store for parent dirs.
        /// Routes through the vtable to the resolver's real `BSSStringList`
        /// singleton (NOT a function-local ZST — fs.zig:76 has TWO distinct
        /// stores with different preallocation sizes).
        pub fn dirname_store(&self) -> &DirnameStore {
            // SAFETY: vtable returns the address of the process-static
            // `DirnameStore::instance()`; never null after init.
            unsafe { &*(vtable().dirname_store)(self) }
        }
        /// `fs.setMaxFd(fd)` (fs.zig:62) — track highest fd seen so the
        /// stat-cache fd-pressure heuristic (fs.zig:774 `file_limit >
        /// (max_fd+1)*2`) has the right ceiling. No-op on Windows (fs.zig:64).
        #[inline] pub fn set_max_fd(&self, fd: super::FdNative) {
            (vtable().set_max_fd)(fd)
        }
        /// `FileSystem.RealFS.getDefaultTempDir()` — `BUN_TMPDIR` or the
        /// platform fallback. Static (process-global once-computed); routed
        /// through the vtable so the platform-specific Windows fallback (which
        /// interns into `DirnameStore`) stays in `bun_resolver`.
        #[inline] pub fn get_default_temp_dir() -> &'static [u8] {
            (vtable().get_default_temp_dir)()
        }
        /// Zig: `fs.fs.readDirectory(dir, null, generation, store_fd)`
        /// (fs.zig:872). Routes to `bun_resolver::fs::RealFS::read_directory`
        /// via the vtable. The returned `EntriesOption::Entries` carries an
        /// erased `*DirEntry` into the resolver's process-static BSSMap; the
        /// caller may rebind it as `&'static mut fs::DirEntry` (matching Zig's
        /// `*Fs.FileSystem.DirEntry`) provided no other live `&mut` to the same
        /// slot exists (single-threaded init in PackageManager).
        #[inline]
        pub fn read_directory(
            &self,
            dir: &[u8],
            generation: u16,
            store_fd: bool,
        ) -> core::result::Result<EntriesOption, bun_core::Error> {
            // SAFETY: `self` is the resolver's process-static singleton.
            unsafe { (vtable().read_directory)(self, dir, generation, store_fd) }
        }
        /// Zig: `f.top_level_dir = slice`. `slice` must be `'static` (interned
        /// in `DirnameStore` or a process-lifetime buffer like `cwd_buf`).
        #[inline]
        pub fn set_top_level_dir(&self, dir: &'static [u8]) {
            // SAFETY: `self` is the resolver's process-static singleton; only
            // called during single-threaded CLI init.
            unsafe { (vtable().set_top_level_dir)(self, dir) }
        }
    }

    // ── RealFS.Tmpfile ─────────────────────────────────────────────────────
    // MOVE_DOWN(b0): port of `FileSystem.RealFS.Tmpfile` (fs.zig) for callers
    // in `bun_install` that have no `bun_resolver` dep. The Zig POSIX impl
    // never touched its `*RealFS` arg (it always opens at cwd); the Windows
    // impl only needs the temp-dir path, which we route via the vtable.
    pub struct RealFsTmpfile {
        pub fd: super::Fd,
        pub dir_fd: super::Fd,
        #[cfg(windows)]
        pub existing_path: Box<[u8]>,
    }
    impl Default for RealFsTmpfile {
        fn default() -> Self {
            Self {
                fd: super::Fd::INVALID,
                dir_fd: super::Fd::INVALID,
                #[cfg(windows)]
                existing_path: Box::default(),
            }
        }
    }
    impl RealFsTmpfile {
        #[inline] pub fn file(&self) -> super::File { super::File::from_fd(self.fd) }

        pub fn close(&mut self) {
            if self.fd.is_valid() {
                let _ = super::close(self.fd);
                self.fd = super::Fd::INVALID;
            }
        }

        /// Zig: `Tmpfile.create(*RealFS, name)` — POSIX path opens at cwd
        /// (the `*RealFS` arg is unused there); Windows opens under the
        /// process temp dir.
        pub fn create(&mut self, name: &bun_core::ZStr) -> core::result::Result<(), bun_core::Error> {
            #[cfg(not(windows))]
            {
                // We originally used a temporary directory, but it caused EXDEV.
                let dir_fd = super::Fd::cwd();
                self.dir_fd = dir_fd;
                let flags = super::O::CREAT | super::O::RDWR | super::O::CLOEXEC;
                // S_IRWXU == 0o700
                self.fd = super::openat(dir_fd, name, flags, 0o700)?;
                Ok(())
            }
            #[cfg(windows)]
            {
                let tmp = FileSystem::get_default_temp_dir();
                let tmp_dir = super::open_dir_at(super::Fd::cwd(), tmp).map(super::Dir::from_fd)?;
                self.dir_fd = tmp_dir.fd();
                let flags = super::O::CREAT | super::O::WRONLY | super::O::CLOEXEC;
                self.fd = super::openat(tmp_dir.fd(), name, flags, 0)?;
                let mut buf = bun_paths::PathBuffer::uninit();
                let existing_path = super::get_fd_path(self.fd, &mut buf)?;
                self.existing_path = Box::<[u8]>::from(&*existing_path);
                Ok(())
            }
        }

        /// Zig: `Tmpfile.promoteToCWD(from_name, name)`.
        pub fn promote_to_cwd(
            &mut self,
            from_name: &bun_core::ZStr,
            name: &bun_core::ZStr,
        ) -> core::result::Result<(), bun_core::Error> {
            #[cfg(not(windows))]
            {
                debug_assert!(self.fd != super::Fd::INVALID);
                debug_assert!(self.dir_fd != super::Fd::INVALID);
                super::move_file_z_with_handle(self.fd, self.dir_fd, from_name, super::Fd::cwd(), name)?;
                self.close();
                Ok(())
            }
            #[cfg(windows)]
            {
                let _ = from_name;
                self.close();
                // TODO(port-windows): MoveFileExW with MOVEFILE_COPY_ALLOWED |
                // MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH
                // (fs.zig TmpfileWindows.promoteToCWD). Route via renameat for now.
                super::renameat_z(self.dir_fd, from_name, super::Fd::cwd(), name)
                    .map_err(Into::into)
            }
        }
    }
    /// `bun.fs.Entry` — single cached directory entry (name + kind).
    #[repr(C)]
    pub struct Entry { _opaque: [u8; 0] }
    impl Entry {
        // CYCLEBREAK: real fields/body live in `bun_resolver::fs::Entry`. These
        // accessors dispatch through `FS_VTABLE` so dependents type-check
        // against the `bun_sys::fs` path without an upward dep.
        //
        // PORT NOTE: `base()`/`base_lowercase()` MUST borrow `&self`, NOT
        // `'static`. Zig's `Entry.base_` is a `StringOrTinyString`
        // (fs.zig:333); for filenames ≤31 bytes (the overwhelming common case)
        // `slice()` returns `&this.remainder_buf[..]` (immutable.zig:548) —
        // bytes stored INLINE inside the `Entry` struct itself, not in any
        // arena. Laundering that to `&'static [u8]` lets a caller hold
        // `entry.base()` across a `&mut entry` reborrow → aliased `&`/`&mut`
        // (UB under Stacked Borrows; PORTING.md §Forbidden lifetime-laundering).
        // Call sites that need the basename across a mutation must copy it.
        #[inline] pub fn base(&self) -> &[u8] {
            // SAFETY: `self` is an erased `&bun_resolver::fs::Entry`; vtable
            // returns a (ptr,len) into either the `FilenameStore` arena OR
            // `self.base_.remainder_buf`. Both outlive `&self`.
            let (p, n) = unsafe { (vtable().entry_base)(self) };
            unsafe { core::slice::from_raw_parts(p, n) }
        }
        #[inline] pub fn base_lowercase(&self) -> &[u8] {
            // SAFETY: see `base()`.
            let (p, n) = unsafe { (vtable().entry_base_lowercase)(self) };
            unsafe { core::slice::from_raw_parts(p, n) }
        }
        #[inline] pub fn dir(&self) -> &'static [u8] {
            // SAFETY: `dir` field is a `&'static [u8]` interned in DirnameStore.
            unsafe { (vtable().entry_dir)(self) }
        }
        #[inline] pub fn abs_path(&self) -> bun_string::PathString {
            // SAFETY: `PathString` is `Copy`; vtable reads the field.
            unsafe { (vtable().entry_abs_path)(self) }
        }
        /// Zig: `entry.abs_path = PathString.init(...)`.
        #[inline] pub fn set_abs_path(&mut self, p: bun_string::PathString) {
            // SAFETY: `self` is an erased `&mut bun_resolver::fs::Entry`.
            unsafe { (vtable().entry_set_abs_path)(self, p) }
        }
        #[inline] pub fn cache(&self) -> EntryCache {
            // PORT NOTE: returns by-value (was `&EntryCache`) — the real
            // `bun_resolver::fs::EntryCache` and this mirror struct have
            // identical fields but distinct identity; copying through the
            // vtable seam avoids an unsound cross-crate `&` cast. All callers
            // (`router`) only read `.fd`/`.kind`/`.symlink`.
            // SAFETY: `EntryCache` is `Copy`; vtable reads and converts.
            unsafe { (vtable().entry_cache)(self) }
        }
        /// Zig: `Entry.kind(fs, store_fd)`. The `fs` arg is the resolver's
        /// `Implementation` (higher-tier); accepted as `*mut c_void` here so
        /// the dispatch stays tier-clean.
        #[inline] pub fn kind(&mut self, fs: *mut core::ffi::c_void, store_fd: bool) -> FsEntryKind {
            // SAFETY: `self` is an erased `&mut bun_resolver::fs::Entry`; `fs`
            // is `&mut bun_resolver::fs::Implementation` per the caller contract
            // (router threads `resolver.fs_impl()`).
            unsafe { (vtable().entry_kind)(self, fs, store_fd) }
        }
    }
    /// `bun.fs.Entry.Kind` (fs.zig:378-381) — exactly two variants. Distinct
    /// from `bun_core::FileKind` (the 11-variant `std.fs.Dir.Entry.Kind` map);
    /// the resolver collapses every stat result to one of these two before
    /// caching, so callers can match exhaustively.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum FsEntryKind {
        Dir,
        File,
    }
    /// `bun.fs.Entry.Cache` — cached stat result for an `Entry`.
    #[derive(Clone, Copy)]
    pub struct EntryCache {
        pub symlink: bun_string::PathString,
        pub fd: super::Fd,
        pub kind: FsEntryKind,
    }
    /// `bun.fs.DirEntry` — directory entry cache record (name → Entry map).
    #[repr(C)]
    pub struct DirEntry { _opaque: [u8; 0] }
    impl DirEntry {
        /// Zig: `DirEntry.hasComptimeQuery(comptime query)` — fast O(1) lookup
        /// of a known-at-compile-time filename in this directory's entry map.
        /// Zig (fs.zig:305-310) ASCII-lowercases `query_str` at comptime
        /// before hashing; the Rust seam pushes that onto callers, so the
        /// argument MUST already be lowercase.
        #[inline] pub fn has_comptime_query(&self, query_lower: &'static [u8]) -> bool {
            debug_assert!(
                query_lower.iter().all(|b| !b.is_ascii_uppercase()),
                "has_comptime_query: query must be ASCII-lowercase (Zig lowercases at comptime; fs.zig:305)"
            );
            // SAFETY: `self` is an erased `&bun_resolver::fs::DirEntry`.
            unsafe { (vtable().dir_entry_has_comptime_query)(self, query_lower) }
        }
        /// Zig: `dir_entry.fd` (fs.zig:121) — cached open directory fd, or
        /// `bun.invalid_fd` when the resolver did not retain it.
        #[inline] pub fn fd(&self) -> super::Fd {
            // SAFETY: `self` is an erased `&bun_resolver::fs::DirEntry`.
            unsafe { (vtable().dir_entry_fd)(self) }
        }
        /// Accessor for the underlying `EntryMap`. Real field is
        /// `bun_resolver::fs::DirEntry.data`; opaque here.
        #[inline] pub fn data(&self) -> *const () {
            // SAFETY: `self` is an erased `&bun_resolver::fs::DirEntry`.
            unsafe { (vtable().dir_entry_data)(self) }
        }
        /// Zig: `dir_entry.data.iterator()`. Yields a raw `*mut Entry` for each
        /// file in the cached directory listing (Zig's `EntryMap` value type is
        /// `*Entry`, fs.zig:117).
        ///
        /// PORT NOTE: yields `*mut Entry` (NOT `&'a mut Entry`). Zig's
        /// `data.iterator()` hands out raw `*Entry` with no exclusivity
        /// guarantee; promoting that to `&mut` from a `&self` receiver allowed
        /// two `iter()` calls on the same `&DirEntry` to produce two
        /// simultaneous `&mut Entry` to the same backing object (instant UB).
        /// Callers reborrow at the use site (`unsafe { &*p }` for reads,
        /// `unsafe { &mut *p }` for the single-writer mutation path) where the
        /// non-aliasing invariant is locally provable.
        #[inline] pub fn iter(&self) -> DirEntryIter<'_> {
            let mut buf = Vec::new();
            // SAFETY: `self` is an erased `&bun_resolver::fs::DirEntry`; `buf`
            // is a fresh local the vtable fills with EntryStore-owned pointers.
            unsafe { (vtable().dir_entry_collect)(self, &mut buf) };
            DirEntryIter { buf, i: 0, _marker: core::marker::PhantomData }
        }
    }
    /// Iterator over the cached entries in a `DirEntry`.
    /// PERF(port): was `data.iterator()` over the StringHashMap; collecting the
    /// value pointers up-front is the cost of erasing the std iterator type
    /// across the crate seam (cold path — route loading runs once per dir).
    pub struct DirEntryIter<'a> {
        buf: Vec<*mut Entry>,
        i: usize,
        _marker: core::marker::PhantomData<&'a DirEntry>,
    }
    impl<'a> DirEntryIter<'a> {
        /// Hand-rolled `next` (router calls `iter.next()` directly).
        #[allow(clippy::should_implement_trait)]
        #[inline]
        pub fn next(&mut self) -> Option<*mut Entry> {
            let p = *self.buf.get(self.i)?;
            self.i += 1;
            Some(p)
        }
    }
    impl<'a> Iterator for DirEntryIter<'a> {
        type Item = *mut Entry;
        #[inline]
        fn next(&mut self) -> Option<*mut Entry> { DirEntryIter::next(self) }
    }
    /// `bun.fs.FileSystem.DirnameStore` — interned-dirname arena.
    #[repr(C)]
    pub struct DirnameStore { _opaque: [u8; 0] }
    impl DirnameStore {
        /// Intern `value` into the dirname arena, returning a `&'static` slice.
        /// Zig: `DirnameStore.append(allocator, value)` (allocators.zig
        /// `BSSStringList.append`). Receiver is threaded through the vtable so
        /// `DirnameStore` and `FilenameStore` (distinct preallocation sizes,
        /// fs.zig:76-77) remain distinguishable.
        pub fn append(&self, value: &[u8]) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
            // SAFETY: `self` is an erased `&bun_resolver::fs::DirnameStore`.
            unsafe { (vtable().dirname_store_append)(self, value) }
        }
        /// Intern the ASCII-lowercased form of `value`.
        /// Zig: `DirnameStore.appendLowerCase(allocator, value)`.
        pub fn append_lower_case(&self, value: &[u8]) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
            // SAFETY: see `append()`.
            unsafe { (vtable().dirname_store_append_lower_case)(self, value) }
        }
    }
    /// `bun.fs.DirEntry.Err` (fs.zig:239) — preserves both the original errno
    /// from the failing syscall and the canonicalized error the resolver
    /// reports separately.
    #[derive(Clone, Copy)]
    pub struct DirEntryErr {
        pub original_err: bun_core::Error,
        pub canonical_error: bun_core::Error,
    }
    /// `bun.fs.EntriesOption` (fs.zig:929) — `entries: *DirEntry` / `err:
    /// DirEntry.Err`.
    pub enum EntriesOption {
        Entries(*const DirEntry),
        Err(DirEntryErr),
    }
}
/// Top-level alias (Zig: `bun.FileSystem`).
pub type FileSystem = fs::FileSystem;

// ──────────────────────────────────────────────────────────────────────────
// OUTPUT_SINK — bun_core's stderr vtable, installed by us at init (B-0 hook).
// ──────────────────────────────────────────────────────────────────────────

/// `bun_core::output::QuietWriter` is an opaque `[*mut (); 4]`. We stash the
/// raw fd in slot 0 and ignore the rest. (Zig's `QuietWriter` is `{ context:
/// File { handle: Fd } }`; the buffering layer in Zig is the std-adapter, which
/// we route to `QuietWriterAdapter` below.)
#[inline]
unsafe fn qw_fd(qw: *const bun_core::output::QuietWriter) -> Fd {
    // SAFETY: repr(C) [*mut (); 4]; slot 0 carries fd-as-usize-as-ptr.
    let raw = unsafe { *(qw as *const *mut ()) };
    Fd::from_native(raw as usize as _)
}
#[inline]
unsafe fn qw_set_fd(qw: *mut bun_core::output::QuietWriter, fd: Fd) {
    // SAFETY: repr(C) [*mut (); 4]; slot 0 carries fd-as-usize-as-ptr.
    unsafe { *(qw as *mut *mut ()) = fd.native() as usize as *mut (); }
}

/// Best-effort write-all loop. Returns `false` on I/O error / zero-write so
/// `ScopedLogger::log` can disable the scope; "quiet" callers discard the bool.
fn fd_write_all_quiet(fd: Fd, mut bytes: &[u8]) -> bool {
    while !bytes.is_empty() {
        match write(fd, bytes) {
            Ok(0) => return false, // short write → give up (matches Zig quiet semantics)
            Ok(n) => bytes = &bytes[n..],
            Err(_) => return false,
        }
    }
    true
}

/// Concrete repr behind the opaque `bun_core::output::QuietWriterAdapter`
/// (`[u8; 64]`). First field MUST be `io::Writer` so `new_interface()`'s
/// pointer-cast is sound. Layout asserted below.
#[repr(C)]
struct SysQuietWriterAdapter {
    writer: bun_core::io::Writer,
    fd: Fd,
}
const _: () = {
    assert!(core::mem::size_of::<SysQuietWriterAdapter>()
        <= core::mem::size_of::<bun_core::output::QuietWriterAdapter>());
    assert!(core::mem::align_of::<bun_core::output::QuietWriterAdapter>()
        >= core::mem::align_of::<SysQuietWriterAdapter>());
};

unsafe fn adapter_write_all(w: *mut bun_core::io::Writer, bytes: &[u8])
    -> core::result::Result<(), bun_core::Error>
{
    // SAFETY: `w` points at the first field of a SysQuietWriterAdapter (repr(C)).
    let this = unsafe { &*(w as *const SysQuietWriterAdapter) };
    let _ = fd_write_all_quiet(this.fd, bytes);
    Ok(())
}
unsafe fn adapter_flush(_w: *mut bun_core::io::Writer)
    -> core::result::Result<(), bun_core::Error>
{
    // Unbuffered (we write straight to the fd above), so flush is a no-op.
    // PERF(port): Zig buffers via `adaptToNewApi(buf)`; wire that in B-2.
    Ok(())
}

#[cfg(unix)]
unsafe fn sink_tty_winsize(fd: Fd) -> Option<bun_core::Winsize> {
    let mut ws: libc::winsize = unsafe { core::mem::zeroed() };
    // SAFETY: TIOCGWINSZ expects a *mut winsize.
    let rc = unsafe { libc::ioctl(fd.native(), libc::TIOCGWINSZ, &mut ws as *mut _) };
    if rc != 0 { return None; }
    Some(bun_core::Winsize {
        row: ws.ws_row,
        col: ws.ws_col,
        xpixel: ws.ws_xpixel,
        ypixel: ws.ws_ypixel,
    })
}
#[cfg(not(unix))]
unsafe fn sink_tty_winsize(_fd: Fd) -> Option<bun_core::Winsize> {
    // TODO(b2-windows): GetConsoleScreenBufferInfo.
    None
}

/// Backs `bun_core::output::OUTPUT_SINK_VTABLE` — stderr/mkdir/open/QuietWriter.
pub static OUTPUT_SINK_VTABLE_IMPL: bun_core::output::OutputSinkVTable =
    bun_core::output::OutputSinkVTable {
        stderr: || bun_core::output::File(Fd::stderr()),
        make_path: |cwd, dir| {
            mkdir_recursive_at(cwd, dir).map_err(Into::into)
        },
        create_file: |cwd, path| {
            openat_a(cwd, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)
                .map_err(Into::into)
        },
        quiet_writer_from_fd: |fd| {
            let mut out = bun_core::output::QuietWriter::ZEROED;
            // SAFETY: see qw_set_fd.
            unsafe { qw_set_fd(&mut out, fd) };
            out
        },
        quiet_writer_adapt: |qw, _buf, _len| {
            // SAFETY: qw came from quiet_writer_from_fd above.
            let fd = unsafe { qw_fd(&qw) };
            let concrete = SysQuietWriterAdapter {
                writer: bun_core::io::Writer {
                    write_all: adapter_write_all,
                    flush: adapter_flush,
                },
                fd,
            };
            let mut out = bun_core::output::QuietWriterAdapter::uninit();
            // SAFETY: size/align asserted in const block above; out is repr(C) [u8;64].
            unsafe {
                core::ptr::write(
                    &mut out as *mut _ as *mut SysQuietWriterAdapter,
                    concrete,
                );
            }
            out
        },
        quiet_writer_flush: |_qw| {
            // Unbuffered — see adapter_flush.
        },
        quiet_writer_write_all: |qw, bytes| {
            // SAFETY: qw came from quiet_writer_from_fd above.
            let fd = unsafe { qw_fd(qw) };
            fd_write_all_quiet(fd, bytes)
        },
        quiet_writer_fd: |qw| {
            // SAFETY: qw came from quiet_writer_from_fd above.
            unsafe { qw_fd(qw) }
        },
        tty_winsize: sink_tty_winsize,
        is_terminal: |fd| isatty(fd),
        read: |fd, buf| read(fd, buf).map_err(Into::into),
    };

pub fn install_output_sink() {
    bun_core::output::install_output_sink(&OUTPUT_SINK_VTABLE_IMPL);
}
