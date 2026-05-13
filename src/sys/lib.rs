#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
//! `bun_sys` — syscall wrappers (port of `src/sys/sys.zig`).

// RESOLVED (B-2 round 7): `Fd` struct + pure-data accessors hoisted to
// `bun_core::Fd` (canonical T0). `fd.rs` is now `pub trait FdExt` over that.
#![warn(unreachable_pub)]

// `bun_str` is the historical Zig namespace name; keep a public alias to
// `bun_core` so any external `bun_sys::bun_core::…` paths continue to resolve.
#[cfg(windows)]
pub extern crate bun_core as bun_str;
#[cfg(windows)]
pub extern crate bun_libuv_sys;
pub mod fd;
pub use fd::{
    ErrorCase, FdExt, FdOptionalExt, FdT, HashMapContext, MakeLibUvOwnedError, MovableIfWindowsFd,
    RawFd, UvFile,
};
#[path = "Error.rs"]
mod error;
pub use error::Error;
#[cfg(windows)]
pub use error::ReturnCodeExt;
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
/// Port of `SystemError` (src/jsc/SystemError.zig) — the JS-facing rich error
/// (path/dest/syscall as `bun.String`). The data side has no JSC dependency:
/// the `*JSGlobalObject`-taking conversion methods (`toErrorInstance` etc.)
/// live in `bun_jsc` as inherent extensions. `#[repr(C)]` and field order
/// match the Zig `extern struct` exactly so the C++ `SystemError__*` externs
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
    /// Zig: `SystemError.getErrno` — `@enumFromInt(this.errno * -1)`.
    /// (`Error::to_system_error` stores `errno` negated to match Node.)
    #[inline]
    pub fn get_errno(&self) -> E {
        e_from_negated(self.errno)
    }
    /// Zig: `SystemError.deref`.
    pub fn deref(&self) {
        self.path.deref();
        self.code.deref();
        self.message.deref();
        self.syscall.deref();
        self.hostname.deref();
        self.dest.deref();
    }
    /// Zig: `SystemError.ref`.
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
    /// Port of `SystemError.format` (SystemError.zig:85). Zig forks on
    /// `Output.enable_ansi_colors_stderr` to inject ANSI escapes via
    /// `prettyFmt`; the Rust port emits the colorless variant
    /// (`prettyFmt(..., false)` collapses `<r>/<red>/<d>/<b>` to nothing) so
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
// state machine (port of `src/sys/copy_file.zig`). Un-gated B-2: raw kernel
// thunks live in `crate::linux`, errno tags use the prefixed `E::E*` form,
// kernel-version probe goes through `bun_core::linux_kernel_version()`.
#[path = "copy_file.rs"]
pub mod copy_file;

// `std.fs.Dir.Entry.Kind` — same set as `bun_core::FileKind`.
pub use bun_core::FileKind as EntryKind;

// `bun.DirIterator` — ported from `src/runtime/node/dir_iterator.zig`.
//
// This is copied from std.fs.Dir.Iterator. Differences:
// - returns errors in `bun_sys::Result` (preserves errno + syscall tag)
// - doesn't mark BADF as unreachable
// - entry name (`Name`) is a lifetime-erased borrow into the iterator's inline
//   `buf` on POSIX (Zig: `PathString`), owned `Vec` on Windows
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
    ///
    /// Zig parity: `IteratorResult { name: PathString, kind }` — `name` is a
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
    /// `d_name` NUL-terminated, so `as_zstr()` needs no copy. Same contract
    /// as Zig's `PathString.init(name)` (dir_iterator.zig:225) — the slice is
    /// only valid until the next `next()` call or until the iterator is
    /// moved/dropped. No heap allocation per entry.
    ///
    /// **Windows**: `FILE_DIRECTORY_INFORMATION.FileName` is length-prefixed
    /// (no NUL) and UTF-16; the Zig `.u8` `NewWrappedIterator` eagerly
    /// transcodes via `strings.fromWPath` into an iterator-owned `name_data`
    /// scratch buffer. Here we keep an owning `Vec` per entry (cold path —
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
            // The kernel guarantees `s.as_ptr().add(s.len())` reads `0` (the
            // dirent record's NUL terminator lies inside `reclen`).
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
            // Zig: `strings.fromWPath(self.name_data[0..], dir_info_name)` —
            // "Trust that Windows gives us valid UTF-16LE".
            let utf8 = bun_core::strings::convert_utf16_to_utf8(Vec::new(), s);
            Name { native: v, utf8 }
        }
        /// Zig: `name.slice()` — borrow the name as `&[OSPathChar]` (no NUL).
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
        /// Zig: `name.sliceAssumeZ()` — `[:0]const u8` on POSIX.
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
    // Zig: `buf: [8192]u8 align(...)` — *inline*, *uninitialised*. We mirror
    // that with `MaybeUninit` to skip the 8 KiB `memset` per directory (perf:
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
                    // glibc doesn't expose getdents64; go straight to the syscall
                    // (matches Zig's `linux.getdents64` raw-syscall path).
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
                // scan for the terminator (mirrors Zig's `indexOfScalar`); a scalar
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
                // Private libsystem symbol; same one Zig's `posix.system.__getdirentries64` hits.
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
                            &mut self.seek,
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
    // dir_iterator.zig:233-417 — `NtQueryDirectoryFile` +
    // `FILE_DIRECTORY_INFORMATION` walk.
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
        // PORT NOTE: stored on `State` on Windows so `next()` can pass it.
        #[cfg(not(windows))]
        #[allow(dead_code)]
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
        /// this iterator's inline `buf` (Zig parity: `PathString.init(d_name)`).
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
        let z = ZStr::from_buf(&buf[..], len);
        // bun.zig:883 — exactly `O_DIRECTORY | O_CLOEXEC | O_RDONLY` (no NONBLOCK).
        let flags = libc::O_DIRECTORY | libc::O_RDONLY | libc::O_CLOEXEC;
        openat(dir, z, flags, 0)
    }
    #[cfg(windows)]
    {
        // bun.zig:884 → `sys.openDirAtWindowsA(dir, path, .{ .iterable = true,
        // .read_only = true })`.
        open_dir_at_windows(
            dir,
            path,
            WindowsOpenDirOptions {
                iterable: true,
                read_only: true,
                ..Default::default()
            },
        )
    }
}

pub fn lstatat(fd: Fd, path: &ZStr) -> Result<Stat> {
    #[cfg(target_os = "linux")]
    {
        // sys.zig:874 — `bun.invalid_fd` means cwd-relative.
        let dirfd = if fd.is_valid() {
            fd.native()
        } else {
            libc::AT_FDCWD
        };
        // sys.zig:877 — `lstatat` tags as `.fstatat`.
        linux_syscall::fstatat(dirfd, path, libc::AT_SYMLINK_NOFOLLOW)
            .map_err(|e| Error::from_code_int(e, Tag::fstatat).with_path(path.as_bytes()))
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let mut st = core::mem::MaybeUninit::<libc::stat>::uninit();
        // sys.zig:874 — `bun.invalid_fd` means cwd-relative.
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
            Ok(unsafe { st.assume_init() })
        } else {
            // sys.zig:877 — `lstatat` tags as `.fstatat`.
            Err(Error::from_code_int(last_errno(), Tag::fstatat).with_path(path.as_bytes()))
        }
    }
    #[cfg(windows)]
    {
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

use core::ffi::{c_char, c_int, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from lower-tier crates (PORTING.md crate map).
// ──────────────────────────────────────────────────────────────────────────
/// Zig: `bun.errnoToZigErr(errno)` (bun.zig) — re-exported here so callers
/// that already depend on `bun_sys` (e.g. `bun_install` Windows paths) can
/// write `bun_sys::errno_to_zig_err(..)` without also importing `bun_core`.
pub use bun_core::errno_to_zig_err;
pub use bun_core::{Fd, FdKind, FdNative, FdOptional, FileKind, Mode, Stdio, kind_from_mode};

// Raw Linux syscalls via rustix (linux_raw backend). Hot-path I/O on Linux
// routes through here instead of glibc — see module doc. Android: same kernel,
// same syscall ABI; `linux_syscall.rs` carries its own
// `#![cfg(any(linux, android))]` so the gates stay in lockstep.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) mod linux_syscall;

/// Zig: `bun.isRegularFile(mode)` (bun.zig) — `S.ISREG(@intCast(mode))`.
#[inline]
pub fn is_regular_file(mode: Mode) -> bool {
    kind_from_mode(mode) == FileKind::File
}
/// `std.posix.socket_t` — `c_int` on POSIX, `SOCKET` (`usize`) on Windows.
#[cfg(not(windows))]
pub type SocketT = core::ffi::c_int;
#[cfg(windows)]
pub type SocketT = usize;
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
    // Zig contract is `?[*:0]const u8` and C++ callers pass it to `fprintf` /
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

/// Zig `Maybe(T)` static helpers — `.success()`, `.errno(e, tag)`,
/// `.errnoSys(rc, tag)`. Ported as a trait over `Result<T, Error>` so call
/// sites can keep writing `bun_sys::Result::<()>::errno_sys(rc, tag)` exactly
/// as the Zig spells it. Windows-only paths in `windows/mod.rs` lean on these
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
        #[cfg(target_os = "linux")]
        {
            if self.exchange {
                flags |= libc::RENAME_EXCHANGE;
            }
            if self.exclude {
                flags |= libc::RENAME_NOREPLACE;
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
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
    // sys.zig:193-197 — on Windows the `O.*` constants are the Zig spec values
    // (octal, Linux-shaped), NOT MSVCRT `_O_*`. `uv::O::from_bun_o` bit-tests
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
    // sys.zig:202 — non-zero on Windows so `(flags & O::DIRECTORY) != 0`
    // routes `openat_windows_impl` to the directory NtCreateFile path.
    #[cfg(windows)]
    pub const DIRECTORY: i32 = 0o200000;
    #[cfg(target_os = "linux")]
    pub const PATH: i32 = libc::O_PATH;
    #[cfg(target_os = "linux")]
    pub const NOATIME: i32 = libc::O_NOATIME;
    #[cfg(target_os = "linux")]
    pub const TMPFILE: i32 = libc::O_TMPFILE;
    // sys.zig:209-212 — Windows defines these (non-zero) so the `O.PATH` /
    // `O.NOATIME` bit-tests in `openat_windows_impl` are meaningful.
    #[cfg(windows)]
    pub const PATH: i32 = 0o10000000;
    #[cfg(windows)]
    pub const NOATIME: i32 = 0o1000000;
    #[cfg(windows)]
    pub const TMPFILE: i32 = 0o20200000;
    #[cfg(all(unix, not(target_os = "linux")))]
    pub const PATH: i32 = 0;
    #[cfg(all(unix, not(target_os = "linux")))]
    pub const NOATIME: i32 = 0;
    #[cfg(all(unix, not(target_os = "linux")))]
    pub const TMPFILE: i32 = 0;
    // sys.zig:66-216 — defined for every platform; Darwin-only flags map to 0
    // elsewhere so `flags & O.EVTONLY` etc. compile and are no-ops.
    #[cfg(unix)]
    pub const NOFOLLOW: i32 = libc::O_NOFOLLOW;
    #[cfg(windows)]
    pub const NOFOLLOW: i32 = 0o400000;
    #[cfg(unix)]
    pub const SYNC: i32 = libc::O_SYNC;
    #[cfg(windows)]
    pub const SYNC: i32 = 0o4010000;
    #[cfg(unix)]
    pub const DSYNC: i32 = libc::O_DSYNC;
    #[cfg(windows)]
    pub const DSYNC: i32 = 0o10000;
    #[cfg(unix)]
    pub const NOCTTY: i32 = libc::O_NOCTTY;
    #[cfg(windows)]
    pub const NOCTTY: i32 = 0;
    #[cfg(unix)]
    pub const ACCMODE: i32 = libc::O_ACCMODE;
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
}
// ──────────────────────────────────────────────────────────────────────────
// `File` / `Dir` — high-level handles. Extracted to file.rs / dir.rs
// (matching Zig's File.zig / module shape).
// ──────────────────────────────────────────────────────────────────────────
pub mod file;
pub use file::{File, ReadToEndResult};
pub mod dir;
pub use dir::*;

/// `std.fs.cwd()` — Zig callers do `bun_sys::cwd()` for the process cwd `Dir`.
#[inline]
pub fn cwd() -> Dir {
    Dir::cwd()
}

#[cfg(unix)]
pub type Stat = libc::stat;
/// On Windows `bun.Stat` is libuv's `uv_stat_t` (sys.zig: `bun.Stat == uv.uv_stat_t`).
#[cfg(windows)]
pub type Stat = bun_libuv_sys::uv_stat_t;

// ──────────────────────────────────────────────────────────────────────────
// Syscall surface — real posix libc FFI. Windows path lives in
// `windows_impl` (NT/kernel32/libuv triad) below; these `#[cfg(unix)]` impls
// match `src/sys/sys.zig` posix arms 1:1.
// ──────────────────────────────────────────────────────────────────────────
use bun_core::ZStr;

/// Read thread-local libc errno (set by the failing syscall).
/// Zig: `std.c._errno().*` (sys.zig). On Windows this reads the CRT's
/// thread-local `_errno()`; libuv-backed paths that need Win32
/// `GetLastError()` go through `bun_sys::windows::get_last_errno` instead.
#[inline]
pub fn last_errno() -> i32 {
    bun_core::ffi::errno()
}

/// `std.c._errno()` — pointer to thread-local errno. Prefer `last_errno()`
/// for the value; this exists for callers that match the Zig `*_errno()` API
/// shape (`unsafe { *bun_sys::errno() }`).
#[cfg(unix)]
#[inline]
pub fn errno() -> *mut i32 {
    // `errno_ptr()` is a `safe fn` (its `__errno_location`/`__error`/`_errno`
    // extern is declared `safe fn` — no args, never null); obtaining the
    // pointer has no preconditions. The deref obligation lives at the call site.
    bun_core::ffi::errno_ptr()
}

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
    pub const getrlimit: Tag = Tag(105);
    pub const setrlimit: Tag = Tag(106);
    // PORT NOTE: sys.zig folds `inotify_init1`/`inotify_add_watch` under the
    // generic `.watch` tag; `INotifyWatcher.rs` was ported against the
    // draft-b1 enum that had a distinct `.inotify` variant. Alias to `.watch`
    // so the JS-facing `err.syscall == "watch"` string stays node-compatible.
    pub const inotify: Tag = Tag::watch;

    /// `@tagName(self)` — must match sys.zig spelling exactly (JS-facing
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
    #[inline]
    fn from(t: Tag) -> &'static str {
        t.name()
    }
}

/// Max single read/write count (sys.zig:1832): Linux caps at 0x7ffff000;
/// Darwin/BSD use signed 32-bit byte counts.
#[cfg(target_os = "linux")]
pub const MAX_COUNT: usize = 0x7ffff000;
#[cfg(all(unix, not(target_os = "linux")))]
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
    unsafe extern "C" {
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
        pub(crate) safe fn fallocate(
            fd: c_int,
            mode: c_int,
            off: libc::off_t,
            len: libc::off_t,
        ) -> c_int;
        // BSD/Linux event-queue / notification syscalls — all by-value scalars;
        // bad args → errno (`EINVAL`/`EMFILE`/…), never UB. Declared without
        // per-target `#[cfg]` (matching `fallocate` above): unused externs do
        // not generate linker references, and every caller is cfg-gated.
        pub(crate) safe fn kqueue() -> c_int;
        pub(crate) safe fn epoll_create1(flags: c_int) -> c_int;
        pub(crate) safe fn eventfd(initval: libc::c_uint, flags: c_int) -> c_int;
        pub(crate) safe fn inotify_init1(flags: c_int) -> c_int;
        // bionic declares `wd` as `uint32_t`, glibc/musl as `int`; the kernel
        // ABI is the same `__s32` either way, so a `c_int` decl is ABI-correct
        // on every Linux libc.
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

// ── Darwin `$NOCANCEL` syscall variants (sys.zig:1708,1853,2077,2139,2253,2297)
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
        // came out unreadable). Must be `...` (matches Zig's `std.c.open`).
        // x86-64-macOS and the Linux syscall path tolerate the non-variadic
        // form; arm64-macOS does not.
        #[link_name = "open$NOCANCEL"]
        pub(crate) fn open(path: *const libc::c_char, flags: c_int, ...) -> c_int;
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
        #[link_name = "ppoll$NOCANCEL"]
        pub(crate) fn ppoll(
            fds: *mut libc::pollfd,
            nfds: libc::nfds_t,
            ts: *const libc::timespec,
            sigmask: *const libc::sigset_t,
        ) -> c_int;
        // darwin.zig:12-17 + fd.zig:273 — remaining `$NOCANCEL` variants Bun
        // links against (close via Zig's std.c on Darwin).
        // safe: by-value `c_int` fd; bad fd → -1/EBADF, no UB.
        #[link_name = "close$NOCANCEL"]
        pub(crate) safe fn close(fd: c_int) -> c_int;
        #[link_name = "fcntl$NOCANCEL"]
        pub(crate) fn fcntl(fd: c_int, cmd: c_int, ...) -> c_int;
        #[link_name = "connect$NOCANCEL"]
        pub(crate) fn connect(
            sockfd: c_int,
            addr: *const libc::sockaddr,
            alen: libc::socklen_t,
        ) -> c_int;
        #[link_name = "accept$NOCANCEL"]
        pub(crate) fn accept(
            sockfd: c_int,
            addr: *mut libc::sockaddr,
            alen: *mut libc::socklen_t,
        ) -> c_int;
        #[link_name = "accept4$NOCANCEL"]
        pub(crate) fn accept4(
            sockfd: c_int,
            addr: *mut libc::sockaddr,
            alen: *mut libc::socklen_t,
            flags: libc::c_uint,
        ) -> c_int;
    }
}

