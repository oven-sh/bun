#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
// bun_sys is a T0 foundation crate that bun_collections depends on; importing
// it to satisfy disallowed-types would create a dependency cycle. `File` here
// IS the bun_sys::File the lint routes everyone else through.
#![allow(clippy::disallowed_types, clippy::disallowed_methods)]
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
pub mod fd;
pub use fd::{ErrorCase, FdExt, MakeLibUvOwnedError, RawFd};
#[path = "Error.rs"]
mod error;
pub use error::Error;
#[cfg(windows)]
pub use error::ReturnCodeExt;
impl From<Error> for bun_errno::SystemErrno {
    #[inline]
    fn from(e: Error) -> Self {
        bun_errno::SystemErrno::init(i64::from(e.errno)).unwrap_or(bun_errno::SystemErrno::EIO)
    }
}
/// The JS-facing rich error
/// (path/dest/syscall as `bun.String`). The data side has no JSC dependency:
/// the `*JSGlobalObject`-taking conversion methods (`toErrorInstance` etc.)
/// live in `bun_jsc` as inherent extensions. `#[repr(C)]` and field order
/// are fixed so the C++ `SystemError__*` externs
/// (BunObject.cpp) read the same layout.
#[repr(C)]
pub struct SystemError {
    pub errno: core::ffi::c_int,
    /// label for errno
    pub code: bun_core::String,
    /// it is illegal to have an empty message
    pub message: bun_core::String,
    pub path: bun_core::String,
    pub syscall: bun_core::String,
    pub hostname: bun_core::String,
    /// MinInt = no file descriptor
    pub fd: core::ffi::c_int,
    pub dest: bun_core::String,
}
impl Default for SystemError {
    fn default() -> Self {
        Self {
            errno: 0,
            code: bun_core::String::empty(),
            message: bun_core::String::empty(),
            path: bun_core::String::empty(),
            syscall: bun_core::String::empty(),
            hostname: bun_core::String::empty(),
            fd: core::ffi::c_int::MIN,
            dest: bun_core::String::empty(),
        }
    }
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
    pub fn deref(&self) {
        self.path.deref();
        self.code.deref();
        self.message.deref();
        self.syscall.deref();
        self.hostname.deref();
        self.dest.deref();
    }
    pub fn ref_(&self) {
        self.path.ref_();
        self.code.ref_();
        self.message.ref_();
        self.syscall.ref_();
        self.hostname.ref_();
        self.dest.ref_();
    }
}
impl core::fmt::Display for SystemError {
    /// Emits the colorless variant
    /// (`<r>/<red>/<d>/<b>` markup collapsed to nothing) so
    /// `Display` stays side-effect-free. The colored path is handled by
    /// `bun_core::Output::pretty*` at the call site that prints the error.
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if !self.path.is_empty() {
            // "<code>: <path>: <message> (<syscall>())"
            write!(
                f,
                "{}: {}: {} ({}())",
                self.code, self.path, self.message, self.syscall,
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

// `bun.DirIterator`.
//
// A readdir-style directory iterator. Notable behaviors:
// - returns errors in `bun_sys::Result` (preserves errno + syscall tag)
// - doesn't mark BADF as unreachable
// - entry name (`Name`) is a lifetime-erased borrow into the iterator's inline
//   `buf` on POSIX, owned `Vec` on Windows
//
// The high-tier `bun_runtime::node::dir_iterator` shares this surface; the
// readdir loop lives here so `walker_skippable` / `bun_glob` / resolver can
// iterate without pulling `bun_runtime` up-tier.
pub mod dir_iterator {
    use super::{EntryKind, Error, Fd, Result, Tag};
    use bun_paths::OSPathChar;

    const BUF_SIZE: usize = 8192;

    /// Native-encoding directory entry returned by `WrappedIterator::next()`.
    ///
    /// `name` is a
    /// *borrow* into the iterator's internal `buf`. It is invalidated by the
    /// next call to `next()` and by moving/dropping the iterator. Copy it out
    /// (`.slice_u8().to_vec()` etc.) if you need it to outlive the iteration
    /// step.
    pub struct IteratorResult {
        pub name: Name,
        pub kind: EntryKind,
    }

    /// Length-known, NUL-terminated entry name in OS-native encoding.
    ///
    /// **POSIX**: lifetime-erased borrow (raw pointer + length) into the
    /// iterator's `getdents`/`getdirentries` buffer. The kernel writes
    /// `d_name` NUL-terminated, so `as_zstr()` needs no copy. The slice is
    /// only valid until the next `next()` call or until the iterator is
    /// moved/dropped. No heap allocation per entry.
    ///
    /// **Windows**: `FILE_DIRECTORY_INFORMATION.FileName` is length-prefixed
    /// (no NUL) and UTF-16; we keep an owning `Vec` per entry (cold path —
    /// the install hot loop is POSIX-only) so `slice_u8()` can hand out a
    /// borrowed `&[u8]` on every platform.
    #[cfg(not(windows))]
    #[derive(Copy, Clone)]
    pub struct Name {
        /// Points at `d_name[0]` inside the iterator's `buf`; `ptr[len] == 0`.
        ptr: core::ptr::NonNull<u8>,
        len: usize,
    }
    #[cfg(not(windows))]
    // SAFETY: `Name` is a lifetime-erased `&[u8]`; the borrowed bytes are
    // immutable kernel-filled data and the iterator is not shared across
    // threads while a `Name` is outstanding.
    unsafe impl Send for Name {}
    // SAFETY: see `Send` above — `Name` only exposes shared reads of
    // immutable kernel-filled bytes, so `&Name` is safe to share.
    #[cfg(not(windows))]
    unsafe impl Sync for Name {}
    #[cfg(windows)]
    pub struct Name {
        native: Vec<OSPathChar>,
        utf8: Vec<u8>,
    }
    impl Name {
        #[cfg(not(windows))]
        #[inline]
        fn borrow(s: &[u8]) -> Name {
            // SAFETY: `s` is a slice into a kernel-written dirent record; the
            // byte at `s.as_ptr().add(s.len())` is the in-record NUL terminator
            // and lies within the same `reclen`-sized allocation.
            debug_assert!(unsafe { *s.as_ptr().add(s.len()) } == 0);
            Name {
                ptr: core::ptr::NonNull::from(s).cast(),
                len: s.len(),
            }
        }
        #[cfg(windows)]
        #[inline]
        fn from_slice(s: &[OSPathChar]) -> Name {
            let mut v = Vec::with_capacity(s.len() + 1);
            v.extend_from_slice(s);
            v.push(0);
            // Trust that Windows gives us valid UTF-16LE.
            let utf8 = bun_core::strings::convert_utf16_to_utf8(Vec::new(), s);
            Name { native: v, utf8 }
        }
        /// Borrow the name as `&[OSPathChar]` (no NUL).
        #[cfg(not(windows))]
        #[inline]
        pub fn slice(&self) -> &[OSPathChar] {
            // SAFETY: `borrow()` was given a live slice into the iterator's
            // `buf`; caller honours the streaming-iterator contract.
            unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
        }
        #[cfg(windows)]
        #[inline]
        pub fn slice(&self) -> &[OSPathChar] {
            &self.native[..self.native.len() - 1]
        }
        #[inline]
        pub fn as_slice(&self) -> &[OSPathChar] {
            self.slice()
        }
        /// Borrow the entry name as UTF-8 bytes (no NUL). On POSIX this is the
        /// native slice; on Windows it is the cached `fromWPath` transcode.
        #[cfg(not(windows))]
        #[inline]
        pub fn slice_u8(&self) -> &[u8] {
            self.slice()
        }
        #[cfg(windows)]
        #[inline]
        pub fn slice_u8(&self) -> &[u8] {
            &self.utf8
        }
        #[cfg(not(windows))]
        #[inline]
        pub fn as_zstr(&self) -> &bun_core::ZStr {
            // SAFETY: `ptr[len] == 0` (kernel NUL-terminates `d_name`); see
            // `borrow()` debug_assert.
            unsafe { bun_core::ZStr::from_raw(self.ptr.as_ptr(), self.len) }
        }
        #[cfg(windows)]
        #[inline]
        pub fn as_zstr(&self) -> &bun_core::WStr {
            // `from_slice` pushed a trailing NUL.
            bun_core::WStr::from_slice_with_nul(&self.native)
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
    struct AlignedBuf(core::mem::MaybeUninit<[u8; BUF_SIZE]>);
    impl AlignedBuf {
        #[inline(always)]
        const fn uninit() -> Self {
            AlignedBuf(core::mem::MaybeUninit::uninit())
        }
        #[inline(always)]
        fn as_mut_ptr(&mut self) -> *mut u8 {
            self.0.as_mut_ptr().cast()
        }
        /// View `[0..len]` as `&[u8]`.
        ///
        /// SAFETY: caller asserts the kernel (or an explicit write) has
        /// initialized every byte in `[0..len]`.
        #[inline(always)]
        unsafe fn filled(&self, len: usize) -> &[u8] {
            debug_assert!(len <= BUF_SIZE);
            // SAFETY: caller contract — bytes `[0..len]` were initialized by
            // the kernel; `len <= BUF_SIZE` (asserted) keeps the slice in-bounds.
            unsafe { core::slice::from_raw_parts(self.0.as_ptr().cast::<u8>(), len) }
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
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult>> {
            loop {
                if self.index >= self.end_index {
                    // glibc doesn't expose getdents64; go straight to the syscall.
                    // SAFETY: buf is valid for BUF_SIZE bytes; fd is a plain c_int.
                    let rc = unsafe {
                        super::linux_syscall::getdents64(
                            dir.native(),
                            self.buf.as_mut_ptr(),
                            BUF_SIZE,
                        )
                    };
                    if rc < 0 {
                        return Err(Error::from_code_int(super::last_errno(), Tag::getdents64));
                    }
                    if rc == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = rc as usize;
                }
                // struct linux_dirent64 { u64 d_ino; i64 d_off; u16 d_reclen;
                //                         u8 d_type; char d_name[]; }
                let base = self.index;
                // SAFETY: kernel filled `[0..end_index]`; `base < end_index` and
                // each record fits entirely in `[base..base+reclen) ⊆ [0..end_index)`.
                let buf = unsafe { self.buf.filled(self.end_index) };
                let reclen = u16::from_ne_bytes([buf[base + 16], buf[base + 17]]) as usize;
                let d_type = buf[base + 18];
                self.index = base + reclen;

                // d_name is NUL-terminated within the record. Use a SIMD-vectorized
                // scan for the terminator; a scalar
                // byte loop here showed up in startup profiles on large directories.
                let name_field = &buf[base + 19..base + reclen];
                let nul = memchr::memchr(0, name_field).unwrap_or(name_field.len());
                let name = &name_field[..nul];

                // skip . and .. entries
                if name == b"." || name == b".." {
                    continue;
                }

                return Ok(Some(IteratorResult {
                    name: Name::borrow(name),
                    kind: kind_from_dt(d_type),
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
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult>> {
            unsafe extern "C" {
                // Private libsystem symbol.
                fn __getdirentries64(
                    fd: libc::c_int,
                    buf: *mut u8,
                    nbytes: usize,
                    basep: *mut i64,
                ) -> isize;
            }
            loop {
                if self.index >= self.end_index {
                    if self.received_eof {
                        return Ok(None);
                    }

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
                    // SAFETY: writing into our own MaybeUninit buffer.
                    unsafe {
                        self.buf
                            .as_mut_ptr()
                            .add(BUF_SIZE - 4)
                            .cast::<[u8; 4]>()
                            .write([0, 0, 0, 0]);
                    }

                    // SAFETY: buf is valid for BUF_SIZE bytes; seek is a valid *mut i64.
                    let rc = unsafe {
                        __getdirentries64(
                            dir.native(),
                            self.buf.as_mut_ptr(),
                            BUF_SIZE,
                            &raw mut self.seek,
                        )
                    };
                    if rc < 1 {
                        if rc == 0 {
                            self.received_eof = true;
                            return Ok(None);
                        }
                        return Err(Error::from_code_int(
                            super::last_errno(),
                            Tag::getdirentries64,
                        ));
                    }
                    self.index = 0;
                    self.end_index = rc as usize;
                    // SAFETY: we explicitly zeroed `[BUF_SIZE-4..BUF_SIZE)` above
                    // and the kernel may have overwritten it with the EOF flag —
                    // either way the 4 bytes are initialized.
                    let flag = unsafe {
                        self.buf
                            .as_mut_ptr()
                            .add(BUF_SIZE - 4)
                            .cast::<[u8; 4]>()
                            .read()
                    };
                    let flag = u32::from_ne_bytes(flag);
                    self.received_eof = self.end_index <= (BUF_SIZE - 4) && flag == 1;
                }
                // Darwin `struct dirent` (64-bit ino):
                //   u64 d_ino; u64 d_seekoff; u16 d_reclen; u16 d_namlen;
                //   u8 d_type; char d_name[];
                let base = self.index;
                // SAFETY: kernel filled `[0..end_index]`; each record fits in
                // `[base..base+reclen) ⊆ [0..end_index)`.
                let buf = unsafe { self.buf.filled(self.end_index) };
                let d_ino = u64::from_ne_bytes(
                    buf[base..base + 8]
                        .try_into()
                        .expect("infallible: size matches"),
                );
                let reclen = u16::from_ne_bytes([buf[base + 16], buf[base + 17]]) as usize;
                let namlen = u16::from_ne_bytes([buf[base + 18], buf[base + 19]]) as usize;
                let d_type = buf[base + 20];
                self.index = base + reclen;

                // `d_name` is NUL-terminated at `[namlen]` (within `reclen`).
                let name = &buf[base + 21..base + 21 + namlen];

                if name == b"." || name == b".." || d_ino == 0 {
                    continue;
                }

                return Ok(Some(IteratorResult {
                    name: Name::borrow(name),
                    kind: kind_from_dt(d_type),
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
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult>> {
            unsafe extern "C" {
                fn getdents(fd: libc::c_int, buf: *mut u8, nbytes: usize) -> isize;
            }
            loop {
                if self.index >= self.end_index {
                    // SAFETY: buf is valid for BUF_SIZE bytes.
                    let rc = unsafe { getdents(dir.native(), self.buf.as_mut_ptr(), BUF_SIZE) };
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
                // FreeBSD 12+ `struct dirent` (ino64):
                //   u64 d_fileno; i64 d_off; u16 d_reclen; u8 d_type; u8 pad0;
                //   u16 d_namlen; u16 pad1; char d_name[];
                let base = self.index;
                // SAFETY: kernel filled `[0..end_index]`; each record fits in
                // `[base..base+reclen) ⊆ [0..end_index)`.
                let buf = unsafe { self.buf.filled(self.end_index) };
                let fileno = u64::from_ne_bytes(
                    buf[base..base + 8]
                        .try_into()
                        .expect("infallible: size matches"),
                );
                let reclen = u16::from_ne_bytes([buf[base + 16], buf[base + 17]]) as usize;
                let d_type = buf[base + 18];
                let namlen = u16::from_ne_bytes([buf[base + 20], buf[base + 21]]) as usize;
                self.index = base + reclen;

                // `d_name` is NUL-terminated at `[namlen]` (within `reclen`).
                let name = &buf[base + 24..base + 24 + namlen];

                if name == b"." || name == b".." || fileno == 0 {
                    continue;
                }

                return Ok(Some(IteratorResult {
                    name: Name::borrow(name),
                    kind: kind_from_dt(d_type),
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
    }
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
            }
        }
        fn next(&mut self, dir: Fd) -> Result<Option<IteratorResult>> {
            use crate::windows::Win32Error;
            use bun_errno::Win32ErrorExt as _;
            use bun_windows_sys::externs as w;
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
                    let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
                    if self.first {
                        // > Any bytes inserted for alignment SHOULD be set to
                        // > zero, and the receiver MUST ignore them.
                        // SAFETY: writing zeros into our own MaybeUninit buffer.
                        unsafe { self.buf.as_mut_ptr().write_bytes(0, BUF_SIZE) };
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
                    // SAFETY: FFI; all pointer args are valid for the call.
                    let rc = unsafe {
                        w::ntdll::NtQueryDirectoryFile(
                            dir.native(),
                            core::ptr::null_mut(),
                            core::ptr::null_mut(),
                            core::ptr::null_mut(),
                            &mut io,
                            self.buf.as_mut_ptr().cast(),
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
                        let errno = Win32Error::from_nt_status(rc).to_e();
                        return Err(Error::from_code(errno, Tag::NtQueryDirectoryFile));
                    }
                    if io.Information == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = io.Information;
                }

                let entry_offset = self.index;
                // SAFETY: the `if self.first` branch zero-fills the whole 8 KiB
                // before the first NtQueryDirectoryFile, and every subsequent
                // call only overwrites a prefix — `[0..BUF_SIZE)` stays fully
                // initialized for the iterator's lifetime once we reach here.
                let buf = unsafe { self.buf.filled(BUF_SIZE) };
                // While the official api docs guarantee FILE_DIRECTORY_INFORMATION
                // to be aligned properly, this may not always be the case (e.g.
                // due to faulty VM/Sandboxing tools) — read fields unaligned via
                // safe byte-array indexing. entry_offset < end_index ≤ BUF_SIZE;
                // struct header (NAME_OFFSET = 64 bytes) is fully within the buffer
                // per the NtQueryDirectoryFile contract on STATUS_SUCCESS.
                let next_off = u32::from_ne_bytes(
                    buf[entry_offset..entry_offset + 4]
                        .try_into()
                        .expect("infallible: size matches"),
                ) as usize;
                let file_attrs = u32::from_ne_bytes(
                    buf[entry_offset + 56..entry_offset + 60]
                        .try_into()
                        .expect("infallible: size matches"),
                );
                let name_len_bytes = u32::from_ne_bytes(
                    buf[entry_offset + 60..entry_offset + 64]
                        .try_into()
                        .expect("infallible: size matches"),
                ) as usize;
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
                // name_byte_offset + name_len_u16*2 ≤ BUF_SIZE by clamp above.
                // `AlignedBuf` is align(8) and `entry_offset`/`NAME_OFFSET` are
                // both multiples of 4, so the u8→u16 cast is always aligned.
                let dir_info_name: &[u16] = bytemuck::cast_slice(
                    &buf[name_byte_offset..name_byte_offset + name_len_u16 * 2],
                );

                if dir_info_name == [b'.' as u16] || dir_info_name == [b'.' as u16, b'.' as u16] {
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
        // stored on `State` on Windows so `next()` can pass it.
        #[cfg(not(windows))]
        name_filter: Option<Vec<u16>>,
        state: State,
    }
    impl WrappedIterator {
        #[inline]
        pub fn dir(&self) -> Fd {
            self.dir
        }
        /// Windows-only kernel-side name filter (passed to `NtQueryDirectoryFile`).
        /// On POSIX this is a no-op; callers must filter themselves.
        #[inline]
        pub fn set_name_filter(&mut self, filter: Option<&[u16]>) {
            #[cfg(windows)]
            {
                self.state.name_filter = filter.map(|f| f.to_vec());
            }
            #[cfg(not(windows))]
            {
                self.name_filter = filter.map(|f| f.to_vec());
            }
        }
        /// Memory such as file names referenced in this returned entry becomes
        /// invalid with subsequent calls to `next`, as well as when this
        /// iterator is moved or dropped.
        ///
        /// On POSIX `IteratorResult::name` is a lifetime-erased borrow into
        /// this iterator's inline `buf`.
        /// Copy it out before pushing the iterator into a `Vec` etc.
        #[inline]
        pub fn next(&mut self) -> Result<Option<IteratorResult>> {
            self.state.next(self.dir)
        }
    }

    pub fn iterate(dir: Fd) -> WrappedIterator {
        #[cfg(not(windows))]
        {
            WrappedIterator {
                dir,
                name_filter: None,
                state: State::new(),
            }
        }
        #[cfg(windows)]
        {
            WrappedIterator {
                dir,
                state: State::new(),
            }
        }
    }
}

/// `bun.openDirForIterationOSPath` — `openat(dir, path, O_DIRECTORY|O_RDONLY)`
/// on POSIX; `CreateFileW` with `FILE_FLAG_BACKUP_SEMANTICS` on Windows.
pub fn open_dir_for_iteration_os_path(dir: Fd, path: &bun_paths::OSPathSlice) -> Result<Fd> {
    #[cfg(not(windows))]
    {
        let mut buf = bun_paths::PathBuffer::default();
        // ENAMETOOLONG on
        // overflow, never silently truncate (would open the wrong directory).
        if path.len() >= buf.len() {
            return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::open).with_path(path));
        }
        let len = path.len();
        buf[..len].copy_from_slice(path);
        buf[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = ZStr::from_buf(&buf[..], len);
        let flags = libc::O_DIRECTORY | libc::O_RDONLY | libc::O_CLOEXEC;
        openat(dir, z, flags, 0)
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
        let dirfd = if fd.is_valid() {
            fd.native()
        } else {
            libc::AT_FDCWD
        };
        linux_syscall::fstatat(dirfd, path, libc::AT_SYMLINK_NOFOLLOW)
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
            Ok(file) => {
                let r = fstat(file);
                let _ = close(file);
                r
            }
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
    debug_assert!(len < buf.len());
    buf[len] = 0;
    // SAFETY: NUL written at buf[len]; slice is within buf.
    Ok(ZStr::from_buf(&buf[..], len))
}

pub mod coreutils_error_map;
pub mod libuv_error_map;
#[path = "SignalCode.rs"]
pub mod signal_code;
pub use signal_code::SignalCode;
pub mod tmp;
pub use tmp::Tmpfile;
// `windows/mod.rs` is `#![cfg(windows)]`-gated internally; on POSIX this
// declares an empty module so `bun_sys::windows::*` paths still resolve under
// `#[cfg(windows)]` arms in dependents.
pub mod windows;

#[cfg(not(windows))]
use core::ffi::c_int;
use core::ffi::{c_char, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from lower-tier crates (PORTING.md crate map).
// ──────────────────────────────────────────────────────────────────────────
pub use bun_core::{Fd, FdKind, FdNative, FdOptional, FileKind, Mode, Stdio, kind_from_mode};

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
pub(crate) mod linux_syscall;

#[inline]
pub fn is_regular_file(mode: Mode) -> bool {
    kind_from_mode(mode) == FileKind::File
}
#[cfg(windows)]
pub use bun_errno::Win32ErrorExt;
pub use bun_errno::{E, GetErrno, S, SystemErrno, e_from_negated, get_errno};

/// Exported for `headers-handwritten.h` `Bun__errnoName`. Returns a
/// NUL-terminated upper-case errno name (e.g. `"ENOENT"`) or null for an
/// unrecognised code. The pointer is thread-local and valid until the next
/// call on the same thread; both C++ callers consume it immediately.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__errnoName(err: core::ffi::c_int) -> *const core::ffi::c_char {
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

/// Small "fire and forget" wrapper around unlink for C usage that handles
/// EINTR, Windows path conversion, etc.
///
/// # Safety
/// `ptr[0..=len]` must be a valid NUL-terminated path slice for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__unlink(ptr: *const u8, len: usize) {
    // SAFETY: caller (C++) guarantees `ptr[0..=len]` is a valid NUL-terminated
    // path slice for the duration of the call.
    let path = unsafe { ZStr::from_raw(ptr, len) };
    let _ = unlink(path);
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
        let e = windows::translate_nt_status_to_errno(rc);
        Some(Err(Error::from_code(e, tag)))
    }
}
#[cfg(windows)]
impl error::IntoErrnoInt for bun_windows_sys::NTSTATUS {
    #[inline]
    fn into_errno_int(self) -> error::Int {
        windows::translate_nt_status_to_errno(self) as error::Int
    }
}

/// Flags for [`renameat2`].
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
            if self.exchange {
                flags |= 2;
            }
            if self.exclude {
                flags |= 4;
            }
            if self.nofollow {
                flags |= 0x10;
            }
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            if self.exchange {
                flags |= libc::RENAME_EXCHANGE as u32;
            }
            if self.exclude {
                flags |= libc::RENAME_NOREPLACE as u32;
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        {
            if self.exchange {
                flags |= 1;
            }
            if self.exclude {
                flags |= 2;
            }
            let _ = self.nofollow;
        }
        flags
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
    #[cfg(windows)]
    pub const TMPFILE: i32 = 0o20200000;
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    pub const PATH: i32 = 0;
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    pub const NOATIME: i32 = 0;
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    pub const TMPFILE: i32 = 0;
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
pub mod file;
pub use file::{File, ReadToEndResult};
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
/// On Windows this reads the CRT's
/// thread-local `_errno()`; libuv-backed paths that need Win32
/// `GetLastError()` go through `bun_sys::windows::get_last_errno` instead.
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
    pub const chdir: Tag = Tag(51);
    pub const fcopyfile: Tag = Tag(52);
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
    pub const rm: Tag = Tag(88);
    pub const uv_spawn: Tag = Tag(89);
    pub const uv_pipe: Tag = Tag(90);
    pub const uv_tty_set_mode: Tag = Tag(91);
    pub const uv_os_homedir: Tag = Tag(93);
    pub const WriteFile: Tag = Tag(94);
    pub const NtQueryDirectoryFile: Tag = Tag(95);
    pub const NtSetInformationFile: Tag = Tag(96);
    pub const GetFinalPathNameByHandle: Tag = Tag(97);
    pub const CloseHandle: Tag = Tag(98);
    pub const SetFilePointerEx: Tag = Tag(99);
    pub const SetEndOfFile: Tag = Tag(100);
    // ── later additions — appended above the frozen range so existing
    // discriminants never shift.
    pub const dup2: Tag = Tag(101);
    pub const fchdir: Tag = Tag(102);
    pub const fchownat: Tag = Tag(103);
    pub const ioctl: Tag = Tag(104);
    pub const getrlimit: Tag = Tag(105);
    pub const setrlimit: Tag = Tag(106);
    // `inotify_init1`/`inotify_add_watch` fold under the generic `.watch`
    // tag; `INotifyWatcher.rs` spells it `.inotify`. Alias to `.watch`
    // so the JS-facing `err.syscall == "watch"` string stays node-compatible.

    /// The tag name — spelling is frozen (JS-facing
    /// `err.syscall` string; node-compat code matches on it).
    pub fn name(self) -> &'static str {
        const NAMES: [&str; 107] = [
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
        ];
        NAMES.get(self.0 as usize).copied().unwrap_or("unknown")
    }

    /// Tags strictly above `WriteFile`
    /// belong to the Windows-only block. Bounded by `SetEndOfFile` so the
    /// later-added POSIX tags (`dup2`/`fchdir`/`fchownat`/`ioctl`) parked
    /// above that range don't read as Windows.
    #[inline]
    pub const fn is_windows(self) -> bool {
        self.0 > Self::WriteFile.0 && self.0 <= Self::SetEndOfFile.0
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
pub const MAX_COUNT: usize = 0x7ffff000;
#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
pub const MAX_COUNT: usize = i32::MAX as usize;
#[cfg(windows)]
pub const MAX_COUNT: usize = u32::MAX as usize;

// ── libc shims with no preconditions ────────────────────────────────────────
// Every fn here takes only by-value scalars (`c_int` fd, `mode_t`, `uid_t`,
// `gid_t`, `off_t`). The kernel validates the fd and reports failure via the
// return value / `errno` — passing a bad fd is `EBADF`, never UB. Declaring
// them locally as `safe fn` (instead of routing through the `libc` crate's
// `unsafe extern fn` items) drops the per-call-site `unsafe { }` block.
#[cfg(unix)]
pub(crate) mod safe_libc {
    use core::ffi::c_int;
    // `close` is a libc symbol std relies on; this is an FFI import (not a
    // competing definition) with the canonical signature.
    #[allow(suspicious_runtime_symbol_definitions)]
    unsafe extern "C" {
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        pub(crate) safe fn close(fd: c_int) -> c_int;
        pub(crate) safe fn dup2(old: c_int, new: c_int) -> c_int;
        pub(crate) safe fn isatty(fd: c_int) -> c_int;
        pub(crate) safe fn fsync(fd: c_int) -> c_int;
        // macOS has had fdatasync(2) since 10.7; the `libc` crate omits the
        // Apple binding, so a local decl is needed there anyway.
        pub(crate) safe fn fdatasync(fd: c_int) -> c_int;
        pub(crate) safe fn fchdir(fd: c_int) -> c_int;
        pub(crate) safe fn umask(mode: libc::mode_t) -> libc::mode_t;
        pub(crate) safe fn fchmod(fd: c_int, mode: libc::mode_t) -> c_int;
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
        // Out-param is `&mut MaybeUninit<termios>` (`MaybeUninit<T>` is
        // `#[repr(transparent)]`, so ABI-identical to `*mut termios`,
        // non-null, valid for `sizeof(termios)` writes); libc only writes the
        // slot on success and reports failure via the return value — bad fd →
        // `ENOTTY`/`EBADF`, never UB.
        pub(crate) safe fn tcgetattr(
            fd: c_int,
            t: &mut core::mem::MaybeUninit<libc::termios>,
        ) -> c_int;
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
    unsafe fn sys_openat(d: i32, p: *const libc::c_char, f: i32, m: libc::c_uint) -> i32 {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: caller contract (`unsafe fn`) — `p` is a valid
            // NUL-terminated path and `d` is a live dir fd (or AT_FDCWD).
            unsafe { super::nocancel::openat(d, p, f, m) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: caller contract (`unsafe fn`) — `p` is a valid
            // NUL-terminated path and `d` is a live dir fd (or AT_FDCWD).
            unsafe { libc::openat(d, p, f, m) }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    unsafe fn sys_read(fd: i32, buf: *mut libc::c_void, n: usize) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // writable bytes and `fd` is a live descriptor.
            unsafe { super::nocancel::read(fd, buf, n) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // writable bytes and `fd` is a live descriptor.
            unsafe { libc::read(fd, buf, n) }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    unsafe fn sys_write(fd: i32, buf: *const libc::c_void, n: usize) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // readable bytes and `fd` is a live descriptor.
            unsafe { super::nocancel::write(fd, buf, n) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // readable bytes and `fd` is a live descriptor.
            unsafe { libc::write(fd, buf, n) }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    unsafe fn sys_pread(fd: i32, buf: *mut libc::c_void, n: usize, off: i64) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // writable bytes and `fd` is a live descriptor.
            unsafe { super::nocancel::pread(fd, buf, n, off) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // writable bytes and `fd` is a live descriptor.
            unsafe { libc::pread(fd, buf, n, off) }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    unsafe fn sys_pwrite(fd: i32, buf: *const libc::c_void, n: usize, off: i64) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // readable bytes and `fd` is a live descriptor.
            unsafe { super::nocancel::pwrite(fd, buf, n, off) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // readable bytes and `fd` is a live descriptor.
            unsafe { libc::pwrite(fd, buf, n, off) }
        }
    }
    #[inline]
    unsafe fn sys_recv(fd: i32, buf: *mut libc::c_void, n: usize, flags: i32) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // writable bytes and `fd` is a live socket.
            unsafe {
                super::nocancel::recvfrom(
                    fd,
                    buf,
                    n,
                    flags,
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                )
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // writable bytes and `fd` is a live socket.
            unsafe { libc::recv(fd, buf, n, flags) }
        }
    }
    #[inline]
    unsafe fn sys_send(fd: i32, buf: *const libc::c_void, n: usize, flags: i32) -> isize {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // readable bytes and `fd` is a live socket.
            unsafe { super::nocancel::sendto(fd, buf, n, flags, core::ptr::null(), 0) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // SAFETY: caller contract (`unsafe fn`) — `buf` points to `n`
            // readable bytes and `fd` is a live socket.
            unsafe { libc::send(fd, buf, n, flags) }
        }
    }
    // EINTR-retry: most wrappers loop on EINTR. NOT all — the macOS
    // `$NOCANCEL` arms for open/openat/read/write/recv/send issue exactly one
    // call and surface EINTR to the caller without looping. `check!` keeps the
    // retry for the common path; `check_once!` is the single-shot variant for
    // the Darwin arms.
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
    // Single-shot: no EINTR retry (Darwin `$NOCANCEL` arms).
    #[cfg(target_os = "macos")]
    macro_rules! check_once {
        ($rc:expr, $tag:expr) => {{
            let rc = $rc;
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), $tag));
            }
            rc
        }};
    }
    #[cfg(target_os = "macos")]
    macro_rules! check_once_p {
        ($rc:expr, $tag:expr, $path:expr) => {{
            let rc = $rc;
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), $tag).with_path($path.as_bytes()));
            }
            rc
        }};
    }

    #[inline]
    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        // `open()` is `openat(.cwd(), ..)` on every POSIX target
        // ("this is what open() does anyway"): `openat(AT_FDCWD, ..)` on
        // Linux/FreeBSD, `openat$NOCANCEL(AT_FDCWD, ..)` on Darwin.
        openat(Fd::cwd(), path, flags, mode)
    }
    pub fn openat(dir: impl AsFd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        let dir = dir.as_fd();
        // macOS: single `openat$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        {
            let rc = check_once_p!(
                // SAFETY: `dir` is a live fd (or AT_FDCWD); `ZStr::as_ptr()` is
                // a valid NUL-terminated C string.
                unsafe { sys_openat(dir.native(), path.as_ptr(), flags, mode as libc::c_uint) },
                Tag::open,
                path
            );
            Ok(Fd::from_native(rc))
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            super::linux_syscall::openat(dir, path, flags, mode)
                .map_err(|e| Error::from_code_int(e, Tag::open).with_path(path.as_bytes()))
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
        {
            let rc = check_p!(
                unsafe { sys_openat(dir.native(), path.as_ptr(), flags, mode as libc::c_uint) },
                Tag::open,
                path
            );
            Ok(Fd::from_native(rc))
        }
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn openat2_beneath(dir: impl AsFd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        let dir = dir.as_fd();
        super::linux_syscall::openat2_beneath(dir, path, flags, mode)
            .map_err(|e| Error::from_code_int(e, Tag::open).with_path(path.as_bytes()))
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
    pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        // macOS: single `read$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        {
            let n = check_once!(
                // SAFETY: `fd` is a live descriptor; `buf` is valid for `len` writes.
                unsafe { sys_read(fd.native(), buf.as_mut_ptr().cast(), len) },
                Tag::read
            );
            Ok(n as usize)
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            super::linux_syscall::read(fd, &mut buf[..len])
                .map_err(|e| Error::from_code_int(e, Tag::read))
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
        {
            let n = check!(
                unsafe { sys_read(fd.native(), buf.as_mut_ptr().cast(), len) },
                Tag::read
            );
            Ok(n as usize)
        }
    }
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        // macOS: single `write$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        {
            let n = check_once!(
                // SAFETY: `fd` is a live descriptor; `buf` is valid for `len` reads.
                unsafe { sys_write(fd.native(), buf.as_ptr().cast(), len) },
                Tag::write
            );
            Ok(n as usize)
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            super::linux_syscall::write(fd, &buf[..len])
                .map_err(|e| Error::from_code_int(e, Tag::write))
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
        {
            let n = check!(
                unsafe { sys_write(fd.native(), buf.as_ptr().cast(), len) },
                Tag::write
            );
            Ok(n as usize)
        }
    }
    pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return super::linux_syscall::pread(fd, &mut buf[..len], off)
                .map_err(|e| Error::from_code_int(e, Tag::pread));
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let n = check!(
                // SAFETY: `fd` is a live descriptor; `buf` is valid for `len` writes.
                unsafe { sys_pread(fd.native(), buf.as_mut_ptr().cast(), len, off) },
                Tag::pread
            );
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
            let n = check!(
                // SAFETY: `fd` is a live descriptor; `buf` is valid for `len` reads.
                unsafe { sys_pwrite(fd.native(), buf.as_ptr().cast(), len, off) },
                Tag::pwrite
            );
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
            #![allow(non_camel_case_types)]
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
        use core::sync::atomic::Ordering;
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
                SUPPORTS_STATX_ON_LINUX.store(false, Ordering::Relaxed);
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
                    SUPPORTS_STATX_ON_LINUX.store(false, Ordering::Relaxed);
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
    pub fn mkdir_recursive_at(dir: impl AsFd, sub_path: &[u8]) -> Maybe<()> {
        let dir = dir.as_fd();
        mkdir_recursive_at_mode(dir, sub_path, 0o755)
    }
    /// `mkdir_recursive_at` with an explicit `mode` for created directories
    /// (matches `bun.api.node.fs.NodeFS.mkdirRecursive`'s `mode` arg).
    pub fn mkdir_recursive_at_mode(dir: Fd, sub_path: &[u8], mode: Mode) -> Maybe<()> {
        use bun_paths::{ComponentIterator, MakePathStep, PathFormat};
        // POSIX `init` is infallible.
        let it = ComponentIterator::init(sub_path, PathFormat::Posix).unwrap();
        let mut buf = [0u8; bun_core::MAX_PATH_BYTES];
        bun_paths::make_path_with(it, |p| {
            if p.len() >= buf.len() {
                // Tag as `.mkdir`; keep consistent with `mkdirat`.
                return Err(
                    Error::from_code_int(E::ENAMETOOLONG as _, Tag::mkdir).with_path(sub_path)
                );
            }
            buf[..p.len()].copy_from_slice(p);
            buf[p.len()] = 0;
            match mkdirat(dir, ZStr::from_buf(&buf[..], p.len()), mode) {
                Ok(()) => Ok(MakePathStep::Created),
                Err(e) if e.get_errno() == E::EEXIST => Ok(MakePathStep::Exists),
                Err(e) if e.get_errno() == E::ENOENT => Ok(MakePathStep::NotFound(e)),
                Err(e) => Err(e),
            }
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
    /// unix without an atomic-exchange rename get `ENOSYS` when flags are set.
    pub fn renameat2(
        from_dir: Fd,
        from: &ZStr,
        to_dir: Fd,
        to: &ZStr,
        flags: Renameat2Flags,
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
                        flags.int() as libc::c_long,
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
                        flags.int(),
                    )
                },
                Tag::rename,
                from
            );
            return Ok(());
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        {
            if flags.int() != 0 {
                return Err(
                    Error::from_code_int(libc::ENOSYS, Tag::rename).with_path(from.as_bytes())
                );
            }
            renameat(from_dir, from, to_dir, to)
        }
    }
    /// `unlinkat` with explicit `flags` (e.g. `AT_REMOVEDIR`). The error is
    /// built so the surfaced `SystemError` carries BOTH the dirfd and the path.
    pub fn unlinkat_with_flags(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()> {
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
        // Attach the fd on error.
        loop {
            // SAFETY: `fd` is a live descriptor; `F_DUPFD_CLOEXEC` with arg `0`
            // takes no pointer arguments.
            let rc = unsafe { libc::fcntl(fd.native(), libc::F_DUPFD_CLOEXEC, 0) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR {
                    continue;
                }
                return Err(Error::from_code_int(e, Tag::fcntl).with_fd(fd));
            }
            return Ok(Fd::from_native(rc));
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
    pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()> {
        check!(safe_libc::ftruncate(fd.native(), len), Tag::ftruncate);
        Ok(())
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
    pub fn link(src: &ZStr, dest: &ZStr) -> Maybe<()> {
        check_p!(
            // SAFETY: both `ZStr`s are valid NUL-terminated C strings.
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
    /// Linux-only; on other unix this errors with EOPNOTSUPP.
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
                        libc::AT_FDCWD,
                        buf.as_ptr().cast(),
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
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    pub fn linkat_tmpfile(_tmpfd: Fd, _dirfd: Fd, name: &ZStr) -> Maybe<()> {
        // Tags as `.link` (matches Linux arm).
        Err(Error::from_code_int(libc::EOPNOTSUPP, Tag::link).with_path(name.as_bytes()))
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
        let dirfd = if fd.is_valid() {
            fd.native()
        } else {
            libc::AT_FDCWD
        };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return super::linux_syscall::fstatat(dirfd, path, 0)
                .map_err(|e| Error::from_code_int(e, Tag::fstatat).with_path(path.as_bytes()));
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check_p!(
                // SAFETY: `dirfd` is a live fd (or AT_FDCWD); `path` is
                // NUL-terminated; `st` is a valid out-param.
                unsafe { libc::fstatat(dirfd, path.as_ptr(), st.as_mut_ptr(), 0) },
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
        let dir = dir.as_fd();
        // SAFETY: `dir` is a live fd (or AT_FDCWD); `ZStr::as_ptr()` is a
        // valid NUL-terminated C string.
        let rc = unsafe { libc::faccessat(dir.native(), sub.as_ptr(), libc::F_OK, 0) };
        Ok(rc == 0)
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
        // SAFETY: `dir` is a live fd (or AT_FDCWD); `ZStr::as_ptr()` is a
        // valid NUL-terminated C string.
        unsafe { libc::faccessat(dir.native(), sub.as_ptr(), libc::F_OK, 0) == 0 }
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

    // ── fcntl/dup/pipe/io group ──
    pub type FcntlInt = isize;
    pub fn fcntl(fd: Fd, cmd: i32, arg: isize) -> Maybe<FcntlInt> {
        // Attach the fd to the error.
        loop {
            // SAFETY: `fd` is a live descriptor; `arg` is passed by value and
            // interpreted per `cmd` (no pointer commands flow through here).
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
        // `fdatasync` is available on all Unix
        // (macOS has had fdatasync(2) since 10.7). The libc crate omits the
        // Apple binding; `safe_libc::fdatasync` declares it locally.
        check!(safe_libc::fdatasync(fd.native()), Tag::fdatasync);
        Ok(())
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
    pub fn recv(fd: Fd, buf: &mut [u8], flags: i32) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        // macOS: single `recvfrom$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let n = check_once!(
            // SAFETY: `fd` is a live socket; `buf` is valid for `len` writes.
            unsafe { sys_recv(fd.native(), buf.as_mut_ptr().cast(), len, flags) },
            Tag::recv
        );
        #[cfg(not(target_os = "macos"))]
        let n = check!(
            // SAFETY: `fd` is a live socket; `buf[..len]` is a valid exclusive
            // slice and `len <= buf.len()` (clamped above).
            unsafe { sys_recv(fd.native(), buf.as_mut_ptr().cast(), len, flags) },
            Tag::recv
        );
        Ok(n as usize)
    }
    pub fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize> {
        // `buf.len` is passed un-clamped (only `recv` clamps);
        // forward the full length and let the kernel decide.
        // macOS: single `sendto$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let n = check_once!(
            // SAFETY: `fd` is a live socket; `buf` is valid for `buf.len()` reads.
            unsafe { sys_send(fd.native(), buf.as_ptr().cast(), buf.len(), flags) },
            Tag::send
        );
        #[cfg(not(target_os = "macos"))]
        let n = check!(
            // SAFETY: `fd` is a live socket; `buf` is a valid shared slice of
            // `buf.len()` readable bytes.
            unsafe { sys_send(fd.native(), buf.as_ptr().cast(), buf.len(), flags) },
            Tag::send
        );
        Ok(n as usize)
    }
    pub fn recv_non_block(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
        recv(fd, buf, MSG_DONTWAIT)
    }
    /// `MSG_DONTWAIT | MSG_NOSIGNAL` so a broken-pipe write
    /// returns EPIPE instead of raising SIGPIPE.
    pub fn send_non_block(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        send(fd, buf, SEND_FLAGS_NONBLOCK)
    }
    #[cfg(unix)]
    pub const MSG_DONTWAIT: i32 = libc::MSG_DONTWAIT;
    // `MSG_DONTWAIT | MSG_NOSIGNAL` on all Unix including macOS
    // (Darwin defines MSG_NOSIGNAL=0x80000).
    #[cfg(unix)]
    pub const SEND_FLAGS_NONBLOCK: i32 = libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL;
    /// `fcntl(F_GETFD)` then OR in `FD_CLOEXEC`.
    pub fn set_close_on_exec(fd: Fd) -> Maybe<()> {
        let fl = fcntl(fd, libc::F_GETFD, 0)?;
        fcntl(fd, libc::F_SETFD, fl | libc::FD_CLOEXEC as isize)?;
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
        {
            let ty = ty | libc::SOCK_CLOEXEC | if nonblock { libc::SOCK_NONBLOCK } else { 0 };
            check!(
                safe_libc::socketpair(domain, ty, proto, &mut fds),
                Tag::socketpair
            );
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            check!(
                safe_libc::socketpair(domain, ty, proto, &mut fds),
                Tag::socketpair
            );
            let close_both = |e: Error| {
                safe_libc::close(fds[0]);
                safe_libc::close(fds[1]);
                Err::<[Fd; 2], _>(e)
            };
            // CLOEXEC first.
            for &fd in &fds {
                if let Err(e) = set_close_on_exec(Fd::from_native(fd)) {
                    return close_both(e);
                }
            }
            // Darwin: SO_NOSIGPIPE on both fds — unless `for_shell`, in which
            // case bump RCVBUF/SNDBUF instead.
            #[cfg(target_os = "macos")]
            {
                if for_shell {
                    let so_recvbuf: libc::c_int = 1024 * 128;
                    let so_sendbuf: libc::c_int = 1024 * 128;
                    // SAFETY: setsockopt on freshly-created socketpair fds.
                    unsafe {
                        libc::setsockopt(
                            fds[1],
                            libc::SOL_SOCKET,
                            libc::SO_RCVBUF,
                            core::ptr::from_ref::<i32>(&so_recvbuf).cast(),
                            core::mem::size_of::<i32>() as u32,
                        );
                        libc::setsockopt(
                            fds[0],
                            libc::SOL_SOCKET,
                            libc::SO_SNDBUF,
                            core::ptr::from_ref::<i32>(&so_sendbuf).cast(),
                            core::mem::size_of::<i32>() as u32,
                        );
                    }
                } else {
                    let on: libc::c_int = 1;
                    for &fd in &fds {
                        // SAFETY: setsockopt on freshly-created socketpair fds.
                        if unsafe {
                            libc::setsockopt(
                                fd,
                                libc::SOL_SOCKET,
                                libc::SO_NOSIGPIPE,
                                core::ptr::from_ref::<i32>(&on).cast(),
                                core::mem::size_of::<i32>() as u32,
                            )
                        } < 0
                        {
                            return close_both(Error::from_code_int(last_errno(), Tag::setsockopt));
                        }
                    }
                }
            }
            // O_NONBLOCK via GETFL→OR→SETFL (don't clobber existing flags).
            if nonblock {
                for &fd in &fds {
                    // SAFETY: `fd` is a live descriptor just returned by `socketpair`.
                    let fl = unsafe { libc::fcntl(fd, libc::F_GETFL) };
                    if fl < 0
                        // SAFETY: same `fd`; F_SETFL takes an integer arg, no pointers.
                        || unsafe { libc::fcntl(fd, libc::F_SETFL, fl | libc::O_NONBLOCK) } < 0
                    {
                        return close_both(Error::from_code_int(last_errno(), Tag::fcntl));
                    }
                }
            }
        }
        Ok([Fd::from_native(fds[0]), Fd::from_native(fds[1])])
    }

    /// `pidfd_open(2)` — Linux ≥ 5.3. Returns a pollable fd referring to `pid`.
    /// Callers fall back to the waiter-thread on `ENOSYS`/`EPERM`/`EACCES`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn pidfd_open(pid: libc::pid_t, flags: u32) -> Maybe<Fd> {
        super::linux_syscall::pidfd_open(pid, flags)
            .map_err(|e| Error::from_code_int(e, Tag::pidfd_open))
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
            // safe: by-value `c_int` fds + `u32` flags; bad fd → `EBADF`/
            // `EOPNOTSUPP`, never UB. `state` is `Option<NonNull<c_void>>`
            // (FFI-safe via the null-pointer niche → ABI-identical to a
            // nullable `copyfile_state_t`); Bun never allocates a state, so
            // every caller passes `None`.
            safe fn fcopyfile(
                from: i32,
                to: i32,
                state: Option<core::ptr::NonNull<core::ffi::c_void>>,
                flags: u32,
            ) -> i32;
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
                fcopyfile(from.native(), to.native(), None, flags),
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
    pub fn mmap(
        addr: *mut u8,
        len: usize,
        prot: i32,
        flags: i32,
        fd: Fd,
        off: i64,
    ) -> Maybe<*mut u8> {
        // SAFETY: `addr` is a hint (or null) that the kernel validates; `fd`/
        // `off`/`len` are validated by the kernel and never dereferenced here.
        let p = unsafe { libc::mmap(addr.cast(), len, prot, flags, fd.native(), off) };
        if p == libc::MAP_FAILED {
            return Err(err_with(Tag::mmap));
        }
        Ok(p.cast())
    }
    pub fn munmap(ptr: *mut u8, len: usize) -> Maybe<()> {
        // SAFETY: caller passes a `(ptr, len)` pair previously returned by
        // `mmap`; `munmap` only inspects the mapping, never Rust-owned memory.
        check!(unsafe { libc::munmap(ptr.cast(), len) }, Tag::munmap);
        Ok(())
    }

    /// `bun.sys.mmapFile` — open `path` RDWR, fstat for size, mmap [offset, offset+len).
    /// Returns `(map, delta)` where `map` is the full page-aligned mapping and
    /// `delta = offset % page_size` is the byte offset into `map` at which the
    /// requested `offset` begins. Caller is responsible for `munmap(map)`.
    pub fn mmap_file(
        path: &ZStr,
        flags: libc::c_int,
        wanted_size: Option<usize>,
        offset: usize,
    ) -> Maybe<(&'static mut [u8], usize)> {
        let fd = open(path, O::RDWR, 0)?;
        // close fd regardless of mmap outcome (the mapping outlives the fd).
        let _close = CloseOnDrop::new(fd);

        let stat_size = {
            let result = fstat(fd)?;
            usize::try_from(result.st_size).unwrap_or(0)
        };

        // mmap requires a page-aligned file offset. Map from the aligned
        // offset and report the delta so the caller can slice to the
        // requested byte.
        let page = bun_alloc::page_size();
        let delta = offset % page;
        let aligned_offset = offset - delta;

        let mut size = stat_size.saturating_sub(offset);
        if let Some(size_) = wanted_size {
            size = size.min(size_);
        }
        // When size == 0 (offset at/past EOF or size: 0) pass 0 so mmap
        // returns EINVAL instead of mapping the leading delta bytes.
        let map_len = if size == 0 { 0 } else { size + delta };

        match mmap(
            core::ptr::null_mut(),
            map_len,
            libc::PROT_READ | libc::PROT_WRITE,
            flags,
            fd,
            aligned_offset as i64,
        ) {
            Ok(ptr) => {
                // SAFETY: mmap returned a valid mapping of `map_len` bytes.
                Ok((
                    unsafe { core::slice::from_raw_parts_mut(ptr, map_len) },
                    delta,
                ))
            }
            Err(err) => Err(err),
        }
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

    /// `bun.sys.canUseMemfd()` — false on non-Linux; on Linux, false when
    /// `BUN_FEATURE_FLAG_DISABLE_MEMFD` is set or once `memfd_create` has
    /// returned ENOSYS/EPERM/EACCES.
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
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    #[inline]
    pub fn can_use_memfd() -> bool {
        false
    }

    /// `bun.sys.memfd_create(name, flags)` — Linux only.
    /// Retries on EINTR; on EINVAL retries once with the pre-6.3 flag set
    /// (drops `MFD_EXEC`/`MFD_NOEXEC_SEAL`); on ENOSYS/EPERM/EACCES latches
    /// [`can_use_memfd`] to false.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn memfd_create(name: &core::ffi::CStr, flags_: MemfdFlags) -> Maybe<Fd> {
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
            return Ok(Fd::from_native(rc));
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
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    pub fn sendfile(src: Fd, _dest: Fd, _len: usize) -> Maybe<usize> {
        // Attach the *source* fd.
        Err(Error::from_code_int(libc::ENOSYS, Tag::sendfile).with_fd(src))
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
    pub fn to_timespec(self) -> libc::timespec {
        libc::timespec {
            tv_sec: self.sec as _,
            tv_nsec: self.nsec as _,
        }
    }
}
#[cfg(unix)]
pub const UTIME_NOW: i64 = libc::UTIME_NOW;
#[cfg(unix)]
pub const UTIME_OMIT: i64 = libc::UTIME_OMIT;
#[cfg(windows)]
pub const UTIME_NOW: i64 = -1;
#[cfg(windows)]
pub const UTIME_OMIT: i64 = -2;

#[cfg(windows)]
#[path = "sys_uv.rs"]
pub mod sys_uv;

/// On non-Windows, `sys_uv` is just an alias for the regular syscall surface so
/// callers (e.g. `pack_command`) can write `bun_sys::sys_uv::fstat(fd)` portably.
#[cfg(not(windows))]
pub mod sys_uv {
    pub use super::{
        close, fstat, lstat, mkdir, open, pread, pwrite, read, rename, stat, unlink, write,
    };
}

#[cfg(windows)]
mod windows_impl {
    // NT/kernel32/libuv triad. The libuv-backed ops
    // delegate to `crate::sys_uv`; the rest call NT/kernel32 directly.
    use super::windows as w;
    use super::windows::libuv as uv;
    use super::*;
    use bun_paths::WPathBuffer;

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
    pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
        // libuv for uv-kind fds, kernel32 `ReadFile` otherwise. The libuv path
        // requires a CRT fd via `fd.uv()`, which PANICS for HANDLE-backed
        // (`FdKind::System`) Fds — i.e. anything from `openat()`/NtCreateFile.
        if fd.kind() == FdKind::Uv {
            return sys_uv::read(fd, buf);
        }
        let adjusted_len = buf.len().min(MAX_COUNT) as w::DWORD;
        // Stdin callers route through this function (via
        // `File::stdin().read_to_end_into` / `output_sink().read`), so the
        // BROKEN_PIPE/HANDLE_EOF → 0 (EOF) mapping and the OPERATION_ABORTED
        // retry live here.
        loop {
            let mut amount_read: w::DWORD = 0;
            // SAFETY: FFI; `fd.cast()` is a valid HANDLE, buf valid for `adjusted_len`.
            let rc = unsafe {
                w::kernel32::ReadFile(
                    fd.native(),
                    buf.as_mut_ptr(),
                    adjusted_len,
                    &mut amount_read,
                    core::ptr::null_mut(),
                )
            };
            if rc == 0 {
                let er = w::Win32Error::get();
                match er {
                    w::Win32Error::BROKEN_PIPE | w::Win32Error::HANDLE_EOF => return Ok(0),
                    w::Win32Error::OPERATION_ABORTED => continue,
                    _ => return Err(Error::new(er.to_e(), Tag::read).with_fd(fd)),
                }
            }
            return Ok(amount_read as usize);
        }
    }
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        // kernel32 `WriteFile` directly
        // (NOT via libuv — sys_uv::write → fd.uv() panics for HANDLE-backed
        // Fds). Also remaps `ERROR_ACCESS_DENIED → EBADF` (a write to a
        // read-only-opened HANDLE yields ACCESS_DENIED, which POSIX surfaces
        // as EBADF "fd not open for writing").
        debug_assert!(!buf.is_empty());
        let adjusted_len = buf.len().min(MAX_COUNT) as w::DWORD;
        let mut bytes_written: w::DWORD = 0;
        // SAFETY: FFI; `fd.cast()` is a valid HANDLE, buf valid for `adjusted_len`.
        let rc = unsafe {
            w::kernel32::WriteFile(
                fd.native(),
                buf.as_ptr(),
                adjusted_len,
                &mut bytes_written,
                core::ptr::null_mut(),
            )
        };
        if rc == 0 {
            let er = w::Win32Error::get();
            let errno = if er == w::Win32Error::ACCESS_DENIED {
                E::EBADF
            } else {
                er.to_e()
            };
            return Err(Error::new(errno, Tag::write).with_fd(fd));
        }
        Ok(bytes_written as usize)
    }
    pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize> {
        // Positioned-I/O lowering:
        // libuv path for uv-kind fds, kernel32 ReadFile+OVERLAPPED for system
        // (HANDLE) fds.
        if fd.kind() == FdKind::Uv {
            return sys_uv::pread(fd, buf, off);
        }
        let off = off as u64;
        let adjusted_len = buf.len().min(MAX_COUNT) as w::DWORD;
        loop {
            let mut overlapped = w::OVERLAPPED {
                Internal: 0,
                InternalHigh: 0,
                Offset: off as w::DWORD,
                OffsetHigh: (off >> 32) as w::DWORD,
                hEvent: core::ptr::null_mut(),
            };
            let mut amount_read: w::DWORD = 0;
            // SAFETY: FFI; `fd.cast()` is a valid HANDLE for the System-kind
            // arm, `buf` valid for `adjusted_len`, `overlapped` lives for the
            // synchronous call (handle was not opened FILE_FLAG_OVERLAPPED).
            let rc = unsafe {
                w::kernel32::ReadFile(
                    fd.native(),
                    buf.as_mut_ptr(),
                    adjusted_len,
                    &mut amount_read,
                    core::ptr::from_mut(&mut overlapped).cast(),
                )
            };
            if rc == 0 {
                let er = w::Win32Error::get();
                match er {
                    // BROKEN_PIPE/HANDLE_EOF map to EOF (0 bytes read).
                    w::Win32Error::BROKEN_PIPE | w::Win32Error::HANDLE_EOF => return Ok(0),
                    w::Win32Error::OPERATION_ABORTED => continue,
                    _ => return Err(Error::new(er.to_e(), Tag::pread).with_fd(fd)),
                }
            }
            return Ok(amount_read as usize);
        }
    }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
        // Same lowering as `pread`: kernel32 WriteFile with an
        // `OVERLAPPED.Offset` for HANDLE-kind fds.
        if fd.kind() == FdKind::Uv {
            return sys_uv::pwrite(fd, buf, off);
        }
        let off = off as u64;
        let adjusted_len = buf.len().min(MAX_COUNT) as w::DWORD;
        let mut overlapped = w::OVERLAPPED {
            Internal: 0,
            InternalHigh: 0,
            Offset: off as w::DWORD,
            OffsetHigh: (off >> 32) as w::DWORD,
            hEvent: core::ptr::null_mut(),
        };
        let mut bytes_written: w::DWORD = 0;
        // SAFETY: FFI; `fd.cast()` is a valid HANDLE for the System-kind arm,
        // `buf` valid for `adjusted_len`, `overlapped` lives for the
        // synchronous call (handle was not opened FILE_FLAG_OVERLAPPED).
        let rc = unsafe {
            w::kernel32::WriteFile(
                fd.native(),
                buf.as_ptr(),
                adjusted_len,
                &mut bytes_written,
                core::ptr::from_mut(&mut overlapped).cast(),
            )
        };
        if rc == 0 {
            let er = w::Win32Error::get();
            // Keep parity with `write()` above and surface the raw errno
            // (no INVALID_HANDLE → NotOpenForWriting remapping).
            let errno = if er == w::Win32Error::ACCESS_DENIED {
                E::EBADF
            } else {
                er.to_e()
            };
            return Err(Error::new(errno, Tag::pwrite).with_fd(fd));
        }
        Ok(bytes_written as usize)
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
        let nt_err = |rc: w::NTSTATUS| {
            Error::new(w::translate_nt_status_to_errno(rc), Tag::fstat).with_fd(fd)
        };
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
        sys_uv::readlink(path, buf).map(|s| s.len())
    }
    pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
        sys_uv::fchmod(fd, mode)
    }
    pub fn fchown(fd: Fd, uid: u32, gid: u32) -> Maybe<()> {
        sys_uv::fchown(fd, uid as _, gid as _)
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
            // `errnoSys` for `NTSTATUS` routes through the curated
            // `translateNTStatusToErrno` table first, then falls back to
            // `RtlNtStatusToDosError` for unmapped codes.
            let errno = w::translate_nt_status_to_errno(rc);
            return Err(Error::new(errno, Tag::ftruncate).with_fd(fd));
        }
        Ok(())
    }
    pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        sys_uv::chmod(path, mode)
    }
    pub fn chown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        sys_uv::chown(path, uid as _, gid as _)
    }
    pub fn link(src: &ZStr, dest: &ZStr) -> Maybe<()> {
        sys_uv::link(src, dest)
    }
    pub fn fsync(fd: Fd) -> Maybe<()> {
        sys_uv::fsync(fd)
    }
    pub fn fdatasync(fd: Fd) -> Maybe<()> {
        sys_uv::fdatasync(fd)
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
                w::TRUE,
                w::DUPLICATE_SAME_ACCESS,
            )
        };
        if out == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::dup).with_fd(fd));
        }
        Ok(Fd::from_native(target as _))
    }
    pub fn dup2(old: Fd, new: Fd) -> Maybe<Fd> {
        // No POSIX dup2 on Windows.
        // Return ENOTSUP so callers that branch on platform fall back.
        let _ = (old, new);
        Err(Error::new(E::ENOTSUP, Tag::dup2))
    }
    pub fn getcwd(buf: &mut [u8]) -> Maybe<usize> {
        // GetCurrentDirectoryW + WTF16→UTF8.
        let mut wbuf = WPathBuffer::default();
        let len =
            unsafe { w::kernel32::GetCurrentDirectoryW(wbuf.len() as u32, wbuf.as_mut_ptr()) };
        if len == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::getcwd));
        }
        // MSDN: when `nBufferLength` is too small `GetCurrentDirectoryW`
        // returns the *required* size (incl. NUL), which can exceed
        // `wbuf.len()` under long-path opt-in. Guard so the slice below
        // surfaces ENAMETOOLONG instead of panicking on OOB.
        if len as usize > wbuf.len() {
            return Err(Error::new(E::ENAMETOOLONG, Tag::getcwd));
        }
        let utf8 = bun_paths::string_paths::from_w_path(buf, &wbuf[..len as usize]);
        Ok(utf8.len())
    }
    pub fn mkdirat(dir: impl AsFd, path: &ZStr, _mode: Mode) -> Maybe<()> {
        let dir = dir.as_fd();
        // Open with `op = OnlyCreate`, then close the resulting handle on
        // success.
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_paths::string_paths::to_nt_path(&mut wbuf, path.as_bytes());
        let made = super::open_dir_at_windows_nt_path(
            dir,
            wpath,
            super::WindowsOpenDirOptions {
                iterable: false,
                can_rename_or_delete: true,
                op: super::WindowsOpenDirOp::OnlyCreate,
                ..Default::default()
            },
        )?;
        made.close();
        Ok(())
    }
    pub fn renameat(from_dir: impl AsFd, from: &ZStr, to_dir: impl AsFd, to: &ZStr) -> Maybe<()> {
        let from_dir = from_dir.as_fd();
        let to_dir = to_dir.as_fd();
        let mut wf = WPathBuffer::default();
        let mut wt = WPathBuffer::default();
        let from_w = bun_paths::string_paths::to_nt_path(&mut wf, from.as_bytes());
        let to_w = bun_paths::string_paths::to_nt_path(&mut wt, to.as_bytes());
        super::windows::rename_at_w(from_dir, from_w, to_dir, to_w, true)
    }
    pub fn renameat2(
        from_dir: Fd,
        from: &ZStr,
        to_dir: Fd,
        to: &ZStr,
        flags: Renameat2Flags,
    ) -> Maybe<()> {
        // `renameat2` collapses to `renameat` on windows; the
        // `noreplace`/`exchange` flags are not honored by NTFS rename.
        let _ = flags;
        renameat(from_dir, from, to_dir, to)
    }
    pub fn unlinkat_with_flags(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()> {
        // Convert to NT path and call `DeleteFileBun`;
        // `remove_dir = flags & AT_REMOVEDIR != 0`.
        // AT_REMOVEDIR on Windows = 0x200.
        const AT_REMOVEDIR: i32 = 0x200;
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_paths::string_paths::to_nt_path(&mut wbuf, path.as_bytes());
        super::windows::DeleteFileBun(
            wpath,
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
    pub fn mkdir_recursive_at(dir: impl AsFd, sub: &[u8]) -> Maybe<()> {
        let dir = dir.as_fd();
        mkdir_recursive_at_mode(dir, sub, 0o777)
    }
    pub fn mkdir_recursive_at_mode(dir: Fd, sub: &[u8], mode: Mode) -> Maybe<()> {
        // `bun.makePath`. The component-splitting and
        // back-then-forward walk live in `bun_paths::{ComponentIterator,
        // make_path_with}` (`ComponentIterator`
        // never yields a bare `"C:"` / `"\\server\share"` root, which is what
        // broke the old forward-split impl for absolute paths fed by
        // `bin::Linker::create_windows_shim`).
        //
        // What stays here is a `.`/`..` *pre-normalize* pass: our `mkdirat` below routes
        // through bun's `to_nt_path` which only flips slashes, so a literal
        // `"."`/`".."` ObjectName reaches `NtCreateFile` un-normalized — `.`
        // → `OBJECT_NAME_NOT_FOUND` (ENOENT, not the EEXIST the walk expects)
        // and `a\..\b` live-locks the walk. Normalizing here preserves the
        // expected behavior (compile-outfile-subdirs.test.ts
        // "works with . and .. in paths", outfile
        // `./output/../output/./app.exe`).
        use bun_paths::{ComponentIterator, MakePathStep, PathFormat, is_sep_any as is_sep};
        if sub.is_empty() {
            return Ok(());
        }
        // Strip leading `./` (`.\`) and a bare `.` (bundler chunk paths are
        // always `./<name>` — see `linker_context::writeOutputFilesToDisk`).
        let mut sub = sub;
        while sub.len() >= 2 && sub[0] == b'.' && is_sep(sub[1]) {
            sub = &sub[2..];
            while !sub.is_empty() && is_sep(sub[0]) {
                sub = &sub[1..];
            }
        }
        if sub.is_empty() || sub == b"." {
            return Ok(());
        }
        let mut buf = bun_core::PathBuffer::default();
        if sub.len() >= buf.0.len() {
            return Err(Error::new(E::ENAMETOOLONG, Tag::mkdir));
        }

        // Disk designator (`C:` / `C:\` / `\\server\share\`) is copied verbatim
        // and never popped by `..`.
        let root_end = bun_paths::resolve_path::windows_filesystem_root(sub).len();
        buf.0[..root_end].copy_from_slice(&sub[..root_end]);
        let mut w = root_end; // write cursor into buf
        // Bytes in `buf[root_end..pinned_end]` are leading `..` segments that
        // had nothing to pop (relative paths only) — a later `..` must not pop
        // them (`removeDotDirsSanitized` keeps them too).
        let mut pinned_end = root_end;
        {
            let mut i = root_end;
            loop {
                while i < sub.len() && is_sep(sub[i]) {
                    i += 1;
                }
                if i >= sub.len() {
                    break;
                }
                let start = i;
                while i < sub.len() && !is_sep(sub[i]) {
                    i += 1;
                }
                let comp = &sub[start..i];
                if comp == b"." {
                    continue;
                }
                if comp == b".." {
                    if w > pinned_end {
                        // Pop the last written component (single-`\`-separated,
                        // so a back-scan to the previous `\` is exact).
                        while w > pinned_end && buf.0[w - 1] != b'\\' {
                            w -= 1;
                        }
                        if w > pinned_end {
                            w -= 1;
                        } // drop the separator too
                        continue;
                    }
                    if root_end > 0 {
                        continue;
                    } // absolute: `..` at root is root
                    // Relative with nothing to pop: keep `..` literally so
                    // `mkdirat(dir, "..\foo")` still targets `dir`'s parent.
                    if w > root_end {
                        buf.0[w] = b'\\';
                        w += 1;
                    }
                    buf.0[w] = b'.';
                    buf.0[w + 1] = b'.';
                    w += 2;
                    pinned_end = w;
                    continue;
                }
                if w > root_end {
                    buf.0[w] = b'\\';
                    w += 1;
                }
                buf.0[w..w + comp.len()].copy_from_slice(comp);
                w += comp.len();
            }
        }
        if w == root_end {
            return Ok(());
        } // fully cancelled (e.g. `a/..`)

        // Walk the normalized result. `ComponentIterator::init(.windows)` only
        // errors on namespace-prefixed / `\\\x` inputs — pathological for
        // makePath (NtCreateFile rejects them anyway).
        let it = ComponentIterator::init(&buf.0[..w], PathFormat::Windows)
            .map_err(|_| Error::new(E::EINVAL, Tag::mkdir))?;
        let mut z = bun_core::PathBuffer::default();
        bun_paths::make_path_with(it, |p| {
            z.0[..p.len()].copy_from_slice(p);
            z.0[p.len()] = 0;
            match mkdirat(dir, ZStr::from_buf(&z.0[..], p.len()), mode) {
                Ok(()) => Ok(MakePathStep::Created),
                Err(e) if e.get_errno() == E::EEXIST => Ok(MakePathStep::Exists),
                Err(e) if e.get_errno() == E::ENOENT => Ok(MakePathStep::NotFound(e)),
                Err(e) => Err(e),
            }
        })
    }
    pub fn linkat(src_dir: impl AsFd, src: &ZStr, dest_dir: impl AsFd, dest: &ZStr) -> Maybe<()> {
        let src_dir = src_dir.as_fd();
        let dest_dir = dest_dir.as_fd();
        // No native `linkat` on Windows — resolve to absolute and CreateHardLinkW.
        let mut sb = bun_core::PathBuffer::default();
        let mut db = bun_core::PathBuffer::default();
        let s = super::get_fd_path(src_dir, &mut sb)?;
        let d = super::get_fd_path(dest_dir, &mut db)?;
        let mut sj = bun_core::PathBuffer::default();
        let mut dj = bun_core::PathBuffer::default();
        let s_abs = bun_paths::resolve_path::join_string_buf_z::<bun_paths::platform::Windows>(
            &mut sj.0,
            &[s, src.as_bytes()],
        );
        let d_abs = bun_paths::resolve_path::join_string_buf_z::<bun_paths::platform::Windows>(
            &mut dj.0,
            &[d, dest.as_bytes()],
        );
        link(s_abs, d_abs)
    }
    pub fn linkat_tmpfile(_tmpfd: Fd, _dirfd: Fd, _name: &ZStr) -> Maybe<()> {
        Err(Error::new(E::ENOTSUP, Tag::link))
    }
    pub fn symlinkat(target: &ZStr, dirfd: impl AsFd, dest: &ZStr) -> Maybe<()> {
        let dirfd = dirfd.as_fd();
        // Resolve `dest` against `dirfd`, then symlink via libuv.
        let mut db = bun_core::PathBuffer::default();
        let d = super::get_fd_path(dirfd, &mut db)?;
        let mut dj = bun_core::PathBuffer::default();
        let d_abs = bun_paths::resolve_path::join_string_buf_z::<bun_paths::platform::Windows>(
            &mut dj.0,
            &[d, dest.as_bytes()],
        );
        sys_uv::symlink_uv(target, d_abs, 0)
    }
    pub fn readlinkat(fd: impl AsFd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let fd = fd.as_fd();
        // No `readlinkat` on Windows — resolve and call `readlink`.
        let mut db = bun_core::PathBuffer::default();
        let d = super::get_fd_path(fd, &mut db)?;
        let mut dj = bun_core::PathBuffer::default();
        let abs = bun_paths::resolve_path::join_string_buf_z::<bun_paths::platform::Windows>(
            &mut dj.0,
            &[d, path.as_bytes()],
        );
        readlink(abs, buf)
    }
    pub fn fchmodat(dir: impl AsFd, path: &ZStr, mode: Mode, _flags: i32) -> Maybe<()> {
        let dir = dir.as_fd();
        let mut db = bun_core::PathBuffer::default();
        let d = super::get_fd_path(dir, &mut db)?;
        let mut dj = bun_core::PathBuffer::default();
        let abs = bun_paths::resolve_path::join_string_buf_z::<bun_paths::platform::Windows>(
            &mut dj.0,
            &[d, path.as_bytes()],
        );
        chmod(abs, mode)
    }
    pub fn lchmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        // Windows has no lchmod; libuv chmod follows symlinks. Match Node: fall through.
        chmod(path, mode)
    }
    pub fn lchown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        // Windows has no ownership model; libuv uv_fs_lchown is a no-op success.
        sys_uv::lchown(path, uid as _, gid as _)
    }
    pub fn fstatat(fd: impl AsFd, path: &ZStr) -> Maybe<Stat> {
        let fd = fd.as_fd();
        // `openat(fd, path, 0, 0)` (flags=0
        // → FOLLOWS reparse points) then `fstat(file)`. Do NOT use `lstat` here —
        // that's the `lstatat` no-follow variant.
        let file = openat(fd, path, 0, 0)?;
        let r = fstat(file);
        let _ = close(file);
        r
    }
    pub fn access(path: &ZStr, mode: i32) -> Maybe<()> {
        // GetFileAttributesW, then if
        // `(mode & W_OK) != 0` AND the file is read-only AND it is NOT a
        // directory, return `.err = EPERM`.
        const W_OK: i32 = 2;
        // Longer than any path NT can address — reject up front instead of
        // letting the wide conversion below fail-safe to a prefix-only path
        // (mirrors `PathLikeExt`; see oven-sh/bun#27775,
        // which handled `access` as one of its call sites). `path` may
        // already carry a `\\?\` prefix (NodeFS::access routes through
        // `slice_z`, which prepends it) — check the unprefixed form so the
        // fit budget doesn't count the prefix twice and over-reject paths
        // just under the limit.
        if !bun_paths::string_paths::fits_in_wide_path_buffer(
            bun_paths::string_paths::without_nt_prefix(path.as_bytes()),
        ) {
            return Err(Error::new(E::ENAMETOOLONG, Tag::access).with_path(path.as_bytes()));
        }
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_paths::string_paths::to_kernel32_path(&mut wbuf, path.as_bytes());
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
    pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        // `uv_fs_futime` takes a CRT fd (`fd.uv()` PANICS for HANDLE-backed
        // `FdKind::System` fds); `SetFileTime` operates on the HANDLE
        // directly. `fd.native()` yields the HANDLE for both kinds.
        let a = w::timespec_to_filetime(atime);
        let m = w::timespec_to_filetime(mtime);
        // SAFETY: FFI; `fd.native()` is a valid HANDLE, `a`/`m` valid for read.
        let rc = unsafe { w::kernel32::SetFileTime(fd.native(), core::ptr::null(), &a, &m) };
        if rc == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::futimens).with_fd(fd));
        }
        Ok(())
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
        // uv_fs_utime runs fs__capture_path which
        // uv__malloc's the WTF-16 path into the req even for sync (cb=NULL)
        // calls; only uv_fs_req_cleanup frees it. fs_t has no Drop impl, so
        // call it explicitly before any return.
        req.deinit();
        if let Some(err) = Error::from_uv_rc(rc, Tag::utime) {
            return Err(err.with_path(path.as_bytes()));
        }
        Ok(())
    }
    pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let a = atime.sec as f64 + atime.nsec as f64 / 1e9;
        let m = mtime.sec as f64 + mtime.nsec as f64 / 1e9;
        let mut req = uv::fs_t::uninitialized();
        let rc = unsafe {
            uv::uv_fs_lutime(
                core::ptr::null_mut(),
                &mut req,
                path.as_ptr().cast::<_>(),
                a,
                m,
                None,
            )
        };
        // Same fs__capture_path leak as utimens.
        req.deinit();
        if let Some(err) = Error::from_uv_rc(rc, Tag::lutime) {
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
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_paths::string_paths::to_w_path(&mut wbuf, path.as_bytes());
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
            return Err(Error::new(w::get_last_errno(), Tag::fstat).with_fd(fd));
        }
        // Clamp defensively so a
        // negative LARGE_INTEGER never becomes ~18 EB after the i64→u64 cast.
        Ok(size.max(0) as u64)
    }
    pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Maybe<&'a [u8]> {
        // sys_uv.rs:216 — open + GetFinalPathNameByHandle (uv_fs_realpath edge cases).
        let fd = open(path, O::RDONLY, 0)?;
        let r = super::get_fd_path(fd, buf);
        let _ = close(fd);
        // get_fd_path yields `&mut [u8]`; coerce to shared.
        r.map(|s| &*s)
    }
    pub fn fcntl(_fd: Fd, _cmd: i32, _arg: isize) -> Maybe<isize> {
        Err(Error::new(E::ENOTSUP, Tag::fcntl))
    }
    pub fn pipe() -> Maybe<[Fd; 2]> {
        // uv_pipe(fds, 0, 0).
        let mut fds: [uv::uv_file; 2] = [-1, -1];
        let rc = unsafe { uv::uv_pipe(&mut fds, 0, 0) };
        if let Some(err) = Error::from_uv_rc(rc, Tag::pipe) {
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
            return Err(Error::new(w::get_last_errno(), Tag::lseek).with_fd(fd));
        }
        Ok(new)
    }
    /// `SetFilePointerEx(.., FILE_END)`
    /// returning the new offset as `usize`.
    pub fn set_file_offset_to_end_windows(fd: Fd) -> Maybe<usize> {
        let mut new: i64 = 0;
        // SAFETY: `fd` is a valid kernel handle (caller invariant).
        let ok = unsafe { w::SetFilePointerEx(fd.native() as w::HANDLE, 0, &mut new, w::FILE_END) };
        if ok == w::FALSE {
            return Err(Error::new(w::get_last_errno(), Tag::lseek).with_fd(fd));
        }
        Ok(usize::try_from(new).expect("int cast"))
    }
    pub fn chdir(path: &ZStr) -> Maybe<()> {
        // `SetCurrentDirectoryW(toWDirPath(..))`.
        // `toWDirPath` appends a trailing backslash so e.g. `"C:"` is treated
        // as the drive root, not the drive's saved cwd.
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_paths::string_paths::to_w_dir_path(&mut wbuf, path.as_bytes());
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
        chdir(ZStr::from_buf(&zb.0[..], p.len()))
    }
    pub fn umask(mode: Mode) -> Mode {
        unsafe extern "C" {
            safe fn _umask(m: core::ffi::c_int) -> core::ffi::c_int;
        }
        _umask(mode as core::ffi::c_int) as Mode
    }
    pub fn recv(fd: Fd, buf: &mut [u8], flags: i32) -> Maybe<usize> {
        // Winsock `recv`. Winsock's `len` is a
        // signed `int`, so clamp to `i32::MAX` (NOT `MAX_COUNT == u32::MAX`)
        // before the `usize → i32` cast — otherwise ≥2 GiB buffers wrap to a
        // negative length and Winsock fails with WSAEFAULT.
        let len = buf.len().min(i32::MAX as usize) as i32;
        let rc =
            unsafe { w::ws2_32::recv(fd.native() as _, buf.as_mut_ptr().cast::<_>(), len, flags) };
        if rc < 0 {
            return Err(
                Error::new(w::WSAGetLastError().unwrap_or(E::EUNKNOWN), Tag::recv).with_fd(fd),
            );
        }
        Ok(rc as usize)
    }
    pub fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize> {
        // Winsock `send`. Clamp to `i32::MAX` so the
        // `usize → i32` cast can't wrap to a negative length on huge buffers.
        let len = buf.len().min(i32::MAX as usize) as i32;
        let rc = unsafe { w::ws2_32::send(fd.native() as _, buf.as_ptr().cast::<_>(), len, flags) };
        if rc < 0 {
            return Err(
                Error::new(w::WSAGetLastError().unwrap_or(E::EUNKNOWN), Tag::send).with_fd(fd),
            );
        }
        Ok(rc as usize)
    }
    pub fn recv_non_block(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
        recv(fd, buf, 0)
    }
    pub fn send_non_block(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        send(fd, buf, 0)
    }
    pub fn socketpair(_domain: i32, _ty: i32, _proto: i32, _nonblock: bool) -> Maybe<[Fd; 2]> {
        // Use spawnIPCSocket on Windows instead.
        Err(Error::new(E::ENOTSUP, Tag::socketpair))
    }
    pub fn mmap(
        _addr: *mut u8,
        _len: usize,
        _prot: i32,
        _flags: i32,
        _fd: Fd,
        _off: i64,
    ) -> Maybe<*mut u8> {
        Err(Error::new(E::ENOTSUP, Tag::mmap))
    }
    pub fn munmap(_ptr: *mut u8, _len: usize) -> Maybe<()> {
        Err(Error::new(E::ENOTSUP, Tag::munmap))
    }
    pub fn sendfile(src: Fd, _dest: Fd, _len: usize) -> Maybe<usize> {
        // `bun.sys.sendfile` is Linux-only
        // (`sendfile(2)` with a *null* offset so the kernel advances
        // the source fd's file position). An earlier implementation called
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

/// Shared inner loop for `read_to_end_into` / `read_to_end_with_array_list`:
/// repeatedly reserve `grow_by` when full, hand the spare capacity to
/// `read_chunk(dst, running_offset)`, and grow `len` by the result until
/// `read_chunk` returns 0. Returns total bytes appended.
#[inline]
fn read_fill_vec(
    buf: &mut Vec<u8>,
    grow_by: usize,
    mut read_chunk: impl FnMut(&mut [u8], i64) -> Maybe<usize>,
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
        // SAFETY: `read_chunk` writes initialized bytes; we commit exactly what was written.
        let n = read_chunk(unsafe { bun_core::vec::spare_bytes_mut(buf) }, total)?;
        if n == 0 {
            return Ok(buf.len() - start);
        }
        // SAFETY: `n` bytes were just initialized by `read_chunk`.
        unsafe { bun_core::vec::commit_spare(buf, n) };
        total += n as i64;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.PlatformIOVecConst` / `bun.platformIOVecConstCreate` — POSIX
// `iovec_const` (= `struct iovec` with the writev contract that `base` is
// not written through). On Windows this aliases `uv_buf_t`;
// that arm lives in `windows_impl` below.
// Layout matches `libc::iovec` (`{ *void, usize }`) so a `&[PlatformIoVecConst]`
// can be passed straight to `pwritev(2)`.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(unix)]
#[repr(C)]
#[derive(Clone, Copy)]
pub struct PlatformIoVecConst {
    pub base: *const u8,
    pub len: usize,
}
// SAFETY: `{ *const u8, usize }` — `(null, 0)` is a valid empty iovec (S021).
#[cfg(unix)]
unsafe impl bun_core::ffi::Zeroable for PlatformIoVecConst {}
#[cfg(unix)]
const _: () = assert!(
    core::mem::size_of::<PlatformIoVecConst>() == core::mem::size_of::<libc::iovec>()
        && core::mem::align_of::<PlatformIoVecConst>() == core::mem::align_of::<libc::iovec>()
);

#[cfg(unix)]
#[inline]
pub fn platform_iovec_const_create(buf: &[u8]) -> PlatformIoVecConst {
    PlatformIoVecConst {
        base: buf.as_ptr(),
        len: buf.len(),
    }
}

/// `bun.sys.pwritev` — gather-write at `offset`. Returns bytes written
/// (may be less than the sum of `vecs` lengths on a short write).
pub fn pwritev(fd: Fd, vecs: &[PlatformIoVecConst], offset: i64) -> Maybe<usize> {
    #[cfg(unix)]
    {
        // SAFETY: `PlatformIoVecConst` is layout-compatible with `libc::iovec`
        // (asserted above); `pwritev(2)` only reads through `iov_base`.
        // Darwin uses `pwritev$NOCANCEL` (avoid cancellation point).
        #[cfg(target_os = "macos")]
        {
            // macOS: single `pwritev$NOCANCEL`, no
            // EINTR retry (surfaces EINTR to caller).
            // SAFETY: `fd` is a live descriptor; `vecs` gives an exact
            // (ptr, len) pair of layout-compatible iovecs (asserted above).
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
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: `PlatformIoVecConst` is layout-identical to `libc::iovec`.
            return unsafe {
                linux_syscall::pwritev(fd, vecs.as_ptr().cast::<libc::iovec>(), vecs.len(), offset)
            }
            .map_err(|e| Error::from_code_int(e, Tag::pwritev));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
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
                if e == libc::EINTR {
                    continue;
                }
                return Err(Error::from_code_int(e, Tag::pwritev));
            }
            return Ok(rc as usize);
        }
    }
    #[cfg(windows)]
    {
        // `PlatformIoVecConst` is layout-identical to `uv_buf_t` on Windows
        // (asserted below), so the slice forwards as-is.
        sys_uv::pwritev(fd, vecs, offset)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.PlatformIOVec` — mutable iovec (`{ *void, usize }` on POSIX,
// `uv_buf_t` on Windows). Layout-compatible with `libc::iovec` so a
// `&[PlatformIoVec]` can be passed straight to `readv(2)`/`writev(2)`.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(unix)]
pub type PlatformIoVec = libc::iovec;
#[cfg(windows)]
pub type PlatformIoVec = bun_libuv_sys::uv_buf_t;
// Both casings of `PlatformIOVec` / `PlatformIOVecConst` are provided so
// existing call sites (`sys_uv.rs`) compile without churn.
pub use PlatformIoVec as PlatformIOVec;
pub use PlatformIoVecConst as PlatformIOVecConst;

#[inline]
pub fn platform_iovec_create(buf: &mut [u8]) -> PlatformIoVec {
    #[cfg(unix)]
    {
        PlatformIoVec {
            iov_base: buf.as_mut_ptr().cast(),
            iov_len: buf.len(),
        }
    }
    #[cfg(windows)]
    {
        // `uv_buf_t` on Windows is `{ ULONG len; char* base; }` — order-swapped vs
        // POSIX iovec.
        PlatformIoVec {
            len: buf.len() as bun_libuv_sys::ULONG,
            base: buf.as_mut_ptr(),
        }
    }
}

#[inline]
pub const fn platform_iovec_len(iov: &PlatformIoVec) -> usize {
    #[cfg(unix)]
    {
        iov.iov_len
    }
    #[cfg(windows)]
    {
        iov.len as usize
    }
}

/// Windows `PlatformIOVecConst` — same `uv_buf_t` layout (libuv has no
/// const-buf type), with `base` typed `*const u8` so callers can build it
/// from `&[u8]` without casts.
#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
pub struct PlatformIoVecConst {
    pub len: bun_libuv_sys::ULONG,
    pub base: *const u8,
}
// SAFETY: `{ ULONG, *const u8 }` — `(0, null)` is a valid empty `uv_buf_t` (S021).
#[cfg(windows)]
unsafe impl bun_core::ffi::Zeroable for PlatformIoVecConst {}
#[cfg(windows)]
const _: () = assert!(
    core::mem::size_of::<PlatformIoVecConst>() == core::mem::size_of::<bun_libuv_sys::uv_buf_t>()
        && core::mem::align_of::<PlatformIoVecConst>()
            == core::mem::align_of::<bun_libuv_sys::uv_buf_t>()
);
#[cfg(windows)]
#[inline]
pub fn platform_iovec_const_create(buf: &[u8]) -> PlatformIoVecConst {
    PlatformIoVecConst {
        len: buf.len() as bun_libuv_sys::ULONG,
        base: buf.as_ptr(),
    }
}

/// `bun.sys.writev` — gather-write. macOS uses `writev$NOCANCEL` with no
/// EINTR retry; other POSIX retries on EINTR.
pub fn writev(fd: Fd, vecs: &[PlatformIoVec]) -> Maybe<usize> {
    #[cfg(unix)]
    {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: `PlatformIoVec` is `libc::iovec`; writev(2) only reads
            // the descriptor table. Single shot, surfaces EINTR.
            let rc = unsafe {
                nocancel::writev(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int)
            };
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), Tag::writev).with_fd(fd));
            }
            return Ok(rc as usize);
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: `PlatformIoVec` is `libc::iovec`.
            return unsafe { linux_syscall::writev(fd, vecs.as_ptr(), vecs.len()) }
                .map_err(|e| Error::from_code_int(e, Tag::writev).with_fd(fd));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
        loop {
            // SAFETY: see above.
            let rc =
                unsafe { libc::writev(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR {
                    continue;
                }
                return Err(Error::from_code_int(e, Tag::writev).with_fd(fd));
            }
            return Ok(rc as usize);
        }
    }
    #[cfg(not(unix))]
    {
        // TODO(windows): route through `uv_fs_write` with `uv_buf_t[]`.
        let _ = (fd, vecs);
        Err(Error::from_code_int(libc::ENOSYS, Tag::writev))
    }
}

/// `bun.sys.readv` — scatter-read. macOS uses `readv$NOCANCEL` with no
/// EINTR retry; other POSIX retries on EINTR.
pub fn readv(fd: Fd, vecs: &[PlatformIoVec]) -> Maybe<usize> {
    #[cfg(debug_assertions)]
    if vecs.is_empty() {
        bun_core::debug_warn!("readv() called with 0 length buffer");
    }
    #[cfg(unix)]
    {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: vecs.ptr is `*const iovec`; the kernel writes through
            // each `iov_base`, never the array itself. Single shot.
            let rc = unsafe {
                nocancel::readv(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int)
            };
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), Tag::readv).with_fd(fd));
            }
            return Ok(rc as usize);
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: `PlatformIoVec` is `libc::iovec`.
            return unsafe { linux_syscall::readv(fd, vecs.as_ptr(), vecs.len()) }
                .map_err(|e| Error::from_code_int(e, Tag::readv).with_fd(fd));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
        loop {
            // SAFETY: see above.
            let rc =
                unsafe { libc::readv(fd.native(), vecs.as_ptr(), vecs.len() as core::ffi::c_int) };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR {
                    continue;
                }
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
/// `preadv$NOCANCEL` with no EINTR retry.
pub fn preadv(fd: Fd, vecs: &[PlatformIoVec], position: i64) -> Maybe<usize> {
    #[cfg(debug_assertions)]
    if vecs.is_empty() {
        bun_core::debug_warn!("preadv() called with 0 length buffer");
    }
    #[cfg(unix)]
    {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: see `readv`. Single shot.
            let rc = unsafe {
                nocancel::preadv(
                    fd.native(),
                    vecs.as_ptr(),
                    vecs.len() as core::ffi::c_int,
                    position,
                )
            };
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), Tag::preadv).with_fd(fd));
            }
            return Ok(rc as usize);
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: `PlatformIoVec` is `libc::iovec`.
            return unsafe { linux_syscall::preadv(fd, vecs.as_ptr(), vecs.len(), position) }
                .map_err(|e| Error::from_code_int(e, Tag::preadv).with_fd(fd));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
        loop {
            // SAFETY: see `readv`.
            let rc = unsafe {
                libc::preadv(
                    fd.native(),
                    vecs.as_ptr(),
                    vecs.len() as core::ffi::c_int,
                    position,
                )
            };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR {
                    continue;
                }
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
pub fn statfs(path: &ZStr) -> Maybe<StatFS> {
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    unsafe extern "C" {
        #[link_name = "statfs64"]
        fn _statfs(path: *const core::ffi::c_char, buf: *mut libc::statfs) -> core::ffi::c_int;
    }
    #[cfg(all(unix, not(all(target_os = "macos", target_arch = "x86_64"))))]
    use libc::statfs as _statfs;
    #[cfg(unix)]
    loop {
        // SAFETY: all-zero is a valid `struct statfs` (kernel writes every
        // field on success); `path` is NUL-terminated by `ZStr`.
        let mut st: StatFS = unsafe { bun_core::ffi::zeroed_unchecked() };
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
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(Error::from_code(E::NOSYS, Tag::statfs))
    }
}

/// `bun.timespec` — re-exported from `bun_core` so `PosixStat.rs` can spell
/// `crate::Timespec` (matching the `bun.timespec` namespacing).
pub use bun_core::Timespec;
/// `std.time` shim — re-exported from `bun_core` so callers that wrote
/// `bun_sys::time::timestamp()` resolve without an extra dep.
pub use bun_core::time;

/// `bun.sys.selfProcessMemoryUsage()` — returns the resident set size of the
/// current process in bytes, or `None` on failure. Thin wrapper around the
/// C++ `getRSS` shim (lives in `src/jsc/bindings/memory.cpp`).
pub fn self_process_memory_usage() -> Option<usize> {
    unsafe extern "C" {
        // safe: out-param is `&mut usize` (non-null, valid for write); C++ side
        // only writes the slot and returns a status code — no other preconditions.
        safe fn getRSS(rss: &mut usize) -> ::core::ffi::c_int;
    }
    let mut rss: usize = 0;
    if getRSS(&mut rss) != 0 {
        return None;
    }
    Some(rss)
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

/// Owned `KEY → VALUE` map of environment variables.
/// Minimal real def (no hash-map semantics needed; callers iterate).
pub type EnvMap = std::collections::HashMap<String, String>;

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
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    use core::ffi::c_int;
    #[cfg(unix)]
    use core::ffi::{c_char, c_void};
    #[cfg(unix)]
    pub use libc::fchmod;
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
    pub use super::{UTIME_NOW, UTIME_OMIT};
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    pub use libc::{getloadavg, sockaddr_dl, sysctlbyname};
    #[cfg(windows)]
    #[allow(non_camel_case_types)]
    pub type fd_t = bun_core::FdNative;

    /// libc `dlsym` (RTLD_DEFAULT when `handle` is null).
    #[cfg(unix)]
    pub unsafe fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void {
        // SAFETY: caller contract — `handle` is null/RTLD_DEFAULT or a live
        // `dlopen` handle; `name` is a valid NUL-terminated C string.
        unsafe { libc::dlsym(handle, name) }
    }
    // Win32 file APIs frequently spelled `bun.C.*` (the namespace flattens
    // a slice of `kernel32` into `bun.C`). Re-export the handful node_fs.rs
    // reaches via `sys::c::*` so the call sites stay target-neutral.
    #[cfg(windows)]
    pub use crate::windows::{
        CopyFileW, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, INVALID_FILE_ATTRIBUTES,
    };
    #[cfg(windows)]
    pub use bun_windows_sys::kernel32::{
        FlushFileBuffers, GetFileAttributesW, SetConsoleCtrlHandler,
    };

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
        // <net/if_dl.h> — `sockaddr_dl` already re-exported above for all BSDs.
        // misc libc
        truncate,
        vm_deallocate,
        vm_size_t,
        vm_statistics64,
        vm_statistics64_data_t,
    };
    // `UTIME_NOW`/`UTIME_OMIT` — already re-exported via
    // `pub use super::{UTIME_NOW, UTIME_OMIT}` above (top-level `#[cfg(unix)]`
    // consts cast `libc::UTIME_NOW`/`_OMIT` to i64).
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
    // SAFETY: integers only; all-zero is valid pre-`sysctl` state.
    #[cfg(target_os = "macos")]
    unsafe impl bun_core::ffi::Zeroable for struct_loadavg {}

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

    /// `bun.c.kqueue` — create a new kqueue fd.
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    #[inline]
    pub fn kqueue() -> c_int {
        crate::safe_libc::kqueue()
    }

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
        // SAFETY: caller contract (`unsafe fn`) — all pointers forwarded verbatim.
        unsafe { libc::kevent(kq, changelist, nchanges, eventlist, nevents, timeout) }
    }

    /// Darwin `sendfile(fd, s, off, *len, *hdtr, flags)`.
    /// NOTE: on `EINTR`/`EAGAIN` the kernel still writes the
    /// bytes-sent count back through `*len` before returning -1 — callers MUST
    /// advance their offset by `*len` even on error. This wrapper is raw (no
    /// EINTR retry); the caller owns the offset bookkeeping.
    #[cfg(target_os = "macos")]
    pub unsafe fn sendfile(
        fd: c_int,
        s: c_int,
        off: i64,
        len: *mut i64,
        hdtr: *mut c_void,
        flags: c_int,
    ) -> c_int {
        // SAFETY: caller contract (`unsafe fn`) — all pointers forwarded verbatim.
        unsafe { libc::sendfile(fd, s, off, len, hdtr.cast(), flags) }
    }
    /// FreeBSD `sendfile(fd, s, off, nbytes, *hdtr, *sbytes, flags)`.
    #[cfg(target_os = "freebsd")]
    pub unsafe fn sendfile(
        fd: c_int,
        s: c_int,
        off: i64,
        nbytes: usize,
        hdtr: *mut c_void,
        sbytes: *mut i64,
        flags: c_int,
    ) -> c_int {
        unsafe { libc::sendfile(fd, s, off, nbytes, hdtr.cast(), sbytes, flags) }
    }

    /// `fork(2)` — POSIX only.
    #[cfg(unix)]
    #[inline]
    pub unsafe fn fork() -> libc::pid_t {
        // SAFETY: `fork` takes no pointer arguments; the caller (`unsafe fn`)
        // upholds async-signal-safety in the child.
        unsafe { libc::fork() }
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
    // SAFETY: integers + byte arrays only; all-zero is valid pre-`proc_pidinfo` state.
    #[cfg(target_os = "macos")]
    unsafe impl bun_core::ffi::Zeroable for struct_proc_bsdinfo {}
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
    use core::ffi::{c_char, c_int};
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
    /// Layout-identical to `libc::timespec` so a `*const timespec` can be
    /// passed straight to `syscall(SYS_futex, ..)`.
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

    /// Errno; aliased to `bun_errno::E`.
    pub type Errno = super::E;
    #[inline]
    pub fn errno() -> c_int {
        super::last_errno()
    }

    /// Kernel errno enum with unprefixed variants and
    /// `init(rc)` decoding the `-errno`-in-return-value Linux raw-syscall ABI.
    /// Newtype (not an alias of `bun_errno::E`) because callers match on
    /// `E::AGAIN`/`E::INTR` (no `E` prefix).
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct E(pub u16);
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
        pub const CTL_DEL: i32 = libc::EPOLL_CTL_DEL;
    }
    // ── futex ──
    /// futex op (cmd + private flag), packed.
    #[derive(Clone, Copy)]
    pub struct FutexOp {
        pub cmd: FutexCmd,
        pub private: bool,
    }
    impl FutexOp {
        #[inline]
        fn raw(self) -> c_int {
            self.cmd as c_int
                | if self.private {
                    libc::FUTEX_PRIVATE_FLAG
                } else {
                    0
                }
        }
    }
    #[derive(Clone, Copy)]
    #[repr(i32)]
    pub enum FutexCmd {
        WAIT = libc::FUTEX_WAIT,
        WAKE = libc::FUTEX_WAKE,
        REQUEUE = libc::FUTEX_REQUEUE,
        WAIT_BITSET = libc::FUTEX_WAIT_BITSET,
        WAKE_BITSET = libc::FUTEX_WAKE_BITSET,
    }
    /// `syscall(SYS_futex, uaddr, op, val)` — 3-arg form (WAKE).
    /// Returns the raw kernel rc (decode with `E::init`).
    // The kernel futex ABI returns `-errno` on
    // failure. `libc::syscall()` is the *glibc* wrapper —
    // it returns `-1` and sets thread-local errno instead. Translate back to
    // the kernel convention so callers can decode with `E::init(rc)`; without
    // this, every EAGAIN/EINTR from FUTEX_WAIT mis-decodes as EPERM and the
    // ThreadPool worker panics inside its idle wait.
    #[inline]
    pub unsafe fn futex_3arg(uaddr: *const u32, op: FutexOp, val: u32) -> isize {
        // SAFETY: caller contract — `uaddr` points to a live, suitably-aligned
        // `u32` for the syscall's duration.
        let rc = unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val) };
        if rc == -1 {
            -(errno() as isize)
        } else {
            rc as isize
        }
    }
    /// `syscall(SYS_futex, uaddr, op, val, timeout)` — 4-arg form (WAIT).
    #[inline]
    pub unsafe fn futex_4arg(
        uaddr: *const u32,
        op: FutexOp,
        val: u32,
        timeout: *const timespec,
    ) -> isize {
        // SAFETY: caller contract — `uaddr` points to a live `u32`; `timeout`
        // is null or points to a valid `timespec` for the syscall's duration.
        let rc = unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val, timeout) };
        if rc == -1 {
            -(errno() as isize)
        } else {
            rc as isize
        }
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
    pub unsafe fn inotify_add_watch(fd: c_int, path: *const c_char, mask: u32) -> c_int {
        // SAFETY: caller contract — `fd` is a live inotify fd and `path` is a
        // valid NUL-terminated C string.
        unsafe { libc::inotify_add_watch(fd, path, mask) }
    }
    #[inline]
    pub fn inotify_rm_watch(fd: c_int, wd: c_int) -> c_int {
        // bionic declares `wd` as `uint32_t`, glibc/musl as `int`; the kernel
        // ABI is the same `__s32` either way — `safe_libc::inotify_rm_watch`
        // declares it `c_int`, which is ABI-correct on every Linux libc.
        crate::safe_libc::inotify_rm_watch(fd, wd)
    }
    /// Raw `read(2)` returning kernel `usize`.
    #[inline]
    pub unsafe fn read(fd: c_int, buf: *mut u8, count: usize) -> isize {
        // Raw syscall via rustix; libc-convention return preserved for callers
        // that decode via `GetErrno for isize`.
        // SAFETY: caller contract — `buf` points to `count` writable bytes.
        unsafe { super::linux_syscall::read_raw(fd, buf, count) }
    }
    /// Raw `sendfile(out, in, *offset, count)`.
    #[inline]
    pub unsafe fn sendfile(out_fd: c_int, in_fd: c_int, offset: *mut i64, count: usize) -> isize {
        // SAFETY: caller contract — `offset` is null or points to a live `i64`
        // the kernel may read and update.
        unsafe { super::linux_syscall::sendfile(out_fd, in_fd, offset, count) }
    }
    /// Raw `ppoll(fds, nfds, *timeout, *sigmask)`.
    #[inline]
    pub unsafe fn ppoll(
        fds: *mut pollfd,
        nfds: usize,
        timeout: *const libc::timespec,
        sigmask: *const libc::sigset_t,
    ) -> c_int {
        // SAFETY: caller contract — `fds` points to `nfds` initialized
        // `pollfd`s; `timeout`/`sigmask` are null or valid for the call.
        unsafe { libc::ppoll(fds, nfds as _, timeout, sigmask) }
    }
    #[inline]
    pub unsafe fn epoll_ctl(epfd: c_int, op: c_int, fd: c_int, event: *mut epoll_event) -> c_int {
        // SAFETY: caller contract — `event` is null (for `EPOLL_CTL_DEL`) or
        // points to a valid `epoll_event`.
        unsafe { super::linux_syscall::epoll_ctl(epfd, op, fd, event) }
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
    pub unsafe fn copy_file_range(
        in_: c_int,
        off_in: *mut i64,
        out: c_int,
        off_out: *mut i64,
        len: usize,
        flags: u32,
    ) -> isize {
        // SAFETY: raw `copy_file_range(2)`; caller owns fds, offset ptrs may be null.
        unsafe { super::linux_syscall::copy_file_range(in_, off_in, out, off_out, len, flags) }
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
        pub fn disable() {
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
    use core::ffi::{c_char, c_void};

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
        #[inline]
        pub fn as_ptr(&self) -> *const OSLog {
            core::ptr::from_ref(self)
        }
        /// Full signpost API lives in `bun_platform::darwin`; this stub lets
        /// `bun_perf` compile its Darwin arm without pulling that crate up-tier.
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

    // ── Darwin private __ulock_* flags ──
    // <xnu/bsd/sys/ulock.h>. Kept as
    // a plain struct + `.bits()` so Futex.rs can use field-init syntax
    // while the FFI boundary gets the packed u32.
    #[repr(u8)]
    #[derive(Clone, Copy, Default)]
    pub enum ULOp {
        #[default]
        NONE = 0,
        COMPARE_AND_WAIT = 1,
        UNFAIR_LOCK = 2,
        COMPARE_AND_WAIT_SHARED = 3,
        UNFAIR_LOCK64_SHARED = 4,
        COMPARE_AND_WAIT64 = 5,
        COMPARE_AND_WAIT64_SHARED = 6,
    }
    #[derive(Clone, Copy, Default)]
    pub struct UL {
        pub op: ULOp,
        /// `ULF_WAKE_ALL` (bit 8).
        pub wake_all: bool,
        /// `ULF_WAKE_THREAD` (bit 9).
        pub wake_thread: bool,
        /// `ULF_NO_ERRNO` (bit 24) — return `-errno` directly instead of
        /// setting thread-local errno.
        pub no_errno: bool,
    }
    impl UL {
        #[inline]
        pub const fn bits(self) -> u32 {
            (self.op as u32)
                | ((self.wake_all as u32) << 8)
                | ((self.wake_thread as u32) << 9)
                | ((self.no_errno as u32) << 24)
        }
    }
    unsafe extern "C" {
        // Private libSystem symbols (stable since 10.12; `__ulock_wait2` since 11.0).
        #[link_name = "__ulock_wait"]
        fn __ulock_wait_raw(
            operation: u32,
            addr: *const c_void,
            value: u64,
            timeout_us: u32,
        ) -> core::ffi::c_int;
        #[link_name = "__ulock_wait2"]
        fn __ulock_wait2_raw(
            operation: u32,
            addr: *const c_void,
            value: u64,
            timeout_ns: u64,
            value2: u64,
        ) -> core::ffi::c_int;
        #[link_name = "__ulock_wake"]
        fn __ulock_wake_raw(
            operation: u32,
            addr: *const c_void,
            wake_value: u64,
        ) -> core::ffi::c_int;
    }
    /// # Safety
    /// `addr` must point to readable memory of at least 4 bytes (the futex word).
    #[inline]
    pub unsafe fn __ulock_wait(flags: UL, addr: *const c_void, value: u64, timeout_us: u32) -> i32 {
        // SAFETY: caller contract (`# Safety` above) — `addr` is a live futex word.
        unsafe { __ulock_wait_raw(flags.bits(), addr, value, timeout_us) }
    }
    /// # Safety
    /// See `__ulock_wait`.
    #[inline]
    pub unsafe fn __ulock_wait2(
        flags: UL,
        addr: *const c_void,
        value: u64,
        timeout_ns: u64,
        value2: u64,
    ) -> i32 {
        // SAFETY: caller contract (`# Safety` above) — `addr` is a live futex word.
        unsafe { __ulock_wait2_raw(flags.bits(), addr, value, timeout_ns, value2) }
    }
    /// # Safety
    /// See `__ulock_wait`.
    #[inline]
    pub unsafe fn __ulock_wake(flags: UL, addr: *const c_void, wake_value: u64) -> i32 {
        // SAFETY: caller contract (`# Safety` above) — `addr` is a live futex word.
        unsafe { __ulock_wake_raw(flags.bits(), addr, wake_value) }
    }

    /// Darwin `struct kevent64_s` (extended kevent with 2-slot `ext[]`).
    pub use libc::kevent64_s;
    /// `kevent64()` — Darwin's wider kevent. Thin re-export so callers don't
    /// need a direct `libc` dep.
    #[inline]
    pub unsafe fn kevent64(
        kq: core::ffi::c_int,
        changelist: *const kevent64_s,
        nchanges: core::ffi::c_int,
        eventlist: *mut kevent64_s,
        nevents: core::ffi::c_int,
        flags: core::ffi::c_uint,
        timeout: *const libc::timespec,
    ) -> core::ffi::c_int {
        // SAFETY: caller contract (`unsafe fn`) — all pointers forwarded verbatim.
        unsafe { libc::kevent64(kq, changelist, nchanges, eventlist, nevents, flags, timeout) }
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
        pub cmdsize: u32,
    }

    /// `<mach-o/loader.h> segment_command_64`.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct segment_command_64 {
        pub cmd: u32,
        pub cmdsize: u32,
        pub segname: [u8; 16],
        pub vmaddr: u64,
        pub vmsize: u64,
        pub fileoff: u64,
        pub filesize: u64,
        pub maxprot: vm_prot_t,
        pub initprot: vm_prot_t,
        pub nsects: u32,
        pub flags: u32,
    }
    impl segment_command_64 {
        /// Segment name with trailing NULs trimmed.
        #[inline]
        pub fn seg_name(&self) -> &[u8] {
            bun_core::slice_to_nul(&self.segname)
        }
    }

    /// Raw `(*const u8, len)` pair so [`LoadCommandIterator`] does not hold a
    /// Rust borrow of its backing buffer. `bun_exe_format::macho` interleaves
    /// iterator reads with in-place mutation of the same `Vec<u8>`;
    /// a `&'a [u8]` here would
    /// force a structural rewrite of that consumer.
    #[derive(Clone, Copy)]
    pub struct RawSlice {
        ptr: *const u8,
        len: usize,
    }
    impl RawSlice {
        #[inline]
        pub fn as_ptr(&self) -> *const u8 {
            self.ptr
        }
        #[inline]
        pub fn len(&self) -> usize {
            self.len
        }
    }

    /// One parsed load command: header + raw bytes (header included).
    #[derive(Clone, Copy)]
    pub struct LoadCommand {
        pub hdr: load_command,
        pub data: RawSlice,
    }
    impl LoadCommand {
        #[inline]
        pub fn cmd(&self) -> u32 {
            self.hdr.cmd
        }
        /// Reinterpret the command bytes
        /// as `T` if large enough. Returns an owned `Copy` value (via
        /// `read_unaligned`) rather than `&T`: the backing buffer may be a
        /// heap `Vec<u8>` with arbitrary alignment, so materialising a typed
        /// reference would be UB.
        pub fn cast<T: Copy>(&self) -> Option<T> {
            if self.data.len < core::mem::size_of::<T>() {
                return None;
            }
            // SAFETY: `data.ptr` points into a live Mach-O image buffer with
            // at least `size_of::<T>()` bytes (checked above); `T` is
            // `#[repr(C)]` POD per all callers. `read_unaligned` tolerates any
            // alignment.
            Some(unsafe { core::ptr::read_unaligned(self.data.ptr.cast::<T>()) })
        }
    }

    /// Walks the load-command region
    /// that immediately follows a `mach_header_64`.
    ///
    /// SAFETY contract: callers must not reallocate, shrink, or free the
    /// backing buffer while a `LoadCommandIterator` derived from it (or any
    /// `LoadCommand` it yielded) is live.
    pub struct LoadCommandIterator {
        ncmds: u32,
        index: u32,
        buf_ptr: *const u8,
        buf_len: usize,
    }
    impl LoadCommandIterator {
        /// `buffer` must remain live (no realloc/free) for the lifetime of the
        /// returned iterator and any `LoadCommand` it yields.
        #[inline]
        pub fn new(ncmds: u32, buffer: &[u8]) -> Self {
            Self {
                ncmds,
                index: 0,
                buf_ptr: buffer.as_ptr(),
                buf_len: buffer.len(),
            }
        }

        pub fn next(&mut self) -> Option<LoadCommand> {
            if self.index >= self.ncmds {
                return None;
            }
            // SAFETY: `buf_ptr` was derived from a slice of `buf_len` bytes
            // which the caller promised stays live; a well-formed Mach-O has
            // `ncmds` load_command headers fitting within `sizeofcmds`.
            let hdr: load_command =
                unsafe { core::ptr::read_unaligned(self.buf_ptr.cast::<load_command>()) };
            let cmdsize = hdr.cmdsize as usize;
            if cmdsize < core::mem::size_of::<load_command>() || cmdsize > self.buf_len {
                // Malformed header — stop iteration rather than UB.
                self.index = self.ncmds;
                return None;
            }
            let lc = LoadCommand {
                hdr,
                data: RawSlice {
                    ptr: self.buf_ptr,
                    len: cmdsize,
                },
            };
            // SAFETY: advancing within the original buffer; bounds checked above.
            self.buf_ptr = unsafe { self.buf_ptr.add(cmdsize) };
            self.buf_len -= cmdsize;
            self.index += 1;
            Some(lc)
        }
    }
}

// ── `std.DynLib` — cross-platform dynamic library handle. ──
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
    /// `dlopen(path, RTLD_LAZY)` / `LoadLibraryW(path)`.
    pub fn open(path: &[u8]) -> core::result::Result<Self, bun_errno::SystemErrno> {
        let mut buf = bun_paths::PathBuffer::default();
        // `std.DynLib.open` returns `error.NameTooLong`; never truncate (could
        // dlopen a different library whose path is a prefix of the requested one).
        if path.len() >= buf.0.len() {
            return Err(bun_errno::SystemErrno::ENAMETOOLONG);
        }
        let len = path.len();
        buf.0[..len].copy_from_slice(path);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = ZStr::from_buf(&buf.0[..], len);
        match dlopen(z, RTLD::LAZY) {
            Some(h) => Ok(Self { handle: h }),
            None => Err(bun_errno::SystemErrno::ENOENT),
        }
    }
    /// `dlsym` typed lookup.
    pub fn lookup<T>(&self, name: &ZStr) -> Option<T> {
        const { assert!(core::mem::size_of::<T>() == core::mem::size_of::<*mut c_void>()) };
        let p = dlsym_impl(Some(self.handle), name)?;
        // SAFETY: irreducible — `dlsym` yields an untyped symbol address as
        // `*mut c_void`; the caller asserts `T` is a pointer-sized fn pointer
        // (or `*mut c_void`) whose ABI matches the resolved symbol. fn pointers
        // are not `bytemuck::Pod` (not zeroable), so no safe cast exists.
        // `transmute_copy` is used over `transmute` because `T` is generic and
        // its size cannot be checked at the definition site; the `const` assert
        // above enforces `size_of::<T>() == size_of::<*mut c_void>()` at
        // monomorphisation.
        Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&p) })
    }
    pub fn close(self) {
        // SAFETY: `self.handle` was returned by `dlopen` in `open()` and has
        // not been closed (this consumes `self`).
        #[cfg(unix)]
        unsafe {
            libc::dlclose(self.handle);
        }
        // Windows: FreeLibrary via windows mod; intentionally leaked here
        // (close is a no-op on Windows in our usage).
    }
    #[inline]
    pub fn handle(&self) -> *mut c_void {
        self.handle
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

/// `dlopen(filename, flags)`. Windows → `LoadLibraryExW` (UTF-8 → UTF-16).
pub fn dlopen(filename: &ZStr, flags: i32) -> Option<*mut c_void> {
    #[cfg(unix)]
    {
        // SAFETY: filename is NUL-terminated.
        let p = unsafe { libc::dlopen(filename.as_ptr(), flags) };
        if p.is_null() { None } else { Some(p) }
    }
    #[cfg(windows)]
    {
        let _ = flags;
        // `filename` is UTF-8; the `A` entry point would decode it as the
        // system ANSI codepage and mangle any non-ASCII byte. Widen and use
        // the `W` entry point like every other Windows path in this crate.
        let mut wbuf = bun_paths::w_path_buffer_pool::get();
        let wpath = bun_paths::string_paths::to_w_path(&mut wbuf, filename.as_bytes());
        // Match libuv `uv_dlopen` (and Bun's own `process.dlopen`): request
        // altered search so dependent DLLs resolve next to the loaded module.
        // MSDN documents that flag as undefined for relative paths, so only
        // set it when absolute; bare names keep the standard search order.
        const LOAD_WITH_ALTERED_SEARCH_PATH: u32 = 0x0000_0008;
        let dw_flags = if bun_paths::is_absolute_windows(filename.as_bytes()) {
            LOAD_WITH_ALTERED_SEARCH_PATH
        } else {
            0
        };
        // SAFETY: `to_w_path` NUL-terminates `wbuf`; `hFile` is reserved (NULL).
        let p = unsafe {
            bun_windows_sys::kernel32::LoadLibraryExW(
                wpath.as_ptr(),
                core::ptr::null_mut(),
                dw_flags,
            )
        };
        if p.is_null() { None } else { Some(p.cast()) }
    }
}
/// `dlsym(handle, name)`.
pub fn dlsym_impl(handle: Option<*mut c_void>, name: &ZStr) -> Option<*mut c_void> {
    #[cfg(unix)]
    {
        let h = handle.unwrap_or(core::ptr::null_mut());
        // SAFETY: name is NUL-terminated; dlsym accepts NULL handle as RTLD_DEFAULT.
        let p = unsafe { libc::dlsym(h, name.as_ptr()) };
        if p.is_null() { None } else { Some(p) }
    }
    #[cfg(windows)]
    {
        // The Windows arm calls `GetProcAddressA` (which widens
        // `name` to UTF-16 and forwards to kernel32 `GetProcAddress`).
        windows::GetProcAddressA(handle, name)
    }
}
/// `bun.c.dlsymWithHandle` — once-cached typed lookup; one expansion per
/// `(Type, name, handle_getter)` triple.
#[macro_export]
macro_rules! dlsym_with_handle {
    ($T:ty, $name:literal, $handle:expr) => {{
        static ONCE: ::std::sync::Once = ::std::sync::Once::new();
        // PORTING.md §Global mutable state: init-once fn ptr → AtomicPtr.
        // `Once` already provides happens-before; AtomicPtr just makes the
        // slot `Sync` without `static mut`.
        static PTR: ::core::sync::atomic::AtomicPtr<::core::ffi::c_void> =
            ::core::sync::atomic::AtomicPtr::new(::core::ptr::null_mut());
        ONCE.call_once(|| {
            if let Some(p) = $crate::dlsym_impl($handle, ::bun_core::zstr!($name)) {
                PTR.store(p, ::core::sync::atomic::Ordering::Relaxed);
            }
        });
        const {
            assert!(
                ::core::mem::size_of::<$T>() == ::core::mem::size_of::<*mut ::core::ffi::c_void>()
            )
        };
        // SAFETY: irreducible — `$T` is a fn-pointer type (caller contract);
        // fn pointers are not `bytemuck::Pod`, so the `*mut c_void` → `$T`
        // reinterpretation cannot be expressed safely. `p` is non-null (checked
        // below) and was obtained from `dlsym`, so it is a valid code address;
        // `Once` provides happens-before for the store. The `const` assert above
        // enforces `size_of::<$T>() == size_of::<*mut c_void>()` at expansion.
        let p = PTR.load(::core::sync::atomic::Ordering::Relaxed);
        if p.is_null() {
            None
        } else {
            Some(unsafe { ::core::mem::transmute_copy::<*mut ::core::ffi::c_void, $T>(&p) })
        }
    }};
}

// ── open helpers (posix arms) ──

/// `openA` — like `open` but takes a non-NUL-terminated slice.
pub fn open_a(path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    openat_a(Fd::cwd(), path, flags, perm)
}
/// `openatA` — like `openat` but takes a non-NUL-terminated slice.
pub fn openat_a(dir: impl AsFd, path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    let dir = dir.as_fd();
    let mut buf = bun_paths::PathBuffer::default();
    if path.len() >= buf.0.len() {
        return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::open).with_path(path));
    }
    buf.0[..path.len()].copy_from_slice(path);
    buf.0[path.len()] = 0;
    // SAFETY: NUL-terminated above.
    let z = ZStr::from_buf(&buf.0[..], path.len());
    openat(dir, z, flags, perm)
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
    let parent = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(path);
    let base = bun_paths::basename(path);
    if parent.is_empty() || base.is_empty() {
        // Nothing sensible to do (root or empty); silent success.
        return Ok(());
    }
    let dir = open_dir_absolute(parent).map(Dir::from_fd)?;
    dir.delete_tree(base)
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
    if vol_rel.first() != Some(&SEP)
        || vol_rel.len() >= nt.len()
        || !bun_core::strings::has_suffix_t(nt, vol_rel)
    {
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
pub fn normalize_path_windows<'a>(
    dir_fd: Fd,
    path: &[u16],
    buf: &'a mut [u16],
) -> Maybe<&'a bun_core::WStr> {
    normalize_path_windows_opts(dir_fd, path, buf, NormalizePathWindowsOpts::default())
}

