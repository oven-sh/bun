// Directory iterator:
// - returns errors in the expected format
// - doesn't treat BADF as unreachable
// - borrows the entry name (`RawSlice<u8>`) into the iterator buffer
// - Windows can be configured to return UTF-16 entry names

#![warn(unused_must_use)]

#[cfg(windows)]
use core::mem::offset_of;

use bun_core::RawSlice;
#[cfg(unix)]
use bun_sys::dirent;
use bun_sys::{self as sys, Fd, Tag};

// `Entry.Kind` is `bun_core::FileKind`, re-exported here as
// `bun_sys::EntryKind` (and as `crate::node::types::DirentKind`).
use bun_sys::EntryKind;

pub(crate) struct IteratorResult {
    /// `RawSlice` invariant: borrows the iterator's `getdents` buffer
    /// (streaming-iterator contract — invalidated on next `next()` call).
    /// The kernel writes `d_name` NUL-terminated, so the backing has a NUL at
    /// `[name.len()]` (see `name_assume_z`).
    pub name: RawSlice<u8>,
    pub(crate) kind: EntryKind,
}

impl IteratorResult {
    /// The entry name as a NUL-terminated `&ZStr` — the POSIX `d_name` is always
    /// NUL-terminated in the `getdents` buffer.
    #[inline]
    pub(crate) fn name_assume_z(&self) -> &bun_core::ZStr {
        let s = self.name.slice();
        // SAFETY: `name` is the name of a `dirent::Entry` (on Windows `from_w_path`
        // wrote it), with len excluding the NUL, so `[len] == 0`.
        unsafe { bun_core::ZStr::from_raw(s.as_ptr(), s.len()) }
    }
}
pub(crate) type Result = sys::Result<Option<IteratorResult>>;

/// The `u16` twin of `IteratorResult.name` (`RawSlice<u16>` + `slice_assume_z()`),
/// kept separate so callers avoid an `if (Environment.isWindows) ...` split.
// Lifetime: borrows the iterator's internal `name_data` buffer; invalidated on next().
#[cfg(windows)]
pub(crate) struct IteratorResultWName {
    // `RawSlice` invariant: the iterator's `name_data` outlives this result
    // (streaming-iterator contract — invalidated on next `next()` call).
    // len excludes trailing NUL; storage has NUL at [len].
    data: RawSlice<u16>,
}
#[cfg(windows)]
impl IteratorResultWName {
    pub(crate) fn slice(&self) -> &[u16] {
        self.data.slice()
    }
}

#[cfg(windows)]
pub(crate) struct IteratorResultW {
    pub name: IteratorResultWName,
    pub(crate) kind: EntryKind,
}
#[cfg(windows)]
pub(crate) type ResultW = sys::Result<Option<IteratorResultW>>;

/// Cross-platform marker for the const-bool→buffer-type selection. On Windows
/// this is the real `Select<B>` machinery (see the `windows` `platform` mod);
/// on every other target the per-platform `NewIterator<B>` carries no
/// associated-type bound, so `WrappedSelect<B>` is a vacuous always-satisfied
/// blanket — present only so `NewWrappedIterator`/`iterate` can spell a single
/// `where` clause that propagates the Windows bound without cfg-splitting
/// every impl.
#[cfg(windows)]
pub(crate) use platform::SelectImpl as WrappedSelect;
#[cfg(not(windows))]
pub(crate) trait WrappedSelect<const B: bool> {}
#[cfg(not(windows))]
impl<const B: bool> WrappedSelect<B> for () {}