#[cfg(unix)]
mod posix_impl {
    use super::*;
    // Per-platform raw syscall dispatch — macOS uses `$NOCANCEL`; Linux goes
    // through rustix's linux_raw backend (no libc trampoline, matching Zig's
    // `std.os.linux`); other POSIX falls back to libc. The Linux hot paths
    // (open/openat/read/write/close/pread/pwrite/fstat) bypass these `sys_*`
    // dispatchers entirely — see the `#[cfg(target_os = "linux")]` arms on
    // each public fn below — because rustix returns the errno in-band and we
    // don't want to round-trip through thread-local `errno`.
    #[cfg(not(target_os = "linux"))]
    #[inline]
    unsafe fn sys_openat(d: i32, p: *const libc::c_char, f: i32, m: libc::c_uint) -> i32 {
        #[cfg(target_os = "macos")]
        {
            unsafe { super::nocancel::openat(d, p, f, m) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            unsafe { libc::openat(d, p, f, m) }
        }
    }
    #[cfg(not(target_os = "linux"))]
    #[inline]
    unsafe fn sys_read(fd: i32, buf: *mut libc::c_void, n: usize) -> isize {
        #[cfg(target_os = "macos")]
        {
            unsafe { super::nocancel::read(fd, buf, n) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            unsafe { libc::read(fd, buf, n) }
        }
    }
    #[cfg(not(target_os = "linux"))]
    #[inline]
    unsafe fn sys_write(fd: i32, buf: *const libc::c_void, n: usize) -> isize {
        #[cfg(target_os = "macos")]
        {
            unsafe { super::nocancel::write(fd, buf, n) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            unsafe { libc::write(fd, buf, n) }
        }
    }
    #[cfg(not(target_os = "linux"))]
    #[inline]
    unsafe fn sys_pread(fd: i32, buf: *mut libc::c_void, n: usize, off: i64) -> isize {
        #[cfg(target_os = "macos")]
        {
            unsafe { super::nocancel::pread(fd, buf, n, off) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            unsafe { libc::pread(fd, buf, n, off) }
        }
    }
    #[cfg(not(target_os = "linux"))]
    #[inline]
    unsafe fn sys_pwrite(fd: i32, buf: *const libc::c_void, n: usize, off: i64) -> isize {
        #[cfg(target_os = "macos")]
        {
            unsafe { super::nocancel::pwrite(fd, buf, n, off) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            unsafe { libc::pwrite(fd, buf, n, off) }
        }
    }
    #[inline]
    unsafe fn sys_recv(fd: i32, buf: *mut libc::c_void, n: usize, flags: i32) -> isize {
        #[cfg(target_os = "macos")]
        {
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
            unsafe { libc::recv(fd, buf, n, flags) }
        }
    }
    #[inline]
    unsafe fn sys_send(fd: i32, buf: *const libc::c_void, n: usize, flags: i32) -> isize {
        #[cfg(target_os = "macos")]
        {
            unsafe { super::nocancel::sendto(fd, buf, n, flags, core::ptr::null(), 0) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            unsafe { libc::send(fd, buf, n, flags) }
        }
    }
    // EINTR-retry: most sys.zig wrappers loop `while (true) { …; if errno ==
    // .INTR continue; }`. NOT all — the macOS `$NOCANCEL` arms for open/openat/
    // read/write/recv/send (sys.zig:1706-1712,1851-1860,2138-2147,2252-2262,
    // 2294-2306) issue exactly one call and surface EINTR to the caller without
    // looping. `check!` keeps the retry for the common path; `check_once!`
    // matches the spec's single-shot Darwin arms.
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
    // `errnoSysFP` (runtime/node.zig:296) — attaches BOTH `.fd` and `.path`.
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
    macro_rules! check_once {
        ($rc:expr, $tag:expr) => {{
            let rc = $rc;
            if rc < 0 {
                return Err(Error::from_code_int(last_errno(), $tag));
            }
            rc
        }};
    }
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
        // sys.zig:1820 — `open()` is `openat(.cwd(), ..)` on every POSIX target
        // ("this is what open() does anyway"). Delegating keeps the strace/SYS
        // shape identical to Zig: `openat(AT_FDCWD, ..)` on Linux/FreeBSD,
        // `openat$NOCANCEL(AT_FDCWD, ..)` on Darwin.
        openat(Fd::cwd(), path, flags, mode)
    }
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        // sys.zig:1706-1712 — .mac arm: single `openat$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        {
            let rc = check_once_p!(
                unsafe { sys_openat(dir.native(), path.as_ptr(), flags, mode as libc::c_uint) },
                Tag::open,
                path
            );
            Ok(Fd::from_native(rc))
        }
        #[cfg(target_os = "linux")]
        {
            super::linux_syscall::openat(dir, path, flags, mode)
                .map_err(|e| Error::from_code_int(e, Tag::open).with_path(path.as_bytes()))
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let rc = check_p!(
                unsafe { sys_openat(dir.native(), path.as_ptr(), flags, mode as libc::c_uint) },
                Tag::open,
                path
            );
            Ok(Fd::from_native(rc))
        }
    }
    pub fn close(fd: Fd) -> Maybe<()> {
        // fd.zig:266 — call close ONCE; never retry on EINTR (Linux may have already
        // released the fd, retrying would close someone else's). Only EBADF surfaces.
        // fd.zig:273 — Darwin uses `close$NOCANCEL` (avoid pthread cancellation point).
        #[cfg(target_os = "linux")]
        {
            return match super::linux_syscall::close(fd.native()) {
                Err(e) if e == libc::EBADF => {
                    Err(Error::from_code_int(libc::EBADF, Tag::close).with_fd(fd))
                }
                _ => Ok(()),
            };
        }
        #[cfg(not(target_os = "linux"))]
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
        // sys.zig:2138-2147 — .mac arm: single `read$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        {
            let n = check_once!(
                unsafe { sys_read(fd.native(), buf.as_mut_ptr().cast(), len) },
                Tag::read
            );
            Ok(n as usize)
        }
        #[cfg(target_os = "linux")]
        {
            super::linux_syscall::read(fd, &mut buf[..len])
                .map_err(|e| Error::from_code_int(e, Tag::read))
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
        // sys.zig:1851-1860 — .mac arm: single `write$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        {
            let n = check_once!(
                unsafe { sys_write(fd.native(), buf.as_ptr().cast(), len) },
                Tag::write
            );
            Ok(n as usize)
        }
        #[cfg(target_os = "linux")]
        {
            super::linux_syscall::write(fd, &buf[..len])
                .map_err(|e| Error::from_code_int(e, Tag::write))
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
        #[cfg(target_os = "linux")]
        {
            return super::linux_syscall::pread(fd, &mut buf[..len], off)
                .map_err(|e| Error::from_code_int(e, Tag::pread));
        }
        #[cfg(not(target_os = "linux"))]
        {
            let n = check!(
                unsafe { sys_pread(fd.native(), buf.as_mut_ptr().cast(), len, off) },
                Tag::pread
            );
            Ok(n as usize)
        }
    }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        #[cfg(target_os = "linux")]
        {
            return super::linux_syscall::pwrite(fd, &buf[..len], off)
                .map_err(|e| Error::from_code_int(e, Tag::pwrite));
        }
        #[cfg(not(target_os = "linux"))]
        {
            let n = check!(
                unsafe { sys_pwrite(fd.native(), buf.as_ptr().cast(), len, off) },
                Tag::pwrite
            );
            Ok(n as usize)
        }
    }
    pub fn stat(path: &ZStr) -> Maybe<Stat> {
        #[cfg(target_os = "linux")]
        {
            return super::linux_syscall::stat(path)
                .map_err(|e| Error::from_code_int(e, Tag::stat).with_path(path.as_bytes()));
        }
        #[cfg(not(target_os = "linux"))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check_p!(
                unsafe { libc::stat(path.as_ptr(), st.as_mut_ptr()) },
                Tag::stat,
                path
            );
            Ok(unsafe { st.assume_init() })
        }
    }
    pub fn fstat(fd: Fd) -> Maybe<Stat> {
        #[cfg(target_os = "linux")]
        {
            return super::linux_syscall::fstat(fd)
                .map_err(|e| Error::from_code_int(e, Tag::fstat));
        }
        #[cfg(not(target_os = "linux"))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check!(
                unsafe { libc::fstat(fd.native(), st.as_mut_ptr()) },
                Tag::fstat
            );
            Ok(unsafe { st.assume_init() })
        }
    }
    pub fn lstat(path: &ZStr) -> Maybe<Stat> {
        #[cfg(target_os = "linux")]
        {
            return super::linux_syscall::lstat(path)
                .map_err(|e| Error::from_code_int(e, Tag::lstat).with_path(path.as_bytes()));
        }
        #[cfg(not(target_os = "linux"))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check_p!(
                unsafe { libc::lstat(path.as_ptr(), st.as_mut_ptr()) },
                Tag::lstat,
                path
            );
            Ok(unsafe { st.assume_init() })
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // statx (Linux ≥4.11) — sys.zig:614-791. Exposes `birthtime` for node:fs
    // `Stats`. On non-Linux these are absent (callers gate on `cfg(linux)`).
    //
    // Zig went through `std.os.linux.statx` (a raw `syscall5`), so it works on
    // every Linux ABI. The Rust port uses `libc::statx`, which the `libc` crate
    // only exposes for glibc/Android (and musl behind the build-time
    // `musl_v1_2_3` cfg the cross-compile build never sets). The `linux_statx`
    // shim below smooths that over: glibc/android re-export `libc`, musl gets a
    // hand-rolled struct + raw-`syscall(SYS_statx, …)` wrapper. The kernel ABI
    // (struct layout, `STATX_*` bits) is identical across libcs.
    // ──────────────────────────────────────────────────────────────────────
    #[cfg(target_os = "linux")]
    mod linux_statx {
        // glibc / Android: libc 0.2.x exposes the full surface directly.
        #[cfg(not(target_env = "musl"))]
        pub(super) use libc::{
            AT_STATX_SYNC_AS_STAT, STATX_ATIME, STATX_BLOCKS, STATX_BTIME, STATX_CTIME, STATX_GID,
            STATX_INO, STATX_MODE, STATX_MTIME, STATX_NLINK, STATX_SIZE, STATX_TYPE, STATX_UID,
            statx,
        };

        // musl: `libc` gates `statx`/`STATX_*` behind a build-script-detected
        // `musl_v1_2_3` cfg that cross-compiles can't trigger. Define the
        // kernel-ABI struct + bits ourselves and dispatch via raw `syscall`,
        // matching what Zig's `std.os.linux.statx` does on every Linux ABI.
        #[cfg(target_env = "musl")]
        mod musl {
            #![allow(non_camel_case_types)]
            use core::ffi::{c_char, c_int, c_uint};

            // Kernel UAPI `<linux/stat.h>` — same on every arch/libc.
            pub(crate) const AT_STATX_SYNC_AS_STAT: c_int = 0x0000;
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
        #[cfg(target_env = "musl")]
        pub(super) use musl::*;
    }
    #[cfg(target_os = "linux")]
    use linux_statx as lx;

    #[cfg(target_os = "linux")]
    pub static SUPPORTS_STATX_ON_LINUX: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(true);

    /// `STATX_*` request mask covering every field `node:fs Stats` consumes
    /// (sys.zig:614 `StatxField` — all variants OR'd, the only mask the Zig
    /// callers ever pass).
    #[cfg(target_os = "linux")]
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
    #[cfg(target_os = "linux")]
    #[inline]
    const fn statx_makedev(major: u32, minor: u32) -> u64 {
        let maj: u64 = (major & 0xFFF) as u64;
        let min: u64 = (minor & 0xFFFFF) as u64;
        (maj << 8) | (min & 0xFF) | ((min & 0xFFF00) << 12)
    }

    #[cfg(target_os = "linux")]
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

    #[cfg(target_os = "linux")]
    fn statx_impl(fd: Fd, path: Option<&ZStr>, flags: c_int, mask: u32) -> Maybe<PosixStat> {
        use core::sync::atomic::Ordering;
        let mut buf = core::mem::MaybeUninit::<lx::statx>::uninit();
        let pathname: *const c_char = match path {
            Some(p) => p.as_ptr(),
            None => b"\0".as_ptr().cast(),
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
                    syscall: Tag::statx,
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

    #[cfg(target_os = "linux")]
    pub fn fstatx(fd: Fd, mask: u32) -> Maybe<PosixStat> {
        statx_impl(fd, None, libc::AT_EMPTY_PATH, mask)
    }
    #[cfg(target_os = "linux")]
    pub fn statx(path: &ZStr, mask: u32) -> Maybe<PosixStat> {
        statx_impl(Fd::from_native(libc::AT_FDCWD), Some(path), 0, mask)
    }
    #[cfg(target_os = "linux")]
    pub fn lstatx(path: &ZStr, mask: u32) -> Maybe<PosixStat> {
        statx_impl(
            Fd::from_native(libc::AT_FDCWD),
            Some(path),
            libc::AT_SYMLINK_NOFOLLOW,
            mask,
        )
    }

    pub fn mkdir(path: &ZStr, mode: Mode) -> Maybe<()> {
        check_p!(
            unsafe { libc::mkdir(path.as_ptr(), mode as libc::mode_t) },
            Tag::mkdir,
            path
        );
        Ok(())
    }
    pub fn mkdirat(dir: Fd, path: &ZStr, mode: Mode) -> Maybe<()> {
        // sys.zig:809 — `mkdiratZ` tags errors as `.mkdir` (not `.mkdirat`).
        check_p!(
            unsafe { libc::mkdirat(dir.native(), path.as_ptr(), mode as libc::mode_t) },
            Tag::mkdir,
            path
        );
        Ok(())
    }
    /// `bun.makePath` — `mkdirat` walking up parents on ENOENT, like `mkdir -p`.
    /// Port of std.fs.Dir.makePath (Zig std/fs/Dir.zig).
    #[inline]
    pub fn mkdir_recursive_at(dir: Fd, sub_path: &[u8]) -> Maybe<()> {
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
                // sys.zig:809 — `mkdiratZ` tags as `.mkdir`; keep consistent here.
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
        check_p!(unsafe { libc::unlink(path.as_ptr()) }, Tag::unlink, path);
        Ok(())
    }
    pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
        check_p!(
            unsafe { libc::rename(from.as_ptr(), to.as_ptr()) },
            Tag::rename,
            from
        );
        Ok(())
    }
    pub fn renameat(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
        check_p!(
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
    /// unix without an atomic-exchange rename get `ENOSYS` when flags are set,
    /// matching `bun.sys.renameat2` (sys.zig:2503).
    pub fn renameat2(
        from_dir: Fd,
        from: &ZStr,
        to_dir: Fd,
        to: &ZStr,
        flags: Renameat2Flags,
    ) -> Maybe<()> {
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
            // SAFETY: FFI; all pointers/fds valid for the duration of the call.
            check_p!(
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
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            if flags.int() != 0 {
                return Err(
                    Error::from_code_int(libc::ENOSYS, Tag::rename).with_path(from.as_bytes())
                );
            }
            renameat(from_dir, from, to_dir, to)
        }
    }
    /// sys.zig:2884 `unlinkatWithFlags` — explicit `flags` (e.g. `AT_REMOVEDIR`).
    /// Zig builds the error via `errnoSysFP(.., .unlink, dirfd, to)` so the
    /// surfaced `SystemError` carries BOTH the dirfd and the path.
    pub fn unlinkat_with_flags(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()> {
        check_fp!(
            unsafe { libc::unlinkat(dir.native(), path.as_ptr(), flags) },
            Tag::unlink,
            dir,
            path
        );
        Ok(())
    }
    /// sys.zig:2912 `unlinkat` — 2-arg form (`flags = 0`). Zig's surface is
    /// 2-arg; the 3-arg variant is `unlinkatWithFlags`.
    #[inline]
    pub fn unlinkat(dir: Fd, path: &ZStr) -> Maybe<()> {
        unlinkat_with_flags(dir, path, 0)
    }
    pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
        check_p!(
            unsafe { libc::symlink(target.as_ptr(), link.as_ptr()) },
            Tag::symlink,
            link
        );
        Ok(())
    }
    pub fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let n = check_p!(
            unsafe { libc::readlink(path.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) },
            Tag::readlink,
            path
        );
        let n = n as usize;
        // sys.zig:2368 — truncation guard + NUL-terminate.
        if n >= buf.len() {
            return Err(
                Error::from_code_int(libc::ENAMETOOLONG, Tag::readlink).with_path(path.as_bytes())
            );
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
        let p = unsafe { libc::getcwd(buf.as_mut_ptr().cast(), buf.len()) };
        if p.is_null() {
            return Err(err_with(Tag::getcwd));
        }
        Ok(unsafe { libc::strlen(p) })
    }

    // ── B-2 round 9: link/perm/time/access group (sys.zig:406-3973 posix arms) ──
    pub fn link(src: &ZStr, dest: &ZStr) -> Maybe<()> {
        check_p!(
            unsafe { libc::link(src.as_ptr(), dest.as_ptr()) },
            Tag::link,
            src
        );
        Ok(())
    }
    pub fn linkat(src_dir: Fd, src: &ZStr, dest_dir: Fd, dest: &ZStr) -> Maybe<()> {
        // sys.zig:3963 — `linkatZ` tags as `.link`.
        check_p!(
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
        check_p!(
            unsafe { libc::symlinkat(target.as_ptr(), dirfd.native(), dest.as_ptr()) },
            Tag::symlinkat,
            dest
        );
        Ok(())
    }
    pub fn readlinkat(fd: Fd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        // sys.zig:2390 — tags as `.readlink`.
        let n = check_p!(
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
            unsafe { libc::chmod(path.as_ptr(), mode as libc::mode_t) },
            Tag::chmod,
            path
        );
        Ok(())
    }
    pub fn fchmodat(dir: Fd, path: &ZStr, mode: Mode, flags: i32) -> Maybe<()> {
        check_p!(
            unsafe { libc::fchmodat(dir.native(), path.as_ptr(), mode as libc::mode_t, flags) },
            Tag::fchmodat,
            path
        );
        Ok(())
    }
    /// `lchmod` is BSD/Darwin-only; Linux: `fchmodat(.., AT_SYMLINK_NOFOLLOW)` (sys.zig:434).
    pub fn lchmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            // The `libc` crate omits the `lchmod` binding on both Darwin
            // (libSystem since 10.5) and FreeBSD (libc since 3.0). Declare
            // locally — matches sys.zig:434.
            unsafe extern "C" {
                fn lchmod(path: *const libc::c_char, mode: libc::mode_t) -> libc::c_int;
            }
            check_p!(
                unsafe { lchmod(path.as_ptr(), mode as libc::mode_t) },
                Tag::lchmod,
                path
            );
            Ok(())
        }
        #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
        {
            fchmodat(Fd::cwd(), path, mode, libc::AT_SYMLINK_NOFOLLOW)
        }
    }
    pub fn chown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        check_p!(
            unsafe { libc::chown(path.as_ptr(), uid, gid) },
            Tag::chown,
            path
        );
        Ok(())
    }
    pub fn lchown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        check_p!(
            unsafe { libc::lchown(path.as_ptr(), uid, gid) },
            Tag::lchown,
            path
        );
        Ok(())
    }
    pub fn fchownat(dir: Fd, path: &ZStr, uid: u32, gid: u32, flags: i32) -> Maybe<()> {
        check_p!(
            unsafe { libc::fchownat(dir.native(), path.as_ptr(), uid, gid, flags) },
            Tag::fchownat,
            path
        );
        Ok(())
    }
    pub fn fstatat(fd: Fd, path: &ZStr) -> Maybe<Stat> {
        // sys.zig:848 — `bun.invalid_fd` means cwd-relative.
        let dirfd = if fd.is_valid() {
            fd.native()
        } else {
            libc::AT_FDCWD
        };
        #[cfg(target_os = "linux")]
        {
            return super::linux_syscall::fstatat(dirfd, path, 0)
                .map_err(|e| Error::from_code_int(e, Tag::fstatat).with_path(path.as_bytes()));
        }
        #[cfg(not(target_os = "linux"))]
        {
            let mut st = core::mem::MaybeUninit::<Stat>::uninit();
            check_p!(
                unsafe { libc::fstatat(dirfd, path.as_ptr(), st.as_mut_ptr(), 0) },
                Tag::fstatat,
                path
            );
            Ok(unsafe { st.assume_init() })
        }
    }
    pub fn access(path: &ZStr, mode: i32) -> Maybe<()> {
        check_p!(
            unsafe { libc::access(path.as_ptr(), mode) },
            Tag::access,
            path
        );
        Ok(())
    }
    /// sys.zig:3504 — never returns `.err`; any non-zero rc → `Ok(false)`.
    pub fn faccessat(dir: Fd, sub: &ZStr) -> Maybe<bool> {
        let rc = unsafe { libc::faccessat(dir.native(), sub.as_ptr(), libc::F_OK, 0) };
        Ok(rc == 0)
    }
    pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check!(
            unsafe { libc::futimens(fd.native(), ts.as_ptr()) },
            Tag::futimens
        );
        Ok(())
    }
    pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check_p!(
            unsafe { libc::utimensat(libc::AT_FDCWD, path.as_ptr(), ts.as_ptr(), 0) },
            Tag::utimensat,
            path
        );
        Ok(())
    }
    pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check_p!(
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
            // `c_char`, not `i8` — `char` is unsigned on aarch64/arm/ppc, so
            // hard-coding `i8` mismatches `ZStr::as_ptr()` (`*const c_char`)
            // there. The C side is `const char*` regardless; `c_char` tracks
            // its platform sign.
            fn is_executable_file(path: *const c_char) -> bool;
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
        if p.is_null() {
            return Err(err_with_path(Tag::realpath, path));
        }
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
    /// sys.zig:3839 — plain `pipe(&fds)`, NO CLOEXEC. Callers that want CLOEXEC
    /// set it themselves (matches Zig).
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
        // node_fs.zig:3921 — calls `system.fdatasync` directly on all Unix
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

    // ── B-2 round 9: socket primitives (recv/send/socketpair) ──
    // Full networking lives in `bun_uws_sys`; these are the bare libc wrappers
    // sys.zig exposes for shell/pipe IPC.
    pub fn recv(fd: Fd, buf: &mut [u8], flags: i32) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        // sys.zig:2252-2262 — isMac arm: single `recvfrom$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let n = check_once!(
            unsafe { sys_recv(fd.native(), buf.as_mut_ptr().cast(), len, flags) },
            Tag::recv
        );
        #[cfg(not(target_os = "macos"))]
        let n = check!(
            unsafe { sys_recv(fd.native(), buf.as_mut_ptr().cast(), len, flags) },
            Tag::recv
        );
        Ok(n as usize)
    }
    pub fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize> {
        // sys.zig:2294-2322 — passes `buf.len` un-clamped (only `recv` clamps via
        // `adjusted_len`); forward the full length and let the kernel decide.
        // isMac arm: single `sendto$NOCANCEL`, no EINTR retry.
        #[cfg(target_os = "macos")]
        let n = check_once!(
            unsafe { sys_send(fd.native(), buf.as_ptr().cast(), buf.len(), flags) },
            Tag::send
        );
        #[cfg(not(target_os = "macos"))]
        let n = check!(
            unsafe { sys_send(fd.native(), buf.as_ptr().cast(), buf.len(), flags) },
            Tag::send
        );
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
    /// sys.zig:3054 `setCloseOnExec` — `fcntl(F_GETFD)` then OR in `FD_CLOEXEC`.
    pub fn set_close_on_exec(fd: Fd) -> Maybe<()> {
        let fl = fcntl(fd, libc::F_GETFD, 0)?;
        fcntl(fd, libc::F_SETFD, fl | libc::FD_CLOEXEC as isize)?;
        Ok(())
    }

    /// sys.zig:3103 `socketpair` — `socketpairImpl(.., for_shell = false)`.
    /// Linux uses `SOCK_CLOEXEC|SOCK_NONBLOCK` type flags; non-Linux sets
    /// CLOEXEC + nonblock + (Darwin) `SO_NOSIGPIPE` per-fd, closing both on
    /// any post-step error.
    pub fn socketpair(domain: i32, ty: i32, proto: i32, nonblock: bool) -> Maybe<[Fd; 2]> {
        socketpair_impl(domain, ty, proto, nonblock, false)
    }

    /// sys.zig:3125 `socketpairForShell` — `socketpairImpl(.., for_shell = true)`.
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

    /// sys.zig:3138 `socketpairImpl`.
    fn socketpair_impl(
        domain: i32,
        ty: i32,
        proto: i32,
        nonblock: bool,
        for_shell: bool,
    ) -> Maybe<[Fd; 2]> {
        let _ = for_shell; // only meaningful on macOS
        let mut fds = [0i32; 2];
        #[cfg(target_os = "linux")]
        {
            let ty = ty | libc::SOCK_CLOEXEC | if nonblock { libc::SOCK_NONBLOCK } else { 0 };
            check!(
                safe_libc::socketpair(domain, ty, proto, &mut fds),
                Tag::socketpair
            );
        }
        #[cfg(not(target_os = "linux"))]
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
            // CLOEXEC first (sys.zig:3173).
            for &fd in &fds {
                if let Err(e) = set_close_on_exec(Fd::from_native(fd)) {
                    return close_both(e);
                }
            }
            // Darwin: SO_NOSIGPIPE on both fds — unless `for_shell`, in which
            // case bump RCVBUF/SNDBUF instead (sys.zig:3180-3199).
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
                    let fl = unsafe { libc::fcntl(fd, libc::F_GETFL) };
                    if fl < 0
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
    #[cfg(target_os = "linux")]
    pub fn pidfd_open(pid: libc::pid_t, flags: u32) -> Maybe<Fd> {
        super::linux_syscall::pidfd_open(pid, flags)
            .map_err(|e| Error::from_code_int(e, Tag::pidfd_open))
    }

    // ── B-2 round 9: macOS clonefile / copyfile ──
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
                unsafe { clonefile(from.as_ptr(), to.as_ptr(), 0) },
                Tag::clonefile,
                from
            );
            Ok(())
        }
        pub fn clonefileat_(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
            check_p!(
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

    // ── B-2 round 9: mmap/munmap ──
    pub fn mmap(
        addr: *mut u8,
        len: usize,
        prot: i32,
        flags: i32,
        fd: Fd,
        off: i64,
    ) -> Maybe<*mut u8> {
        let p = unsafe { libc::mmap(addr.cast(), len, prot, flags, fd.native(), off) };
        if p == libc::MAP_FAILED {
            return Err(err_with(Tag::mmap));
        }
        Ok(p.cast())
    }
    pub fn munmap(ptr: *mut u8, len: usize) -> Maybe<()> {
        check!(unsafe { libc::munmap(ptr.cast(), len) }, Tag::munmap);
        Ok(())
    }

    /// `bun.sys.mmapFile` — open `path` RDWR, fstat for size, mmap [offset, offset+len).
    /// Returns a process-lifetime mmap slice; caller is responsible for
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
        let _close = CloseOnDrop::new(fd);

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
    static MEMFD_ENOSYS: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(false);

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
    pub fn can_use_memfd() -> bool {
        false
    }

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

    /// sys.zig:504 — `sendfile(src, dest, len)`. Clamps `len` (avoid EINVAL on
    /// >2GB), EINTR-retries, and attaches the *source* fd to the error
    /// (sys.zig:513 `errnoSysFd(rc, .sendfile, src)`).
    #[cfg(target_os = "linux")]
    pub fn sendfile(src: Fd, dest: Fd, len: usize) -> Maybe<usize> {
        let len = len.min(i32::MAX as usize - 1);
        loop {
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
    #[cfg(all(unix, not(target_os = "linux")))]
    pub fn sendfile(src: Fd, _dest: Fd, _len: usize) -> Maybe<usize> {
        // sys.zig:513 `errnoSysFd(rc, .sendfile, src)` — attach the *source* fd.
        Err(Error::from_code_int(libc::ENOSYS, Tag::sendfile).with_fd(src))
    }
}
#[cfg(unix)]
pub use posix_impl::*;

// D034: canonical lives in the leaf crate (cached via OnceLock); the per-platform
// impls in posix_impl/windows_impl were uncached duplicates.
pub use bun_alloc::page_size;

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
    pub const NOW: Self = Self {
        sec: 0,
        nsec: UTIME_NOW,
    };
    pub const OMIT: Self = Self {
        sec: 0,
        nsec: UTIME_OMIT,
    };
    #[inline]
    pub fn to_timespec(self) -> libc::timespec {
        libc::timespec {
            tv_sec: self.sec as _,
            tv_nsec: self.nsec as _,
        }
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

/// Zig: `pub const sys_uv = if (Environment.isWindows) @import("./sys_uv.zig") else sys;`
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
    // PORT: NT/kernel32/libuv triad (sys.zig + sys_uv.zig). The libuv-backed ops
    // delegate to `crate::sys_uv`; the rest are the windows arms of `sys.zig`.
    use super::windows as w;
    use super::windows::libuv as uv;
    use super::*;
    use bun_paths::WPathBuffer;

    // ── libuv-backed (sys_uv.zig) ────────────────────────────────────────
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
        // sys.zig:2161-2183 — `.windows => if (fd.kind == .uv) sys_uv.read(fd,
        // buf) else { kernel32.ReadFile(fd.native(), …) }`. The libuv path
        // requires a CRT fd via `fd.uv()`, which PANICS for HANDLE-backed
        // (`FdKind::System`) Fds — i.e. anything from `openat()`/NtCreateFile.
        if fd.kind() == FdKind::Uv {
            return sys_uv::read(fd, buf);
        }
        let adjusted_len = buf.len().min(MAX_COUNT) as w::DWORD;
        // PORT NOTE: the Zig spec for `bun.sys.read` returns the raw error, but
        // every Zig stdin caller (`run_command.zig`, `prompt.zig`, `init`, …)
        // routes through `std.fs.File.readerStreaming` → `std.os.windows.ReadFile`,
        // which maps BROKEN_PIPE/HANDLE_EOF → 0 (EOF) and retries on
        // OPERATION_ABORTED. The Rust port consolidated those callers onto this
        // function (via `File::stdin().read_to_end_into` / `output_sink().read`),
        // so the stdlib-ReadFile EOF handling lives here.
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
        // sys.zig:1876-1909 — `.windows => { kernel32.WriteFile(fd.cast(), …) }`
        // (NOT via libuv — sys_uv::write → fd.uv() panics for HANDLE-backed
        // Fds). Spec also remaps `ERROR_ACCESS_DENIED → EBADF` (a write to a
        // read-only-opened HANDLE yields ACCESS_DENIED, which POSIX surfaces
        // as EBADF "fd not open for writing").
        debug_assert!(!buf.is_empty()); // Zig: `bun.assert(bytes.len > 0)`
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
        // sys.zig:2083 — `pread_sym = syscall.pread` (`@compileError` on
        // Windows), so `bun.sys.pread` itself is uncallable there. The Zig
        // call sites that need positioned I/O on a HANDLE-backed fd go via
        // `fd.stdFile().preadAll()` → `std.os.windows.ReadFile` with an
        // `OVERLAPPED.Offset`. The Rust port has no `stdFile()` escape hatch
        // (`File::pread_all` routes back here), so do that lowering inline:
        // libuv path for uv-kind fds, kernel32 ReadFile+OVERLAPPED for system
        // (HANDLE) fds — matching `std.os.windows.ReadFile`'s error mapping.
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
                    // std.os.windows.ReadFile: BROKEN_PIPE/HANDLE_EOF → 0.
                    w::Win32Error::BROKEN_PIPE | w::Win32Error::HANDLE_EOF => return Ok(0),
                    w::Win32Error::OPERATION_ABORTED => continue,
                    _ => return Err(Error::new(er.to_e(), Tag::pread).with_fd(fd)),
                }
            }
            return Ok(amount_read as usize);
        }
    }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
        // sys.zig:2108 — same `@compileError` story as `pread`. Zig callers
        // (e.g. updatePackageJSONAndInstall.zig:426 `…stdFile().pwriteAll()`)
        // reach `std.os.windows.WriteFile` with an `OVERLAPPED.Offset`; do
        // that here for HANDLE-kind fds since `File::pwrite_all` routes back.
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
            // std.os.windows.WriteFile maps INVALID_HANDLE → NotOpenForWriting;
            // keep parity with `write()` above and surface the raw errno.
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
        // sys.zig:589-594 — `const uvfd = fd.makeLibUVOwned() catch return
        // .err(.MFILE, .uv_open_osfhandle); return sys_uv.fstat(uvfd);`.
        // sys_uv::fstat does `fd.uv()` which PANICS for HANDLE-backed
        // (`FdKind::System`) Fds — i.e. the result of `openat()`. The spec
        // converts via `_open_osfhandle` first (acknowledged CRT-fd leak; see
        // the `// TODO: this is a bad usage of makeLibUVOwned` in sys.zig —
        // a leak is strictly better than the previous guaranteed panic).
        let uvfd = fd
            .make_libuv_owned()
            .map_err(|_| Error::new(E::EMFILE, Tag::uv_open_osfhandle).with_fd(fd))?;
        sys_uv::fstat(uvfd)
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
        // sys.zig:2629 — windows uses `sys_uv.symlinkUV(target, dest, 0)`.
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
        // sys.zig:2403-2419 — windows arm calls `NtSetInformationFile(..,
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
            // sys.zig:2487 `Maybe(void).errnoSysFd(rc, .ftruncate, fd)` —
            // `errnoSys` for `NTSTATUS` routes through the curated
            // `translateNTStatusToErrno` table, NOT `RtlNtStatusToDosError`.
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

    // ── kernel32 / ntdll arms (sys.zig windows branches) ─────────────────
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        // sys.zig:1773 — `if (Environment.isWindows) return openatWindowsT(u8,
        // dirfd, file_path, flags, perm)`. Route through the NtCreateFile path
        // (normalize → `open_file_at_windows_nt_path`) so the result is a
        // HANDLE-backed `Fd` and `O::DIRECTORY`/`O::NOFOLLOW`/`O::PATH` are
        // honoured. Do NOT fall back to libuv `open()` here — that returns a
        // CRT-fd-backed `Fd` and ignores the directory/nofollow flags.
        super::openat_windows_a(dir, path.as_bytes(), flags, mode)
    }
    pub fn dup(fd: Fd) -> Maybe<Fd> {
        // sys.zig:3911 — DuplicateHandle on the underlying HANDLE.
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
        // No POSIX dup2 on Windows; sys.zig only dispatches via libuv c-runtime fds.
        // Return ENOTSUP so callers that branch on platform fall back.
        let _ = (old, new);
        Err(Error::new(E::ENOTSUP, Tag::dup2))
    }
    pub fn getcwd(buf: &mut [u8]) -> Maybe<usize> {
        // sys.zig:349 — GetCurrentDirectoryW + WTF16→UTF8.
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
    pub fn mkdirat(dir: Fd, path: &ZStr, _mode: Mode) -> Maybe<()> {
        // sys.zig:829 mkdiratW — `openDirAtWindowsNtPath(dir, path,
        // .{ .iterable = false, .can_rename_or_delete = true, .op = .only_create })`
        // then close the resulting handle on success.
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
    pub fn renameat(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
        // sys.zig:2572 — windows arm goes through renameAtW.
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
    /// sys.zig:2912 `unlinkat` — 2-arg form (`flags = 0`).
    #[inline]
    pub fn unlinkat(dir: Fd, path: &ZStr) -> Maybe<()> {
        unlinkat_with_flags(dir, path, 0)
    }
    #[inline]
    pub fn mkdir_recursive_at(dir: Fd, sub: &[u8]) -> Maybe<()> {
        mkdir_recursive_at_mode(dir, sub, 0o777)
    }
    pub fn mkdir_recursive_at_mode(dir: Fd, sub: &[u8], mode: Mode) -> Maybe<()> {
        // Port of `bun.makePath` (bun.zig:2288). The component-splitting and
        // back-then-forward walk live in `bun_paths::{ComponentIterator,
        // make_path_with}` (faithful `std.fs.path.ComponentIterator` port — it
        // never yields a bare `"C:"` / `"\\server\share"` root, which is what
        // broke the old forward-split impl for absolute paths fed by
        // `bin::Linker::create_windows_shim`).
        //
        // What stays here is a `.`/`..` *pre-normalize* pass: Zig's
        // `std.fs.Dir.makePath` calls `std.posix.mkdirat`, which on Windows
        // normalizes each prefix through `sliceToPrefixedFileW` →
        // `removeDotDirsSanitized` / `RtlGetFullPathName_U`, collapsing every
        // `.` and `..` before `NtCreateFile`. Our `mkdirat` below routes
        // through bun's `to_nt_path` which only flips slashes, so a literal
        // `"."`/`".."` ObjectName reaches `NtCreateFile` un-normalized — `.`
        // → `OBJECT_NAME_NOT_FOUND` (ENOENT, not the EEXIST the walk expects)
        // and `a\..\b` live-locks the walk. Normalizing here matches the
        // stdlib's effective behavior (compile-outfile-subdirs.test.ts
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
    pub fn linkat(src_dir: Fd, src: &ZStr, dest_dir: Fd, dest: &ZStr) -> Maybe<()> {
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
        // sys.zig:3973 — `if (!Environment.isLinux) @compileError("Linux only")`.
        Err(Error::new(E::ENOTSUP, Tag::link))
    }
    pub fn symlinkat(target: &ZStr, dirfd: Fd, dest: &ZStr) -> Maybe<()> {
        // sys.zig:2641 — windows: resolve `dest` against `dirfd`, then symlinkUV.
        let mut db = bun_core::PathBuffer::default();
        let d = super::get_fd_path(dirfd, &mut db)?;
        let mut dj = bun_core::PathBuffer::default();
        let d_abs = bun_paths::resolve_path::join_string_buf_z::<bun_paths::platform::Windows>(
            &mut dj.0,
            &[d, dest.as_bytes()],
        );
        sys_uv::symlink_uv(target, d_abs, 0)
    }
    pub fn readlinkat(fd: Fd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
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
    pub fn fchmodat(dir: Fd, path: &ZStr, mode: Mode, _flags: i32) -> Maybe<()> {
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
    pub fn faccessat(dir: Fd, sub: &ZStr) -> Maybe<bool> {
        // sys.zig:3504-3531 — `faccessat` NEVER returns `.err`: rc==0 → `.result
        // = true`, else → `.result = false` regardless of errno. There is no
        // dedicated windows arm in the spec; collapse all errors to `Ok(false)`.
        match openat(dir, sub, O::RDONLY, 0) {
            Ok(fd) => {
                let _ = close(fd);
                Ok(true)
            }
            Err(_) => Ok(false),
        }
    }
    pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        // sys.zig:3612 has `@compileError("TODO: futimens")` on Windows; the
        // libuv path here predates the spec port. `uv_fs_futime` takes a CRT
        // fd, and `fd.uv()` PANICS for HANDLE-backed (`FdKind::System`) Fds.
        // Convert via `make_libuv_owned()` first (passes uv-backed Fds through
        // unchanged) so an `openat()` result no longer crashes.
        let uvfd = fd
            .make_libuv_owned()
            .map_err(|_| Error::new(E::EMFILE, Tag::uv_open_osfhandle).with_fd(fd))?;
        let a = atime.sec as f64 + atime.nsec as f64 / 1e9;
        let m = mtime.sec as f64 + mtime.nsec as f64 / 1e9;
        let mut req = uv::fs_t::uninitialized();
        let rc =
            unsafe { uv::uv_fs_futime(core::ptr::null_mut(), &mut req, uvfd.uv(), a, m, None) };
        // Zig: `defer req.deinit()` — fs_t has no Drop impl; uv_fs_req_cleanup
        // must run before any return (fd-based, so no path buffer is captured,
        // but keep the pattern uniform with utimens/lutimens below).
        req.deinit();
        if let Some(err) = Error::from_uv_rc(rc, Tag::futimens) {
            return Err(err.with_fd(fd));
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
        // Zig: `defer req.deinit()` — uv_fs_utime runs fs__capture_path which
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
        // Zig: `defer req.deinit()` — same fs__capture_path leak as utimens.
        req.deinit();
        if let Some(err) = Error::from_uv_rc(rc, Tag::lutime) {
            return Err(err.with_path(path.as_bytes()));
        }
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
        matches!(
            super::exists_at_type(dir, sub),
            Ok(super::ExistsAtType::File)
        )
    }
    pub fn is_executable_file_path(path: &ZStr) -> bool {
        // sys.zig:3779-3784 — windows arm: convert to wide and call
        // `bun.windows.SaferiIsExecutableFileType(path, FALSE)`. Honors the
        // system security policy and recognizes `.js/.lnk/.pif/.pl/.shs/.url/
        // .vbs/...` in addition to `.exe/.cmd/.bat/.com` (per the comment block
        // at sys.zig:3744-3761). Do NOT hand-roll an extension whitelist —
        // PORTING.md §Forbidden bars re-implementing linked OS API surface.
        let mut wbuf = WPathBuffer::default();
        let wpath = bun_paths::string_paths::to_w_path(&mut wbuf, path.as_bytes());
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
        // sys.zig:4217 `@intCast(@max(size, 0))` — clamp defensively so a
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
        // sys.zig:959 — `if (Environment.isWindows) @compileError("not implemented")`.
        Err(Error::new(E::ENOTSUP, Tag::fcntl))
    }
    pub fn pipe() -> Maybe<[Fd; 2]> {
        // sys.zig:3839 — windows: uv_pipe(fds, 0, 0).
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
        // sys.zig:2339 — windows: SetFilePointerEx.
        let mut new: i64 = 0;
        let ok = unsafe {
            w::SetFilePointerEx(fd.native() as w::HANDLE, offset, &mut new, whence as u32)
        };
        if ok == 0 {
            return Err(Error::new(w::get_last_errno(), Tag::lseek).with_fd(fd));
        }
        Ok(new)
    }
    /// sys.zig:3822 `setFileOffsetToEndWindows` — `SetFilePointerEx(.., FILE_END)`
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
        // sys.zig:452-455 — windows: `SetCurrentDirectoryW(toWDirPath(..))`.
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
        // sys.zig: `_umask` (msvcrt).
        unsafe extern "C" {
            safe fn _umask(m: core::ffi::c_int) -> core::ffi::c_int;
        }
        _umask(mode as core::ffi::c_int) as Mode
    }
    pub fn recv(fd: Fd, buf: &mut [u8], flags: i32) -> Maybe<usize> {
        // sys.zig:2243-2244 — windows: winsock `recv`. Winsock's `len` is a
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
        // sys.zig:2294 — windows: winsock `send`. Clamp to `i32::MAX` so the
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
        // sys.zig:3103 — `if (Environment.isWindows) @compileError("use spawnIPCSocket on Windows")`.
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
            buf.reserve(grow_by);
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
// not written through). On Windows the Zig original aliases `uv_buf_t`;
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
        #[cfg(target_os = "linux")]
        {
            // SAFETY: `PlatformIoVecConst` is layout-identical to `libc::iovec`.
            return unsafe {
                linux_syscall::pwritev(fd, vecs.as_ptr().cast::<libc::iovec>(), vecs.len(), offset)
            }
            .map_err(|e| Error::from_code_int(e, Tag::pwritev));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
        // sys.zig:1953 — `if (Environment.isWindows) return sys_uv.pwritev(...)`.
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
// Zig spells these `PlatformIOVec` / `PlatformIOVecConst`; provide both
// casings so phase-A drafts (`sys_uv.rs`) compile without churn.
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
        // POSIX iovec. Zig: `comptime bun.assert(bun.PlatformIOVec == uv.uv_buf_t)`.
        PlatformIoVec {
            len: buf.len() as bun_libuv_sys::ULONG,
            base: buf.as_mut_ptr(),
        }
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
        #[cfg(target_os = "linux")]
        {
            // SAFETY: `PlatformIoVec` is `libc::iovec`.
            return unsafe { linux_syscall::writev(fd, vecs.as_ptr(), vecs.len()) }
                .map_err(|e| Error::from_code_int(e, Tag::writev).with_fd(fd));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
        #[cfg(target_os = "linux")]
        {
            // SAFETY: `PlatformIoVec` is `libc::iovec`.
            return unsafe { linux_syscall::readv(fd, vecs.as_ptr(), vecs.len()) }
                .map_err(|e| Error::from_code_int(e, Tag::readv).with_fd(fd));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
        #[cfg(target_os = "linux")]
        {
            // SAFETY: `PlatformIoVec` is `libc::iovec`.
            return unsafe { linux_syscall::preadv(fd, vecs.as_ptr(), vecs.len(), position) }
                .map_err(|e| Error::from_code_int(e, Tag::preadv).with_fd(fd));
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
        let mut st: StatFS = unsafe { bun_core::ffi::zeroed_unchecked() };
        let rc = unsafe { libc::statfs(path.as_ptr(), &raw mut st) };
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
/// `crate::Timespec` (matching the Zig `bun.timespec` namespacing).
pub use bun_core::Timespec;
/// `std.time` shim — re-exported from `bun_core` so callers that wrote
/// `bun_sys::time::timestamp()` (matching Zig's `std.time` import via bun.sys)
/// resolve without an extra dep.
pub use bun_core::time;

/// `bun.sys.selfProcessMemoryUsage()` — returns the resident set size of the
/// current process in bytes, or `None` on failure. Thin wrapper around the
/// C++ `getRSS` shim (lives in `src/jsc/bindings/memory.cpp`).
pub fn self_process_memory_usage() -> Option<usize> {
    // TODO(port): move to <area>_sys
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

/// `bun.sys.PosixStat` — uv-shaped stat struct (`src/sys/PosixStat.zig`).
/// Re-exported here so dependents (`node_fs.rs`, `Stat.rs`) can spell
/// `bun_sys::PosixStat` exactly as the Zig source spells `bun.sys.PosixStat`.
#[path = "PosixStat.rs"]
pub mod posix_stat;
pub use posix_stat::PosixStat;
pub use posix_stat::{stat_atime, stat_birthtime, stat_ctime, stat_mtime};

/// `std::io::Write` adapter for `Fd` (used by `File::writer`/`buffered_writer`).
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
/// `std::io::Read` adapter for `Fd` (used by `File::reader`).
/// Port of `File.Reader = std.Io.GenericReader(File, anyerror, stdIoRead)`.
pub struct FileReader(pub Fd);
impl std::io::Read for FileReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        read(self.0, buf).map_err(|e| std::io::Error::from_raw_os_error(e.errno as i32))
    }
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
    #[cfg(unix)]
    pub use libc::fchmod;
    pub use libc::memcmp;
    pub use libc::stat as Stat;
    // `getuid`/`getgid`/`geteuid`/`getegid` take no args and read kernel
    // process state — no preconditions, never fail. Declared locally as
    // `safe fn` (instead of re-exporting the `libc` crate's raw decls) so
    // callers need no per-site proof.
    #[cfg(unix)]
    unsafe extern "C" {
        pub safe fn getuid() -> libc::uid_t;
        pub safe fn getgid() -> libc::gid_t;
        pub safe fn geteuid() -> libc::uid_t;
        pub safe fn getegid() -> libc::gid_t;
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
    /// `std.c.fd_t` / `std.posix.fd_t` — native fd backing int (c_int on POSIX,
    /// HANDLE on Windows). Use `bun_sys::Fd` everywhere else; this raw alias
    /// exists only for direct libc FFI (e.g. `socketpair`).
    #[cfg(unix)]
    #[allow(non_camel_case_types)]
    pub type fd_t = c_int;
    #[cfg(windows)]
    #[allow(non_camel_case_types)]
    pub type fd_t = bun_core::FdNative;
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
    /// libc `__errno_location()` / `__error()` / CRT `_errno()` — pointer to
    /// thread-local errno. Canonical cfg-ladder lives in `bun_core::ffi`.
    #[inline]
    pub fn errno_location() -> *mut c_int {
        // `errno_ptr()` is a `safe fn` (its per-libc TLS-accessor extern is
        // declared `safe fn` — no args, never null); obtaining the pointer has
        // no caller precondition (dereferencing it is what requires care).
        bun_core::ffi::errno_ptr()
    }
    // Win32 file APIs frequently spelled `bun.C.*` in Zig (windows.zig flattens
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

    // ── `bun.c` Darwin surface — translate-c symbols Zig picks up via
    // `@cImport` of system headers. The `libc` crate already binds all of
    // these; re-export so callers (`node_os.rs`, `node_fs.rs`, …) keep a
    // single `bun_sys::c::*` import path matching the Zig namespacing.
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
    // bind the C symbols ourselves (as Zig's `std.c` does) so the workspace
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
    /// 64-bit, so present it as `*const mach_header_64` (Zig's std does the
    /// same cast).
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
        unsafe { libc::kevent(kq, changelist, nchanges, eventlist, nevents, timeout) }
    }

    /// Darwin `sendfile(fd, s, off, *len, *hdtr, flags)`.
    /// NOTE (SendFile.zig:67): on `EINTR`/`EAGAIN` the kernel still writes the
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

    /// `bun.c.dlsymWithHandle` — see macro `dlsym_with_handle!` for the cached
    /// per-symbol form. This is the uncached runtime variant.
    pub unsafe fn dlsym_with_handle(handle: *mut c_void, name: *const c_char) -> *mut c_void {
        // SAFETY: `name` is NUL-terminated and live for the call; `handle`
        // is a live `dlopen` handle or null/RTLD_DEFAULT (caller contract).
        #[cfg(unix)]
        {
            unsafe { libc::dlsym(handle, name) }
        }
        #[cfg(windows)]
        {
            let _ = (handle, name);
            core::ptr::null_mut() /* GetProcAddress in windows mod */
        }
    }

    /// `fork(2)` — POSIX only.
    #[cfg(unix)]
    #[inline]
    pub unsafe fn fork() -> libc::pid_t {
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

// ── `bun.linux` / `std.os.linux` — raw kernel syscalls (Linux + Android). ──
// Android: same kernel ABI; bionic exposes all the libc wrappers used here
// (`inotify_*`, `ppoll`, `epoll_*`, `IN_*`, `EPOLL*`, `FUTEX_*`). Zig kept this
// surface under `Environment.isLinux` (true on Android); list both `target_os`
// values to mirror that.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub mod linux {
    use core::ffi::{c_char, c_int, c_uint, c_void};
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

    /// `std.os.linux.timespec` — Zig-shape (`sec`/`nsec`, no `tv_` prefix).
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

    /// `std.os.linux.E` — errno; aliased to `bun_errno::E`.
    pub type Errno = super::E;
    #[inline]
    pub fn errno() -> c_int {
        super::last_errno()
    }

    /// `std.os.linux.E` — kernel errno enum with unprefixed variants and
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
            // Zig: `if (rc > -4096) @enumFromInt(-rc) else .SUCCESS`.
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
    /// `std.os.linux.EPOLL` — flag/op constants. Exposed both as a module
    /// (`linux::EPOLL::IN`) and flat (`linux::EPOLL_IN`) since callers use both.
    pub mod EPOLL {
        pub const IN: u32 = libc::EPOLLIN as u32;
        pub const OUT: u32 = libc::EPOLLOUT as u32;
        pub const ERR: u32 = libc::EPOLLERR as u32;
        pub const HUP: u32 = libc::EPOLLHUP as u32;
        pub const RDHUP: u32 = libc::EPOLLRDHUP as u32;
        pub const ET: u32 = libc::EPOLLET as u32;
        pub const ONESHOT: u32 = libc::EPOLLONESHOT as u32;
        pub const CTL_ADD: i32 = libc::EPOLL_CTL_ADD;
        pub const CTL_MOD: i32 = libc::EPOLL_CTL_MOD;
        pub const CTL_DEL: i32 = libc::EPOLL_CTL_DEL;
    }
    pub const EPOLL_IN: u32 = EPOLL::IN;
    pub const EPOLL_OUT: u32 = EPOLL::OUT;
    pub const EPOLL_ERR: u32 = EPOLL::ERR;
    pub const EPOLL_HUP: u32 = EPOLL::HUP;
    pub const EPOLL_RDHUP: u32 = EPOLL::RDHUP;
    pub const EPOLL_ET: u32 = EPOLL::ET;
    pub const EPOLL_ONESHOT: u32 = EPOLL::ONESHOT;
    pub const EPOLL_CTL_ADD: i32 = EPOLL::CTL_ADD;
    pub const EPOLL_CTL_MOD: i32 = EPOLL::CTL_MOD;
    pub const EPOLL_CTL_DEL: i32 = EPOLL::CTL_DEL;

    // ── futex ──
    /// `std.os.linux.FUTEX` op (cmd + private flag), packed as Zig does.
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
    // PORT NOTE: Zig's `std.os.linux.futex_*` invoke the kernel directly and
    // return `-errno` on failure. `libc::syscall()` is the *glibc* wrapper —
    // it returns `-1` and sets thread-local errno instead. Translate back to
    // the kernel convention so callers can decode with `E::init(rc)`; without
    // this, every EAGAIN/EINTR from FUTEX_WAIT mis-decodes as EPERM and the
    // ThreadPool worker panics inside its idle wait.
    #[inline]
    pub unsafe fn futex_3arg(uaddr: *const u32, op: FutexOp, val: u32) -> isize {
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
        let rc = unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val, timeout) };
        if rc == -1 {
            -(errno() as isize)
        } else {
            rc as isize
        }
    }

    /// inotify mask flags (`std.os.linux.IN`).
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
        unsafe { libc::inotify_add_watch(fd, path, mask) }
    }
    #[inline]
    pub fn inotify_rm_watch(fd: c_int, wd: c_int) -> c_int {
        // bionic declares `wd` as `uint32_t`, glibc/musl as `int`; the kernel
        // ABI is the same `__s32` either way — `safe_libc::inotify_rm_watch`
        // declares it `c_int`, which is ABI-correct on every Linux libc.
        crate::safe_libc::inotify_rm_watch(fd, wd)
    }
    /// Raw `read(2)` returning kernel `usize` (Zig: `std.os.linux.read`).
    #[inline]
    pub unsafe fn read(fd: c_int, buf: *mut u8, count: usize) -> isize {
        // Raw syscall via rustix; libc-convention return preserved for callers
        // that decode via `GetErrno for isize`.
        unsafe { super::linux_syscall::read_raw(fd, buf, count) }
    }
    /// Raw `sendfile(out, in, *offset, count)` (Zig: `std.os.linux.sendfile`).
    #[inline]
    pub unsafe fn sendfile(out_fd: c_int, in_fd: c_int, offset: *mut i64, count: usize) -> isize {
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
        unsafe { libc::ppoll(fds, nfds as _, timeout, sigmask) }
    }
    #[inline]
    pub unsafe fn epoll_ctl(epfd: c_int, op: c_int, fd: c_int, event: *mut epoll_event) -> c_int {
        unsafe { super::linux_syscall::epoll_ctl(epfd, op, fd, event) }
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
            libc::syscall(
                libc::SYS_ioctl,
                dest_fd.native() as libc::c_long,
                FICLONE,
                src_fd.native() as libc::c_long,
            ) as isize
        }
    }

    /// `std.os.linux.copy_file_range` raw syscall.
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
    use core::marker::{PhantomData, PhantomPinned};

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
    /// `std.c.EVFILT` — kqueue filter constants.
    pub mod EVFILT {
        pub const READ: i16 = libc::EVFILT_READ;
        pub const WRITE: i16 = libc::EVFILT_WRITE;
        pub const VNODE: i16 = libc::EVFILT_VNODE;
        pub const PROC: i16 = libc::EVFILT_PROC;
        pub const SIGNAL: i16 = libc::EVFILT_SIGNAL;
        pub const TIMER: i16 = libc::EVFILT_TIMER;
        pub const USER: i16 = libc::EVFILT_USER;
        pub const MACHPORT: i16 = libc::EVFILT_MACHPORT;
    }
    /// `std.c.EV` — kqueue event flags (Darwin).
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
    /// `std.c.NOTE` — kqueue fflags (Darwin).
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
    }
    /// Re-export of the platform errno enum so `bun_threading::Futex` can
    /// match `c::E::INTR` etc. against `__ulock_*` return codes.
    pub use bun_errno::E;

    /// Thin re-exports so `bun.darwin.ftruncate`/`bun.darwin.truncate` call
    /// sites (blob/copy_file.rs) resolve without a direct `libc` dep.
    pub use libc::{ftruncate, truncate};

    /// `bun.darwin.COPYFILE` — Zig `packed struct(u32)` of <copyfile.h> flags.
    /// Kept as a plain struct + `.bits()` so call sites can use field-init
    /// syntax (matching the Zig); convert to `u32` at the FFI boundary.
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
            (self.acl as u32) << 0
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

    // ── `std.c.UL` / `std.c.ULOp` — Darwin private __ulock_* flags ──
    // <xnu/bsd/sys/ulock.h>. Zig models this as `packed struct(u32)`; we keep
    // a plain struct + `.bits()` so Futex.rs can use field-init syntax (matching
    // the Zig call sites) while the FFI boundary gets the packed u32.
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
        unsafe { __ulock_wait2_raw(flags.bits(), addr, value, timeout_ns, value2) }
    }
    /// # Safety
    /// See `__ulock_wait`.
    #[inline]
    pub unsafe fn __ulock_wake(flags: UL, addr: *const c_void, wake_value: u64) -> i32 {
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

// ── `std.macho` — Mach-O header parsing (subset). ────────────────────────
// Port of the slice of Zig std/macho.zig that `crash_handler.zig` uses to
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
    /// `mach_header_64` and Zig std's `std.macho.mach_header_64`.
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
        /// Zig: `segName()` — segment name with trailing NULs trimmed.
        #[inline]
        pub fn seg_name(&self) -> &[u8] {
            bun_core::slice_to_nul(&self.segname)
        }
    }

    /// Raw `(*const u8, len)` pair so [`LoadCommandIterator`] does not hold a
    /// Rust borrow of its backing buffer. `bun_exe_format::macho` interleaves
    /// iterator reads with in-place mutation of the same `Vec<u8>` (matching
    /// the Zig original, which has no borrow checker); a `&'a [u8]` here would
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
        #[inline]
        pub fn cmdsize(&self) -> u32 {
            self.hdr.cmdsize
        }
        /// Zig: `cast(comptime T: type) ?T` — reinterpret the command bytes
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
            // alignment (mirrors Zig `*align(1) const T`).
            Some(unsafe { core::ptr::read_unaligned(self.data.ptr.cast::<T>()) })
        }
    }

    /// Zig: `std.macho.LoadCommandIterator` — walks the load-command region
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
        let z = ZStr::from_buf(&buf.0[..], len);
        match dlopen(z, RTLD::LAZY) {
            Some(h) => Ok(Self { handle: h }),
            None => Err(bun_core::err!("FileNotFound")),
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
        // monomorphisation. Same contract as Zig `bun.cast(T, ptr)`.
        Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&p) })
    }
    pub fn close(self) {
        #[cfg(unix)]
        unsafe {
            libc::dlclose(self.handle);
        }
        // Windows: FreeLibrary via windows mod; intentionally leaked here
        // (Zig `DynLib.close` on Windows is a no-op in our usage).
    }
    #[inline]
    pub fn handle(&self) -> *mut c_void {
        self.handle
    }
}