/// Like [`normalize_path_windows`]; `opts.add_nt_prefix = false` makes the
/// output Win32-consumable: absolute inputs lose `\??\`, dotted or
/// multi-component relatives become `\\?\GLOBALROOT\Device\…`, and bare names
/// pass through verbatim (Win32 resolves those against the cwd).
#[cfg(windows)]
pub fn normalize_path_windows_opts<'a>(
    dir_fd: Fd,
    path: &[u16],
    buf: &'a mut [u16],
    opts: NormalizePathWindowsOpts,
) -> Maybe<&'a bun_core::WStr> {
    use bun_core::WStr;
    let too_long = || Error::from_code(E::ENAMETOOLONG, Tag::open);

    let mut path = path;
    if bun_paths::is_absolute_windows_wtf16(path) {
        // Three special-cases that must run BEFORE
        // `normalizeStringGenericTZ`, otherwise device paths get mangled:
        if path.len() >= 4 {
            // (a) `…\nul` / `…\NUL` → literal NT object path `\??\NUL`.
            const BS_NUL_LO: [u16; 4] = [b'\\' as u16, b'n' as u16, b'u' as u16, b'l' as u16];
            const BS_NUL_UP: [u16; 4] = [b'\\' as u16, b'N' as u16, b'U' as u16, b'L' as u16];
            let tail = &path[path.len() - 4..];
            if tail == BS_NUL_LO || tail == BS_NUL_UP {
                const NT_NUL: [u16; 7] = [
                    b'\\' as u16,
                    b'?' as u16,
                    b'?' as u16,
                    b'\\' as u16,
                    b'N' as u16,
                    b'U' as u16,
                    b'L' as u16,
                ];
                if buf.len() <= NT_NUL.len() {
                    return Err(too_long());
                }
                buf[..NT_NUL.len()].copy_from_slice(&NT_NUL);
                buf[NT_NUL.len()] = 0;
                return Ok(WStr::from_buf(&buf[..], NT_NUL.len()));
            }
            use bun_paths::is_sep_any_t as is_sep;
            if is_sep(path[1]) && is_sep(path[3]) {
                // (b) `\\.\…` device path → preserve verbatim so `\\.\pipe\foo`
                // is not collapsed to `\pipe\foo` by the normalizer.
                if path[2] == b'.' as u16 {
                    if path.len() >= buf.len() {
                        return Err(too_long());
                    }
                    buf[0] = b'\\' as u16;
                    buf[1] = b'\\' as u16;
                    buf[2] = b'.' as u16;
                    buf[3] = b'\\' as u16;
                    let rest = &path[4..];
                    buf[4..4 + rest.len()].copy_from_slice(rest);
                    buf[path.len()] = 0;
                    return Ok(WStr::from_buf(&buf[..], path.len()));
                }
                // (c) `\??\…` / `\\?\…` already prefixed → strip the 4-u16
                // prefix before re-normalizing to avoid a double `\??\`.
                if path[2] == b'?' as u16 {
                    path = &path[4..];
                }
            }
        }
        if opts.add_nt_prefix {
            // Absolute → add `\??\` (idempotent if already present), normalize
            // separators/`.`/`..` and NUL-terminate.
            // `nt_prefix_headroom = 8`: reject when `path.len >
            // buf.len - nt_prefix_headroom`.
            // `normalizeStringGenericTZ` performs no bounds checking of its
            // own, so reserve room for `\??\` + trailing-`\` growth + NUL
            // before calling it. NOTE: `to_nt_path16` is NOT a substitute here
            // — it only normalizes slashes and leaves `.`/`..` segments in
            // place, which `NtCreateFile` rejects (e.g. `\??\C:\dir\.` →
            // OBJECT_NAME_NOT_FOUND).
            if path.len() > buf.len().saturating_sub(8) {
                return Err(too_long());
            }
            let norm = bun_paths::resolve_path::normalize_string_generic_tz::<
                u16,
                /*ALLOW_ABOVE_ROOT*/ false,
                /*PRESERVE_TRAILING_SLASH*/ false,
                /*ZERO_TERMINATE*/ true,
                /*ADD_NT_PREFIX*/ true,
            >(path, buf, b'\\' as u16, bun_paths::is_sep_any_t::<u16>);
            let len = norm.len();
            // SAFETY: ZERO_TERMINATE wrote NUL at buf[len].
            return Ok(unsafe { WStr::from_raw(norm.as_ptr(), len) });
        }
        // `add_nt_prefix = false` — produce a Win32 path
        // (no `\??\` object prefix) for callers that feed kernel32 APIs
        // (CreateDirectoryW / CopyFileW). With .add_nt_prefix = false the
        // normalizer can still grow the input by one u16 (trailing `\` after a
        // bare UNC volume name) plus the NUL terminator.
        if path.len() > buf.len().saturating_sub(2) {
            return Err(too_long());
        }
        let norm = bun_paths::resolve_path::normalize_string_generic_tz::<
            u16,
            /*ALLOW_ABOVE_ROOT*/ false,
            /*PRESERVE_TRAILING_SLASH*/ false,
            /*ZERO_TERMINATE*/ true,
            /*ADD_NT_PREFIX*/ false,
        >(path, buf, b'\\' as u16, bun_paths::is_sep_any_t::<u16>);
        let len = norm.len();
        // SAFETY: ZERO_TERMINATE wrote NUL at buf[len].
        return Ok(unsafe { WStr::from_raw(norm.as_ptr(), len) });
    }

    // Strip a leading drive letter (`C:`) on the relative part; the bypass
    // below still copies the original `path` verbatim.
    let rel = if path.len() >= 2
        && bun_paths::resolve_path::is_drive_letter_t::<u16>(path[0])
        && path[1] == b':' as u16
    {
        &path[2..]
    } else {
        path
    };

    // Routing = any separator or `.`; clamp relevance = `..` resolving above
    // the dirfd. One pass via the shared classifier.
    let facts = bun_paths::classify_rel_t(rel, bun_paths::PathFormat::Windows);
    let saw_sep_or_dot = facts.has_sep || facts.has_dot;

    // Relative path with no separators or `.` can be passed straight through
    // to `NtCreateFile` against `RootDirectory`.
    if !saw_sep_or_dot {
        if path.len() >= buf.len() {
            return Err(too_long());
        }
        buf[..path.len()].copy_from_slice(path);
        buf[path.len()] = 0;
        // SAFETY: NUL written at buf[path.len()].
        return Ok(WStr::from_buf(&buf[..], path.len()));
    }

    // Otherwise: resolve `dir_fd` to its NT device path, join, normalize.
    // Win32 consumers (`add_nt_prefix = false`) get the `\\?\GLOBALROOT`
    // spelling of the same object — no mount manager, valid for kernel32.
    const GLOBALROOT: &[u16] = bun_core::w!("\\\\?\\GLOBALROOT");
    let g = if opts.add_nt_prefix {
        0
    } else {
        GLOBALROOT.len()
    };
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
        Err(windows::GetFinalPathNameByHandleError::NameTooLong) => return Err(too_long()),
        // `E.BADFD` (errno 77 'file descriptor in bad state'),
        // not `EBADF` (9).
        Err(_) => return Err(Error::from_code(E::BADFD, Tag::open)),
    };

    // The volume boundary is only needed when `..` resolves above the dirfd:
    // the base suffix is kernel-normalized (pure depth), so within-tree
    // dotdots cannot reach any floor and any split yields identical output.
    let mut share_rooted = false;
    let mut prefix_len = if !facts.climbs_above_start {
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
            Err(windows::GetFinalPathNameByHandleError::NameTooLong) => return Err(too_long()),
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
    // Post-trim on purpose: false for volume-root bases (the trim shortened
    // the prefix), whose lone-separator suffix must survive (see below).
    let whole_base = prefix_len == base.len();
    let mut rest = &base[prefix_len..];
    // Volume-root handles yield a trailing `\` — trim it so `joined` below
    // starts with exactly one separator.
    while rest.last() == Some(&(b'\\' as u16)) {
        rest = &rest[..rest.len() - 1];
    }

    // Unknown devices may multiplex namespaces (many mounts under one device
    // root); a `..` that would touch the clamp floor cannot be clamped safely
    // — fail loud. Allowlisted redirectors keep the silent share-root clamp.
    if facts.climbs_above_start && !share_rooted {
        const DOT: u16 = b'.' as u16;
        let is_sep = |&c: &u16| bun_paths::is_sep_any_t(c);
        let mut depth = 0isize;
        for component in rest.split(is_sep).chain(rel.split(is_sep)) {
            depth += match component {
                [] | [DOT] => 0,
                [DOT, DOT] => -1,
                _ => 1,
            };
            if depth < 0 {
                return Err(Error::from_code(E::EINVAL, Tag::open));
            }
        }
    }

    let mut joined = bun_paths::w_path_buffer_pool::get();
    let joined_len = rest.len() + 1 + rel.len();
    // `buf` holds `\\?\GLOBALROOT` (Win32 output only) + the copied prefix +
    // the normalized remainder (never longer than `joined_len`) + NUL; keep
    // 8 u16 of headroom to stay conservative.
    if joined_len > joined.0.len().saturating_sub(8)
        || g + prefix_len + joined_len > buf.len().saturating_sub(8)
    {
        return Err(too_long());
    }
    buf[..g].copy_from_slice(&GLOBALROOT[..g]);
    buf[g..g + prefix_len].copy_from_slice(&base[..prefix_len]);
    joined.0[..rest.len()].copy_from_slice(rest);
    joined.0[rest.len()] = b'\\' as u16;
    joined.0[rest.len() + 1..joined_len].copy_from_slice(rel);
    // `joined` starts with `\`, flooring the normalizer's `..` clamp right
    // after the copied prefix. `.`/`..` must be collapsed here — `NtCreateFile`
    // rejects them (e.g. `…\.` → OBJECT_NAME_NOT_FOUND).
    let sub_len = bun_paths::resolve_path::normalize_string_generic_tz::<
        u16,
        /*ALLOW_ABOVE_ROOT*/ false,
        /*PRESERVE_TRAILING_SLASH*/ false,
        /*ZERO_TERMINATE*/ true,
        /*ADD_NT_PREFIX*/ false,
    >(
        &joined.0[..joined_len],
        &mut buf[g + prefix_len..],
        b'\\' as u16,
        bun_paths::is_sep_any_t::<u16>,
    )
    .len();
    // A lone-separator suffix means `rel` collapsed to nothing: drop it for a
    // directory-path prefix, keep it for a bare device name where it selects
    // the root directory over the volume device.
    if sub_len == 1 && whole_base {
        buf[g + prefix_len] = 0;
        return Ok(WStr::from_buf(&buf[..], g + prefix_len));
    }
    // ZERO_TERMINATE wrote NUL at buf[g + prefix_len + sub_len].
    Ok(WStr::from_buf(&buf[..], g + prefix_len + sub_len))
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
        let errno = windows::Win32Error::get().to_e();
        return Err(Error::from_code(errno, Tag::open));
    }
    Ok(Fd::from_system(rc))
}

