#![feature(core_io_borrowed_buf)]
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
// `File` here IS the bun_sys::File the lint routes everyone else through.
#![allow(clippy::disallowed_methods)]
// Tests lock std's Mutex: bun_threading depends on this crate.
#![cfg_attr(test, allow(clippy::disallowed_types))]
#![warn(unused_must_use)]
//! `bun_sys` — syscall wrappers.

// `Fd` struct + pure-data accessors are hoisted to `bun_core::Fd`
// (canonical T0). `fd.rs` is `pub trait FdExt` over that.

// `bun_str` is a historical namespace name; keep a public alias to
// `bun_core` so any external `bun_sys::bun_core::…` paths continue to resolve.
#[cfg(windows)]
pub extern crate bun_core as bun_str;
#[cfg(windows)]
pub extern crate bun_libuv_sys;
use bun_core::vec::{BorrowedBuf, BorrowedCursor};
use core::mem::MaybeUninit;
#[cfg(windows)]
use std::os::windows::io::IntoRawHandle as _;

pub mod fd;
pub use fd::{FdExt, MakeLibUvOwnedError, RawFd};
#[path = "Error.rs"]
mod error;
pub use error::Error;
#[cfg(windows)]
pub use error::ReturnCodeExt;
impl From<Error> for bun_errno::SystemErrno {
    #[inline]
    fn from(e: Error) -> Self {
        e.to_zig_err()
    }
}
/// The JS-facing rich error
/// (path/dest/syscall as `bun.String`). The data side has no JSC dependency:
/// the `*JSGlobalObject`-taking conversion methods (`toErrorInstance` etc.)
/// live in `bun_jsc` as inherent extensions. The `#[repr(C)]` layout C++ reads
/// is `bun_jsc::SystemError`; this struct is the Rust-side data shape and is
/// marshalled field-by-field via `From<bun_sys::SystemError>` at the seam.
#[derive(Default)]
pub struct SystemError {
    pub errno: core::ffi::c_int,
    /// label for errno
    pub code: bun_core::String,
    /// it is illegal to have an empty message
    pub message: bun_core::String,
    pub path: bun_core::String,
    pub syscall: bun_core::String,
    pub hostname: bun_core::String,
    pub fd: Option<core::ffi::c_int>,
    pub dest: bun_core::String,
}
impl SystemError {
    /// (`Error::to_system_error` stores `errno` negated to match Node.)
    #[inline]
    pub fn get_errno(&self) -> E {
        // On Windows `self.errno` is a libuv code (e.g. UV_EBUSY = -4082);
        // canonicalize to the small `E` discriminant so Rust-side callers that
        // compare against `E::BUSY`/`E::BADF` keep matching.
        #[cfg(windows)]
        if let Some(d) = crate::windows::libuv::uv_err_to_e_discriminant(self.errno) {
            if let Some(e) = E::try_from_raw(d) {
                return e;
            }
        }
        e_from_negated(self.errno)
    }
}
impl core::fmt::Display for SystemError {
    /// Emits the colorless variant
    /// (`<r>/<red>/<d>/<b>` markup collapsed to nothing) so
    /// `Display` stays side-effect-free. The colored path is handled by
    /// `bun_core::Output::pretty*` at the call site that prints the error.
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.fmt_with_path(&self.path, f)
    }
}
impl SystemError {
    /// `Display` with `path` in place of `self.path`.
    pub(crate) fn fmt_with_path(
        &self,
        path: &bun_core::String,
        f: &mut core::fmt::Formatter<'_>,
    ) -> core::fmt::Result {
        if !path.is_empty() {
            // "<code>: <path>: <message> (<syscall>())"
            write!(
                f,
                "{}: {}: {} ({}())",
                self.code,
                bun_core::fmt::EscapeControlChars(path),
                self.message,
                self.syscall,
            )
        } else {
            // "<code>: <message> (<syscall>())"
            write!(f, "{}: {} ({}())", self.code, self.message, self.syscall)
        }
    }
}
pub mod walker_skippable;
// `copy_file.rs` — full ioctl_ficlone / copy_file_range / sendfile / r-w-loop
// state machine. Raw kernel
// thunks live in `crate::linux`, errno tags use the prefixed `E::E*` form,
// kernel-version probe goes through `bun_core::linux_kernel_version()`.
#[path = "copy_file.rs"]
pub mod copy_file;

// Directory-entry kind — same set as `bun_core::FileKind`.
pub use bun_core::FileKind as EntryKind;

#[cfg(unix)]
mod dirent;

// `bun.DirIterator`.
//
// A readdir-style directory iterator. Notable behaviors:
// - returns errors in `bun_sys::Result` (preserves errno + syscall tag)
// - doesn't mark BADF as unreachable

/// `__getdirentries64` (private libsystem symbol): fills `buf` with
/// variable-length dirent records and advances `*basep`. Returns the byte
/// count written (0 means EOF). Retries EINTR (#41085). There is no
/// `$NOCANCEL` variant to call: getdirentries64 is not a pthread
/// cancellation point (xnu syscalls.master has no `_nocancel` entry for it).
///
/// On a buffer of at least 1024 bytes the kernel reports EOF in the last 4
/// bytes; this wrapper zeroes them before each attempt so the caller can
/// trust the flag even after a retry.
#[cfg(target_os = "macos")]
fn getdirentries64(fd: Fd, buf: &mut [MaybeUninit<u8>], basep: &mut i64) -> Maybe<usize> {
    unsafe extern "C" {
        fn __getdirentries64(
            fd: libc::c_int,
            buf: *mut u8,
            nbytes: usize,
            basep: *mut i64,
        ) -> isize;
    }
    loop {
        if let Some(flag) = buf.last_chunk_mut::<4>() {
            *flag = [MaybeUninit::new(0); 4];
        }
        // SAFETY: `buf` is writable for `buf.len()` bytes.
        let rc =
            unsafe { __getdirentries64(fd.native(), buf.as_mut_ptr().cast(), buf.len(), basep) };
        if rc < 0 {
            let e = last_errno();
            if e == libc::EINTR {
                continue;
            }
            return Err(Error::from_code_int(e, Tag::getdirentries64));
        }
        return Ok(rc as usize);
    }
}

pub mod dir_iterator {
    #[cfg(not(target_os = "macos"))]
    use super::Error;
    #[cfg(unix)]
    use super::dirent;
    use super::{Dir, EntryKind, Fd, Result, Tag};
    use bun_core::ZStr;
    use bun_paths::OSPathChar;
    use core::mem::MaybeUninit;

    const BUF_SIZE: usize = 8192;

    /// Native-encoding directory entry returned by `WrappedIterator::next()`.
    pub struct IteratorResult<'a> {
        pub name: Name<'a>,
        pub kind: EntryKind,
        /// The inode number the directory records for the entry; 0 on Windows.
        pub ino: u64,
        #[cfg(windows)]
        has_directory_attribute: bool,
    }

    impl IteratorResult<'_> {
        /// Whether a `SymLink` stands for a directory, where the listing says
        /// so: a link on Windows is made as one or the other, whatever is at
        /// its target, and `NtQueryAttributesFile` answers with the same bit.
        /// `None`: the link has to be followed.
        #[inline]
        pub fn link_is_directory(&self) -> Option<bool> {
            #[cfg(windows)]
            {
                Some(self.has_directory_attribute)
            }
            #[cfg(not(windows))]
            {
                None
            }
        }
    }

    #[cfg(not(windows))]
    pub struct Name<'a>(&'a ZStr);
    #[cfg(not(windows))]
    impl<'a> Name<'a> {
        #[inline]
        pub fn slice(&self) -> &'a [OSPathChar] {
            self.0.as_bytes()
        }
        #[inline]
        pub fn as_zstr(&self) -> &'a ZStr {
            self.0
        }
    }

    #[cfg(windows)]
    pub struct Name<'a> {
        native: &'a [OSPathChar],
        /// Where `utf8` is written, when it is first asked for.
        scratch: core::cell::Cell<Option<&'a mut Utf8Name>>,
        utf8: core::cell::OnceCell<&'a ZStr>,
    }
    #[cfg(windows)]
    impl<'a> Name<'a> {
        #[inline]
        pub fn slice(&self) -> &'a [OSPathChar] {
            self.native
        }
        /// In UTF-8.
        #[inline]
        pub fn as_zstr(&self) -> &'a ZStr {
            self.utf8.get_or_init(|| {
                let name = self.scratch.take().expect("taken once");
                name.set(self.native).expect("a name fits");
                name
            })
        }
    }

    impl<'a> Name<'a> {
        /// The native bytes on POSIX, UTF-8 on Windows.
        #[inline]
        pub fn slice_u8(&self) -> &'a [u8] {
            self.as_zstr().as_bytes()
        }
    }

    // 8-byte alignment matches `@alignOf(linux.dirent64)` / Darwin dirent /
    // FILE_DIRECTORY_INFORMATION's LONGLONG-boundary requirement.
    //
    // `buf` is inline and uninitialised:
    // `MaybeUninit` skips the 8 KiB `memset` per directory (perf:
    // ~1.4K dirs/install → ~11 MB zalloc churn dropped) and store it inline in
    // `State` so the per-dir heap allocation is gone too. The kernel fills
    // `[0..rc]` before we read; we never index past `end_index`.
    #[repr(C, align(8))]
    struct AlignedBuf([MaybeUninit<u8>; BUF_SIZE]);
    impl AlignedBuf {
        #[inline(always)]
        const fn uninit() -> Self {
            AlignedBuf([const { MaybeUninit::uninit() }; BUF_SIZE])
        }
        /// View `[0..len]` as `&[u8]`.
        ///
        /// SAFETY: caller asserts the kernel (or an explicit write) has
        /// initialized every byte in `[0..len]`.
        #[inline(always)]
        unsafe fn filled(&self, len: usize) -> &[u8] {
            // SAFETY: caller contract — bytes `[0..len]` were initialized.
            unsafe { self.0[..len].assume_init_ref() }
        }
    }

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
            // DT_WHT (14) — Darwin/FreeBSD union-mount whiteout. The `libc`
            // crate omits this constant on both Apple and FreeBSD targets;
            // literal matches <sys/dirent.h>.
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            14 /* DT_WHT */ => EntryKind::Whiteout,
            // DT_UNKNOWN: some filesystems (bind mounts, FUSE, NFS) don't
            // provide d_type. Callers should lstatat() to resolve when needed.
            _ => EntryKind::Unknown,
        }
    }

    /// Parses the record at `index`. The last refill wrote `end_index` bytes. Returns `None` if the
    /// record is malformed.
    #[cfg(unix)]
    #[inline]
    fn record_at(buf: &AlignedBuf, index: usize, end_index: usize) -> Option<dirent::Record<'_>> {
        if end_index > BUF_SIZE {
            return None;
        }
        // SAFETY: the syscall filled `[0..end_index]`, and `end_index <= BUF_SIZE`.
        let filled = unsafe { buf.filled(end_index) };
        dirent::parse::<dirent::Native>(filled, index)
    }

    // ── Linux / Android ──────────────────────────────────────────────────
    // Same `getdents64(2)` walk for both — Android is the same kernel, and
    // `linux_syscall::getdents64` is a raw syscall (no libc wrapper involved).
    #[cfg(any(target_os = "linux", target_os = "android"))]
    struct State {
        buf: AlignedBuf,
        index: usize,
        end_index: usize,
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    impl State {
        #[inline]
        fn new() -> State {
            State {
                buf: AlignedBuf::uninit(),
                index: 0,
                end_index: 0,
            }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult<'_>>> {
            loop {
                if self.index >= self.end_index {
                    // glibc doesn't expose getdents64; go straight to the syscall.
                    let rc = super::linux_syscall::getdents64(dir, &mut self.buf.0);
                    if rc < 0 {
                        return Err(Error::from_code_int(super::last_errno(), Tag::getdents64));
                    }
                    if rc == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = rc as usize;
                }
                let Some(record) = record_at(&self.buf, self.index, self.end_index) else {
                    return dirent::end_walk(&mut self.end_index, Tag::getdents64);
                };
                self.index = record.next;
                let Some(entry) = record.entry else { continue };

                return Ok(Some(IteratorResult {
                    name: Name(entry.name),
                    kind: kind_from_dt(entry.d_type),
                    ino: entry.ino,
                }));
            }
        }
    }

    // ── macOS ────────────────────────────────────────────────────────────
    #[cfg(target_os = "macos")]
    struct State {
        buf: AlignedBuf,
        seek: i64,
        index: usize,
        end_index: usize,
        received_eof: bool,
    }
    #[cfg(target_os = "macos")]
    impl State {
        #[inline]
        fn new() -> State {
            State {
                buf: AlignedBuf::uninit(),
                seek: 0,
                index: 0,
                end_index: 0,
                received_eof: false,
            }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult<'_>>> {
            loop {
                if self.index >= self.end_index {
                    if self.received_eof {
                        return Ok(None);
                    }

                    // getdirentries64() writes to the last 4 bytes of the
                    // buffer to indicate EOF. If that value is not zero, we
                    // have reached the end of the directory and can skip the
                    // extra syscall. The wrapper zeroes those bytes before
                    // each attempt.
                    // https://github.com/apple-oss-distributions/xnu/blob/94d3b452840153a99b38a3a9659680b2a006908e/bsd/vfs/vfs_syscalls.c#L10444-L10470
                    const GETDIRENTRIES64_EXTENDED_BUFSIZE: usize = 1024;
                    const _: () = assert!(BUF_SIZE >= GETDIRENTRIES64_EXTENDED_BUFSIZE);
                    self.received_eof = false;

                    let n = super::getdirentries64(dir, &mut self.buf.0, &mut self.seek)?;
                    if n == 0 {
                        self.received_eof = true;
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = n;
                    // SAFETY: the wrapper zeroed them, and the kernel may have written the EOF flag since.
                    let flag = unsafe { self.buf.0[BUF_SIZE - 4..].assume_init_ref() };
                    self.received_eof =
                        self.end_index <= (BUF_SIZE - 4) && flag == 1u32.to_ne_bytes();
                }
                let Some(record) = record_at(&self.buf, self.index, self.end_index) else {
                    return dirent::end_walk(&mut self.end_index, Tag::getdirentries64);
                };
                self.index = record.next;
                let Some(entry) = record.entry else { continue };

                return Ok(Some(IteratorResult {
                    name: Name(entry.name),
                    kind: kind_from_dt(entry.d_type),
                    ino: entry.ino,
                }));
            }
        }
    }

    // ── FreeBSD ──────────────────────────────────────────────────────────
    #[cfg(target_os = "freebsd")]
    struct State {
        buf: AlignedBuf,
        index: usize,
        end_index: usize,
    }
    #[cfg(target_os = "freebsd")]
    impl State {
        #[inline]
        fn new() -> State {
            State {
                buf: AlignedBuf::uninit(),
                index: 0,
                end_index: 0,
            }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult<'_>>> {
            unsafe extern "C" {
                fn getdents(fd: libc::c_int, buf: *mut u8, nbytes: usize) -> isize;
            }
            loop {
                if self.index >= self.end_index {
                    let buf = self.buf.0.as_mut_ptr().cast();
                    // SAFETY: buf is valid for BUF_SIZE bytes.
                    let rc = unsafe { getdents(dir.native(), buf, BUF_SIZE) };
                    if rc < 0 {
                        let e = super::last_errno();
                        // FreeBSD reports ENOENT when iterating an unlinked
                        // but still-open directory.
                        if e == libc::ENOENT {
                            return Ok(None);
                        }
                        return Err(Error::from_code_int(e, Tag::getdents64));
                    }
                    if rc == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = rc as usize;
                }
                let Some(record) = record_at(&self.buf, self.index, self.end_index) else {
                    return dirent::end_walk(&mut self.end_index, Tag::getdents64);
                };
                self.index = record.next;
                let Some(entry) = record.entry else { continue };

                return Ok(Some(IteratorResult {
                    name: Name(entry.name),
                    kind: kind_from_dt(entry.d_type),
                    ino: entry.ino,
                }));
            }
        }
    }

    // ── Windows ──────────────────────────────────────────────────────────
    // `NtQueryDirectoryFile` + `FILE_DIRECTORY_INFORMATION` walk.
    #[cfg(windows)]
    struct State {
        // > This structure must be aligned on a LONGLONG (8-byte) boundary. If
        // > a buffer contains two or more of these structures, the
        // > NextEntryOffset value in each entry, except the last, falls on an
        // > 8-byte boundary.
        // https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_directory_information
        buf: AlignedBuf,
        index: usize,
        end_index: usize,
        first: bool,
        /// Optional kernel-side wildcard filter passed to NtQueryDirectoryFile.
        /// Evaluated by `FsRtlIsNameInExpression` (case-insensitive, supports
        /// `*` and `?`). Only honored on the first call (RestartScan=TRUE);
        /// sticky for the handle lifetime.
        name_filter: Option<Vec<u16>>,
        utf8_name: Utf8Name,
    }
    #[cfg(windows)]
    const MAX_NAME_UNITS: usize = 256;
    #[cfg(windows)]
    type Utf8Name = bun_paths::StackPath<{ 3 * MAX_NAME_UNITS + 1 }>;
    #[cfg(windows)]
    impl State {
        #[inline]
        fn new() -> State {
            State {
                buf: AlignedBuf::uninit(),
                index: 0,
                end_index: 0,
                first: true,
                name_filter: None,
                utf8_name: Utf8Name::new(),
            }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult<'_>>> {
            use bun_windows_sys::externs as w;
            use core::mem::offset_of;
            use w::FILE_DIRECTORY_INFORMATION as Record;
            loop {
                if self.index >= self.end_index {
                    if self.first {
                        // > Any bytes inserted for alignment SHOULD be set to
                        // > zero, and the receiver MUST ignore them.
                        self.buf.0.fill(MaybeUninit::new(0));
                    }
                    let mut filter_us = w::UNICODE_STRING {
                        Length: 0,
                        MaximumLength: 0,
                        Buffer: core::ptr::null_mut(),
                    };
                    let filter_ptr: *mut w::UNICODE_STRING = match &self.name_filter {
                        Some(f) => {
                            let len_bytes = (f.len() * 2) as u16;
                            filter_us.Length = len_bytes;
                            filter_us.MaximumLength = len_bytes;
                            filter_us.Buffer = f.as_ptr().cast_mut().cast::<u16>();
                            &mut filter_us
                        }
                        None => core::ptr::null_mut(),
                    };
                    let (rc, filled) = crate::windows::sync_io::complete(dir.native(), |io| {
                        // SAFETY: all pointer args are valid until `complete` returns.
                        unsafe {
                            w::ntdll::NtQueryDirectoryFile(
                                dir.native(),
                                core::ptr::null_mut(),
                                core::ptr::null_mut(),
                                core::ptr::null_mut(),
                                io,
                                self.buf.0.as_mut_ptr().cast(),
                                BUF_SIZE as u32,
                                w::FILE_INFORMATION_CLASS::FileDirectoryInformation,
                                0, // FALSE — return many entries per call
                                filter_ptr,
                                if self.first { 1 } else { 0 },
                            )
                        }
                    });
                    self.first = false;
                    crate::syslog!("NtQueryDirectoryFile({}) = {:#x}", dir, rc.0);

                    // If the handle is not a directory, we'll get
                    // STATUS_INVALID_PARAMETER.
                    if rc == w::NTSTATUS::INVALID_PARAMETER {
                        return Err(Error::from_code(
                            super::E::ENOTDIR,
                            Tag::NtQueryDirectoryFile,
                        ));
                    }
                    // NO_SUCH_FILE is returned on the first call when a
                    // FileName filter matches nothing; NO_MORE_FILES on
                    // subsequent calls. Both mean "done".
                    if rc == w::NTSTATUS::NO_MORE_FILES || rc == w::NTSTATUS::NO_SUCH_FILE {
                        return Ok(None);
                    }
                    if rc != w::NTSTATUS::SUCCESS {
                        return Err(Error::new(rc, Tag::NtQueryDirectoryFile));
                    }
                    if filled == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = filled;
                }

                let entry_offset = self.index;
                // SAFETY: the `if self.first` branch zero-fills the whole 8 KiB
                // before the first NtQueryDirectoryFile, and every subsequent
                // call only overwrites a prefix — `[0..BUF_SIZE)` stays fully
                // initialized for the iterator's lifetime once we reach here.
                let buf = unsafe { self.buf.filled(BUF_SIZE) };
                // Faulty VM and sandboxing tools misalign records, so the fields are read as bytes.
                let (header, name) = buf[entry_offset..].split_at(offset_of!(Record, FileName));
                let field = |offset: usize| {
                    u32::from_ne_bytes(*header[offset..].first_chunk().expect("in the header"))
                };
                let next_off = field(offset_of!(Record, NextEntryOffset)) as usize;
                let file_attrs = field(offset_of!(Record, FileAttributes));
                let name_len_bytes = field(offset_of!(Record, FileNameLength)) as usize;
                self.index = if next_off != 0 {
                    entry_offset + next_off
                } else {
                    BUF_SIZE
                };

                // Some drivers report a length beyond the limit of NTFS and the end of the buffer.
                let name_len_u16 = (name_len_bytes / 2).min(MAX_NAME_UNITS).min(name.len() / 2);
                let dir_info_name: &[u16] = bun_core::cast_slice(&name[..name_len_u16 * 2]);

                if dir_info_name == [b'.' as u16] || dir_info_name == [b'.' as u16, b'.' as u16] {
                    continue;
                }

                let isdir = (file_attrs & w::FILE_ATTRIBUTE_DIRECTORY) != 0;
                let kind = {
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
                    name: Name {
                        native: dir_info_name,
                        scratch: core::cell::Cell::new(Some(&mut self.utf8_name)),
                        utf8: core::cell::OnceCell::new(),
                    },
                    kind,
                    ino: 0,
                    has_directory_attribute: isdir,
                }));
            }
        }
    }

    pub struct WrappedIterator {
        dir: Fd,
        state: State,
    }
    impl WrappedIterator {
        #[inline]
        pub fn dir(&self) -> Fd {
            self.dir
        }
        /// Kernel-side name filter (passed to `NtQueryDirectoryFile`).
        #[cfg(windows)]
        #[inline]
        pub fn set_name_filter(&mut self, filter: Option<&[u16]>) {
            self.state.name_filter = filter.map(|f| f.to_vec());
        }
        #[inline]
        pub fn next(&mut self) -> Result<Option<IteratorResult<'_>>> {
            self.state.next(self.dir)
        }
    }

    pub fn iterate(dir: Fd) -> WrappedIterator {
        WrappedIterator {
            dir,
            state: State::new(),
        }
    }

    /// A [`WrappedIterator`] that the directory belongs to.
    pub struct OwnedIterator {
        dir: Dir,
        state: State,
    }
    impl OwnedIterator {
        pub fn dir(&self) -> Fd {
            self.dir.fd()
        }
        pub fn next(&mut self) -> Result<Option<IteratorResult<'_>>> {
            self.state.next(self.dir.fd())
        }
    }

    pub fn iterate_owned(dir: Dir) -> OwnedIterator {
        OwnedIterator {
            dir,
            state: State::new(),
        }
    }
}

/// `bun.openDirForIterationOSPath` — `openat(dir, path, O_DIRECTORY|O_RDONLY)`
/// on POSIX; `CreateFileW` with `FILE_FLAG_BACKUP_SEMANTICS` on Windows.
pub fn open_dir_for_iteration_os_path(dir: Fd, path: &bun_paths::OSPathSlice) -> Result<Fd> {
    #[cfg(not(windows))]
    {
        let flags = libc::O_DIRECTORY | libc::O_RDONLY | libc::O_CLOEXEC;
        openat_a(dir, path, flags, 0)
    }
    #[cfg(windows)]
    {
        open_dir_at_windows(
            dir,
            path,
            WindowsOpenDirOptions {
                iterable: true,
                ..Default::default()
            },
        )
    }
}

pub fn lstatat(fd: impl AsFd, path: &ZStr) -> Result<Stat> {
    let fd = fd.as_fd();
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let dir = if fd.is_valid() { fd } else { Fd::cwd() };
        linux_syscall::fstatat(dir, path, libc::AT_SYMLINK_NOFOLLOW)
            .map_err(|e| Error::from_code_int(e, Tag::fstatat).with_path(path.as_bytes()))
    }
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    {
        let mut st = core::mem::MaybeUninit::<libc::stat>::uninit();
        let dirfd = if fd.is_valid() {
            fd.native()
        } else {
            libc::AT_FDCWD
        };
        // SAFETY: path is NUL-terminated; st is written on success.
        let rc = unsafe {
            libc::fstatat(
                dirfd,
                path.as_ptr().cast(),
                st.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if rc == 0 {
            // SAFETY: rc == 0 ⇒ kernel populated `st`.
            Ok(unsafe { st.assume_init() })
        } else {
            Err(Error::from_code_int(last_errno(), Tag::fstatat).with_path(path.as_bytes()))
        }
    }
    #[cfg(windows)]
    {
        // Open with `O.NOFOLLOW` (→ `FILE_OPEN_REPARSE_POINT`),
        // `fstat` the handle, then close.
        match openat_windows_a(fd, path.as_bytes(), O::NOFOLLOW, 0) {
            Ok(file) => CloseOnDrop::new(file).stat(),
            Err(err) => Err(err),
        }
    }
}
/// Read cwd into a stack
/// `PathBuffer`, then duplicate into a heap-owned NUL-terminated `ZBox`.
pub fn getcwd_alloc() -> Maybe<bun_core::ZBox> {
    let mut buf = [0u8; bun_core::MAX_PATH_BYTES];
    let len = getcwd(&mut buf[..])?;
    Ok(bun_core::ZBox::from_bytes(&buf[..len]))
}

/// `getcwd` returning a NUL-terminated
/// borrow into `buf`. POSIX `getcwd(3)` already NUL-terminates; on Windows
/// the libuv path does too.
pub fn getcwd_z(buf: &mut bun_paths::PathBuffer) -> Maybe<&ZStr> {
    let len = getcwd(&mut buf[..])?;
    Ok(ZStr::nul_terminate(buf, len))
}

pub mod coreutils_error_map;
pub(crate) mod libuv_error_map;
#[path = "SignalCode.rs"]
pub mod signal_code;
pub use signal_code::SignalCode;
#[cfg(unix)]
pub mod beneath;
pub mod tmp;
pub use tmp::{DeleteTreeOnDrop, Tmpfile, UnlinkOnDrop};
// `windows/mod.rs` is `#![cfg(windows)]`-gated internally; on POSIX this
// declares an empty module so `bun_sys::windows::*` paths still resolve under
// `#[cfg(windows)]` arms in dependents.
pub mod windows;

use core::ffi::c_void;
#[cfg(not(windows))]
use core::ffi::{c_char, c_int};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from lower-tier crates (PORTING.md crate map).
// ──────────────────────────────────────────────────────────────────────────
pub use bun_core::{Fd, FdKind, FdNative, FileKind, Mode, Stdio, kind_from_mode};

/// Anything that can hand out an [`Fd`] without giving up ownership: a raw
/// `Fd`, or a reference to an owning [`File`] / [`Dir`]. Mirrors
/// `std::os::fd::AsFd`. Implemented for references only (not owned `File` /
/// `Dir`) so syscall wrappers can't accidentally consume and drop-close an
/// owned handle.
pub trait AsFd: Copy {
    fn as_fd(&self) -> Fd;
}
impl AsFd for Fd {
    #[inline]
    fn as_fd(&self) -> Fd {
        *self
    }
}
impl AsFd for &Fd {
    #[inline]
    fn as_fd(&self) -> Fd {
        **self
    }
}
impl AsFd for &File {
    #[inline]
    fn as_fd(&self) -> Fd {
        self.handle
    }
}
impl AsFd for &Dir {
    #[inline]
    fn as_fd(&self) -> Fd {
        self.fd
    }
}

// Raw Linux syscalls via rustix (linux_raw backend). Hot-path I/O on Linux
// routes through here instead of glibc — see module doc. Android: same kernel,
// same syscall ABI; `linux_syscall.rs` carries its own
// `#![cfg(any(linux, android))]` so the gates stay in lockstep.
#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux_syscall;

#[inline]
pub fn is_regular_file(mode: Mode) -> bool {
    kind_from_mode(mode) == FileKind::File
}
#[cfg(windows)]
pub use bun_errno::Win32ErrorExt;
pub use bun_errno::{E, S, SystemErrno, e_from_negated, last_error};
#[cfg(not(windows))]
pub use bun_errno::{GetErrno, get_errno};

/// Exported for `headers-handwritten.h` `Bun__errnoName`. Returns a
/// NUL-terminated upper-case errno name (e.g. `"ENOENT"`) or null for an
/// unrecognised code. The pointer is thread-local and valid until the next
/// call on the same thread; both C++ callers consume it immediately.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__errnoName(err: core::ffi::c_int) -> *const core::ffi::c_char {
    // `SystemErrno::init` has a per-target signature: `i64` on every POSIX
    // target (Linux/Darwin/FreeBSD), generic `SystemErrnoInit` on Windows.
    // Feed it the widest signed int and let each impl narrow.
    #[cfg(unix)]
    let code = err as i64;
    #[cfg(windows)]
    let code = err;
    let Some(e) = SystemErrno::init(code) else {
        return core::ptr::null();
    };
    // strum's `IntoStaticStr` yields a `&str` without a NUL terminator, but the
    // exported contract is `?[*:0]const u8` and C++ callers pass it to `fprintf` /
    // `String::fromLatin1`. Copy into a small thread-local buffer and append
    // the NUL ourselves.
    let name = <&'static str>::from(e).as_bytes();
    thread_local! {
        // `Cell<[u8; 32]>`: `[u8; 32]` is `Copy`, so we read-modify-write the
        // whole array via safe `.get()/.set()` and hand back a stable raw
        // pointer via `Cell::as_ptr()` — no `unsafe` `&mut *p` reborrow.
        static BUF: core::cell::Cell<[u8; 32]> = const { core::cell::Cell::new([0; 32]) };
    }
    BUF.with(|buf| {
        let len = name.len().min(31);
        let mut arr = buf.get();
        arr[..len].copy_from_slice(&name[..len]);
        arr[len] = 0;
        buf.set(arr);
        buf.as_ptr().cast::<core::ffi::c_char>()
    })
}

// libuv-style error constants (negated errno on posix, UV_* on Windows). The
// per-platform `bun_errno` module defines this as `mod uv_e`; re-export under
// the canonical name so callers can write `bun_sys::UV_E::NOENT`.
pub use bun_errno::uv_e as UV_E;
// `bun_errno::posix` is the small move-down stub (mode_t/E/S/errno). The full
// `std.posix` surface dependents need (`Sigaction`, `getrlimit`, `tcgetattr`,
// raw `read`/`write`/`poll`, …) is widened below in this crate's own `posix`
// module which re-exports the errno stub and layers libc on top.

/// `Maybe(T)` is just `Result<T, Error>`; keep the alias so existing call
/// sites type-check.
pub type Maybe<T> = core::result::Result<T, Error>;
pub type Result<T> = core::result::Result<T, Error>;

/// `Maybe(T)` static helpers — `.success()`, `.errno(e, tag)`,
/// `.errnoSys(rc, tag)`, as a trait over `Result<T, Error>` so call
/// sites can write `bun_sys::Result::<()>::errno_sys(rc, tag)`.
/// Windows-only paths in `windows/mod.rs` lean on these
/// for the NTSTATUS → `E` mapping.
pub trait MaybeExt: Sized {
    type T;
    /// `Maybe(T).success` — `Ok(default())`.
    fn success() -> Self
    where
        Self::T: Default;
    /// `Maybe(T).errno(e, syscall)` — `Err` from any errno-ish code.
    fn errno<C: error::IntoErrnoInt>(e: C, tag: Tag) -> Self;
    /// `Maybe(T).errnoSys(rc, syscall)` — `Some(Err(..))` if `rc` maps to an
    /// errno (NTSTATUS ≠ SUCCESS on Windows; rc == -1 / errno on POSIX).
    #[cfg(windows)]
    fn errno_sys(rc: bun_windows_sys::NTSTATUS, tag: Tag) -> Option<Self>;
}
impl<T> MaybeExt for Result<T> {
    type T = T;
    #[inline]
    fn success() -> Self
    where
        T: Default,
    {
        Ok(T::default())
    }
    #[inline]
    fn errno<C: error::IntoErrnoInt>(e: C, tag: Tag) -> Self {
        Err(Error::new(e, tag))
    }
    #[cfg(windows)]
    #[inline]
    fn errno_sys(rc: bun_windows_sys::NTSTATUS, tag: Tag) -> Option<Self> {
        if rc == bun_windows_sys::NTSTATUS::SUCCESS {
            return None;
        }
        Some(Err(Error::new(rc, tag)))
    }
}
#[cfg(windows)]
impl error::IntoErrnoInt for bun_windows_sys::NTSTATUS {
    #[inline]
    fn into_errno_int(self) -> error::Int {
        windows::translate_nt_status_to_errno(self) as error::Int
    }
}

/// For [`flock`]: advisory `flock(2)` on POSIX, mandatory `LockFileEx` on Windows; released on close.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FileLockMode {
    Shared,
    Exclusive,
}

/// What [`renameat2`] does when the destination exists.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RenameMode {
    Normal,
    /// Linux `RENAME_EXCHANGE` / macOS `RENAME_SWAP`.
    Exchange,
    /// Linux `RENAME_NOREPLACE` / macOS `RENAME_EXCL`.
    NoReplace,
}

impl RenameMode {
    /// The `renameat2(2)` / `renameatx_np` flag.
    #[inline]
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    fn int(self) -> u32 {
        #[cfg(target_os = "macos")]
        let (exchange, no_replace) = (2, 4); // <sys/stdio.h>: RENAME_SWAP, RENAME_EXCL
        #[cfg(not(target_os = "macos"))]
        let (exchange, no_replace) = (libc::RENAME_EXCHANGE as u32, libc::RENAME_NOREPLACE as u32);
        match self {
            RenameMode::Normal => 0,
            RenameMode::Exchange => exchange,
            RenameMode::NoReplace => no_replace,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Syscall tag. Newtype-over-u8; the discriminants are part of the FFI /
// cross-lang comparison surface and must stay stable.
// PORTING.md §Forbidden flags wrong-discriminants as a logic-bug.
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
    // On Windows the `O.*` constants are fixed octal, Linux-shaped values,
    // NOT MSVCRT `_O_*`. `uv::O::from_bun_o` bit-tests
    // against these exact values, so re-using `libc::O_CREAT` (0x100) etc.
    // silently dropped CREAT/EXCL/APPEND on Windows.
    #[cfg(unix)]
    pub const CREAT: i32 = libc::O_CREAT;
    #[cfg(unix)]
    pub const TRUNC: i32 = libc::O_TRUNC;
    #[cfg(unix)]
    pub const APPEND: i32 = libc::O_APPEND;
    #[cfg(unix)]
    pub const EXCL: i32 = libc::O_EXCL;
    #[cfg(windows)]
    pub const CREAT: i32 = 0o100;
    #[cfg(windows)]
    pub const EXCL: i32 = 0o200;
    #[cfg(windows)]
    pub const TRUNC: i32 = 0o1000;
    #[cfg(windows)]
    pub const APPEND: i32 = 0o2000;
    #[cfg(unix)]
    pub const NONBLOCK: i32 = libc::O_NONBLOCK;
    #[cfg(unix)]
    pub const CLOEXEC: i32 = libc::O_CLOEXEC;
    // Windows libc has no `O_NONBLOCK`/`O_CLOEXEC`; libuv ignores them. Values
    // chosen to round-trip through `uv::O::from_bun_o` without colliding with
    // the `_O_*` flags MSVCRT defines.
    #[cfg(windows)]
    pub const NONBLOCK: i32 = 0o4000;
    #[cfg(windows)]
    pub const CLOEXEC: i32 = 0o2000000;
    #[cfg(unix)]
    pub const DIRECTORY: i32 = libc::O_DIRECTORY;
    // Non-zero on Windows so `(flags & O::DIRECTORY) != 0`
    // routes `openat_windows_impl` to the directory NtCreateFile path.
    #[cfg(windows)]
    pub const DIRECTORY: i32 = 0o200000;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub const PATH: i32 = libc::O_PATH;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub const NOATIME: i32 = libc::O_NOATIME;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub const TMPFILE: i32 = libc::O_TMPFILE;
    // Windows defines these (non-zero) so the `O.PATH` /
    // `O.NOATIME` bit-tests in `openat_windows_impl` are meaningful.
    #[cfg(windows)]
    pub const PATH: i32 = 0o10000000;
    #[cfg(windows)]
    pub const NOATIME: i32 = 0o1000000;
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    pub const PATH: i32 = 0;
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    pub const NOATIME: i32 = 0;
    // Defined for every platform; Darwin-only flags map to 0
    // elsewhere so `flags & O.EVTONLY` etc. compile and are no-ops.
    #[cfg(unix)]
    pub const NOFOLLOW: i32 = libc::O_NOFOLLOW;
    #[cfg(windows)]
    pub const NOFOLLOW: i32 = 0o400000;
    #[cfg(unix)]
    pub const SYNC: i32 = libc::O_SYNC;
    // Windows has no O_SYNC/O_DSYNC; node's stringToFlags() ORs in `undefined`
    // (→ 0) there, so the 's' flag-string modifier is a no-op. Match that.
    #[cfg(windows)]
    pub const SYNC: i32 = 0;
    #[cfg(unix)]
    pub const DSYNC: i32 = libc::O_DSYNC;
    #[cfg(windows)]
    pub const DSYNC: i32 = 0;
    #[cfg(unix)]
    pub const NOCTTY: i32 = libc::O_NOCTTY;
    #[cfg(windows)]
    pub const NOCTTY: i32 = 0;
    #[cfg(windows)]
    pub const ACCMODE: i32 = 3;
    #[cfg(target_os = "macos")]
    pub const SYMLINK: i32 = libc::O_SYMLINK;
    #[cfg(not(target_os = "macos"))]
    pub const SYMLINK: i32 = 0;
    #[cfg(target_os = "macos")]
    pub const EVTONLY: i32 = libc::O_EVTONLY;
    #[cfg(not(target_os = "macos"))]
    pub const EVTONLY: i32 = 0;
    // Darwin-only: fail with ELOOP if *any* path component is a symlink, not
    // just the final one like O_NOFOLLOW. 0 elsewhere so the bit-or is a no-op.
    #[cfg(target_os = "macos")]
    pub const NOFOLLOW_ANY: i32 = libc::O_NOFOLLOW_ANY;
    #[cfg(not(target_os = "macos"))]
    pub const NOFOLLOW_ANY: i32 = 0;
}
// ──────────────────────────────────────────────────────────────────────────
// `File` / `Dir` — high-level handles. Extracted to file.rs / dir.rs.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(unix)]
pub mod close_on_fork;
pub mod file;
mod iovec;
pub use iovec::{IoVec, IoVecMut};
mod mmap;
pub use mmap::Mmap;
#[cfg(test)]
mod native_test_shims;
pub mod private_copy;
pub use file::{File, MaybeOwnedFile, ReadToEndResult};
pub mod dir;
pub use dir::*;

#[cfg(unix)]
pub type Stat = libc::stat;
/// On Windows `bun.Stat` is libuv's `uv_stat_t`.
#[cfg(windows)]
pub type Stat = bun_libuv_sys::uv_stat_t;

// ──────────────────────────────────────────────────────────────────────────
// Syscall surface — real posix libc FFI. Windows path lives in
// `windows_impl` (NT/kernel32/libuv triad) below.
// ──────────────────────────────────────────────────────────────────────────
use bun_core::ZStr;

/// Read thread-local libc errno (set by the failing syscall).
/// On Windows this reads the CRT's thread-local `_errno()`, which Win32 and
/// Winsock calls do not set — use `Win32Error::get()` / `Error::from_win32`
/// for those.
#[inline]
pub fn last_errno() -> i32 {
    bun_core::ffi::errno()
}

/// Copy `path` into a NUL-terminated buffer.
/// Returns `ENAMETOOLONG` if `path` contains an interior NUL.
#[inline]
pub fn to_posix_path(
    path: &[u8],
) -> core::result::Result<std::ffi::CString, bun_errno::SystemErrno> {
    std::ffi::CString::new(path).map_err(|_| bun_errno::SystemErrno::ENAMETOOLONG)
}

#[inline]
#[cfg(not(windows))]
fn err_with(tag: Tag) -> Error {
    Error::from_code_int(last_errno(), tag)
}
#[inline]
#[cfg(not(windows))]
fn err_with_path(tag: Tag, path: &ZStr) -> Error {
    err_with(tag).with_path(path.as_bytes())
}

// Syscall tags — discriminants are FFI-observable. Do not reorder; append-only.
impl Tag {
    pub const TODO: Tag = Tag(0);
    pub const dup: Tag = Tag(1);
    pub const access: Tag = Tag(2);
    pub const connect: Tag = Tag(3);
    pub const chmod: Tag = Tag(4);
    pub const chown: Tag = Tag(5);
    pub const clonefile: Tag = Tag(6);
    pub const close: Tag = Tag(8);
    pub const copy_file_range: Tag = Tag(9);
    pub const copyfile: Tag = Tag(10);
    pub(crate) const fchmod: Tag = Tag(11);
    pub const fchmodat: Tag = Tag(12);
    pub(crate) const fchown: Tag = Tag(13);
    pub(crate) const fcntl: Tag = Tag(14);
    pub const fdatasync: Tag = Tag(15);
    pub const fstat: Tag = Tag(16);
    pub const fstatat: Tag = Tag(17);
    pub const fsync: Tag = Tag(18);
    pub(crate) const ftruncate: Tag = Tag(19);
    #[cfg(not(windows))]
    pub(crate) const futimens: Tag = Tag(20);
    pub const getdents64: Tag = Tag(21);
    pub const getdirentries64: Tag = Tag(22);
    pub const lchmod: Tag = Tag(23);
    pub const lchown: Tag = Tag(24);
    pub const link: Tag = Tag(25);
    pub(crate) const lseek: Tag = Tag(26);
    pub const lstat: Tag = Tag(27);
    pub const lutime: Tag = Tag(28);
    pub const mkdir: Tag = Tag(29);
    pub const mkdtemp: Tag = Tag(30);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) const memfd_create: Tag = Tag(32);
    pub const mmap: Tag = Tag(33);
    #[cfg(not(windows))]
    pub(crate) const munmap: Tag = Tag(34);
    pub const open: Tag = Tag(35);
    pub(crate) const pread: Tag = Tag(36);
    pub(crate) const pwrite: Tag = Tag(37);
    pub const read: Tag = Tag(38);
    pub const readlink: Tag = Tag(39);
    pub const rename: Tag = Tag(40);
    pub(crate) const stat: Tag = Tag(41);
    pub const statfs: Tag = Tag(42);
    pub const symlink: Tag = Tag(43);
    #[cfg(not(windows))]
    pub(crate) const symlinkat: Tag = Tag(44);
    pub const unlink: Tag = Tag(45);
    pub const utime: Tag = Tag(46);
    #[cfg(not(windows))]
    pub(crate) const utimensat: Tag = Tag(47);
    pub const write: Tag = Tag(48);
    pub(crate) const getcwd: Tag = Tag(49);
    pub const chdir: Tag = Tag(51);
    #[cfg(target_os = "macos")]
    pub(crate) const fcopyfile: Tag = Tag(52);
    pub const recv: Tag = Tag(53);
    pub const send: Tag = Tag(54);
    pub const sendfile: Tag = Tag(55);
    pub const splice: Tag = Tag(57);
    pub const rmdir: Tag = Tag(58);
    pub const truncate: Tag = Tag(59);
    pub const realpath: Tag = Tag(60);
    pub const futime: Tag = Tag(61);
    pub const pidfd_open: Tag = Tag(62);
    pub const poll: Tag = Tag(63);
    pub const watch: Tag = Tag(65);
    pub const scandir: Tag = Tag(66);
    pub const kevent: Tag = Tag(67);
    pub const kqueue: Tag = Tag(68);
    pub const epoll_ctl: Tag = Tag(69);
    pub const kill: Tag = Tag(70);
    pub const waitpid: Tag = Tag(71);
    pub const posix_spawn: Tag = Tag(72);
    pub const writev: Tag = Tag(74);
    #[cfg(not(windows))]
    pub(crate) const pwritev: Tag = Tag(75);
    pub const readv: Tag = Tag(76);
    #[cfg(not(windows))]
    pub(crate) const preadv: Tag = Tag(77);
    pub const ioctl_ficlone: Tag = Tag(78);
    pub const accept: Tag = Tag(79);
    pub const bind2: Tag = Tag(80);
    pub const connect2: Tag = Tag(81);
    pub const listen: Tag = Tag(82);
    pub const pipe: Tag = Tag(83);
    pub const try_write: Tag = Tag(84);
    pub const socketpair: Tag = Tag(85);
    pub const setsockopt: Tag = Tag(86);
    pub const rm: Tag = Tag(88);
    pub const uv_spawn: Tag = Tag(89);
    pub const uv_pipe: Tag = Tag(90);
    pub const uv_tty_set_mode: Tag = Tag(91);
    pub const uv_os_homedir: Tag = Tag(93);
    pub const WriteFile: Tag = Tag(94);
    pub const NtQueryDirectoryFile: Tag = Tag(95);
    #[cfg(windows)]
    pub(crate) const NtSetInformationFile: Tag = Tag(96);
    #[cfg(windows)]
    pub(crate) const GetFinalPathNameByHandle: Tag = Tag(97);
    #[cfg(windows)]
    pub(crate) const CloseHandle: Tag = Tag(98);
    #[cfg(windows)]
    pub(crate) const SetFilePointerEx: Tag = Tag(99);
    pub const SetEndOfFile: Tag = Tag(100);
    // ── later additions — appended above the frozen range so existing
    // discriminants never shift.
    pub const dup2: Tag = Tag(101);
    #[cfg(not(windows))]
    pub(crate) const fchdir: Tag = Tag(102);
    pub const fchownat: Tag = Tag(103);
    pub(crate) const ioctl: Tag = Tag(104);
    #[cfg(not(windows))]
    pub(crate) const getrlimit: Tag = Tag(105);
    #[cfg(not(windows))]
    pub(crate) const setrlimit: Tag = Tag(106);
    pub const clone3: Tag = Tag(107);
    pub const uv_os_setpriority: Tag = Tag(108);
    pub const flock: Tag = Tag(109);
    #[cfg(not(windows))]
    pub(crate) const flistxattr: Tag = Tag(110);
    #[cfg(not(windows))]
    pub(crate) const fgetxattr: Tag = Tag(111);
    pub const epoll_create1: Tag = Tag(112);
    pub const pthread_create: Tag = Tag(113);
    pub const _open_osfhandle: Tag = Tag(114);
    pub(crate) const getsockname: Tag = Tag(115);
    #[cfg(not(windows))]
    pub(crate) const getifaddrs: Tag = Tag(116);
    pub(crate) const socket: Tag = Tag(117);
    // `inotify_init1`/`inotify_add_watch` fold under the generic `.watch`
    // tag; `INotifyWatcher.rs` spells it `.inotify`. Alias to `.watch`
    // so the JS-facing `err.syscall == "watch"` string stays node-compatible.

    /// The tag name — spelling is frozen (JS-facing
    /// `err.syscall` string; node-compat code matches on it).
    pub fn name(self) -> &'static str {
        const NAMES: [&str; 118] = [
            "TODO",
            "dup",
            "access",
            "connect",
            "chmod",
            "chown",
            "clonefile",
            "clonefileat",
            "close",
            "copy_file_range",
            "copyfile",
            "fchmod",
            "fchmodat",
            "fchown",
            "fcntl",
            "fdatasync",
            "fstat",
            "fstatat",
            "fsync",
            "ftruncate",
            "futimens",
            "getdents64",
            "getdirentries64",
            "lchmod",
            "lchown",
            "link",
            "lseek",
            "lstat",
            "lutime",
            "mkdir",
            "mkdtemp",
            "fnctl",
            "memfd_create",
            "mmap",
            "munmap",
            "open",
            "pread",
            "pwrite",
            "read",
            "readlink",
            "rename",
            "stat",
            "statfs",
            "symlink",
            "symlinkat",
            "unlink",
            "utime",
            "utimensat",
            "write",
            "getcwd",
            "getenv",
            "chdir",
            "fcopyfile",
            "recv",
            "send",
            "sendfile",
            "sendmmsg",
            "splice",
            "rmdir",
            "truncate",
            "realpath",
            "futime",
            "pidfd_open",
            "poll",
            "ppoll",
            "watch",
            "scandir",
            "kevent",
            "kqueue",
            "epoll_ctl",
            "kill",
            "waitpid",
            "posix_spawn",
            "getaddrinfo",
            "writev",
            "pwritev",
            "readv",
            "preadv",
            "ioctl_ficlone",
            "accept",
            "bind2",
            "connect2",
            "listen",
            "pipe",
            "try_write",
            "socketpair",
            "setsockopt",
            "statx",
            "rm",
            "uv_spawn",
            "uv_pipe",
            "uv_tty_set_mode",
            "uv_open_osfhandle",
            "uv_os_homedir",
            "WriteFile",
            "NtQueryDirectoryFile",
            "NtSetInformationFile",
            "GetFinalPathNameByHandle",
            "CloseHandle",
            "SetFilePointerEx",
            "SetEndOfFile",
            // port-only
            "dup2",
            "fchdir",
            "fchownat",
            "ioctl",
            "getrlimit",
            "setrlimit",
            "clone3",
            "uv_os_setpriority",
            "flock",
            "flistxattr",
            "fgetxattr",
            "epoll_create1",
            "pthread_create",
            "_open_osfhandle",
            "getsockname",
            "getifaddrs",
            "socket",
        ];
        NAMES.get(self.0 as usize).copied().unwrap_or("unknown")
    }
}
impl From<Tag> for &'static str {
    #[inline]
    fn from(t: Tag) -> &'static str {
        t.name()
    }
}

/// Max single read/write count: Linux caps at 0x7ffff000;
/// Darwin/BSD use signed 32-bit byte counts.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) const MAX_COUNT: usize = 0x7ffff000;
#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
pub(crate) const MAX_COUNT: usize = i32::MAX as usize;
#[cfg(windows)]
pub(crate) const MAX_COUNT: usize = u32::MAX as usize;

// ── libc shims with no preconditions ────────────────────────────────────────
// Every fn here takes only by-value scalars (`c_int` fd, `mode_t`, `uid_t`,
// `gid_t`, `off_t`). The kernel validates the fd and reports failure via the
// return value / `errno` — passing a bad fd is `EBADF`, never UB. Declaring
// them locally as `safe fn` (instead of routing through the `libc` crate's
// `unsafe extern fn` items) drops the per-call-site `unsafe { }` block.
#[cfg(unix)]
mod safe_libc {
    use core::ffi::c_int;
    // `close` is a libc symbol std relies on; this is an FFI import (not a
    // competing definition) with the canonical signature.
    #[allow(suspicious_runtime_symbol_definitions)]
    unsafe extern "C" {
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        pub(crate) safe fn close(fd: c_int) -> c_int;
        pub(crate) safe fn dup2(old: c_int, new: c_int) -> c_int;
        pub(crate) safe fn isatty(fd: c_int) -> c_int;
        pub(crate) safe fn fsync(fd: c_int) -> c_int;
        // `libc` does not have it for Darwin.
        pub(crate) safe fn fdatasync(fd: c_int) -> c_int;
        pub(crate) safe fn fchdir(fd: c_int) -> c_int;
        pub(crate) safe fn umask(mode: libc::mode_t) -> libc::mode_t;
        pub safe fn fchmod(fd: c_int, mode: libc::mode_t) -> c_int;
        pub(crate) safe fn fchown(fd: c_int, uid: libc::uid_t, gid: libc::gid_t) -> c_int;
        pub(crate) safe fn ftruncate(fd: c_int, len: libc::off_t) -> c_int;
        pub(crate) safe fn lseek(fd: c_int, offset: libc::off_t, whence: c_int) -> libc::off_t;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(crate) safe fn fallocate(
            fd: c_int,
            mode: c_int,
            off: libc::off_t,
            len: libc::off_t,
        ) -> c_int;
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        pub safe fn posix_fadvise(
            fd: c_int,
            offset: libc::off_t,
            len: libc::off_t,
            advice: c_int,
        ) -> c_int;
        // BSD/Linux event-queue / notification syscalls — all by-value scalars;
        // bad args → errno (`EINVAL`/`EMFILE`/…), never UB.
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        pub(crate) safe fn kqueue() -> c_int;
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        pub(crate) safe fn eventfd(initval: libc::c_uint, flags: c_int) -> c_int;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(crate) safe fn inotify_init1(flags: c_int) -> c_int;
        // bionic declares `wd` as `uint32_t`, glibc/musl as `int`; the kernel
        // ABI is the same `__s32` either way, so a `c_int` decl is ABI-correct
        // on every Linux libc.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(crate) safe fn inotify_rm_watch(fd: c_int, wd: c_int) -> c_int;
        // Out-param is `&mut [c_int; 2]` (thin pointer, non-null, valid for two
        // `c_int` writes); kernel only writes the slot and reports failure via
        // the return value — no other preconditions.
        pub(crate) safe fn pipe(fds: &mut [c_int; 2]) -> c_int;
        pub(crate) safe fn socket(domain: c_int, ty: c_int, proto: c_int) -> c_int;
        pub(crate) safe fn listen(fd: c_int, backlog: c_int) -> c_int;
        pub(crate) safe fn socketpair(
            domain: c_int,
            ty: c_int,
            proto: c_int,
            fds: &mut [c_int; 2],
        ) -> c_int;
        // `&`/`&mut` to POD `termios`/`rlimit` — non-null, valid for read/write;
        // bad fd/resource → errno (`ENOTTY`/`EINVAL`/…), never UB. `resource`
        // is ABI-`int` on every Unix (glibc's `__rlimit_resource_t` is a
        // `c_uint`-typed enum, same 32-bit register slot).
        pub(crate) safe fn tcsetattr(fd: c_int, action: c_int, t: &libc::termios) -> c_int;
        pub(crate) safe fn tcgetattr(fd: c_int, t: &mut libc::termios) -> c_int;
        pub(crate) safe fn getrlimit(resource: c_int, rlim: &mut libc::rlimit) -> c_int;
        pub(crate) safe fn setrlimit(resource: c_int, rlim: &libc::rlimit) -> c_int;
    }
}

// ── Darwin `$NOCANCEL` syscall variants
// — the plain libc symbols are pthread cancellation points; a cancelled thread
// torn down mid-syscall leaks fds / corrupts state. Bun always uses the
// non-cancellable variants on macOS (`bun.darwin.nocancel`).
#[cfg(target_os = "macos")]
mod nocancel {
    use core::ffi::c_int;
    unsafe extern "C" {
        // `open$NOCANCEL` / `openat$NOCANCEL` are VARIADIC in libc — the
        // trailing `mode_t` is read (via `va_arg`) only when `O_CREAT`/
        // `O_TMPFILE` is set. On arm64-apple, variadic args are passed on the
        // STACK, not in registers; a non-variadic 4-arg decl would pass `mode`
        // in a register libc never reads → freshly-created files get a garbage
        // mode (every `Bun.write` / `fs.writeFileSync` / extracted-archive file
        // came out unreadable). Must be `...`.
        // x86-64-macOS and the Linux syscall path tolerate the non-variadic
        // form; arm64-macOS does not.
        #[link_name = "openat$NOCANCEL"]
        pub(crate) fn openat(dirfd: c_int, path: *const libc::c_char, flags: c_int, ...) -> c_int;
        #[link_name = "read$NOCANCEL"]
        pub(crate) fn read(fd: c_int, buf: *mut libc::c_void, count: usize) -> isize;
        #[link_name = "write$NOCANCEL"]
        pub(crate) fn write(fd: c_int, buf: *const libc::c_void, count: usize) -> isize;
        #[link_name = "pread$NOCANCEL"]
        pub(crate) fn pread(
            fd: c_int,
            buf: *mut libc::c_void,
            count: usize,
            off: libc::off_t,
        ) -> isize;
        #[link_name = "pwrite$NOCANCEL"]
        pub(crate) fn pwrite(
            fd: c_int,
            buf: *const libc::c_void,
            count: usize,
            off: libc::off_t,
        ) -> isize;
        #[link_name = "pwritev$NOCANCEL"]
        pub(crate) fn pwritev(
            fd: c_int,
            iov: *const libc::iovec,
            iovcnt: c_int,
            off: libc::off_t,
        ) -> isize;
        #[link_name = "preadv$NOCANCEL"]
        pub(crate) fn preadv(
            fd: c_int,
            iov: *const libc::iovec,
            iovcnt: c_int,
            off: libc::off_t,
        ) -> isize;
        #[link_name = "readv$NOCANCEL"]
        pub(crate) fn readv(fd: c_int, iov: *const libc::iovec, iovcnt: c_int) -> isize;
        #[link_name = "writev$NOCANCEL"]
        pub(crate) fn writev(fd: c_int, iov: *const libc::iovec, iovcnt: c_int) -> isize;
        #[link_name = "recvfrom$NOCANCEL"]
        pub(crate) fn recvfrom(
            fd: c_int,
            buf: *mut libc::c_void,
            len: usize,
            flags: c_int,
            addr: *mut libc::sockaddr,
            alen: *mut libc::socklen_t,
        ) -> isize;
        #[link_name = "sendto$NOCANCEL"]
        pub(crate) fn sendto(
            fd: c_int,
            buf: *const libc::c_void,
            len: usize,
            flags: c_int,
            addr: *const libc::sockaddr,
            alen: libc::socklen_t,
        ) -> isize;
        #[link_name = "poll$NOCANCEL"]
        pub(crate) fn poll(fds: *mut libc::pollfd, nfds: libc::nfds_t, timeout: c_int) -> c_int;
        // Remaining `$NOCANCEL` variants Bun links against.
        // safe: by-value `c_int` fd; bad fd → -1/EBADF, no UB.
        #[link_name = "close$NOCANCEL"]
        pub(crate) safe fn close(fd: c_int) -> c_int;
    }
}

#[cfg(unix)]
mod posix_impl {
    use super::*;
    // Per-platform raw syscall dispatch — macOS uses `$NOCANCEL`; Linux goes
    // through rustix's linux_raw backend (no libc trampoline);
    // other POSIX falls back to libc. The Linux hot paths
    // (open/openat/read/write/close/pread/pwrite/fstat) bypass these `sys_*`
    // dispatchers entirely — see the `#[cfg(target_os = "linux")]` arms on
    // each public fn below — because rustix returns the errno in-band and we
    // don't want to round-trip through thread-local `errno`.
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    fn sys_openat(d: i32, p: &ZStr, f: i32, m: libc::c_uint) -> i32 {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `p` is NUL-terminated.
            unsafe { super::nocancel::openat(d, p.as_ptr(), f, m) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: `p` is NUL-terminated.
            unsafe { libc::openat(d, p.as_ptr(), f, m) }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    fn sys_read(fd: i32, buf: &mut [MaybeUninit<u8>]) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `buf` is writable for `buf.len()` bytes.
            unsafe { super::nocancel::read(fd, buf.as_mut_ptr().cast(), buf.len()) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: `buf` is writable for `buf.len()` bytes.
            unsafe { libc::read(fd, buf.as_mut_ptr().cast(), buf.len()) }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    fn sys_write(fd: i32, buf: &[u8]) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `buf` is readable for `buf.len()` bytes.
            unsafe { super::nocancel::write(fd, buf.as_ptr().cast(), buf.len()) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: `buf` is readable for `buf.len()` bytes.
            unsafe { libc::write(fd, buf.as_ptr().cast(), buf.len()) }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    fn sys_pread(fd: i32, buf: &mut [MaybeUninit<u8>], off: i64) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `buf` is writable for `buf.len()` bytes.
            unsafe { super::nocancel::pread(fd, buf.as_mut_ptr().cast(), buf.len(), off) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: `buf` is writable for `buf.len()` bytes.
            unsafe { libc::pread(fd, buf.as_mut_ptr().cast(), buf.len(), off) }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    fn sys_pwrite(fd: i32, buf: &[u8], off: i64) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `buf` is readable for `buf.len()` bytes.
            unsafe { super::nocancel::pwrite(fd, buf.as_ptr().cast(), buf.len(), off) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: `buf` is readable for `buf.len()` bytes.
            unsafe { libc::pwrite(fd, buf.as_ptr().cast(), buf.len(), off) }
        }
    }
    #[inline]
    fn sys_recv(fd: i32, buf: &mut [MaybeUninit<u8>], flags: i32) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `buf` is writable for `buf.len()` bytes, and the address is not asked for.
            unsafe {
                super::nocancel::recvfrom(
                    fd,
                    buf.as_mut_ptr().cast(),
                    buf.len(),
                    flags,
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                )
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: `buf` is writable for `buf.len()` bytes.
            unsafe { libc::recv(fd, buf.as_mut_ptr().cast(), buf.len(), flags) }
        }
    }
    #[inline]
    fn sys_send(fd: i32, buf: &[u8], flags: i32) -> isize {
        let (ptr, len) = (buf.as_ptr().cast(), buf.len());
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `buf` is readable for `buf.len()` bytes, and no address is given.
            unsafe { super::nocancel::sendto(fd, ptr, len, flags, core::ptr::null(), 0) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: `buf` is readable for `buf.len()` bytes.
            unsafe { libc::send(fd, ptr, len, flags) }
        }
    }
    // EINTR-retry: every wrapper loops on EINTR (matching libuv) except
    // `close` (see `close`). `$NOCANCEL` only opts out of pthread
    // cancellation points; it does not affect EINTR.
    macro_rules! check {
        ($rc:expr, $tag:expr) => {{
            loop {
                let rc = $rc;
                if rc < 0 {
                    let e = last_errno();
                    if e == libc::EINTR {
                        continue;
                    }
                    return Err(Error::from_code_int(e, $tag));
                }
                break rc;
            }
        }};
    }
    macro_rules! check_p {
        ($rc:expr, $tag:expr, $path:expr) => {{
            loop {
                let rc = $rc;
                if rc < 0 {
                    let e = last_errno();
                    if e == libc::EINTR {
                        continue;
                    }
                    return Err(Error::from_code_int(e, $tag).with_path($path.as_bytes()));
                }
                break rc;
            }
        }};
    }
    // Attaches BOTH `.fd` and `.path`.
    macro_rules! check_fp {
        ($rc:expr, $tag:expr, $fd:expr, $path:expr) => {{
            loop {
                let rc = $rc;
                if rc < 0 {
                    let e = last_errno();
                    if e == libc::EINTR {
                        continue;
                    }
                    return Err(Error::from_code_int(e, $tag)
                        .with_fd($fd)
                        .with_path($path.as_bytes()));
                }
                break rc;
            }
        }};
    }

    #[inline]
    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        // `open()` is `openat(.cwd(), ..)` on every POSIX target
        // ("this is what open() does anyway"): `openat(AT_FDCWD, ..)` on
        // Linux/FreeBSD, `openat$NOCANCEL(AT_FDCWD, ..)` on Darwin.
        openat(Fd::cwd(), path, flags, mode)
    }
    /// Always `O_CLOEXEC`. A child gets a descriptor only through the spawn path.
    pub fn openat(dir: impl AsFd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        let dir = dir.as_fd();
        let flags = flags | O::CLOEXEC;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            super::linux_syscall::openat(dir, path, flags, mode)
                .map_err(|e| Error::from_code_int(e, Tag::open).with_path(path.as_bytes()))
        }
        // macOS: `openat$NOCANCEL`, retried on EINTR.
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let rc = check_p!(
                sys_openat(dir.native(), path, flags, mode as libc::c_uint),
                Tag::open,
                path
            );
            Ok(Fd::from_native(rc))
        }
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn openat2_beneath(dir: impl AsFd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        use super::linux_syscall::ResolveFlags;
        let dir = dir.as_fd();
        let flags = flags | O::CLOEXEC;
        super::linux_syscall::openat2(dir, path, flags, mode, ResolveFlags::BENEATH)
            .map_err(|e| Error::from_code_int(e, Tag::open).with_path(path.as_bytes()))
    }
    /// `None` on kernels without `openat2` and when seccomp blocks it, which is remembered.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn openat2_if_available(
        dir: Fd,
        path: &ZStr,
        flags: i32,
        mode: Mode,
        resolve: super::linux_syscall::ResolveFlags,
    ) -> Option<core::result::Result<Fd, i32>> {
        use core::sync::atomic::{AtomicBool, Ordering};
        static UNAVAILABLE: AtomicBool = AtomicBool::new(false);

        if UNAVAILABLE.load(Ordering::Relaxed) {
            return None;
        }
        let flags = flags | O::CLOEXEC;
        // A rename or mount anywhere on the system while a symlink's `..` resolves is `EAGAIN`.
        const EAGAIN_ATTEMPTS: u32 = 4;
        let mut result = Err(libc::EAGAIN);
        for _ in 0..EAGAIN_ATTEMPTS {
            result = super::linux_syscall::openat2(dir, path, flags, mode, resolve);
            if !matches!(result, Err(libc::EAGAIN)) {
                break;
            }
        }
        match result {
            Err(e @ (libc::ENOSYS | libc::EPERM | libc::EINVAL | libc::E2BIG)) => {
                let probe = super::linux_syscall::openat2(
                    dir,
                    bun_core::zstr!("."),
                    O::PATH | O::DIRECTORY | O::CLOEXEC,
                    0,
                    resolve,
                );
                match probe {
                    Err(libc::ENOSYS | libc::EPERM | libc::EINVAL | libc::E2BIG) => {
                        UNAVAILABLE.store(true, Ordering::Relaxed);
                        None
                    }
                    other => {
                        if let Ok(fd) = other {
                            let _ = close(fd);
                        }
                        Some(Err(e))
                    }
                }
            }
            result => Some(result),
        }
    }
    pub fn close(fd: Fd) -> Maybe<()> {
        // Call close ONCE; never retry on EINTR (Linux may have already
        // released the fd, retrying would close someone else's). Only EBADF surfaces.
        // Darwin uses `close$NOCANCEL` (avoid pthread cancellation point).
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return match super::linux_syscall::close(fd.native()) {
                Err(e) if e == libc::EBADF => {
                    Err(Error::from_code_int(libc::EBADF, Tag::close).with_fd(fd))
                }
                _ => Ok(()),
            };
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            #[cfg(target_os = "macos")]
            let rc = super::nocancel::close(fd.native());
            #[cfg(not(target_os = "macos"))]
            let rc = safe_libc::close(fd.native());
            if rc < 0 && last_errno() == libc::EBADF {
                return Err(Error::from_code_int(libc::EBADF, Tag::close).with_fd(fd));
            }
            Ok(())
        }
    }
    pub(crate) fn read_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>]) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            super::linux_syscall::read(fd, &mut buf[..len])
                .map_err(|e| Error::from_code_int(e, Tag::read))
        }
        // macOS: `read$NOCANCEL`, retried on EINTR.
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let n = check!(sys_read(fd.native(), &mut buf[..len]), Tag::read);
            Ok(n as usize)
        }
    }
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            super::linux_syscall::write(fd, &buf[..len])
                .map_err(|e| Error::from_code_int(e, Tag::write))
        }
        // macOS: `write$NOCANCEL`, retried on EINTR.
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let n = check!(sys_write(fd.native(), &buf[..len]), Tag::write);
            Ok(n as usize)
        }
    }
    pub(crate) fn pread_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>], off: i64) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return super::linux_syscall::pread(fd, &mut buf[..len], off)
                .map_err(|e| Error::from_code_int(e, Tag::pread));
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let n = check!(sys_pread(fd.native(), &mut buf[..len], off), Tag::pread);
            Ok(n as usize)
        }
    }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return super::linux_syscall::pwrite(fd, &buf[..len], off)
                .map_err(|e| Error::from_code_int(e, Tag::pwrite));
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let n = check!(sys_pwrite(fd.native(), &buf[..len], off), Tag::pwrite);
            Ok(n as usize)
        }
    }
    pub fn stat(path: &ZStr) -> Maybe<Stat> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return super::linux_syscall::stat(path)
                .map_err(|e| Error::from_code_int(e, Tag::stat).with_path(path.as_bytes()));
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check_p!(
                // SAFETY: `path` is NUL-terminated; `st` is a valid out-param.
                unsafe { libc::stat(path.as_ptr(), st.as_mut_ptr()) },
                Tag::stat,
                path
            );
            // SAFETY: rc == 0 ⇒ kernel populated `st`.
            Ok(unsafe { st.assume_init() })
        }
    }
    pub fn fstat(fd: Fd) -> Maybe<Stat> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return super::linux_syscall::fstat(fd)
                .map_err(|e| Error::from_code_int(e, Tag::fstat));
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check!(
                // SAFETY: `fd` is a live descriptor; `st` is a valid out-param.
                unsafe { libc::fstat(fd.native(), st.as_mut_ptr()) },
                Tag::fstat
            );
            // SAFETY: rc == 0 ⇒ kernel populated `st`.
            Ok(unsafe { st.assume_init() })
        }
    }
    pub fn lstat(path: &ZStr) -> Maybe<Stat> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return super::linux_syscall::lstat(path)
                .map_err(|e| Error::from_code_int(e, Tag::lstat).with_path(path.as_bytes()));
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check_p!(
                // SAFETY: `path` is NUL-terminated; `st` is a valid out-param.
                unsafe { libc::lstat(path.as_ptr(), st.as_mut_ptr()) },
                Tag::lstat,
                path
            );
            // SAFETY: rc == 0 ⇒ kernel populated `st`.
            Ok(unsafe { st.assume_init() })
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // statx (Linux ≥4.11). Exposes `birthtime` for node:fs
    // `Stats`. On non-Linux these are absent (callers gate on `cfg(linux)`).
    //
    // We use `libc::statx`, which the `libc` crate
    // only exposes for glibc/Android (and musl behind the build-time
    // `musl_v1_2_3` cfg the cross-compile build never sets). The `linux_statx`
    // shim below smooths that over: glibc re-exports `libc`; musl and Android
    // (bionic only added the `statx()` libc wrapper at API 30, we link against
    // 28) get a hand-rolled struct + raw-`syscall(SYS_statx, …)` wrapper. The
    // kernel ABI (struct layout, `STATX_*` bits) is identical across libcs.
    // ──────────────────────────────────────────────────────────────────────
    #[cfg(any(target_os = "linux", target_os = "android"))]
    mod linux_statx {
        // glibc: libc 0.2.x exposes the full surface directly.
        #[cfg(all(target_os = "linux", not(target_env = "musl")))]
        pub(super) use libc::{
            STATX_ATIME, STATX_BLOCKS, STATX_BTIME, STATX_CTIME, STATX_GID, STATX_INO, STATX_MODE,
            STATX_MTIME, STATX_NLINK, STATX_SIZE, STATX_TYPE, STATX_UID, statx,
        };

        // musl/Android: `libc` gates `statx`/`STATX_*` behind a build-script
        // `musl_v1_2_3` cfg that cross-compiles can't trigger, and bionic's
        // `statx()` wrapper requires API 30. Define the kernel-ABI struct +
        // bits ourselves and dispatch via raw `syscall` — works on every
        // Linux ABI.
        #[cfg(any(target_env = "musl", target_os = "android"))]
        mod raw {
            use core::ffi::{c_char, c_int, c_uint};

            // Kernel UAPI `<linux/stat.h>` — same on every arch/libc.
            pub(crate) const STATX_TYPE: c_uint = 0x0001;
            pub(crate) const STATX_MODE: c_uint = 0x0002;
            pub(crate) const STATX_NLINK: c_uint = 0x0004;
            pub(crate) const STATX_UID: c_uint = 0x0008;
            pub(crate) const STATX_GID: c_uint = 0x0010;
            pub(crate) const STATX_ATIME: c_uint = 0x0020;
            pub(crate) const STATX_MTIME: c_uint = 0x0040;
            pub(crate) const STATX_CTIME: c_uint = 0x0080;
            pub(crate) const STATX_INO: c_uint = 0x0100;
            pub(crate) const STATX_SIZE: c_uint = 0x0200;
            pub(crate) const STATX_BLOCKS: c_uint = 0x0400;
            pub(crate) const STATX_BTIME: c_uint = 0x0800;

            #[repr(C)]
            #[derive(Copy, Clone)]
            pub(crate) struct statx_timestamp {
                pub tv_sec: i64,
                pub tv_nsec: u32,
                __pad: i32,
            }

            // `struct statx` from `<linux/stat.h>` — fixed 256-byte layout the
            // kernel writes. Only the fields `statx_impl` reads are named; the
            // rest is reserved padding.
            #[repr(C)]
            #[derive(Copy, Clone)]
            pub(crate) struct statx {
                pub stx_mask: u32,
                pub stx_blksize: u32,
                pub stx_attributes: u64,
                pub stx_nlink: u32,
                pub stx_uid: u32,
                pub stx_gid: u32,
                pub stx_mode: u16,
                __pad0: [u16; 1],
                pub stx_ino: u64,
                pub stx_size: u64,
                pub stx_blocks: u64,
                pub stx_attributes_mask: u64,
                pub stx_atime: statx_timestamp,
                pub stx_btime: statx_timestamp,
                pub stx_ctime: statx_timestamp,
                pub stx_mtime: statx_timestamp,
                pub stx_rdev_major: u32,
                pub stx_rdev_minor: u32,
                pub stx_dev_major: u32,
                pub stx_dev_minor: u32,
                __pad1: [u64; 14],
            }
            const _: () = assert!(core::mem::size_of::<statx>() == 256);

            /// Raw `statx(2)` via syscall — returns `0` on success or `-1` with
            /// `errno` set, matching the libc wrapper's contract so callers
            /// don't need to know which path they got.
            ///
            /// # Safety
            /// `path` must be NUL-terminated and live for the call; `buf` must
            /// be a valid out-pointer to a `statx`.
            pub(crate) unsafe fn statx(
                dirfd: c_int,
                path: *const c_char,
                flags: c_int,
                mask: c_uint,
                buf: *mut statx,
            ) -> c_int {
                // SAFETY: caller upholds pointer validity; syscall arg widths
                // match the kernel's `statx(2)` ABI on every 64-bit arch.
                unsafe { libc::syscall(libc::SYS_statx, dirfd, path, flags, mask, buf) as c_int }
            }
        }
        #[cfg(any(target_env = "musl", target_os = "android"))]
        pub(super) use raw::*;
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    use linux_statx as lx;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub static SUPPORTS_STATX_ON_LINUX: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(true);
    /// Like `SUPPORTS_STATX_ON_LINUX`, but false once the `fstat()` of some descriptor is overridden.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub static IS_FSTATX_DIRECT: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(true);

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn stop_using_statx() {
        use core::sync::atomic::Ordering;
        SUPPORTS_STATX_ON_LINUX.store(false, Ordering::Relaxed);
        IS_FSTATX_DIRECT.store(false, Ordering::Relaxed);
    }

    /// `STATX_*` request mask covering every field `node:fs Stats` consumes
    /// (all field bits OR'd — the only mask callers ever pass).
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub const STATX_MASK_FOR_STATS: u32 = lx::STATX_TYPE
        | lx::STATX_MODE
        | lx::STATX_NLINK
        | lx::STATX_UID
        | lx::STATX_GID
        | lx::STATX_ATIME
        | lx::STATX_MTIME
        | lx::STATX_CTIME
        | lx::STATX_BTIME
        | lx::STATX_INO
        | lx::STATX_SIZE
        | lx::STATX_BLOCKS;

    /// Linux kernel makedev encoding (glibc sys/sysmacros.h / <linux/kdev_t.h>).
    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[inline]
    const fn statx_makedev(major: u32, minor: u32) -> u64 {
        let maj: u64 = (major & 0xFFF) as u64;
        let min: u64 = (minor & 0xFFFFF) as u64;
        (maj << 8) | (min & 0xFF) | ((min & 0xFFF00) << 12)
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn statx_fallback(fd: Fd, path: Option<&ZStr>, flags: c_int) -> Maybe<PosixStat> {
        if let Some(p) = path {
            let r = if flags & libc::AT_SYMLINK_NOFOLLOW != 0 {
                lstat(p)
            } else {
                stat(p)
            };
            r.map(|s| PosixStat::init(&s))
        } else {
            fstat(fd).map(|s| PosixStat::init(&s))
        }
    }

    // `syscall` is the JS-facing `err.syscall` tag (`stat`/`lstat`/`fstat`):
    // node reports the operation name, never the `statx(2)` implementation
    // detail, and the non-statx fallback below already uses those same tags.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn statx_impl(
        fd: Fd,
        path: Option<&ZStr>,
        flags: c_int,
        mask: u32,
        syscall: Tag,
    ) -> Maybe<PosixStat> {
        let mut buf = core::mem::MaybeUninit::<lx::statx>::uninit();
        let pathname: *const c_char = match path {
            Some(p) => p.as_ptr(),
            None => c"".as_ptr(),
        };
        loop {
            // SAFETY: `pathname` is NUL-terminated; `buf` is a valid out-param.
            let rc = unsafe { lx::statx(fd.native(), pathname, flags, mask, buf.as_mut_ptr()) };

            // On some setups (QEMU user-mode, S390 RHEL docker), statx returns a
            // positive value other than 0 with errno unset — neither a normal
            // success (0) nor a kernel -errno. Treat as "not implemented".
            // See nodejs/node#27275 and libuv/libuv src/unix/fs.c.
            if rc > 0 {
                stop_using_statx();
                return statx_fallback(fd, path, flags);
            }
            if rc < 0 {
                let raw_errno = last_errno();
                let errno = SystemErrno::init(raw_errno as _);
                // Retry on EINTR.
                if errno == Some(E::EINTR) {
                    continue;
                }
                // Fall back on the same errnos libuv does (deps/uv/src/unix/fs.c):
                //   ENOSYS:     kernel < 4.11
                //   EOPNOTSUPP: filesystem doesn't support it
                //   EPERM:      seccomp filter rejects statx (libseccomp < 2.3.3,
                //               docker < 18.04, various CI sandboxes)
                //   EINVAL:     old Android builds
                if matches!(
                    errno,
                    Some(E::ENOSYS | E::EOPNOTSUPP | E::EPERM | E::EINVAL)
                ) {
                    stop_using_statx();
                    return statx_fallback(fd, path, flags);
                }
                return Err(Error {
                    errno: raw_errno as _,
                    syscall,
                    ..Default::default()
                });
            }

            // SAFETY: rc == 0 ⇒ kernel populated the buffer.
            let buf = unsafe { buf.assume_init() };
            return Ok(PosixStat {
                dev: statx_makedev(buf.stx_dev_major, buf.stx_dev_minor),
                ino: buf.stx_ino,
                mode: buf.stx_mode as u64,
                nlink: buf.stx_nlink as u64,
                uid: buf.stx_uid as u64,
                gid: buf.stx_gid as u64,
                rdev: statx_makedev(buf.stx_rdev_major, buf.stx_rdev_minor),
                size: buf.stx_size,
                blksize: buf.stx_blksize as u64,
                blocks: buf.stx_blocks,
                atim: Timespec {
                    sec: buf.stx_atime.tv_sec,
                    nsec: buf.stx_atime.tv_nsec as i64,
                },
                mtim: Timespec {
                    sec: buf.stx_mtime.tv_sec,
                    nsec: buf.stx_mtime.tv_nsec as i64,
                },
                ctim: Timespec {
                    sec: buf.stx_ctime.tv_sec,
                    nsec: buf.stx_ctime.tv_nsec as i64,
                },
                birthtim: if buf.stx_mask & lx::STATX_BTIME != 0 {
                    Timespec {
                        sec: buf.stx_btime.tv_sec,
                        nsec: buf.stx_btime.tv_nsec as i64,
                    }
                } else {
                    Timespec { sec: 0, nsec: 0 }
                },
            });
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn fstatx(fd: Fd, mask: u32) -> Maybe<PosixStat> {
        statx_impl(fd, None, libc::AT_EMPTY_PATH, mask, Tag::fstat)
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn statx(path: &ZStr, mask: u32) -> Maybe<PosixStat> {
        statx_impl(
            Fd::from_native(libc::AT_FDCWD),
            Some(path),
            0,
            mask,
            Tag::stat,
        )
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn lstatx(path: &ZStr, mask: u32) -> Maybe<PosixStat> {
        statx_impl(
            Fd::from_native(libc::AT_FDCWD),
            Some(path),
            libc::AT_SYMLINK_NOFOLLOW,
            mask,
            Tag::lstat,
        )
    }

    pub fn mkdir(path: &ZStr, mode: Mode) -> Maybe<()> {
        check_p!(
            // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
            unsafe { libc::mkdir(path.as_ptr(), mode as libc::mode_t) },
            Tag::mkdir,
            path
        );
        Ok(())
    }
    pub fn mkdirat(dir: impl AsFd, path: &ZStr, mode: Mode) -> Maybe<()> {
        let dir = dir.as_fd();
        // Tag errors as `.mkdir` (not `.mkdirat`).
        check_p!(
            // SAFETY: `dir` is a live fd (or AT_FDCWD); `ZStr::as_ptr()` is a
            // valid NUL-terminated C string.
            unsafe { libc::mkdirat(dir.native(), path.as_ptr(), mode as libc::mode_t) },
            Tag::mkdir,
            path
        );
        Ok(())
    }
    /// `bun.makePath` — `mkdirat` walking up parents on ENOENT, like `mkdir -p`.
    #[inline]
    pub(crate) fn mkdir_recursive_at(dir: impl AsFd, sub_path: &[u8]) -> Maybe<()> {
        let dir = dir.as_fd();
        mkdir_recursive_at_mode(dir, sub_path, 0o755)
    }
    /// `mkdir_recursive_at` with an explicit `mode` for created directories
    /// (matches `bun.api.node.fs.NodeFS.mkdirRecursive`'s `mode` arg).
    pub fn mkdir_recursive_at_mode(dir: Fd, sub_path: &[u8], mode: Mode) -> Maybe<()> {
        mkdir_recursive_with(sub_path, |p| match bun_paths::Path::from(p).check_len() {
            Ok(path) => mkdirat(dir, &path, mode),
            // The OS stops at a NUL, so it may not refuse this.
            Err(_) => Err(Error::from_code(E::ENAMETOOLONG, Tag::mkdir).with_path(sub_path)),
        })
    }
    pub fn unlink(path: &ZStr) -> Maybe<()> {
        // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
        check_p!(unsafe { libc::unlink(path.as_ptr()) }, Tag::unlink, path);
        Ok(())
    }
    pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
        check_p!(
            // SAFETY: both `ZStr`s are valid NUL-terminated C strings.
            unsafe { libc::rename(from.as_ptr(), to.as_ptr()) },
            Tag::rename,
            from
        );
        Ok(())
    }
    pub fn renameat(from_dir: impl AsFd, from: &ZStr, to_dir: impl AsFd, to: &ZStr) -> Maybe<()> {
        let from_dir = from_dir.as_fd();
        let to_dir = to_dir.as_fd();
        check_p!(
            // SAFETY: both dir fds are live (or AT_FDCWD); both `ZStr`s are
            // valid NUL-terminated C strings.
            unsafe {
                libc::renameat(
                    from_dir.native(),
                    from.as_ptr(),
                    to_dir.native(),
                    to.as_ptr(),
                )
            },
            Tag::rename,
            from
        );
        Ok(())
    }
    /// `renameat2(2)` (Linux) / `renameatx_np` (macOS). FreeBSD and any other
    /// unix without an atomic-exchange rename get `ENOSYS` for any other mode than `Normal`.
    pub fn renameat2(
        from_dir: Fd,
        from: &ZStr,
        to_dir: Fd,
        to: &ZStr,
        mode: RenameMode,
    ) -> Maybe<()> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            check_p!(
                // SAFETY: both dir fds are live (or AT_FDCWD); both `ZStr`s
                // are valid NUL-terminated C strings for the syscall's duration.
                unsafe {
                    libc::syscall(
                        libc::SYS_renameat2,
                        from_dir.native() as libc::c_long,
                        from.as_ptr(),
                        to_dir.native() as libc::c_long,
                        to.as_ptr(),
                        mode.int() as libc::c_long,
                    )
                },
                Tag::rename,
                from
            );
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" {
                fn renameatx_np(
                    fromfd: libc::c_int,
                    from: *const libc::c_char,
                    tofd: libc::c_int,
                    to: *const libc::c_char,
                    flags: libc::c_uint,
                ) -> libc::c_int;
            }
            check_p!(
                // SAFETY: FFI; all pointers/fds valid for the duration of the call.
                unsafe {
                    renameatx_np(
                        from_dir.native(),
                        from.as_ptr(),
                        to_dir.native(),
                        to.as_ptr(),
                        mode.int(),
                    )
                },
                Tag::rename,
                from
            );
            return Ok(());
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        {
            if mode != RenameMode::Normal {
                return Err(
                    Error::from_code_int(libc::ENOSYS, Tag::rename).with_path(from.as_bytes())
                );
            }
            renameat(from_dir, from, to_dir, to)
        }
    }
    /// `unlinkat` with explicit `flags` (e.g. `AT_REMOVEDIR`). The error is
    /// built so the surfaced `SystemError` carries BOTH the dirfd and the path.
    pub(crate) fn unlinkat_with_flags(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()> {
        check_fp!(
            // SAFETY: `dir` is a live fd (or AT_FDCWD); `ZStr::as_ptr()` is a
            // valid NUL-terminated C string.
            unsafe { libc::unlinkat(dir.native(), path.as_ptr(), flags) },
            Tag::unlink,
            dir,
            path
        );
        Ok(())
    }
    /// 2-arg form (`flags = 0`); the 3-arg variant is `unlinkat_with_flags`.
    #[inline]
    pub fn unlinkat(dir: impl AsFd, path: &ZStr) -> Maybe<()> {
        let dir = dir.as_fd();
        unlinkat_with_flags(dir, path, 0)
    }
    pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
        check_p!(
            // SAFETY: both `ZStr`s are valid NUL-terminated C strings.
            unsafe { libc::symlink(target.as_ptr(), link.as_ptr()) },
            Tag::symlink,
            link
        );
        Ok(())
    }
    pub fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let n = check_p!(
            // SAFETY: `path` is NUL-terminated (`ZStr`); `buf` is a valid
            // exclusive slice and `readlink` writes at most `buf.len()` bytes.
            unsafe { libc::readlink(path.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) },
            Tag::readlink,
            path
        );
        let n = n as usize;
        // Truncation guard + NUL-terminate.
        if n >= buf.len() {
            return Err(
                Error::from_code_int(libc::ENAMETOOLONG, Tag::readlink).with_path(path.as_bytes())
            );
        }
        buf[n] = 0;
        Ok(n)
    }
    /// `fcntl(F_DUPFD_CLOEXEC, 0)` so the dup'd fd doesn't leak
    /// to children. NOT `dup(2)` (which lacks CLOEXEC).
    pub fn dup(fd: Fd) -> Maybe<Fd> {
        dup_at_least(fd, 0)
    }
    /// `fcntl(F_DUPFD_CLOEXEC, min)`: the new descriptor is the lowest free one >= `min`.
    pub fn dup_at_least(fd: Fd, min: i32) -> Maybe<Fd> {
        fcntl(fd, Fcntl::DupFdCloexec, min as isize).map(|rc| Fd::from_native(rc as i32))
    }
    /// A descriptor created while fd 0, 1 or 2 is closed gets that number, where [`FdExt::close`] skips it and a spawned child inherits it as stdio. Returns its duplicate at 3 or higher (same `FD_CLOEXEC` state) with `fd` closed, or `fd` itself when it is above stdio already or no higher number is free.
    pub(crate) fn move_above_stdio(fd: Fd) -> Fd {
        if fd.stdio_tag().is_none() {
            return fd;
        }
        let moved = fcntl(fd, Fcntl::GetFd, 0).and_then(|flags| {
            let dup = if flags & libc::FD_CLOEXEC as isize != 0 {
                Fcntl::DupFdCloexec
            } else {
                Fcntl::DupFd
            };
            fcntl(fd, dup, 3)
        });
        match moved {
            Ok(rc) => {
                let _ = fd.close_allowing_standard_io(None);
                Fd::from_native(rc as i32)
            }
            // At the descriptor limit the creator still succeeds, as it did before the move existed.
            Err(_) => fd,
        }
    }
    pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
        check!(
            safe_libc::fchmod(fd.native(), mode as libc::mode_t),
            Tag::fchmod
        );
        Ok(())
    }
    pub fn fchown(fd: Fd, uid: u32, gid: u32) -> Maybe<()> {
        check!(safe_libc::fchown(fd.native(), uid, gid), Tag::fchown);
        Ok(())
    }
    /// What `call` writes. It is given a buffer and its length, or null and 0: then it returns how long one has to be.
    fn filled(tag: Tag, mut call: impl FnMut(*mut libc::c_void, usize) -> isize) -> Maybe<Vec<u8>> {
        let size = check!(call(core::ptr::null_mut(), 0), tag) as usize;
        let mut buffer = vec![0u8; size];
        if size > 0 {
            let written = check!(call(buffer.as_mut_ptr().cast(), size), tag) as usize;
            buffer.truncate(written);
        }
        Ok(buffer)
    }
    /// The extended attributes of an open file, by name, each with its value. On Linux its ACL and its SELinux label are
    /// among them. On FreeBSD: those of the namespace `user`. None on a file system that has none.
    pub fn extended_attributes(fd: Fd) -> Maybe<Vec<(Vec<u8>, Vec<u8>)>> {
        let fd = fd.native();
        let listed = filled(Tag::flistxattr, |list, size| {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // SAFETY: `filled` passes `size` writable bytes, or null and 0.
                unsafe { libc::flistxattr(fd, list.cast(), size) }
            }
            #[cfg(target_os = "macos")]
            {
                // SAFETY: `filled` passes `size` writable bytes, or null and 0.
                unsafe { libc::flistxattr(fd, list.cast(), size, 0) }
            }
            #[cfg(target_os = "freebsd")]
            {
                // SAFETY: `filled` passes `size` writable bytes, or null and 0.
                unsafe { libc::extattr_list_fd(fd, libc::EXTATTR_NAMESPACE_USER, list, size) }
            }
        });
        let listed = match listed {
            Ok(listed) => listed,
            Err(error) if [libc::ENOTSUP, libc::EOPNOTSUPP].contains(&i32::from(error.errno)) => {
                return Ok(Vec::new());
            }
            Err(error) => return Err(error),
        };
        // Each ends with a NUL.
        #[cfg(not(target_os = "freebsd"))]
        let names: Vec<&[u8]> = bun_core::strings::split(&listed, b"\0").collect();
        // Each follows its length.
        #[cfg(target_os = "freebsd")]
        let names: Vec<&[u8]> = {
            let (mut names, mut rest) = (Vec::new(), &listed[..]);
            while let [length, after @ ..] = rest {
                let (name, more) = after.split_at(usize::from(*length).min(after.len()));
                names.push(name);
                rest = more;
            }
            names
        };
        let mut attributes = Vec::with_capacity(names.len());
        for name in names.into_iter().filter(|name| !name.is_empty()) {
            let Ok(terminated) = std::ffi::CString::new(name) else {
                continue;
            };
            let value = filled(Tag::fgetxattr, |value, size| {
                let name = terminated.as_ptr();
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    // SAFETY: `name` ends with a NUL. `filled` passes `size` writable bytes, or null and 0.
                    unsafe { libc::fgetxattr(fd, name, value, size) }
                }
                #[cfg(target_os = "macos")]
                {
                    // SAFETY: `name` ends with a NUL. `filled` passes `size` writable bytes, or null and 0.
                    unsafe { libc::fgetxattr(fd, name, value, size, 0, 0) }
                }
                #[cfg(target_os = "freebsd")]
                {
                    // SAFETY: `name` ends with a NUL. `filled` passes `size` writable bytes, or null and 0.
                    unsafe {
                        libc::extattr_get_fd(fd, libc::EXTATTR_NAMESPACE_USER, name, value, size)
                    }
                }
            })?;
            attributes.push((name.to_vec(), value));
        }
        attributes.sort_unstable();
        Ok(attributes)
    }
    pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()> {
        check!(safe_libc::ftruncate(fd.native(), len), Tag::ftruncate);
        Ok(())
    }
    pub fn truncate(path: &ZStr, len: i64) -> Maybe<()> {
        check_p!(
            // SAFETY: `path` is NUL-terminated.
            unsafe { libc::truncate(path.as_ptr(), len) },
            Tag::truncate,
            path
        );
        Ok(())
    }
    /// `template` ends with `XXXXXX` and a NUL. Returns the name of the new directory.
    pub fn mkdtemp(template: &mut [u8]) -> Maybe<&[u8]> {
        let len = ZStr::from_slice_with_nul(template).len();
        // SAFETY: it ends with a NUL, and libc only replaces bytes in front of the first one.
        while unsafe { libc::mkdtemp(template.as_mut_ptr().cast()) }.is_null() {
            match last_errno() {
                // libc leaves the name that it tried.
                libc::EINTR => template[len - 6..len].fill(b'X'),
                e => return Err(Error::from_code_int(e, Tag::mkdtemp).with_path(&template[..len])),
            }
        }
        Ok(&template[..len])
    }
    /// `Ok(false)` when `nonblocking` and the lock is held elsewhere.
    pub fn flock(fd: Fd, mode: FileLockMode, nonblocking: bool) -> Maybe<bool> {
        let op = match mode {
            FileLockMode::Shared => libc::LOCK_SH,
            FileLockMode::Exclusive => libc::LOCK_EX,
        } | if nonblocking { libc::LOCK_NB } else { 0 };
        loop {
            // SAFETY: `fd` is a live descriptor; `op` is a valid flock op.
            if unsafe { libc::flock(fd.native(), op) } == 0 {
                return Ok(true);
            }
            match last_errno() {
                libc::EINTR => continue,
                libc::EWOULDBLOCK if nonblocking => return Ok(false),
                e => return Err(Error::from_code_int(e, Tag::flock).with_fd(fd)),
            }
        }
    }
    pub fn getcwd(buf: &mut [u8]) -> Maybe<usize> {
        // SAFETY: `buf` is a valid exclusive slice; `getcwd` writes at most
        // `buf.len()` bytes (including the NUL).
        let p = unsafe { libc::getcwd(buf.as_mut_ptr().cast(), buf.len()) };
        if p.is_null() {
            return Err(err_with(Tag::getcwd));
        }
        // SAFETY: on success `getcwd` returns `buf`'s pointer NUL-terminated.
        Ok(unsafe { libc::strlen(p) })
    }

    // ── link/perm/time/access group ──
    /// Unlike [`linkat`], it follows a symlink at `src` on macOS and FreeBSD.
    pub fn link(src: &ZStr, dest: &ZStr) -> Maybe<()> {
        check_p!(
            // SAFETY: both are NUL-terminated.
            unsafe { libc::link(src.as_ptr(), dest.as_ptr()) },
            Tag::link,
            src
        );
        Ok(())
    }
    pub fn linkat(src_dir: impl AsFd, src: &ZStr, dest_dir: impl AsFd, dest: &ZStr) -> Maybe<()> {
        let src_dir = src_dir.as_fd();
        let dest_dir = dest_dir.as_fd();
        // Tags as `.link`.
        check_p!(
            // SAFETY: both dir fds are live (or AT_FDCWD); both `ZStr`s are
            // valid NUL-terminated C strings.
            unsafe {
                libc::linkat(
                    src_dir.native(),
                    src.as_ptr(),
                    dest_dir.native(),
                    dest.as_ptr(),
                    0,
                )
            },
            Tag::link,
            src
        );
        Ok(())
    }
    /// Materialize an `O_TMPFILE` fd. Fast path
    /// uses `linkat(tmpfd, "", dirfd, name, AT_EMPTY_PATH)` (requires
    /// CAP_DAC_READ_SEARCH); falls back to `/proc/self/fd/N` + AT_SYMLINK_FOLLOW.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn linkat_tmpfile(tmpfd: Fd, dirfd: Fd, name: &ZStr) -> Maybe<()> {
        // 0=unknown, 1=have CAP_DAC_READ_SEARCH, -1=no cap → use /proc fallback.
        static CAP_STATUS: core::sync::atomic::AtomicI32 = core::sync::atomic::AtomicI32::new(0);
        loop {
            let status = CAP_STATUS.load(core::sync::atomic::Ordering::Relaxed);
            let rc = if status != -1 {
                // SAFETY: tmpfd/dirfd valid; "" with AT_EMPTY_PATH names tmpfd itself.
                unsafe {
                    libc::linkat(
                        tmpfd.native(),
                        c"".as_ptr(),
                        dirfd.native(),
                        name.as_ptr(),
                        libc::AT_EMPTY_PATH,
                    )
                }
            } else {
                let mut buf = [0u8; 32];
                let proc_path = fd_path_z(b"/proc/self/fd/", tmpfd, &mut buf);
                // SAFETY: `proc_path` is NUL-terminated; dirfd valid.
                unsafe {
                    libc::linkat(
                        libc::AT_FDCWD,
                        proc_path.as_ptr(),
                        dirfd.native(),
                        name.as_ptr(),
                        libc::AT_SYMLINK_FOLLOW,
                    )
                }
            };
            if rc < 0 {
                let e = last_errno();
                match e {
                    libc::EINTR => continue,
                    libc::EISDIR | libc::ENOENT | libc::EOPNOTSUPP | libc::EPERM | libc::EINVAL
                        if status == 0 =>
                    {
                        // First failure on AT_EMPTY_PATH ⇒ no cap; retry via /proc.
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
    pub fn symlinkat(target: &ZStr, dirfd: impl AsFd, dest: &ZStr) -> Maybe<()> {
        let dirfd = dirfd.as_fd();
        check_p!(
            // SAFETY: `dirfd` is a live fd (or AT_FDCWD); both `ZStr`s are
            // valid NUL-terminated C strings.
            unsafe { libc::symlinkat(target.as_ptr(), dirfd.native(), dest.as_ptr()) },
            Tag::symlinkat,
            dest
        );
        Ok(())
    }
    pub fn readlinkat(fd: impl AsFd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let fd = fd.as_fd();
        // Tags as `.readlink`.
        let n = check_p!(
            // SAFETY: `fd` is a live dir fd; `path` is NUL-terminated (`ZStr`);
            // `readlinkat` writes at most `buf.len()` bytes into `buf`.
            unsafe {
                libc::readlinkat(
                    fd.native(),
                    path.as_ptr(),
                    buf.as_mut_ptr().cast(),
                    buf.len(),
                )
            },
            Tag::readlink,
            path
        );
        let n = n as usize;
        if n >= buf.len() {
            return Err(
                Error::from_code_int(libc::ENAMETOOLONG, Tag::readlink).with_path(path.as_bytes())
            );
        }
        buf[n] = 0;
        Ok(n)
    }
    pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        check_p!(
            // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
            unsafe { libc::chmod(path.as_ptr(), mode as libc::mode_t) },
            Tag::chmod,
            path
        );
        Ok(())
    }
    pub fn fchmodat(dir: impl AsFd, path: &ZStr, mode: Mode, flags: i32) -> Maybe<()> {
        let dir = dir.as_fd();
        check_p!(
            // SAFETY: `dir` is a live fd (or AT_FDCWD); `ZStr::as_ptr()` is a
            // valid NUL-terminated C string.
            unsafe { libc::fchmodat(dir.native(), path.as_ptr(), mode as libc::mode_t, flags) },
            Tag::fchmodat,
            path
        );
        Ok(())
    }
    /// `lchmod` is BSD/Darwin-only; Linux: `fchmodat(.., AT_SYMLINK_NOFOLLOW)`.
    pub fn lchmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            // The `libc` crate omits the `lchmod` binding on both Darwin
            // (libSystem since 10.5) and FreeBSD (libc since 3.0). Declare
            // locally.
            unsafe extern "C" {
                fn lchmod(path: *const libc::c_char, mode: libc::mode_t) -> libc::c_int;
            }
            check_p!(
                // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
                unsafe { lchmod(path.as_ptr(), mode as libc::mode_t) },
                Tag::lchmod,
                path
            );
            Ok(())
        }
        #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
        {
            // glibc/musl `fchmodat(.., AT_SYMLINK_NOFOLLOW)` try `fchmodat2(2)` too.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            if super::linux_syscall::is_android_kernel() {
                return lchmod_no_fchmodat2(path, mode);
            }
            const SYS_FCHMODAT2: libc::c_long = 452;
            loop {
                // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
                let rc = unsafe {
                    libc::syscall(
                        SYS_FCHMODAT2,
                        Fd::cwd().native() as libc::c_long,
                        path.as_ptr(),
                        mode as libc::c_long,
                        libc::AT_SYMLINK_NOFOLLOW as libc::c_long,
                    )
                };
                if rc < 0 {
                    let e = last_errno();
                    if e == libc::EINTR {
                        continue;
                    }
                    if e == libc::ENOSYS {
                        return fchmodat(Fd::cwd(), path, mode, libc::AT_SYMLINK_NOFOLLOW);
                    }
                    return Err(Error::from_code_int(e, Tag::lchmod).with_path(path.as_bytes()));
                }
                return Ok(());
            }
        }
    }
    /// musl's fallback: `O_PATH` + `chmod("/proc/self/fd/N")`; symlinks get EOPNOTSUPP like libc.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn lchmod_no_fchmodat2(path: &ZStr, mode: Mode) -> Maybe<()> {
        let retag = |mut err: Error| {
            err.syscall = Tag::lchmod;
            err.with_path(path.as_bytes())
        };
        let file = open(path, O::PATH | O::NOFOLLOW | O::CLOEXEC, 0)
            .map(crate::CloseOnDrop::new)
            .map_err(retag)?;
        if kind_from_mode(file.stat().map_err(retag)?.st_mode as Mode) == FileKind::SymLink {
            return Err(retag(Error::from_code_int(libc::EOPNOTSUPP, Tag::lchmod)));
        }
        chmod(
            fd_path_z(b"/proc/self/fd/", file.fd(), &mut [0u8; 32]),
            mode,
        )
        .map_err(retag)
    }
    pub fn chown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        check_p!(
            // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
            unsafe { libc::chown(path.as_ptr(), uid, gid) },
            Tag::chown,
            path
        );
        Ok(())
    }
    pub fn lchown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        check_p!(
            // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
            unsafe { libc::lchown(path.as_ptr(), uid, gid) },
            Tag::lchown,
            path
        );
        Ok(())
    }
    pub fn fstatat(fd: impl AsFd, path: &ZStr) -> Maybe<Stat> {
        let fd = fd.as_fd();
        let dir = if fd.is_valid() { fd } else { Fd::cwd() };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return super::linux_syscall::fstatat(dir, path, 0)
                .map_err(|e| Error::from_code_int(e, Tag::fstatat).with_path(path.as_bytes()));
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check_p!(
                // SAFETY: `path` is NUL-terminated; `st` is a valid out-param.
                unsafe { libc::fstatat(dir.native(), path.as_ptr(), st.as_mut_ptr(), 0) },
                Tag::fstatat,
                path
            );
            // SAFETY: rc == 0 ⇒ kernel populated `st`.
            Ok(unsafe { st.assume_init() })
        }
    }
    pub fn access(path: &ZStr, mode: i32) -> Maybe<()> {
        check_p!(
            // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
            unsafe { libc::access(path.as_ptr(), mode) },
            Tag::access,
            path
        );
        Ok(())
    }
    /// Never errors; any non-zero rc → `Ok(false)`.
    pub fn faccessat(dir: impl AsFd, sub: &ZStr) -> Maybe<bool> {
        Ok(exists_at(dir, sub))
    }
    pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check!(
            // SAFETY: `fd` is a live descriptor; `ts` is a 2-element stack
            // array and `futimens` reads exactly two `timespec`s.
            unsafe { libc::futimens(fd.native(), ts.as_ptr()) },
            Tag::futimens
        );
        Ok(())
    }
    pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check_p!(
            // SAFETY: `path` is NUL-terminated (`ZStr`); `ts` is a 2-element
            // stack array and `utimensat` reads exactly two `timespec`s.
            unsafe { libc::utimensat(libc::AT_FDCWD, path.as_ptr(), ts.as_ptr(), 0) },
            Tag::utimensat,
            path
        );
        Ok(())
    }
    pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check_p!(
            // SAFETY: `path` is NUL-terminated (`ZStr`); `ts` is a 2-element
            // stack array and `utimensat` reads exactly two `timespec`s.
            unsafe {
                libc::utimensat(
                    libc::AT_FDCWD,
                    path.as_ptr(),
                    ts.as_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            },
            Tag::utimensat,
            path
        );
        Ok(())
    }
    /// Windows uses `GetFileAttributesW`; posix is plain `access`.
    pub fn exists_z(path: &ZStr) -> bool {
        // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
        unsafe { libc::access(path.as_ptr(), libc::F_OK) == 0 }
    }
    pub fn exists_at(dir: impl AsFd, sub: &ZStr) -> bool {
        let dir = dir.as_fd();
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            super::linux_syscall::faccessat(dir, sub, libc::F_OK).is_ok()
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            // SAFETY: `dir` is a live fd (or AT_FDCWD); `ZStr::as_ptr()` is a
            // valid NUL-terminated C string.
            unsafe { libc::faccessat(dir.native(), sub.as_ptr(), libc::F_OK, 0) == 0 }
        }
    }
    /// Calls extern C `is_executable_file` (c-bindings.cpp:72-89) via FFI.
    pub fn is_executable_file_path(path: &ZStr) -> bool {
        unsafe extern "C" {
            // `c_char`, not `i8` — `char` is unsigned on aarch64/arm/ppc, so
            // hard-coding `i8` mismatches `ZStr::as_ptr()` (`*const c_char`)
            // there. The C side is `const char*` regardless; `c_char` tracks
            // its platform sign.
            fn is_executable_file(path: *const c_char) -> bool;
        }
        // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
        unsafe { is_executable_file(path.as_ptr()) }
    }
    /// `fstat`, then clamp a negative `st_size` to 0.
    pub fn get_file_size(fd: Fd) -> Maybe<u64> {
        Ok(fstat(fd)?.st_size.max(0) as u64)
    }
    /// `realpath` — `realpath$DARWIN_EXTSN` on macOS for proper symlink resolution
    /// Writes into `buf` and returns the written slice.
    pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Maybe<&'a [u8]> {
        #[cfg(target_os = "macos")]
        unsafe extern "C" {
            #[link_name = "realpath$DARWIN_EXTSN"]
            fn _realpath(path: *const i8, resolved: *mut i8) -> *mut i8;
        }
        #[cfg(not(target_os = "macos"))]
        use libc::realpath as _realpath;
        // SAFETY: `path` is NUL-terminated (`ZStr`); `buf` is a `PathBuffer`
        // (>= PATH_MAX bytes) which `realpath` requires for the resolved path.
        let p = unsafe { _realpath(path.as_ptr(), buf.0.as_mut_ptr().cast()) };
        if p.is_null() {
            return Err(err_with_path(Tag::realpath, path));
        }
        // SAFETY: on success `realpath` returned `buf`'s pointer with a
        // NUL-terminated absolute path written into it.
        let len = unsafe { libc::strlen(p) };
        Ok(&buf.0[..len])
    }
    /// The canonical path of `path`, as `open` followed by `get_fd_path` reports it, but normally in one system call that opens nothing.
    #[cfg(target_os = "macos")]
    pub fn get_full_path<'a>(
        path: &ZStr,
        out: &'a mut bun_core::PathBuffer,
    ) -> Maybe<&'a mut [u8]> {
        // The kernel repeats the first two, which only tell it how to resolve the rest. `/dev/fd/3` stands for an open file.
        const PREFIXES_THAT_NEED_OPEN: [&[u8]; 3] = [b"/.nofollow/", b"/.resolve/", b"/dev/fd/"];
        match get_full_path_attribute(path, out) {
            Ok(len)
                if !PREFIXES_THAT_NEED_OPEN
                    .iter()
                    .any(|prefix| out.0[..len].starts_with(prefix)) =>
            {
                return Ok(&mut out.0[..len]);
            }
            // `open` does not find these either, and it needs a free descriptor to say so.
            Err(err) if matches!(err.get_errno(), E::ENOENT | E::ENOTDIR | E::ELOOP) => {
                return Err(err);
            }
            // `getattrlist` can fail where `open` succeeds: `EPERM` on a resource fork, `EACCES` under an ACL that denies only `readattr`, `ENOSPC` after a prefix, `ENOTSUP` on a volume without it.
            _ => {}
        }
        let file = CloseOnDrop::new(open(path, O::RDONLY | O::NONBLOCK | O::NOCTTY, 0)?);
        get_fd_path(file.fd(), out).map_err(|err| err.with_path(path.as_bytes()))
    }
    /// Copies `ATTR_CMN_FULLPATH` and its NUL into `out`, and returns the length without the NUL.
    #[cfg(target_os = "macos")]
    fn get_full_path_attribute(path: &ZStr, out: &mut bun_core::PathBuffer) -> Maybe<usize> {
        #[repr(C)]
        struct Reply {
            length: u32,
            full_path: libc::attrreference_t,
            bytes: [u8; bun_core::MAX_PATH_BYTES],
        }
        let mut request = libc::attrlist {
            bitmapcount: libc::ATTR_BIT_MAP_COUNT,
            reserved: 0,
            commonattr: libc::ATTR_CMN_FULLPATH,
            volattr: 0,
            dirattr: 0,
            fileattr: 0,
            forkattr: 0,
        };
        let mut reply = Reply {
            length: 0,
            full_path: libc::attrreference_t {
                attr_dataoffset: 0,
                attr_length: 0,
            },
            bytes: [0; bun_core::MAX_PATH_BYTES],
        };
        // SAFETY: `path` is NUL-terminated, and `request` and `reply` are valid for the sizes passed.
        check_p!(
            unsafe {
                libc::getattrlist(
                    path.as_ptr(),
                    (&raw mut request).cast(),
                    (&raw mut reply).cast(),
                    size_of::<Reply>(),
                    0,
                )
            },
            Tag::realpath,
            path
        );
        // The offset counts from the reference itself, and the length includes the NUL.
        let with_nul = (reply.full_path.attr_dataoffset as usize)
            .checked_sub(size_of::<libc::attrreference_t>())
            .and_then(|start| {
                reply
                    .bytes
                    .get(start..start + reply.full_path.attr_length as usize)
            })
            .filter(|with_nul| !with_nul.is_empty())
            .ok_or_else(|| {
                Error::from_code(E::ENAMETOOLONG, Tag::realpath).with_path(path.as_bytes())
            })?;
        out.0[..with_nul.len()].copy_from_slice(with_nul);
        Ok(with_nul.len() - 1)
    }

    // ── fcntl/dup/pipe/io group ──
    pub type FcntlInt = isize;
    /// The `fcntl` commands whose argument is an integer.
    #[derive(Clone, Copy)]
    #[repr(i32)]
    pub(crate) enum Fcntl {
        DupFd = libc::F_DUPFD,
        DupFdCloexec = libc::F_DUPFD_CLOEXEC,
        GetFd = libc::F_GETFD,
        SetFd = libc::F_SETFD,
        GetFl = libc::F_GETFL,
        SetFl = libc::F_SETFL,
    }
    pub(crate) fn fcntl(fd: Fd, cmd: Fcntl, arg: isize) -> Maybe<FcntlInt> {
        // SAFETY: no `Fcntl` reads `arg` as an address.
        unsafe { fcntl_unchecked(fd, cmd as i32, arg) }
    }
    /// SAFETY: if `cmd` reads `arg` as an address, it is valid for what `cmd` reads and writes there.
    pub(crate) unsafe fn fcntl_unchecked(fd: Fd, cmd: i32, arg: isize) -> Maybe<FcntlInt> {
        // Attach the fd to the error.
        loop {
            // SAFETY: the caller's contract.
            let rc = unsafe { libc::fcntl(fd.native(), cmd, arg) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR {
                    continue;
                }
                return Err(Error::from_code_int(e, Tag::fcntl).with_fd(fd));
            }
            return Ok(rc as isize);
        }
    }
    pub fn dup2(old: Fd, new: Fd) -> Maybe<Fd> {
        let rc = check!(safe_libc::dup2(old.native(), new.native()), Tag::dup2);
        Ok(Fd::from_native(rc))
    }
    /// On Linux `new` has `FD_CLOEXEC` from the start.
    pub fn dup2_close_on_exec(old: Fd, new: Fd) -> Maybe<()> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let (old, new) = (old.native(), new.native());
            check!(
                // SAFETY: integers only. For Android, `libc` has the number of the call alone.
                unsafe { libc::syscall(libc::SYS_dup3, old, new, libc::O_CLOEXEC) },
                Tag::dup2
            );
            Ok(())
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            dup2(old, new)?;
            set_close_on_exec(new)
        }
    }
    /// Plain `pipe(&fds)`, NO CLOEXEC. Callers that want CLOEXEC
    /// set it themselves.
    pub fn pipe() -> Maybe<[Fd; 2]> {
        let mut fds = [0i32; 2];
        check!(safe_libc::pipe(&mut fds), Tag::pipe);
        Ok([Fd::from_native(fds[0]), Fd::from_native(fds[1])])
    }
    pub fn isatty(fd: Fd) -> bool {
        safe_libc::isatty(fd.native()) == 1
    }
    pub fn fsync(fd: Fd) -> Maybe<()> {
        check!(safe_libc::fsync(fd.native()), Tag::fsync);
        Ok(())
    }
    pub fn fdatasync(fd: Fd) -> Maybe<()> {
        let call = || Ok(check!(safe_libc::fdatasync(fd.native()), Tag::fdatasync));
        call().map(|_| ()).map_err(|err: Error| err.with_fd(fd))
    }
    pub fn lseek(fd: Fd, offset: i64, whence: i32) -> Maybe<i64> {
        let rc = check!(safe_libc::lseek(fd.native(), offset, whence), Tag::lseek);
        Ok(rc)
    }
    pub fn chdir(path: &ZStr) -> Maybe<()> {
        // SAFETY: `ZStr::as_ptr()` yields a valid NUL-terminated C string.
        check_p!(unsafe { libc::chdir(path.as_ptr()) }, Tag::chdir, path);
        Ok(())
    }
    pub fn fchdir(fd: Fd) -> Maybe<()> {
        check!(safe_libc::fchdir(fd.native()), Tag::fchdir);
        Ok(())
    }
    pub fn umask(mode: Mode) -> Mode {
        // `Mode` is normalized to u32 across platforms; libc::mode_t is u16 on
        // Darwin/FreeBSD and u32 on Linux — cast at the boundary.
        safe_libc::umask(mode as libc::mode_t) as Mode
    }

    // ── socket primitives (recv/send/socketpair) ──
    // Full networking lives in `bun_uws_sys`; these are the bare libc wrappers
    // exposed for shell/pipe IPC.
    fn recv_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>], flags: i32) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        // macOS: `recvfrom$NOCANCEL`, retried on EINTR.
        let n = check!(sys_recv(fd.native(), &mut buf[..len], flags), Tag::recv);
        Ok(n as usize)
    }
    pub(crate) fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize> {
        // `buf.len` is passed un-clamped (only `recv_uninit` clamps);
        // forward the full length and let the kernel decide.
        // macOS: `sendto$NOCANCEL`, retried on EINTR.
        let n = check!(sys_send(fd.native(), buf, flags), Tag::send);
        Ok(n as usize)
    }
    pub(crate) fn recv_non_block_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>]) -> Maybe<usize> {
        recv_uninit(fd, buf, MSG_DONTWAIT)
    }
    /// `MSG_DONTWAIT | MSG_NOSIGNAL` so a broken-pipe write
    /// returns EPIPE instead of raising SIGPIPE.
    pub fn send_non_block(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        send(fd, buf, SEND_FLAGS_NONBLOCK)
    }
    pub(crate) const MSG_DONTWAIT: i32 = libc::MSG_DONTWAIT;
    /// XNU's `sosend` only honours `MSG_NBIO` (private, 0x20000) for "don't wait for buffer space"; `MSG_DONTWAIT` alone still blocks there.
    #[cfg(target_os = "macos")]
    const MSG_NBIO: i32 = 0x20000;
    #[cfg(not(target_os = "macos"))]
    const MSG_NBIO: i32 = 0;
    pub(crate) const SEND_FLAGS_NONBLOCK: i32 = libc::MSG_DONTWAIT | MSG_NBIO | libc::MSG_NOSIGNAL;
    /// `fcntl(F_GETFD)` then OR in `FD_CLOEXEC`.
    pub fn set_close_on_exec(fd: Fd) -> Maybe<()> {
        let fl = fcntl(fd, Fcntl::GetFd, 0)?;
        fcntl(fd, Fcntl::SetFd, fl | libc::FD_CLOEXEC as isize)?;
        Ok(())
    }

    /// `socketpair_impl(.., for_shell = false)`.
    /// Linux uses `SOCK_CLOEXEC|SOCK_NONBLOCK` type flags; non-Linux sets
    /// CLOEXEC + nonblock + (Darwin) `SO_NOSIGPIPE` per-fd, closing both on
    /// any post-step error.
    pub fn socketpair(domain: i32, ty: i32, proto: i32, nonblock: bool) -> Maybe<[Fd; 2]> {
        socketpair_impl(domain, ty, proto, nonblock, false)
    }

    /// `socketpair_impl(.., for_shell = true)`.
    /// On macOS this skips `SO_NOSIGPIPE` (so the child's writes get SIGPIPE
    /// when the read end closes — required for `yes | head`-style pipelines)
    /// and bumps `SO_RCVBUF`/`SO_SNDBUF` to 128 KB instead. On Linux/other
    /// POSIX it is identical to [`socketpair`].
    pub fn socketpair_for_shell(
        domain: i32,
        ty: i32,
        proto: i32,
        nonblock: bool,
    ) -> Maybe<[Fd; 2]> {
        socketpair_impl(domain, ty, proto, nonblock, true)
    }

    fn socketpair_impl(
        domain: i32,
        ty: i32,
        proto: i32,
        nonblock: bool,
        for_shell: bool,
    ) -> Maybe<[Fd; 2]> {
        let _ = for_shell; // only meaningful on macOS
        let mut fds = [0i32; 2];
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let ty = ty | libc::SOCK_CLOEXEC | if nonblock { libc::SOCK_NONBLOCK } else { 0 };
        check!(
            safe_libc::socketpair(domain, ty, proto, &mut fds),
            Tag::socketpair
        );
        let pair = fds.map(Fd::from_native);
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let pair = {
            let pair = pair.map(crate::CloseOnDrop::new);
            // CLOEXEC first.
            for end in &pair {
                set_close_on_exec(end.fd())?;
            }
            // Darwin: SO_NOSIGPIPE on both fds — unless `for_shell`, in which
            // case bump RCVBUF/SNDBUF instead.
            #[cfg(target_os = "macos")]
            {
                let setsockopt = |end: &crate::CloseOnDrop, name, value| {
                    net::setsockopt_int(end.fd(), libc::SOL_SOCKET, name, value)
                };
                if for_shell {
                    let _ = setsockopt(&pair[1], libc::SO_RCVBUF, 1024 * 128);
                    let _ = setsockopt(&pair[0], libc::SO_SNDBUF, 1024 * 128);
                } else {
                    for end in &pair {
                        setsockopt(end, libc::SO_NOSIGPIPE, 1)?;
                    }
                }
            }
            if nonblock {
                for end in &pair {
                    crate::set_nonblocking(end.fd())?;
                }
            }
            pair.map(crate::CloseOnDrop::into_raw)
        };
        Ok(pair.map(move_above_stdio))
    }

    /// `pidfd_open(2)` — Linux ≥ 5.3. Returns a pollable fd referring to `pid`.
    /// Callers fall back to the waiter-thread on `ENOSYS`/`EPERM`/`EACCES`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn pidfd_open(pid: libc::pid_t, flags: u32) -> Maybe<Fd> {
        super::linux_syscall::pidfd_open(pid, flags)
            .map_err(|e| Error::from_code_int(e, Tag::pidfd_open))
            .map(move_above_stdio)
    }

    // ── macOS clonefile / copyfile ──
    #[cfg(target_os = "macos")]
    mod darwin_copy {
        use super::*;
        unsafe extern "C" {
            fn clonefile(src: *const i8, dst: *const i8, flags: u32) -> i32;
            fn clonefileat(
                src_dir: i32,
                src: *const i8,
                dst_dir: i32,
                dst: *const i8,
                flags: u32,
            ) -> i32;
            fn copyfile(
                from: *const i8,
                to: *const i8,
                state: *mut core::ffi::c_void,
                flags: u32,
            ) -> i32;
            fn fcopyfile(from: i32, to: i32, state: *mut core::ffi::c_void, flags: u32) -> i32;
        }
        pub fn clonefile_(from: &ZStr, to: &ZStr) -> Maybe<()> {
            check_p!(
                // SAFETY: both `ZStr`s are valid NUL-terminated C strings.
                unsafe { clonefile(from.as_ptr(), to.as_ptr(), 0) },
                Tag::clonefile,
                from
            );
            Ok(())
        }
        pub fn clonefileat_(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
            check_p!(
                // SAFETY: both dir fds are live (or AT_FDCWD); both `ZStr`s are
                // valid NUL-terminated C strings.
                unsafe {
                    clonefileat(
                        from_dir.native(),
                        from.as_ptr(),
                        to_dir.native(),
                        to.as_ptr(),
                        0,
                    )
                },
                Tag::clonefile,
                from
            );
            Ok(())
        }
        pub fn copyfile_(from: &ZStr, to: &ZStr, flags: u32) -> Maybe<()> {
            check_p!(
                // SAFETY: both `ZStr`s are valid NUL-terminated C strings;
                // a null `copyfile_state_t` is documented as "use defaults".
                unsafe { copyfile(from.as_ptr(), to.as_ptr(), core::ptr::null_mut(), flags) },
                Tag::copyfile,
                from
            );
            Ok(())
        }
        pub fn fcopyfile_(from: Fd, to: Fd, flags: u32) -> Maybe<()> {
            check!(
                // SAFETY: a null `copyfile_state_t` is documented as "use defaults".
                unsafe { fcopyfile(from.native(), to.native(), core::ptr::null_mut(), flags) },
                Tag::fcopyfile
            );
            Ok(())
        }
    }
    #[cfg(target_os = "macos")]
    pub use darwin_copy::{
        clonefile_ as clonefile, clonefileat_ as clonefileat, copyfile_ as copyfile,
        fcopyfile_ as fcopyfile,
    };

    // ── mmap/munmap ──
    /// [`Mmap::new`] is the safe form.
    ///
    /// SAFETY: with `MAP_FIXED`, the pages that the mapping replaces are the caller's, and nothing refers to their bytes.
    pub unsafe fn mmap(
        addr: *mut u8,
        len: usize,
        prot: i32,
        flags: i32,
        fd: Fd,
        off: i64,
    ) -> Maybe<*mut u8> {
        // SAFETY: the caller's contract.
        let p = unsafe { libc::mmap(addr.cast(), len, prot, flags, fd.native(), off) };
        if p == libc::MAP_FAILED {
            return Err(err_with(Tag::mmap));
        }
        Ok(p.cast())
    }
    /// SAFETY: the pages are the caller's, and nothing refers to their bytes.
    pub(crate) unsafe fn munmap(ptr: *mut u8, len: usize) -> Maybe<()> {
        // SAFETY: the caller's contract.
        check!(unsafe { libc::munmap(ptr.cast(), len) }, Tag::munmap);
        Ok(())
    }

    /// `bun.sys.mmapFile` — open `path` RDWR, fstat for size, mmap [offset, offset+len).
    pub fn mmap_file(
        path: &ZStr,
        flags: libc::c_int,
        wanted_size: Option<usize>,
        offset: usize,
    ) -> Maybe<Mmap> {
        // The mapping outlives the descriptor.
        let file = CloseOnDrop::new(open(path, O::RDWR, 0)?);

        let stat_size = {
            let result = file.stat()?;
            usize::try_from(result.st_size).unwrap_or(0)
        };

        let mut size = stat_size.saturating_sub(offset);
        if let Some(size_) = wanted_size {
            size = size.min(size_);
        }

        let access = libc::PROT_READ | libc::PROT_WRITE;
        Mmap::new(size, access, flags, file.fd(), offset as i64)
    }

    // ── memfd (Linux only) ──
    /// `bun.sys.MemfdFlags`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
    static MEMFD_ENOSYS: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(false);

    /// `bun.sys.canUseMemfd()` — false when `BUN_FEATURE_FLAG_DISABLE_MEMFD` is
    /// set or once `memfd_create` has returned ENOSYS/EPERM/EACCES.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[inline]
    pub fn can_use_memfd() -> bool {
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_MEMFD
            .get()
            .unwrap_or(false)
        {
            return false;
        }
        !MEMFD_ENOSYS.load(core::sync::atomic::Ordering::Relaxed)
    }

    /// `bun.sys.memfd_create(name, flags)` — Linux only.
    /// Retries on EINTR; on EINVAL retries once with the pre-6.3 flag set
    /// (drops `MFD_EXEC`/`MFD_NOEXEC_SEAL`); on ENOSYS/EPERM/EACCES latches
    /// [`can_use_memfd`] to false.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn memfd_create(name: bun_core::CStrRef<'_>, flags_: MemfdFlags) -> Maybe<Fd> {
        let mut flags: u32 = flags_ as u32;
        loop {
            // bionic only added the `memfd_create()` libc wrapper at API 30; we
            // link against API 28. Raw-syscall it (kernel has had it since 3.17).
            // SAFETY: `name` is a valid NUL-terminated C string.
            #[cfg(target_os = "android")]
            let rc = unsafe {
                libc::syscall(libc::SYS_memfd_create, name.as_ptr(), flags) as core::ffi::c_int
            };
            // SAFETY: `name` is a valid NUL-terminated C string.
            #[cfg(target_os = "linux")]
            let rc = unsafe { libc::memfd_create(name.as_ptr(), flags) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR {
                    continue;
                }
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
            return Ok(move_above_stdio(Fd::from_native(rc)));
        }
    }

    /// `sendfile(src, dest, len)`. Clamps `len` (avoid EINVAL on
    /// >2GB), EINTR-retries, and attaches the *source* fd to the error.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn sendfile(src: Fd, dest: Fd, len: usize) -> Maybe<usize> {
        let len = len.min(i32::MAX as usize - 1);
        loop {
            // SAFETY: `src`/`dest` are live fds; null `offset` tells the
            // kernel to use and update `src`'s file offset.
            let rc =
                unsafe { libc::sendfile(dest.native(), src.native(), core::ptr::null_mut(), len) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR {
                    continue;
                }
                return Err(Error::from_code_int(e, Tag::sendfile).with_fd(src));
            }
            return Ok(rc as usize);
        }
    }
}
#[cfg(unix)]
pub use posix_impl::*;

// D034: canonical lives in the leaf crate (cached via OnceLock); the per-platform
// impls in posix_impl/windows_impl were uncached duplicates.
pub use bun_alloc::page_size;

/// `bun.jsc.Node.TimeLike` — `timespec` shape, decoupled from JSC (T6).
/// futimens/utimens take this; the JSC binding constructs it from
/// JS Date/number. T1 owns the data shape.
#[derive(Clone, Copy, Debug, Default)]
#[repr(C)]
pub struct TimeLike {
    pub sec: i64,
    pub nsec: i64,
}
impl TimeLike {
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn to_timespec(self) -> libc::timespec {
        libc::timespec {
            tv_sec: self.sec as _,
            tv_nsec: self.nsec as _,
        }
    }
}
#[cfg(unix)]
pub const UTIME_NOW: i64 = libc::UTIME_NOW;
#[cfg(windows)]
pub const UTIME_NOW: i64 = -1;

#[cfg(windows)]
#[path = "sys_uv.rs"]
pub mod sys_uv;

/// On non-Windows, `sys_uv` is just an alias for the regular syscall surface so
/// callers (e.g. `pack_command`) can write `bun_sys::sys_uv::fstat(fd)` portably.
#[cfg(not(windows))]
pub mod sys_uv {
    pub use super::{close, fstat, lstat, mkdir, open, pread, pwrite, rename, stat, unlink, write};
}

#[cfg(windows)]
mod windows_impl {
    // NT/kernel32/libuv triad. The libuv-backed ops
    // delegate to `crate::sys_uv`; the rest call NT/kernel32 directly.
    use super::windows as w;
    use super::windows::libuv as uv;
    use super::*;

    // ── libuv-backed ─────────────────────────────────────────────────────
    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        sys_uv::open(path, flags, mode)
    }
    pub fn close(fd: Fd) -> Maybe<()> {
        match sys_uv::close(fd) {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
    pub(crate) fn read_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>]) -> Maybe<usize> {
        // libuv for uv-kind fds, the HANDLE otherwise. The libuv path
        // requires a CRT fd via `fd.uv()`, which PANICS for HANDLE-backed
        // (`FdKind::System`) Fds — i.e. anything from `openat()`/NtCreateFile.
        if fd.kind() == FdKind::Uv {
            return sys_uv::pread_uninit(fd, buf, -1);
        }
        read_handle(fd, buf, None, Tag::read)
    }
    fn read_handle(
        fd: Fd,
        buf: &mut [MaybeUninit<u8>],
        off: Option<i64>,
        tag: Tag,
    ) -> Maybe<usize> {
        loop {
            match w::sync_io::read(fd.native(), buf, off) {
                Ok(read) => return Ok(read),
                Err(w::Win32Error::BROKEN_PIPE | w::Win32Error::HANDLE_EOF) => return Ok(0),
                Err(w::Win32Error::OPERATION_ABORTED) => continue,
                Err(er) => return Err(Error::from_win32(er, tag).with_fd(fd)),
            }
        }
    }
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        // NOT via libuv — sys_uv::write → fd.uv() panics for HANDLE-backed Fds.
        debug_assert!(!buf.is_empty());
        write_handle(fd, buf, None, Tag::write)
    }
    fn write_handle(fd: Fd, buf: &[u8], off: Option<i64>, tag: Tag) -> Maybe<usize> {
        w::sync_io::write(fd.native(), buf, off).map_err(|er| {
            // A HANDLE that was opened read-only: POSIX has EBADF for "fd not open for writing".
            let err = if er == w::Win32Error::ACCESS_DENIED {
                Error::from_code(E::EBADF, tag)
            } else {
                Error::from_win32(er, tag)
            };
            // Not `with_fd`: a missing standard handle is `Fd::INVALID`.
            Error { fd, ..err }
        })
    }
    /// Unlike `flock(2)`, `LockFileEx` cannot convert a lock the handle already holds.
    pub fn flock(fd: Fd, mode: FileLockMode, nonblocking: bool) -> Maybe<bool> {
        use w::kernel32::{LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY};
        let flags = (LOCKFILE_EXCLUSIVE_LOCK * u32::from(mode == FileLockMode::Exclusive))
            | (LOCKFILE_FAIL_IMMEDIATELY * u32::from(nonblocking));
        let locked = w::sync_io::complete_overlapped(|ol| {
            // SAFETY: `ol` outlives the request.
            unsafe { w::kernel32::LockFileEx(fd.native(), flags, 0, u32::MAX, u32::MAX, ol) }
        });
        match locked {
            Ok(()) => Ok(true),
            Err(w::Win32Error::LOCK_VIOLATION) if nonblocking => Ok(false),
            Err(er) => Err(Error::new(er.to_e(), Tag::flock).with_fd(fd)),
        }
    }
    pub(crate) fn pread_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>], off: i64) -> Maybe<usize> {
        if fd.kind() == FdKind::Uv {
            return sys_uv::pread_uninit(fd, buf, off);
        }
        read_handle(fd, buf, Some(off), Tag::pread)
    }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
        if fd.kind() == FdKind::Uv {
            return sys_uv::pwrite(fd, buf, off);
        }
        write_handle(fd, buf, Some(off), Tag::pwrite)
    }
    pub fn stat(path: &ZStr) -> Maybe<Stat> {
        sys_uv::stat(path)
    }
    pub fn fstat(fd: Fd) -> Maybe<Stat> {
        if fd.kind() == FdKind::Uv {
            return sys_uv::fstat(fd);
        }
        // HANDLE-backed (`FdKind::System`, e.g. `openat()` results): stat the
        // HANDLE directly instead of allocating a throwaway CRT fd via
        // `_open_osfhandle` (which cannot be `_close`d without also closing
        // the caller's HANDLE, so it leaked a CRT slot per call).
        fstat_handle(fd)
    }
    /// Port of libuv's `fs__fstat_handle` + `fs__stat_handle` +
    /// `fs__stat_assign_statbuf` (`src/win/fs.c`). Fills a `uv_stat_t` from a
    /// raw HANDLE without touching the CRT fd table.
    fn fstat_handle(fd: Fd) -> Maybe<Stat> {
        use bun_core::S;
        let handle = fd.native();
        let nt_err = |rc: w::NTSTATUS| Error::new(rc, Tag::fstat).with_fd(fd);
        let mut st: Stat = bun_core::ffi::zeroed();

        // Dispatch on handle type; pipes and consoles get a synthetic stat.
        let file_type = w::GetFileType(handle);
        if file_type == w::FILE_TYPE_PIPE {
            st.st_mode = S::IFIFO as u64;
            st.st_nlink = 1;
            st.st_rdev = (w::FILE_DEVICE_NAMED_PIPE as u64) << 16;
            st.st_ino = handle as usize as u64;
            return Ok(st);
        }
        if file_type == w::FILE_TYPE_CHAR {
            let mut mode: w::DWORD = 0;
            // SAFETY: FFI; `handle` is a valid HANDLE, `mode` valid for write.
            if unsafe { w::kernel32::GetConsoleMode(handle, &mut mode) } != 0 {
                st.st_mode = S::IFCHR as u64;
                st.st_nlink = 1;
                st.st_rdev = (w::FILE_DEVICE_CONSOLE as u64) << 16;
                st.st_ino = handle as usize as u64;
                return Ok(st);
            }
            // Non-console char device (NUL, COM1, ...): fall through to the
            // disk path, which special-cases `FILE_DEVICE_NULL`.
        } else if file_type != w::FILE_TYPE_DISK {
            return Err(Error::new(E::EBADF, Tag::fstat).with_fd(fd));
        }

        let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();

        let mut device_info: w::FILE_FS_DEVICE_INFORMATION = bun_core::ffi::zeroed();
        // SAFETY: FFI; `handle` valid, output buffers valid for write.
        let rc = unsafe {
            w::ntdll::NtQueryVolumeInformationFile(
                handle,
                &mut io,
                core::ptr::from_mut(&mut device_info).cast(),
                core::mem::size_of::<w::FILE_FS_DEVICE_INFORMATION>() as u32,
                w::FS_INFORMATION_CLASS::FileFsDeviceInformation,
            )
        };
        if w::NT_ERROR(rc) {
            return Err(nt_err(rc));
        }
        if device_info.DeviceType == w::FILE_DEVICE_NULL {
            st.st_mode = (S::IFCHR | S::IRUSR | S::IWUSR) as u64;
            st.st_mode |= (st.st_mode & 0o700) >> 3 | (st.st_mode & 0o700) >> 6;
            st.st_nlink = 1;
            st.st_blksize = 4096;
            st.st_rdev = (w::FILE_DEVICE_NULL as u64) << 16;
            return Ok(st);
        }

        let mut file_info: w::FILE_ALL_INFORMATION = bun_core::ffi::zeroed();
        // SAFETY: FFI; `handle` valid, output buffers valid for write.
        // STATUS_BUFFER_OVERFLOW (variable-length name truncated) is expected
        // and is a warning, not an error; `NT_ERROR` excludes it.
        let rc = unsafe {
            w::ntdll::NtQueryInformationFile(
                handle,
                &mut io,
                core::ptr::from_mut(&mut file_info).cast(),
                core::mem::size_of::<w::FILE_ALL_INFORMATION>() as u32,
                w::FILE_INFORMATION_CLASS::FileAllInformation,
            )
        };
        if w::NT_ERROR(rc) {
            return Err(nt_err(rc));
        }

        let mut volume_info: w::FILE_FS_VOLUME_INFORMATION = bun_core::ffi::zeroed();
        // SAFETY: FFI; `handle` valid, output buffers valid for write.
        let rc = unsafe {
            w::ntdll::NtQueryVolumeInformationFile(
                handle,
                &mut io,
                core::ptr::from_mut(&mut volume_info).cast(),
                core::mem::size_of::<w::FILE_FS_VOLUME_INFORMATION>() as u32,
                w::FS_INFORMATION_CLASS::FileFsVolumeInformation,
            )
        };
        if rc == w::NTSTATUS::NOT_IMPLEMENTED {
            st.st_dev = 0;
        } else if w::NT_ERROR(rc) {
            return Err(nt_err(rc));
        } else {
            st.st_dev = volume_info.VolumeSerialNumber as u64;
        }

        // libuv's `S_IFLNK` arm is gated on `do_lstat`, which is always 0 on
        // the fstat path, so reparse points fall through to DIR-or-REG.
        let attrs = file_info.BasicInformation.FileAttributes;
        if attrs & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
            st.st_mode = S::IFDIR as u64;
            st.st_size = 0;
        } else {
            st.st_mode = S::IFREG as u64;
            st.st_size = file_info.StandardInformation.EndOfFile as u64;
        }
        if attrs & w::FILE_ATTRIBUTE_READONLY != 0 {
            st.st_mode |= S::IRUSR as u64;
        } else {
            st.st_mode |= (S::IRUSR | S::IWUSR) as u64;
        }
        st.st_mode |= (st.st_mode & 0o700) >> 3 | (st.st_mode & 0o700) >> 6;

        st.atim = w::filetime_to_timespec(file_info.BasicInformation.LastAccessTime);
        st.mtim = w::filetime_to_timespec(file_info.BasicInformation.LastWriteTime);
        st.ctim = w::filetime_to_timespec(file_info.BasicInformation.ChangeTime);
        st.birthtim = w::filetime_to_timespec(file_info.BasicInformation.CreationTime);
        st.st_ino = file_info.InternalInformation.IndexNumber as u64;
        st.st_nlink = file_info.StandardInformation.NumberOfLinks as u64;
        st.st_blocks = (file_info.StandardInformation.AllocationSize as u64) >> 9;
        st.st_blksize = 4096;
        Ok(st)
    }
    pub fn lstat(path: &ZStr) -> Maybe<Stat> {
        sys_uv::lstat(path)
    }
    pub fn mkdir(path: &ZStr, mode: Mode) -> Maybe<()> {
        sys_uv::mkdir(path, mode)
    }
    pub fn unlink(path: &ZStr) -> Maybe<()> {
        sys_uv::unlink(path)
    }
    pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
        sys_uv::rename(from, to)
    }
    pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
        sys_uv::symlink_uv(target, link, 0)
    }
    pub fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let err = match sys_uv::readlink(path, buf) {
            Ok(target) => return Ok(target.len()),
            Err(err) => err,
        };
        // libuv passes the path to Windows unchanged, and a path of 260 characters or more only
        // works with the `\\?\` prefix, so retry with it.
        let bytes = path.as_bytes();
        if err.get_errno() != E::ENOENT
            || bytes.len() < 248
            || bytes.len() + 5 > bun_paths::MAX_PATH_BYTES
            || !bun_paths::is_fully_qualified(bytes)
        {
            return Err(err);
        }
        let mut long = bun_paths::Path::from(bytes);
        long.make_long_path();
        sys_uv::readlink(&long, buf).map(|target| target.len())
    }
    pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
        sys_uv::fchmod(fd, mode)
    }
    pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()> {
        // Calls `NtSetInformationFile(..,
        // FileEndOfFileInformation)` directly on the HANDLE (NOT via libuv —
        // sys_uv::ftruncate requires a CRT fd via `fd.uv()`, which fails for
        // HANDLE-backed `Fd`s that have no uv mapping).
        let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        let mut eof = bun_windows_sys::FILE_END_OF_FILE_INFORMATION { EndOfFile: len };
        // SAFETY: FFI; fd is a valid HANDLE, eof/io valid for the call.
        let rc = unsafe {
            w::ntdll::NtSetInformationFile(
                fd.native(),
                &mut io,
                core::ptr::from_mut(&mut eof).cast::<core::ffi::c_void>(),
                core::mem::size_of::<bun_windows_sys::FILE_END_OF_FILE_INFORMATION>() as u32,
                w::FILE_INFORMATION_CLASS::FileEndOfFileInformation,
            )
        };
        if rc != bun_windows_sys::NTSTATUS::SUCCESS {
            return Err(Error::new(rc, Tag::ftruncate).with_fd(fd));
        }
        Ok(())
    }
    /// `FSCTL_SET_SPARSE`: without it NTFS gives every byte below the end of a file real clusters.
    pub fn set_sparse(fd: Fd) -> Maybe<()> {
        w::sync_io::complete_overlapped(|ol| {
            // SAFETY: the call passes no buffer, and `ol` outlives the request.
            unsafe {
                w::kernel32::DeviceIoControl(
                    fd.native(),
                    w::FSCTL_SET_SPARSE,
                    core::ptr::null_mut(),
                    0,
                    core::ptr::null_mut(),
                    0,
                    core::ptr::null_mut(),
                    ol,
                )
            }
        })
        .map_err(|er| Error::from_win32(er, Tag::ioctl).with_fd(fd))
    }

    // ── kernel32 / ntdll arms ────────────────────────────────────────────
    pub fn openat(dir: impl AsFd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        let dir = dir.as_fd();
        // Route through the NtCreateFile path
        // (normalize → `open_file_at_windows_nt_path`) so the result is a
        // HANDLE-backed `Fd` and `O::DIRECTORY`/`O::NOFOLLOW`/`O::PATH` are
        // honoured. Do NOT fall back to libuv `open()` here — that returns a
        // CRT-fd-backed `Fd` and ignores the directory/nofollow flags.
        super::openat_windows_a(dir, path.as_bytes(), flags, mode)
    }
    /// `DuplicateHandle` with `bInheritHandle = FALSE`, the equivalent of the
    /// POSIX arm's `F_DUPFD_CLOEXEC`: libuv spawns children with
    /// `bInheritHandles = TRUE`, so an inheritable duplicate would leak into
    /// every process spawned while it is open. Stdio handed to a child is
    /// duplicated again (inheritable) by libuv itself, so nothing needs it.
    pub fn dup(fd: Fd) -> Maybe<Fd> {
        // DuplicateHandle on the underlying HANDLE.
        let process = w::kernel32::GetCurrentProcess();
        let mut target: w::HANDLE = core::ptr::null_mut();
        let out = unsafe {
            w::kernel32::DuplicateHandle(
                process,
                fd.native() as w::HANDLE,
                process,
                &mut target,
                0,
                w::FALSE,
                w::DUPLICATE_SAME_ACCESS,
            )
        };
        if out == 0 {
            return Err(Error::from_win32(w::Win32Error::get(), Tag::dup).with_fd(fd));
        }
        Ok(Fd::from_native(target as _))
    }
    pub fn getcwd(buf: &mut [u8]) -> Maybe<usize> {
        // GetCurrentDirectoryW + WTF16→UTF8.
        let mut wbuf = bun_paths::w_path_buffer_pool::get();
        let len = w::GetCurrentDirectoryW(&mut wbuf[..])
            .map_err(|err| Error::from_win32(err, Tag::getcwd))?;
        super::write_path_from_windows(buf, &wbuf[..len], Tag::getcwd)
    }
    pub fn mkdirat(dir: impl AsFd, path: &ZStr, _mode: Mode) -> Maybe<()> {
        let dir = dir.as_fd();
        // Open with `op = OnlyCreate`, then close the resulting handle on
        // success.
        let options = super::WindowsOpenDirOptions {
            iterable: false,
            can_rename_or_delete: true,
            op: super::WindowsOpenDirOp::OnlyCreate,
            ..Default::default()
        };
        // `NtCreateFile` does not resolve `..` in a name relative to a directory handle.
        let made = if bun_paths::root(path).is_empty() && bun_paths::climbs_out(path) {
            super::open_dir_at_windows_a(dir, path.as_bytes(), options)
        } else {
            super::open_dir_at_windows_nt_path(dir, &super::nt_path(path, Tag::mkdir)?, options)
        };
        made.map(super::File::from_fd).map(drop)
    }
    /// For a call that removes or replaces what `path` names. `a\.` and `a\b\..` are not the entry `a`.
    fn nt_path_of_entry(dir: Fd, path: &ZStr, syscall: Tag) -> Maybe<bun_paths::OSPath> {
        if !matches!(bun_paths::basename(path), b"." | b"..") {
            return super::nt_path(path, syscall);
        }
        let parent = bun_paths::dirname(path).map(bun_paths::Path::from);
        match parent.map(|parent| super::exists_at_type(dir, &parent)) {
            Some(Err(err)) if err.get_errno() == E::ENOENT => {
                Err(Error::from_code(E::ENOENT, syscall))
            }
            _ => Err(Error::from_code(E::EINVAL, syscall)),
        }
    }
    pub fn renameat(from_dir: impl AsFd, from: &ZStr, to_dir: impl AsFd, to: &ZStr) -> Maybe<()> {
        let from_dir = from_dir.as_fd();
        let to_dir = to_dir.as_fd();
        let from_w = match bun_paths::is_absolute(from) {
            true => super::nt_path(from, Tag::rename)?,
            // Opening it normalizes it.
            false => super::win32_path(from, Tag::rename)?,
        };
        let to_w = nt_path_of_entry(to_dir, to, Tag::rename)?;
        super::windows::rename_at_w(from_dir, &from_w, to_dir, &to_w, true)
    }
    pub(crate) fn renameat2(
        from_dir: Fd,
        from: &ZStr,
        to_dir: Fd,
        to: &ZStr,
        mode: RenameMode,
    ) -> Maybe<()> {
        // `renameat2` collapses to `renameat` on windows; the
        // `noreplace`/`exchange` modes are not honored by NTFS rename.
        let _ = mode;
        renameat(from_dir, from, to_dir, to)
    }
    pub(crate) fn unlinkat_with_flags(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()> {
        // Convert to NT path and call `DeleteFileBun`;
        // `remove_dir = flags & AT_REMOVEDIR != 0`.
        // AT_REMOVEDIR on Windows = 0x200.
        const AT_REMOVEDIR: i32 = 0x200;
        super::windows::DeleteFileBun(
            &nt_path_of_entry(dir, path, Tag::unlink)?,
            super::windows::DeleteFileOptions {
                dir: if dir.is_valid() {
                    Some(dir.native())
                } else {
                    None
                },
                remove_dir: (flags & AT_REMOVEDIR) != 0,
            },
        )
    }
    /// 2-arg form (`flags = 0`).
    #[inline]
    pub fn unlinkat(dir: impl AsFd, path: &ZStr) -> Maybe<()> {
        let dir = dir.as_fd();
        unlinkat_with_flags(dir, path, 0)
    }
    #[inline]
    pub(crate) fn mkdir_recursive_at(dir: impl AsFd, sub: &[u8]) -> Maybe<()> {
        let dir = dir.as_fd();
        mkdir_recursive_at_mode(dir, sub, 0o777)
    }
    pub fn mkdir_recursive_at_mode(dir: Fd, sub: &[u8], mode: Mode) -> Maybe<()> {
        // `NtCreateFile` does not take `.` or `C:..` for a name.
        let sub = bun_paths::Path::join(&[sub]);
        let has_root = !bun_paths::root(&sub).is_empty();
        if bun_paths::components(&sub).all(|name| name == b"." || (has_root && name == b"..")) {
            return Ok(());
        }
        super::mkdir_recursive_with(sub.as_bytes(), |p| {
            mkdirat(dir, &bun_paths::Path::from(p), mode)
        })
    }
    pub fn symlinkat(target: &ZStr, dirfd: impl AsFd, dest: &ZStr) -> Maybe<()> {
        let dirfd = dirfd.as_fd();
        // Resolve `dest` against `dirfd`, then symlink via libuv.
        let dir = super::get_fd_path_owned(dirfd)?;
        sys_uv::symlink_uv(target, &bun_paths::Path::join(&[&dir, dest]), 0)
    }
    pub fn readlinkat(fd: impl AsFd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let fd = fd.as_fd();
        // No `readlinkat` on Windows — resolve and call `readlink`.
        let dir = super::get_fd_path_owned(fd)?;
        readlink(&bun_paths::Path::join(&[&dir, path]), buf)
    }
    pub fn fstatat(fd: impl AsFd, path: &ZStr) -> Maybe<Stat> {
        let fd = fd.as_fd();
        // `openat(fd, path, 0, 0)` (flags=0
        // → FOLLOWS reparse points) then `fstat(file)`. Do NOT use `lstat` here —
        // that's the `lstatat` no-follow variant.
        super::CloseOnDrop::new(openat(fd, path, 0, 0)?).stat()
    }
    pub fn access(path: &ZStr, mode: i32) -> Maybe<()> {
        // GetFileAttributesW, then if
        // `(mode & W_OK) != 0` AND the file is read-only AND it is NOT a
        // directory, return `.err = EPERM`.
        const W_OK: i32 = 2;
        let attrs = w::GetFileAttributesW(&super::long_path(path, Tag::access)?)
            .map_err(|err| Error::from_win32(err, Tag::access).with_path(path.as_bytes()))?;
        let is_readonly = (attrs & w::FILE_ATTRIBUTE_READONLY) != 0;
        let is_directory = (attrs & w::FILE_ATTRIBUTE_DIRECTORY) != 0;
        if (mode & W_OK) != 0 && is_readonly && !is_directory {
            return Err(Error::new(E::EPERM, Tag::access).with_path(path.as_bytes()));
        }
        Ok(())
    }
    pub fn faccessat(dir: impl AsFd, sub: &ZStr) -> Maybe<bool> {
        let dir = dir.as_fd();
        // `faccessat` NEVER errors: success → `Ok(true)`, else `Ok(false)`
        // regardless of errno; collapse all errors to `Ok(false)`.
        match openat(dir, sub, O::RDONLY, 0) {
            Ok(fd) => {
                let _ = close(fd);
                Ok(true)
            }
            Err(_) => Ok(false),
        }
    }
    pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let a = atime.sec as f64 + atime.nsec as f64 / 1e9;
        let m = mtime.sec as f64 + mtime.nsec as f64 / 1e9;
        let mut req = uv::fs_t::uninitialized();
        let rc = unsafe {
            uv::uv_fs_utime(
                core::ptr::null_mut(),
                &mut req,
                path.as_ptr().cast::<_>(),
                a,
                m,
                None,
            )
        };
        if let Some(err) = rc.to_error(Tag::utime) {
            return Err(err.with_path(path.as_bytes()));
        }
        Ok(())
    }
    pub fn exists_z(path: &ZStr) -> bool {
        // GetFileAttributesW != INVALID.
        access(path, 0).is_ok()
    }
    pub fn exists_at(dir: impl AsFd, sub: &ZStr) -> bool {
        let dir = dir.as_fd();
        // `exists_at_type(fd, subpath) == File`.
        // Directories yield `false` (resolver/install code uses `existsAt` to
        // mean "a *file* exists here").
        matches!(
            super::exists_at_type(dir, sub),
            Ok(super::ExistsAtType::File)
        )
    }
    pub fn is_executable_file_path(path: &ZStr) -> bool {
        // Convert to wide and call
        // `SaferiIsExecutableFileType(path, FALSE)`. Honors the
        // system security policy and recognizes `.js/.lnk/.pif/.pl/.shs/.url/
        // .vbs/...` in addition to `.exe/.cmd/.bat/.com` . Do NOT hand-roll an extension whitelist —
        // PORTING.md §Forbidden bars re-implementing linked OS API surface.
        let Ok(wpath) = super::win32_path(path, Tag::access) else {
            return false;
        };
        // `bFromShellExecute = FALSE` so `.exe` files are included
        // (https://learn.microsoft.com/en-us/windows/win32/api/winsafer/nf-winsafer-saferiisexecutablefiletype).
        // SAFETY: FFI; wpath is NUL-terminated and valid for the call.
        unsafe { w::SaferiIsExecutableFileType(wpath.as_ptr(), 0) != w::FALSE }
    }
    pub fn get_file_size(fd: Fd) -> Maybe<u64> {
        // GetFileSizeEx.
        let mut size: i64 = 0;
        let ok = unsafe { w::kernel32::GetFileSizeEx(fd.native() as w::HANDLE, &mut size) };
        if ok == 0 {
            return Err(Error::from_win32(w::Win32Error::get(), Tag::fstat).with_fd(fd));
        }
        // Clamp defensively so a
        // negative LARGE_INTEGER never becomes ~18 EB after the i64→u64 cast.
        Ok(size.max(0) as u64)
    }
    pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Maybe<&'a [u8]> {
        // sys_uv.rs:216 — open + GetFinalPathNameByHandle (uv_fs_realpath edge cases).
        let file = super::CloseOnDrop::new(open(path, O::RDONLY, 0)?);
        super::get_fd_path(file.fd(), buf).map(|s| &*s)
    }
    pub fn pipe() -> Maybe<[Fd; 2]> {
        // uv_pipe(fds, 0, 0).
        let mut fds: [uv::uv_file; 2] = [-1, -1];
        let rc = unsafe { uv::uv_pipe(&mut fds, 0, 0) };
        if let Some(err) = rc.to_error(Tag::pipe) {
            return Err(err);
        }
        Ok([Fd::from_uv(fds[0]), Fd::from_uv(fds[1])])
    }
    pub fn isatty(fd: Fd) -> bool {
        // `uv_guess_handle` takes a `uv_file` (CRT int fd); `fd.uv()` PANICS
        // for HANDLE-backed (`FdKind::System`) Fds that are not stdio. Branch
        // on the fd kind: uv-backed → libuv probe, HANDLE-backed →
        // `GetFileType == FILE_TYPE_CHAR` (the canonical Win32 tty test, what
        // `_isatty()` ultimately calls).
        match fd.kind() {
            FdKind::Uv => uv::uv_guess_handle(fd.uv()) == uv::UV_TTY,
            FdKind::System => w::GetFileType(fd.native()) == w::FILE_TYPE_CHAR,
        }
    }
    pub fn lseek(fd: Fd, offset: i64, whence: i32) -> Maybe<i64> {
        // SetFilePointerEx.
        let mut new: i64 = 0;
        let ok = unsafe {
            w::SetFilePointerEx(fd.native() as w::HANDLE, offset, &mut new, whence as u32)
        };
        if ok == 0 {
            return Err(Error::from_win32(w::Win32Error::get(), Tag::lseek).with_fd(fd));
        }
        Ok(new)
    }
    /// `SetFilePointerEx(.., FILE_END)`
    /// returning the new offset as `usize`.
    pub fn set_file_offset_to_end_windows(fd: Fd) -> Maybe<usize> {
        lseek(fd, 0, w::FILE_END as i32).map(|new| usize::try_from(new).expect("int cast"))
    }
    pub fn chdir(path: &ZStr) -> Maybe<()> {
        let mut wpath = super::win32_path(path, Tag::chdir)?;
        // So that `C:` is the root of the drive, and not its saved working directory.
        wpath.push_trailing_sep();
        if unsafe { w::SetCurrentDirectoryW(wpath.as_ptr()) } == 0 {
            return Err(
                Error::from_win32(w::Win32Error::get(), Tag::chdir).with_path(path.as_bytes())
            );
        }
        Ok(())
    }
    pub fn fchdir(fd: Fd) -> Maybe<()> {
        let mut buf = bun_paths::path_buffer_pool::get();
        chdir(super::get_fd_path_z(fd, &mut buf)?)
    }
    pub fn umask(mode: Mode) -> Mode {
        unsafe extern "C" {
            safe fn _umask(m: core::ffi::c_int) -> core::ffi::c_int;
        }
        _umask(mode as core::ffi::c_int) as Mode
    }
    fn recv_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>], flags: i32) -> Maybe<usize> {
        // Winsock `recv`. Winsock's `len` is a
        // signed `int`, so clamp to `i32::MAX` (NOT `MAX_COUNT == u32::MAX`)
        // before the `usize → i32` cast — otherwise ≥2 GiB buffers wrap to a
        // negative length and Winsock fails with WSAEFAULT.
        let len = buf.len().min(i32::MAX as usize) as i32;
        let rc =
            unsafe { w::ws2_32::recv(fd.native() as _, buf.as_mut_ptr().cast::<_>(), len, flags) };
        if rc < 0 {
            return Err(Error::from_win32(w::Win32Error::get(), Tag::recv).with_fd(fd));
        }
        Ok(rc as usize)
    }
    pub(crate) fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize> {
        // Winsock `send`. Clamp to `i32::MAX` so the
        // `usize → i32` cast can't wrap to a negative length on huge buffers.
        let len = buf.len().min(i32::MAX as usize) as i32;
        let rc = unsafe { w::ws2_32::send(fd.native() as _, buf.as_ptr().cast::<_>(), len, flags) };
        if rc < 0 {
            return Err(Error::from_win32(w::Win32Error::get(), Tag::send).with_fd(fd));
        }
        Ok(rc as usize)
    }
    pub(crate) fn recv_non_block_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>]) -> Maybe<usize> {
        recv_uninit(fd, buf, 0)
    }
    pub fn send_non_block(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        send(fd, buf, 0)
    }
    pub type FcntlInt = isize;
}
#[cfg(windows)]
pub use windows_impl::*;

pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
    read_buf(fd, BorrowedBuf::from(buf).unfilled())
}

pub fn read_buf(fd: Fd, mut cursor: BorrowedCursor<'_, u8>) -> Maybe<usize> {
    // SAFETY: the system initializes as many bytes as it reports, and uninitializes none.
    unsafe { read_uninit(fd, cursor.as_mut()).inspect(|&n| _ = cursor.advance(n)) }
}

pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize> {
    pread_buf(fd, BorrowedBuf::from(buf).unfilled(), off)
}

pub fn pread_buf(fd: Fd, mut cursor: BorrowedCursor<'_, u8>, off: i64) -> Maybe<usize> {
    // SAFETY: as in `read_buf`.
    unsafe { pread_uninit(fd, cursor.as_mut(), off).inspect(|&n| _ = cursor.advance(n)) }
}

pub fn recv_non_block_buf(fd: Fd, mut cursor: BorrowedCursor<'_, u8>) -> Maybe<usize> {
    // SAFETY: as in `read_buf`.
    unsafe { recv_non_block_uninit(fd, cursor.as_mut()).inspect(|&n| _ = cursor.advance(n)) }
}

/// Shared inner loop for `read_to_end_into` / `read_to_end_with_array_list`:
/// repeatedly reserve `grow_by` when full, hand the spare capacity to
/// `read_chunk(dst, running_offset)`, and grow `len` by what it filled until
/// `read_chunk` returns 0. Returns total bytes appended.
#[inline]
fn read_fill_vec(
    buf: &mut Vec<u8>,
    grow_by: usize,
    mut read_chunk: impl FnMut(BorrowedCursor<'_, u8>, i64) -> Maybe<usize>,
) -> Maybe<usize> {
    let start = buf.len();
    let mut total: i64 = 0;
    loop {
        if buf.capacity() == buf.len() {
            // Fallible (amortized) growth: OOM propagates as ENOMEM instead of
            // aborting, matching the fallible pre-reservation in the callers.
            if buf.try_reserve(grow_by).is_err() {
                return Err(Error::oom());
            }
        }
        let n = bun_core::vec::append_with(buf, usize::MAX, |spare| read_chunk(spare, total))?;
        if n == 0 {
            return Ok(buf.len() - start);
        }
        total += n as i64;
    }
}

/// The length of an array for C, which then sees no more than it holds.
#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
fn clamp_count(len: usize) -> c_int {
    c_int::try_from(len).unwrap_or(c_int::MAX)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
use linux_syscall as vectored;

#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
mod vectored {
    use super::{Fd, IoVec, IoVecMut, clamp_count, last_errno};
    #[cfg(target_os = "macos")]
    use crate::nocancel as c;
    #[cfg(not(target_os = "macos"))]
    use libc as c;

    fn retry(mut call: impl FnMut() -> isize) -> Result<usize, i32> {
        loop {
            let rc = call();
            if rc >= 0 {
                return Ok(rc as usize);
            }
            let e = last_errno();
            if e != libc::EINTR {
                return Err(e);
            }
        }
    }

    pub(super) fn readv(fd: Fd, vecs: &[IoVecMut<'_>]) -> Result<usize, i32> {
        let (raw, count) = (IoVecMut::as_raw(vecs), clamp_count(vecs.len()));
        // SAFETY: `count` buffers, which may be written.
        retry(|| unsafe { c::readv(fd.native(), raw, count) })
    }

    pub(super) fn writev(fd: Fd, vecs: &[IoVec<'_>]) -> Result<usize, i32> {
        let (raw, count) = (IoVec::as_raw(vecs), clamp_count(vecs.len()));
        // SAFETY: `count` buffers, which may be read.
        retry(|| unsafe { c::writev(fd.native(), raw, count) })
    }

    pub(super) fn preadv(fd: Fd, vecs: &[IoVecMut<'_>], off: i64) -> Result<usize, i32> {
        let (raw, count) = (IoVecMut::as_raw(vecs), clamp_count(vecs.len()));
        // SAFETY: `count` buffers, which may be written.
        retry(|| unsafe { c::preadv(fd.native(), raw, count, off) })
    }

    pub(super) fn pwritev(fd: Fd, vecs: &[IoVec<'_>], off: i64) -> Result<usize, i32> {
        let (raw, count) = (IoVec::as_raw(vecs), clamp_count(vecs.len()));
        // SAFETY: `count` buffers, which may be read.
        retry(|| unsafe { c::pwritev(fd.native(), raw, count, off) })
    }
}

/// `bun.sys.pwritev` — gather-write at `offset`. The write may be short.
pub fn pwritev(fd: Fd, vecs: &[IoVec<'_>], offset: i64) -> Maybe<usize> {
    #[cfg(unix)]
    return vectored::pwritev(fd, vecs, offset).map_err(|e| Error::from_code_int(e, Tag::pwritev));
    #[cfg(windows)]
    return sys_uv::pwritev(fd, vecs, offset);
}

/// `bun.sys.writev` — gather-write. Retries on EINTR
/// (macOS uses `writev$NOCANCEL`).
#[cfg(unix)]
pub fn writev(fd: Fd, vecs: &[IoVec<'_>]) -> Maybe<usize> {
    vectored::writev(fd, vecs).map_err(|e| Error::from_code_int(e, Tag::writev).with_fd(fd))
}

/// `bun.sys.readv` — scatter-read. Retries on EINTR
/// (macOS uses `readv$NOCANCEL`).
#[cfg(unix)]
pub fn readv(fd: Fd, vecs: &[IoVecMut<'_>]) -> Maybe<usize> {
    #[cfg(debug_assertions)]
    if vecs.is_empty() {
        bun_core::debug_warn!("readv() called with 0 length buffer");
    }
    vectored::readv(fd, vecs).map_err(|e| Error::from_code_int(e, Tag::readv).with_fd(fd))
}

/// `bun.sys.preadv` — scatter-read at `position`. Retries on EINTR
/// (macOS uses `preadv$NOCANCEL`).
#[cfg(unix)]
pub fn preadv(fd: Fd, vecs: &[IoVecMut<'_>], position: i64) -> Maybe<usize> {
    #[cfg(debug_assertions)]
    if vecs.is_empty() {
        bun_core::debug_warn!("preadv() called with 0 length buffer");
    }
    vectored::preadv(fd, vecs, position)
        .map_err(|e| Error::from_code_int(e, Tag::preadv).with_fd(fd))
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.StatFS` / `bun.sys.statfs`.
// On POSIX `bun.StatFS` aliases `struct statfs` (Linux/macOS/FreeBSD); on
// Windows it is `uv_statfs_t` populated from `GetDiskFreeSpace` (handled in
// `sys_uv`).
// ──────────────────────────────────────────────────────────────────────────
#[cfg(unix)]
pub type StatFS = libc::statfs;
#[cfg(not(unix))]
pub type StatFS = self::windows::libuv::uv_statfs_t;

/// `bun.sys.statfs` — query filesystem stats for `path`. Retries on EINTR.
///
/// On macOS x86_64, calls `statfs64` instead of `statfs`. libc 0.2.x binds
/// `libc::statfs` to `statfs$INODE64`, and in practice that symbol ends up
/// writing the legacy (pre-Leopard) struct layout into our 64-bit-inode
/// buffer — `bsize=0` and the remaining fields shift by one slot (see
/// oven-sh/bun#31133). `statfs64` is a distinct symbol that always writes
/// the `__DARWIN_STRUCT_STATFS64` layout matching `libc::statfs`. Deprecated
/// on Apple but still exported on x86_64 (unavailable on arm64 macOS, where
/// unsuffixed `statfs` already writes the 64-bit-inode layout).
#[cfg(unix)]
pub fn statfs(path: &ZStr) -> Maybe<StatFS> {
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    unsafe extern "C" {
        #[link_name = "statfs64"]
        fn _statfs(path: *const core::ffi::c_char, buf: *mut libc::statfs) -> core::ffi::c_int;
    }
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    use libc::statfs as _statfs;
    loop {
        let mut st: StatFS = bun_core::ffi::zeroed();
        // SAFETY: `path` is NUL-terminated (`ZStr`); `st` is a valid
        // out-pointer to stack storage that `_statfs` fully initializes.
        let rc = unsafe { _statfs(path.as_ptr(), &raw mut st) };
        if rc < 0 {
            let e = last_errno();
            if e == libc::EINTR {
                continue;
            }
            return Err(Error::from_code_int(e, Tag::statfs).with_path(path.as_bytes()));
        }
        return Ok(st);
    }
}

/// `bun.timespec` — re-exported from `bun_core` so `PosixStat.rs` can spell
/// `crate::Timespec` (matching the `bun.timespec` namespacing).
pub use bun_core::Timespec;
/// `std.time` shim — re-exported from `bun_core` so callers that wrote
/// `bun_sys::time::timestamp()` resolve without an extra dep.
pub use bun_core::time;

unsafe extern "C" {
    // safe: the out-param is a valid `&mut usize`; C++ only writes it and returns a status code.
    safe fn getRSS(rss: &mut usize) -> ::core::ffi::c_int;
    safe fn getPeakRSS(peak: &mut usize) -> ::core::ffi::c_int;
}

/// What `process.memoryUsage().rss` reports, in bytes (C++ `getRSS` in `BunProcess.cpp`), or `None` on failure.
pub fn self_process_memory_usage() -> Option<usize> {
    let mut rss: usize = 0;
    if getRSS(&mut rss) != 0 {
        return None;
    }
    Some(rss)
}

/// High-water mark of [`self_process_memory_usage`], in bytes.
pub fn self_process_peak_memory_usage() -> Option<usize> {
    let mut peak: usize = 0;
    if getPeakRSS(&mut peak) != 0 {
        return None;
    }
    Some(peak)
}

/// `bun.sys.PosixStat` — uv-shaped stat struct.
/// Re-exported here so dependents (`node_fs.rs`, `Stat.rs`) can spell
/// `bun_sys::PosixStat`.
#[path = "PosixStat.rs"]
pub mod posix_stat;
pub use posix_stat::PosixStat;
pub use posix_stat::{stat_atime, stat_birthtime, stat_ctime, stat_mtime};

/// `std::io::Write` adapter for `Fd` (used by `File::buffered_writer`).
/// Port of `File.Writer = std.Io.GenericWriter(File, anyerror, stdIoWrite)`.
pub struct FileWriter(pub Fd);
impl std::io::Write for FileWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        write(self.0, buf).map_err(|e| std::io::Error::from_raw_os_error(e.errno as i32))
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Additional surface unblocked for dependents.
// Symbols are real posix wrappers; Windows arms route
// through the libuv/kernel32 layer in `windows_impl` above.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.sys.Error.Int` — backing integer for `errno`.
pub type ErrorInt = error::Int;
/// Errno enum,
/// aliased to `bun_errno::E` (= `SystemErrno`); variants currently
/// keep the `E` prefix (`EAGAIN` not `AGAIN`). Unprefixed associated consts
/// live on `SystemErrno` directly (errno crate); callers comparing against
/// `Errno::AGAIN`/`Errno::EXIST` rely on those.
pub type Errno = E;

/// `bun.sys.File.SizeHint` — pre-reserve hint for `read_to_end_with_array_list`.
#[derive(Clone, Copy, Debug)]
pub enum SizeHint {
    /// Reserve a small fixed buffer (64B).
    ProbablySmall,
    /// `fstat()` the fd to pre-size the buffer.
    UnknownSize,
}

/// `bun.sys.syslog` — debug-scoped log under `SYS`.
/// `bun_core::scoped_log!` only accepts a bare `$scope:ident`, so we
/// re-expand its body verbatim here with the qualified `$crate::fd::SYS` path
/// and `::bun_core::` helpers — keeping the `[sys] ` tag prefix, trailing-`\n`
/// append, and `pretty_fmt!` ANSI rewrite that
/// `ScopedLogger::log()` does *not* add on its own.
#[macro_export]
macro_rules! syslog {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        // Gate on `env::IS_DEBUG` (== `Environment::ENABLE_LOGS`) — matches
        // bun_core::scoped_log!; there is no `debug_logs` Cargo feature.
        if ::bun_core::env::IS_DEBUG && $crate::fd::SYS.is_visible() {
            const __NL: &str =
                ::bun_core::output::_needs_nl(::bun_core::pretty_fmt!($fmt, false));
            // Branch on ANSI *before* `format_args!` so each `$arg` evaluates
            // exactly once.
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
    #[cfg(unix)]
    pub use super::safe_libc::fchmod;
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    pub use super::safe_libc::posix_fadvise;
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    use core::ffi::c_int;
    #[cfg(target_os = "macos")]
    use core::ffi::c_void;
    // `getuid`/`getgid` take no args and read kernel
    // process state — no preconditions, never fail. Declared locally as
    // `safe fn` (instead of re-exporting the `libc` crate's raw decls) so
    // callers need no per-site proof.
    #[cfg(unix)]
    unsafe extern "C" {
        pub safe fn getuid() -> libc::uid_t;
        pub safe fn getgid() -> libc::gid_t;
    }
    #[cfg(unix)]
    pub use super::UTIME_NOW;
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    pub use libc::{getloadavg, sysctlbyname};

    // Win32 file APIs frequently spelled `bun.C.*` (the namespace flattens
    // a slice of `kernel32` into `bun.C`). Re-export the handful node_fs.rs
    // reaches via `sys::c::*` so the call sites stay target-neutral.
    #[cfg(windows)]
    pub use crate::windows::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT};
    #[cfg(windows)]
    pub use bun_windows_sys::kernel32::SetConsoleCtrlHandler;

    // ── `bun.c` Darwin surface — C symbols picked up via
    // `@cImport` of system headers. The `libc` crate already binds all of
    // these; re-export so callers (`node_os.rs`, `node_fs.rs`, …) keep a
    // single `bun_sys::c::*` import path matching the `bun.c` namespacing.
    #[cfg(target_os = "macos")]
    pub use libc::{
        _NSGetEnviron,
        COPYFILE_ACL,
        COPYFILE_CHECK,
        COPYFILE_CLONE,
        COPYFILE_CLONE_FORCE,
        COPYFILE_DATA,
        COPYFILE_EXCL,
        COPYFILE_METADATA,
        COPYFILE_MOVE,
        COPYFILE_NOFOLLOW,
        COPYFILE_NOFOLLOW_DST,
        COPYFILE_NOFOLLOW_SRC,
        COPYFILE_RECURSIVE,
        COPYFILE_SECURITY,
        COPYFILE_STAT,
        COPYFILE_UNLINK,
        COPYFILE_XATTR,
        CPU_STATE_IDLE,
        CPU_STATE_MAX,
        CPU_STATE_NICE,
        CPU_STATE_SYSTEM,
        CPU_STATE_USER,
        HOST_VM_INFO64,
        HOST_VM_INFO64_COUNT,
        PROCESSOR_CPU_LOAD_INFO,
        // <copyfile.h> / <sys/clonefile.h>
        clonefile,
        clonefileat,
        copyfile,
        copyfile_flags_t,
        copyfile_state_t,
        fclonefileat,
        fcopyfile,
        host_processor_info,
        host_statistics64,
        integer_t,
        mach_msg_type_number_t,
        mach_port_t,
        // <string.h> Apple extensions
        memset_pattern4,
        memset_pattern8,
        memset_pattern16,
        // <mach/*.h> — host/processor/vm primitives for `os.cpus()` & memory stats
        natural_t,
        processor_cpu_load_info,
        processor_cpu_load_info_data_t,
        processor_flavor_t,
        processor_info_array_t,
        // <sys/sysctl.h> — `sysctlbyname` already re-exported above for all BSDs.
        sysctl,
        sysctlnametomib,
        // misc libc
        vm_deallocate,
        vm_size_t,
        vm_statistics64,
        vm_statistics64_data_t,
    };

    /// Safe rc-returning `clonefile(2)` — callers that want their own
    /// `sys::Tag` / path boxing (`errno_sys_p`) take the raw `c_int` instead
    /// of the `Maybe<()>`-shaped [`super::clonefile`].
    #[cfg(target_os = "macos")]
    #[inline]
    pub fn clonefile_rc(src: &bun_core::ZStr, dst: &bun_core::ZStr, flags: u32) -> c_int {
        // SAFETY: `&ZStr` guarantees a readable NUL-terminated buffer.
        unsafe { libc::clonefile(src.as_ptr(), dst.as_ptr(), flags) }
    }
    /// Safe rc-returning `copyfile(3)` with a null state handle.
    #[cfg(target_os = "macos")]
    #[inline]
    pub fn copyfile_rc(
        src: &bun_core::ZStr,
        dst: &bun_core::ZStr,
        flags: libc::copyfile_flags_t,
    ) -> c_int {
        // SAFETY: `&ZStr` guarantees a readable NUL-terminated buffer; `state`
        // may be null per copyfile(3).
        unsafe { libc::copyfile(src.as_ptr(), dst.as_ptr(), core::ptr::null_mut(), flags) }
    }
    /// `PROCESSOR_CPU_LOAD_INFO_COUNT` — sizeof(processor_cpu_load_info)/sizeof(natural_t).
    /// Not bound by `libc`; <mach/processor_info.h>.
    #[cfg(target_os = "macos")]
    pub const PROCESSOR_CPU_LOAD_INFO_COUNT: u32 =
        (core::mem::size_of::<libc::processor_cpu_load_info>()
            / core::mem::size_of::<libc::natural_t>()) as u32;
    /// `<sys/sysctl.h> struct loadavg` — used by `os.loadavg()` via
    /// `vm.loadavg` sysctl. Not bound by `libc`.
    #[cfg(target_os = "macos")]
    #[repr(C)]
    #[derive(Clone, Copy)]
    #[allow(non_camel_case_types)]
    pub struct struct_loadavg {
        pub ldavg: [u32; 3],
        pub fscale: core::ffi::c_long,
    }
    #[cfg(target_os = "macos")]
    bun_core::impl_any_bit_pattern!(struct_loadavg);

    // ── <mach/mach_init.h> / <mach-o/dyld.h> — declared directly because the
    // `libc` crate has deprecated these in favour of the `mach2` crate. We
    // bind the C symbols ourselves so the workspace
    // stays free of an extra dependency and of deprecation noise.
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        /// `extern mach_port_t mach_task_self_` — the task's send right,
        /// cached by libsystem at startup. `mach_task_self()` in C is a macro
        /// that just reads this global. Immutable for the process lifetime →
        /// `safe static` (no read precondition).
        safe static mach_task_self_: libc::mach_port_t;
        /// `mach_port_t mach_host_self(void)` — host privileged port.
        pub safe fn mach_host_self() -> libc::mach_port_t;
        /// `uint32_t _dyld_image_count(void)`
        pub safe fn _dyld_image_count() -> u32;
        /// `intptr_t _dyld_get_image_vmaddr_slide(uint32_t image_index)`
        pub safe fn _dyld_get_image_vmaddr_slide(image_index: u32) -> isize;
        /// `const struct mach_header* _dyld_get_image_header(uint32_t)` — by-value
        /// index; out-of-range returns null (no precondition).
        #[link_name = "_dyld_get_image_header"]
        safe fn dyld_get_image_header_raw(image_index: u32) -> *const core::ffi::c_void;
        /// `const char* _dyld_get_image_name(uint32_t)`: the image's path, which dyld keeps while the image is loaded. Null when out of range.
        pub safe fn _dyld_get_image_name(image_index: u32) -> *const core::ffi::c_char;
    }
    /// `mach_task_self()` — C macro `#define mach_task_self() mach_task_self_`.
    #[cfg(target_os = "macos")]
    #[inline]
    pub fn mach_task_self() -> libc::mach_port_t {
        mach_task_self_
    }
    /// `_dyld_get_image_header(i)` — on 64-bit Darwin every loaded image is
    /// 64-bit, so present it as `*const mach_header_64`.
    #[cfg(target_os = "macos")]
    #[inline]
    pub fn _dyld_get_image_header(image_index: u32) -> *const super::macho::mach_header_64 {
        dyld_get_image_header_raw(image_index).cast()
    }

    /// Darwin `sendfile(fd, s, off, *len, *hdtr, flags)`, without headers or trailers.
    /// NOTE: on `EINTR`/`EAGAIN` the kernel still writes the
    /// bytes-sent count back through `*len` before returning -1 — callers MUST
    /// advance their offset by `*len` even on error. This wrapper is raw (no
    /// EINTR retry); the caller owns the offset bookkeeping.
    #[cfg(target_os = "macos")]
    pub fn sendfile(fd: c_int, s: c_int, off: i64, len: &mut i64, flags: c_int) -> c_int {
        // SAFETY: `len` is live, and a null `hdtr` is allowed.
        unsafe { libc::sendfile(fd, s, off, len, core::ptr::null_mut(), flags) }
    }
    /// FreeBSD `sendfile(fd, s, off, nbytes, *hdtr, *sbytes, flags)`, without headers or trailers.
    #[cfg(target_os = "freebsd")]
    pub fn sendfile(
        fd: c_int,
        s: c_int,
        off: i64,
        nbytes: usize,
        sbytes: &mut i64,
        flags: c_int,
    ) -> c_int {
        // SAFETY: `sbytes` is live, and a null `hdtr` is allowed.
        unsafe { libc::sendfile(fd, s, off, nbytes, core::ptr::null_mut(), sbytes, flags) }
    }

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
    bun_core::impl_zeroable!(struct_proc_bsdinfo);
    #[cfg(target_os = "macos")]
    pub const PROC_PIDTBSDINFO: c_int = 3;
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        /// `proc_pidinfo(pid, flavor, arg, buffer, buffersize)` — bytes written or ≤0.
        pub fn proc_pidinfo(
            pid: c_int,
            flavor: c_int,
            arg: u64,
            buffer: *mut c_void,
            buffersize: c_int,
        ) -> c_int;
        /// `proc_listchildpids(ppid, buffer, buffersize)` — count of pids written.
        pub fn proc_listchildpids(ppid: c_int, buffer: *mut c_void, buffersize: c_int) -> c_int;
    }
}

// ── `linux` — raw kernel syscalls (Linux + Android). ──
// Android: same kernel ABI; bionic exposes all the libc wrappers used here
// (`inotify_*`, `ppoll`, `epoll_*`, `IN_*`, `EPOLL*`, `FUTEX_*`); list both
// `target_os` values.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub mod linux {
    use core::ffi::c_int;
    use core::sync::atomic::AtomicU32;
    pub use libc::epoll_event;
    pub use libc::pollfd;

    // `libc::time_t` is `#[deprecated]` on musl: musl 1.2.0 widened `time_t`
    // to 64-bit on 32-bit arches and the `libc` crate plans to follow (see
    // rust-lang/libc#1848). Bun only ships 64-bit Linux, where the kernel
    // `SYS_futex` timespec is `{ __kernel_long_t; __kernel_long_t; }` and
    // `time_t == c_long == i64` on every libc, so spell it `i64` on musl to
    // sidestep the deprecation without changing layout. The `const _` below
    // guards the layout-identical-to-`libc::timespec` invariant.
    #[cfg(target_env = "musl")]
    type time_t = i64;
    #[cfg(not(target_env = "musl"))]
    type time_t = libc::time_t;

    /// kernel-shaped timespec (`sec`/`nsec`, no `tv_` prefix).
    /// Layout-identical to `libc::timespec`; cast the pointer to that type where
    /// it is passed to a variadic `syscall(SYS_futex, ..)`.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct timespec {
        pub sec: time_t,
        pub nsec: libc::c_long,
    }
    const _: () = assert!(
        core::mem::size_of::<timespec>() == core::mem::size_of::<libc::timespec>()
            && core::mem::align_of::<timespec>() == core::mem::align_of::<libc::timespec>()
    );

    #[inline]
    pub(crate) fn errno() -> c_int {
        super::last_errno()
    }

    /// Kernel errno enum with unprefixed variants and
    /// `init(rc)` decoding the `-errno`-in-return-value Linux raw-syscall ABI.
    /// Newtype (not an alias of `bun_errno::E`) because callers match on
    /// `E::AGAIN`/`E::INTR` (no `E` prefix).
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct E(pub(crate) u16);
    impl E {
        pub const SUCCESS: E = E(0);
        pub const PERM: E = E(libc::EPERM as u16);
        pub const NOENT: E = E(libc::ENOENT as u16);
        pub const INTR: E = E(libc::EINTR as u16);
        pub const AGAIN: E = E(libc::EAGAIN as u16);
        pub const NOMEM: E = E(libc::ENOMEM as u16);
        pub const FAULT: E = E(libc::EFAULT as u16);
        pub const INVAL: E = E(libc::EINVAL as u16);
        pub const NOSYS: E = E(libc::ENOSYS as u16);
        pub const TIMEDOUT: E = E(libc::ETIMEDOUT as u16);
        /// Decode a raw Linux syscall return (`-errno` on failure, ≥0 on success).
        #[inline]
        pub fn init(rc: isize) -> E {
            let u = rc as usize;
            if u > (-4096isize) as usize {
                E((u.wrapping_neg()) as u16)
            } else {
                E::SUCCESS
            }
        }
    }
    impl From<E> for &'static str {
        fn from(e: E) -> &'static str {
            bun_errno::SystemErrno::init(e.0 as i64)
                .map(<&str>::from)
                .unwrap_or("UNKNOWN")
        }
    }

    // ── epoll ──
    /// epoll flag/op constants.
    pub mod EPOLL {
        pub const IN: u32 = libc::EPOLLIN as u32;
        pub const OUT: u32 = libc::EPOLLOUT as u32;
        pub const PRI: u32 = libc::EPOLLPRI as u32;
        pub const ERR: u32 = libc::EPOLLERR as u32;
        pub const HUP: u32 = libc::EPOLLHUP as u32;
        pub const RDHUP: u32 = libc::EPOLLRDHUP as u32;
        pub const ET: u32 = libc::EPOLLET as u32;
        pub const ONESHOT: u32 = libc::EPOLLONESHOT as u32;
        pub const CTL_ADD: i32 = libc::EPOLL_CTL_ADD;
        pub const CTL_MOD: i32 = libc::EPOLL_CTL_MOD;
    }
    // ── futex ──
    /// `libc::syscall` returns `-1` and sets errno, where the kernel returns the `-errno` that `E::init` decodes.
    #[inline]
    fn kernel_rc(rc: libc::c_long) -> isize {
        if rc == -1 {
            -(errno() as isize)
        } else {
            rc as isize
        }
    }
    /// `FUTEX_WAKE_PRIVATE`. `word` need not be live. Decode with `E::init`.
    #[inline]
    pub fn futex_wake(word: *const AtomicU32, max_waiters: u32) -> isize {
        let op = libc::FUTEX_WAKE | libc::FUTEX_PRIVATE_FLAG;
        // SAFETY: the address is only a key (`get_futex_key`), and whoever waits expects spurious wakes.
        kernel_rc(unsafe { libc::syscall(libc::SYS_futex, word.cast::<u32>(), op, max_waiters) })
    }
    /// `FUTEX_WAIT_PRIVATE`. Decode with `E::init`.
    #[inline]
    pub fn futex_wait(word: &AtomicU32, expect: u32, timeout: Option<&timespec>) -> isize {
        let op = libc::FUTEX_WAIT | libc::FUTEX_PRIVATE_FLAG;
        let timeout = timeout.map_or(core::ptr::null(), core::ptr::from_ref);
        // `syscall` is variadic, and Miri checks the pointee type of each argument
        // against the one the kernel interface declares: `libc::timespec` here.
        let timeout = timeout.cast::<libc::timespec>();
        // SAFETY: the kernel reads `word` atomically; `timeout` is null or live.
        kernel_rc(unsafe { libc::syscall(libc::SYS_futex, word.as_ptr(), op, expect, timeout) })
    }

    /// inotify mask flags (`IN_*`).
    pub mod IN {
        pub const ACCESS: u32 = libc::IN_ACCESS;
        pub const MODIFY: u32 = libc::IN_MODIFY;
        pub const ATTRIB: u32 = libc::IN_ATTRIB;
        pub const CLOSE_WRITE: u32 = libc::IN_CLOSE_WRITE;
        pub const CLOSE_NOWRITE: u32 = libc::IN_CLOSE_NOWRITE;
        pub const OPEN: u32 = libc::IN_OPEN;
        pub const MOVED_FROM: u32 = libc::IN_MOVED_FROM;
        pub const MOVED_TO: u32 = libc::IN_MOVED_TO;
        pub const CREATE: u32 = libc::IN_CREATE;
        pub const DELETE: u32 = libc::IN_DELETE;
        pub const DELETE_SELF: u32 = libc::IN_DELETE_SELF;
        pub const MOVE_SELF: u32 = libc::IN_MOVE_SELF;
        pub const ONLYDIR: u32 = libc::IN_ONLYDIR;
        pub const DONT_FOLLOW: u32 = libc::IN_DONT_FOLLOW;
        pub const EXCL_UNLINK: u32 = libc::IN_EXCL_UNLINK;
        pub const MASK_ADD: u32 = libc::IN_MASK_ADD;
        pub const ISDIR: u32 = libc::IN_ISDIR;
        pub const ONESHOT: u32 = libc::IN_ONESHOT;
        pub const IGNORED: u32 = libc::IN_IGNORED;
        pub const Q_OVERFLOW: u32 = libc::IN_Q_OVERFLOW;
        pub const CLOEXEC: c_int = libc::IN_CLOEXEC;
        pub const NONBLOCK: c_int = libc::IN_NONBLOCK;
        use core::ffi::c_int;
    }

    #[inline]
    pub fn inotify_init1(flags: c_int) -> c_int {
        crate::safe_libc::inotify_init1(flags)
    }
    #[inline]
    pub fn inotify_add_watch(fd: c_int, path: &bun_core::ZStr, mask: u32) -> c_int {
        // SAFETY: `path` is NUL-terminated.
        unsafe { libc::inotify_add_watch(fd, path.as_ptr(), mask) }
    }
    #[inline]
    pub fn inotify_rm_watch(fd: c_int, wd: c_int) -> c_int {
        // bionic declares `wd` as `uint32_t`, glibc/musl as `int`; the kernel
        // ABI is the same `__s32` either way — `safe_libc::inotify_rm_watch`
        // declares it `c_int`, which is ABI-correct on every Linux libc.
        crate::safe_libc::inotify_rm_watch(fd, wd)
    }
    /// Raw `read(2)`; libc-convention return, decoded by `GetErrno for isize`.
    #[inline]
    pub fn read(fd: c_int, buf: &mut [u8]) -> isize {
        super::linux_syscall::read_raw(fd, buf)
    }
    /// Raw `splice(2)` at the position of each file; libc-convention return.
    #[inline]
    pub fn splice(in_fd: c_int, out_fd: c_int, len: usize) -> isize {
        let no_offset = core::ptr::null_mut();
        // SAFETY: both offsets may be null.
        unsafe { libc::splice(in_fd, no_offset, out_fd, no_offset, len, 0) }
    }
    /// Whether the blocks are reserved. No retry: tmpfs starts again after each signal.
    pub fn fallocate(fd: c_int, offset: i64, len: i64) -> bool {
        crate::safe_libc::fallocate(fd, 0, offset, len) == 0
    }
    /// Raw `sendfile(out, in, *offset, count)`. With an `offset`, the kernel reads and updates it.
    #[inline]
    pub fn sendfile(out_fd: c_int, in_fd: c_int, offset: Option<&mut i64>, count: usize) -> isize {
        super::linux_syscall::sendfile(out_fd, in_fd, offset, count)
    }
    /// Raw `ppoll(fds, nfds, *timeout, *sigmask)`.
    #[inline]
    pub fn ppoll(
        fds: &mut [pollfd],
        timeout: Option<&libc::timespec>,
        sigmask: Option<&libc::sigset_t>,
    ) -> c_int {
        let timeout = timeout.map_or(core::ptr::null(), core::ptr::from_ref);
        let sigmask = sigmask.map_or(core::ptr::null(), core::ptr::from_ref);
        // SAFETY: `fds` is writable for `fds.len()` entries; `timeout` and `sigmask` are null or live.
        unsafe { libc::ppoll(fds.as_mut_ptr(), fds.len() as _, timeout, sigmask) }
    }
    /// `prctl(2)` operations (`PR_*`) that take at most one integer argument.
    #[derive(Clone, Copy)]
    #[repr(i32)]
    pub enum PrctlOp {
        SET_PDEATHSIG = libc::PR_SET_PDEATHSIG,
        SET_CHILD_SUBREAPER = libc::PR_SET_CHILD_SUBREAPER,
        SET_NO_NEW_PRIVS = libc::PR_SET_NO_NEW_PRIVS,
        GET_NO_NEW_PRIVS = libc::PR_GET_NO_NEW_PRIVS,
        SET_MDWE = libc::PR_SET_MDWE,
        GET_MDWE = libc::PR_GET_MDWE,
    }
    /// `prctl(op, arg, 0, 0, 0)` — libc-convention return.
    pub fn prctl(op: PrctlOp, arg: libc::c_ulong) -> c_int {
        const UNUSED: libc::c_ulong = 0;
        // SAFETY: no `PrctlOp` takes a pointer, and each argument is the `unsigned long` that libc reads.
        unsafe { libc::prctl(op as c_int, arg, UNUSED, UNUSED, UNUSED) }
    }
    /// # Safety
    /// Whoever waits on `epfd` gets `event.u64` back and may dereference it. It must be what they
    /// expect for as long as `fd` is registered, and until they are done with the events that
    /// they had fetched by then.
    #[inline]
    pub unsafe fn epoll_ctl(epfd: c_int, op: c_int, fd: c_int, event: &epoll_event) -> c_int {
        // SAFETY: the caller's contract.
        unsafe { super::linux_syscall::epoll_ctl(epfd, op, fd, Some(event)) }
    }
    #[inline]
    pub fn epoll_ctl_del(epfd: c_int, fd: c_int) -> c_int {
        // SAFETY: CTL_DEL registers nothing.
        unsafe { super::linux_syscall::epoll_ctl(epfd, libc::EPOLL_CTL_DEL, fd, None) }
    }

    // ── raw syscall thunks ──
    // `ioctl`/`copy_file_range` here are *true* raw
    // syscalls returning the kernel `-errno`-in-`usize` ABI. glibc's
    // `libc::syscall()` is NOT — it returns `-1` and sets thread-local errno
    // on failure. Returning `isize` here routes callers through the
    // libc-convention `GetErrno for isize` impl (reads `errno`), instead of
    // the kernel-convention `GetErrno for usize` impl which would mis-decode
    // every failure as EPERM (`-1 as usize` → errno 1).

    /// `bun.linux.ioctl_ficlone`: raw FICLONE ioctl.
    /// Support for FICLONE is dependent on the filesystem driver.
    #[inline]
    pub fn ioctl_ficlone(dest_fd: super::Fd, src_fd: super::Fd) -> isize {
        // FICLONE = _IOW(0x94, 9, c_int).
        const FICLONE: libc::c_ulong = 0x40049409;
        // SAFETY: raw `ioctl(2)`; both fds owned by caller.
        unsafe {
            libc::syscall(
                libc::SYS_ioctl,
                dest_fd.native() as libc::c_long,
                FICLONE,
                src_fd.native() as libc::c_long,
            ) as isize
        }
    }

    /// `copy_file_range` raw syscall.
    #[inline]
    pub fn copy_file_range(
        in_: c_int,
        off_in: Option<&mut i64>,
        out: c_int,
        off_out: Option<&mut i64>,
        len: usize,
        flags: u32,
    ) -> isize {
        super::linux_syscall::copy_file_range(in_, off_in, out, off_out, len, flags)
    }

    // sendfile — use the existing `linux::sendfile` (libc
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
                    // Kernels 5.9/5.10 have a buggy
                    // RWF_NOWAIT (returns EAGAIN spuriously); disable on those.
                    let v = bun_core::linux_kernel_version();
                    let buggy = v.major == 5 && (v.minor == 9 || v.minor == 10);
                    // BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK env override.
                    let env_off = bun_core::getenv_z(bun_core::zstr!(
                        "BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK"
                    ))
                    .is_some();
                    let r = if buggy || env_off { -1 } else { 1 };
                    RWF_STATE.store(r, core::sync::atomic::Ordering::Relaxed);
                    r > 0
                }
                s => s > 0,
            }
        }
        #[inline]
        pub(crate) fn disable() {
            RWF_STATE.store(-1, core::sync::atomic::Ordering::Relaxed);
        }
    }
}
#[cfg(not(any(target_os = "linux", target_os = "android")))]
pub mod linux {
    // Empty on non-Linux; callers gate on `cfg(target_os = "linux")` (or
    // `linux | android` for the Linux-kernel surface).
}

// ── `bun.darwin` — Darwin-only platform surface. ──
#[cfg(target_os = "macos")]
pub mod darwin {
    use core::ffi::{c_char, c_int, c_void};
    use core::sync::atomic::AtomicU32;

    bun_opaque::opaque_ffi! {
        /// Opaque `os_log_t` handle (`<os/log.h>`).
        pub struct OSLog;
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
        pub fn signpost(&self, name: i32) -> os_log::Signpost<'_> {
            os_log::Signpost { log: self, name }
        }
    }
    /// kqueue filter constants.
    pub mod EVFILT {
        pub const READ: i16 = libc::EVFILT_READ;
        pub const WRITE: i16 = libc::EVFILT_WRITE;
        pub const VNODE: i16 = libc::EVFILT_VNODE;
        pub const PROC: i16 = libc::EVFILT_PROC;
        pub const SIGNAL: i16 = libc::EVFILT_SIGNAL;
        pub const TIMER: i16 = libc::EVFILT_TIMER;
        pub const USER: i16 = libc::EVFILT_USER;
        pub const MACHPORT: i16 = libc::EVFILT_MACHPORT;
        /// xnu-private filter used by libdispatch's `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE`.
        /// Not in `<sys/event.h>` (only `<sys/event_private.h>`), so hard-code the value.
        pub const MEMORYSTATUS: i16 = -14;
    }
    /// kqueue event flags (Darwin).
    pub mod EV {
        pub const ADD: u16 = libc::EV_ADD;
        pub const DELETE: u16 = libc::EV_DELETE;
        pub const ENABLE: u16 = libc::EV_ENABLE;
        pub const DISABLE: u16 = libc::EV_DISABLE;
        pub const ONESHOT: u16 = libc::EV_ONESHOT;
        pub const CLEAR: u16 = libc::EV_CLEAR;
        pub const RECEIPT: u16 = libc::EV_RECEIPT;
        pub const DISPATCH: u16 = libc::EV_DISPATCH;
        pub const EOF: u16 = libc::EV_EOF;
        pub const ERROR: u16 = libc::EV_ERROR;
    }
    /// kqueue fflags (Darwin).
    pub mod NOTE {
        pub const EXIT: u32 = libc::NOTE_EXIT;
        pub const EXITSTATUS: u32 = libc::NOTE_EXITSTATUS;
        pub const SIGNAL: u32 = libc::NOTE_SIGNAL;
        pub const FORK: u32 = libc::NOTE_FORK;
        pub const EXEC: u32 = libc::NOTE_EXEC;
        pub const TRIGGER: u32 = libc::NOTE_TRIGGER;
        pub const DELETE: u32 = libc::NOTE_DELETE;
        pub const WRITE: u32 = libc::NOTE_WRITE;
        pub const EXTEND: u32 = libc::NOTE_EXTEND;
        pub const ATTRIB: u32 = libc::NOTE_ATTRIB;
        pub const LINK: u32 = libc::NOTE_LINK;
        pub const RENAME: u32 = libc::NOTE_RENAME;
        pub const REVOKE: u32 = libc::NOTE_REVOKE;
        /// `EVFILT_MEMORYSTATUS` fflags (xnu `<sys/event_private.h>`). Values are
        /// ABI-stable; libdispatch depends on them for `DISPATCH_MEMORYPRESSURE_*`.
        pub const MEMORYSTATUS_PRESSURE_NORMAL: u32 = 0x00000001;
        pub const MEMORYSTATUS_PRESSURE_WARN: u32 = 0x00000002;
        pub const MEMORYSTATUS_PRESSURE_CRITICAL: u32 = 0x00000004;
    }
    /// Re-export of the platform errno enum so `bun_threading::Futex` can
    /// match `c::E::INTR` etc. against `__ulock_*` return codes.
    pub use bun_errno::E;

    /// Thin re-exports so `bun.darwin.ftruncate`/`bun.darwin.truncate` call
    /// sites (blob/copy_file.rs) resolve without a direct `libc` dep.
    pub use libc::{ftruncate, truncate};

    /// `bun.darwin.COPYFILE` — packed-u32 set of <copyfile.h> flags.
    /// Kept as a plain struct + `.bits()` so call sites can use field-init
    /// syntax; convert to `u32` at the FFI boundary.
    #[derive(Clone, Copy, Default)]
    #[allow(non_snake_case)]
    pub struct COPYFILE {
        pub acl: bool,
        pub stat: bool,
        pub xattr: bool,
        pub data: bool,
        pub excl: bool,
        pub nofollow_src: bool,
        pub nofollow_dst: bool,
        pub move_: bool,
        pub unlink: bool,
        pub clone: bool,
        pub clone_force: bool,
    }
    impl COPYFILE {
        #[inline]
        pub const fn bits(self) -> u32 {
            (self.acl as u32)
                | (self.stat as u32) << 1
                | (self.xattr as u32) << 2
                | (self.data as u32) << 3
                | (self.excl as u32) << 17
                | (self.nofollow_src as u32) << 18
                | (self.nofollow_dst as u32) << 19
                | (self.move_ as u32) << 20
                | (self.unlink as u32) << 21
                | (self.clone as u32) << 24
                | (self.clone_force as u32) << 25
        }
    }
    impl From<COPYFILE> for u32 {
        #[inline]
        fn from(f: COPYFILE) -> u32 {
            f.bits()
        }
    }

    // <xnu/bsd/sys/ulock.h>
    const UL_COMPARE_AND_WAIT: u32 = 1;
    const ULF_WAKE_ALL: u32 = 1 << 8;
    const ULF_NO_ERRNO: u32 = 1 << 24;
    unsafe extern "C" {
        // Private libSystem symbols (stable since 10.12; `__ulock_wait2` since 11.0).
        fn __ulock_wait2(
            operation: u32,
            addr: *const c_void,
            value: u64,
            timeout_ns: u64,
            value2: u64,
        ) -> c_int;
        fn __ulock_wake(operation: u32, addr: *const c_void, wake_value: u64) -> c_int;
    }
    /// A `timeout_ns` of 0 never expires. An error is `-errno`.
    #[inline]
    pub fn ulock_wait(word: &AtomicU32, expect: u32, timeout_ns: u64) -> c_int {
        let operation = UL_COMPARE_AND_WAIT | ULF_NO_ERRNO;
        // SAFETY: the kernel reads `word` atomically.
        unsafe {
            __ulock_wait2(
                operation,
                word.as_ptr().cast(),
                expect.into(),
                timeout_ns,
                0,
            )
        }
    }
    /// `word` need not be live. An error is `-errno`.
    #[inline]
    pub fn ulock_wake(word: *const AtomicU32, all: bool) -> c_int {
        let operation = UL_COMPARE_AND_WAIT | ULF_NO_ERRNO | if all { ULF_WAKE_ALL } else { 0 };
        // SAFETY: the address is only a key, and whoever waits expects spurious wakes.
        unsafe { __ulock_wake(operation, word.cast(), 0) }
    }

    /// Darwin `struct kevent64_s` (extended kevent with 2-slot `ext[]`).
    pub use libc::kevent64_s;
    /// SAFETY: as [`crate::kevent`]. What `ext` points to is valid for as long as the change is registered.
    #[inline]
    pub unsafe fn kevent64(
        kq: c_int,
        changelist: &[kevent64_s],
        eventlist: &mut [kevent64_s],
        flags: core::ffi::c_uint,
        timeout: Option<&libc::timespec>,
    ) -> c_int {
        // SAFETY: the slices and `timeout` are live. The caller answers for each change.
        unsafe {
            libc::kevent64(
                kq,
                changelist.as_ptr(),
                super::clamp_count(changelist.len()),
                eventlist.as_mut_ptr(),
                super::clamp_count(eventlist.len()),
                flags,
                timeout.map_or(core::ptr::null(), core::ptr::from_ref),
            )
        }
    }

    pub mod os_log {
        pub struct Signpost<'a> {
            pub log: &'a super::OSLog,
            pub name: i32,
        }
        impl<'a> Signpost<'a> {
            pub fn interval(&self, _cat: signpost::Category) -> signpost::Interval {
                signpost::Interval { _p: () }
            }
        }
        pub mod signpost {
            #[derive(Clone, Copy)]
            #[repr(u8)]
            pub enum Category {
                PointsOfInterest = 0,
            }
            pub struct Interval {
                pub(crate) _p: (),
            }
            impl Interval {
                pub fn end(&self) {}
            }
        }
    }
}
#[cfg(not(target_os = "macos"))]
pub mod darwin {}

// ── Mach-O header parsing (subset). ──────────────────────────────────────
// Just the slice that the crash handler uses to
// walk dyld load commands and resolve a stable (ASLR-unslid) address for
// `addr2line`. Only the 64-bit forms are present; Bun does not ship 32-bit
// Darwin binaries.
//
// Compiled on every host (not just macOS): the cross-platform exe writer
// (`bun_exe_format::macho`) re-exports these constants/POD when emitting a
// Mach-O `--compile` target from a Linux/Windows build machine.
#[allow(non_camel_case_types, non_snake_case)]
pub mod macho {
    pub type cpu_type_t = i32;
    pub type cpu_subtype_t = i32;
    pub type vm_prot_t = i32;

    /// `LC_SEGMENT_64` — 64-bit segment load command.
    pub const LC_SEGMENT_64: u32 = 0x19;

    /// `<mach/vm_prot.h> VM_PROT_EXECUTE`.
    const VM_PROT_EXECUTE: vm_prot_t = 0x04;

    /// `<mach-o/loader.h> mach_header_64`. Layout matches libc's
    /// `mach_header_64`.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct mach_header_64 {
        pub magic: u32,
        pub cputype: cpu_type_t,
        pub cpusubtype: cpu_subtype_t,
        pub filetype: u32,
        pub ncmds: u32,
        pub sizeofcmds: u32,
        pub flags: u32,
        pub reserved: u32,
    }

    /// `<mach-o/loader.h> load_command` — common header preceding every
    /// load command.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct load_command {
        pub cmd: u32,
        pub(crate) cmdsize: u32,
    }

    /// `<mach-o/loader.h> segment_command_64`.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct segment_command_64 {
        pub cmd: u32,
        pub cmdsize: u32,
        pub(crate) segname: [u8; 16],
        pub vmaddr: u64,
        pub vmsize: u64,
        pub fileoff: u64,
        pub filesize: u64,
        pub maxprot: vm_prot_t,
        pub initprot: vm_prot_t,
        pub nsects: u32,
        pub flags: u32,
    }
    bun_core::impl_pod!(mach_header_64, load_command, segment_command_64);
    impl segment_command_64 {
        /// Segment name with trailing NULs trimmed.
        #[inline]
        pub fn seg_name(&self) -> &[u8] {
            bun_core::slice_to_nul(&self.segname)
        }
    }

    /// One parsed load command: header + bytes (header included).
    #[derive(Clone, Copy)]
    pub struct LoadCommand<'a> {
        pub hdr: load_command,
        pub data: &'a [u8],
        /// Byte offset of this command within the buffer passed to
        /// `LoadCommandIterator::new`.
        pub offset: usize,
    }
    impl LoadCommand<'_> {
        #[inline]
        pub fn cmd(&self) -> u32 {
            self.hdr.cmd
        }
        /// The command bytes as a `T`, if there are enough of them. A copy: the bytes have no alignment.
        pub fn cast<T: bun_core::AnyBitPattern>(&self) -> Option<T> {
            bun_core::read_prefix(self.data)
        }
    }

    /// Walks the load-command region
    /// that immediately follows a `mach_header_64`.
    pub struct LoadCommandIterator<'a> {
        ncmds: u32,
        rest: &'a [u8],
        offset: usize,
    }
    impl<'a> LoadCommandIterator<'a> {
        #[inline]
        pub fn new(ncmds: u32, buffer: &'a [u8]) -> Self {
            Self {
                ncmds,
                rest: buffer,
                offset: 0,
            }
        }
    }
    impl<'a> Iterator for LoadCommandIterator<'a> {
        type Item = LoadCommand<'a>;

        /// Ends at a malformed header as it does after the last command.
        fn next(&mut self) -> Option<LoadCommand<'a>> {
            self.ncmds = self.ncmds.checked_sub(1)?;
            let hdr: load_command = bun_core::read_prefix(self.rest)?;
            let (data, rest) = self.rest.split_at_checked(hdr.cmdsize as usize)?;
            if data.len() < core::mem::size_of::<load_command>() {
                return None;
            }
            let offset = self.offset;
            self.rest = rest;
            self.offset += data.len();
            Some(LoadCommand { hdr, data, offset })
        }
    }

    /// Returns the offset of `address` from the start of the image's code, or `None` if the
    /// address isn't in the code. `address` is unslid, like the addresses in the load commands.
    ///
    /// A linker emits one code segment. `bun build --compile --trim` splits it into several,
    /// with gaps between them.
    pub fn offset_in_code(ncmds: u32, commands: &[u8], address: u64) -> Option<u64> {
        let mut code_segments = LoadCommandIterator::new(ncmds, commands)
            .filter(|command| command.cmd() == LC_SEGMENT_64)
            .filter_map(|command| command.cast::<segment_command_64>())
            .filter(|segment| segment.initprot & VM_PROT_EXECUTE != 0)
            .peekable();
        let code_start = code_segments.peek()?.vmaddr;
        code_segments
            .any(|segment| address.wrapping_sub(segment.vmaddr) < segment.vmsize)
            .then(|| address.wrapping_sub(code_start))
    }
}

/// A loaded library.
pub struct DynLib {
    handle: *mut c_void,
}
// SAFETY: `handle` is an opaque OS handle from `dlopen`/`LoadLibrary`. The
// underlying loader is process-global and internally synchronized; `dlsym`/
// `GetProcAddress` may be called from any thread. Matches `std::DynLib`.
unsafe impl Send for DynLib {}
// SAFETY: see `Send` above — the OS loader is process-global and internally
// synchronized, so `&DynLib` may be shared across threads.
unsafe impl Sync for DynLib {}
impl DynLib {
    /// `RTLD_DEFAULT`: all that the process has loaded globally.
    #[cfg(unix)]
    pub const GLOBAL: &'static DynLib = &DynLib {
        handle: libc::RTLD_DEFAULT,
    };

    /// `dlopen(path, RTLD_LAZY)` / `LoadLibraryW(path)`.
    ///
    /// SAFETY: as [`Self::open_with_flags`].
    pub unsafe fn open(path: &[u8]) -> core::result::Result<Self, bun_errno::SystemErrno> {
        // The loader copies the name to the stack.
        if path.len() >= bun_paths::MAX_PATH_BYTES {
            return Err(bun_errno::SystemErrno::ENAMETOOLONG);
        }
        let path = bun_paths::Path::from(path);
        // SAFETY: the caller's contract.
        unsafe { Self::open_with_flags(&path, RTLD::LAZY) }.ok_or(bun_errno::SystemErrno::ENOENT)
    }
    /// `dlopen(filename, flags)`. Windows → `LoadLibraryExW` (UTF-8 → UTF-16).
    ///
    /// SAFETY: the code that the library runs when it is loaded, searched and unloaded is sound in this process.
    pub unsafe fn open_with_flags(filename: &ZStr, flags: i32) -> Option<Self> {
        // SAFETY: filename is NUL-terminated. The caller answers for the library.
        #[cfg(unix)]
        let handle = unsafe { libc::dlopen(filename.as_ptr(), flags) };
        #[cfg(windows)]
        let handle = {
            let _ = flags;
            let wpath = win32_path(filename, Tag::open).ok()?;
            // As `uv_dlopen`: dependent DLLs resolve next to the module. Undefined for a relative path.
            const LOAD_WITH_ALTERED_SEARCH_PATH: u32 = 0x0000_0008;
            let dw_flags = if bun_paths::is_absolute(filename.as_bytes()) {
                LOAD_WITH_ALTERED_SEARCH_PATH
            } else {
                0
            };
            // SAFETY: `wpath` is NUL-terminated; `hFile` is reserved (NULL). The caller answers for the library.
            unsafe {
                bun_windows_sys::kernel32::LoadLibraryExW(
                    wpath.as_ptr(),
                    core::ptr::null_mut(),
                    dw_flags,
                )
            }
            .cast::<c_void>()
        };
        if handle.is_null() {
            return None;
        }
        Some(Self { handle })
    }
    /// The library stays loaded.
    pub fn leak(self) -> core::mem::ManuallyDrop<Self> {
        core::mem::ManuallyDrop::new(self)
    }
    /// The address of a symbol.
    pub fn lookup(&self, name: &ZStr) -> Option<*mut c_void> {
        #[cfg(windows)]
        use bun_windows_sys::externs::GetProcAddress as dlsym;
        #[cfg(unix)]
        use libc::dlsym;
        // SAFETY: the library is loaded, and `name` is NUL-terminated.
        let address = unsafe { dlsym(self.handle, name.as_ptr()) };
        (!address.is_null()).then_some(address)
    }
    /// SAFETY: `T` is a pointer to what the symbol names, and is not used after `self` is dropped.
    pub unsafe fn lookup_as<T>(&self, name: &ZStr) -> Option<T> {
        const { assert!(core::mem::size_of::<T>() == core::mem::size_of::<*mut c_void>()) };
        let address = self.lookup(name)?;
        // SAFETY: the caller's contract. `address` is not null.
        Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&address) })
    }
}

/// On Windows the library stays loaded.
#[cfg(unix)]
impl Drop for DynLib {
    fn drop(&mut self) {
        // SAFETY: the handle is from `dlopen`, since nobody owns `GLOBAL`.
        unsafe { libc::dlclose(self.handle) };
    }
}

/// `RTLD_*` flags for `dlopen`.
#[cfg(unix)]
pub mod RTLD {
    pub const LAZY: i32 = libc::RTLD_LAZY;
    pub const LOCAL: i32 = libc::RTLD_LOCAL;
}
#[cfg(windows)]
pub mod RTLD {
    // Windows `LoadLibrary` ignores these; provided so cross-platform call
    // sites compile. Values match POSIX so any bitmask logic stays inert.
    pub const LAZY: i32 = 0x1;
    pub const LOCAL: i32 = 0;
}

// ── open helpers (posix arms) ──

/// `openA` — like `open` but takes a non-NUL-terminated slice.
pub fn open_a(path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    openat_a(Fd::cwd(), path, flags, perm)
}
/// `openatA` — like `openat` but takes a non-NUL-terminated slice.
pub fn openat_a(dir: impl AsFd, path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    openat(dir.as_fd(), &bun_paths::Path::from(path), flags, perm)
}
/// `openatOSPath` — `openat` taking a platform-native path
/// (`OSPathSliceZ` = `ZStr` on POSIX, `WStr` on Windows). On POSIX this is
/// identical to `openat`; on Windows it routes through the NT openat path.
#[cfg(not(windows))]
#[inline]
pub fn openat_os_path(
    dirfd: Fd,
    file_path: &bun_paths::OSPathSliceZ,
    flags: i32,
    perm: Mode,
) -> Maybe<Fd> {
    openat(dirfd, file_path, flags, perm)
}
#[cfg(windows)]
#[inline]
pub fn openat_os_path(
    dirfd: Fd,
    file_path: &bun_paths::OSPathSliceZ,
    flags: i32,
    perm: Mode,
) -> Maybe<Fd> {
    openat_windows(dirfd, file_path.as_slice(), flags, perm)
}
/// `mkdiratZ` — `mkdirat` with already-NUL-terminated path. Same as `mkdirat`.
#[inline]
pub fn mkdirat_z(dir: impl AsFd, path: &ZStr, mode: Mode) -> Maybe<()> {
    let dir = dir.as_fd();
    mkdirat(dir, path, mode)
}
/// `openDirA` — open a path as an iterable directory fd.
pub fn open_dir_at(dir: impl AsFd, path: &[u8]) -> Maybe<Fd> {
    let dir = dir.as_fd();
    openat_a(dir, path, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0)
}
/// `openDirAbsolute`. Returns an `Fd`.
pub fn open_dir_absolute(path: &[u8]) -> Maybe<Fd> {
    open_a(path, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0)
}
/// `symlinkRunningExecutable` — same as `symlink`, except it
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
/// Best-effort recursive delete of an absolute
/// path. Routes through `Dir::delete_tree` on the parent directory.
pub fn delete_tree_absolute(path: &[u8]) -> Maybe<()> {
    let Some(parent) = bun_paths::dirname(path) else {
        // Nothing sensible to do (root or empty); silent success.
        return Ok(());
    };
    let dir = open_dir_absolute(parent).map(Dir::from_fd)?;
    dir.delete_tree(bun_paths::basename(path))
}
/// Windows variant skips `DELETE` access; on POSIX identical.
pub fn open_dir_absolute_not_for_deleting_or_renaming(path: &[u8]) -> Maybe<Fd> {
    open_dir_absolute(path)
}
/// `openDirNoRenamingOrDeletingWindows` — open `path` relative to
/// `dir` for iteration only (no `DELETE` access). Windows-only; callers gate.
#[cfg(windows)]
pub fn open_dir_no_renaming_or_deleting_windows(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    open_dir_at_windows_a(
        dir,
        path,
        WindowsOpenDirOptions {
            iterable: true,
            can_rename_or_delete: false,
            ..Default::default()
        },
    )
}
// ──────────────────────────────────────────────────────────────────────────
// `openatWindows` family. Maps POSIX-style `O::*` flags
// onto an `NtCreateFile` call (or `openDirAtWindows` when `O_DIRECTORY` is
// set). The surface is gated to Windows.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
const FILE_SHARE: u32 = bun_windows_sys::FILE_SHARE_READ
    | bun_windows_sys::FILE_SHARE_WRITE
    | bun_windows_sys::FILE_SHARE_DELETE;

#[cfg(windows)]
#[derive(Clone, Copy, Default)]
pub struct WindowsOpenDirOptions {
    pub iterable: bool,
    pub no_follow: bool,
    pub can_rename_or_delete: bool,
    pub op: WindowsOpenDirOp,
}
#[cfg(windows)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum WindowsOpenDirOp {
    #[default]
    OnlyOpen,
    OnlyCreate,
    OpenOrCreate,
}

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

/// `normalizePathWindows` options.
#[cfg(windows)]
#[derive(Copy, Clone)]
pub struct NormalizePathWindowsOpts {
    /// `false` emits Win32-consumable paths for kernel32 APIs: plain (no
    /// `\??\`) for absolute inputs, `\\?\GLOBALROOT\Device\…` for dotted or
    /// multi-component relatives. Bare names still pass through verbatim.
    pub add_nt_prefix: bool,
}
#[cfg(windows)]
impl Default for NormalizePathWindowsOpts {
    fn default() -> Self {
        Self {
            add_nt_prefix: true,
        }
    }
}

/// `..`-clamp boundary from the kernel's own two answers (full NT object name
/// minus volume-relative name), plus whether the device is an allowlisted
/// share-rooted redirector. `None` when the names don't compose (rename race).
#[cfg(windows)]
fn nt_clamp_prefix_len(nt: &[u16], vol_rel: &[u16]) -> Option<(usize, bool)> {
    const SEP: u16 = b'\\' as u16;
    const DEVICE: &[u8] = b"\\Device\\";
    if vol_rel.first() != Some(&SEP) || vol_rel.len() >= nt.len() || !nt.ends_with(vol_rel) {
        return None;
    }
    let device_len = nt.len() - vol_rel.len();
    let is_device = device_len >= DEVICE.len()
        && bun_core::strings::eql_case_insensitive_t(&nt[..DEVICE.len()], DEVICE);
    let device_is = |name: &[u8]| {
        let full = DEVICE.len() + name.len();
        is_device
            && device_len >= full
            && bun_core::strings::eql_case_insensitive_t(&nt[DEVICE.len()..full], name)
            && (device_len == full || nt[full] == SEP)
    };
    if !device_is(b"Mup") && !device_is(b"LanmanRedirector") {
        // A raced pair can shear the boundary anywhere; only accept a real
        // `\Device\<name…>` prefix, else the `..` clamp gets a forged depth
        // budget. Nested device names (`HarddiskDmVolumes\…`) stay legal.
        if !is_device || device_len == DEVICE.len() {
            return None;
        }
        return Some((device_len, false));
    }
    // UNC volume-relative names start at `\server\share` (ntifs
    // FileNameInformation); a missing or empty share (`\srv`, `\srv\`) →
    // boundary unknowable. Trailing separators would fake an empty share.
    let mut scan = vol_rel;
    while scan.last() == Some(&SEP) {
        scan = &scan[..scan.len() - 1];
    }
    if scan.is_empty() {
        return None;
    }
    let component_end = |start: usize| {
        scan[start..]
            .iter()
            .position(|&c| c == SEP)
            .map_or(scan.len(), |i| start + i)
    };
    let server_end = component_end(1);
    if server_end == scan.len() {
        return None;
    }
    Some((device_len + component_end(server_end + 1), true))
}

/// `normalizePathWindows` — convert a (possibly relative) path into an NT
/// object name for `NtCreateFile` against `dir_fd`: absolute inputs become
/// `\??\C:\…`, dirfd-relative inputs resolve to absolute `\Device\…` names.
#[cfg(windows)]
pub fn normalize_path_windows(dir_fd: Fd, path: &[u16]) -> Maybe<bun_paths::OSPath> {
    normalize_path_windows_opts(dir_fd, path, NormalizePathWindowsOpts::default())
}

/// Whether the `..` in `path` lead above where it starts. Nothing in it is a drive or a share.
#[cfg(windows)]
fn climbs_above_start(path: &[u16]) -> bool {
    const DOT: u16 = b'.' as u16;
    let step = |depth: usize, name: &[u16]| match name {
        [] | [DOT] => Some(depth),
        [DOT, DOT] => depth.checked_sub(1),
        _ => Some(depth + 1),
    };
    let mut names = path.split(|&unit| bun_paths::is_sep(unit));
    names.try_fold(0, step).is_none()
}

/// Like [`normalize_path_windows`]; `opts.add_nt_prefix = false` makes the
/// output Win32-consumable: absolute inputs lose `\??\`, dotted or
/// multi-component relatives become `\\?\GLOBALROOT\Device\…`, and bare names
/// pass through verbatim (Win32 resolves those against the cwd).
#[cfg(windows)]
pub fn normalize_path_windows_opts(
    dir_fd: Fd,
    path: &[u16],
    opts: NormalizePathWindowsOpts,
) -> Maybe<bun_paths::OSPath> {
    use bun_core::w;
    use bun_paths::{OSPath, PATH_MAX_WIDE, is_sep};
    let too_long = || Error::from_code(E::ENAMETOOLONG, Tag::open);

    // Room for `\??\UNC\`.
    if path.len() + 8 > PATH_MAX_WIDE {
        return Err(too_long());
    }
    let mut out = OSPath::new();

    if bun_paths::is_absolute(path) {
        if path.ends_with(w!("\\nul")) || path.ends_with(w!("\\NUL")) {
            out.set(w!("\\??\\NUL"));
        } else if let [_, second, dot, fourth, rest @ ..] = path
            && is_sep(*second)
            && *dot == u16::from(b'.')
            && is_sep(*fourth)
        {
            // `NtCreateFile` does not open a device path. The callers know it by this prefix.
            out.set(w!("\\\\.\\"));
            out.extend_from_slice(rest);
        } else if opts.add_nt_prefix && bun_paths::is_fully_qualified(path) {
            out.set(path);
            out.make_nt_path();
        } else {
            out.resolve_in_place(&[path]);
            out.strip_nt_prefix();
        }
        return Ok(out);
    }

    // Strip a leading drive letter (`C:`) on the relative part; the bypass
    // below still copies the original `path` verbatim.
    let rel = match path {
        [letter, colon, rest @ ..]
            if u8::try_from(*letter).is_ok_and(|letter| letter.is_ascii_alphabetic())
                && *colon == u16::from(b':') =>
        {
            rest
        }
        _ => path,
    };

    // Relative path with no separators or `.` can be passed straight through
    // to `NtCreateFile` against `RootDirectory`.
    if !(rel.iter()).any(|&unit| is_sep(unit) || unit == u16::from(b'.')) {
        out.set(path);
        return Ok(out);
    }

    let climbs_above_base = climbs_above_start(rel);

    // Otherwise: resolve `dir_fd` to its NT device path, join, normalize.
    // Win32 consumers (`add_nt_prefix = false`) get the `\\?\GLOBALROOT`
    // spelling of the same object — no mount manager, valid for kernel32.
    const GLOBALROOT: &[u16] = bun_core::w!("\\\\?\\GLOBALROOT");
    let base_fd = if dir_fd.is_valid() {
        dir_fd.native()
    } else {
        Fd::cwd().native()
    };
    let mut base_buf = bun_paths::w_path_buffer_pool::get();
    // `VolumeName::Nt` is answered from the handle itself (no mount-manager
    // IOCTL), so it works under AppContainer tokens and on volumes with no
    // DOS drive letter; the `\Device\…` result feeds `NtCreateFile` as-is.
    let base = match windows::GetFinalPathNameByHandle(
        base_fd,
        bun_windows_sys::GetFinalPathNameByHandleFormat {
            volume_name: bun_windows_sys::VolumeName::Nt,
        },
        &mut base_buf.0[..],
    ) {
        Ok(p) => p,
        Err(windows::GetFinalPathNameByHandleError::NameTooLong) => {
            return Err(too_long());
        }
        // `E.BADFD` (errno 77 'file descriptor in bad state'),
        // not `EBADF` (9).
        Err(_) => return Err(Error::from_code(E::BADFD, Tag::open)),
    };

    // The volume boundary is only needed when `..` resolves above the dirfd:
    // the base suffix is kernel-normalized (pure depth), so within-tree
    // dotdots cannot reach any floor and any split yields identical output.
    let mut share_rooted = false;
    let mut prefix_len = if !climbs_above_base {
        base.len()
    } else {
        // The generic normalizer's `..` clamp knows drive/UNC roots, not
        // device roots: copy the device prefix (the NT object name minus the
        // volume-relative name) verbatim and normalize only the remainder.
        let mut rel_buf = bun_paths::w_path_buffer_pool::get();
        let vol_rel = match windows::GetFinalPathNameByHandle(
            base_fd,
            bun_windows_sys::GetFinalPathNameByHandleFormat {
                volume_name: bun_windows_sys::VolumeName::None,
            },
            &mut rel_buf.0[..],
        ) {
            Ok(p) => p,
            Err(windows::GetFinalPathNameByHandleError::NameTooLong) => {
                return Err(too_long());
            }
            Err(_) => return Err(Error::from_code(E::BADFD, Tag::open)),
        };
        // A mis-placed boundary would resolve `..` to the wrong file; fail
        // loud when the two names don't compose (e.g. a rename race).
        match nt_clamp_prefix_len(base, vol_rel) {
            Some((len, rooted)) => {
                share_rooted = rooted;
                len
            }
            None => return Err(Error::from_code(E::BADFD, Tag::open)),
        }
    };
    // The `\Device\…` name of a volume-root handle ends in `\`; keep the
    // prefix separator-free (the join below adds exactly one).
    while prefix_len > 0 && base[prefix_len - 1] == b'\\' as u16 {
        prefix_len -= 1;
    }
    let (prefix, base_below_prefix) = base.split_at(prefix_len);
    if !opts.add_nt_prefix {
        out.set(GLOBALROOT);
    }
    out.extend_from_slice(prefix);
    let prefix_end = out.len();

    // `NtCreateFile` rejects `.` and `..`.
    if climbs_above_base {
        let below = OSPath::from_parts(&[w!("\\"), base_below_prefix, rel]);
        // An unknown device may hold many mounts under its root, so `..` cannot be clamped there.
        if !share_rooted && climbs_above_start(&below) {
            return Err(Error::from_code(E::EINVAL, Tag::open));
        }
        out.push_inside(&below);
    } else {
        out.push_inside(rel);
    }
    // After a bare device name, a separator selects the root directory over the volume device.
    if out.len() == prefix_end && !base_below_prefix.is_empty() {
        out.extend_from_slice(w!("\\"));
    }
    if out.len() >= PATH_MAX_WIDE {
        return Err(too_long());
    }
    Ok(out)
}

/// Open a `\\.\…` device path via kernel32 `CreateFileW`
/// (NtCreateFile cannot open device paths).
#[cfg(windows)]
fn open_windows_device_path(
    path: &bun_core::WStr,
    desired_access: u32,
    creation_disposition: u32,
    flags_and_attributes: u32,
) -> Maybe<Fd> {
    windows::CreateFileW(
        path,
        desired_access,
        FILE_SHARE,
        creation_disposition,
        flags_and_attributes,
    )
    .map(|handle| Fd::from_system(handle.into_raw_handle()))
    .map_err(|err| Error::from_win32(err, Tag::open))
}

/// Absolute NT object names our producers emit: `\??\…` or `\Device\…`. Only
/// these get `RootDirectory = null`; any other rooted string stays
/// dirfd-relative so `NtCreateFile` rejects it (`OBJECT_PATH_SYNTAX_BAD`).
#[cfg(windows)]
fn is_nt_object_name(p: &[u16]) -> bool {
    bun_core::strings::has_prefix_comptime_utf16(p, &windows::NT_OBJECT_PREFIX_U8)
        || bun_core::strings::has_prefix_comptime_utf16(p, b"\\Device\\")
}

/// The `RootDirectory` that `path` resolves against.
#[cfg(windows)]
fn nt_root_directory(dir: Fd, path: &[u16]) -> Option<windows::HANDLE> {
    if is_nt_object_name(path) {
        return None;
    }
    Some(if dir.is_valid() { dir } else { Fd::cwd() }.native())
}

/// `openDirAtWindowsNtPath` — `NtCreateFile` with
/// `FILE_DIRECTORY_FILE`.
#[cfg(windows)]
pub(crate) fn open_dir_at_windows_nt_path(
    dir_fd: Fd,
    path: &bun_core::WStr,
    options: WindowsOpenDirOptions,
) -> Maybe<Fd> {
    use bun_windows_sys::externs as w;
    // No FILE_ADD_FILE|FILE_ADD_SUBDIRECTORY: child creates via RootDirectory
    // check the directory's ACL, not this handle's access mask, so requesting
    // them only narrows where this open is admitted.
    let base_flags = w::STANDARD_RIGHTS_READ
        | w::FILE_READ_ATTRIBUTES
        | w::FILE_READ_EA
        | w::SYNCHRONIZE
        | w::FILE_TRAVERSE;
    let iterable_flag: u32 = if options.iterable {
        w::FILE_LIST_DIRECTORY
    } else {
        0
    };
    let rename_flag: u32 = if options.can_rename_or_delete {
        w::DELETE
    } else {
        0
    };
    let flags = iterable_flag | base_flags | rename_flag;
    let open_reparse: u32 = if options.no_follow {
        w::FILE_OPEN_REPARSE_POINT
    } else {
        0
    };

    // NtCreateFile seems to not function on device paths. Since it is
    // absolute, it can just use CreateFileW.
    let p = path.as_slice();
    if p.len() >= 4
        && p[0] == b'\\' as u16
        && p[1] == b'\\' as u16
        && p[2] == b'.' as u16
        && p[3] == b'\\' as u16
    {
        // `FILE_FLAG_OPEN_REPARSE_POINT` has the value of `FILE_OPEN_REPARSE_POINT`.
        if let Ok(fd) = open_windows_device_path(path, flags, w::OPEN_EXISTING, open_reparse) {
            let device = File::from_fd(fd);
            if windows::GetFileType(fd.native()) != windows::FILE_TYPE_DISK {
                return Ok(device.into_raw());
            }
        }
        // What is on a disk gets the name that `unlinkat` and `renameat` give it.
        return open_dir_at_windows_nt_path(dir_fd, &nt_path(p, Tag::open)?, options);
    }

    windows::NtCreateFile(
        nt_root_directory(dir_fd, p),
        p,
        NtCreateFileOptions {
            access_mask: flags,
            disposition: match options.op {
                WindowsOpenDirOp::OnlyOpen => w::FILE_OPEN,
                WindowsOpenDirOp::OnlyCreate => w::FILE_CREATE,
                WindowsOpenDirOp::OpenOrCreate => w::FILE_OPEN_IF,
            },
            options: w::FILE_DIRECTORY_FILE
                | w::FILE_SYNCHRONOUS_IO_NONALERT
                | windows::FILE_OPEN_FOR_BACKUP_INTENT
                | open_reparse,
            attributes: 0,
            sharing_mode: FILE_SHARE,
        },
    )
    .map(|handle| Fd::from_system(handle.into_raw_handle()))
    // Not `Error::new(rc)`: the curated NTSTATUS table maps
    // `OBJECT_NAME_INVALID` to EINVAL, and `open` of a bad name is ENOENT
    // (libuv/Node), which `RtlNtStatusToDosError` gives.
    .map_err(|rc| Error::from_win32(windows::Win32Error::from_nt_status(rc), Tag::open))
}

/// Absolute paths (`\??\…`, `\Device\…`) must be full NT object names and
/// open with no `RootDirectory`; relative paths resolve against `dir` (or the
/// cwd when `dir` is the "invalid_fd" sentinel).
#[cfg(windows)]
pub(crate) fn open_file_at_windows_nt_path(
    dir: Fd,
    path: &bun_core::WStr,
    mut options: NtCreateFileOptions,
) -> Maybe<Fd> {
    use bun_windows_sys::externs as w;
    let p = path.as_slice();
    let root_directory = nt_root_directory(dir, p);

    loop {
        let result = windows::NtCreateFile(root_directory, p, options);

        if matches!(result, Err(w::NTSTATUS::ACCESS_DENIED))
            && options.attributes == w::FILE_ATTRIBUTE_NORMAL
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
            options.attributes = w::FILE_ATTRIBUTE_HIDDEN;
            continue;
        }

        return match result {
            Ok(handle) => {
                let file = File::from(handle);
                if (options.access_mask & w::FILE_APPEND_DATA) != 0
                    && lseek(file.fd(), 0, w::FILE_END as i32).is_err()
                {
                    return Err(Error::from_code(E::EUNKNOWN, Tag::SetFilePointerEx));
                }
                Ok(file.into_raw())
            }
            // See `open_dir_at_windows_nt_path`: Rtl mapping, not the curated table.
            Err(rc) => Err(Error::from_win32(
                windows::Win32Error::from_nt_status(rc),
                Tag::open,
            )),
        };
    }
}

/// `path` in UTF-16, with `\` for `/`.
#[cfg(windows)]
pub fn win32_path<C: bun_paths::PathUnit>(path: &[C], syscall: Tag) -> Maybe<bun_paths::OSPath> {
    os_path_with(path, syscall, |wide| {
        bun_paths::to_native_in_place(wide.as_mut_slice())
    })
}

/// [`win32_path`], but `C:\a` may be longer than `MAX_PATH`.
#[cfg(windows)]
pub fn long_path<C: bun_paths::PathUnit>(path: &[C], syscall: Tag) -> Maybe<bun_paths::OSPath> {
    os_path_with(path, syscall, |wide| {
        let is_on_drive = bun_paths::is_absolute(path) && !bun_paths::has_leading_sep(path);
        if is_on_drive || wide.starts_with(bun_core::w!("\\??\\")) {
            let drive = wide[0];
            wide.make_long_path();
            wide.copy_trailing_sep_from(path);
            if is_on_drive {
                // A link stores its target, so `c:` has to read back as `c:`.
                wide.as_mut_slice()["\\\\?\\".len()] = drive;
            }
        } else {
            bun_paths::to_native_in_place(wide.as_mut_slice());
        }
    })
}

/// `path` for ntdll. A relative one stays relative.
#[cfg(windows)]
pub fn nt_path<C: bun_paths::PathUnit>(path: &[C], syscall: Tag) -> Maybe<bun_paths::OSPath> {
    os_path_with(path, syscall, bun_paths::OSPath::make_nt_path)
}

#[cfg(windows)]
#[inline(always)]
fn os_path_with<C: bun_paths::PathUnit>(
    path: &[C],
    syscall: Tag,
    edit: impl FnOnce(&mut bun_paths::OSPath),
) -> Maybe<bun_paths::OSPath> {
    let mut wide = bun_paths::OSPath::from(path);
    edit(&mut wide);
    if wide.len() >= bun_paths::PATH_MAX_WIDE {
        return Err(name_too_long(path, syscall));
    }
    Ok(wide)
}

#[cfg(windows)]
#[cold]
fn name_too_long<C: bun_paths::PathUnit>(path: &[C], syscall: Tag) -> Error {
    Error::from_code(E::ENAMETOOLONG, syscall).with_path(&bun_paths::Path::from(path))
}

/// Writes `path` to `buf` in UTF-8, without `\\?\`, and returns the length.
#[cfg(windows)]
fn write_path_from_windows(buf: &mut [u8], path: &[u16], syscall: Tag) -> Maybe<usize> {
    let mut utf8 = bun_paths::Path::from(path);
    utf8.strip_nt_prefix();
    let Some(buf) = buf.get_mut(..=utf8.len()) else {
        return Err(name_too_long(path, syscall));
    };
    buf.copy_from_slice(utf8.as_bytes_with_nul());
    Ok(utf8.len())
}

#[cfg(windows)]
pub fn open_dir_at_windows(dir_fd: Fd, path: &[u16], options: WindowsOpenDirOptions) -> Maybe<Fd> {
    open_dir_at_windows_nt_path(dir_fd, &normalize_path_windows(dir_fd, path)?, options)
}
#[cfg(windows)]
#[inline(never)]
pub fn open_dir_at_windows_a(
    dir_fd: impl AsFd,
    path: &[u8],
    options: WindowsOpenDirOptions,
) -> Maybe<Fd> {
    open_dir_at_windows(dir_fd.as_fd(), &bun_paths::OSPath::from(path), options)
}
#[cfg(windows)]
pub fn open_file_at_windows(dir_fd: Fd, path: &[u16], opts: NtCreateFileOptions) -> Maybe<Fd> {
    open_file_at_windows_nt_path(dir_fd, &normalize_path_windows(dir_fd, path)?, opts)
}

/// POSIX-flag → NtCreateFile
/// translation.
#[cfg(windows)]
fn openat_windows_impl(dir: Fd, norm: &bun_core::WStr, flags: i32, perm: Mode) -> Maybe<Fd> {
    use bun_windows_sys::externs as w;
    if (flags & O::DIRECTORY) != 0 {
        // We interpret `O_PATH` as meaning "no iteration".
        return open_dir_at_windows_nt_path(
            dir,
            norm,
            WindowsOpenDirOptions {
                iterable: (flags & O::PATH) == 0,
                no_follow: (flags & O::NOFOLLOW) != 0,
                can_rename_or_delete: false,
                ..Default::default()
            },
        );
    }

    let nonblock = (flags & O::NONBLOCK) != 0;

    // Matches libuv fs__open: O_RDONLY asks for read access only. GENERIC_WRITE
    // already includes FILE_WRITE_ATTRIBUTES for the write-mode branches; the
    // fs.futimes path goes through uv_fs_futime which ReOpenFiles for it.
    let mut access_mask: u32 = w::READ_CONTROL | w::SYNCHRONIZE;
    if (flags & O::RDWR) != 0 {
        access_mask |= w::GENERIC_READ | w::GENERIC_WRITE;
    } else if (flags & O::WRONLY) != 0 {
        access_mask |= w::GENERIC_WRITE;
    } else {
        access_mask |= w::GENERIC_READ;
    }
    // O_APPEND is orthogonal to the access mode, so it cannot be another arm of
    // the chain above: `a+` is O_RDWR|O_APPEND and would otherwise never get
    // FILE_APPEND_DATA, which is what the post-open seek to FILE_END keys off.
    if (flags & O::APPEND) != 0 {
        access_mask |= w::GENERIC_WRITE | w::FILE_APPEND_DATA;
    }

    // Create disposition is derived from O_CREAT/O_EXCL/O_TRUNC alone; the
    // read/write access mode only affects `access_mask` above.
    let creat = (flags & O::CREAT) != 0;
    let excl = (flags & O::EXCL) != 0;
    let truncate = (flags & O::TRUNC) != 0;
    let disposition: u32 = match (creat, excl, truncate) {
        (true, true, _) => w::FILE_CREATE,
        (true, false, true) => w::FILE_OVERWRITE_IF,
        (true, false, false) => w::FILE_OPEN_IF,
        (false, _, true) => w::FILE_OVERWRITE,
        (false, _, false) => w::FILE_OPEN,
    };

    let blocking_flag: u32 = if !nonblock {
        w::FILE_SYNCHRONOUS_IO_NONALERT
    } else {
        0
    };
    let follow = (flags & O::NOFOLLOW) == 0;
    let opts: u32 = if follow {
        blocking_flag
    } else {
        blocking_flag | w::FILE_OPEN_REPARSE_POINT
    };

    let mut attributes: u32 = w::FILE_ATTRIBUTE_NORMAL;
    if (flags & O::CREAT) != 0 && (perm & 0x80) == 0 && perm != 0 {
        attributes |= w::FILE_ATTRIBUTE_READONLY;
    }

    open_file_at_windows_nt_path(
        dir,
        norm,
        NtCreateFileOptions {
            access_mask,
            disposition,
            options: opts,
            attributes,
            ..Default::default()
        },
    )
}

/// `openatWindows` — UTF-16 input.
#[cfg(windows)]
pub fn openat_windows(dir: Fd, path: &[u16], flags: i32, perm: Mode) -> Maybe<Fd> {
    openat_windows_impl(dir, &normalize_path_windows(dir, path)?, flags, perm)
}
/// `openatWindowsA` — UTF-8 input.
#[cfg(windows)]
#[inline(never)]
pub fn openat_windows_a(dir: impl AsFd, path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    openat_windows(dir.as_fd(), &bun_paths::OSPath::from(path), flags, perm)
}

// ── existence checks ──

/// `WindowsFileAttributes` — view over the `DWORD` returned
/// by `GetFileAttributesW`. Only the two bits the resolver inspects are
/// surfaced as fields so callers
/// can write `attrs.is_directory` / `attrs.is_reparse_point`.
#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct WindowsFileAttributes {
    pub is_directory: bool,
    pub is_reparse_point: bool,
}

/// `getFileAttributes`. Accepts a UTF-8 path (the
/// resolver only ever calls it with one). Returns `None` on
/// `INVALID_FILE_ATTRIBUTES`.
#[cfg(windows)]
pub fn get_file_attributes(path: &ZStr) -> Option<WindowsFileAttributes> {
    use bun_windows_sys::externs as w;
    let dword = windows::GetFileAttributesW(&long_path(path, Tag::access).ok()?).ok()?;
    Some(WindowsFileAttributes {
        is_directory: (dword & w::FILE_ATTRIBUTE_DIRECTORY) != 0,
        is_reparse_point: (dword & w::FILE_ATTRIBUTE_REPARSE_POINT) != 0,
    })
}

/// `access(path, F_OK) == 0`. `file_only` ignored on POSIX.
pub fn exists_os_path(path: &bun_paths::OSPathSliceZ, file_only: bool) -> bool {
    #[cfg(not(windows))]
    {
        let _ = file_only;
        // SAFETY: path is NUL-terminated.
        unsafe { libc::access(path.as_ptr().cast(), libc::F_OK) == 0 }
    }
    #[cfg(windows)]
    {
        use bun_windows_sys::externs as w;
        // `getFileAttributes(path)`; if `file_only` reject dirs;
        // if reparse point, open the target with `OPEN_EXISTING` to follow.
        let Ok(attrs) = windows::GetFileAttributesW(path) else {
            return false;
        };
        if file_only && (attrs & w::FILE_ATTRIBUTE_DIRECTORY) != 0 {
            return false;
        }
        if (attrs & w::FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            // Only name-surrogate reparse points (symlinks, mount points) stand in for
            // another path. Non-surrogate tags such as IO_REPARSE_TAG_APPEXECLINK are
            // opaque: the entry exists as-is and following it can fail spuriously.
            let mut fd: w::WIN32_FIND_DATAW = bun_core::ffi::zeroed();
            // SAFETY: path is NUL-terminated UTF-16; fd is valid for write.
            let find = unsafe { w::FindFirstFileW(path.as_ptr(), &mut fd) };
            if find != bun_windows_sys::INVALID_HANDLE_VALUE {
                // SAFETY: valid find handle from FindFirstFileW.
                unsafe {
                    let _ = w::FindClose(find);
                }
                if !w::is_reparse_tag_name_surrogate(fd.dwReserved0) {
                    return true;
                }
            }
            // Name surrogate (or no tag available): follow it by opening the target.
            return windows::CreateFileW(
                path,
                0,
                0,
                w::OPEN_EXISTING,
                w::FILE_FLAG_BACKUP_SEMANTICS,
            )
            .is_ok();
        }
        true
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExistsAtType {
    File,
    Directory,
}
/// `path` is NT-prefixed. Like `GetFileAttributesW`, does not follow a final reparse point.
#[cfg(windows)]
fn nt_query_attributes_at(dir: Fd, mut path: &[u16]) -> Maybe<u32> {
    use bun_windows_sys::externs as w;
    // Trim leading `.\` — NtQueryAttributesFile expects relative paths
    // without it.
    if path.len() > 2 && path[0] == b'.' as u16 && path[1] == b'\\' as u16 {
        path = &path[2..];
    }
    let path_len_bytes = (path.len() * 2) as u16;
    let mut nt_name = w::UNICODE_STRING {
        Length: path_len_bytes,
        MaximumLength: path_len_bytes,
        Buffer: path.as_ptr().cast_mut().cast::<u16>(),
    };
    let attr = w::OBJECT_ATTRIBUTES {
        Length: core::mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: nt_root_directory(dir, path).unwrap_or(core::ptr::null_mut()),
        Attributes: 0,
        ObjectName: &mut nt_name,
        SecurityDescriptor: core::ptr::null_mut(),
        SecurityQualityOfService: core::ptr::null_mut(),
    };
    let mut basic_info: w::FILE_BASIC_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: FFI; attr/basic_info valid for the call duration.
    let rc = unsafe { w::ntdll::NtQueryAttributesFile(&attr, &mut basic_info) };
    if rc != w::NTSTATUS::SUCCESS {
        // `Error::new(NTSTATUS)` maps through the curated table first, so
        // `OBJECT_PATH_NOT_FOUND` is deterministically `ENOENT`, which
        // `directory_exists_at()` branches on.
        return Err(Error::new(rc, Tag::access));
    }
    Ok(basic_info.FileAttributes)
}
/// Attributes of the entry `sub` itself (a reparse point is not followed).
#[cfg(windows)]
pub fn get_file_attributes_at(dir: Fd, sub: &ZStr) -> Maybe<WindowsFileAttributes> {
    use bun_windows_sys::externs as w;
    let dword = nt_query_attributes_at(dir, &nt_path(sub, Tag::access)?)?;
    Ok(WindowsFileAttributes {
        is_directory: (dword & w::FILE_ATTRIBUTE_DIRECTORY) != 0,
        is_reparse_point: (dword & w::FILE_ATTRIBUTE_REPARSE_POINT) != 0,
    })
}
#[cfg(windows)]
fn exists_at_type_nt(dir: Fd, path: &[u16]) -> Maybe<ExistsAtType> {
    use bun_windows_sys::externs as w;
    let attrs = nt_query_attributes_at(dir, path)?;
    // `FILE_ATTRIBUTE_READONLY` on a directory is a folder-customization
    // marker (OneDrive sets it) and does not affect directory-ness; only
    // `FILE_ATTRIBUTE_DIRECTORY` decides the type.
    Ok(if (attrs & w::FILE_ATTRIBUTE_DIRECTORY) != 0 {
        ExistsAtType::Directory
    } else {
        ExistsAtType::File
    })
}
/// `fstatat` then `S_ISDIR`.
pub fn exists_at_type(dir: Fd, sub: &ZStr) -> Maybe<ExistsAtType> {
    #[cfg(unix)]
    {
        let st = fstatat(dir, sub)?;
        Ok(if S::ISDIR(st.st_mode as _) {
            ExistsAtType::Directory
        } else {
            ExistsAtType::File
        })
    }
    #[cfg(windows)]
    {
        // `NtQueryAttributesFile` against an OBJECT_ATTRIBUTES
        // built from the (optionally NT-prefixed) wide path.
        exists_at_type_nt(dir, &nt_path(sub, Tag::access)?)
    }
}
/// Wide-path arm of `exists_at_type`.
#[cfg(windows)]
pub(crate) fn exists_at_type_w(dir: Fd, sub: &[u16]) -> Maybe<ExistsAtType> {
    exists_at_type_nt(dir, &nt_path(sub, Tag::access)?)
}
/// `directoryExistsAt(dir, sub)`. ENOENT → `Ok(false)`.
pub fn directory_exists_at(dir: impl AsFd, sub: &ZStr) -> Maybe<bool> {
    let dir = dir.as_fd();
    match exists_at_type(dir, sub) {
        Ok(t) => Ok(t == ExistsAtType::Directory),
        Err(e) if e.get_errno() == E::ENOENT => Ok(false),
        Err(e) => Err(e),
    }
}
/// `directoryExistsAt` — wide-path (`u16`) overload for Windows
/// `OSPathSliceZ` callers (mkdir-recursive, cpSync auto-detect). Avoids
/// a UTF-16 → UTF-8 → UTF-16 round-trip.
#[cfg(windows)]
pub fn directory_exists_at_w(dir: Fd, sub: &[u16]) -> Maybe<bool> {
    match exists_at_type_w(dir, sub) {
        Ok(t) => Ok(t == ExistsAtType::Directory),
        Err(e) if e.get_errno() == E::ENOENT => Ok(false),
        Err(e) => Err(e),
    }
}

// ── fcntl / nonblocking / dup ──

/// `fcntl(fd, F_GETFL, 0)`.
#[cfg(unix)]
pub fn get_fcntl_flags(fd: Fd) -> Maybe<FcntlInt> {
    fcntl(fd, Fcntl::GetFl, 0)
}
#[cfg(windows)]
pub fn get_fcntl_flags(_fd: Fd) -> Maybe<FcntlInt> {
    Err(Error::from_code_int(libc::ENOSYS, Tag::fcntl))
}
#[inline]
pub fn set_nonblocking(fd: Fd) -> Maybe<()> {
    update_nonblocking(fd, true)
}
/// GETFL → toggle O_NONBLOCK → SETFL (only if changed).
pub fn update_nonblocking(fd: Fd, nonblocking: bool) -> Maybe<()> {
    #[cfg(unix)]
    {
        let cur = get_fcntl_flags(fd)? as i32;
        let new = if nonblocking {
            cur | O::NONBLOCK
        } else {
            cur & !O::NONBLOCK
        };
        if new != cur {
            fcntl(fd, Fcntl::SetFl, new as isize)?;
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        let _ = (fd, nonblocking);
        Ok(())
    }
}
/// `fcntl(F_DUPFD_CLOEXEC)` (POSIX) / `DuplicateHandle` (Win).
/// `_flags` is ignored.
#[inline]
pub fn dup_with_flags(fd: Fd, _flags: i32) -> Maybe<Fd> {
    dup(fd)
}

/// `lseek(fd, offset, SEEK_SET)`; result discarded.
pub fn set_file_offset(fd: Fd, offset: u64) -> Maybe<()> {
    lseek(fd, offset as i64, libc::SEEK_SET).map(|_| ())
}

// ── nonblocking read/write (preadv2/pwritev2 RWF_NOWAIT on Linux) ──

#[cfg(any(target_os = "linux", target_os = "android"))]
unsafe extern "C" {
    fn sys_preadv2(
        fd: c_int,
        iov: *const libc::iovec,
        iovcnt: c_int,
        off: i64,
        flags: u32,
    ) -> isize;
    fn sys_pwritev2(
        fd: c_int,
        iov: *const libc::iovec,
        iovcnt: c_int,
        off: i64,
        flags: u32,
    ) -> isize;
}
#[cfg(any(target_os = "linux", target_os = "android"))]
const RWF_NOWAIT: u32 = 0x00000008;

/// `preadv2(RWF_NOWAIT)` with no fallback: `Ok(None)` means this fd's file type (or the kernel) lacks it and the caller should remember that.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub fn read_nowait_buf(fd: Fd, mut cursor: BorrowedCursor<'_, u8>) -> Maybe<Option<usize>> {
    if !linux::RWFFlagSupport::is_maybe_supported() {
        return Ok(None);
    }
    loop {
        // SAFETY: as in `read_buf`; iov is a live stack value.
        let rc = unsafe {
            let buf = cursor.as_mut();
            let iov = libc::iovec {
                iov_base: buf.as_mut_ptr().cast(),
                iov_len: buf.len(),
            };
            sys_preadv2(fd.native(), &raw const iov, 1, -1, RWF_NOWAIT)
        };
        if rc >= 0 {
            // SAFETY: as in `read_buf`.
            unsafe { cursor.advance(rc as usize) };
            return Ok(Some(rc as usize));
        }
        match last_errno() {
            libc::EINTR => continue,
            libc::ENOSYS => {
                linux::RWFFlagSupport::disable();
                return Ok(None);
            }
            libc::EOPNOTSUPP | libc::EPERM | libc::EACCES => return Ok(None),
            e => return Err(Error::from_code_int(e, Tag::read).with_fd(fd)),
        }
    }
}

/// `pwritev2(RWF_NOWAIT)` with no fallback: `Ok(None)` means this fd's file type (or the kernel) lacks it and the caller should remember that.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub fn write_nowait(fd: Fd, buf: &[u8]) -> Maybe<Option<usize>> {
    if !linux::RWFFlagSupport::is_maybe_supported() {
        return Ok(None);
    }
    loop {
        let iov = [libc::iovec {
            iov_base: buf.as_ptr().cast_mut().cast::<_>(),
            iov_len: buf.len(),
        }];
        // SAFETY: fd valid; iov points at a live stack array.
        let rc = unsafe { sys_pwritev2(fd.native(), iov.as_ptr(), 1, -1, RWF_NOWAIT) };
        if rc >= 0 {
            return Ok(Some(rc as usize));
        }
        match last_errno() {
            libc::EINTR => continue,
            libc::ENOSYS => {
                linux::RWFFlagSupport::disable();
                return Ok(None);
            }
            libc::EOPNOTSUPP | libc::EPERM | libc::EACCES => return Ok(None),
            e => return Err(Error::from_code_int(e, Tag::write).with_fd(fd)),
        }
    }
}

/// `fallocate(fd, 0, offset, len)` on Linux, result discarded; no-op elsewhere.
pub fn preallocate_file(
    fd: FdNative,
    offset: i64,
    len: i64,
) -> core::result::Result<(), bun_core::Error> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // Result intentionally discarded
        // — preallocation is best-effort.
        let _ = linux::fallocate(fd, offset, len);
    }
    let _ = (fd, offset, len);
    Ok(())
}

/// `kqueue()` — BSD kernel event queue (Darwin/FreeBSD only).
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub fn kqueue() -> Maybe<Fd> {
    let rc = safe_libc::kqueue();
    if rc < 0 {
        return Err(err_with(Tag::kqueue));
    }
    Ok(Fd::from_native(rc))
}

/// `kevent()` — slice-wrapped Maybe form. Retries on EINTR.
/// Returns the number of events written into `eventlist`.
///
/// # Safety
/// Whoever waits on `fd` gets the `udata` of each change back and may dereference it. It must be
/// what they expect for as long as the change is registered, and until they are done with the
/// events that they had fetched by then.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub unsafe fn kevent(
    fd: Fd,
    changelist: &[libc::kevent],
    eventlist: &mut [libc::kevent],
    timeout: Option<&libc::timespec>,
) -> Maybe<usize> {
    loop {
        // SAFETY: fd is a valid kqueue; slices give exact (ptr,len); timeout
        // is either null or a valid timespec. The caller answers for each `udata`.
        let rc = unsafe {
            libc::kevent(
                fd.native(),
                changelist.as_ptr(),
                clamp_count(changelist.len()),
                eventlist.as_mut_ptr(),
                clamp_count(eventlist.len()),
                timeout.map_or(core::ptr::null(), std::ptr::from_ref),
            )
        };
        match get_errno(rc) {
            E::SUCCESS => return Ok(rc as usize),
            E::EINTR => continue,
            e => return Err(Error::from_code(e, Tag::kevent).with_fd(fd)),
        }
    }
}

/// [`kevent`] with no changes.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub fn kevent_wait(
    fd: Fd,
    eventlist: &mut [libc::kevent],
    timeout: Option<&libc::timespec>,
) -> Maybe<usize> {
    // SAFETY: an empty changelist registers nothing.
    unsafe { kevent(fd, &[], eventlist, timeout) }
}

// ── getFdPath ──

/// Cached probe of `/proc/version` for "freebsd"
/// (linprocfs hardcodes "des@freebsd.org"). Under FreeBSD's Linuxulator
/// `/proc/self/fd/*` doesn't readlink, but `/dev/fd/*` does.
/// 0=unknown, 1=linux, 2=freebsd.
#[cfg(any(target_os = "linux", target_os = "android"))]
static LINUX_KERNEL_CACHED: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(0);

/// Non-probing
/// fast-path check. Returns `true` only when a previous probe already proved
/// FreeBSD's Linuxulator; never triggers the `/proc/version` read itself.
#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn linux_kernel_cached_is_freebsd() -> bool {
    LINUX_KERNEL_CACHED.load(core::sync::atomic::Ordering::Acquire) == 2
}

/// Probing variant: reads `/proc/version`
/// once (memoized) and returns whether this is FreeBSD's Linuxulator.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn linux_kernel_is_freebsd() -> bool {
    use core::sync::atomic::Ordering;
    let v = LINUX_KERNEL_CACHED.load(Ordering::Acquire);
    if v != 0 {
        return v == 2;
    }
    let detected: u8 = 'detect: {
        let z = bun_core::zstr!("/proc/version");
        let Ok(file) = open(z, O::RDONLY | O::NOCTTY, 0).map(CloseOnDrop::new) else {
            break 'detect 1;
        };
        let mut buf = [0u8; 512];
        let n = file.read(&mut buf).unwrap_or(0);
        if bun_core::strings::contains_case_insensitive_ascii(&buf[..n], b"freebsd") {
            2
        } else {
            1
        }
    };
    LINUX_KERNEL_CACHED.store(detected, Ordering::Release);
    detected == 2
}

/// `<prefix><fd number>`, NUL-terminated in `buf`.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn fd_path_z<'a>(prefix: &[u8], fd: Fd, buf: &'a mut [u8; 32]) -> &'a ZStr {
    buf[..prefix.len()].copy_from_slice(prefix);
    let end = prefix.len() + bun_core::fmt::print_int(&mut buf[prefix.len()..], fd.native());
    ZStr::nul_terminate(buf, end)
}

/// readlink `/dev/fd/N` (fdescfs).
#[cfg(any(target_os = "linux", target_os = "android"))]
fn get_fd_path_freebsd_linuxulator<'a>(
    fd: Fd,
    out: &'a mut bun_paths::PathBuffer,
) -> Maybe<&'a mut [u8]> {
    let len = readlink(fd_path_z(b"/dev/fd/", fd, &mut [0u8; 32]), &mut out.0)?;
    Ok(&mut out.0[..len])
}

/// The temporary directory of this user, whatever `$TMPDIR` says. `None` unless only the user can open it.
#[cfg(target_os = "macos")]
pub fn darwin_user_temp_dir(out: &mut bun_paths::PathBuffer) -> Option<&[u8]> {
    // SAFETY: it writes `out.len()` bytes at most.
    let len_with_nul = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            out.0.as_mut_ptr().cast(),
            out.0.len(),
        )
    };
    let dir = out.0.get(..len_with_nul)?.strip_suffix(b"\0")?;
    // libc falls back to `$TMPDIR` and to `/var/tmp`.
    let st = stat(&bun_core::ZBox::from_bytes(dir)).ok()?;
    let is_private = st.st_uid == c::getuid() && st.st_mode & 0o077 == 0;
    is_private.then(|| bun_paths::without_trailing_sep(dir))
}

/// fd → absolute path. Linux: readlink `/proc/self/fd/N`;
/// macOS: `fcntl(F_GETPATH)`; Windows: `GetFinalPathNameByHandle`.
pub fn get_fd_path<'a>(fd: Fd, out: &'a mut bun_paths::PathBuffer) -> Maybe<&'a mut [u8]> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // Fast path: a previous call already proved this is
        // FreeBSD's Linuxulator. Skip the doomed `/proc/self/fd/N` readlink.
        if linux_kernel_cached_is_freebsd() {
            return get_fd_path_freebsd_linuxulator(fd, out);
        }
        match readlink(fd_path_z(b"/proc/self/fd/", fd, &mut [0u8; 32]), &mut out.0) {
            Ok(len) => return Ok(&mut out.0[..len]),
            Err(e) => {
                // Under FreeBSD Linuxulator, fall back to
                // `getFdPathFreeBSDLinuxulator` (`/dev/fd/N`). Probing variant
                // (memoized read of `/proc/version`); only taken once.
                if linux_kernel_is_freebsd() {
                    return get_fd_path_freebsd_linuxulator(fd, out);
                }
                return Err(e);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        const { assert!(bun_paths::MAX_PATH_BYTES >= libc::MAXPATHLEN as usize) };
        out.0.fill(0);
        let address = out.0.as_mut_ptr().expose_provenance() as isize;
        // SAFETY: F_GETPATH writes at most MAXPATHLEN bytes.
        if let Err(mut err) = unsafe { fcntl_unchecked(fd, libc::F_GETPATH, address) } {
            // `F_GETPATH` reports a path longer than `MAXPATHLEN` as `ENOSPC`.
            if err.get_errno() == E::ENOSPC {
                err.errno = E::ENAMETOOLONG as _;
            }
            return Err(err);
        }
        let len = bun_core::slice_to_nul(&out.0).len();
        return Ok(&mut out.0[..len]);
    }
    #[cfg(windows)]
    {
        // `GetFinalPathNameByHandle` into a wide buffer,
        // then transcode WTF-16 → UTF-8 into `out`.
        let mut wide_buf = bun_paths::w_path_buffer_pool::get();
        let wide_slice = match crate::windows::GetFinalPathNameByHandle(
            fd.native(),
            Default::default(),
            &mut wide_buf.0[..],
        ) {
            Ok(p) => p,
            Err(_) => return Err(Error::from_code(E::EBADF, Tag::GetFinalPathNameByHandle)),
        };
        let len = write_path_from_windows(&mut out.0, wide_slice, Tag::GetFinalPathNameByHandle)?;
        return Ok(&mut out.0[..len]);
    }
    #[cfg(target_os = "freebsd")]
    {
        // FreeBSD: F_KINFO returns a `struct kinfo_file`
        // with `kf_path`. The /dev/fd readlink trick used for the Linuxulator
        // path doesn't resolve to an absolute path on native FreeBSD, so go
        // via fcntl. Mirrors `bun_core::util::fd_path_raw` (T0 sibling).
        let mut kif: libc::kinfo_file = bun_core::ffi::zeroed();
        kif.kf_structsize = core::mem::size_of::<libc::kinfo_file>() as c_int;
        let address = (&raw mut kif).expose_provenance() as isize;
        // SAFETY: F_KINFO writes one `kinfo_file`.
        unsafe { fcntl_unchecked(fd, libc::F_KINFO, address) }?;
        let path = bun_core::ffi::c_field_bytes(&kif.kf_path);
        // The kernel fills kf_path from the namecache and leaves it empty when it
        // has no name for the vnode (seen for a just-created file on UFS).
        if path.is_empty() {
            return Err(Error::from_code_int(libc::ENOENT, Tag::fcntl).with_fd(fd));
        }
        out.0[..path.len()].copy_from_slice(path);
        return Ok(&mut out.0[..path.len()]);
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd",
        windows
    )))]
    {
        let _ = (fd, out);
        Err(Error::from_code_int(libc::ENOSYS, Tag::readlink))
    }
}

/// [`get_fd_path`], returning an owned path.
pub fn get_fd_path_owned(fd: Fd) -> Maybe<bun_paths::Path> {
    let mut buf = bun_paths::path_buffer_pool::get();
    Ok(bun_paths::Path::from(get_fd_path(fd, &mut buf)?))
}

/// fd → absolute wide path (Windows `GetFinalPathNameByHandleW`).
/// `\\?\` prefix and `\\?\UNC\` are stripped. Higher-tier callers
/// (`bun.getFdPathW`) re-export this.
#[cfg(windows)]
pub fn get_fd_path_w(fd: Fd, out: &mut [u16]) -> Maybe<&mut [u16]> {
    crate::windows::GetFinalPathNameByHandle(fd.native(), Default::default(), out).map_err(|e| {
        use crate::windows::GetFinalPathNameByHandleError as GE;
        Error::from_code(
            match e {
                GE::FileNotFound => E::ENOENT,
                GE::NameTooLong => E::ENAMETOOLONG,
            },
            Tag::GetFinalPathNameByHandle,
        )
    })
}

// ── environ ──

/// Borrowed slice of the process's `KEY=VALUE\0` C strings.
///
/// # Safety
/// On POSIX, nothing changes the environment (`setenv`, `putenv`) during `'a`.
pub unsafe fn environ<'a>() -> &'a [bun_core::CStrRef<'a>] {
    #[cfg(unix)]
    {
        // SAFETY: `environ` is a NULL-terminated array of C strings, live for `'a` by fn contract.
        unsafe {
            let mut n = 0usize;
            let base: *const *const c_char = bun_core::c_environ();
            if base.is_null() {
                return &[];
            }
            while !(*base.add(n)).is_null() {
                n += 1;
            }
            core::slice::from_raw_parts(base.cast(), n)
        }
    }
    #[cfg(windows)]
    {
        let entries = bun_core::os::environ().unterminated();
        // SAFETY: each entry is `Some` by the contract of `set_environ`, so it has the bytes of a `CStrRef`.
        unsafe { core::slice::from_raw_parts(entries.as_ptr().cast(), entries.len()) }
    }
}

// ── moveFileZWithHandle ──

/// `renameat`, or copy-then-unlink on EXDEV. Replaces an empty directory.
pub fn move_file_z_with_handle(
    from_handle: Fd,
    from_dir: Fd,
    filename: &ZStr,
    to_dir: Fd,
    destination: &ZStr,
) -> Maybe<()> {
    let attempt = || match renameat(from_dir, filename, to_dir, destination) {
        Err(e) if e.get_errno() == E::EXDEV => {
            copy_file_z_slow_with_handle(from_handle, to_dir, destination)?;
            let _ = unlinkat(from_dir, filename);
            Ok(())
        }
        renamed => renamed,
    };
    match attempt() {
        // Windows also reports a directory as `EPERM`.
        Err(e) if e.get_errno() == E::EISDIR || (cfg!(windows) && e.get_errno() == E::EPERM) => {
            let _ = rmdirat(to_dir, destination);
            attempt()
        }
        moved => moved,
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
        if n == 0 {
            return Ok(());
        }
        let mut wrote = 0;
        while wrote < n {
            let w = write(out, &buf[wrote..n])?;
            if w == 0 {
                return Err(Error::from_code_int(libc::EIO, Tag::write));
            }
            wrote += w;
        }
    }
}

/// Walks up from `path` until `mkdir` does not say `ENOENT`, then back down. `EEXIST` is success, and a root is never made.
pub fn mkdir_recursive_with<C: bun_paths::PathUnit>(
    path: &[C],
    mut mkdir: impl FnMut(&[C]) -> Maybe<()>,
) -> Maybe<()> {
    let path = bun_paths::without_trailing_sep(path);
    let root_len = bun_paths::root(path).len();
    let mut len = path.len();
    // `ENOENT` again once its parent exists (a dangling symlink) can never succeed.
    let mut last_not_found = None;
    while len > root_len {
        match mkdir(&path[..len]) {
            Err(err) if err.get_errno() == E::ENOENT => {
                let parent = bun_paths::ancestors(&path[..len])
                    .nth(1)
                    .unwrap_or_default();
                if last_not_found.replace(len) == Some(len) || parent.len() <= root_len {
                    return Err(err);
                }
                len = parent.len();
            }
            Err(err) if err.get_errno() != E::EEXIST => return Err(err),
            _ if len == path.len() => break,
            _ => {
                let below = bun_paths::without_leading_sep(&path[len..]);
                let name_len = below.iter().position(|&unit| bun_paths::is_sep(unit));
                len = path.len() - below.len() + name_len.unwrap_or(below.len());
            }
        }
    }
    Ok(())
}

/// `bun.mkdirRecursive` — `make_path` cwd-relative, taking a slice.
#[inline]
pub fn mkdir_recursive(sub_path: &[u8]) -> Maybe<()> {
    mkdir_recursive_at(Fd::cwd(), sub_path)
}

// ──────────────────────────────────────────────────────────────────────────
// `std.posix` — wider surface than `bun_errno::posix` (which only has
// mode_t/E/S/errno). Dependents (`bun_resolver`, `bun_md`, `bun_crash`,
// `bun_threading`) reach for `Sigaction`, `getrlimit`, `tcgetattr`, raw
// `poll`, `dl_iterate_phdr` etc. We re-export the errno stub
// and layer the libc bits on top so `bun_sys::posix::*` is the single import.
// ──────────────────────────────────────────────────────────────────────────
pub mod posix {
    pub use bun_errno::posix::*;
    use core::ffi::c_int;
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    use core::ffi::c_void;

    // ── BSD sysctl(3) family ──
    // macOS/FreeBSD only — Linux dropped sysctl(2) and uses procfs instead.
    /// Typed `sysctlbyname(3)` read of a fixed-size POD value (`hw.ncpu`,
    /// `hw.cpufrequency`, `kern.boottime`, …). Hides the `*mut c_void` /
    /// `&mut len` dance.
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    #[inline]
    pub fn sysctl_read<T: bun_core::AnyBitPattern>(
        name: &core::ffi::CStr,
        out: &mut T,
    ) -> super::Maybe<()> {
        let mut len = core::mem::size_of::<T>();
        // SAFETY: `out` is `&mut T` → exclusive, valid for `size_of::<T>()`
        // writes; `T: AnyBitPattern` so the raw bytes form a valid `T`;
        // `newp = null` → read-only sysctl, kernel never reads through `oldp`.
        let rc = unsafe {
            libc::sysctlbyname(
                name.as_ptr(),
                core::ptr::from_mut(out).cast::<c_void>(),
                &raw mut len,
                core::ptr::null_mut(),
                0,
            )
        };
        if rc != 0 {
            return Err(super::err_with(super::Tag::TODO));
        }
        Ok(())
    }

    /// Slice-typed `sysctlbyname(3)` read (`kern.cp_times`, string MIBs into a
    /// `[u8]`, …). Returns the byte count the kernel wrote (note: not always
    /// updated for string MIBs whose output fits — callers reading strings
    /// should still scan for NUL).
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    #[inline]
    pub fn sysctl_read_slice<T: bun_core::AnyBitPattern>(
        name: &core::ffi::CStr,
        buf: &mut [T],
    ) -> super::Maybe<usize> {
        let mut len = core::mem::size_of_val(buf);
        // SAFETY: `buf` is `&mut [T]` → exclusive, valid for `len` writes;
        // `T: AnyBitPattern` so partial / full kernel writes leave valid `T`s.
        let rc = unsafe {
            libc::sysctlbyname(
                name.as_ptr(),
                buf.as_mut_ptr().cast::<c_void>(),
                &raw mut len,
                core::ptr::null_mut(),
                0,
            )
        };
        if rc != 0 {
            return Err(super::err_with(super::Tag::TODO));
        }
        Ok(len)
    }

    /// `gethostname(2)` into `buf`. On success the hostname is NUL-terminated
    /// somewhere in `buf` (POSIX guarantees truncation+NUL when `buf` is at
    /// least `HOST_NAME_MAX+1`).
    #[cfg(unix)]
    #[inline]
    pub fn gethostname(buf: &mut [u8]) -> super::Maybe<()> {
        // SAFETY: `buf` is `&mut [u8]` → exclusive, valid for `buf.len()` writes.
        let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len() as _) };
        if rc != 0 {
            return Err(super::err_with(super::Tag::TODO));
        }
        Ok(())
    }

    /// `uname(2)`. Returns a zeroed struct on the (POSIX-impossible) error
    /// path so callers never observe uninitialised bytes.
    #[cfg(unix)]
    pub use bun_core::ffi::uname;

    /// `sysinfo(2)` (Linux).
    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[inline]
    pub fn sysinfo() -> super::Maybe<libc::sysinfo> {
        unsafe extern "C" {
            // safe: out-param is `&mut libc::sysinfo` (non-null, valid for
            // `sizeof(sysinfo)` writes); kernel only writes the slot and
            // reports failure via the return value — no other preconditions.
            safe fn sysinfo(info: &mut libc::sysinfo) -> core::ffi::c_int;
        }
        let mut info: libc::sysinfo = bun_core::ffi::zeroed();
        let rc = sysinfo(&mut info);
        if rc != 0 {
            return Err(super::err_with(super::Tag::TODO));
        }
        Ok(info)
    }

    // ── address families ──
    // `libc` does not expose `AF_*` on `x86_64-pc-windows-msvc`; route through
    // ws2def.h values there. INET6 is *not* portable (10 on Linux, 30 on
    // Darwin/BSD, 23 on Windows) — keep the `libc` symbol on POSIX.
    pub mod AF {
        use core::ffi::c_int;
        // Windows literals live in `bun_windows_sys::ws2_32` (leaf tier-0); route
        // through it so the hardcoded `2/23` exists in exactly one place.
        #[cfg(windows)]
        pub const UNSPEC: c_int = bun_windows_sys::ws2_32::AF_UNSPEC;
        #[cfg(windows)]
        pub const UNIX: c_int = bun_windows_sys::ws2_32::AF_UNIX;
        #[cfg(windows)]
        pub const INET: c_int = bun_windows_sys::ws2_32::AF_INET;
        #[cfg(windows)]
        pub const INET6: c_int = bun_windows_sys::ws2_32::AF_INET6;
        #[cfg(unix)]
        pub const INET: c_int = libc::AF_INET;
        #[cfg(unix)]
        pub const INET6: c_int = libc::AF_INET6;
    }

    // ── sockaddr family ──
    #[cfg(unix)]
    pub use libc::{sockaddr_in, sockaddr_in6, sockaddr_storage};
    // Route through `bun_libuv_sys` (not `bun_windows_sys::ws2_32`) so types
    // returned by libuv APIs (`uv_udp_*`) are the
    // *same* nominal type callers see via `bun_sys::posix::sockaddr_*` — Rust
    // doesn't structurally unify two identical-layout `#[repr(C)]` structs.
    #[cfg(windows)]
    pub use bun_libuv_sys::{sockaddr_in, sockaddr_in6, sockaddr_storage};

    // ── access(2) mode bits ──
    // POSIX-standard values; libuv re-uses the same numbers on Windows
    // (`uv/win.h`), so these are target-invariant.
    pub const F_OK: c_int = 0;
    pub const R_OK: c_int = 4;
    pub const W_OK: c_int = 2;
    pub const X_OK: c_int = 1;

    // ── stat mode-kind tests ──
    // `libc::S_IF*` is `mode_t` (u32 on Linux, u16 on Darwin/FreeBSD); widen to
    // `u32` so the `m: u32` (== `bun_core::Mode`) comparison is uniform.
    #[cfg(unix)]
    #[inline]
    pub const fn s_islnk(m: u32) -> bool {
        (m & libc::S_IFMT as u32) == libc::S_IFLNK as u32
    }
    #[cfg(unix)]
    #[inline]
    pub const fn s_isdir(m: u32) -> bool {
        (m & libc::S_IFMT as u32) == libc::S_IFDIR as u32
    }

    // ── signals ──
    #[cfg(unix)]
    pub use libc::sigaction as Sigaction;
    #[cfg(unix)]
    pub use libc::siginfo_t;
    #[cfg(unix)]
    pub use libc::sigset_t;
    /// `sigaction(sig, &act, *oact)`.
    #[cfg(unix)]
    #[inline]
    pub unsafe fn sigaction(sig: c_int, act: *const Sigaction, oact: *mut Sigaction) -> c_int {
        // SAFETY: caller contract — `act`/`oact` are each null or point to a
        // valid `sigaction` struct for the call's duration.
        unsafe { libc::sigaction(sig, act, oact) }
    }

    // ── time ──
    #[cfg(unix)]
    pub use libc::timespec;
    #[cfg(unix)]
    pub use libc::timeval;

    #[cfg(windows)]
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct timespec {
        pub(crate) tv_sec: i64,
        pub(crate) tv_nsec: i64,
    }

    // ── poll ──
    #[cfg(unix)]
    pub use libc::pollfd as PollFd;
    #[cfg(unix)]
    pub const POLL_IN: i16 = libc::POLLIN;
    #[cfg(unix)]
    pub const POLL_OUT: i16 = libc::POLLOUT;
    /// `bun.sys.poll` — `poll$NOCANCEL` on Darwin,
    /// EINTR-retried, tagged `.poll` (NOT `.ppoll`).
    #[cfg(unix)]
    pub fn poll(
        fds: &mut [PollFd],
        timeout_ms: c_int,
    ) -> core::result::Result<c_int, super::Error> {
        loop {
            // SAFETY: the kernel reads and writes `fds.len()` entries.
            #[cfg(target_os = "macos")]
            let rc = unsafe { super::nocancel::poll(fds.as_mut_ptr(), fds.len() as _, timeout_ms) };
            #[cfg(not(target_os = "macos"))]
            let rc = bun_core::poll_once(fds, timeout_ms);
            if rc < 0 {
                let e = super::last_errno();
                if e == libc::EINTR {
                    continue;
                }
                return Err(super::Error::from_code_int(e, super::Tag::poll));
            }
            return Ok(rc);
        }
    }

    // ── termios ──
    #[cfg(unix)]
    pub use libc::termios as Termios;
    #[cfg(unix)]
    #[derive(Clone, Copy)]
    #[repr(i32)]
    pub enum TCSA {
        Now = libc::TCSANOW,
        Drain = libc::TCSADRAIN,
        Flush = libc::TCSAFLUSH,
    }
    #[cfg(unix)]
    pub fn tcgetattr(fd: c_int) -> core::result::Result<Termios, super::Error> {
        // musl passes it on to the kernel, whose `termios` is shorter.
        let mut t: Termios = bun_core::ffi::zeroed();
        let rc = crate::safe_libc::tcgetattr(fd, &mut t);
        if rc < 0 {
            return Err(super::err_with(super::Tag::ioctl));
        }
        Ok(t)
    }
    #[cfg(unix)]
    pub fn tcsetattr(
        fd: c_int,
        action: TCSA,
        t: &Termios,
    ) -> core::result::Result<(), super::Error> {
        let rc = crate::safe_libc::tcsetattr(fd, action as c_int, t);
        if rc < 0 {
            return Err(super::err_with(super::Tag::ioctl));
        }
        Ok(())
    }

    /// For input and output.
    #[cfg(unix)]
    pub fn cfsetspeed(t: &mut Termios, speed: libc::speed_t) {
        // SAFETY: both only change `t`.
        unsafe {
            libc::cfsetispeed(t, speed);
            libc::cfsetospeed(t, speed);
        }
    }
    #[cfg(unix)]
    pub fn set_winsize(fd: super::Fd, size: bun_core::Winsize) -> super::Maybe<()> {
        // SAFETY: TIOCSWINSZ reads one `winsize`, which `Winsize` mirrors.
        if unsafe { libc::ioctl(fd.native(), libc::TIOCSWINSZ, &raw const size) } != 0 {
            return Err(super::err_with(super::Tag::ioctl));
        }
        Ok(())
    }

    // ── rmdir ──

    /// The call that libuv makes. [`crate::rmdir`] is `unlinkat`.
    #[cfg(unix)]
    pub fn rmdir(path: &bun_core::ZStr) -> super::Maybe<()> {
        // SAFETY: `path` is NUL-terminated.
        while unsafe { libc::rmdir(path.as_ptr()) } < 0 {
            if super::last_errno() != libc::EINTR {
                return Err(super::err_with_path(super::Tag::rmdir, path));
            }
        }
        Ok(())
    }

    // ── rlimit ──
    #[cfg(unix)]
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Rlimit {
        pub cur: u64,
        pub max: u64,
    }
    #[cfg(unix)]
    bun_core::impl_zeroable!(Rlimit);
    #[cfg(unix)]
    #[derive(Clone, Copy)]
    #[repr(i32)]
    pub enum RlimitResource {
        NOFILE = libc::RLIMIT_NOFILE as _,
        STACK = libc::RLIMIT_STACK as _,
        CORE = libc::RLIMIT_CORE as _,
    }
    #[cfg(unix)]
    pub fn getrlimit(res: RlimitResource) -> core::result::Result<Rlimit, super::Error> {
        let mut r = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        let rc = crate::safe_libc::getrlimit(res as c_int, &mut r);
        if rc < 0 {
            return Err(super::err_with(super::Tag::getrlimit));
        }
        Ok(Rlimit {
            cur: r.rlim_cur as u64,
            max: r.rlim_max as u64,
        })
    }
    #[cfg(unix)]
    pub fn setrlimit(res: RlimitResource, lim: Rlimit) -> core::result::Result<(), super::Error> {
        let r = libc::rlimit {
            rlim_cur: lim.cur as _,
            rlim_max: lim.max as _,
        };
        let rc = crate::safe_libc::setrlimit(res as c_int, &r);
        if rc < 0 {
            return Err(super::err_with(super::Tag::setrlimit));
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Socket addresses and socket calls. The resolver is in `bun_dns`.
// ──────────────────────────────────────────────────────────────────────────
pub mod net {
    use crate::{Fd, Maybe, Tag};
    use bun_core::vec::BorrowedCursor;
    use core::ffi::c_int;
    use core::fmt;
    use core::net::{SocketAddr, SocketAddrV4, SocketAddrV6};

    // POSIX libc has `sockaddr_*` at the crate root; MSVC libc does not. Route
    // both through a private `sock` shim so the body below is target-agnostic.
    #[cfg(unix)]
    mod sock {
        pub(super) use crate::err_with;
        pub(super) use libc::{
            AF_INET, AF_INET6, bind, connect, getsockname, recvfrom, setsockopt, sockaddr_storage,
            socklen_t,
        };
    }
    #[cfg(windows)]
    mod sock {
        use crate::windows::Win32Error;
        use crate::{Error, Tag};
        // Same nominal type as `bun_sys::posix::sockaddr_storage` (see comment there).
        pub(super) use bun_libuv_sys::sockaddr_storage;
        pub(super) use bun_windows_sys::ws2_32::{
            AF_INET, AF_INET6, bind, connect, getsockname, recvfrom, setsockopt, socklen_t,
        };

        pub(super) fn err_with(tag: Tag) -> Error {
            Error::from_win32(Win32Error::get(), tag)
        }
    }
    use sock::{AF_INET, AF_INET6, err_with, sockaddr_storage, socklen_t};

    // ──────────────────────────────────────────────────────────────────────
    // `sockaddr_in` / `sockaddr_in6` with un-prefixed field names
    // (`family`/`port`/`addr`/`flowinfo`/`scope_id`) so call sites written
    // against this shape stay target-agnostic.
    //
    // Layout-identical to the C-named ground truth re-exported at
    // `crate::posix::sockaddr_in[6]` (= `libc` on Unix, `ws2_32` via
    // `bun_libuv_sys` on Windows) — asserted below. Kept as a *distinct*
    // nominal type because the C structs use `sin_*`/`sin6_*` names AND nest
    // `in_addr`/`in6_addr`; Rust won't structurally unify.
    //
    // BSD targets carry a leading `len: u8` and `sa_family_t == u8`; the
    // `ZEROED` const pre-fills `len = size_of::<Self>()`
    // so struct-update initializers (`..sockaddr_in::ZEROED`)
    // work uniformly on all targets and in `const` context.
    // ──────────────────────────────────────────────────────────────────────
    #[cfg(unix)]
    pub type sa_family_t = libc::sa_family_t;
    #[cfg(unix)]
    pub type in_port_t = libc::in_port_t;
    #[cfg(windows)]
    pub type sa_family_t = u16; // ws2def.h: `typedef USHORT ADDRESS_FAMILY;`
    #[cfg(windows)]
    pub type in_port_t = u16;

    // The BSD `len` field is `#[cfg]`-gated in BOTH the struct definition and
    // the `ZEROED` initializer — Rust accepts outer attributes on struct-
    // expression fields, so a single body suffices on all targets.
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_in {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        pub len: u8,
        pub family: sa_family_t,
        pub port: in_port_t,
        pub addr: u32,
        pub zero: [u8; 8],
    }
    impl sockaddr_in {
        pub const ZEROED: Self = Self {
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            len: core::mem::size_of::<Self>() as u8,
            family: 0,
            port: 0,
            addr: 0,
            zero: [0; 8],
        };
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_in6 {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        pub len: u8,
        pub family: sa_family_t,
        pub port: in_port_t,
        pub flowinfo: u32,
        pub addr: [u8; 16],
        pub scope_id: u32,
    }
    impl sockaddr_in6 {
        pub const ZEROED: Self = Self {
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            len: core::mem::size_of::<Self>() as u8,
            family: 0,
            port: 0,
            flowinfo: 0,
            addr: [0; 16],
            scope_id: 0,
        };
    }
    bun_core::impl_pod!(sockaddr_in, sockaddr_in6);
    const _: () = assert!(
        core::mem::size_of::<sockaddr_in>() == core::mem::size_of::<crate::posix::sockaddr_in>()
    );
    const _: () = assert!(
        core::mem::align_of::<sockaddr_in>() == core::mem::align_of::<crate::posix::sockaddr_in>()
    );
    const _: () = assert!(
        core::mem::size_of::<sockaddr_in6>() == core::mem::size_of::<crate::posix::sockaddr_in6>()
    );
    const _: () = assert!(
        core::mem::align_of::<sockaddr_in6>()
            == core::mem::align_of::<crate::posix::sockaddr_in6>()
    );

    /// A `sockaddr_storage` that is read by its family.
    #[repr(transparent)]
    #[derive(Clone, Copy)]
    pub struct Address {
        /// Generic storage; `family()` discriminates. Every byte is initialized.
        any: sockaddr_storage,
    }
    impl Address {
        /// Truncates or zero-pads `bytes` to the size of a `sockaddr_storage`.
        pub fn from_bytes(bytes: &[u8]) -> Self {
            let mut any: sockaddr_storage = bun_core::ffi::zeroed();
            let len = bytes.len().min(size_of::<sockaddr_storage>());
            // SAFETY: `len` bytes fit in `any`, for which any bytes are valid.
            unsafe { core::ptr::copy_nonoverlapping(bytes.as_ptr(), (&raw mut any).cast(), len) };
            Self { any }
        }
        pub fn from_ref(any: &sockaddr_storage) -> &Self {
            // SAFETY: `Address` is `#[repr(transparent)]` over `sockaddr_storage`. Safe code only gets one
            // with every byte initialized, except from `Packet::peer` on Windows, where only
            // the address is: that one must not be copied or passed to `as_bytes`.
            unsafe { &*core::ptr::from_ref(any).cast::<Self>() }
        }
        #[inline]
        pub fn family(&self) -> i32 {
            self.any.ss_family as i32
        }

        /// Lay out `ip`:`port` as a sockaddr — the one place an in/in6 struct is written over the storage, so callers never cast.
        pub fn from_ip(ip: core::net::IpAddr, port: u16) -> Self {
            match ip {
                core::net::IpAddr::V4(v4) => Self::from_bytes(bun_core::bytes_of(&sockaddr_in {
                    family: AF_INET as sa_family_t,
                    port: port.to_be(),
                    addr: u32::from_ne_bytes(v4.octets()),
                    ..sockaddr_in::ZEROED
                })),
                core::net::IpAddr::V6(v6) => Self::from_bytes(bun_core::bytes_of(&sockaddr_in6 {
                    family: AF_INET6 as sa_family_t,
                    port: port.to_be(),
                    addr: v6.octets(),
                    ..sockaddr_in6::ZEROED
                })),
            }
        }

        /// `None` unless the family is `AF_INET` or `AF_INET6`.
        pub fn to_socket_addr(&self) -> Option<SocketAddr> {
            if let Some(v4) = self.as_in4() {
                let ip = v4.addr.to_ne_bytes().into();
                return Some(SocketAddrV4::new(ip, u16::from_be(v4.port)).into());
            }
            let v6 = self.as_in6()?;
            let (port, flowinfo) = (u16::from_be(v6.port), u32::from_be(v6.flowinfo));
            Some(SocketAddrV6::new(v6.addr.into(), port, flowinfo, v6.scope_id).into())
        }

        /// `None` unless the family is `AF_INET` or `AF_INET6`.
        #[cfg(unix)]
        pub fn port(&self) -> Option<u16> {
            let port = match self.as_in4() {
                Some(v4) => v4.port,
                None => self.as_in6()?.port,
            };
            Some(u16::from_be(port))
        }

        /// Ignored unless the family is `AF_INET` or `AF_INET6`.
        #[cfg(unix)]
        pub fn set_port(&mut self, port: u16) {
            if let AF_INET | AF_INET6 = self.family() {
                // SAFETY: a `sockaddr_in` fits in the storage. `port` has the same offset in a `sockaddr_in6`.
                unsafe { (*(&raw mut self.any).cast::<sockaddr_in>()).port = port.to_be() };
            }
        }

        /// The IPv6 zone index (`fe80::1%en0`); ignored for IPv4.
        pub fn set_scope_id(&mut self, scope_id: u32) {
            if self.family() == AF_INET6 {
                // SAFETY: a `sockaddr_in6` fits in the storage.
                unsafe { (*(&raw mut self.any).cast::<sockaddr_in6>()).scope_id = scope_id };
            }
        }

        /// The bytes of the `sockaddr_in` or `sockaddr_in6`; empty for any other family.
        pub fn as_bytes(&self) -> &[u8] {
            if let Some(v4) = self.as_in4() {
                return bun_core::bytes_of(v4);
            }
            self.as_in6().map_or(&[], bun_core::bytes_of)
        }

        /// The raw storage, for FFI that takes `sockaddr_storage` by value.
        pub fn into_storage(self) -> sockaddr_storage {
            self.any
        }
        /// Tag-checked borrow of the IPv4 payload. `None` unless
        /// `family() == AF_INET`.
        #[inline]
        pub fn as_in4(&self) -> Option<&sockaddr_in> {
            if self.family() == AF_INET {
                // SAFETY: the bytes of `any` are initialized, any bytes are a valid
                // `sockaddr_in`, and `sockaddr_storage` is guaranteed by POSIX/ws2def.h
                // to have size and alignment >= `sockaddr_in`.
                Some(unsafe { &*(&raw const self.any).cast::<sockaddr_in>() })
            } else {
                None
            }
        }
        /// Tag-checked borrow of the IPv6 payload. `None` unless
        /// `family() == AF_INET6`.
        #[inline]
        pub fn as_in6(&self) -> Option<&sockaddr_in6> {
            if self.family() == AF_INET6 {
                // SAFETY: as in `as_in4`, for `sockaddr_in6`.
                Some(unsafe { &*(&raw const self.any).cast::<sockaddr_in6>() })
            } else {
                None
            }
        }
        /// `None` unless `family() == AF_UNIX`.
        #[cfg(unix)]
        pub fn as_un(&self) -> Option<&libc::sockaddr_un> {
            if self.family() == libc::AF_UNIX {
                // SAFETY: as in `as_in4`, for `sockaddr_un`.
                Some(unsafe { &*(&raw const self.any).cast::<libc::sockaddr_un>() })
            } else {
                None
            }
        }
    }
    impl fmt::Debug for Address {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            fmt::Display::fmt(self, f)
        }
    }
    impl fmt::Display for Address {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self.to_socket_addr() {
                // `[addr%scope]:port` for IPv6 is the shape `bun_core::fmt::format_ip` expects to strip.
                Some(address) => fmt::Display::fmt(&address, f),
                None => write!(f, "<addr family={}>", self.family()),
            }
        }
    }

    /// Does not block, is not inherited, and closes when dropped.
    pub struct Socket(Fd);

    impl Socket {
        #[cfg(unix)]
        pub fn new(family: c_int, kind: c_int) -> Maybe<Self> {
            #[cfg(not(target_os = "macos"))]
            let kind = kind | libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK;
            let this = Self(crate::move_above_stdio(socket(family, kind)?));
            #[cfg(target_os = "macos")]
            {
                crate::fcntl(this.0, crate::Fcntl::SetFd, libc::FD_CLOEXEC as isize)?;
                crate::fcntl(this.0, crate::Fcntl::SetFl, libc::O_NONBLOCK as isize)?;
            }
            Ok(this)
        }

        #[cfg(windows)]
        pub fn new(family: c_int, kind: c_int) -> Maybe<Self> {
            use bun_windows_sys::ws2_32 as ws;
            bun_libuv_sys::uv__winsock_ensure();
            let flags = ws::WSA_FLAG_OVERLAPPED | ws::WSA_FLAG_NO_HANDLE_INHERIT;
            // SAFETY: no protocol info is given.
            let socket = unsafe { ws::WSASocketW(family, kind, 0, core::ptr::null(), 0, flags) };
            if socket == ws::INVALID_SOCKET {
                return Err(err_with(Tag::socket));
            }
            let this = Self(Fd::from_system(socket as _));
            // SAFETY: FIONBIO reads a `u_long`.
            if unsafe { ws::ioctlsocket(socket, ws::FIONBIO, &mut 1) } != 0 {
                return Err(err_with(Tag::socket));
            }
            Ok(this)
        }

        pub fn fd(&self) -> Fd {
            self.0
        }
    }

    impl Drop for Socket {
        fn drop(&mut self) {
            // SAFETY: `self` owns it. A preloaded library that saw `socket` has to see this too.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let _ = unsafe { libc::close(self.0.native()) };
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            let _ = crate::close(self.0);
            // SAFETY: `self` owns it.
            #[cfg(windows)]
            let _ = unsafe { bun_windows_sys::ws2_32::closesocket(self.0.native() as _) };
        }
    }

    /// `address` is the bytes of a `sockaddr_*`.
    pub fn bind(fd: Fd, address: &[u8]) -> Maybe<()> {
        let len = address.len() as socklen_t;
        // SAFETY: bind(2) reads at most `len` bytes of `address`.
        if unsafe { sock::bind(fd.native() as _, address.as_ptr().cast(), len) } != 0 {
            return Err(err_with(Tag::bind2));
        }
        Ok(())
    }

    /// `address` is the bytes of a `sockaddr_*`. After `EINTR`, it goes on as after `EINPROGRESS`.
    pub fn connect(fd: Fd, address: &[u8]) -> Maybe<()> {
        let len = address.len() as socklen_t;
        // SAFETY: connect(2) reads at most `len` bytes of `address`.
        if unsafe { sock::connect(fd.native() as _, address.as_ptr().cast(), len) } != 0 {
            return Err(err_with(Tag::connect2));
        }
        Ok(())
    }

    pub fn getsockname(fd: Fd) -> Maybe<Address> {
        let mut any: sockaddr_storage = bun_core::ffi::zeroed();
        let mut len = size_of::<sockaddr_storage>() as socklen_t;
        // SAFETY: getsockname(2) writes at most `len` bytes into `any`.
        if unsafe { sock::getsockname(fd.native() as _, (&raw mut any).cast(), &raw mut len) } != 0
        {
            return Err(err_with(Tag::getsockname));
        }
        Ok(Address { any })
    }

    pub fn setsockopt_int(fd: Fd, level: c_int, name: c_int, value: c_int) -> Maybe<()> {
        let (value, len) = (&raw const value, size_of::<c_int>() as socklen_t);
        // SAFETY: setsockopt(2) reads at most `len` bytes, too few for an option that holds a pointer.
        if unsafe { sock::setsockopt(fd.native() as _, level, name, value.cast(), len) } != 0 {
            return Err(err_with(Tag::setsockopt));
        }
        Ok(())
    }

    /// Returns the sender, which has no family if `fd` is a stream.
    pub fn recvfrom_buf(fd: Fd, mut cursor: BorrowedCursor<'_, u8>) -> Maybe<Address> {
        let mut any: sockaddr_storage = bun_core::ffi::zeroed();
        let mut len = size_of::<sockaddr_storage>() as socklen_t;
        let capacity = cursor.capacity().min(c_int::MAX as usize);
        // SAFETY: recvfrom(2) writes at most `len` bytes into `any`. It initializes as many bytes of
        // `cursor` as it reports, at most `capacity`, and uninitializes none.
        unsafe {
            let received = sock::recvfrom(
                fd.native() as _,
                cursor.as_mut().as_mut_ptr().cast(),
                capacity as _,
                0,
                (&raw mut any).cast(),
                &raw mut len,
            );
            cursor.advance(usize::try_from(received).map_err(|_| err_with(Tag::recv))?);
        }
        Ok(Address { any })
    }

    #[cfg(unix)]
    pub use posix_impl::*;
    #[cfg(unix)]
    mod posix_impl {
        use super::{Address, sockaddr_storage};
        use crate::{Fd, Maybe, Tag, err_with, safe_libc};
        use bun_core::ZStr;
        use core::ffi::{c_int, c_uint};
        use core::mem::offset_of;
        use libc::{sockaddr, socklen_t};

        pub fn socket(family: c_int, kind: c_int) -> Maybe<Fd> {
            let fd = safe_libc::socket(family, kind, 0);
            if fd < 0 {
                return Err(err_with(Tag::socket));
            }
            Ok(Fd::from_native(fd))
        }

        pub fn listen(fd: Fd, backlog: c_int) -> Maybe<()> {
            if safe_libc::listen(fd.native(), backlog) != 0 {
                return Err(err_with(Tag::listen));
            }
            Ok(())
        }

        /// `SOCK_STREAM`, `SOCK_DGRAM` and so on. Not for any option: `SO_GET_FILTER` counts its length in instructions.
        pub fn socket_type(fd: Fd) -> Option<c_int> {
            let mut kind: c_int = 0;
            let mut len = size_of::<c_int>() as socklen_t;
            let (level, name) = (libc::SOL_SOCKET, libc::SO_TYPE);
            // SAFETY: SO_TYPE writes at most `len` bytes into `kind`.
            let rc = unsafe {
                libc::getsockopt(
                    fd.native(),
                    level,
                    name,
                    (&raw mut kind).cast(),
                    &raw mut len,
                )
            };
            (rc == 0).then_some(kind)
        }

        pub fn is_connected(fd: Fd) -> bool {
            let mut peer: sockaddr_storage = bun_core::ffi::zeroed();
            let mut len = size_of::<sockaddr_storage>() as socklen_t;
            // SAFETY: getpeername(2) writes at most `len` bytes into `peer`.
            unsafe { libc::getpeername(fd.native(), (&raw mut peer).cast(), &raw mut len) == 0 }
        }

        /// 0 if no interface has that name.
        pub fn if_nametoindex(name: &ZStr) -> c_uint {
            // SAFETY: `name` is NUL-terminated.
            unsafe { libc::if_nametoindex(name.as_ptr()) }
        }

        pub fn if_indextoname(index: c_uint, buf: &mut [u8; libc::IF_NAMESIZE]) -> Option<&[u8]> {
            // SAFETY: it writes at most `IF_NAMESIZE` bytes.
            let name = unsafe { libc::if_indextoname(index, buf.as_mut_ptr().cast()) };
            (!name.is_null()).then(|| bun_core::slice_to_nul(buf))
        }

        pub fn getifaddrs() -> Maybe<IfAddrList> {
            let mut list = core::ptr::null_mut();
            // SAFETY: valid out-pointer
            if unsafe { libc::getifaddrs(&raw mut list) } != 0 {
                return Err(err_with(Tag::getifaddrs));
            }
            Ok(IfAddrList(list))
        }

        /// The list that `getifaddrs` returns.
        pub struct IfAddrList(*mut libc::ifaddrs);

        impl IfAddrList {
            pub fn iter(&self) -> impl Iterator<Item = IfAddr<'_>> {
                // SAFETY: each link is null or an entry that lives until `drop`.
                core::iter::successors(unsafe { self.0.as_ref() }, |it| unsafe {
                    it.ifa_next.as_ref()
                })
                .map(IfAddr)
            }
        }

        impl Drop for IfAddrList {
            fn drop(&mut self) {
                // SAFETY: returned by getifaddrs
                unsafe { libc::freeifaddrs(self.0) };
            }
        }

        /// An entry of an [`IfAddrList`].
        #[derive(Clone, Copy)]
        pub struct IfAddr<'a>(&'a libc::ifaddrs);

        impl<'a> IfAddr<'a> {
            pub fn name(self) -> &'a [u8] {
                // SAFETY: `ifa_name` is a NUL-terminated C string that lives as long as the list.
                unsafe { bun_core::ffi::cstr(self.0.ifa_name) }.to_bytes()
            }

            pub fn flags(self) -> c_uint {
                self.0.ifa_flags
            }

            fn address_bytes(self) -> Option<&'a [u8]> {
                // SAFETY: `ifa_addr` is null or points into the list.
                unsafe { sockaddr_bytes(self.0.ifa_addr) }
            }

            /// The netmask gets the family of the address (BSD can leave it unset). A null `ifa_netmask` reads as all zeros.
            pub fn address_and_netmask(self) -> Option<(Address, Address)> {
                let address = Address::from_bytes(self.address_bytes()?);
                // SAFETY: `ifa_netmask` is null or points into the list.
                let netmask = unsafe { sockaddr_bytes(self.0.ifa_netmask) };
                let mut netmask = Address::from_bytes(netmask.unwrap_or_default());
                netmask.any.ss_family = address.any.ss_family;
                Some((address, netmask))
            }

            /// The bytes from `sll_addr` / `LLADDR()` on. `None` unless the family is `AF_PACKET` / `AF_LINK`.
            pub fn link_layer_address(self) -> Option<&'a [u8]> {
                let bytes = self.address_bytes()?;
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    let family: libc::sa_family_t = bun_core::read_prefix(bytes)?;
                    (c_int::from(family) == libc::AF_PACKET)
                        .then(|| &bytes[offset_of!(libc::sockaddr_ll, sll_addr)..])
                }
                #[cfg(any(target_os = "macos", target_os = "freebsd"))]
                {
                    use libc::sockaddr_dl;
                    let family = *bytes.get(offset_of!(sockaddr_dl, sdl_family))?;
                    if c_int::from(family) != libc::AF_LINK {
                        return None;
                    }
                    // The name and the address can extend past the declared size of `sdl_data`.
                    let after_name =
                        bytes
                            .get(offset_of!(sockaddr_dl, sdl_nlen))
                            .and_then(|&len| {
                                bytes.get(offset_of!(sockaddr_dl, sdl_data) + usize::from(len)..)
                            });
                    Some(after_name.unwrap_or_default())
                }
            }
        }

        /// # Safety
        /// `addr` is null, or points into a `getifaddrs` list that lives for `'a`.
        unsafe fn sockaddr_bytes<'a>(addr: *const sockaddr) -> Option<&'a [u8]> {
            if addr.is_null() {
                return None;
            }
            // SAFETY: every sockaddr starts with `sa_family`.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let len = match c_int::from(unsafe { (*addr).sa_family }) {
                libc::AF_INET => size_of::<libc::sockaddr_in>(),
                libc::AF_INET6 => size_of::<libc::sockaddr_in6>(),
                libc::AF_PACKET => size_of::<libc::sockaddr_ll>(),
                _ => size_of::<sockaddr>(),
            };
            // SAFETY: every sockaddr starts with `sa_len`. A netmask can be shorter than the struct of its family.
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            let len = usize::from(unsafe { (*addr).sa_len });
            // SAFETY: `getifaddrs` initialized `len` bytes at `addr`.
            Some(unsafe { core::slice::from_raw_parts(addr.cast::<u8>(), len) })
        }
    }
}

/// `std.elf` constants (just what `bun_exe_format`/`bun_crash` need).
pub mod elf {
    pub const PT_LOAD: u32 = 1;
    pub const PT_INTERP: u32 = 3;

    /// Result of [`find_loaded_module`]: the loaded ELF object whose `PT_LOAD`
    /// segment spans a given address.
    #[cfg(not(any(windows, target_os = "macos")))]
    pub struct LoadedModule {
        /// `dlpi_addr` — link-map base address (subtract from the lookup address
        /// to get an image-relative offset).
        pub base_address: usize,
        /// `dlpi_name` copied to an owned buffer (empty when libc reports `NULL`,
        /// as Android does for the main program).
        pub name: Box<[u8]>,
        /// End address (exclusive) of the `PT_LOAD` segment that contains the lookup address.
        pub segment_end: usize,
        /// `dlpi_phdr` — `program_header_count` headers, mapped until the object is unloaded.
        pub program_headers: *const libc::Elf64_Phdr,
        /// `dlpi_phnum`.
        pub program_header_count: usize,
    }

    /// Walk loaded ELF objects via `dl_iterate_phdr`, returning the one whose
    /// `PT_LOAD` segment contains `address` (matched by address, so it does not
    /// depend on how a libc names or orders the main program).
    #[cfg(not(any(windows, target_os = "macos")))]
    pub fn find_loaded_module(address: usize) -> Option<LoadedModule> {
        use core::ffi::{c_int, c_void};

        struct Ctx {
            address: usize,
            result: Option<LoadedModule>,
        }
        let mut ctx = Ctx {
            address,
            result: None,
        };

        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type `dl_iterate_phdr` expects — never callable by name
        // from safe Rust. Body wraps its raw-ptr ops explicitly.
        extern "C" fn callback(
            info: *mut libc::dl_phdr_info,
            _size: libc::size_t,
            data: *mut c_void,
        ) -> c_int {
            // SAFETY: dl_iterate_phdr passes a valid info pointer; data is &mut Ctx.
            let context = unsafe { bun_core::callback_ctx::<Ctx>(data) };
            // SAFETY: dl_iterate_phdr passes a valid info pointer.
            let info = unsafe { &*info };
            // The base address is too high
            if context.address < info.dlpi_addr as usize {
                return 0;
            }
            // SAFETY: dlpi_phdr points to dlpi_phnum entries.
            let phdrs =
                unsafe { core::slice::from_raw_parts(info.dlpi_phdr, info.dlpi_phnum as usize) };
            for phdr in phdrs {
                if phdr.p_type != PT_LOAD {
                    continue;
                }
                // Overflowing addition is used to handle the case of VSDOs
                // having a p_vaddr = 0xffffffffff700000
                let seg_start = (info.dlpi_addr as usize).wrapping_add(phdr.p_vaddr as usize);
                let seg_end = seg_start + phdr.p_memsz as usize;
                if context.address >= seg_start && context.address < seg_end {
                    // Android libc uses NULL instead of an empty string to mark
                    // the main program.
                    let name = if info.dlpi_name.is_null() {
                        Box::default()
                    } else {
                        // SAFETY: dlpi_name is a valid NUL-terminated C string.
                        unsafe { core::ffi::CStr::from_ptr(info.dlpi_name) }
                            .to_bytes()
                            .to_vec()
                            .into_boxed_slice()
                    };
                    context.result = Some(LoadedModule {
                        base_address: info.dlpi_addr as usize,
                        name,
                        segment_end: seg_end,
                        program_headers: info.dlpi_phdr,
                        program_header_count: info.dlpi_phnum as usize,
                    });
                    return 1; // error.Found → stop iteration
                }
            }
            0
        }

        // SAFETY: ctx outlives the dl_iterate_phdr call; callback signature matches libc's contract.
        unsafe { libc::dl_iterate_phdr(Some(callback), (&raw mut ctx).cast::<c_void>()) };
        ctx.result
    }
}

/// FreeBSD platform surface.
#[cfg(target_os = "freebsd")]
pub mod freebsd {
    use core::ffi::c_int;
    /// `struct kevent` (FreeBSD).
    pub type Kevent = libc::kevent;
    /// kqueue filter constants (FreeBSD).
    pub mod EVFILT {
        pub const READ: i16 = libc::EVFILT_READ;
        pub const WRITE: i16 = libc::EVFILT_WRITE;
        pub const VNODE: i16 = libc::EVFILT_VNODE;
        pub const PROC: i16 = libc::EVFILT_PROC;
        pub const SIGNAL: i16 = libc::EVFILT_SIGNAL;
        pub const TIMER: i16 = libc::EVFILT_TIMER;
        pub const USER: i16 = libc::EVFILT_USER;
    }
    /// kqueue event flags (FreeBSD).
    pub mod EV {
        pub const ADD: u16 = libc::EV_ADD;
        pub const DELETE: u16 = libc::EV_DELETE;
        pub const ENABLE: u16 = libc::EV_ENABLE;
        pub const DISABLE: u16 = libc::EV_DISABLE;
        pub const ONESHOT: u16 = libc::EV_ONESHOT;
        pub const CLEAR: u16 = libc::EV_CLEAR;
        pub const RECEIPT: u16 = libc::EV_RECEIPT;
        pub const DISPATCH: u16 = libc::EV_DISPATCH;
        pub const EOF: u16 = libc::EV_EOF;
        pub const ERROR: u16 = libc::EV_ERROR;
    }
    /// kqueue fflags (FreeBSD).
    pub mod NOTE {
        pub const EXIT: u32 = libc::NOTE_EXIT;
        pub const FORK: u32 = libc::NOTE_FORK;
        pub const EXEC: u32 = libc::NOTE_EXEC;
        pub const TRIGGER: u32 = libc::NOTE_TRIGGER;
        pub const DELETE: u32 = libc::NOTE_DELETE;
        pub const WRITE: u32 = libc::NOTE_WRITE;
        pub const EXTEND: u32 = libc::NOTE_EXTEND;
        pub const ATTRIB: u32 = libc::NOTE_ATTRIB;
        pub const LINK: u32 = libc::NOTE_LINK;
        pub const RENAME: u32 = libc::NOTE_RENAME;
        pub const REVOKE: u32 = libc::NOTE_REVOKE;
    }
    /// `copy_file_range` (FreeBSD 13+). Thin re-export so callers don't
    /// need a direct `libc` dep. Without an offset the
    /// kernel uses (and advances) the fd's seek position.
    #[inline]
    pub fn copy_file_range(
        in_: c_int,
        off_in: Option<&mut libc::off_t>,
        out: c_int,
        off_out: Option<&mut libc::off_t>,
        len: usize,
        flags: u32,
    ) -> libc::ssize_t {
        let off_in = off_in.map_or(core::ptr::null_mut(), core::ptr::from_mut);
        let off_out = off_out.map_or(core::ptr::null_mut(), core::ptr::from_mut);
        // SAFETY: each offset is null or points to a live `off_t`.
        unsafe { libc::copy_file_range(in_, off_in, out, off_out, len, flags) }
    }
    /// An empty object without a name.
    pub fn create_shared_memory() -> Option<super::Fd> {
        // SAFETY: `SHM_ANON` stands in for a name and is not read.
        let fd = unsafe { libc::shm_open(libc::SHM_ANON, libc::O_RDWR | libc::O_CLOEXEC, 0o600) };
        (fd >= 0).then(|| super::Fd::from_native(fd))
    }
}
#[cfg(not(target_os = "freebsd"))]
pub mod freebsd {}

/// A [`File`] that POSIX closes even if `open` gave it the number of a standard stream.
#[must_use]
pub struct CloseOnDrop(Fd);
impl CloseOnDrop {
    #[inline]
    pub fn new(fd: Fd) -> Self {
        Self(fd)
    }
    /// As [`File::into_raw`].
    pub fn into_raw(self) -> Fd {
        core::mem::ManuallyDrop::new(self).0
    }
    /// As [`File::make_lib_uv_owned_for_syscall`].
    pub fn make_lib_uv_owned_for_syscall(mut self, syscall_tag: Tag) -> Maybe<Self> {
        self.0 = self.0.make_lib_uv_owned_for_syscall(syscall_tag)?;
        Ok(self)
    }
}
impl From<File> for CloseOnDrop {
    fn from(file: File) -> Self {
        Self(file.into_raw())
    }
}
impl core::ops::Deref for CloseOnDrop {
    type Target = File;
    fn deref(&self) -> &File {
        File::borrow(&self.0)
    }
}
impl Drop for CloseOnDrop {
    #[inline]
    fn drop(&mut self) {
        let _ = close(self.0);
    }
}

/// `make_path` / `make_open_path` helpers reachable as a module.
pub mod make_path {
    use super::*;
    use bun_core::strings::CodeUnits;
    #[inline]
    pub fn make_open_path(dir: &Dir, sub_path: &[u8], opts: OpenDirOptions) -> Maybe<Dir> {
        dir.make_open_path(sub_path, opts)
    }

    /// `mkdir -p` relative to `dir`.
    #[inline]
    pub fn make_path<C: bun_paths::PathUnit>(dir: &Dir, sub_path: &[C]) -> Maybe<()> {
        match C::units(sub_path) {
            CodeUnits::U8(path) => mkdir_recursive_at(dir.fd, path),
            CodeUnits::U16(path) => mkdir_recursive_at(dir.fd, &bun_paths::Path::from(path)),
        }
    }
}
/// `WindowsSymlinkOptions` — Windows-only flag struct
/// plus a process-global "symlink creation has failed once" sticky bit. The
/// flag is checked by the install linker to decide whether to fall back to
/// junctions; on POSIX the flag is harmless dead state. Only the sticky bit
/// is needed cross-platform (`PackageManager::init` sets it when
/// `BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS` is on).
#[derive(Default, Clone, Copy)]
pub struct WindowsSymlinkOptions {
    pub directory: bool,
}
pub(crate) static WINDOWS_SYMLINK_HAS_FAILED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);
impl WindowsSymlinkOptions {
    #[inline]
    pub fn set_has_failed_to_create_symlink(v: bool) {
        WINDOWS_SYMLINK_HAS_FAILED.store(v, core::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(windows)]
    #[inline]
    pub(crate) fn has_failed_to_create_symlink() -> bool {
        WINDOWS_SYMLINK_HAS_FAILED.load(core::sync::atomic::Ordering::Relaxed)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Windows-only `symlinkW` / `symlinkOrJunction`
// / `unlinkW` / `rmdir` / `mkdir` (CreateDirectoryW path). Compiled on
// Windows; on POSIX these names are absent.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(windows)]
mod win_symlink_impl {
    use super::{E, Error, Maybe, Tag, WindowsSymlinkOptions, ZStr, sys_uv, windows};
    use bun_core::WStr;
    use core::sync::atomic::{AtomicU32, Ordering};

    // `CreateSymbolicLinkW` `dwFlags` bits (winbase.h). Not currently exported
    // by `bun_windows_sys`; spell them locally so we don't widen the leaf
    // crate's surface for two constants.
    const SYMBOLIC_LINK_FLAG_DIRECTORY: u32 = 0x1;
    const SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE: u32 = 0x2;

    /// `WindowsSymlinkOptions.symlink_flags` — process-global, starts
    /// with `ALLOW_UNPRIVILEGED_CREATE` and is cleared on `INVALID_PARAMETER`
    /// (older Windows).
    ///
    /// The global only carries `ALLOW_UNPRIVILEGED_CREATE` (cleared on
    /// `INVALID_PARAMETER`); `DIRECTORY` is OR'd into a *local* on each call.
    /// Stickying `DIRECTORY` into the global would make a later
    /// `directory=false` call still pass `SYMBOLIC_LINK_FLAG_DIRECTORY`, so
    /// `CreateSymbolicLinkW` would create a broken directory symlink for a
    /// file target.
    static SYMLINK_FLAGS: AtomicU32 = AtomicU32::new(SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE);

    impl WindowsSymlinkOptions {
        #[inline]
        fn flags(self) -> u32 {
            let mut f = SYMLINK_FLAGS.load(Ordering::Relaxed);
            if self.directory {
                f |= SYMBOLIC_LINK_FLAG_DIRECTORY;
            }
            f
        }
        #[inline]
        fn denied() {
            SYMLINK_FLAGS.store(0, Ordering::Relaxed);
        }
    }

    fn path_ptr(path: &WStr, syscall: Tag) -> Maybe<*const u16> {
        windows::path_ptr(path).map_err(|err| Error::from_win32(err, syscall))
    }

    /// `symlinkW`. `dest` is the link path, `target` is
    /// the path the link points to. Retries once with `flags = 0` if the
    /// kernel rejects `ALLOW_UNPRIVILEGED_CREATE` (`INVALID_PARAMETER`).
    pub fn symlink_w(dest: &WStr, target: &WStr, options: WindowsSymlinkOptions) -> Maybe<()> {
        let dest = path_ptr(dest, Tag::symlink)?;
        let target = path_ptr(target, Tag::symlink)?;
        loop {
            let flags = options.flags();
            // SAFETY: both inputs are NUL-terminated wide strings.
            let rc = unsafe { windows::CreateSymbolicLinkW(dest, target, flags) };
            if rc == 0 {
                let win_err = windows::Win32Error::get();
                if win_err == windows::Win32Error::INVALID_PARAMETER
                    && (flags & SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE) != 0
                {
                    WindowsSymlinkOptions::denied();
                    continue;
                }
                let err = Error::from_win32(win_err, Tag::symlink);
                // Only ENOENT/EEXIST keep `has_failed_to_create_symlink`
                // unset; every other failure flips the sticky bit so
                // `symlinkOrJunction` falls through to junctions next time.
                if !matches!(err.get_errno(), E::NOENT | E::EXIST) {
                    WindowsSymlinkOptions::set_has_failed_to_create_symlink(true);
                }
                return Err(err);
            }
            return Ok(());
        }
    }

    /// `symlinkOrJunction`. Tries `CreateSymbolicLinkW`
    /// (directory flavour) first; on failure other than ENOENT/EEXIST falls
    /// back to a libuv junction. `abs_fallback_junction_target = None` says
    /// `target` is already absolute and reusable for the junction.
    pub fn symlink_or_junction(
        dest: &ZStr,
        target: &ZStr,
        abs_fallback_junction_target: Option<&ZStr>,
    ) -> Maybe<()> {
        if !WindowsSymlinkOptions::has_failed_to_create_symlink() {
            match symlink_w(
                &super::long_path(bun_paths::without_trailing_sep(dest), Tag::symlink)?,
                &super::long_path(bun_paths::without_trailing_sep(target), Tag::symlink)?,
                WindowsSymlinkOptions { directory: true },
            ) {
                Ok(()) => return Ok(()),
                Err(err) => match err.get_errno() {
                    // EEXIST/ENOENT: surface the symlink error; junctions
                    // would hit the same condition.
                    E::EXIST | E::NOENT => return Err(err),
                    // anything else: fall through to junction.
                    _ => {}
                },
            }
        }
        sys_uv::symlink_uv(
            abs_fallback_junction_target.unwrap_or(target),
            dest,
            bun_libuv_sys::UV_FS_SYMLINK_JUNCTION,
        )
    }

    /// `unlinkW` — `DeleteFileW` with errno mapping.
    pub fn unlink_w(from: &WStr) -> Maybe<()> {
        // SAFETY: `from` is NUL-terminated.
        let rc = unsafe { windows::DeleteFileW(path_ptr(from, Tag::unlink)?) };
        if rc == 0 {
            return Err(Error::from_win32(windows::Win32Error::get(), Tag::unlink));
        }
        Ok(())
    }

    /// `mkdirOSPath` (Windows arm) — `CreateDirectoryW` with
    /// errno mapping. Named `mkdir_w` for parity with `unlink_w`/`symlink_w`.
    pub fn mkdir_w(path: &WStr) -> Maybe<()> {
        let path = path_ptr(path, Tag::mkdir)?;
        // SAFETY: `path` is NUL-terminated; null security attributes.
        let rc = unsafe { windows::CreateDirectoryW(path, core::ptr::null_mut()) };
        if rc == 0 {
            return Err(Error::from_win32(windows::Win32Error::get(), Tag::mkdir));
        }
        Ok(())
    }
}
#[cfg(windows)]
pub use win_symlink_impl::{mkdir_w, symlink_or_junction, symlink_w, unlink_w};

/// `link(u16, ...)` Windows arm — `CreateHardLinkW` with errno mapping.
#[cfg(windows)]
pub fn link_w(src: &bun_core::WStr, dest: &bun_core::WStr) -> Maybe<()> {
    windows::CreateHardLinkW(dest, src).map_err(|err| Error::from_win32(err, Tag::link))
}

/// `rmdir` — `rmdirat(FD.cwd(), to)`. Exposed on all
/// platforms (POSIX `unlinkat(.., AT_REMOVEDIR)`; Windows `DeleteFileBun`).
#[inline]
pub fn rmdir(to: &ZStr) -> Maybe<()> {
    rmdirat(Fd::cwd(), to)
}

// ──────────────────────────────────────────────────────────────────────────
// open helpers (additional)
// ──────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    /// Convenience flagset for `open_file*` helpers.
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

/// Open an absolute, NUL-terminated path.
#[inline]
pub fn open_file_absolute_z(path: &ZStr, flags: OpenFlags) -> Maybe<File> {
    open(path, flags.bits() | O::CLOEXEC, 0).map(File::from_fd)
}
/// Open a path relative to the cwd — non-NUL-terminated convenience.
#[inline]
pub fn open_file(path: &[u8], flags: OpenFlags) -> Maybe<File> {
    open_a(path, flags.bits() | O::CLOEXEC, 0).map(File::from_fd)
}
/// `openDirForIteration(dir, sub)`.
#[inline]
pub fn open_dir_for_iteration(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    open_dir_at(dir, path)
}
/// `bun.getFdPathZ(fd, buf)`. Wraps [`get_fd_path`] then
/// NUL-terminates in-place so callers receive a `&ZStr`.
pub fn get_fd_path_z<'a>(fd: Fd, out: &'a mut bun_paths::PathBuffer) -> Maybe<&'a ZStr> {
    let len = get_fd_path(fd, out)?.len();
    Ok(ZStr::nul_terminate(out, len))
}

/// `bun.iterateDir(dir)` — convenience wrapper around `dir_iterator::iterate`.
#[inline]
pub fn iterate_dir(dir: Fd) -> dir_iterator::WrappedIterator {
    dir_iterator::iterate(dir)
}
/// `bun.sys.exists`. Non-NUL-terminated convenience over
/// [`exists_z`]: copies and NUL-terminates, then
/// `access(path, F_OK)` (POSIX) / `GetFileAttributesW` (Windows).
pub fn exists(path: &[u8]) -> bool {
    exists_z(&bun_paths::Path::from(path))
}
/// `path` if `dir` has it or it has a NUL, or else with `/` for `\`. An absolute one keeps the part that exists. `\a` is `./a`.
pub fn existing_spelling(dir: Fd, path: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings;
    let last = strings::last_index_of_char(path, b'\\').filter(|_| cfg!(not(windows)));
    let Some(last) = last.filter(|_| !strings::contains_char(path, 0)) else {
        return path.into();
    };
    let end_of_name = |at: usize| {
        strings::index_of_char_usize(&path[at..], b'/').map_or(path.len(), |len| at + len)
    };
    let exists = |path: &[u8]| exists_at(dir, &bun_paths::Path::join(&[path]));
    if !bun_paths::is_absolute(path) {
        // A `..` behind that name cancels it, so ask for the name too.
        return match exists(&path[..end_of_name(last)]) && exists(path) {
            true => path.into(),
            false => bun_paths::from_portable(path),
        };
    }
    // Anyone who can add a name could put `..\a` in the way of `../a`.
    let is_name = |prefix: &[u8]| {
        !bun_paths::portable::has_dot_dot(bun_paths::basename(prefix))
            || getcwd_alloc().is_ok_and(|cwd| bun_paths::strip_prefix(&cwd, prefix).is_some())
    };
    let mut kept = 0;
    while let Some(at) = strings::index_of_char_usize(&path[kept..], b'\\') {
        let end = end_of_name(kept + at);
        if end >= bun_core::MAX_PATH_BYTES || !is_name(&path[..end]) || !exists(&path[..end]) {
            // `/\a` does not become `//a`, which can be a URL.
            let (kept, rest) = path.split_at(kept.max(usize::from(path.starts_with(b"//"))));
            let rest = strings::replace_char(rest, b'\\', b'/');
            return [kept, b"/", strings::trim_left(&rest, b"/")]
                .concat()
                .into();
        }
        kept = end;
    }
    path.into()
}
/// What `convert` makes of a relative `path`, and [`existing_spelling`] of an absolute one.
pub fn converted_spelling(
    path: &[u8],
    convert: fn(&[u8]) -> std::borrow::Cow<'_, [u8]>,
) -> std::borrow::Cow<'_, [u8]> {
    match bun_paths::is_absolute(path) {
        true => existing_spelling(Fd::cwd(), path),
        false => convert(path),
    }
}
/// [`converted_spelling`] for what was typed in `base`, or `path` if only that is there.
pub fn typed_spelling<'a>(
    base: &[u8],
    path: &'a [u8],
    convert: fn(&[u8]) -> std::borrow::Cow<'_, [u8]>,
) -> std::borrow::Cow<'a, [u8]> {
    use bun_paths::Path;
    use std::borrow::Cow::{Borrowed, Owned};
    match converted_spelling(path, convert) {
        Owned(converted)
            if !bun_paths::is_absolute(&converted)
                && !exists_z(&Path::resolve(&[base, &converted]))
                && let Borrowed(_) =
                    existing_spelling(Fd::cwd(), &Path::from_parts(&[base, path])) =>
        {
            Borrowed(path)
        }
        converted => converted,
    }
}
/// `moveFileZ`. Routes through
/// [`renameat_concurrently_without_fallback`] (renameat2 NOREPLACE → EXCHANGE →
/// delete-tree + rename); on EISDIR removes the dest dir and
/// retries; on EXDEV falls back to the slow open+copy path. Only opens the
/// source inside the EXDEV branch.
pub fn move_file_z(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr) -> Maybe<()> {
    match renameat_concurrently_without_fallback(from_dir, filename, to_dir, destination) {
        Ok(()) => Ok(()),
        // allow over-writing an empty directory
        Err(e) if e.get_errno() == E::EISDIR => {
            #[cfg(unix)]
            // SAFETY: destination is NUL-terminated.
            let _ = unsafe {
                libc::unlinkat(to_dir.native(), destination.as_ptr(), libc::AT_REMOVEDIR)
            };
            renameat(from_dir, filename, to_dir, destination)
        }
        Err(e) if e.get_errno() == E::EXDEV => {
            move_file_z_slow(from_dir, filename, to_dir, destination)
        }
        Err(e) => Err(e),
    }
}
/// `moveFileZSlow`: open source, unlink, copy to dest.
pub(crate) fn move_file_z_slow(
    from_dir: Fd,
    filename: &ZStr,
    to_dir: Fd,
    destination: &ZStr,
) -> Maybe<()> {
    let input = CloseOnDrop::new(openat(
        from_dir,
        filename,
        O::RDONLY | O::CLOEXEC,
        if cfg!(windows) { 0 } else { 0o644 },
    )?);
    let _ = unlinkat(from_dir, filename);
    copy_file_z_slow_with_handle(input.fd(), to_dir, destination)
}
/// `copyFileZSlowWithHandle` (POSIX read/write fallback arm).
pub(crate) fn copy_file_z_slow_with_handle(
    in_handle: Fd,
    to_dir: Fd,
    destination: &ZStr,
) -> Maybe<()> {
    #[cfg(unix)]
    let st = fstat(in_handle)?;
    // Unlink dest first — fixes ETXTBUSY on Linux.
    let _ = unlinkat(to_dir, destination);
    let dst = Tmpfile::open(
        to_dir,
        destination,
        O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC,
        0o644,
    )?;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // Preallocation is best-effort.
        let _ = safe_libc::fallocate(dst.file.fd().native(), 0, 0, st.st_size);
    }
    let _ = lseek(in_handle, 0, libc::SEEK_SET);
    copy_file(in_handle, dst.file.fd())?;
    #[cfg(unix)]
    {
        let _ = safe_libc::fchmod(dst.file.fd().native(), st.st_mode);
        let _ = safe_libc::fchown(dst.file.fd().native(), st.st_uid, st.st_gid);
    }
    dst.keep();
    Ok(())
}

/// Tries an atomic NOREPLACE rename, then EXCHANGE, then a racy delete-tree + rename.
/// After an EXCHANGE, `from` holds the tree that was at `to`.
pub(crate) fn renameat_concurrently_without_fallback(
    from_dir_fd: Fd,
    from: &ZStr,
    to_dir_fd: Fd,
    to: &ZStr,
) -> Maybe<()> {
    'attempt: {
        {
            // Happy path: the folder doesn't exist in the cache dir, so we can
            // just rename it. We don't need to delete anything.
            let err = match renameat2(from_dir_fd, from, to_dir_fd, to, RenameMode::NoReplace) {
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
                    match renameat2(from_dir_fd, from, to_dir_fd, to, RenameMode::Exchange) {
                        Err(_) => {}
                        Ok(()) => break 'attempt,
                    }
                }
            }
            #[cfg(windows)]
            {
                let _ = err;
            }
        }

        //  sad path: let's try to delete the folder and then rename it
        if to_dir_fd.is_valid() {
            let _ = Dir::borrow(&to_dir_fd).delete_tree(to.as_bytes());
        } else {
            let _ = delete_tree_absolute(to.as_bytes());
        }
        match renameat(from_dir_fd, from, to_dir_fd, to) {
            Err(err) => return Err(err),
            Ok(()) => {}
        }
    }

    Ok(())
}

/// `eventfd(initval, flags)` — kernel notification fd. Linux native (Android
/// included since API 8); FreeBSD 13+ gained a Linux-compatible `eventfd(2)`
/// via the `libc` shim.
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
pub fn eventfd(initval: u32, flags: i32) -> Maybe<Fd> {
    let rc = safe_libc::eventfd(initval, flags);
    if rc < 0 {
        return Err(err_with(Tag::open));
    }
    Ok(move_above_stdio(Fd::from_native(rc)))
}

// ──────────────────────────────────────────────────────────────────────────
// `NodeFS::writeFileWithPathBuffer` — JSC-free subset.
//
// Full impl lives in `bun_runtime::node::node_fs` (T6, takes JS encodings,
// JSArrayBuffer, etc). Bundler (T4) needs a sync write that doesn't pull JSC.
// This is the minimal shape: `Buffer` data + `Path` target → openat+write+close.
// ──────────────────────────────────────────────────────────────────────────

/// Data payload for `write_file`.
pub enum WriteFileData<'a> {
    Buffer { buffer: &'a [u8] },
    // T6 adds `String { value, encoding }` / `ArrayBuffer { .. }`.
}
/// Encoding tag (only `Buffer` is honoured at T1).
#[derive(Clone, Copy, Default)]
pub enum WriteFileEncoding {
    #[default]
    Buffer,
}
/// Target — path (relative to `dirfd`) or an already-open fd.
pub enum PathOrFileDescriptor<'a> {
    Path(&'a [u8]),
    Fd(Fd),
}
impl Default for PathOrFileDescriptor<'_> {
    fn default() -> Self {
        PathOrFileDescriptor::Fd(Fd::INVALID)
    }
}
/// Args struct.
pub struct WriteFileArgs<'a> {
    pub data: WriteFileData<'a>,
    pub encoding: WriteFileEncoding,
    pub dirfd: Fd,
    pub file: PathOrFileDescriptor<'a>,
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
/// Sync `openat(CREAT|TRUNC)` + write_all.
pub fn write_file(args: &WriteFileArgs<'_>) -> Maybe<usize> {
    let WriteFileData::Buffer { buffer } = args.data;
    let opened;
    let file: &File = match &args.file {
        PathOrFileDescriptor::Fd(fd) => File::borrow(fd),
        PathOrFileDescriptor::Path(bytes) => {
            let path = bun_paths::Path::from(bytes);
            let flags = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC;
            opened = CloseOnDrop::new(openat(args.dirfd, &path, flags, args.mode)?);
            &opened
        }
    };
    file.write_all(buffer).map(|()| buffer.len())
}

/// `bun.fetchCacheDirectoryPath` — resolve `$BUN_INSTALL_CACHE_DIR` /
/// `$XDG_CACHE_HOME/.bun/install/cache` / `$HOME/.bun/install/cache`.
/// full env-override chain lives in `bun_install`; this is the
/// fallback so the symbol resolves at T1. Returns an owned path (caller frees).
pub fn fetch_cache_directory_path() -> Vec<u8> {
    use bun_paths::portable::from_portable_rooted;
    if let Some(v) = bun_core::getenv_z(bun_core::zstr!("BUN_INSTALL_CACHE_DIR")) {
        return from_portable_rooted(v).into_owned();
    }
    if let Some(home) = bun_core::getenv_z(bun_core::zstr!("HOME")) {
        let mut p = from_portable_rooted(home).into_owned();
        p.extend_from_slice(b"/.bun/install/cache");
        return p;
    }
    b".bun-cache".to_vec()
}

// ──────────────────────────────────────────────────────────────────────────
// OUTPUT_SINK — bun_core's stderr vtable, installed by us at init (B-0 hook).
// ──────────────────────────────────────────────────────────────────────────

/// Writes all of `bytes` to stdout or stderr, for a caller that has to know whether they got there. `Output` doesn't say.
pub fn write_all_to_stdio(fd: Fd, mut bytes: &[u8]) -> Maybe<()> {
    while !bytes.is_empty() {
        match write(fd, bytes) {
            Ok(0) => return Err(Error::from_code(E::EIO, Tag::write)),
            Ok(n) => bytes = &bytes[n..],
            #[cfg(unix)]
            Err(e) if e.get_errno() == E::EAGAIN => {
                // fd 1/2 are O_NONBLOCK once process.stdout/stderr exist (as in Node); wait instead of dropping output.
                let mut pfd = [posix::PollFd {
                    fd: fd.native(),
                    events: posix::POLL_OUT,
                    revents: 0,
                }];
                posix::poll(&mut pfd, -1)?;
            }
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

#[cfg(unix)]
fn sink_tty_winsize(fd: Fd) -> Option<bun_core::Winsize> {
    let mut ws: libc::winsize = bun_core::ffi::zeroed();
    // SAFETY: TIOCGWINSZ writes exactly `sizeof(winsize)` into the stack-local
    // `ws`; `fd` is a plain int (bad fd → ENOTTY/EBADF, never UB).
    let rc = unsafe { libc::ioctl(fd.native(), libc::TIOCGWINSZ, &raw mut ws) };
    if rc != 0 {
        return None;
    }
    Some(bun_core::Winsize {
        row: ws.ws_row,
        col: ws.ws_col,
        xpixel: ws.ws_xpixel,
        ypixel: ws.ws_ypixel,
    })
}
#[cfg(windows)]
fn sink_tty_winsize(fd: Fd) -> Option<bun_core::Winsize> {
    let mut info: windows::CONSOLE_SCREEN_BUFFER_INFO = bun_core::ffi::zeroed();
    // SAFETY: `info` is a valid out-pointer for the duration of the call; a
    // handle that is not a console makes the call fail rather than misbehave.
    let rc = unsafe { windows::kernel32::GetConsoleScreenBufferInfo(fd.native(), &raw mut info) };
    if rc == windows::FALSE {
        return None;
    }
    // `srWindow` is the visible part of the (possibly much taller) screen buffer.
    let window = info.srWindow;
    Some(bun_core::Winsize {
        row: u16::try_from(i32::from(window.Bottom) - i32::from(window.Top) + 1).ok()?,
        col: u16::try_from(i32::from(window.Right) - i32::from(window.Left) + 1).ok()?,
        xpixel: 0,
        ypixel: 0,
    })
}
#[cfg(not(any(unix, windows)))]
fn sink_tty_winsize(_fd: Fd) -> Option<bun_core::Winsize> {
    None
}

// Backs `bun_core::OutputSink[Sys]` — stderr/open/write.
bun_core::link_impl_OutputSink! {
    Sys for extern () => |_this| {
        stderr() => bun_core::output::File(Fd::stderr()),
        create_file(cwd, path) =>
            File::make_openat(cwd, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)
                .map(File::into_raw)
                .map_err(|_| bun_core::Error::Unexpected),
        write_all_quiet(fd, bytes) => write_all_to_stdio(fd, bytes).is_ok(),
        tty_winsize(fd) => sink_tty_winsize(fd),
        is_terminal(fd) => isatty(fd),
        read(fd, buf) => read(fd, buf).map_err(|_| bun_core::Error::Unexpected),
    }
}

// (former `__bun_uws_stat_file` provider deleted — body moved DOWN into
// `bun_uws_sys::socket_context::stat_for_digest`, which calls `libc::stat`
// directly. uws_sys already links libc; the cross-crate hook bought nothing.)

#[cfg(test)]
mod owned_handle_tests {
    use super::*;

    /// `renameat_concurrently_without_fallback` falls back to `delete_tree` +
    /// retry when the destination exists. The `delete_tree` is run via a `Dir`
    /// borrowed from the caller's `to_dir_fd`; if it took ownership instead,
    /// `to_dir_fd` would be closed out from under the caller.
    #[test]
    fn renameat_concurrently_does_not_close_caller_fd() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let mut tmp = std::env::temp_dir().as_os_str().as_encoded_bytes().to_vec();
        tmp.extend_from_slice(b"/bun_sys_renameat_test");
        // Set up: create a dir tree with `from/sub`, `to/sub`.
        let _ = open_dir_at(Fd::cwd(), &tmp).map(close);
        let _ = mkdir_recursive_at(Fd::cwd(), &tmp);
        let root = open_dir_at(Fd::cwd(), &tmp).expect("open root");
        let _ = mkdir_recursive_at(root, b"from/sub");
        let _ = mkdir_recursive_at(root, b"to/sub");
        let to_dir = open_dir_at(root, b"to").expect("open to");

        // The dest `to/sub` exists, so the rename must `delete_tree` it first.
        renameat_concurrently_without_fallback(
            root,
            bun_core::zstr!("from/sub"),
            to_dir,
            bun_core::zstr!("sub"),
        )
        .expect("rename");

        // The caller's `to_dir` must still be valid after the rename.
        assert!(
            fstat(to_dir).is_ok(),
            "to_dir closed by renameat_concurrently"
        );

        // Cleanup.
        let _ = close(to_dir);
        let _ = close(root);
        let _ = Dir::open(&tmp).map(|d| d.delete_tree(b"."));
    }
}

#[cfg(test)]
mod mkdir_recursive_tests {
    use super::*;

    #[test]
    fn stops_below_a_dangling_link() {
        let mut calls = 0;
        let result = mkdir_recursive_with(b"/t/dangling/x", |path| {
            calls += 1;
            assert!(calls < 100);
            let errno = match path {
                b"/t/dangling/x" => E::ENOENT,
                _ => E::EEXIST,
            };
            Err(Error::from_code(errno, Tag::mkdir))
        });
        assert_eq!(result.unwrap_err().get_errno(), E::ENOENT);
    }

    #[test]
    fn makes_the_parents_first() {
        let mut made = vec![b"/t".to_vec()];
        let result = mkdir_recursive_with(b"/t/a/b/", |path| {
            if !made
                .iter()
                .any(|it| Some(&it[..]) == bun_paths::dirname(path))
            {
                return Err(Error::from_code(E::ENOENT, Tag::mkdir));
            }
            made.push(path.to_vec());
            Ok(())
        });
        assert!(result.is_ok());
        assert_eq!(made, [&b"/t"[..], b"/t/a", b"/t/a/b"]);
    }
}

#[cfg(all(test, windows))]
mod normalize_path_windows_tests {
    use super::*;
    use bun_windows_sys::externs as w;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn normalize(dir: Fd, path: &str) -> String {
        let norm = normalize_path_windows(dir, &wide(path)).expect(path);
        String::from_utf16(norm.as_slice()).unwrap()
    }

    fn normalize_opts(dir: Fd, path: &str, add_nt_prefix: bool) -> String {
        let norm = normalize_path_windows_opts(
            dir,
            &wide(path),
            NormalizePathWindowsOpts { add_nt_prefix },
        )
        .expect(path);
        String::from_utf16(norm.as_slice()).unwrap()
    }

    fn normalize_err(dir: Fd, path: &str) -> Error {
        match normalize_path_windows(dir, &wide(path)) {
            Ok(p) => panic!(
                "expected error for {path}, got {}",
                String::from_utf16_lossy(p.as_slice())
            ),
            Err(e) => e,
        }
    }

    /// `..` steps from `dir`'s base to the clamp floor, probed behaviorally —
    /// device names may span multiple components (`HarddiskDmVolumes\…`), so
    /// counting components after `\Device\` would overcount there.
    fn floor_depth(dir: Fd) -> usize {
        for k in 1..64 {
            if normalize_path_windows(dir, &wide(&"..\\".repeat(k))).is_err() {
                return k - 1;
            }
        }
        panic!("no clamp floor within 64 levels");
    }

    /// Open a directory handle with `CreateFileW` so the fixture fd does
    /// not depend on the code under test.
    fn open_dir_handle(path: &std::path::Path) -> File {
        use std::os::windows::ffi::OsStrExt;
        let wp: Vec<u16> = path.as_os_str().encode_wide().chain([0u16]).collect();
        windows::CreateFileW(
            bun_core::WStr::from_slice_with_nul(&wp),
            w::GENERIC_READ,
            FILE_SHARE,
            w::OPEN_EXISTING,
            w::FILE_FLAG_BACKUP_SEMANTICS,
        )
        .unwrap_or_else(|err| panic!("CreateFileW {path:?}: {err:?}"))
        .into()
    }

    /// pid-suffixed temp dir removed on drop (declare before handle guards so
    /// handles close first).
    struct TempTree(std::path::PathBuf);
    impl TempTree {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("bun_sys_{name}_{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn relative_resolves_to_nt_device_name() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_rel");
        let dir = open_dir_handle(&tree.0);
        let got = normalize(dir.fd(), "a\\b");
        assert!(got.starts_with("\\Device\\"), "{got}");
        assert!(got.ends_with("\\a\\b"), "{got}");
        assert!(!got.contains("\\??\\"), "{got}");
        // `..`-free rel: exactly the base directory's NT name plus the rel.
        assert_eq!(got, format!("{}\\a\\b", normalize(dir.fd(), ".")));
    }

    #[test]
    fn dotdot_resolves_into_parent() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_dotdot");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let parent = open_dir_handle(&tree.0);
        let child = open_dir_handle(&tree.0.join("child"));
        let got = normalize(child.fd(), "..\\x");
        let base = normalize(parent.fd(), ".");
        assert_eq!(got, format!("{base}\\x"));
    }

    #[test]
    fn within_tree_dotdot_resolves_under_base() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_within");
        let dir = open_dir_handle(&tree.0);
        let base = normalize(dir.fd(), ".");
        // Non-climbing `..` needs no clamp boundary; it resolves in place.
        assert_eq!(normalize(dir.fd(), "a\\..\\b"), format!("{base}\\b"));
        // Collapsing to nothing lands exactly on the base directory (the
        // join's lone separator is dropped).
        assert_eq!(normalize(dir.fd(), "sub\\.."), base);
    }

    #[test]
    fn excess_dotdot_fails_closed_on_local_volume() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_clamp");
        let dir = open_dir_handle(&tree.0);
        let base = normalize(dir.fd(), ".");
        let depth = floor_depth(dir.fd());
        assert!(depth >= 1, "{base}");
        // Enough `..` to cross the volume-root floor: local volumes are not
        // share-rooted, so the walk refuses instead of clamping silently.
        let over = format!("{}x", "..\\".repeat(depth + 1));
        assert_eq!(
            normalize_err(dir.fd(), &over).get_errno(),
            E::EINVAL,
            "{over}"
        );
        // Same without a trailing component.
        let over_only = "..\\".repeat(depth + 1);
        assert_eq!(normalize_err(dir.fd(), &over_only).get_errno(), E::EINVAL);
        // Within-tree `..` (never crosses the floor) still resolves.
        assert_eq!(normalize(dir.fd(), "sub\\..\\ok"), format!("{base}\\ok"));
    }

    #[test]
    fn forward_slash_dotdot_through_walk() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_fwd");
        let dir = open_dir_handle(&tree.0);
        let base = normalize(dir.fd(), ".");
        // `/` separates components exactly like `\` — lexically for the
        // within-tree rel, and in the floor walk for the climbing one.
        assert_eq!(normalize(dir.fd(), "a/../b"), format!("{base}\\b"));
        let over = format!("{}x", "../".repeat(floor_depth(dir.fd()) + 1));
        assert_eq!(
            normalize_err(dir.fd(), &over).get_errno(),
            E::EINVAL,
            "{over}"
        );
    }

    #[test]
    fn climbing_rel_with_leading_name_through_walk() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_climb_name");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let parent = open_dir_handle(&tree.0);
        let child = open_dir_handle(&tree.0.join("child"));
        // Net-climbing despite the leading name: the walk sees +1,−1,−1,+1
        // and stays above the floor while `..` resolves into the parent.
        assert_eq!(
            normalize(child.fd(), "a\\..\\..\\x"),
            format!("{}\\x", normalize(parent.fd(), "."))
        );
        // Same shape pushed one past the floor fails closed.
        let over = format!("a\\..\\{}x", "..\\".repeat(floor_depth(child.fd()) + 1));
        assert_eq!(
            normalize_err(child.fd(), &over).get_errno(),
            E::EINVAL,
            "{over}"
        );
    }

    #[test]
    fn exact_floor_dotdot_lands_on_volume_root() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_floor");
        let dir = open_dir_handle(&tree.0);
        let base = normalize(dir.fd(), ".");
        // Exactly base-depth `..` lands ON the floor (allowed): the volume
        // root DIRECTORY — the device prefix plus its lone separator.
        let root = normalize(dir.fd(), &"..\\".repeat(floor_depth(dir.fd())));
        assert!(root.starts_with("\\Device\\"), "{root}");
        assert!(root.ends_with('\\'), "{root}");
        assert!(base.starts_with(&root), "{base} vs {root}");
    }

    #[test]
    fn bare_dotdot_resolves_to_parent() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_bare_dotdot");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let parent = open_dir_handle(&tree.0);
        let child = open_dir_handle(&tree.0.join("child"));
        let base = normalize(parent.fd(), ".");
        assert_eq!(normalize(child.fd(), ".."), base);
        assert_eq!(normalize(child.fd(), "..\\"), base);
        // From the volume root itself, `..` crosses the floor.
        let root = open_dir_handle(std::path::Path::new("C:\\"));
        assert_eq!(normalize_err(root.fd(), "..").get_errno(), E::EINVAL);
    }

    #[test]
    fn dot_components_neutral_in_dotdot_rel() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_dotneutral");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let parent = open_dir_handle(&tree.0);
        let child = open_dir_handle(&tree.0.join("child"));
        // `.` and empty components cost no depth in the floor walk.
        let got = normalize(child.fd(), ".\\..\\\\.\\x");
        assert_eq!(got, format!("{}\\x", normalize(parent.fd(), ".")));
    }

    #[test]
    fn colon_components_flow_through() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_colon");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let dir = open_dir_handle(&tree.0);
        let base = normalize(dir.fd(), ".");
        // Colon components survive normalization verbatim — running under
        // debug_assertions, these ARE the no-panic proof; the invalid stream
        // spelling is NtCreateFile's to reject at open time.
        assert_eq!(normalize(dir.fd(), ":\\x"), format!("{base}\\:\\x"));
        assert_eq!(normalize(dir.fd(), ":a.b"), format!("{base}\\:a.b"));
        assert_eq!(normalize(dir.fd(), ".\\:\\x"), format!("{base}\\:\\x"));
        assert_eq!(normalize(dir.fd(), "a\\:\\x"), format!("{base}\\a\\:\\x"));
        // `..` collapse promoting `:` toward the front of the output.
        let child = open_dir_handle(&tree.0.join("child"));
        assert_eq!(normalize(child.fd(), "..\\:\\x"), format!("{base}\\:\\x"));
        // All the way to the clamp floor: `\:\x` directly after the device.
        let floored = normalize(
            dir.fd(),
            &format!("{}:\\x", "..\\".repeat(floor_depth(dir.fd()))),
        );
        assert!(floored.ends_with("\\:\\x"), "{floored}");
        assert!(
            base.starts_with(floored.strip_suffix(":\\x").unwrap()),
            "{floored} vs {base}"
        );
        // Bare ADS names (no separator or dot) still pass through verbatim.
        assert_eq!(normalize(Fd::INVALID, ":stream"), ":stream");
    }

    #[test]
    fn drive_relative_dotdot_resolves_into_parent() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_drive_dotdot");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let child = open_dir_handle(&tree.0.join("child"));
        // The drive prefix of a drive-relative path is stripped; the `..`
        // after it must still reach the clamp logic.
        assert_eq!(
            normalize(child.fd(), "C:..\\x"),
            normalize(child.fd(), "..\\x")
        );
    }

    #[test]
    fn dot_in_name_resolves_under_base() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_dotname");
        let dir = open_dir_handle(&tree.0);
        // Dot without separator routes to fd resolution (not the bare
        // passthrough) and needs no `..` clamp.
        assert_eq!(
            normalize(dir.fd(), "a.b"),
            format!("{}\\a.b", normalize(dir.fd(), "."))
        );
    }

    #[test]
    fn dot_resolves_to_base_dir() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_dot");
        let dir = open_dir_handle(&tree.0);
        let got = normalize(dir.fd(), ".");
        assert!(got.starts_with("\\Device\\"), "{got}");
        assert!(!got.ends_with('\\'), "{got}");
        let name = tree.0.file_name().unwrap().to_str().unwrap();
        // Exact, trailing-sep-free expectation built from the parent handle.
        let parent = open_dir_handle(tree.0.parent().unwrap());
        assert_eq!(got, format!("{}\\{name}", normalize(parent.fd(), ".")));
    }

    #[test]
    fn bare_component_passes_through() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        // No separator and no `.` → passthrough, relative to RootDirectory.
        let got = normalize(Fd::INVALID, "foo");
        assert_eq!(got, "foo");
    }

    #[test]
    fn absolute_branch_unchanged() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let got = normalize(Fd::INVALID, "C:\\x\\..\\y");
        assert_eq!(got, "\\??\\C:\\y");
    }

    #[test]
    fn clamp_prefix_len_pairs() {
        let split_at = |nt: &str, vol_rel: &str, prefix: &str, share_rooted: bool| {
            assert!(nt.starts_with(prefix), "{nt}");
            assert_eq!(
                nt_clamp_prefix_len(&wide(nt), &wide(vol_rel)),
                Some((prefix.len(), share_rooted)),
                "{nt} / {vol_rel}"
            );
        };
        // Local volume: not share-rooted.
        split_at(
            "\\Device\\HarddiskVolume3\\Users\\x",
            "\\Users\\x",
            "\\Device\\HarddiskVolume3",
            false,
        );
        // Volume root.
        split_at(
            "\\Device\\HarddiskVolume3\\",
            "\\",
            "\\Device\\HarddiskVolume3",
            false,
        );
        // Nested device name (dynamic-disk volume set).
        split_at(
            "\\Device\\HarddiskDmVolumes\\MachineDg0\\Volume1\\dir\\f",
            "\\dir\\f",
            "\\Device\\HarddiskDmVolumes\\MachineDg0\\Volume1",
            false,
        );
        // UNC: boundary extends past `\server\share`; share-rooted.
        split_at(
            "\\Device\\Mup\\srv\\share\\dir",
            "\\srv\\share\\dir",
            "\\Device\\Mup\\srv\\share",
            true,
        );
        // Session-qualified redirector: `;…` components sit on the device
        // side of the subtraction; the share extension follows.
        split_at(
            "\\Device\\Mup\\;LanmanRedirector\\;X:00000000000003e7\\srv\\share\\f",
            "\\srv\\share\\f",
            "\\Device\\Mup\\;LanmanRedirector\\;X:00000000000003e7\\srv\\share",
            true,
        );
        // Guard failures report an unknowable boundary.
        let fails = |nt: &str, vol_rel: &str| {
            assert_eq!(
                nt_clamp_prefix_len(&wide(nt), &wide(vol_rel)),
                None,
                "{nt} / {vol_rel}"
            );
        };
        fails("\\Device\\HarddiskVolume3\\x", "x"); // no leading `\`
        fails("\\Device\\HarddiskVolume3\\x", ""); // empty
        fails("\\x", "\\Device\\HarddiskVolume3\\x"); // vol_rel >= nt
        fails("\\Device\\HarddiskVolume3\\x", "\\y"); // suffix mismatch
        fails("\\Device\\Mup\\srv", "\\srv"); // UNC server without share
        fails("\\Device\\Mup\\srv\\", "\\srv\\"); // trailing sep, still no share
        fails("\\Device\\Mup\\", "\\"); // redirector root
        fails("\\Device\\HarddiskVolume3", "\\Device\\HarddiskVolume3"); // vol_rel == nt

        // Rename-race forgeries must not shear the boundary above the device.
        fails("\\Device\\HarddiskVolume4\\p", "\\HarddiskVolume4\\p"); // bare `\Device`
        fails("\\Device\\\\x", "\\x"); // empty device name
        split_at(
            "\\Device\\HarddiskVolume4\\p",
            "\\p",
            "\\Device\\HarddiskVolume4",
            false,
        );
        // Ancestor-rename shear lands DEEPER than the true device: the clamp
        // only tightens, so the shape stays accepted (indistinguishable from
        // nested device names); the floor walk still fails closed.
        split_at(
            "\\Device\\HarddiskVolume3\\a\\b\\x",
            "\\b\\x",
            "\\Device\\HarddiskVolume3\\a",
            false,
        );
        // `share_rooted == true` is what makes the caller skip the floor walk
        // (silent share-root clamp). A normalize-level Mup case would need a
        // real UNC handle, so the gate's input is pinned at this unit level.

        // LanmanRedirector direct (no Mup) is share-rooted too.
        split_at(
            "\\Device\\LanmanRedirector\\;X:0\\srv\\share\\f",
            "\\srv\\share\\f",
            "\\Device\\LanmanRedirector\\;X:0\\srv\\share",
            true,
        );
        // Device match is ordinal case-insensitive.
        split_at(
            "\\device\\MUP\\srv\\share\\dir",
            "\\srv\\share\\dir",
            "\\device\\MUP\\srv\\share",
            true,
        );
        // Trailing separator after a real share still splits after the share.
        split_at(
            "\\Device\\Mup\\srv\\share\\",
            "\\srv\\share\\",
            "\\Device\\Mup\\srv\\share",
            true,
        );
        // Prefix-extension lookalike is NOT a redirector.
        split_at("\\Device\\Mupp\\x", "\\x", "\\Device\\Mupp", false);
    }

    #[test]
    fn win32_output_uses_globalroot() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_gr");
        let dir = open_dir_handle(&tree.0);
        let got = normalize_opts(dir.fd(), "a\\b", false);
        assert!(got.starts_with("\\\\?\\GLOBALROOT\\Device\\"), "{got}");
        assert!(got.ends_with("\\a\\b"), "{got}");
        // rel `.`: GLOBALROOT + base, no trailing separator.
        assert_eq!(
            normalize_opts(dir.fd(), ".", false),
            format!("\\\\?\\GLOBALROOT{}", normalize(dir.fd(), "."))
        );
    }

    #[test]
    fn win32_globalroot_output_creates_directories() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_gr_mkdir");
        let dir = open_dir_handle(&tree.0);
        let name = normalize_opts(dir.fd(), ".\\fresh", false);
        let wname: Vec<u16> = wide(&name).into_iter().chain([0u16]).collect();
        // SAFETY: `wname` is NUL-terminated.
        let ok = unsafe { w::CreateDirectoryW(wname.as_ptr(), core::ptr::null_mut()) };
        assert_ne!(ok, 0, "CreateDirectoryW({name})");
        assert!(std::fs::metadata(tree.0.join("fresh")).unwrap().is_dir());
    }

    // ── branch-review matrix ────────────────────────────────────────────

    #[test]
    fn volume_root_base_shapes() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let root = open_dir_handle(std::path::Path::new("C:\\"));
        let dot = normalize(root.fd(), ".");
        assert!(dot.starts_with("\\Device\\"), "{dot}");
        // The lone separator is load-bearing: `\Device\<vol>\` is the root
        // directory, `\Device\<vol>` the volume device.
        assert!(dot.ends_with('\\'), "{dot}");
        // Generic across device shapes (incl. nested `HarddiskDmVolumes\…`):
        // a child of the root carries exactly the root's prefix + its name.
        let windows_dir = open_dir_handle(std::path::Path::new("C:\\Windows"));
        assert_eq!(normalize(windows_dir.fd(), "."), format!("{dot}Windows"));
        assert_eq!(normalize(root.fd(), ".\\x"), format!("{dot}x"));
        // Any `..` from the volume root would cross the floor: fail closed.
        assert_eq!(normalize_err(root.fd(), "..\\x").get_errno(), E::EINVAL);
    }

    #[test]
    fn buffer_boundary_exact_fit() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_bound");
        let dir = open_dir_handle(&tree.0);
        let base_len = wide(&normalize(dir.fd(), ".")).len();
        let longest = bun_paths::PATH_MAX_WIDE - 1 - (base_len + 1);
        let rel = |len: usize| format!("a\\{}", "b".repeat(len - 2));
        assert!(normalize_path_windows(dir.fd(), &wide(&rel(longest))).is_ok());
        let err = normalize_err(dir.fd(), &rel(longest + 1));
        assert_eq!(err.get_errno(), E::ENAMETOOLONG);
    }

    #[test]
    fn non_file_dirfd_fails_with_badfd() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        // A NUL-device handle is valid but has no file name, so the base
        // query fails deterministically (no closed-handle recycling races).
        // The compose/None-query failure arms are not constructible from a
        // real handle; `clamp_prefix_len_pairs` covers them at the unit level.
        let nul_path = wide("\\\\.\\NUL\0");
        let nul = File::from_fd(
            open_windows_device_path(
                bun_core::WStr::from_buf(&nul_path[..], nul_path.len() - 1),
                w::GENERIC_READ,
                w::OPEN_EXISTING,
                0,
            )
            .expect("open NUL"),
        );
        assert_eq!(normalize_err(nul.fd(), ".\\x").get_errno(), E::BADFD);
    }

    #[test]
    fn drive_qualified_bare_name_passes_through() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        // The bypass copies the ORIGINAL path (drive prefix included); only
        // the post-strip remainder decides the routing.
        assert_eq!(normalize(Fd::INVALID, "C:foo"), "C:foo");
    }

    #[test]
    fn win32_globalroot_dotdot_composes() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_gr_dotdot");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let child = open_dir_handle(&tree.0.join("child"));
        assert_eq!(
            normalize_opts(child.fd(), "..\\x", false),
            format!("\\\\?\\GLOBALROOT{}", normalize(child.fd(), "..\\x"))
        );
    }
}