/// `std.c.RTLD` flags for `dlopen`.
#[cfg(unix)]
pub mod RTLD {
    pub const LAZY: i32 = libc::RTLD_LAZY;
    pub const NOW: i32 = libc::RTLD_NOW;
    pub const GLOBAL: i32 = libc::RTLD_GLOBAL;
    pub const LOCAL: i32 = libc::RTLD_LOCAL;
}
#[cfg(windows)]
pub mod RTLD {
    // Windows `LoadLibrary` ignores these; provided so cross-platform call
    // sites compile. Values match POSIX so any bitmask logic stays inert.
    pub const LAZY: i32 = 0x1;
    pub const NOW: i32 = 0x2;
    pub const GLOBAL: i32 = 0x100;
    pub const LOCAL: i32 = 0;
}

/// sys.zig:4557 — `dlopen(filename, flags)`. Windows → `LoadLibraryA`.
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
        // SAFETY: filename is NUL-terminated.
        let p = unsafe { bun_windows_sys::externs::LoadLibraryA(filename.as_ptr()) };
        if p.is_null() { None } else { Some(p.cast()) }
    }
}
/// sys.zig:4565 — `dlsym(handle, name)`.
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
        // Same as Zig `bun.cast($T, ptr)`.
        let p = PTR.load(::core::sync::atomic::Ordering::Relaxed);
        if p.is_null() {
            None
        } else {
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
    let z = ZStr::from_buf(&buf.0[..], path.len());
    openat(dir, z, flags, perm)
}
/// sys.zig:1705 `openatOSPath` — `openat` taking a platform-native path
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
    let dir = open_dir_absolute(parent)
        .map(Dir::from_fd)
        .map_err(bun_core::Error::from)?;
    let res = dir.delete_tree(base);
    dir.close();
    res
}
/// bun.zig:899 — Windows variant skips `DELETE` access; on POSIX identical.
pub fn open_dir_absolute_not_for_deleting_or_renaming(path: &[u8]) -> Maybe<Fd> {
    open_dir_absolute(path)
}
/// bun.zig:887 `openDirNoRenamingOrDeletingWindows` — open `path` relative to
/// `dir` for iteration only (no `DELETE` access). Windows-only; callers gate.
#[cfg(windows)]
pub fn open_dir_no_renaming_or_deleting_windows(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    open_dir_at_windows_a(
        dir,
        path,
        WindowsOpenDirOptions {
            iterable: true,
            can_rename_or_delete: false,
            read_only: true,
            ..Default::default()
        },
    )
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
    #[default]
    OnlyOpen,
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

/// sys.zig:985 `normalizePathWindows` options.
#[cfg(windows)]
#[derive(Copy, Clone)]
pub struct NormalizePathWindowsOpts {
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

/// sys.zig:1129 `normalizePathWindows` — convert a (possibly relative) path
/// into an NT object path suitable for `NtCreateFile` against `dir_fd`.
/// PORT NOTE: u16-only here; the u8 entry points pre-convert via
/// `bun_paths::string_paths::to_nt_path` and call this with the resulting wide slice.
#[cfg(windows)]
pub fn normalize_path_windows<'a>(
    dir_fd: Fd,
    path: &[u16],
    buf: &'a mut [u16],
) -> Maybe<&'a bun_core::WStr> {
    normalize_path_windows_opts(dir_fd, path, buf, NormalizePathWindowsOpts::default())
}

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
        // sys.zig:1019-1048 — three special-cases that must run BEFORE
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
            // sys.zig:1001/1052 — `nt_prefix_headroom = 8`; `if (path.len >
            // buf.len -| nt_prefix_headroom) return name_too_long;`.
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
        // sys.zig:1056 `.{ .add_nt_prefix = false }` — produce a Win32 path
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

    // Relative path with no separators or `.` can be passed straight through
    // to `NtCreateFile` against `RootDirectory`.
    if !path
        .iter()
        .any(|&c| c == b'\\' as u16 || c == b'/' as u16 || c == b'.' as u16)
    {
        if path.len() >= buf.len() {
            return Err(too_long());
        }
        buf[..path.len()].copy_from_slice(path);
        buf[path.len()] = 0;
        // SAFETY: NUL written at buf[path.len()].
        return Ok(WStr::from_buf(&buf[..], path.len()));
    }

    // Otherwise: resolve `dir_fd` to its full path, join, normalize.
    let base_fd = if dir_fd.is_valid() {
        dir_fd.native()
    } else {
        Fd::cwd().native()
    };
    let mut base_buf = bun_paths::w_path_buffer_pool::get();
    let base =
        match windows::GetFinalPathNameByHandle(base_fd, Default::default(), &mut base_buf.0[..]) {
            Ok(p) => p,
            // sys.zig:1080 — `E.BADFD` (errno 77 'file descriptor in bad state'),
            // not `EBADF` (9).
            Err(_) => return Err(Error::from_code(E::BADFD, Tag::open)),
        };

    // Strip a leading drive letter (`C:`) on the relative part (sys.zig:1204).
    let mut rel = path;
    if rel.len() >= 2
        && bun_paths::resolve_path::is_drive_letter_t::<u16>(rel[0])
        && rel[1] == b':' as u16
    {
        rel = &rel[2..];
    }

    let mut joined = bun_paths::w_path_buffer_pool::get();
    let joined_len = base.len() + 1 + rel.len();
    // sys.zig:1092 — `if (joined_len > buf1.len -| nt_prefix_headroom) return
    // name_too_long;`. Reserve 8 u16 for the `\??\` prefix + NUL that
    // `normalizeStringGenericTZ` writes into `buf` (same length as `joined`).
    if joined_len > joined.0.len().saturating_sub(8) {
        return Err(too_long());
    }
    joined.0[..base.len()].copy_from_slice(base);
    joined.0[base.len()] = b'\\' as u16;
    joined.0[base.len() + 1..joined_len].copy_from_slice(rel);
    // sys.zig:1095 — `normalizeStringGenericTZ(u16, joined, buf,
    // .{ .add_nt_prefix = true, .zero_terminate = true })`. Must collapse
    // `.`/`..` segments here: the relative input may be `"."` (e.g.
    // `bun build entry.js` → dirname → `"."`), and the joined `…\.` is
    // rejected by `NtCreateFile` if passed through verbatim.
    let norm = bun_paths::resolve_path::normalize_string_generic_tz::<
        u16,
        /*ALLOW_ABOVE_ROOT*/ false,
        /*PRESERVE_TRAILING_SLASH*/ false,
        /*ZERO_TERMINATE*/ true,
        /*ADD_NT_PREFIX*/ true,
    >(
        &joined.0[..joined_len],
        buf,
        b'\\' as u16,
        bun_paths::is_sep_any_t::<u16>,
    );
    let len = norm.len();
    // SAFETY: ZERO_TERMINATE wrote NUL at buf[len].
    Ok(unsafe { WStr::from_raw(norm.as_ptr(), len) })
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
        let errno = windows::Win32Error::get().to_e();
        return Err(Error::from_code(errno, Tag::open));
    }
    Ok(Fd::from_system(rc))
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
    let read_only_flag: u32 = if options.read_only {
        0
    } else {
        w::FILE_ADD_FILE | w::FILE_ADD_SUBDIRECTORY
    };
    let flags = iterable_flag | base_flags | rename_flag | read_only_flag;
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
        RootDirectory: if bun_paths::is_absolute_windows_wtf16(p) {
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
        Buffer: p.as_ptr().cast_mut().cast::<u16>(),
    };
    let has_nt_prefix = p.len() >= 4
        && p[0] == b'\\' as u16
        && p[1] == b'?' as u16
        && p[2] == b'?' as u16
        && p[3] == b'\\' as u16;
    let mut attr = w::OBJECT_ATTRIBUTES {
        Length: core::mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
        // [ObjectName] must be a fully qualified file specification or the
        // name of a device object, unless it is the name of a file relative
        // to the directory specified by RootDirectory.
        ObjectName: &mut nt_name,
        RootDirectory: if has_nt_prefix {
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

/// sys.zig:1003-1012 — `normalizePathWindows(u8, …)` length-checks before
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
pub fn open_dir_at_windows_a(dir_fd: Fd, path: &[u8], options: WindowsOpenDirOptions) -> Maybe<Fd> {
    // sys.zig:1262 `openDirAtWindowsT(u8, …)` → `normalizePathWindows(u8, dirFd,
    // path, wbuf, .{})` does the UTF-8→UTF-16 conversion internally and THEN
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
/// sys.zig `openFileAtWindowsA` — UTF-8 entry point: convert to UTF-16 (no
/// NT-prefix yet — `normalize_path_windows` adds that) then defer to
/// [`open_file_at_windows`].
#[cfg(windows)]
pub fn open_file_at_windows_a(dir_fd: Fd, path: &[u8], opts: NtCreateFileOptions) -> Maybe<Fd> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let wide = convert_path_u8_to_u16(&mut wbuf.0[..], path)?;
    open_file_at_windows(dir_fd, wide, opts)
}

/// sys.zig:1608 `openatWindowsTMaybeNormalize` — POSIX-flag → NtCreateFile
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
            if (flags & O::EXCL) != 0 {
                break 'blk w::FILE_CREATE;
            }
            break 'blk if overwrite {
                w::FILE_OVERWRITE_IF
            } else {
                w::FILE_OPEN_IF
            };
        }
        if overwrite {
            w::FILE_OVERWRITE
        } else {
            w::FILE_OPEN
        }
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
    // sys.zig `openatWindowsT(u8, …)` — `normalizePathWindows` does the
    // UTF-8→UTF-16 conversion internally; mirror that with a plain transcode
    // (no NT-prefix) so relative paths stay relative against `dir`.
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let wide = convert_path_u8_to_u16(&mut wbuf.0[..], path)?;
    let mut buf2 = bun_paths::w_path_buffer_pool::get();
    let norm = normalize_path_windows(dir, wide, &mut buf2.0[..])?;
    openat_windows_impl(dir, norm, flags, perm)
}