/// Absolute NT object names our producers emit: `\??\…` or `\Device\…`. Only
/// these get `RootDirectory = null`; any other rooted string stays
/// dirfd-relative so `NtCreateFile` rejects it (`OBJECT_PATH_SYNTAX_BAD`).
#[cfg(windows)]
fn is_nt_object_name(p: &[u16]) -> bool {
    bun_core::strings::has_prefix_comptime_utf16(p, &windows::NT_OBJECT_PREFIX_U8)
        || bun_core::strings::has_prefix_comptime_utf16(p, b"\\Device\\")
}

/// `openDirAtWindowsNtPath` — `NtCreateFile` with
/// `FILE_DIRECTORY_FILE`.
#[cfg(windows)]
pub fn open_dir_at_windows_nt_path(
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
        return open_windows_device_path(
            path,
            flags,
            if options.op != WindowsOpenDirOp::OnlyOpen {
                w::FILE_OPEN_IF
            } else {
                w::FILE_OPEN
            },
            w::FILE_DIRECTORY_FILE
                | w::FILE_SYNCHRONOUS_IO_NONALERT
                | windows::FILE_OPEN_FOR_BACKUP_INTENT
                | open_reparse,
        );
    }

    let path_len_bytes = (p.len() * 2) as u16;
    let mut nt_name = w::UNICODE_STRING {
        Length: path_len_bytes,
        MaximumLength: path_len_bytes,
        Buffer: p.as_ptr().cast_mut().cast::<u16>(),
    };
    let mut attr = w::OBJECT_ATTRIBUTES {
        Length: core::mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: if is_nt_object_name(p) {
            core::ptr::null_mut()
        } else if dir_fd.is_valid() {
            dir_fd.native()
        } else {
            Fd::cwd().native()
        },
        Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        ObjectName: &mut nt_name,
        SecurityDescriptor: core::ptr::null_mut(),
        SecurityQualityOfService: core::ptr::null_mut(),
    };
    let mut fd: w::HANDLE = bun_windows_sys::INVALID_HANDLE_VALUE;
    let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
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
            w::FILE_DIRECTORY_FILE
                | w::FILE_SYNCHRONOUS_IO_NONALERT
                | windows::FILE_OPEN_FOR_BACKUP_INTENT
                | open_reparse,
            core::ptr::null_mut(),
            0,
        )
    };
    match windows::Win32Error::from_nt_status(rc) {
        windows::Win32Error::SUCCESS => Ok(Fd::from_system(fd)),
        code => Err(Error::from_code(code.to_e(), Tag::open)),
    }
}