// ──────────────────────────────────────────────────────────────────────────
// macOS
// ──────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    pub(crate) struct NewIterator<const USE_WINDOWS_OSPATH: bool> {
        pub(crate) dir: Fd,
        pub(crate) seek: i64,
        pub(crate) buf: [u8; 8192],
        pub(crate) index: usize,
        pub(crate) end_index: usize,
        pub(crate) received_eof: bool,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH> {
        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub(crate) fn next(&mut self) -> Result {
            self.next_darwin()
        }

        fn next_darwin(&mut self) -> Result {
            'start_over: loop {
                // A refill that reports more bytes than the buffer holds is malformed.
                let Some(filled) = self.buf.get(..self.end_index) else {
                    return Err(dirent::malformed(Tag::getdirentries64));
                };
                if self.index >= filled.len() {
                    if self.received_eof {
                        return Ok(None);
                    }

                    // getdirentries64() writes to the last 4 bytes of the
                    // buffer to indicate EOF. If that value is not zero, we
                    // have reached the end of the directory and we can skip
                    // the extra syscall. The wrapper zeroes those bytes
                    // before each attempt.
                    // https://github.com/apple-oss-distributions/xnu/blob/94d3b452840153a99b38a3a9659680b2a006908e/bsd/vfs/vfs_syscalls.c#L10444-L10470
                    const GETDIRENTRIES64_EXTENDED_BUFSIZE: usize = 1024;
                    const _: () = assert!(8192 >= GETDIRENTRIES64_EXTENDED_BUFSIZE);
                    self.received_eof = false;
                    let len = self.buf.len();

                    // SAFETY: buf is 8192 writable bytes; seek is a valid *mut i64.
                    let n = unsafe {
                        sys::getdirentries64(
                            self.dir,
                            self.buf.as_mut_ptr(),
                            len,
                            &raw mut self.seek,
                        )
                    }?;

                    if n == 0 {
                        self.received_eof = true;
                        return Ok(None);
                    }

                    self.index = 0;
                    self.end_index = n;
                    let eof_flag = u32::from_ne_bytes(
                        self.buf[len - 4..len]
                            .try_into()
                            .expect("infallible: size matches"),
                    );
                    self.received_eof = self.end_index <= (self.buf.len() - 4) && eof_flag == 1;
                    continue 'start_over;
                }
                let Some(record) = dirent::parse::<dirent::Native>(filled, self.index) else {
                    return Err(dirent::malformed(Tag::getdirentries64));
                };
                self.index = record.next;
                let Some(entry) = record.entry else {
                    continue 'start_over;
                };

                let entry_kind = match entry.d_type {
                    libc::DT_BLK => EntryKind::BlockDevice,
                    libc::DT_CHR => EntryKind::CharacterDevice,
                    libc::DT_DIR => EntryKind::Directory,
                    libc::DT_FIFO => EntryKind::NamedPipe,
                    libc::DT_LNK => EntryKind::SymLink,
                    libc::DT_REG => EntryKind::File,
                    libc::DT_SOCK => EntryKind::UnixDomainSocket,
                    // DT_WHT (14) — Darwin/BSD whiteout; libc crate omits the const on Apple.
                    14 /* DT_WHT */ => EntryKind::Whiteout,
                    _ => EntryKind::Unknown,
                };
                return Ok(Some(IteratorResult {
                    name: RawSlice::new(entry.name),
                    kind: entry_kind,
                }));
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FreeBSD
// ──────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "freebsd")]
mod platform {
    use super::*;

    // The `libc` crate binds neither `getdents` nor `getdirentries` on
    // FreeBSD, so declare the former here.
    unsafe extern "C" {
        // SAFETY precondition: `buf` must be writable for `nbytes` bytes, so this cannot be a `safe fn`.
        fn getdents(fd: core::ffi::c_int, buf: *mut core::ffi::c_char, nbytes: usize) -> isize;
    }

    pub(crate) struct NewIterator<const USE_WINDOWS_OSPATH: bool> {
        pub(crate) dir: Fd,
        pub(crate) buf: [u8; 8192],
        pub(crate) index: usize,
        pub(crate) end_index: usize,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH> {
        pub(crate) fn next(&mut self) -> Result {
            'start_over: loop {
                // A refill that reports more bytes than the buffer holds is malformed.
                let Some(filled) = self.buf.get(..self.end_index) else {
                    return Err(dirent::malformed(Tag::getdents64));
                };
                if self.index >= filled.len() {
                    // SAFETY: dir is a valid open fd; buf is writable for its length.
                    let rc = unsafe {
                        getdents(
                            self.dir.native(),
                            self.buf.as_mut_ptr().cast::<libc::c_char>(),
                            self.buf.len(),
                        )
                    };
                    if rc < 0 {
                        let e = sys::last_errno();
                        // FreeBSD reports ENOENT when iterating an unlinked
                        // but still-open directory.
                        if e == libc::ENOENT {
                            return Ok(None);
                        }
                        return Err(sys::Error::from_code_int(e, Tag::getdents64));
                    }
                    if rc == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = usize::try_from(rc).expect("int cast");
                    continue 'start_over;
                }
                let Some(record) = dirent::parse::<dirent::Native>(filled, self.index) else {
                    return Err(dirent::malformed(Tag::getdents64));
                };
                self.index = record.next;
                let Some(entry) = record.entry else {
                    continue 'start_over;
                };

                let entry_kind: EntryKind = match entry.d_type {
                    libc::DT_BLK => EntryKind::BlockDevice,
                    libc::DT_CHR => EntryKind::CharacterDevice,
                    libc::DT_DIR => EntryKind::Directory,
                    libc::DT_FIFO => EntryKind::NamedPipe,
                    libc::DT_LNK => EntryKind::SymLink,
                    libc::DT_REG => EntryKind::File,
                    libc::DT_SOCK => EntryKind::UnixDomainSocket,
                    // DT_WHT (14) — Darwin/BSD whiteout; the libc crate omits
                    // the constant on Apple and FreeBSD targets.
                    14 /* DT_WHT */ => EntryKind::Whiteout,
                    _ => EntryKind::Unknown,
                };
                return Ok(Some(IteratorResult {
                    name: RawSlice::new(entry.name),
                    kind: entry_kind,
                }));
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Linux
// ──────────────────────────────────────────────────────────────────────────
#[cfg(any(target_os = "linux", target_os = "android"))]
mod platform {
    use super::*;

    pub(crate) struct NewIterator<const USE_WINDOWS_OSPATH: bool> {
        pub(crate) dir: Fd,
        pub(crate) buf: [u8; 8192],
        pub(crate) index: usize,
        pub(crate) end_index: usize,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH> {
        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub(crate) fn next(&mut self) -> Result {
            'start_over: loop {
                // A refill that reports more bytes than the buffer holds is malformed.
                let Some(filled) = self.buf.get(..self.end_index) else {
                    return Err(dirent::malformed(Tag::getdents64));
                };
                if self.index >= filled.len() {
                    // glibc doesn't expose getdents64; go straight to the
                    // raw syscall.
                    // SAFETY: buf is valid for 8192 bytes; fd is a plain c_int.
                    let rc = unsafe {
                        libc::syscall(
                            libc::SYS_getdents64,
                            self.dir.native() as libc::c_long,
                            self.buf.as_mut_ptr(),
                            self.buf.len(),
                        )
                    };
                    if rc < 0 {
                        return Err(sys::Error::from_code_int(
                            sys::last_errno(),
                            Tag::getdents64,
                        ));
                    }
                    if rc == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = rc as usize;
                    continue 'start_over;
                }
                let Some(record) = dirent::parse::<dirent::Native>(filled, self.index) else {
                    return Err(dirent::malformed(Tag::getdents64));
                };
                self.index = record.next;
                let Some(entry) = record.entry else {
                    continue 'start_over;
                };

                let entry_kind: EntryKind = match entry.d_type {
                    libc::DT_BLK => EntryKind::BlockDevice,
                    libc::DT_CHR => EntryKind::CharacterDevice,
                    libc::DT_DIR => EntryKind::Directory,
                    libc::DT_FIFO => EntryKind::NamedPipe,
                    libc::DT_LNK => EntryKind::SymLink,
                    libc::DT_REG => EntryKind::File,
                    libc::DT_SOCK => EntryKind::UnixDomainSocket,
                    // DT_UNKNOWN: Some filesystems (e.g., bind mounts, FUSE, NFS)
                    // don't provide d_type. Callers should use lstatat() to determine
                    // the type when needed (lazy stat pattern for performance).
                    _ => EntryKind::Unknown,
                };
                return Ok(Some(IteratorResult {
                    name: RawSlice::new(entry.name),
                    kind: entry_kind,
                }));
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Windows
// ──────────────────────────────────────────────────────────────────────────
#[cfg(windows)]
mod platform {
    use super::*;
    use bun_paths::strings;
    use bun_sys::SystemErrno;
    use bun_sys::windows as w;
    use bun_sys::windows::ntdll;
    use bun_sys::windows::{
        BOOLEAN, FALSE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_DIRECTORY_INFORMATION, IO_STATUS_BLOCK, TRUE, UNICODE_STRING,
    };

    // While the official api docs guarantee FILE_BOTH_DIR_INFORMATION to be aligned properly
    // this may not always be the case (e.g. due to faulty VM/Sandboxing tools)
    // (Rust raw-pointer reads below use unaligned-safe casts.)

    /// Helper to select `name_data` element type (`[u16; 257]` or `[u8; 513]`)
    /// and result type from the const-bool generic.
    pub(crate) trait WindowsOsPath {
        type NameData: Sized;
        type Entry;
        /// Max u16 codeunits that fit in `name_data` (reserving one for the
        /// trailing NUL on the u16 path, or accounting for UTF-16→UTF-8
        /// expansion on the u8 path).
        fn max_name_u16() -> usize;
        /// Convert the raw UTF-16 directory-entry name into the per-variant
        /// result, writing into `name_data` (the iterator-owned scratch buffer
        /// whose contents are valid until the next `next()` call).
        fn make_entry(
            name_data: &mut Self::NameData,
            dir_info_name: &[u16],
            kind: EntryKind,
        ) -> Self::Entry;
    }
    pub(crate) struct OsPathFalse;
    pub(crate) struct OsPathTrue;
    impl WindowsOsPath for OsPathFalse {
        type NameData = [u8; 513];
        type Entry = IteratorResult;
        #[inline]
        fn max_name_u16() -> usize {
            (513 - 1) / 2
        }
        fn make_entry(
            name_data: &mut [u8; 513],
            dir_info_name: &[u16],
            kind: EntryKind,
        ) -> IteratorResult {
            // Trust that Windows gives us valid UTF-16LE
            let name_utf8 = strings::paths::from_w_path(&mut name_data[..], dir_info_name);
            IteratorResult {
                name: RawSlice::new(name_utf8.as_bytes()),
                kind,
            }
        }
    }
    impl WindowsOsPath for OsPathTrue {
        type NameData = [u16; 257];
        type Entry = IteratorResultW;
        #[inline]
        fn max_name_u16() -> usize {
            257 - 1
        }
        fn make_entry(
            name_data: &mut [u16; 257],
            dir_info_name: &[u16],
            kind: EntryKind,
        ) -> IteratorResultW {
            let len = dir_info_name.len();
            name_data[..len].copy_from_slice(dir_info_name);
            name_data[len] = 0;
            IteratorResultW {
                name: IteratorResultWName {
                    data: RawSlice::new(&name_data[..len]),
                },
                kind,
            }
        }
    }
    // Map the const bool to the marker type.
    pub(super) type Select<const B: bool> = <() as SelectImpl<B>>::T;
    pub(crate) trait SelectImpl<const B: bool> {
        type T: WindowsOsPath;
    }
    impl SelectImpl<false> for () {
        type T = OsPathFalse;
    }
    impl SelectImpl<true> for () {
        type T = OsPathTrue;
    }

    #[repr(C, align(8))]
    pub(crate) struct NewIterator<const USE_WINDOWS_OSPATH: bool>
    where
        (): SelectImpl<USE_WINDOWS_OSPATH>,
    {
        pub(crate) dir: Fd,

        // This structure must be aligned on a LONGLONG (8-byte) boundary.
        // If a buffer contains two or more of these structures, the
        // NextEntryOffset value in each entry, except the last, falls on an
        // 8-byte boundary.
        // https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_directory_information
        pub(crate) buf: [u8; 8192],
        pub(crate) index: usize,
        pub(crate) end_index: usize,
        pub(crate) first: bool,
        pub(crate) name_data: <Select<USE_WINDOWS_OSPATH> as WindowsOsPath>::NameData,
        /// Optional kernel-side wildcard filter passed to NtQueryDirectoryFile.
        /// Evaluated by FsRtlIsNameInExpression (case-insensitive, supports `*` and `?`).
        /// Only honored on the first call (RestartScan=TRUE); sticky for the handle lifetime.
        // Lifetime: caller-owned UTF-16 slice, stored as raw ptr+len; the caller
        // must keep it alive for the iterator's lifetime.
        pub(crate) name_filter: Option<(*const u16, usize)>,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH>
    where
        (): SelectImpl<USE_WINDOWS_OSPATH>,
    {
        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub(crate) fn next(
            &mut self,
        ) -> sys::Result<Option<<Select<USE_WINDOWS_OSPATH> as WindowsOsPath>::Entry>> {
            loop {
                if self.index >= self.end_index {
                    // The I/O manager only fills the IO_STATUS_BLOCK on IRP
                    // completion. When NtQueryDirectoryFile fails with an
                    // NT_ERROR status (e.g. parameter validation), the block
                    // is left untouched, so zero-initialize it rather than
                    // reading uninitialized stack if the call fails.
                    let mut io: IO_STATUS_BLOCK = bun_core::ffi::zeroed();
                    if self.first {
                        // > Any bytes inserted for alignment SHOULD be set to zero, and the receiver MUST ignore them
                        self.buf.fill(0);
                    }

                    let mut filter_us = UNICODE_STRING {
                        Length: 0,
                        MaximumLength: 0,
                        Buffer: core::ptr::null_mut(),
                    };
                    let filter_ptr: *mut UNICODE_STRING = match self.name_filter {
                        Some((ptr, len)) => {
                            // try_from panics on overflow rather than `as u16`
                            // silent truncation.
                            let len_bytes = u16::try_from(len * 2).expect("name_filter too long");
                            filter_us.Length = len_bytes;
                            filter_us.MaximumLength = len_bytes;
                            filter_us.Buffer = ptr as *mut u16;
                            &mut filter_us
                        }
                        None => core::ptr::null_mut(),
                    };

                    // SAFETY: FFI; `dir` is a directory HANDLE, `buf` is 8192 8-byte-aligned
                    // bytes, `io`/`filter_us` live on this stack frame for the call duration.
                    let rc = unsafe {
                        ntdll::NtQueryDirectoryFile(
                            self.dir.native(),
                            core::ptr::null_mut(),
                            core::ptr::null_mut(),
                            core::ptr::null_mut(),
                            &mut io,
                            self.buf.as_mut_ptr().cast(),
                            self.buf.len() as u32,
                            w::FILE_INFORMATION_CLASS::FileDirectoryInformation,
                            FALSE as BOOLEAN,
                            filter_ptr,
                            if self.first {
                                TRUE as BOOLEAN
                            } else {
                                FALSE as BOOLEAN
                            },
                        )
                    };

                    self.first = false;

                    // Check the return status before trusting io.Information;
                    // the IO_STATUS_BLOCK is not written on NT_ERROR statuses.

                    // If the handle is not a directory, we'll get STATUS_INVALID_PARAMETER.
                    if rc == w::NTSTATUS::INVALID_PARAMETER {
                        sys::syslog!("NtQueryDirectoryFile({}) = INVALID_PARAMETER", self.dir);
                        return Err(sys::Error::from_code(
                            SystemErrno::ENOTDIR.to_e(),
                            Tag::NtQueryDirectoryFile,
                        ));
                    }

                    // NO_SUCH_FILE is returned on the first call when a FileName filter
                    // matches nothing; NO_MORE_FILES on subsequent calls. Both mean "done".
                    if rc == w::NTSTATUS::NO_MORE_FILES || rc == w::NTSTATUS::NO_SUCH_FILE {
                        sys::syslog!("NtQueryDirectoryFile({}) = {:#x}", self.dir, rc.0);
                        return Ok(None);
                    }

                    if rc != w::NTSTATUS::SUCCESS {
                        sys::syslog!("NtQueryDirectoryFile({}) = {:#x}", self.dir, rc.0);
                        return Err(sys::Error::new(rc, Tag::NtQueryDirectoryFile));
                    }

                    if io.Information == 0 {
                        sys::syslog!("NtQueryDirectoryFile({}) = 0", self.dir);
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = io.Information;

                    sys::syslog!("NtQueryDirectoryFile({}) = {}", self.dir, self.end_index);
                }

                let entry_offset = self.index;
                let p = self.buf.as_ptr();
                // While the official api docs guarantee FILE_DIRECTORY_INFORMATION to
                // be aligned properly this may not always be the case (e.g. due to
                // faulty VM/Sandboxing tools) — read fields via unaligned loads.
                // SAFETY: entry_offset < end_index ≤ buf.len(); the header up through
                // FileName lies within `buf` per the kernel contract.
                let next_entry_offset =
                    unsafe {
                        core::ptr::read_unaligned(p.add(
                            entry_offset + offset_of!(FILE_DIRECTORY_INFORMATION, NextEntryOffset),
                        ) as *const u32)
                    };
                // SAFETY: see above.
                let file_name_length = unsafe {
                    core::ptr::read_unaligned(
                        p.add(entry_offset + offset_of!(FILE_DIRECTORY_INFORMATION, FileNameLength))
                            as *const u32,
                    )
                } as usize;
                // SAFETY: see above.
                let file_attributes = unsafe {
                    core::ptr::read_unaligned(
                        p.add(entry_offset + offset_of!(FILE_DIRECTORY_INFORMATION, FileAttributes))
                            as *const u32,
                    )
                };

                if next_entry_offset != 0 {
                    self.index = entry_offset + next_entry_offset as usize;
                } else {
                    self.index = self.buf.len();
                }

                // Some filesystem / filter drivers have been observed returning
                // FILE_DIRECTORY_INFORMATION entries with an out-of-range
                // FileNameLength (well beyond the 255-WCHAR NTFS component
                // limit). Clamp to what fits in name_data (destination) and to
                // what remains in buf (source) so a misbehaving driver cannot
                // walk us past the end of either buffer.
                let max_name_u16 = <Select<USE_WINDOWS_OSPATH> as WindowsOsPath>::max_name_u16();
                let name_byte_offset =
                    entry_offset + offset_of!(FILE_DIRECTORY_INFORMATION, FileName);
                let buf_remaining_u16 =
                    self.buf.len().saturating_sub(name_byte_offset) / size_of::<u16>();
                let name_len_u16 = (file_name_length / 2)
                    .min(max_name_u16)
                    .min(buf_remaining_u16);
                // name_byte_offset + name_len_u16*2 ≤ buf.len() by clamp above.
                // `buf` follows the 8-byte `Fd` in a `repr(C, align(8))` struct so
                // it is itself 8-byte aligned, and per MS docs each record (and
                // thus its FileName at offset 64) lands on an 8-byte boundary —
                // bytemuck checks the u8→u16 alignment at runtime.
                let dir_info_name: &[u16] = bytemuck::cast_slice(
                    &self.buf[name_byte_offset..name_byte_offset + name_len_u16 * 2],
                );

                if dir_info_name == [b'.' as u16] || dir_info_name == [b'.' as u16, b'.' as u16] {
                    continue;
                }

                let kind = {
                    let isdir = file_attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
                    let islink = file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0;
                    // on windows symlinks can be directories, too. We prioritize the
                    // "sym_link" kind over the "directory" kind
                    // this will coerce into either .file or .directory later
                    // once the symlink is read
                    if islink {
                        EntryKind::SymLink
                    } else if isdir {
                        EntryKind::Directory
                    } else {
                        EntryKind::File
                    }
                };

                return Ok(Some(
                    <Select<USE_WINDOWS_OSPATH> as WindowsOsPath>::make_entry(
                        &mut self.name_data,
                        dir_info_name,
                        kind,
                    ),
                ));
            }
        }
    }
}

pub(crate) use platform::NewIterator;

// ──────────────────────────────────────────────────────────────────────────
// Wrapped iterator — selects the underlying `NewIterator<B>` and provides a
// uniform `init`/`next`/`set_name_filter` surface.
//
// Parametrized on a `bool` (`false` == u8 paths, `true` == u16 paths) since
// stable const generics don't admit user enums; the `next()` impl is split
// per-value to avoid inherent associated types.
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct NewWrappedIterator<const IS_U16: bool>
where
    (): WrappedSelect<IS_U16>,
{
    pub(crate) iter: NewIterator<IS_U16>,
}

impl NewWrappedIterator<false> {
    #[inline]
    pub(crate) fn next(&mut self) -> Result {
        self.iter.next()
    }
}

impl NewWrappedIterator<true> {
    #[cfg(windows)]
    #[inline]
    pub(crate) fn next(&mut self) -> ResultW {
        self.iter.next()
    }
}

impl<const IS_U16: bool> NewWrappedIterator<IS_U16>
where
    (): WrappedSelect<IS_U16>,
{
    pub(crate) fn init(dir: Fd) -> Self {
        #[cfg(target_os = "macos")]
        {
            return Self {
                iter: NewIterator {
                    dir,
                    seek: 0,
                    index: 0,
                    end_index: 0,
                    // zero-init avoids the invalid_value lint on [u8; N]
                    buf: [0u8; 8192],
                    received_eof: false,
                },
            };
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return Self {
                iter: NewIterator {
                    dir,
                    index: 0,
                    end_index: 0,
                    // zero-init avoids the invalid_value lint on [u8; N]
                    buf: [0u8; 8192],
                },
            };
        }
        #[cfg(target_os = "freebsd")]
        {
            return Self {
                iter: NewIterator {
                    dir,
                    index: 0,
                    end_index: 0,
                    // zero-init avoids the invalid_value lint on [u8; N]
                    buf: [0u8; 8192],
                },
            };
        }
        #[cfg(windows)]
        {
            return Self {
                iter: NewIterator {
                    dir,
                    index: 0,
                    end_index: 0,
                    first: true,
                    // zero-init avoids the invalid_value lint on integer arrays
                    buf: [0u8; 8192],
                    // SAFETY: NameData is [u8; 513] or [u16; 257]; zero is a valid bit pattern.
                    name_data: unsafe { bun_core::ffi::zeroed_unchecked() },
                    name_filter: None,
                },
            };
        }
    }
}

pub(crate) type WrappedIterator = NewWrappedIterator<false>;
#[cfg(windows)]
pub(crate) type WrappedIteratorW = NewWrappedIterator<true>;

pub(crate) fn iterate<const IS_U16: bool>(self_: Fd) -> NewWrappedIterator<IS_U16>
where
    (): WrappedSelect<IS_U16>,
{
    NewWrappedIterator::<IS_U16>::init(self_)
}