// ── existence checks ──

/// Port of sys.zig `WindowsFileAttributes` — view over the `DWORD` returned
/// by `GetFileAttributesW`. Only the two bits the resolver inspects are
/// surfaced as fields (matching the Zig packed-struct field names) so callers
/// can write `attrs.is_directory` / `attrs.is_reparse_point`.
#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct WindowsFileAttributes {
    pub is_directory: bool,
    pub is_reparse_point: bool,
    /// Raw `dwFileAttributes` for callers that need other bits.
    pub raw: u32,
}

/// Port of sys.zig:3424 `getFileAttributes`. Accepts a UTF-8 path (the
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

/// sys.zig:3447 — `access(path, F_OK) == 0`. `file_only` ignored on POSIX.
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
        // sys.zig:3454 — `getFileAttributes(path)`; if `file_only` reject dirs;
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
/// sys.zig:3636 `ExistsAtType`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExistsAtType {
    File,
    Directory,
}
/// sys.zig:3648 Windows tail — `NtQueryAttributesFile` against an
/// OBJECT_ATTRIBUTES built from an already NT-prefixed wide path. Shared by the
/// UTF-8 (`exists_at_type`) and UTF-16 (`exists_at_type_w`) entry points so the
/// `anytype` width-dispatch in Zig's `existsAtType` is preserved without
/// duplicating the syscall body.
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
        RootDirectory: if bun_paths::is_absolute_windows_wtf16(path) {
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
        // sys.zig:3744 `Maybe(bool).errnoSys(rc, .access)` — `errnoSys` for
        // `NTSTATUS` routes through the curated `translateNTStatusToErrno`
        // table, NOT `RtlNtStatusToDosError`. `directory_exists_at()` then
        // branches on `ENOENT`, so the mapping must match the spec table.
        return Err(Error::from_code(
            windows::translate_nt_status_to_errno(rc),
            Tag::access,
        ));
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
/// sys.zig:3640 — `fstatat` then `S_ISDIR`.
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
        // sys.zig:3648 — `NtQueryAttributesFile` against an OBJECT_ATTRIBUTES
        // built from the (optionally NT-prefixed) wide path.
        let mut wbuf = bun_paths::w_path_buffer_pool::get();
        let path = bun_paths::string_paths::to_nt_path(&mut wbuf.0[..], sub.as_bytes()).as_slice();
        exists_at_type_nt(dir, path)
    }
}
/// sys.zig:3712 `existsAtType` — the `std.meta.Child(@TypeOf(subpath)) == u16`
/// arm. Takes an already-wide path (Windows `OSPathSliceZ`) and routes through
/// `toNTPath16` instead of re-widening from UTF-8.
#[cfg(windows)]
pub fn exists_at_type_w(dir: Fd, sub: &[u16]) -> Maybe<ExistsAtType> {
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let path = bun_paths::string_paths::to_nt_path16(&mut wbuf.0[..], sub).as_slice();
    exists_at_type_nt(dir, path)
}
/// sys.zig:3533 — `directoryExistsAt(dir, sub)`. ENOENT → `Ok(false)`.
pub fn directory_exists_at(dir: Fd, sub: &ZStr) -> Maybe<bool> {
    match exists_at_type(dir, sub) {
        Ok(t) => Ok(t == ExistsAtType::Directory),
        Err(e) if e.get_errno() == E::ENOENT => Ok(false),
        Err(e) => Err(e),
    }
}
/// sys.zig:3533 `directoryExistsAt` — wide-path (`u16`) overload for Windows
/// `OSPathSliceZ` callers (mkdir-recursive, cpSync auto-detect). Mirrors the
/// `anytype` dispatch instead of forcing a UTF-16 → UTF-8 → UTF-16 round-trip.
#[cfg(windows)]
pub fn directory_exists_at_w(dir: Fd, sub: &[u16]) -> Maybe<bool> {
    match exists_at_type_w(dir, sub) {
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
pub fn set_nonblocking(fd: Fd) -> Maybe<()> {
    update_nonblocking(fd, true)
}
/// sys.zig:3618 — GETFL → toggle O_NONBLOCK → SETFL (only if changed).
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
/// sys.zig:3873 — `fcntl(F_DUPFD_CLOEXEC)` (POSIX) / `DuplicateHandle` (Win).
/// `_flags` is ignored (Zig signature parity).
#[inline]
pub fn dup_with_flags(fd: Fd, _flags: i32) -> Maybe<Fd> {
    dup(fd)
}

unsafe extern "C" {
    // Defined in src/jsc/bindings/c-bindings.cpp — sets SO_LINGER {1,0} so
    // closing a listen socket sends RST instead of entering TIME_WAIT.
    // By-value fd/handle; setsockopt failure is silently ignored — no UB.
    #[cfg(windows)]
    safe fn Bun__disableSOLinger(fd: windows::HANDLE);
    #[cfg(not(windows))]
    safe fn Bun__disableSOLinger(fd: i32);
}
/// sys.zig:3835 `disableLinger` — set `SO_LINGER {1,0}` so close sends RST.
#[inline]
pub fn disable_linger(fd: Fd) {
    Bun__disableSOLinger(fd.native());
}

/// sys.zig:3788 — `lseek(fd, offset, SEEK_SET)`; result discarded.
pub fn set_file_offset(fd: Fd, offset: u64) -> Maybe<()> {
    lseek(fd, offset as i64, libc::SEEK_SET).map(|_| ())
}

// ── nonblocking read/write (preadv2/pwritev2 RWF_NOWAIT on Linux) ──

#[cfg(target_os = "linux")]
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
#[cfg(target_os = "linux")]
const RWF_NOWAIT: u32 = 0x00000008;

/// sys.zig:4046 — Linux: `preadv2(.., RWF_NOWAIT)`; else plain `read`.
pub fn read_nonblocking(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
    #[cfg(target_os = "linux")]
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
pub fn preallocate_file(
    fd: FdNative,
    offset: i64,
    len: i64,
) -> core::result::Result<(), bun_core::Error> {
    #[cfg(target_os = "linux")]
    {
        // Result intentionally discarded (Zig: `_ = std.os.linux.fallocate(...)`)
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

/// `kevent()` — slice-wrapped Maybe form (sys.zig:2278). Retries on EINTR.
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
                timeout.map_or(core::ptr::null(), |t| t as *const _),
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
pub fn clonefileat(_from_dir: Fd, from: &ZStr, _to_dir: Fd, to: &ZStr) -> Maybe<()> {
    Err(Error::from_code_int(libc::ENOTSUP, Tag::clonefileat)
        .with_path_dest(from.as_bytes(), to.as_bytes()))
}

// ── getFdPath ──

/// sys.zig:632 `LinuxKernel` — cached probe of `/proc/version` for "freebsd"
/// (linprocfs hardcodes "des@freebsd.org"). Under FreeBSD's Linuxulator
/// `/proc/self/fd/*` doesn't readlink, but `/dev/fd/*` does.
/// 0=unknown, 1=linux, 2=freebsd.
#[cfg(target_os = "linux")]
static LINUX_KERNEL_CACHED: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(0);

/// sys.zig:3032 `LinuxKernel.cached.load(.acquire) == .freebsd` — non-probing
/// fast-path check. Returns `true` only when a previous probe already proved
/// FreeBSD's Linuxulator; never triggers the `/proc/version` read itself.
#[cfg(target_os = "linux")]
#[inline]
fn linux_kernel_cached_is_freebsd() -> bool {
    LINUX_KERNEL_CACHED.load(core::sync::atomic::Ordering::Acquire) == 2
}

/// sys.zig:659 `LinuxKernel.get()` — probing variant: reads `/proc/version`
/// once (memoized) and returns whether this is FreeBSD's Linuxulator.
#[cfg(target_os = "linux")]
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

/// sys.zig:2999 `getFdPathFreeBSDLinuxulator` — readlink `/dev/fd/N` (fdescfs).
#[cfg(target_os = "linux")]
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

/// sys.zig:2940 — fd → absolute path. Linux: readlink `/proc/self/fd/N`;
/// macOS: `fcntl(F_GETPATH)`; Windows: `GetFinalPathNameByHandle`.
pub fn get_fd_path<'a>(fd: Fd, out: &'a mut bun_paths::PathBuffer) -> Maybe<&'a mut [u8]> {
    #[cfg(target_os = "linux")]
    {
        // sys.zig:3032 — fast path: a previous call already proved this is
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
                // sys.zig:3046 — under FreeBSD Linuxulator, fall back to
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
        // sys.zig:3008-3018 — `GetFinalPathNameByHandle` into a wide buffer,
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
        // sys.zig:3054-3066 — FreeBSD: F_KINFO returns a `struct kinfo_file`
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
        target_os = "macos",
        target_os = "freebsd",
        windows
    )))]
    {
        let _ = (fd, out);
        Err(Error::from_code_int(libc::ENOSYS, Tag::readlink))
    }
}