/// Absolute paths (`\??\…`, `\Device\…`) must be full NT object names and
/// open with no `RootDirectory`; relative paths resolve against `dir` (or the
/// cwd when `dir` is the "invalid_fd" sentinel).
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
        Buffer: p.as_ptr().cast_mut().cast::<u16>(),
    };
    let mut attr = w::OBJECT_ATTRIBUTES {
        Length: core::mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
        // [ObjectName] must be a fully qualified file specification or the
        // name of a device object (`\??\…`, `\Device\…`), unless it is the
        // name of a file relative to the directory specified by RootDirectory.
        ObjectName: &mut nt_name,
        RootDirectory: if is_nt_object_name(p) {
            core::ptr::null_mut()
        } else if dir.is_valid() {
            dir.native()
        } else {
            Fd::cwd().native()
        },
        Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        SecurityDescriptor: core::ptr::null_mut(),
        SecurityQualityOfService: core::ptr::null_mut(),
    };
    let mut io: w::IO_STATUS_BLOCK = bun_core::ffi::zeroed();

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
                    if unsafe { w::SetFilePointerEx(result, 0, core::ptr::null_mut(), w::FILE_END) }
                        == 0
                    {
                        // NtCreateFile succeeded — close the live HANDLE before
                        // bailing so this error path doesn't leak it.
                        // SAFETY: FFI; `result` is the just-created handle.
                        unsafe {
                            w::CloseHandle(result);
                        }
                        return Err(Error::from_code(E::EUNKNOWN, Tag::SetFilePointerEx));
                    }
                }
                Ok(Fd::from_system(result))
            }
            code => Err(Error::from_code(code.to_e(), Tag::open)),
        };
    }
}

