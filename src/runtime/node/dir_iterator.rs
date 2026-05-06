// This is copied from std.fs.Dir.Iterator
// The differences are:
// - it returns errors in the expected format
// - doesn't mark BADF as unreachable
// - It uses PathString instead of []const u8
// - Windows can be configured to return []const u16

#![allow(unused_imports, dead_code)]

use core::mem::{offset_of, size_of};

use bun_str::{strings, PathString, WStr};
use bun_sys::{self as sys, Fd, SystemErrno, Tag};

// `Entry.Kind` in Zig is `jsc.Node.Dirent.Kind` == `std.fs.Dir.Entry.Kind`.
// In the Rust port that maps to `bun_core::FileKind`, re-exported here as
// `bun_sys::EntryKind` (and as `crate::node::types::DirentKind`).
use bun_sys::EntryKind;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum IteratorError {
    #[error("AccessDenied")]
    AccessDenied,
    #[error("SystemResources")]
    SystemResources,
    /// posix.UnexpectedError
    #[error("Unexpected")]
    Unexpected,
}
impl From<IteratorError> for bun_core::Error {
    fn from(e: IteratorError) -> Self {
        bun_core::Error::intern(<&'static str>::from(e))
    }
}

pub struct IteratorResult {
    pub name: PathString,
    pub kind: EntryKind,
}
pub type Result = sys::Result<Option<IteratorResult>>;

/// Fake PathString to have less `if (Environment.isWindows) ...`
// TODO(port): lifetime — borrows iterator's internal `name_data` buffer; invalidated on next()
pub struct IteratorResultWName {
    data_ptr: *const u16,
    data_len: usize, // len excludes trailing NUL; storage has NUL at [len]
}
impl IteratorResultWName {
    pub fn slice(&self) -> &[u16] {
        // SAFETY: points into iterator's name_data buffer, valid until next() is called again
        unsafe { core::slice::from_raw_parts(self.data_ptr, self.data_len) }
    }
    pub fn slice_assume_z(&self) -> &WStr {
        // SAFETY: name_data[len] == 0 was written by next()
        unsafe { WStr::from_raw(self.data_ptr, self.data_len) }
    }
}

pub struct IteratorResultW {
    pub name: IteratorResultWName,
    pub kind: EntryKind,
}
pub type ResultW = sys::Result<Option<IteratorResultW>>;

pub type Iterator = NewIterator<false>;
pub type IteratorW = NewIterator<true>;

// ──────────────────────────────────────────────────────────────────────────
// macOS
// ──────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use bun_sys::darwin as posix_system;