/// sys.zig:2992 — fd → absolute wide path (Windows `GetFinalPathNameByHandleW`).
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

/// `std.os.environ` — borrowed slice of `KEY=VALUE\0` C strings.
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
        // (main.zig:47 → bun_bin/lib.rs). The slice is NUL-terminated WTF-8
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

/// `std.os.environ.ptr` — raw NULL-terminated `**c_char` for FFI envp args
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

// ── moveFileZWithHandle (sys.zig:4266) ──

/// `renameat`; on EISDIR removes the dest dir and retries; on EXDEV falls back
/// to copy-then-unlink. Port of `bun.sys.moveFileZWithHandle`.
pub fn move_file_z_with_handle(
    from_handle: Fd,
    from_dir: Fd,
    filename: &ZStr,
    to_dir: Fd,
    destination: &ZStr,
) -> core::result::Result<(), bun_core::Error> {
    match renameat(from_dir, filename, to_dir, destination) {
        Ok(()) => Ok(()),
        Err(e) if e.get_errno() == E::EISDIR => {
            #[cfg(unix)]
            // SAFETY: destination is NUL-terminated.
            let _ = unsafe {
                libc::unlinkat(to_dir.native(), destination.as_ptr(), libc::AT_REMOVEDIR)
            };
            renameat(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) if e.get_errno() == E::EXDEV => {
            // Cross-device: full `copyFileZSlowWithHandle` (sys.zig:4305).
            let st = fstat(from_handle).map_err(bun_core::Error::from)?;
            // Unlink dest first — fixes ETXTBUSY on Linux.
            let _ = unlinkat(to_dir, destination);
            let dst = openat(
                to_dir,
                destination,
                O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC,
                0o644,
            )
            .map_err(bun_core::Error::from)?;
            #[cfg(target_os = "linux")]
            {
                // Preallocation is best-effort.
                let _ = safe_libc::fallocate(dst.native(), 0, 0, st.st_size);
            }
            // Seek input to 0 — caller may have left offset at EOF after writing.
            let _ = lseek(from_handle, 0, libc::SEEK_SET);
            let r = copy_file(from_handle, dst);
            // sys.zig:4349 — only stamp mode/owner on success; on copy error
            // the partially-written dest keeps its openat() defaults.
            #[cfg(unix)]
            if r.is_ok() {
                let _ = safe_libc::fchmod(dst.native(), st.st_mode);
                let _ = safe_libc::fchown(dst.native(), st.st_uid, st.st_gid);
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
    use core::ffi::{c_int, c_void};

    // ── BSD sysctl(3) family (Zig: `std.posix.sysctlbynameZ`) ──
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
                &mut len,
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
                &mut len,
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

    // ── address families (Zig: `std.posix.AF`) ──
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
        pub const UNSPEC: c_int = libc::AF_UNSPEC;
        #[cfg(unix)]
        pub const UNIX: c_int = libc::AF_UNIX;
        #[cfg(unix)]
        pub const INET: c_int = libc::AF_INET;
        #[cfg(unix)]
        pub const INET6: c_int = libc::AF_INET6;
    }

    // ── INET6_ADDRSTRLEN (Zig: `std.c.INET6_ADDRSTRLEN` / `ws2ipdef.h`) ──
    // POSIX `netinet/in.h` = 46; Windows `ws2ipdef.h` = 65.
    #[cfg(windows)]
    pub const INET6_ADDRSTRLEN: usize = 65;
    #[cfg(not(windows))]
    pub const INET6_ADDRSTRLEN: usize = 46;

    // ── sockaddr family (Zig: `std.posix.sockaddr`) ──
    #[cfg(unix)]
    pub use libc::{sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage};
    // Route through `bun_libuv_sys` (not `bun_windows_sys::ws2_32`) so types
    // returned by libuv APIs (`uv_interface_address_t`, `uv_udp_*`) are the
    // *same* nominal type callers see via `bun_sys::posix::sockaddr_*` — Rust
    // doesn't structurally unify two identical-layout `#[repr(C)]` structs.
    #[cfg(windows)]
    pub use bun_libuv_sys::{sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage};

    // ── access(2) mode bits (Zig: `std.posix.F_OK` etc.) ──
    // POSIX-standard values; libuv re-uses the same numbers on Windows
    // (`uv/win.h`), so these are target-invariant.
    pub const F_OK: c_int = 0;
    pub const R_OK: c_int = 4;
    pub const W_OK: c_int = 2;
    pub const X_OK: c_int = 1;

    // ── stat mode-kind tests (Zig: `std.posix.S.ISLNK` etc.) ──
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
    #[cfg(unix)]
    #[inline]
    pub const fn s_isreg(m: u32) -> bool {
        (m & libc::S_IFMT as u32) == libc::S_IFREG as u32
    }

    // ── signals ──
    #[cfg(unix)]
    pub use libc::sigaction as Sigaction;
    #[cfg(unix)]
    pub use libc::siginfo_t;
    #[cfg(unix)]
    pub use libc::sigset_t;
    /// `std.posix.sigaction(sig, &act, *oact)`.
    #[cfg(unix)]
    #[inline]
    pub unsafe fn sigaction(sig: c_int, act: *const Sigaction, oact: *mut Sigaction) -> c_int {
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

    // ── raw I/O (no `Maybe` wrapping; Zig: `std.posix.read/write`) ──
    #[cfg(unix)]
    #[inline]
    pub unsafe fn read(fd: c_int, buf: *mut u8, count: usize) -> isize {
        #[cfg(target_os = "linux")]
        {
            unsafe { super::linux_syscall::read_raw(fd, buf, count) }
        }
        #[cfg(not(target_os = "linux"))]
        {
            unsafe { libc::read(fd, buf.cast(), count) }
        }
    }
    #[cfg(unix)]
    #[inline]
    pub unsafe fn write(fd: c_int, buf: *const u8, count: usize) -> isize {
        #[cfg(target_os = "linux")]
        {
            unsafe { super::linux_syscall::write_raw(fd, buf, count) }
        }
        #[cfg(not(target_os = "linux"))]
        {
            unsafe { libc::write(fd, buf.cast(), count) }
        }
    }

    // ── poll ──
    /// `std.posix.pollfd`.
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
    /// `bun.sys.poll` (sys.zig:2211-2225) — `poll$NOCANCEL` on Darwin,
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
    // Zig `std.posix.sockaddr.in` / `.in6` — un-prefixed field names
    // (`family`/`port`/`addr`/`flowinfo`/`scope_id`) so call sites written
    // against the Zig shape stay target-agnostic.
    //
    // Layout-identical to the C-named ground truth re-exported at
    // `crate::posix::sockaddr_in[6]` (= `libc` on Unix, `ws2_32` via
    // `bun_libuv_sys` on Windows) — asserted below. Kept as a *distinct*
    // nominal type because the C structs use `sin_*`/`sin6_*` names AND nest
    // `in_addr`/`in6_addr`; Rust won't structurally unify.
    //
    // BSD targets carry a leading `len: u8` and `sa_family_t == u8`; the
    // `ZEROED` const pre-fills `len = size_of::<Self>()` to mirror Zig's
    // field default so struct-update initializers (`..sockaddr_in::ZEROED`)
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

    /// `std.net.Address` — tagged union over sockaddr_in/in6/un.
    #[derive(Clone, Copy)]
    pub struct Address {
        /// Generic storage; `family()` discriminates.
        pub any: sockaddr_storage,
    }
    impl Address {
        /// Construct from a borrowed `*const sockaddr` (Zig: `Address.initPosix`).
        /// SAFETY: `addr` must point at a valid sockaddr of the family it declares.
        pub unsafe fn init_posix(addr: *const sockaddr) -> Self {
            let mut storage: sockaddr_storage = unsafe { bun_core::ffi::zeroed_unchecked() };
            let len = match unsafe { (*addr).sa_family } as i32 {
                AF_INET => core::mem::size_of::<sockaddr_in>(),
                AF_INET6 => core::mem::size_of::<sockaddr_in6>(),
                _ => core::mem::size_of::<sockaddr>(),
            };
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
        #[inline]
        pub fn sock_len(&self) -> u32 {
            match self.family() {
                AF_INET => core::mem::size_of::<sockaddr_in>() as u32,
                AF_INET6 => core::mem::size_of::<sockaddr_in6>() as u32,
                _ => core::mem::size_of::<sockaddr_storage>() as u32,
            }
        }
    }
    impl Default for Address {
        // SAFETY: POD, zero-valid — sockaddr union of integer fields.
        fn default() -> Self {
            Self {
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
            // PORT NOTE: Zig's std.net.Address.format prints "ip:port"/"[ip6]:port".
            // Minimal: print family for now; full impl in `bun_dns::address_to_string`.
            match self.as_in4() {
                Some(v4) => {
                    // `sin_addr` is `in_addr { s_addr: u32 }` on POSIX/ws2_32 but
                    // `[u8; 4]` in `bun_libuv_sys::sockaddr_in`; reinterpret as
                    // raw octets so both shapes resolve.
                    // SAFETY: `sin_addr` is 4 bytes of POD on every target.
                    let octets: [u8; 4] =
                        unsafe { *(core::ptr::addr_of!(v4.sin_addr) as *const [u8; 4]) };
                    write!(
                        f,
                        "{}.{}.{}.{}:{}",
                        octets[0],
                        octets[1],
                        octets[2],
                        octets[3],
                        u16::from_be(v4.sin_port)
                    )
                }
                None => write!(f, "<addr family={}>", self.family()),
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

    /// Port of Zig `std.debug.DebugInfo.lookupModuleDl`: walk loaded ELF objects
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
    /// `std.c.EVFILT` — kqueue filter constants (FreeBSD).
    pub mod EVFILT {
        pub const READ: i16 = libc::EVFILT_READ;
        pub const WRITE: i16 = libc::EVFILT_WRITE;
        pub const VNODE: i16 = libc::EVFILT_VNODE;
        pub const PROC: i16 = libc::EVFILT_PROC;
        pub const SIGNAL: i16 = libc::EVFILT_SIGNAL;
        pub const TIMER: i16 = libc::EVFILT_TIMER;
        pub const USER: i16 = libc::EVFILT_USER;
    }
    /// `std.c.EV` — kqueue event flags (FreeBSD).
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
    /// `std.c.NOTE` — kqueue fflags (FreeBSD).
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
    /// `std.c.copy_file_range` (FreeBSD 13+). Thin re-export so callers don't
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

/// RAII guard that closes an [`Fd`] on drop.
///
/// `Fd`/`Dir`/`File` are intentionally non-owning `Copy` handles (matching
/// Zig). When a scope owns one and must close it on every exit path
/// (Zig: `defer fd.close()`), wrap the fd in this guard — do not hand-roll a
/// `scopeguard` closure.
#[must_use = "dropping immediately closes the fd; bind to `let _close = ...`"]
pub struct CloseOnDrop(Fd);
impl CloseOnDrop {
    #[inline]
    pub fn new(fd: Fd) -> Self {
        Self(fd)
    }
    #[inline]
    pub fn dir(dir: Dir) -> Self {
        Self(dir.fd)
    }
    #[inline]
    pub fn file(file: &File) -> Self {
        Self(file.handle)
    }
    /// Disarm the guard and return the fd without closing it.
    #[inline]
    pub fn into_inner(self) -> Fd {
        let fd = self.0;
        core::mem::forget(self);
        fd
    }
}
impl Drop for CloseOnDrop {
    #[inline]
    fn drop(&mut self) {
        let _ = close(self.0);
    }
}

/// `std.fs.Dir.makeOpenPath` reachable as a module (Zig callers do
/// `bun.makePath` / `bun.makeOpenPath`).
pub mod make_path {
    use super::*;
    #[inline]
    pub fn make_open_path(
        dir: Dir,
        sub_path: &[u8],
        opts: OpenDirOptions,
    ) -> core::result::Result<Dir, bun_core::Error> {
        dir.make_open_path(sub_path, opts)
    }

    /// Dispatch trait for `make_path::<T>` over `u8` (POSIX) / `u16` (Windows).
    /// Mirrors Zig's `std.fs.Dir.makePath` taking `OSPathSlice`. Extends the
    /// canonical [`bun_paths::PathChar`] with the one syscall-dispatch hook.
    pub trait MakePathUnit: bun_paths::PathChar {
        fn make_path_at(dir: Fd, sub: &[Self]) -> core::result::Result<(), bun_core::Error>;
    }
    impl MakePathUnit for u8 {
        #[inline]
        fn make_path_at(dir: Fd, sub: &[u8]) -> core::result::Result<(), bun_core::Error> {
            mkdir_recursive_at(dir, sub).map_err(Into::into)
        }
    }
    impl MakePathUnit for u16 {
        #[inline]
        fn make_path_at(dir: Fd, sub: &[u16]) -> core::result::Result<(), bun_core::Error> {
            make_path_w(dir, sub).map_err(Into::into)
        }
    }
    /// `bun.makePath` — `mkdir -p` relative to `dir`, generic over path-char
    /// width so callers can pass `OSPathChar` slices unchanged.
    #[inline]
    pub fn make_path<T: MakePathUnit>(
        dir: Dir,
        sub_path: &[T],
    ) -> core::result::Result<(), bun_core::Error> {
        T::make_path_at(dir.fd, sub_path)
    }
    /// Explicit UTF-16 form (Windows). On POSIX transcodes via `make_path_w`.
    #[inline]
    pub fn make_path_u16(dir: Dir, sub_path: &[u16]) -> core::result::Result<(), bun_core::Error> {
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

// ──────────────────────────────────────────────────────────────────────────
// Port of `sys.zig:2653-2902` — Windows-only `symlinkW` / `symlinkOrJunction`
// / `unlinkW` / `rmdir` / `mkdir` (CreateDirectoryW path). Compiled on
// Windows; on POSIX these names are absent (matches `@compileError` in spec).
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

    /// Zig: `WindowsSymlinkOptions.symlink_flags` — process-global, starts
    /// with `ALLOW_UNPRIVILEGED_CREATE` and is cleared on `INVALID_PARAMETER`
    /// (older Windows).
    ///
    /// PORT NOTE (deliberate divergence): Zig's `flags()` (sys.zig:2657) does
    /// `symlink_flags |= DIRECTORY; return symlink_flags;`, which permanently
    /// stickies the `DIRECTORY` bit into the global after the first directory
    /// symlink — a Zig bug (a later `directory=false` call still passes
    /// `SYMBOLIC_LINK_FLAG_DIRECTORY`, so `CreateSymbolicLinkW` creates a
    /// broken directory symlink for a file target). We do **not** mirror that:
    /// the global only carries `ALLOW_UNPRIVILEGED_CREATE` (cleared on
    /// `INVALID_PARAMETER`), and `DIRECTORY` is OR'd into a *local* on each
    /// call. Upstream fix tracked in sys.zig.
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

    /// Port of `sys.zig:2717 symlinkW`. `dest` is the link path, `target` is
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
                if let Some(sys_errno) = win_err.to_system_errno() {
                    let e: E = sys_errno.to_e();
                    // Zig: only ENOENT/EEXIST keep `has_failed_to_create_symlink`
                    // unset; every other failure flips the sticky bit so
                    // `symlinkOrJunction` falls through to junctions next time.
                    if !matches!(e, E::NOENT | E::EXIST) {
                        WindowsSymlinkOptions::set_has_failed_to_create_symlink(true);
                    }
                    return Err(Error::from_code(e, Tag::symlink));
                }
                // Win32 error without an errno mapping — Zig falls through to
                // `return .success` (the `if let` yields `null`). Mirror that.
            }
            return Ok(());
        }
    }

    /// Port of `sys.zig:2675 symlinkOrJunction`. Tries `CreateSymbolicLinkW`
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

    /// Port of `sys.zig:2846 unlinkW` — `DeleteFileW` with errno mapping.
    pub fn unlink_w(from: &WStr) -> Maybe<()> {
        // SAFETY: `from` is NUL-terminated.
        let rc = unsafe { windows::DeleteFileW(from.as_ptr()) };
        if rc == 0 {
            return Err(Error::from_code(windows::get_last_errno(), Tag::unlink));
        }
        Ok(())
    }

    /// Port of `sys.zig:mkdirOSPath` (Windows arm) — `CreateDirectoryW` with
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

/// Port of `sys.zig:3915 link(u16, ...)` Windows arm — `CreateHardLinkW` with
/// errno mapping. The u8/ZStr overload (`link`) routes through `sys_uv::link`.
#[cfg(windows)]
pub fn link_w(src: &bun_core::WStr, dest: &bun_core::WStr) -> Maybe<()> {
    if windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), None) == 0 {
        return Err(Error::from_code(windows::get_last_errno(), Tag::link));
    }
    Ok(())
}

/// Port of `sys.zig:2876 rmdir` — `rmdirat(FD.cwd(), to)`. Exposed on all
/// platforms (POSIX `unlinkat(.., AT_REMOVEDIR)`; Windows `DeleteFileBun`).
#[inline]
pub fn rmdir(to: &ZStr) -> Maybe<()> {
    rmdirat(Fd::cwd(), to)
}

/// Type-style alias so callers can write `bun_sys::MakePath::make_path::<T>(..)`
/// (Zig: `bun.MakePath` namespace re-export).
pub use make_path as MakePath;

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
    Ok(ZStr::from_buf(&out.0[..], len))
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
    let z = ZStr::from_buf(&buf.0[..], path.len());
    exists_z(z)
}
/// sys.zig:4246 — `moveFileZ`. Tries the rename first (no source open on the
/// hot path); on EISDIR removes the dest dir and retries; on EXDEV falls back
/// to the slow open+copy path. Only opens the source inside the EXDEV branch.
pub fn move_file_z(
    from_dir: Fd,
    filename: &ZStr,
    to_dir: Fd,
    destination: &ZStr,
) -> core::result::Result<(), bun_core::Error> {
    // TODO(port): renameatConcurrentlyWithoutFallback (renameat2 NOREPLACE →
    // EXCHANGE → deleteTree) — sys.zig:2480. Plain `renameat` for now.
    match renameat(from_dir, filename, to_dir, destination) {
        Ok(()) => Ok(()),
        Err(e) if e.get_errno() == E::EISDIR => {
            #[cfg(unix)]
            // SAFETY: destination is NUL-terminated.
            let _ = unsafe {
                libc::unlinkat(to_dir.native(), destination.as_ptr(), libc::AT_REMOVEDIR)
            };
            renameat(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) if e.get_errno() == E::EXDEV => {
            move_file_z_slow(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) => Err(e.into()),
    }
}
/// sys.zig:4291 — `moveFileZSlow`: open source, unlink, copy to dest.
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
/// sys.zig:4305 — `copyFileZSlowWithHandle` (POSIX read/write fallback arm).
pub fn copy_file_z_slow_with_handle(in_handle: Fd, to_dir: Fd, destination: &ZStr) -> Maybe<()> {
    let st = fstat(in_handle)?;
    // Unlink dest first — fixes ETXTBUSY on Linux.
    let _ = unlinkat(to_dir, destination);
    let dst = openat(
        to_dir,
        destination,
        O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC,
        0o644,
    )?;
    #[cfg(target_os = "linux")]
    {
        // Preallocation is best-effort.
        let _ = safe_libc::fallocate(dst.native(), 0, 0, st.st_size);
    }
    let _ = lseek(in_handle, 0, libc::SEEK_SET);
    let r = copy_file(in_handle, dst);
    // sys.zig:4349 — only stamp mode/owner on success; on copy error the
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
pub fn move_file_z_slow_maybe(
    from_dir: Fd,
    filename: &ZStr,
    to_dir: Fd,
    destination: &ZStr,
) -> Maybe<()> {
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
                    did_atomically_replace = true;
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
                    did_atomically_replace = false;
                }
            }
            #[cfg(windows)]
            {
                let _ = err;
            }
        }

        //  sad path: let's try to delete the folder and then rename it
        if to_dir_fd.is_valid() {
            let _ = Dir::from_fd(to_dir_fd).delete_tree(to.as_bytes());
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

/// `bun.Output.stderrWriter()` — `std::io::Write` over stderr fd. Used by
/// callers that want a borrowed writer without going through `bun_core::Output`.
#[inline]
pub fn stderr_writer() -> FileWriter {
    FileWriter(Fd::stderr())
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
pub enum PathOrFileDescriptor {
    Path(bun_core::PathString),
    Fd(Fd),
}
impl Default for PathOrFileDescriptor {
    fn default() -> Self {
        PathOrFileDescriptor::Fd(Fd::INVALID)
    }
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
            let z = ZStr::from_buf(&path_buf.0[..], bytes.len());
            openat(
                args.dirfd,
                z,
                O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC,
                args.mode,
            )?
        }
    };
    let r = File::from_fd(fd).write_all(buffer);
    if !matches!(args.file, PathOrFileDescriptor::Fd(_)) {
        let _ = close(fd);
    }
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

// ──────────────────────────────────────────────────────────────────────────
// OUTPUT_SINK — bun_core's stderr vtable, installed by us at init (B-0 hook).
// ──────────────────────────────────────────────────────────────────────────

/// `bun_core::output::QuietWriter` is an opaque `[*mut (); 4]`. We stash the
/// raw fd in slot 0 and ignore the rest. (Zig's `QuietWriter` is `{ context:
/// File { handle: Fd } }`; the buffering layer in Zig is the std-adapter, which
/// we route to `QuietWriterAdapter` below.)
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
    // TODO(b2-windows): GetConsoleScreenBufferInfo.
    None
}

// Backs `bun_core::OutputSink[Sys]` — stderr/mkdir/open/QuietWriter.
bun_core::link_impl_OutputSink! {
    Sys for () => |_this| {
        stderr() => bun_core::output::File(Fd::stderr()),
        make_path(cwd, dir) => mkdir_recursive_at(cwd, dir).map_err(Into::into),
        create_file(cwd, path) =>
            openat_a(cwd, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664).map_err(Into::into),
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
        read(fd, buf) => read(fd, buf).map_err(Into::into),
    }
}

// (former `__bun_uws_stat_file` provider deleted — body moved DOWN into
// `bun_uws_sys::socket_context::stat_for_digest`, which calls `libc::stat`
// directly. uws_sys already links libc; the cross-crate hook bought nothing.)