/// `normalizePathWindows(u8, …)` length-checks before
/// `convertUTF8toUTF16InBuffer` because simdutf forwards only `output.ptr`
/// (no output bounds checking). UTF-16 output length ≤ UTF-8 input byte
/// length, so use `path.len()` as a cheap upper bound; on overflow compute
/// the exact post-conversion length to avoid over-rejecting multi-byte
/// inputs whose UTF-16 representation fits.
#[cfg(windows)]
#[inline]
fn convert_path_u8_to_u16<'a>(buf: &'a mut [u16], path: &[u8]) -> Maybe<&'a mut [u16]> {
    if path.len() > buf.len() && bun_core::strings::element_length_utf8_into_utf16(path) > buf.len()
    {
        return Err(Error::from_code(E::ENAMETOOLONG, Tag::open));
    }
    Ok(bun_core::convert_utf8_to_utf16_in_buffer(buf, path))
}

#[cfg(windows)]
pub fn open_dir_at_windows(dir_fd: Fd, path: &[u16], options: WindowsOpenDirOptions) -> Maybe<Fd> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir_fd, path, &mut wbuf.0[..])?;
    open_dir_at_windows_nt_path(dir_fd, norm, options)
}
#[cfg(windows)]
#[inline(never)]
pub fn open_dir_at_windows_a(
    dir_fd: impl AsFd,
    path: &[u8],
    options: WindowsOpenDirOptions,
) -> Maybe<Fd> {
    let dir_fd = dir_fd.as_fd();
    // `normalizePathWindows(u8, dirFd, path, wbuf, ..)`
    // does the UTF-8→UTF-16 conversion internally and THEN
    // applies the absolute/relative/device-path logic. Do the plain transcode
    // here (no NT-prefix, no normalization) so relative inputs stay relative
    // and resolve against `dir_fd`'s `RootDirectory`.
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let wide = convert_path_u8_to_u16(&mut wbuf.0[..], path)?;
    let mut buf2 = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir_fd, wide, &mut buf2.0[..])?;
    open_dir_at_windows_nt_path(dir_fd, norm, options)
}
#[cfg(windows)]
pub fn open_file_at_windows(dir_fd: Fd, path: &[u16], opts: NtCreateFileOptions) -> Maybe<Fd> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir_fd, path, &mut wbuf.0[..])?;
    open_file_at_windows_nt_path(dir_fd, norm, opts)
}
/// `openFileAtWindowsA` — UTF-8 entry point: convert to UTF-16 (no
/// NT-prefix yet — `normalize_path_windows` adds that) then defer to
/// [`open_file_at_windows`].
#[cfg(windows)]
pub fn open_file_at_windows_a(
    dir_fd: impl AsFd,
    path: &[u8],
    opts: NtCreateFileOptions,
) -> Maybe<Fd> {
    let dir_fd = dir_fd.as_fd();
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let wide = convert_path_u8_to_u16(&mut wbuf.0[..], path)?;
    open_file_at_windows(dir_fd, wide, opts)
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
    } else if (flags & O::APPEND) != 0 {
        access_mask |= w::GENERIC_WRITE | w::FILE_APPEND_DATA;
    } else if (flags & O::WRONLY) != 0 {
        access_mask |= w::GENERIC_WRITE;
    } else {
        access_mask |= w::GENERIC_READ;
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
        w::FILE_OPEN_REPARSE_POINT
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
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir, path, &mut wbuf.0[..])?;
    openat_windows_impl(dir, norm, flags, perm)
}
/// `openatWindowsA` — UTF-8 input.
#[cfg(windows)]
#[inline(never)]
pub fn openat_windows_a(dir: impl AsFd, path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    let dir = dir.as_fd();
    // `normalizePathWindows` does the
    // UTF-8→UTF-16 conversion internally; mirror that with a plain transcode
    // (no NT-prefix) so relative paths stay relative against `dir`.
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let wide = convert_path_u8_to_u16(&mut wbuf.0[..], path)?;
    let mut buf2 = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir, wide, &mut buf2.0[..])?;
    openat_windows_impl(dir, norm, flags, perm)
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
    /// Raw `dwFileAttributes` for callers that need other bits.
    pub raw: u32,
}