    #[repr(C)] // buf must be aligned to dirent
    pub struct NewIterator<const USE_WINDOWS_OSPATH: bool> {
        pub dir: Fd,
        pub seek: i64,
        // TODO(port): Zig used `align(@alignOf(std.posix.system.dirent))`; #[repr(align)] on a
        // wrapper or an aligned newtype may be needed in Phase B.
        pub buf: [u8; 8192],
        pub index: usize,
        pub end_index: usize,
        pub received_eof: bool,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH> {
        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub fn next(&mut self) -> Result {
            self.next_darwin()
        }

        fn next_darwin(&mut self) -> Result {
            unsafe extern "C" {
                // Private libsystem symbol; same one Zig's `posix.system.__getdirentries64` hits.
                fn __getdirentries64(
                    fd: libc::c_int,
                    buf: *mut u8,
                    nbytes: usize,
                    basep: *mut i64,
                ) -> isize;
            }
            'start_over: loop {
                if self.index >= self.end_index {
                    if self.received_eof {
                        return Ok(None);
                    }

                    // getdirentries64() writes to the last 4 bytes of the
                    // buffer to indicate EOF. If that value is not zero, we
                    // have reached the end of the directory and we can skip
                    // the extra syscall.
                    // https://github.com/apple-oss-distributions/xnu/blob/94d3b452840153a99b38a3a9659680b2a006908e/bsd/vfs/vfs_syscalls.c#L10444-L10470
                    const GETDIRENTRIES64_EXTENDED_BUFSIZE: usize = 1024;
                    const _: () = assert!(8192 >= GETDIRENTRIES64_EXTENDED_BUFSIZE);
                    self.received_eof = false;
                    // Always zero the bytes where the flag will be written
                    // so we don't confuse garbage with EOF.
                    let len = self.buf.len();
                    self.buf[len - 4..len].copy_from_slice(&[0, 0, 0, 0]);

                    // SAFETY: FFI call into libc __getdirentries64; buf is 8192 bytes
                    let rc = unsafe {
                        __getdirentries64(
                            self.dir.native(),
                            self.buf.as_mut_ptr(),
                            self.buf.len(),
                            &mut self.seek,
                        )
                    };

                    if rc < 1 {
                        if rc == 0 {
                            self.received_eof = true;
                            return Ok(None);
                        }
                        return Err(sys::Error::from_code_int(
                            sys::last_errno(),
                            Tag::getdirentries64,
                        ));
                    }

                    self.index = 0;
                    self.end_index = usize::try_from(rc).unwrap();
                    let eof_flag =
                        u32::from_ne_bytes(self.buf[len - 4..len].try_into().unwrap());
                    self.received_eof =
                        self.end_index <= (self.buf.len() - 4) && eof_flag == 1;
                }
                // SAFETY: self.index < self.end_index <= buf.len(); buf holds packed dirent records
                let darwin_entry = unsafe {
                    &*(self.buf.as_ptr().add(self.index) as *const libc::dirent)
                };
                let next_index = self.index + darwin_entry.d_reclen as usize;
                self.index = next_index;

                // SAFETY: dirent.d_name is a [*]u8 of length d_namlen within the record
                let name = unsafe {
                    core::slice::from_raw_parts(
                        darwin_entry.d_name.as_ptr() as *const u8,
                        darwin_entry.d_namlen as usize,
                    )
                };

                if name == b"." || name == b".." || darwin_entry.d_ino == 0 {
                    continue 'start_over;
                }

                let entry_kind = match darwin_entry.d_type {
                    libc::DT_BLK => EntryKind::BlockDevice,
                    libc::DT_CHR => EntryKind::CharacterDevice,
                    libc::DT_DIR => EntryKind::Directory,
                    libc::DT_FIFO => EntryKind::NamedPipe,
                    libc::DT_LNK => EntryKind::SymLink,
                    libc::DT_REG => EntryKind::File,
                    libc::DT_SOCK => EntryKind::UnixDomainSocket,
                    libc::DT_WHT => EntryKind::Whiteout,
                    _ => EntryKind::Unknown,
                };
                return Ok(Some(IteratorResult {
                    name: PathString::init(name),
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

    pub struct NewIterator<const USE_WINDOWS_OSPATH: bool> {
        pub dir: Fd,
        // TODO(port): align(@alignOf(posix.system.dirent))
        pub buf: [u8; 8192],
        pub index: usize,
        pub end_index: usize,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH> {
        pub fn next(&mut self) -> Result {
            'start_over: loop {
                if self.index >= self.end_index {
                    // SAFETY: FFI getdents
                    let rc = unsafe {
                        libc::getdents(
                            self.dir.native(),
                            self.buf.as_mut_ptr() as *mut libc::c_char,
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
                    self.end_index = usize::try_from(rc).unwrap();
                }
                // SAFETY: index within filled buf; packed dirent
                let entry = unsafe {
                    &*(self.buf.as_ptr().add(self.index) as *const libc::dirent)
                };
                self.index += entry.d_reclen as usize;

                // SAFETY: name is d_namlen bytes within the record
                let name = unsafe {
                    core::slice::from_raw_parts(
                        entry.d_name.as_ptr() as *const u8,
                        entry.d_namlen as usize,
                    )
                };
                if name == b"." || name == b".." || entry.d_fileno == 0 {
                    continue 'start_over;
                }

                let entry_kind: EntryKind = match entry.d_type {
                    libc::DT_BLK => EntryKind::BlockDevice,
                    libc::DT_CHR => EntryKind::CharacterDevice,
                    libc::DT_DIR => EntryKind::Directory,
                    libc::DT_FIFO => EntryKind::NamedPipe,
                    libc::DT_LNK => EntryKind::SymLink,
                    libc::DT_REG => EntryKind::File,
                    libc::DT_SOCK => EntryKind::UnixDomainSocket,
                    libc::DT_WHT => EntryKind::Whiteout,
                    _ => EntryKind::Unknown,
                };
                return Ok(Some(IteratorResult {
                    name: PathString::init(name),
                    kind: entry_kind,
                }));
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Linux
// ──────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    pub struct NewIterator<const USE_WINDOWS_OSPATH: bool> {
        pub dir: Fd,
        // The if guard is solely there to prevent compile errors from missing `linux.dirent64`
        // definition when compiling for other OSes. It doesn't do anything when compiling for Linux.
        // TODO(port): align(@alignOf(linux.dirent64))
        pub buf: [u8; 8192],
        pub index: usize,
        pub end_index: usize,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH> {
        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub fn next(&mut self) -> Result {
            'start_over: loop {
                if self.index >= self.end_index {
                    // glibc doesn't expose getdents64; go straight to the
                    // syscall (matches Zig's `linux.getdents64` raw-syscall
                    // path).
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
                }
                // SAFETY: index within filled buf; packed dirent64
                let linux_entry = unsafe {
                    &*(self.buf.as_ptr().add(self.index) as *const libc::dirent64)
                };
                let next_index = self.index + linux_entry.d_reclen as usize;
                self.index = next_index;

                // SAFETY: dirent64.d_name is NUL-terminated within the record
                let name = unsafe {
                    let p = linux_entry.d_name.as_ptr() as *const u8;
                    let mut len = 0usize;
                    while *p.add(len) != 0 {
                        len += 1;
                    }
                    core::slice::from_raw_parts(p, len)
                };

                // skip . and .. entries
                if name == b"." || name == b".." {
                    continue 'start_over;
                }

                let entry_kind: EntryKind = match linux_entry.d_type {
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
                    name: PathString::init(name),
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
    use bun_sys::windows as w;
    use bun_sys::windows::ntdll;
    use bun_sys::windows::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_DIRECTORY_INFORMATION,
        IO_STATUS_BLOCK, UNICODE_STRING, BOOLEAN, FALSE, TRUE,
    };

    // While the official api docs guarantee FILE_BOTH_DIR_INFORMATION to be aligned properly
    // this may not always be the case (e.g. due to faulty VM/Sandboxing tools)
    // (Rust raw-pointer reads below use unaligned-safe casts.)

    /// Helper to select `name_data` element type and result type from the const-bool generic.
    /// Zig: `name_data: if (use_windows_ospath) [257]u16 else [513]u8`.
    pub trait WindowsOsPath {
        type NameData: Sized;
        type Entry;
        const IS_U16: bool;
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
    pub struct OsPathFalse;
    pub struct OsPathTrue;
    impl WindowsOsPath for OsPathFalse {
        type NameData = [u8; 513];
        type Entry = IteratorResult;
        const IS_U16: bool = false;
        #[inline]
        fn max_name_u16() -> usize {
            // Zig: (self.name_data.len - 1) / 2
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
                name: PathString::init(name_utf8.as_bytes()),
                kind,
            }
        }
    }
    impl WindowsOsPath for OsPathTrue {
        type NameData = [u16; 257];
        type Entry = IteratorResultW;
        const IS_U16: bool = true;
        #[inline]
        fn max_name_u16() -> usize {
            // Zig: self.name_data.len - 1
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
                    data_ptr: name_data.as_ptr(),
                    data_len: len,
                },
                kind,
            }
        }
    }
    // Map the const bool to the marker type.
    pub type Select<const B: bool> = <() as SelectImpl<B>>::T;
    pub trait SelectImpl<const B: bool> { type T: WindowsOsPath; }
    impl SelectImpl<false> for () { type T = OsPathFalse; }
    impl SelectImpl<true> for () { type T = OsPathTrue; }

    #[repr(C, align(8))]
    pub struct NewIterator<const USE_WINDOWS_OSPATH: bool>
    where
        (): SelectImpl<USE_WINDOWS_OSPATH>,
    {
        pub dir: Fd,

        // This structure must be aligned on a LONGLONG (8-byte) boundary.
        // If a buffer contains two or more of these structures, the
        // NextEntryOffset value in each entry, except the last, falls on an
        // 8-byte boundary.
        // https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_directory_information
        pub buf: [u8; 8192],
        pub index: usize,
        pub end_index: usize,
        pub first: bool,
        pub name_data: <Select<USE_WINDOWS_OSPATH> as WindowsOsPath>::NameData,
        /// Optional kernel-side wildcard filter passed to NtQueryDirectoryFile.
        /// Evaluated by FsRtlIsNameInExpression (case-insensitive, supports `*` and `?`).
        /// Only honored on the first call (RestartScan=TRUE); sticky for the handle lifetime.
        // TODO(port): lifetime — caller-owned UTF-16 slice; stored as raw ptr+len.
        pub name_filter: Option<(*const u16, usize)>,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH>
    where
        (): SelectImpl<USE_WINDOWS_OSPATH>,
    {
        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub fn next(
            &mut self,
        ) -> sys::Result<Option<<Select<USE_WINDOWS_OSPATH> as WindowsOsPath>::Entry>> {
            loop {
                if self.index >= self.end_index {
                    // The I/O manager only fills the IO_STATUS_BLOCK on IRP
                    // completion. When NtQueryDirectoryFile fails with an
                    // NT_ERROR status (e.g. parameter validation), the block
                    // is left untouched, so zero-initialize it rather than
                    // reading uninitialized stack if the call fails.
                    // SAFETY: all-zero is a valid IO_STATUS_BLOCK.
                    let mut io: IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
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
                            let len_bytes = (len * 2) as u16;
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
                            self.dir.cast(),
                            core::ptr::null_mut(),
                            core::ptr::null_mut(),
                            core::ptr::null_mut(),
                            &mut io,
                            self.buf.as_mut_ptr().cast(),
                            self.buf.len() as u32,
                            w::FILE_INFORMATION_CLASS::FileDirectoryInformation,
                            FALSE as BOOLEAN,
                            filter_ptr,
                            if self.first { TRUE as BOOLEAN } else { FALSE as BOOLEAN },
                        )
                    };

                    self.first = false;

                    // Check the return status before trusting io.Information;
                    // the IO_STATUS_BLOCK is not written on NT_ERROR statuses.

                    // If the handle is not a directory, we'll get STATUS_INVALID_PARAMETER.
                    if rc == w::NTSTATUS::INVALID_PARAMETER {
                        sys::syslog!(
                            "NtQueryDirectoryFile({}) = INVALID_PARAMETER",
                            self.dir
                        );
                        return Err(sys::Error::from_code(
                            SystemErrno::ENOTDIR,
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
                        let errno = w::Win32Error::from_nt_status(rc)
                            .to_system_errno()
                            .unwrap_or(SystemErrno::EUNKNOWN);
                        return Err(sys::Error::from_code(errno, Tag::NtQueryDirectoryFile));
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
                let next_entry_offset = unsafe {
                    core::ptr::read_unaligned(
                        p.add(entry_offset
                            + offset_of!(FILE_DIRECTORY_INFORMATION, NextEntryOffset))
                            as *const u32,
                    )
                };
                // SAFETY: see above.
                let file_name_length = unsafe {
                    core::ptr::read_unaligned(
                        p.add(entry_offset
                            + offset_of!(FILE_DIRECTORY_INFORMATION, FileNameLength))
                            as *const u32,
                    )
                } as usize;
                // SAFETY: see above.
                let file_attributes = unsafe {
                    core::ptr::read_unaligned(
                        p.add(entry_offset
                            + offset_of!(FILE_DIRECTORY_INFORMATION, FileAttributes))
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
                let max_name_u16 =
                    <Select<USE_WINDOWS_OSPATH> as WindowsOsPath>::max_name_u16();
                let name_byte_offset =
                    entry_offset + offset_of!(FILE_DIRECTORY_INFORMATION, FileName);
                let buf_remaining_u16 =
                    self.buf.len().saturating_sub(name_byte_offset) / size_of::<u16>();
                let name_len_u16 =
                    (file_name_length / 2).min(max_name_u16).min(buf_remaining_u16);
                // SAFETY: name_byte_offset + name_len_u16*2 ≤ buf.len() by clamp above;
                // FileName is u16-aligned (NextEntryOffset/record is 8-byte aligned).
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

// ──────────────────────────────────────────────────────────────────────────
// WASI
// ──────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "wasi")]
mod platform {
    use super::*;
    use bun_sys::wasi as w;

    pub struct NewIterator<const USE_WINDOWS_OSPATH: bool> {
        pub dir: Fd,
        pub buf: [u8; 8192], // TODO align(@alignOf(os.wasi.dirent_t)),
        pub cookie: u64,
        pub index: usize,
        pub end_index: usize,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH> {
        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub fn next(&mut self) -> Result {
            // We intentinally use fd_readdir even when linked with libc,
            // since its implementation is exactly the same as below,
            // and we avoid the code complexity here.
            'start_over: loop {
                if self.index >= self.end_index {
                    let mut bufused: usize = 0;
                    // SAFETY: FFI fd_readdir
                    let errno = unsafe {
                        w::fd_readdir(
                            self.dir.native(),
                            self.buf.as_mut_ptr(),
                            self.buf.len(),
                            self.cookie,
                            &mut bufused,
                        )
                    };
                    match errno {
                        w::Errno::SUCCESS => {}
                        w::Errno::BADF => unreachable!(), // Dir is invalid or was opened without iteration ability
                        w::Errno::FAULT => unreachable!(),
                        w::Errno::NOTDIR => unreachable!(),
                        w::Errno::INVAL => unreachable!(),
                        w::Errno::NOTCAPABLE => {
                            return Err(sys::Error::from_code_int(libc::EACCES, Tag::getdents64));
                        }
                        _ => {
                            return Err(sys::Error::from_code_int(errno as i32, Tag::getdents64));
                        }
                    }
                    if bufused == 0 {
                        return Ok(None);
                    }
                    self.index = 0;
                    self.end_index = bufused;
                }
                // SAFETY: index within filled buf
                let entry = unsafe { &*(self.buf.as_ptr().add(self.index) as *const w::dirent_t) };
                let entry_size = size_of::<w::dirent_t>();
                let name_index = self.index + entry_size;
                let name = &self.buf[name_index..name_index + entry.d_namlen as usize];

                let next_index = name_index + entry.d_namlen as usize;
                self.index = next_index;
                self.cookie = entry.d_next;

                // skip . and .. entries
                if name == b"." || name == b".." {
                    continue 'start_over;
                }

                let entry_kind = match entry.d_type {
                    w::Filetype::BLOCK_DEVICE => EntryKind::BlockDevice,
                    w::Filetype::CHARACTER_DEVICE => EntryKind::CharacterDevice,
                    w::Filetype::DIRECTORY => EntryKind::Directory,
                    w::Filetype::SYMBOLIC_LINK => EntryKind::SymLink,
                    w::Filetype::REGULAR_FILE => EntryKind::File,
                    w::Filetype::SOCKET_STREAM | w::Filetype::SOCKET_DGRAM => {
                        EntryKind::UnixDomainSocket
                    }
                    _ => EntryKind::Unknown,
                };
                return Ok(Some(IteratorResult {
                    name: PathString::init(name),
                    kind: entry_kind,
                }));
            }
        }
    }
}

pub use platform::NewIterator;

// ──────────────────────────────────────────────────────────────────────────
// Wrapped iterator — selects the underlying `NewIterator<B>` and provides a
// uniform `init`/`next`/`set_name_filter` surface.
//
// Zig parametrized this on a `PathType` enum (`.u8` / `.u16`). Rust's stable
// const generics don't admit user enums, so we map to a `bool` (`false` ==
// `.u8`, `true` == `.u16`) and split the `next()` impl per-value to avoid
// inherent associated types.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PathType {
    U8,
    U16,
}

pub struct NewWrappedIterator<const IS_U16: bool> {
    pub iter: NewIterator<IS_U16>,
}

impl NewWrappedIterator<false> {
    #[inline]
    pub fn next(&mut self) -> Result {
        self.iter.next()
    }
}

impl NewWrappedIterator<true> {
    #[cfg(not(windows))]
    #[inline]
    pub fn next(&mut self) -> Result {
        // On POSIX the underlying iterator ignores `USE_WINDOWS_OSPATH` and
        // always yields UTF-8 `IteratorResult`s.
        self.iter.next()
    }
    #[cfg(windows)]
    #[inline]
    pub fn next(&mut self) -> ResultW {
        self.iter.next()
    }
}

impl<const IS_U16: bool> NewWrappedIterator<IS_U16> {
    pub fn init(dir: Fd) -> Self {
        #[cfg(target_os = "macos")]
        {
            return Self {
                iter: NewIterator {
                    dir,
                    seek: 0,
                    index: 0,
                    end_index: 0,
                    // Zig `= undefined`; zero-init avoids Rust's invalid_value lint on [u8; N]
                    buf: [0u8; 8192],
                    received_eof: false,
                },
            };
        }
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        {
            return Self {
                iter: NewIterator {
                    dir,
                    index: 0,
                    end_index: 0,
                    // SAFETY: buf is plain [u8; N], any bit pattern valid
                    buf: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
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
                    // SAFETY: buf/name_data are plain integer arrays, any bit pattern valid
                    buf: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
                    name_data: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
                    name_filter: None,
                },
            };
        }
        #[cfg(target_os = "wasi")]
        {
            return Self {
                iter: NewIterator {
                    dir,
                    cookie: 0, // wasi DIRCOOKIE_START
                    index: 0,
                    end_index: 0,
                    // SAFETY: buf is plain [u8; N]
                    buf: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
                },
            };
        }
    }

    pub fn set_name_filter(&mut self, filter: Option<&[u16]>) {
        #[cfg(not(windows))]
        {
            let _ = filter;
        }
        #[cfg(windows)]
        {
            self.iter.name_filter = filter.map(|f| (f.as_ptr(), f.len()));
        }
    }
}

pub type WrappedIterator = NewWrappedIterator<false>;
pub type WrappedIteratorW = NewWrappedIterator<true>;

pub fn iterate<const IS_U16: bool>(self_: Fd) -> NewWrappedIterator<IS_U16> {
    NewWrappedIterator::<IS_U16>::init(self_)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/dir_iterator.zig (564 lines)
//   confidence: medium
//   todos:      9
//   notes:      const-enum `PathType` generic flattened to `bool` (stable
//               const-generics); inherent associated `Error` types dropped;
//               linux getdents64 goes through libc::syscall raw path. Windows
//               body is gated on bun_sys::windows FFI surface.
// ──────────────────────────────────────────────────────────────────────────