/// `getFileAttributes`. Accepts a UTF-8 path (the
/// resolver only ever calls it with one); the wide-path arm is the
/// `GetFileAttributesW` body inlined. Returns `None` on
/// `INVALID_FILE_ATTRIBUTES`.
#[cfg(windows)]
pub fn get_file_attributes(path: &ZStr) -> Option<WindowsFileAttributes> {
    use bun_windows_sys::externs as w;
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let wpath = bun_paths::string_paths::to_kernel32_path(&mut wbuf.0[..], path.as_bytes());
    // Win32 API does file path normalization, so we do not need the valid path assertion here.
    // SAFETY: `wpath` is NUL-terminated UTF-16 produced by `to_kernel32_path`.
    let dword = unsafe { w::GetFileAttributesW(wpath.as_ptr()) };
    if dword == windows::INVALID_FILE_ATTRIBUTES {
        return None;
    }
    Some(WindowsFileAttributes {
        is_directory: (dword & w::FILE_ATTRIBUTE_DIRECTORY) != 0,
        is_reparse_point: (dword & w::FILE_ATTRIBUTE_REPARSE_POINT) != 0,
        raw: dword,
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
        // SAFETY: path is NUL-terminated UTF-16.
        let attrs = unsafe { w::GetFileAttributesW(path.as_ptr()) };
        if attrs == windows::INVALID_FILE_ATTRIBUTES {
            return false;
        }
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
            if rc == bun_windows_sys::INVALID_HANDLE_VALUE {
                return false;
            }
            // SAFETY: rc is a valid handle from CreateFileW.
            unsafe {
                let _ = w::CloseHandle(rc);
            }
            return true;
        }
        true
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExistsAtType {
    File,
    Directory,
}
/// Windows tail — `NtQueryAttributesFile` against an
/// OBJECT_ATTRIBUTES built from an already NT-prefixed wide path. Shared by the
/// UTF-8 (`exists_at_type`) and UTF-16 (`exists_at_type_w`) entry points so the
/// width dispatch does not
/// duplicate the syscall body.
#[cfg(windows)]
fn exists_at_type_nt(dir: Fd, mut path: &[u16]) -> Maybe<ExistsAtType> {
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
        RootDirectory: if is_nt_object_name(path) {
            core::ptr::null_mut()
        } else if dir.is_valid() {
            dir.native()
        } else {
            Fd::cwd().native()
        },
        Attributes: 0,
        ObjectName: &mut nt_name,
        SecurityDescriptor: core::ptr::null_mut(),
        SecurityQualityOfService: core::ptr::null_mut(),
    };
    let mut basic_info: w::FILE_BASIC_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: FFI; attr/basic_info valid for the call duration.
    let rc = unsafe { w::ntdll::NtQueryAttributesFile(&attr, &mut basic_info) };
    if rc != w::NTSTATUS::SUCCESS {
        // `errnoSys` for `NTSTATUS` routes through the curated
        // `translateNTStatusToErrno` table first (so `OBJECT_PATH_NOT_FOUND`
        // deterministically maps to `ENOENT`, which `directory_exists_at()`
        // branches on), then falls back to `RtlNtStatusToDosError` for
        // unmapped codes.
        return Err(Error::from_code(
            windows::translate_nt_status_to_errno(rc),
            Tag::access,
        ));
    }
    // `FILE_ATTRIBUTE_READONLY` on a directory is a folder-customization
    // marker (OneDrive sets it) and does not affect directory-ness; only
    // `FILE_ATTRIBUTE_DIRECTORY` decides the type.
    Ok(
        if (basic_info.FileAttributes & w::FILE_ATTRIBUTE_DIRECTORY) != 0 {
            ExistsAtType::Directory
        } else {
            ExistsAtType::File
        },
    )
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
        let mut wbuf = bun_paths::w_path_buffer_pool::get();
        let path = bun_paths::string_paths::to_nt_path(&mut wbuf.0[..], sub.as_bytes()).as_slice();
        exists_at_type_nt(dir, path)
    }
}
/// Wide-path arm of `exists_at_type`. Takes an already-wide path (Windows
/// `OSPathSliceZ`) and routes through
/// `toNTPath16` instead of re-widening from UTF-8.
#[cfg(windows)]
pub fn exists_at_type_w(dir: Fd, sub: &[u16]) -> Maybe<ExistsAtType> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let path = bun_paths::string_paths::to_nt_path16(&mut wbuf.0[..], sub).as_slice();
    exists_at_type_nt(dir, path)
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
    fcntl(fd, libc::F_GETFL, 0)
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
            fcntl(fd, libc::F_SETFL, new as isize)?;
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

/// Linux: `preadv2(.., RWF_NOWAIT)`; else plain `read`.
pub fn read_nonblocking(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    while linux::RWFFlagSupport::is_maybe_supported() {
        let iov = [libc::iovec {
            iov_base: buf.as_mut_ptr().cast(),
            iov_len: buf.len(),
        }];
        // SAFETY: fd valid; iov points at a live stack array.
        let rc = unsafe { sys_preadv2(fd.native(), iov.as_ptr(), 1, -1, RWF_NOWAIT) };
        if rc < 0 {
            let e = last_errno();
            match e {
                libc::EOPNOTSUPP | libc::ENOSYS | libc::EPERM | libc::EACCES => {
                    linux::RWFFlagSupport::disable();
                    // Only fall through to BLOCKING read if the fd is
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
/// Linux: `pwritev2(.., RWF_NOWAIT)`; else plain `write`.
pub fn write_nonblocking(fd: Fd, buf: &[u8]) -> Maybe<usize> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    while linux::RWFFlagSupport::is_maybe_supported() {
        let iov = [libc::iovec {
            iov_base: buf.as_ptr().cast_mut().cast::<_>(),
            iov_len: buf.len(),
        }];
        // SAFETY: fd valid; iov points at a live stack array.
        let rc = unsafe { sys_pwritev2(fd.native(), iov.as_ptr(), 1, -1, RWF_NOWAIT) };
        if rc < 0 {
            let e = last_errno();
            match e {
                libc::EOPNOTSUPP | libc::ENOSYS | libc::EPERM | libc::EACCES => {
                    linux::RWFFlagSupport::disable();
                    // Poll before issuing a blocking write.
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
        let _ = safe_libc::fallocate(fd, 0, offset, len);
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
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub fn kevent(
    fd: Fd,
    changelist: &[libc::kevent],
    eventlist: &mut [libc::kevent],
    timeout: Option<&libc::timespec>,
) -> Maybe<usize> {
    loop {
        // SAFETY: fd is a valid kqueue; slices give exact (ptr,len); timeout
        // is either null or a valid timespec.
        let rc = unsafe {
            libc::kevent(
                fd.native(),
                changelist.as_ptr(),
                changelist.len() as c_int,
                eventlist.as_mut_ptr(),
                eventlist.len() as c_int,
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

/// `clonefile` — macOS-only CoW copy. On non-Darwin returns ENOTSUP so
/// callers can fall back to `copy_file`.
#[cfg(not(target_os = "macos"))]
pub fn clonefile(from: &ZStr, to: &ZStr) -> Maybe<()> {
    Err(Error::from_code_int(libc::ENOTSUP, Tag::clonefile)
        .with_path_dest(from.as_bytes(), to.as_bytes()))
}

/// `clonefileat` — macOS-only CoW copy relative to directory fds. On
/// non-Darwin returns ENOTSUP so callers can fall back to a manual copy.
#[cfg(not(target_os = "macos"))]
pub fn clonefileat(_from_dir: impl AsFd, from: &ZStr, _to_dir: impl AsFd, to: &ZStr) -> Maybe<()> {
    let _from_dir = _from_dir.as_fd();
    let _to_dir = _to_dir.as_fd();
    Err(Error::from_code_int(libc::ENOTSUP, Tag::clonefileat)
        .with_path_dest(from.as_bytes(), to.as_bytes()))
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
        // SAFETY: literal is NUL-terminated.
        let z = ZStr::from_static(b"/proc/version\0");
        let Ok(fd) = open(z, O::RDONLY | O::NOCTTY, 0) else {
            break 'detect 1;
        };
        let mut buf = [0u8; 512];
        let n = read(fd, &mut buf).unwrap_or(0);
        let _ = close(fd);
        if buf[..n]
            .windows(7)
            .any(|w| w.eq_ignore_ascii_case(b"freebsd"))
        {
            2
        } else {
            1
        }
    };
    LINUX_KERNEL_CACHED.store(detected, Ordering::Release);
    detected == 2
}

/// readlink `/dev/fd/N` (fdescfs).
#[cfg(any(target_os = "linux", target_os = "android"))]
fn get_fd_path_freebsd_linuxulator<'a>(
    fd: Fd,
    out: &'a mut bun_paths::PathBuffer,
) -> Maybe<&'a mut [u8]> {
    let mut dev = [0u8; 32];
    let n = {
        use std::io::Write as _;
        let mut c = std::io::Cursor::new(&mut dev[..]);
        let _ = write!(c, "/dev/fd/{}\0", fd.native());
        c.position() as usize - 1
    };
    // SAFETY: NUL written above.
    let z = ZStr::from_buf(&dev[..], n);
    let len = readlink(z, &mut out.0)?;
    Ok(&mut out.0[..len])
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
        let mut proc = [0u8; 32];
        let n = {
            use std::io::Write as _;
            let mut c = std::io::Cursor::new(&mut proc[..]);
            let _ = write!(c, "/proc/self/fd/{}\0", fd.native());
            c.position() as usize - 1
        };
        // SAFETY: NUL written above.
        let z = ZStr::from_buf(&proc[..], n);
        match readlink(z, &mut out.0) {
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
        out.0.fill(0);
        fcntl(fd, libc::F_GETPATH, out.0.as_mut_ptr() as isize)?;
        // SAFETY: F_GETPATH writes a NUL-terminated string into `out`.
        let len = unsafe { libc::strlen(out.0.as_ptr().cast()) };
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
        // Trust that Windows gives us valid UTF-16LE.
        let len = bun_paths::string_paths::from_w_path(&mut out.0[..], wide_slice).len();
        return Ok(&mut out.0[..len]);
    }
    #[cfg(target_os = "freebsd")]
    {
        // FreeBSD: F_KINFO returns a `struct kinfo_file`
        // with `kf_path`. The /dev/fd readlink trick used for the Linuxulator
        // path doesn't resolve to an absolute path on native FreeBSD, so go
        // via fcntl. Mirrors `bun_core::util::fd_path_raw` (T0 sibling).
        use core::ptr::{addr_of, addr_of_mut};
        let mut kif = core::mem::MaybeUninit::<libc::kinfo_file>::zeroed();
        // SAFETY: kif is zeroed; kf_structsize is a c_int at a valid offset.
        unsafe {
            addr_of_mut!((*kif.as_mut_ptr()).kf_structsize)
                .write(core::mem::size_of::<libc::kinfo_file>() as c_int);
        }
        fcntl(fd, libc::F_KINFO, kif.as_mut_ptr() as isize)?;
        // SAFETY: kernel wrote a NUL-terminated path into kf_path.
        let path_ptr = unsafe { addr_of!((*kif.as_ptr()).kf_path) } as *const u8;
        let len = unsafe { libc::strlen(path_ptr.cast()) };
        // SAFETY: path_ptr has `len` initialized bytes (kernel-written).
        out.0[..len].copy_from_slice(unsafe { core::slice::from_raw_parts(path_ptr, len) });
        return Ok(&mut out.0[..len]);
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

/// fd → absolute wide path (Windows `GetFinalPathNameByHandleW`).
/// `\\?\` prefix and `\\?\UNC\` are stripped. Higher-tier callers
/// (`bun.getFdPathW`) re-export this. A libc/kernel32-only sibling lives at
/// `bun_core::fd_path_raw_w` for T0/T1 callers that cannot depend on this
/// crate.
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
#[cfg(not(windows))]
pub fn get_fd_path_w(_fd: Fd, _out: &mut [u16]) -> Maybe<&mut [u16]> {
    unreachable!("get_fd_path_w on non-Windows")
}

// ── environ ──

/// Borrowed slice of the process's `KEY=VALUE\0` C strings.
/// SAFETY note: the returned slice borrows the libc `environ` global; do not
/// mutate the environment concurrently.
pub fn environ() -> &'static [*const c_char] {
    #[cfg(unix)]
    {
        // SAFETY: `environ` is a process-global NULL-terminated array.
        unsafe {
            let mut n = 0usize;
            let base: *const *const c_char = bun_core::c_environ();
            if base.is_null() {
                return &[];
            }
            while !(*base.add(n)).is_null() {
                n += 1;
            }
            core::slice::from_raw_parts(base, n)
        }
    }
    #[cfg(windows)]
    {
        // Populated by `windows::env::convert_env_to_wtf8()` at startup
        // (bun_bin/lib.rs). The slice is NUL-terminated WTF-8
        // C strings; the underlying allocation is `Box::leak`'d for the
        // process lifetime so `'static` here is sound.
        // SAFETY: written exactly once at startup before any reader runs.
        let s = unsafe { bun_core::os::environ() };
        // SAFETY: `*mut c_char` and `*const c_char` have identical layout; the
        // fat-pointer cast preserves the original slice's (ptr, len) metadata
        // exactly instead of re-deriving it.
        unsafe { &*(s as *const [*mut c_char] as *const [*const c_char]) }
    }
}

/// Raw NULL-terminated `**c_char` environment pointer for FFI envp args
/// (e.g. `posix_spawn`). Unlike [`environ()`] this returns the raw libc
/// global pointer (already NULL-terminated) rather than a length-bounded
/// borrowed slice, so it is suitable to pass directly as `envp`.
pub fn environ_ptr() -> *const *const c_char {
    #[cfg(unix)]
    {
        bun_core::c_environ()
    }
    #[cfg(windows)]
    {
        // SAFETY: same as `environ()` above; NUL-terminated by construction
        // (`convert_env_to_wtf8` pushes a trailing null pointer).
        unsafe { bun_core::os::environ() }
            .as_ptr()
            .cast::<*const c_char>()
    }
}

// ── moveFileZWithHandle ──

/// `renameat`; on EISDIR removes the dest dir and retries; on EXDEV falls back
/// to copy-then-unlink. Port of `bun.sys.moveFileZWithHandle`.
pub fn move_file_z_with_handle(
    from_handle: Fd,
    from_dir: Fd,
    filename: &ZStr,
    to_dir: Fd,
    destination: &ZStr,
) -> Maybe<()> {
    match renameat(from_dir, filename, to_dir, destination) {
        Ok(()) => Ok(()),
        Err(e) if e.get_errno() == E::EISDIR => {
            #[cfg(unix)]
            // SAFETY: destination is NUL-terminated.
            let _ = unsafe {
                libc::unlinkat(to_dir.native(), destination.as_ptr(), libc::AT_REMOVEDIR)
            };
            renameat(from_dir, filename, to_dir, destination)
        }
        Err(e) if e.get_errno() == E::EXDEV => {
            // Cross-device: full `copyFileZSlowWithHandle`.
            #[cfg(unix)]
            let st = fstat(from_handle)?;
            // Unlink dest first — fixes ETXTBUSY on Linux.
            let _ = unlinkat(to_dir, destination);
            let dst = openat(
                to_dir,
                destination,
                O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC,
                0o644,
            )?;
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // Preallocation is best-effort.
                let _ = safe_libc::fallocate(dst.native(), 0, 0, st.st_size);
            }
            // Seek input to 0 — caller may have left offset at EOF after writing.
            let _ = lseek(from_handle, 0, libc::SEEK_SET);
            let r = copy_file(from_handle, dst);
            // Only stamp mode/owner on success; on copy error
            // the partially-written dest keeps its openat() defaults.
            #[cfg(unix)]
            if r.is_ok() {
                let _ = safe_libc::fchmod(dst.native(), st.st_mode);
                let _ = safe_libc::fchown(dst.native(), st.st_uid, st.st_gid);
            }
            let _ = close(dst);
            r?;
            let _ = unlinkat(from_dir, filename);
            Ok(())
        }
        Err(e) => Err(e),
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

/// `bun.mkdirRecursive` — `make_path` cwd-relative, taking a slice.
#[inline]
pub fn mkdir_recursive(sub_path: &[u8]) -> Maybe<()> {
    mkdir_recursive_at(Fd::cwd(), sub_path)
}
/// Windows-only `makePath` over UTF-16. On POSIX, transcodes
/// to UTF-8 and delegates to `mkdir_recursive_at`.
pub fn make_path_w(dir: Fd, sub_path: &[u16]) -> Maybe<()> {
    // Transcode UTF-16 → UTF-8, then call `makePath` (`mkdir_recursive_at`).
    let mut buf = bun_paths::PathBuffer::default();
    let utf8 = bun_paths::strings::from_w_path(&mut buf.0[..], sub_path);
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
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    #[inline]
    // Forwards the raw out-params to libc without dereferencing them here;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn sysctlbyname(
        name: &core::ffi::CStr,
        oldp: *mut c_void,
        oldlenp: *mut usize,
        newp: *mut c_void,
        newlen: usize,
    ) -> super::Maybe<()> {
        // SAFETY: thin libc wrapper; pointer validity is the caller's contract.
        let rc = unsafe { libc::sysctlbyname(name.as_ptr(), oldp, oldlenp, newp, newlen) };
        if rc != 0 {
            return Err(super::err_with(super::Tag::TODO));
        }
        Ok(())
    }

    /// Typed `sysctlbyname(3)` read of a fixed-size POD value (`hw.ncpu`,
    /// `hw.cpufrequency`, `kern.boottime`, …). Hides the `*mut c_void` /
    /// `&mut len` dance. The `Zeroable` bound is the workspace's
    /// "kernel-fillable POD" marker — every impl is integers / raw pointers /
    /// nested C POD, so any byte pattern the kernel writes is a valid `T`.
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "dragonfly",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    #[inline]
    pub fn sysctl_read<T: bun_core::ffi::Zeroable>(
        name: &core::ffi::CStr,
        out: &mut T,
    ) -> super::Maybe<()> {
        let mut len = core::mem::size_of::<T>();
        // SAFETY: `out` is `&mut T` → exclusive, valid for `size_of::<T>()`
        // writes; `T: Zeroable` (POD) so the raw bytes form a valid `T`;
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
    pub fn sysctl_read_slice<T: bun_core::ffi::Zeroable>(
        name: &core::ffi::CStr,
        buf: &mut [T],
    ) -> super::Maybe<usize> {
        let mut len = core::mem::size_of_val(buf);
        // SAFETY: `buf` is `&mut [T]` → exclusive, valid for `len` writes;
        // `T: Zeroable` (POD) so partial / full kernel writes leave valid `T`s.
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

    // ── INET6_ADDRSTRLEN (<netinet/in.h> / `ws2ipdef.h`) ──
    // POSIX `netinet/in.h` = 46; Windows `ws2ipdef.h` = 65.
    #[cfg(windows)]
    pub const INET6_ADDRSTRLEN: usize = 65;
    #[cfg(not(windows))]
    pub const INET6_ADDRSTRLEN: usize = 46;

    // ── sockaddr family ──
    #[cfg(unix)]
    pub use libc::{sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage};
    // Route through `bun_libuv_sys` (not `bun_windows_sys::ws2_32`) so types
    // returned by libuv APIs (`uv_interface_address_t`, `uv_udp_*`) are the
    // *same* nominal type callers see via `bun_sys::posix::sockaddr_*` — Rust
    // doesn't structurally unify two identical-layout `#[repr(C)]` structs.
    #[cfg(windows)]
    pub use bun_libuv_sys::{sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage};

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
        pub tv_sec: i64,
        pub tv_nsec: i64,
    }

    // ── raw I/O (no `Maybe` wrapping) ──
    #[cfg(unix)]
    #[inline]
    pub unsafe fn read(fd: c_int, buf: *mut u8, count: usize) -> isize {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: caller contract — `buf` points to `count` writable bytes.
            unsafe { super::linux_syscall::read_raw(fd, buf, count) }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            // SAFETY: caller contract — `buf` points to `count` writable bytes.
            unsafe { libc::read(fd, buf.cast(), count) }
        }
    }
    #[cfg(unix)]
    #[inline]
    pub unsafe fn write(fd: c_int, buf: *const u8, count: usize) -> isize {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: caller contract — `buf` points to `count` readable bytes.
            unsafe { super::linux_syscall::write_raw(fd, buf, count) }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            // SAFETY: caller contract — `buf` points to `count` readable bytes.
            unsafe { libc::write(fd, buf.cast(), count) }
        }
    }

    // ── poll ──
    /// `struct pollfd`.
    #[cfg(unix)]
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct PollFd {
        pub fd: c_int,
        pub events: i16,
        pub revents: i16,
    }
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
            // SAFETY: PollFd is layout-identical to libc::pollfd.
            #[cfg(target_os = "macos")]
            let rc = unsafe {
                super::nocancel::poll(fds.as_mut_ptr().cast(), fds.len() as _, timeout_ms)
            };
            // SAFETY: `PollFd` is `repr(C)` and layout-identical to
            // `libc::pollfd`; `fds` is a valid exclusive slice.
            #[cfg(not(target_os = "macos"))]
            let rc = unsafe { libc::poll(fds.as_mut_ptr().cast(), fds.len() as _, timeout_ms) };
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
        let mut t = core::mem::MaybeUninit::<Termios>::uninit();
        let rc = crate::safe_libc::tcgetattr(fd, &mut t);
        if rc < 0 {
            return Err(super::err_with(super::Tag::ioctl));
        }
        // SAFETY: tcgetattr fully initializes `t` on success (rc == 0).
        Ok(unsafe { t.assume_init() })
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

    // ── rlimit ──
    #[cfg(unix)]
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Rlimit {
        pub cur: u64,
        pub max: u64,
    }
    // SAFETY: two `u64`; all-zero is a valid `Rlimit`.
    #[cfg(unix)]
    unsafe impl bun_core::ffi::Zeroable for Rlimit {}
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
// Socket address
// (just the sockaddr union + a couple of constructors; full resolver lives in
// `bun_dns`). Dependents only need the data shape + Display.
// ──────────────────────────────────────────────────────────────────────────
pub mod net {
    use core::fmt;

    // POSIX libc has `sockaddr_*` at the crate root; MSVC libc does not. Route
    // both through a private `sock` shim so the body below is target-agnostic.
    #[cfg(unix)]
    mod sock {
        pub(super) use libc::{
            AF_INET, AF_INET6, sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage,
        };
    }
    #[cfg(windows)]
    mod sock {
        // Same nominal types as `bun_sys::posix::sockaddr*` (see comment there)
        // so `Address::init_posix` accepts pointers callers cast through that
        // path. AF_* values come from ws2def.h.
        pub(super) use bun_libuv_sys::{sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage};
        pub(super) use bun_windows_sys::ws2_32::{AF_INET, AF_INET6};
    }
    use sock::*;

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

    /// Tagged union over sockaddr_in/in6/un.
    #[derive(Clone, Copy)]
    pub struct Address {
        /// Generic storage; `family()` discriminates.
        pub any: sockaddr_storage,
    }
    impl Address {
        /// Construct from a borrowed `*const sockaddr`.
        /// SAFETY: `addr` must point at a valid sockaddr of the family it declares.
        pub unsafe fn init_posix(addr: *const sockaddr) -> Self {
            // SAFETY: `sockaddr_storage` is a POD C struct; all-zeros is valid.
            let mut storage: sockaddr_storage = unsafe { bun_core::ffi::zeroed_unchecked() };
            // SAFETY: caller contract — `addr` points to a valid `sockaddr`
            // header, so `sa_family` is readable.
            let len = match unsafe { (*addr).sa_family } as i32 {
                AF_INET => core::mem::size_of::<sockaddr_in>(),
                AF_INET6 => core::mem::size_of::<sockaddr_in6>(),
                _ => core::mem::size_of::<sockaddr>(),
            };
            // SAFETY: `len` is sized from `sa_family` and never exceeds
            // `size_of::<sockaddr_storage>()`; caller guarantees `addr` spans
            // `len` bytes; `storage` is fresh stack so the ranges cannot overlap.
            unsafe {
                core::ptr::copy_nonoverlapping(
                    addr.cast::<u8>(),
                    (&raw mut storage).cast::<u8>(),
                    len,
                );
            }
            Self { any: storage }
        }
        #[inline]
        pub fn family(&self) -> i32 {
            self.any.ss_family as i32
        }
        #[inline]
        pub fn as_sockaddr(&self) -> *const sockaddr {
            (&raw const self.any).cast()
        }
        /// Tag-checked borrow of the IPv4 payload. `None` unless
        /// `family() == AF_INET`.
        #[inline]
        pub fn as_in4(&self) -> Option<&sock::sockaddr_in> {
            if self.family() == AF_INET {
                // SAFETY: `ss_family == AF_INET` ⇒ `any` was written as a
                // `sockaddr_in`; `sockaddr_storage` is guaranteed by POSIX/
                // ws2def.h to have size and alignment >= `sockaddr_in`, and
                // the family field overlays at offset 0. Reborrowing the
                // storage at the narrower type is the canonical sockaddr view.
                Some(unsafe { &*(&raw const self.any).cast::<sock::sockaddr_in>() })
            } else {
                None
            }
        }
        /// Tag-checked borrow of the IPv6 payload. `None` unless
        /// `family() == AF_INET6`.
        #[inline]
        pub fn as_in6(&self) -> Option<&sock::sockaddr_in6> {
            if self.family() == AF_INET6 {
                // SAFETY: `ss_family == AF_INET6` ⇒ `any` was written as a
                // `sockaddr_in6`; `sockaddr_storage` has size/alignment >=
                // `sockaddr_in6` on every supported target. See `as_in4`.
                Some(unsafe { &*(&raw const self.any).cast::<sock::sockaddr_in6>() })
            } else {
                None
            }
        }
    }
    impl Default for Address {
        // SAFETY: POD, zero-valid — sockaddr union of integer fields.
        fn default() -> Self {
            Self {
                // SAFETY: `sockaddr_storage` is POD; all-zeros is a valid value.
                any: unsafe { bun_core::ffi::zeroed_unchecked() },
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
            if let Some(v4) = self.as_in4() {
                // `sin_addr` is `in_addr { s_addr: u32 }` on POSIX/ws2_32 but
                // `[u8; 4]` in `bun_libuv_sys::sockaddr_in`; reinterpret as
                // raw octets so both shapes resolve.
                // SAFETY: `sin_addr` is 4 bytes of POD on every target.
                let octets: [u8; 4] =
                    unsafe { *core::ptr::addr_of!(v4.sin_addr).cast::<[u8; 4]>() };
                write!(
                    f,
                    "{}.{}.{}.{}:{}",
                    octets[0],
                    octets[1],
                    octets[2],
                    octets[3],
                    u16::from_be(v4.sin_port)
                )
            } else if let Some(v6) = self.as_in6() {
                // `sin6_addr` is `in6_addr { s6_addr: [u8; 16] }` on every
                // target; reinterpret as raw octets to stay independent of the
                // wrapper struct name.
                // SAFETY: `sin6_addr` is 16 bytes of POD on every target.
                let octets: [u8; 16] =
                    unsafe { *core::ptr::addr_of!(v6.sin6_addr).cast::<[u8; 16]>() };
                // `SocketAddrV6`'s Display emits `[addr]:port` (with `%scope`
                // when nonzero), matching Zig's `std.net.Ip6Address.format` —
                // the shape `bun_core::fmt::format_ip` expects to strip.
                fmt::Display::fmt(
                    &std::net::SocketAddrV6::new(
                        std::net::Ipv6Addr::from(octets),
                        u16::from_be(v6.sin6_port),
                        u32::from_be(v6.sin6_flowinfo),
                        v6.sin6_scope_id,
                    ),
                    f,
                )
            } else {
                write!(f, "<addr family={}>", self.family())
            }
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
    }

    /// Walk loaded ELF objects
    /// via `dl_iterate_phdr`, returning the one whose `PT_LOAD` segment contains
    /// `address`. Shared by `bun_crash_handler::StackLine::from_address` and
    /// `bun_jsc::btjs::SelfInfo::lookup_module_dl` / `lookup_module_name_dl`.
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
    /// `kevent()` syscall — thin re-export so callers don't need a direct
    /// `libc` dep. SAFETY: caller upholds the kernel contract.
    #[inline]
    pub unsafe fn kevent(
        kq: c_int,
        changelist: *const Kevent,
        nchanges: c_int,
        eventlist: *mut Kevent,
        nevents: c_int,
        timeout: *const libc::timespec,
    ) -> c_int {
        unsafe { libc::kevent(kq, changelist, nchanges, eventlist, nevents, timeout) }
    }
    /// `copy_file_range` (FreeBSD 13+). Thin re-export so callers don't
    /// need a direct `libc` dep. Offset pointers may be null — when null the
    /// kernel uses (and advances) the fd's seek position.
    /// SAFETY: raw `copy_file_range(2)`; caller owns fds and any non-null
    /// offset pointers.
    #[inline]
    pub unsafe fn copy_file_range(
        in_: c_int,
        off_in: *mut libc::off_t,
        out: c_int,
        off_out: *mut libc::off_t,
        len: usize,
        flags: u32,
    ) -> libc::ssize_t {
        unsafe { libc::copy_file_range(in_, off_in, out, off_out, len, flags) }
    }
}
#[cfg(not(target_os = "freebsd"))]
pub mod freebsd {}

/// RAII guard that closes a raw [`Fd`] on drop. Most code should prefer
/// [`File`] / [`Dir`], which are owning RAII handles already; reach for this
/// only when working with a bare `Fd` in a context where a typed wrapper
/// would be misleading (e.g. an fd that is sometimes a file, sometimes a
/// directory, sometimes a pipe).
#[must_use = "dropping immediately closes the fd; bind to `let _close = ...`"]
pub struct CloseOnDrop(Fd);
impl CloseOnDrop {
    #[inline]
    pub fn new(fd: Fd) -> Self {
        Self(fd)
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
    #[inline]
    pub fn make_open_path(dir: &Dir, sub_path: &[u8], opts: OpenDirOptions) -> Maybe<Dir> {
        dir.make_open_path(sub_path, opts)
    }

    /// Dispatch trait for `make_path::<T>` over `u8` (POSIX) / `u16` (Windows).
    /// `makePath` taking `OSPathSlice`. Extends the
    /// canonical [`bun_paths::PathChar`] with the one syscall-dispatch hook.
    pub trait MakePathUnit: bun_paths::PathChar {
        fn make_path_at(dir: Fd, sub: &[Self]) -> Maybe<()>;
    }
    impl MakePathUnit for u8 {
        #[inline]
        fn make_path_at(dir: Fd, sub: &[u8]) -> Maybe<()> {
            mkdir_recursive_at(dir, sub)
        }
    }
    impl MakePathUnit for u16 {
        #[inline]
        fn make_path_at(dir: Fd, sub: &[u16]) -> Maybe<()> {
            make_path_w(dir, sub)
        }
    }
    /// `bun.makePath` — `mkdir -p` relative to `dir`, generic over path-char
    /// width so callers can pass `OSPathChar` slices unchanged.
    #[inline]
    pub fn make_path<T: MakePathUnit>(dir: &Dir, sub_path: &[T]) -> Maybe<()> {
        T::make_path_at(dir.fd, sub_path)
    }
    /// Explicit UTF-16 form (Windows). On POSIX transcodes via `make_path_w`.
    #[inline]
    pub fn make_path_u16(dir: &Dir, sub_path: &[u16]) -> Maybe<()> {
        make_path_w(dir.fd, sub_path)
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

// ──────────────────────────────────────────────────────────────────────────
// Windows-only `symlinkW` / `symlinkOrJunction`
// / `unlinkW` / `rmdir` / `mkdir` (CreateDirectoryW path). Compiled on
// Windows; on POSIX these names are absent.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(windows)]
mod win_symlink_impl {
    use super::{
        E, Error, Maybe, Tag, Win32ErrorExt as _, WindowsSymlinkOptions, ZStr, sys_uv, windows,
    };
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

    /// `symlinkW`. `dest` is the link path, `target` is
    /// the path the link points to. Retries once with `flags = 0` if the
    /// kernel rejects `ALLOW_UNPRIVILEGED_CREATE` (`INVALID_PARAMETER`).
    pub fn symlink_w(dest: &WStr, target: &WStr, options: WindowsSymlinkOptions) -> Maybe<()> {
        loop {
            let flags = options.flags();
            // SAFETY: both inputs are NUL-terminated wide strings.
            let rc = unsafe { windows::CreateSymbolicLinkW(dest.as_ptr(), target.as_ptr(), flags) };
            if rc == 0 {
                let win_err = windows::Win32Error::get();
                if win_err == windows::Win32Error::INVALID_PARAMETER
                    && (flags & SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE) != 0
                {
                    WindowsSymlinkOptions::denied();
                    continue;
                }
                // `to_e()` falls back to `E::UNKNOWN` for Win32 codes not in
                // the errno table. Filter drivers, network redirectors, and
                // security software hooking `CreateSymbolicLinkW` can return
                // codes outside the mapped set; treating those as success
                // would leave the caller believing a symlink exists when it
                // does not. Returning an error lets `symlink_or_junction`
                // fall through to a junction.
                let e: E = win_err.to_e();
                // Only ENOENT/EEXIST keep `has_failed_to_create_symlink`
                // unset; every other failure flips the sticky bit so
                // `symlinkOrJunction` falls through to junctions next time.
                if !matches!(e, E::NOENT | E::EXIST) {
                    WindowsSymlinkOptions::set_has_failed_to_create_symlink(true);
                }
                return Err(Error::from_code(e, Tag::symlink));
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
            let mut sym16 = bun_paths::w_path_buffer_pool::get();
            let mut target16 = bun_paths::w_path_buffer_pool::get();
            let sym_path = bun_paths::string_paths::to_w_path_normalize_auto_extend(
                &mut sym16[..],
                dest.as_bytes(),
            );
            let target_path = bun_paths::string_paths::to_w_path_normalize_auto_extend(
                &mut target16[..],
                target.as_bytes(),
            );
            match symlink_w(
                sym_path,
                target_path,
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
        let rc = unsafe { windows::DeleteFileW(from.as_ptr()) };
        if rc == 0 {
            return Err(Error::from_code(windows::get_last_errno(), Tag::unlink));
        }
        Ok(())
    }

    /// `mkdirOSPath` (Windows arm) — `CreateDirectoryW` with
    /// errno mapping. Named `mkdir_w` for parity with `unlink_w`/`symlink_w`.
    pub fn mkdir_w(path: &WStr) -> Maybe<()> {
        // SAFETY: `path` is NUL-terminated; null security attributes.
        let rc = unsafe { windows::CreateDirectoryW(path.as_ptr(), core::ptr::null_mut()) };
        if rc == 0 {
            return Err(Error::from_code(windows::get_last_errno(), Tag::mkdir));
        }
        Ok(())
    }
}
#[cfg(windows)]
pub use win_symlink_impl::{mkdir_w, symlink_or_junction, symlink_w, unlink_w};

/// `link(u16, ...)` Windows arm — `CreateHardLinkW` with
/// errno mapping. The u8/ZStr overload (`link`) routes through `sys_uv::link`.
#[cfg(windows)]
pub fn link_w(src: &bun_core::WStr, dest: &bun_core::WStr) -> Maybe<()> {
    if windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), None) == 0 {
        return Err(Error::from_code(windows::get_last_errno(), Tag::link));
    }
    Ok(())
}

/// `rmdir` — `rmdirat(FD.cwd(), to)`. Exposed on all
/// platforms (POSIX `unlinkat(.., AT_REMOVEDIR)`; Windows `DeleteFileBun`).
#[inline]
pub fn rmdir(to: &ZStr) -> Maybe<()> {
    rmdirat(Fd::cwd(), to)
}

/// Type-style alias so callers can write `bun_sys::MakePath::make_path::<T>(..)`
/// (the `bun.MakePath` namespace re-export).
pub use make_path as MakePath;

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
    out.0[len] = 0;
    // SAFETY: NUL written at out[len]; bytes [0..len] initialised by get_fd_path.
    Ok(ZStr::from_buf(&out.0[..], len))
}

/// `&[u8]`-taking convenience over [`renameat_concurrently`] — Z-terminates both
/// paths into stack buffers.
pub fn renameat_concurrently_a(
    from_dir_fd: Fd,
    from: &[u8],
    to_dir_fd: Fd,
    to: &[u8],
    opts: RenameatConcurrentlyOptions,
) -> Maybe<()> {
    // Z-terminate both paths into stack buffers.
    let mut from_buf = bun_paths::PathBuffer::default();
    let from_len = from.len().min(from_buf.0.len() - 1);
    from_buf.0[..from_len].copy_from_slice(&from[..from_len]);
    from_buf.0[from_len] = 0;
    // SAFETY: NUL-terminated above.
    let from_z = ZStr::from_buf(&from_buf.0[..], from_len);

    let mut to_buf = bun_paths::PathBuffer::default();
    let to_len = to.len().min(to_buf.0.len() - 1);
    to_buf.0[..to_len].copy_from_slice(&to[..to_len]);
    to_buf.0[to_len] = 0;
    // SAFETY: NUL-terminated above.
    let to_z = ZStr::from_buf(&to_buf.0[..], to_len);

    renameat_concurrently(from_dir_fd, from_z, to_dir_fd, to_z, opts)
}
/// `bun.iterateDir(dir)` — convenience wrapper around `dir_iterator::iterate`.
#[inline]
pub fn iterate_dir(dir: Fd) -> dir_iterator::WrappedIterator {
    dir_iterator::iterate(dir)
}
/// `bun.sys.exists`. Non-NUL-terminated convenience over
/// [`exists_z`]: copies into a stack `PathBuffer`, NUL-terminates, then
/// `access(path, F_OK)` (POSIX) / `GetFileAttributesW` (Windows).
pub fn exists(path: &[u8]) -> bool {
    let mut buf = bun_paths::PathBuffer::default();
    if path.len() >= buf.0.len() {
        return false;
    }
    buf.0[..path.len()].copy_from_slice(path);
    buf.0[path.len()] = 0;
    // SAFETY: NUL-terminated above.
    let z = ZStr::from_buf(&buf.0[..], path.len());
    exists_z(z)
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
pub fn move_file_z_slow(
    from_dir: Fd,
    filename: &ZStr,
    to_dir: Fd,
    destination: &ZStr,
) -> Maybe<()> {
    let in_handle = openat(
        from_dir,
        filename,
        O::RDONLY | O::CLOEXEC,
        if cfg!(windows) { 0 } else { 0o644 },
    )?;
    let _ = unlinkat(from_dir, filename);
    let r = copy_file_z_slow_with_handle(in_handle, to_dir, destination);
    let _ = close(in_handle);
    r
}
/// `copyFileZSlowWithHandle` (POSIX read/write fallback arm).
pub fn copy_file_z_slow_with_handle(in_handle: Fd, to_dir: Fd, destination: &ZStr) -> Maybe<()> {
    #[cfg(unix)]
    let st = fstat(in_handle)?;
    // Unlink dest first — fixes ETXTBUSY on Linux.
    let _ = unlinkat(to_dir, destination);
    let dst = openat(
        to_dir,
        destination,
        O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC,
        0o644,
    )?;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // Preallocation is best-effort.
        let _ = safe_libc::fallocate(dst.native(), 0, 0, st.st_size);
    }
    let _ = lseek(in_handle, 0, libc::SEEK_SET);
    let r = copy_file(in_handle, dst);
    // Only stamp mode/owner on success; on copy error the
    // partially-written dest keeps its openat() defaults.
    #[cfg(unix)]
    if r.is_ok() {
        let _ = safe_libc::fchmod(dst.native(), st.st_mode);
        let _ = safe_libc::fchown(dst.native(), st.st_uid, st.st_gid);
    }
    let _ = close(dst);
    r
}
/// `renameatZ` alias (bun_install reaches for it as the NUL-terminated form).
#[inline]
pub fn renameat_z(from_dir: impl AsFd, from: &ZStr, to_dir: impl AsFd, to: &ZStr) -> Maybe<()> {
    let from_dir = from_dir.as_fd();
    let to_dir = to_dir.as_fd();
    renameat(from_dir, from, to_dir, to)
}

/// Option struct for [`renameat_concurrently`];
/// callers can build it inline.
#[derive(Default, Clone, Copy)]
pub struct RenameatConcurrentlyOptions {
    pub move_fallback: bool,
}
/// Alias: `bun_install` call sites spell this `RenameOptions`.
pub type RenameOptions = RenameatConcurrentlyOptions;

/// `moveFileZSlowMaybe`. Thin wrapper
/// (`renameatConcurrently` falls back through here).
#[inline]
pub fn move_file_z_slow_maybe(
    from_dir: Fd,
    filename: &ZStr,
    to_dir: Fd,
    destination: &ZStr,
) -> Maybe<()> {
    move_file_z_slow(from_dir, filename, to_dir, destination)
}

/// `renameatConcurrently`. Tries an atomic NOREPLACE rename,
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

/// `renameatConcurrentlyWithoutFallback`.
pub fn renameat_concurrently_without_fallback(
    from_dir_fd: Fd,
    from: &ZStr,
    to_dir_fd: Fd,
    to: &ZStr,
) -> Maybe<()> {
    'attempt: {
        {
            // Happy path: the folder doesn't exist in the cache dir, so we can
            // just rename it. We don't need to delete anything.
            let err = match renameat2(
                from_dir_fd,
                from,
                to_dir_fd,
                to,
                Renameat2Flags {
                    exclude: true,
                    ..Default::default()
                },
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
                    match renameat2(
                        from_dir_fd,
                        from,
                        to_dir_fd,
                        to,
                        Renameat2Flags {
                            exchange: true,
                            ..Default::default()
                        },
                    ) {
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
    Ok(Fd::from_native(rc))
}

// ──────────────────────────────────────────────────────────────────────────
// `NodeFS::writeFileWithPathBuffer` — JSC-free subset.
//
// Full impl lives in `bun_runtime::node::node_fs` (T6, takes JS encodings,
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
/// `NodeFS::writeFileWithPathBuffer` — sync `openat(CREAT|TRUNC)` + write_all.
/// `path_buf` is a scratch buffer for NUL-terminating the relative path.
pub fn write_file_with_path_buffer(
    path_buf: &mut bun_paths::PathBuffer,
    args: &WriteFileArgs<'_>,
) -> Maybe<usize> {
    let WriteFileData::Buffer { buffer } = args.data;
    let fd = match args.file {
        PathOrFileDescriptor::Fd(fd) => fd,
        PathOrFileDescriptor::Path(bytes) => {
            if bytes.len() >= path_buf.0.len() {
                return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::open).with_path(bytes));
            }
            path_buf.0[..bytes.len()].copy_from_slice(bytes);
            path_buf.0[bytes.len()] = 0;
            // SAFETY: NUL-terminated above.
            let z = ZStr::from_buf(&path_buf.0[..], bytes.len());
            openat(
                args.dirfd,
                z,
                O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC,
                args.mode,
            )?
        }
    };
    let r = File::borrow(&fd).write_all(buffer);
    if !matches!(args.file, PathOrFileDescriptor::Fd(_)) {
        let _ = close(fd);
    }
    r.map(|_| buffer.len())
}

/// `bun.fetchCacheDirectoryPath` — resolve `$BUN_INSTALL_CACHE_DIR` /
/// `$XDG_CACHE_HOME/.bun/install/cache` / `$HOME/.bun/install/cache`.
/// full env-override chain lives in `bun_install`; this is the
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

// ──────────────────────────────────────────────────────────────────────────
// OUTPUT_SINK — bun_core's stderr vtable, installed by us at init (B-0 hook).
// ──────────────────────────────────────────────────────────────────────────

/// `bun_core::output::QuietWriter` is an opaque `[*mut (); 4]`. We stash the
/// raw fd in slot 0 and ignore the rest. (The buffering layer is routed to
/// `QuietWriterAdapter` below.)
#[inline]
fn qw_fd(qw: &bun_core::output::QuietWriter) -> Fd {
    // SAFETY: `QuietWriter` is `#[repr(C)] { _opaque: [*mut (); 4] }` (asserted
    // in bun_core::output); slot 0 carries fd-as-usize-as-ptr. Reading the
    // first word through a same-align pointer cast of a live `&QuietWriter`
    // is in-bounds and aligned.
    let raw = unsafe { *core::ptr::from_ref(qw).cast::<*mut ()>() };
    Fd::from_native(raw as usize as _)
}
#[inline]
fn qw_set_fd(qw: &mut bun_core::output::QuietWriter, fd: Fd) {
    // SAFETY: `QuietWriter` is `#[repr(C)] { _opaque: [*mut (); 4] }`; slot 0
    // carries fd-as-usize-as-ptr. Writing the first word through a same-align
    // pointer cast of a live `&mut QuietWriter` is in-bounds, aligned, and
    // exclusively borrowed.
    unsafe {
        *core::ptr::from_mut(qw).cast::<*mut ()>() = fd.native() as usize as *mut ();
    }
}

/// Best-effort write-all loop. Returns `false` on I/O error / zero-write so
/// `ScopedLogger::log` can disable the scope; "quiet" callers discard the bool.
fn fd_write_all_quiet(fd: Fd, mut bytes: &[u8]) -> bool {
    while !bytes.is_empty() {
        match write(fd, bytes) {
            Ok(0) => return false, // short write → give up
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
    buf: *mut u8,
    cap: usize,
    pos: usize,
}
const _: () = {
    assert!(
        core::mem::size_of::<SysQuietWriterAdapter>()
            <= core::mem::size_of::<bun_core::output::QuietWriterAdapter>()
    );
    assert!(
        core::mem::align_of::<bun_core::output::QuietWriterAdapter>()
            >= core::mem::align_of::<SysQuietWriterAdapter>()
    );
};

impl SysQuietWriterAdapter {
    /// View of the bytes buffered so far (`buf[0..pos]`). Centralises the
    /// (ptr, len) → slice reconstruction; the buffer is owned by the adapter
    /// and lives for `&self`.
    #[inline]
    fn buffered(&self) -> &[u8] {
        // SAFETY: `buf` is a `cap`-byte allocation owned by this adapter (set
        // at construction); `pos <= cap` is upheld by `adapter_write_all`
        // (drains before writing past `cap`). Bytes `[0, pos)` were written by
        // `copy_nonoverlapping` and are initialized. Borrow tied to `&self`.
        unsafe { core::slice::from_raw_parts(self.buf, self.pos) }
    }
}

unsafe fn adapter_write_all(
    w: *mut bun_core::io::Writer,
    bytes: &[u8],
) -> core::result::Result<(), bun_core::Error> {
    // SAFETY: `w` points at the first field of a SysQuietWriterAdapter (repr(C)).
    let this = unsafe { &mut *w.cast::<SysQuietWriterAdapter>() };
    if this.cap == 0 {
        let _ = fd_write_all_quiet(this.fd, bytes);
        return Ok(());
    }
    if this.pos + bytes.len() > this.cap {
        // Drain buffered bytes first.
        if this.pos > 0 {
            let _ = fd_write_all_quiet(this.fd, this.buffered());
            this.pos = 0;
        }
        // Large writes bypass the buffer so the next small write still coalesces.
        if bytes.len() >= this.cap {
            let _ = fd_write_all_quiet(this.fd, bytes);
            return Ok(());
        }
    }
    // SAFETY: `this.buf` has capacity `this.cap`; the branch above ensures
    // `this.pos + bytes.len() <= this.cap`, so `[buf+pos, buf+pos+len)` is
    // in-bounds and cannot overlap `bytes` (caller-owned slice).
    unsafe {
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), this.buf.add(this.pos), bytes.len());
    }
    this.pos += bytes.len();
    Ok(())
}
unsafe fn adapter_flush(w: *mut bun_core::io::Writer) -> core::result::Result<(), bun_core::Error> {
    // SAFETY: `w` points at the first field of a SysQuietWriterAdapter (repr(C)).
    let this = unsafe { &mut *w.cast::<SysQuietWriterAdapter>() };
    if this.pos > 0 {
        let _ = fd_write_all_quiet(this.fd, this.buffered());
        this.pos = 0;
    }
    Ok(())
}

#[cfg(unix)]
fn sink_tty_winsize(fd: Fd) -> Option<bun_core::Winsize> {
    // SAFETY: POD, zero-valid — libc::winsize is all-integer; ioctl writes it.
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
#[cfg(not(unix))]
fn sink_tty_winsize(_fd: Fd) -> Option<bun_core::Winsize> {
    // TODO(windows): GetConsoleScreenBufferInfo.
    None
}

// Backs `bun_core::OutputSink[Sys]` — stderr/mkdir/open/QuietWriter.
bun_core::link_impl_OutputSink! {
    Sys for () => |_this| {
        stderr() => bun_core::output::File(Fd::stderr()),
        make_path(cwd, dir) => mkdir_recursive_at(cwd, dir).map_err(|_| bun_core::Error::Unexpected),
        create_file(cwd, path) =>
            openat_a(cwd, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664).map_err(|_| bun_core::Error::Unexpected),
        quiet_writer_from_fd(fd) => {
            let mut out = bun_core::output::QuietWriter::ZEROED;
            qw_set_fd(&mut out, fd);
            out
        },
        quiet_writer_adapt(qw, buf, len) => {
            let fd = qw_fd(&qw);
            let concrete = SysQuietWriterAdapter {
                writer: bun_core::io::Writer {
                    write_all: adapter_write_all,
                    flush: adapter_flush,
                },
                fd,
                buf,
                cap: len,
                pos: 0,
            };
            let mut out = bun_core::output::QuietWriterAdapter::uninit();
            // SAFETY: size/align asserted in const block above; out is repr(C) [u8;64].
            core::ptr::write((&raw mut out).cast::<SysQuietWriterAdapter>(), concrete);
            out
        },
        // QuietWriter itself is unbuffered (buffering lives in the Adapter).
        quiet_writer_flush(_qw) => (),
        quiet_writer_write_all(qw, bytes) => fd_write_all_quiet(qw_fd(qw), bytes),
        quiet_writer_fd(qw) => qw_fd(qw),
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
        renameat_concurrently_a(
            root,
            b"from/sub",
            to_dir,
            b"sub",
            RenameatConcurrentlyOptions {
                move_fallback: true,
            },
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

#[cfg(all(test, windows))]
mod normalize_path_windows_tests {
    use super::*;
    use bun_windows_sys::externs as w;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn normalize(dir: Fd, path: &str) -> String {
        let mut buf = bun_paths::w_path_buffer_pool::get();
        let norm = normalize_path_windows(dir, &wide(path), &mut buf.0[..]).expect(path);
        String::from_utf16(norm.as_slice()).unwrap()
    }

    fn normalize_opts(dir: Fd, path: &str, add_nt_prefix: bool) -> String {
        let mut buf = bun_paths::w_path_buffer_pool::get();
        let norm = normalize_path_windows_opts(
            dir,
            &wide(path),
            &mut buf.0[..],
            NormalizePathWindowsOpts { add_nt_prefix },
        )
        .expect(path);
        String::from_utf16(norm.as_slice()).unwrap()
    }

    fn normalize_err(dir: Fd, path: &str) -> Error {
        let mut buf = bun_paths::w_path_buffer_pool::get();
        match normalize_path_windows(dir, &wide(path), &mut buf.0[..]) {
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
            let mut buf = bun_paths::w_path_buffer_pool::get();
            if normalize_path_windows(dir, &wide(&"..\\".repeat(k)), &mut buf.0[..]).is_err() {
                return k - 1;
            }
        }
        panic!("no clamp floor within 64 levels");
    }

    /// Open a directory handle with raw `CreateFileW` so the fixture fd does
    /// not depend on the code under test.
    fn open_dir_handle(path: &std::path::Path) -> Fd {
        use std::os::windows::ffi::OsStrExt;
        let wp: Vec<u16> = path.as_os_str().encode_wide().chain([0u16]).collect();
        // SAFETY: `wp` is NUL-terminated and outlives the call.
        let h = unsafe {
            w::CreateFileW(
                wp.as_ptr(),
                w::GENERIC_READ,
                FILE_SHARE,
                core::ptr::null_mut(),
                w::OPEN_EXISTING,
                w::FILE_FLAG_BACKUP_SEMANTICS,
                core::ptr::null_mut(),
            )
        };
        assert_ne!(
            h,
            bun_windows_sys::INVALID_HANDLE_VALUE,
            "CreateFileW {path:?}"
        );
        Fd::from_system(h)
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
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let got = normalize(*dir, "a\\b");
        assert!(got.starts_with("\\Device\\"), "{got}");
        assert!(got.ends_with("\\a\\b"), "{got}");
        assert!(!got.contains("\\??\\"), "{got}");
        // `..`-free rel: exactly the base directory's NT name plus the rel.
        assert_eq!(got, format!("{}\\a\\b", normalize(*dir, ".")));
    }

    #[test]
    fn dotdot_resolves_into_parent() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_dotdot");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let parent = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let child = scopeguard::guard(open_dir_handle(&tree.0.join("child")), |fd| {
            let _ = close(fd);
        });
        let got = normalize(*child, "..\\x");
        let base = normalize(*parent, ".");
        assert_eq!(got, format!("{base}\\x"));
    }

    #[test]
    fn within_tree_dotdot_resolves_under_base() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_within");
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let base = normalize(*dir, ".");
        // Non-climbing `..` needs no clamp boundary; it resolves in place.
        assert_eq!(normalize(*dir, "a\\..\\b"), format!("{base}\\b"));
        // Collapsing to nothing lands exactly on the base directory (the
        // join's lone separator is dropped).
        assert_eq!(normalize(*dir, "sub\\.."), base);
    }

    #[test]
    fn excess_dotdot_fails_closed_on_local_volume() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_clamp");
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let base = normalize(*dir, ".");
        let depth = floor_depth(*dir);
        assert!(depth >= 1, "{base}");
        // Enough `..` to cross the volume-root floor: local volumes are not
        // share-rooted, so the walk refuses instead of clamping silently.
        let over = format!("{}x", "..\\".repeat(depth + 1));
        assert_eq!(normalize_err(*dir, &over).get_errno(), E::EINVAL, "{over}");
        // Same without a trailing component.
        let over_only = "..\\".repeat(depth + 1);
        assert_eq!(normalize_err(*dir, &over_only).get_errno(), E::EINVAL);
        // Within-tree `..` (never crosses the floor) still resolves.
        assert_eq!(normalize(*dir, "sub\\..\\ok"), format!("{base}\\ok"));
    }

    #[test]
    fn forward_slash_dotdot_through_walk() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_fwd");
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let base = normalize(*dir, ".");
        // `/` separates components exactly like `\` — lexically for the
        // within-tree rel, and in the floor walk for the climbing one.
        assert_eq!(normalize(*dir, "a/../b"), format!("{base}\\b"));
        let over = format!("{}x", "../".repeat(floor_depth(*dir) + 1));
        assert_eq!(normalize_err(*dir, &over).get_errno(), E::EINVAL, "{over}");
    }

    #[test]
    fn climbing_rel_with_leading_name_through_walk() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_climb_name");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let parent = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let child = scopeguard::guard(open_dir_handle(&tree.0.join("child")), |fd| {
            let _ = close(fd);
        });
        // Net-climbing despite the leading name: the walk sees +1,−1,−1,+1
        // and stays above the floor while `..` resolves into the parent.
        assert_eq!(
            normalize(*child, "a\\..\\..\\x"),
            format!("{}\\x", normalize(*parent, "."))
        );
        // Same shape pushed one past the floor fails closed.
        let over = format!("a\\..\\{}x", "..\\".repeat(floor_depth(*child) + 1));
        assert_eq!(
            normalize_err(*child, &over).get_errno(),
            E::EINVAL,
            "{over}"
        );
    }

    #[test]
    fn exact_floor_dotdot_lands_on_volume_root() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_floor");
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let base = normalize(*dir, ".");
        // Exactly base-depth `..` lands ON the floor (allowed): the volume
        // root DIRECTORY — the device prefix plus its lone separator.
        let root = normalize(*dir, &"..\\".repeat(floor_depth(*dir)));
        assert!(root.starts_with("\\Device\\"), "{root}");
        assert!(root.ends_with('\\'), "{root}");
        assert!(base.starts_with(&root), "{base} vs {root}");
    }

    #[test]
    fn bare_dotdot_resolves_to_parent() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_bare_dotdot");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let parent = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let child = scopeguard::guard(open_dir_handle(&tree.0.join("child")), |fd| {
            let _ = close(fd);
        });
        let base = normalize(*parent, ".");
        assert_eq!(normalize(*child, ".."), base);
        assert_eq!(normalize(*child, "..\\"), base);
        // From the volume root itself, `..` crosses the floor.
        let root = scopeguard::guard(open_dir_handle(std::path::Path::new("C:\\")), |fd| {
            let _ = close(fd);
        });
        assert_eq!(normalize_err(*root, "..").get_errno(), E::EINVAL);
    }

    #[test]
    fn dot_components_neutral_in_dotdot_rel() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_dotneutral");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let parent = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let child = scopeguard::guard(open_dir_handle(&tree.0.join("child")), |fd| {
            let _ = close(fd);
        });
        // `.` and empty components cost no depth in the floor walk.
        let got = normalize(*child, ".\\..\\\\.\\x");
        assert_eq!(got, format!("{}\\x", normalize(*parent, ".")));
    }

    #[test]
    fn colon_components_flow_through() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_colon");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let base = normalize(*dir, ".");
        // Colon components survive normalization verbatim — running under
        // debug_assertions, these ARE the no-panic proof; the invalid stream
        // spelling is NtCreateFile's to reject at open time.
        assert_eq!(normalize(*dir, ":\\x"), format!("{base}\\:\\x"));
        assert_eq!(normalize(*dir, ":a.b"), format!("{base}\\:a.b"));
        assert_eq!(normalize(*dir, ".\\:\\x"), format!("{base}\\:\\x"));
        assert_eq!(normalize(*dir, "a\\:\\x"), format!("{base}\\a\\:\\x"));
        // `..` collapse promoting `:` toward the front of the output.
        let child = scopeguard::guard(open_dir_handle(&tree.0.join("child")), |fd| {
            let _ = close(fd);
        });
        assert_eq!(normalize(*child, "..\\:\\x"), format!("{base}\\:\\x"));
        // All the way to the clamp floor: `\:\x` directly after the device.
        let floored = normalize(*dir, &format!("{}:\\x", "..\\".repeat(floor_depth(*dir))));
        assert!(floored.ends_with("\\:\\x"), "{floored}");
        assert!(
            base.starts_with(floored.strip_suffix(":\\x").unwrap()),
            "{floored} vs {base}"
        );
        // Bare ADS names (no separator or dot) still pass through verbatim.
        assert_eq!(normalize(Fd::INVALID, ":stream"), ":stream");
        // The emitted name opens with a clean error, not a panic.
        assert!(
            open_file_at_windows_a(
                *dir,
                b":\\x",
                NtCreateFileOptions {
                    access_mask: w::GENERIC_READ | w::SYNCHRONIZE,
                    disposition: w::FILE_OPEN,
                    options: w::FILE_SYNCHRONOUS_IO_NONALERT,
                    ..Default::default()
                }
            )
            .is_err()
        );
    }

    #[test]
    fn drive_relative_dotdot_resolves_into_parent() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_drive_dotdot");
        std::fs::create_dir_all(tree.0.join("child")).unwrap();
        let child = scopeguard::guard(open_dir_handle(&tree.0.join("child")), |fd| {
            let _ = close(fd);
        });
        // The drive prefix of a drive-relative path is stripped; the `..`
        // after it must still reach the clamp logic.
        assert_eq!(normalize(*child, "C:..\\x"), normalize(*child, "..\\x"));
    }

    #[test]
    fn dot_in_name_resolves_under_base() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_dotname");
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        // Dot without separator routes to fd resolution (not the bare
        // passthrough) and needs no `..` clamp.
        assert_eq!(
            normalize(*dir, "a.b"),
            format!("{}\\a.b", normalize(*dir, "."))
        );
    }

    #[test]
    fn dot_resolves_to_base_dir() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_dot");
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let got = normalize(*dir, ".");
        assert!(got.starts_with("\\Device\\"), "{got}");
        assert!(!got.ends_with('\\'), "{got}");
        let name = tree.0.file_name().unwrap().to_str().unwrap();
        // Exact, trailing-sep-free expectation built from the parent handle.
        let parent = scopeguard::guard(open_dir_handle(tree.0.parent().unwrap()), |fd| {
            let _ = close(fd);
        });
        assert_eq!(got, format!("{}\\{name}", normalize(*parent, ".")));
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
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let got = normalize_opts(*dir, "a\\b", false);
        assert!(got.starts_with("\\\\?\\GLOBALROOT\\Device\\"), "{got}");
        assert!(got.ends_with("\\a\\b"), "{got}");
        // rel `.`: GLOBALROOT + base, no trailing separator.
        assert_eq!(
            normalize_opts(*dir, ".", false),
            format!("\\\\?\\GLOBALROOT{}", normalize(*dir, "."))
        );
    }

    #[test]
    fn win32_globalroot_output_creates_directories() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_gr_mkdir");
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let name = normalize_opts(*dir, ".\\fresh", false);
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
        let root = scopeguard::guard(open_dir_handle(std::path::Path::new("C:\\")), |fd| {
            let _ = close(fd);
        });
        let dot = normalize(*root, ".");
        assert!(dot.starts_with("\\Device\\"), "{dot}");
        // The lone separator is load-bearing: `\Device\<vol>\` is the root
        // directory, `\Device\<vol>` the volume device.
        assert!(dot.ends_with('\\'), "{dot}");
        // Generic across device shapes (incl. nested `HarddiskDmVolumes\…`):
        // a child of the root carries exactly the root's prefix + its name.
        let windows_dir =
            scopeguard::guard(open_dir_handle(std::path::Path::new("C:\\Windows")), |fd| {
                let _ = close(fd);
            });
        assert_eq!(normalize(*windows_dir, "."), format!("{dot}Windows"));
        assert_eq!(normalize(*root, ".\\x"), format!("{dot}x"));
        // Any `..` from the volume root would cross the floor: fail closed.
        assert_eq!(normalize_err(*root, "..\\x").get_errno(), E::EINVAL);
    }

    #[test]
    fn buffer_boundary_exact_fit() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_bound");
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });
        let base_len = wide(&normalize(*dir, ".")).len();
        let rel = "a\\b";
        // `..`-free path: prefix = whole base, `joined` = `\` + rel, and the
        // function reserves 8 u16 of headroom.
        let needed = base_len + 1 + rel.len() + 8;
        let mut exact = vec![0u16; needed];
        assert!(normalize_path_windows(*dir, &wide(rel), &mut exact[..]).is_ok());
        let mut small = vec![0u16; needed - 1];
        let err = match normalize_path_windows(*dir, &wide(rel), &mut small[..]) {
            Ok(p) => panic!("expected ENAMETOOLONG, got {:?}", p.as_slice()),
            Err(e) => e,
        };
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
        let nul = scopeguard::guard(
            open_windows_device_path(
                bun_core::WStr::from_buf(&nul_path[..], nul_path.len() - 1),
                w::GENERIC_READ,
                w::OPEN_EXISTING,
                0,
            )
            .expect("open NUL"),
            |fd| {
                let _ = close(fd);
            },
        );
        assert_eq!(normalize_err(*nul, ".\\x").get_errno(), E::BADFD);
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
        let child = scopeguard::guard(open_dir_handle(&tree.0.join("child")), |fd| {
            let _ = close(fd);
        });
        assert_eq!(
            normalize_opts(*child, "..\\x", false),
            format!("\\\\?\\GLOBALROOT{}", normalize(*child, "..\\x"))
        );
    }

    #[test]
    fn nt_object_name_opens_via_ntcreatefile() {
        let _g = crate::file::tests::FD_TEST_LOCK.lock();
        let tree = TempTree::new("nt_norm_open");
        std::fs::create_dir_all(tree.0.join("sub")).unwrap();
        std::fs::write(tree.0.join("sub").join("file.txt"), b"nt object name").unwrap();
        let dir = scopeguard::guard(open_dir_handle(&tree.0), |fd| {
            let _ = close(fd);
        });

        let fd = open_file_at_windows_a(
            *dir,
            b"sub\\file.txt",
            NtCreateFileOptions {
                access_mask: w::GENERIC_READ | w::SYNCHRONIZE,
                disposition: w::FILE_OPEN,
                options: w::FILE_SYNCHRONOUS_IO_NONALERT,
                ..Default::default()
            },
        )
        .expect("NtCreateFile accepts the \\Device\\ object name");
        let file = File::from_fd(fd); // Drop closes.
        let mut content = [0u8; 64];
        let n = file.read_all(&mut content).unwrap();
        assert_eq!(&content[..n], b"nt object name");

        let sub = scopeguard::guard(
            open_dir_at_windows_a(*dir, b"sub\\..\\sub", WindowsOpenDirOptions::default())
                .expect("dir opens through `..` in the NT object name"),
            |fd| {
                let _ = close(fd);
            },
        );
        assert!(fstat(*sub).is_ok());
    }
}
