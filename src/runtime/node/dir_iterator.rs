// This is copied from std.fs.Dir.Iterator
// The differences are:
// - it returns errors in the expected format
// - doesn't mark BADF as unreachable
// - It uses PathString instead of []const u8
// - Windows can be configured to return []const u16

use core::mem::{offset_of, size_of};

use bun_str::{strings, PathString, WStr};
use bun_sys::{self as sys, Fd, Syscall, SystemErrno};

use crate::node::Dirent as Entry;
use crate::node::dirent::Kind as EntryKind;
// TODO(port): `Entry.Kind` in Zig is `jsc.Node.Dirent.Kind`; verify exact Rust path in Phase B.

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum IteratorError {
    AccessDenied,
    SystemResources,
    /// posix.UnexpectedError
    Unexpected,
}
impl From<IteratorError> for bun_core::Error {
    fn from(e: IteratorError) -> Self {
        bun_core::err_from_static(<&'static str>::from(e))
        // TODO(port): use generated `From` derive once `bun_core::Error` registry macro lands
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
        pub type Error = IteratorError;

        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub fn next(&mut self) -> Result {
            self.next_darwin()
        }

        fn next_darwin(&mut self) -> Result {
            'start_over: loop {
                if self.index >= self.end_index {
                    if self.received_eof {
                        return sys::Result::Ok(None);
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
                        posix_system::__getdirentries64(
                            self.dir.cast(),
                            self.buf.as_mut_ptr(),
                            self.buf.len(),
                            &mut self.seek,
                        )
                    };

                    if rc < 1 {
                        if rc == 0 {
                            self.received_eof = true;
                            return sys::Result::Ok(None);
                        }

                        if let Some(err) = Result::errno_sys(rc, Syscall::Getdirentries64) {
                            return err;
                        }
                    }

                    self.index = 0;
                    self.end_index = usize::try_from(rc).unwrap();
                    let eof_flag = u32::from_ne_bytes(
                        self.buf[len - 4..len].try_into().unwrap(),
                    );
                    self.received_eof =
                        self.end_index <= (self.buf.len() - 4) && eof_flag == 1;
                }
                // SAFETY: self.index < self.end_index <= buf.len(); buf holds packed dirent records
                let darwin_entry = unsafe {
                    &*(self.buf.as_ptr().add(self.index) as *const posix_system::dirent)
                };
                let next_index = self.index + darwin_entry.reclen as usize;
                self.index = next_index;

                // SAFETY: dirent.name is a [*]u8 of length namlen within the record
                let name = unsafe {
                    core::slice::from_raw_parts(
                        darwin_entry.name.as_ptr() as *const u8,
                        darwin_entry.namlen as usize,
                    )
                };

                if name == b"." || name == b".." || darwin_entry.ino == 0 {
                    continue 'start_over;
                }

                let entry_kind = match darwin_entry.r#type {
                    posix_system::DT::BLK => EntryKind::BlockDevice,
                    posix_system::DT::CHR => EntryKind::CharacterDevice,
                    posix_system::DT::DIR => EntryKind::Directory,
                    posix_system::DT::FIFO => EntryKind::NamedPipe,
                    posix_system::DT::LNK => EntryKind::SymLink,
                    posix_system::DT::REG => EntryKind::File,
                    posix_system::DT::SOCK => EntryKind::UnixDomainSocket,
                    posix_system::DT::WHT => EntryKind::Whiteout,
                    _ => EntryKind::Unknown,
                };
                return sys::Result::Ok(Some(IteratorResult {
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
    use bun_sys::freebsd as posix_system;

    pub struct NewIterator<const USE_WINDOWS_OSPATH: bool> {
        pub dir: Fd,
        // TODO(port): align(@alignOf(posix.system.dirent))
        pub buf: [u8; 8192],
        pub index: usize,
        pub end_index: usize,
    }

    impl<const USE_WINDOWS_OSPATH: bool> NewIterator<USE_WINDOWS_OSPATH> {
        pub type Error = IteratorError;

        pub fn next(&mut self) -> Result {
            'start_over: loop {
                if self.index >= self.end_index {
                    // SAFETY: FFI getdents
                    let rc = unsafe {
                        posix_system::getdents(
                            self.dir.cast(),
                            self.buf.as_mut_ptr(),
                            self.buf.len(),
                        )
                    };
                    if let Some(err) = Result::errno_sys(rc, Syscall::Getdents64) {
                        // FreeBSD reports ENOENT when iterating an unlinked
                        // but still-open directory.
                        if err.get_errno() == SystemErrno::NOENT {
                            return sys::Result::Ok(None);
                        }
                        return err;
                    }
                    if rc == 0 {
                        return sys::Result::Ok(None);
                    }
                    self.index = 0;
                    self.end_index = usize::try_from(rc).unwrap();
                }
                // SAFETY: index within filled buf; packed dirent
                let entry = unsafe {
                    &*(self.buf.as_ptr().add(self.index) as *const posix_system::dirent)
                };
                // TODO(port): Zig used `if (@hasDecl(dirent, "reclen")) entry.reclen() else entry.reclen`;
                // assume field access in Rust binding.
                self.index += entry.reclen as usize;

                // SAFETY: name is namlen bytes within the record
                let name = unsafe {
                    core::slice::from_raw_parts(
                        entry.name.as_ptr() as *const u8,
                        entry.namlen as usize,
                    )
                };
                if name == b"." || name == b".." || entry.fileno == 0 {
                    continue 'start_over;
                }

                let entry_kind: EntryKind = match entry.r#type {
                    posix_system::DT::BLK => EntryKind::BlockDevice,
                    posix_system::DT::CHR => EntryKind::CharacterDevice,
                    posix_system::DT::DIR => EntryKind::Directory,
                    posix_system::DT::FIFO => EntryKind::NamedPipe,
                    posix_system::DT::LNK => EntryKind::SymLink,
                    posix_system::DT::REG => EntryKind::File,
                    posix_system::DT::SOCK => EntryKind::UnixDomainSocket,
                    posix_system::DT::WHT => EntryKind::Whiteout,
                    _ => EntryKind::Unknown,
                };
                return sys::Result::Ok(Some(IteratorResult {
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
    use bun_sys::linux;

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
        pub type Error = IteratorError;

        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub fn next(&mut self) -> Result {
            'start_over: loop {
                if self.index >= self.end_index {
                    // SAFETY: FFI getdents64; buf is 8192 bytes
                    let rc = unsafe {
                        linux::getdents64(
                            self.dir.cast(),
                            self.buf.as_mut_ptr(),
                            self.buf.len(),
                        )
                    };
                    if let Some(err) = Result::errno_sys(rc, Syscall::Getdents64) {
                        return err;
                    }
                    if rc == 0 {
                        return sys::Result::Ok(None);
                    }
                    self.index = 0;
                    self.end_index = rc as usize;
                }
                // SAFETY: index within filled buf; packed dirent64
                let linux_entry = unsafe {
                    &*(self.buf.as_ptr().add(self.index) as *const linux::dirent64)
                };
                let next_index = self.index + linux_entry.reclen as usize;
                self.index = next_index;

                // SAFETY: dirent64.name is NUL-terminated within the record
                let name = unsafe {
                    let p = linux_entry.name.as_ptr() as *const u8;
                    let mut len = 0usize;
                    while *p.add(len) != 0 {
                        len += 1;
                    }
                    core::slice::from_raw_parts(p, len)
                };
                // TODO(port): replace manual strlen with `bun_str::slice_to_nul` once available

                // skip . and .. entries
                if name == b"." || name == b".." {
                    continue 'start_over;
                }

                let entry_kind: EntryKind = match linux_entry.r#type {
                    linux::DT::BLK => EntryKind::BlockDevice,
                    linux::DT::CHR => EntryKind::CharacterDevice,
                    linux::DT::DIR => EntryKind::Directory,
                    linux::DT::FIFO => EntryKind::NamedPipe,
                    linux::DT::LNK => EntryKind::SymLink,
                    linux::DT::REG => EntryKind::File,
                    linux::DT::SOCK => EntryKind::UnixDomainSocket,
                    // DT_UNKNOWN: Some filesystems (e.g., bind mounts, FUSE, NFS)
                    // don't provide d_type. Callers should use lstatat() to determine
                    // the type when needed (lazy stat pattern for performance).
                    _ => EntryKind::Unknown,
                };
                return sys::Result::Ok(Some(IteratorResult {
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
    // TODO(port): Rust const generics cannot pick field types directly; this trait
    // bridges the gap. Phase B may collapse to two concrete structs if preferred.
    pub trait WindowsOsPath {
        type NameData: Sized;
        type ResultT;
        const IS_U16: bool;
    }
    pub struct OsPathFalse;
    pub struct OsPathTrue;
    impl WindowsOsPath for OsPathFalse {
        type NameData = [u8; 513];
        type ResultT = Result;
        const IS_U16: bool = false;
    }
    impl WindowsOsPath for OsPathTrue {
        type NameData = [u16; 257];
        type ResultT = ResultW;
        const IS_U16: bool = true;
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
        pub type Error = IteratorError;

        type ResultT = <Select<USE_WINDOWS_OSPATH> as WindowsOsPath>::ResultT;

        /// Memory such as file names referenced in this returned entry becomes invalid
        /// with subsequent calls to `next`, as well as when this `Dir` is deinitialized.
        pub fn next(&mut self) -> Self::ResultT {
            loop {
                if self.index >= self.end_index {
                    // The I/O manager only fills the IO_STATUS_BLOCK on IRP
                    // completion. When NtQueryDirectoryFile fails with an
                    // NT_ERROR status (e.g. parameter validation), the block
                    // is left untouched, so zero-initialize it rather than
                    // reading uninitialized stack if the call fails.
                    // SAFETY: all-zero is a valid IO_STATUS_BLOCK
                    let mut io: IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
                    if self.first {
                        // > Any bytes inserted for alignment SHOULD be set to zero, and the receiver MUST ignore them
                        self.buf.fill(0);
                    }

                    let mut filter_us: UNICODE_STRING;
                    let filter_ptr: *mut UNICODE_STRING = if let Some((ptr, len)) = self.name_filter {
                        filter_us = UNICODE_STRING {
                            Length: u16::try_from(len * 2).unwrap(),
                            MaximumLength: u16::try_from(len * 2).unwrap(),
                            Buffer: ptr as *mut u16,
                        };
                        &mut filter_us
                    } else {
                        core::ptr::null_mut()
                    };

                    // SAFETY: FFI call to NtQueryDirectoryFile with valid handle and buffers
                    let rc = unsafe {
                        ntdll::NtQueryDirectoryFile(
                            self.dir.cast(),
                            core::ptr::null_mut(),
                            None,
                            core::ptr::null_mut(),
                            &mut io,
                            self.buf.as_mut_ptr().cast(),
                            self.buf.len() as u32,
                            w::FILE_INFORMATION_CLASS::FileDirectoryInformation,
                            FALSE,
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
                            "NtQueryDirectoryFile({}) = {}",
                            self.dir,
                            <&'static str>::from(rc)
                        );
                        return Self::ResultT::err(sys::Error {
                            errno: SystemErrno::ENOTDIR as u16,
                            syscall: Syscall::NtQueryDirectoryFile,
                            ..Default::default()
                        });
                    }

                    // NO_SUCH_FILE is returned on the first call when a FileName filter
                    // matches nothing; NO_MORE_FILES on subsequent calls. Both mean "done".
                    if rc == w::NTSTATUS::NO_MORE_FILES || rc == w::NTSTATUS::NO_SUCH_FILE {
                        sys::syslog!(
                            "NtQueryDirectoryFile({}) = {}",
                            self.dir,
                            <&'static str>::from(rc)
                        );
                        return Self::ResultT::ok(None);
                    }

                    if rc != w::NTSTATUS::SUCCESS {
                        sys::syslog!(
                            "NtQueryDirectoryFile({}) = {}",
                            self.dir,
                            <&'static str>::from(rc)
                        );

                        if let Some(errno) = w::Win32Error::from_nt_status(rc).to_system_errno() {
                            return Self::ResultT::err(sys::Error {
                                errno: errno as u16,
                                syscall: Syscall::NtQueryDirectoryFile,
                                ..Default::default()
                            });
                        }

                        return Self::ResultT::err(sys::Error {
                            errno: SystemErrno::EUNKNOWN as u16,
                            syscall: Syscall::NtQueryDirectoryFile,
                            ..Default::default()
                        });
                    }

                    if io.Information == 0 {
                        sys::syslog!("NtQueryDirectoryFile({}) = 0", self.dir);
                        return Self::ResultT::ok(None);
                    }
                    self.index = 0;
                    self.end_index = io.Information as usize;

                    sys::syslog!("NtQueryDirectoryFile({}) = {}", self.dir, self.end_index);
                }

                let entry_offset = self.index;
                // SAFETY: entry_offset < end_index <= buf.len(); align(2) per FILE_DIRECTORY_INFORMATION_PTR comment
                let dir_info: &FILE_DIRECTORY_INFORMATION = unsafe {
                    &*(self.buf.as_ptr().add(entry_offset) as *const FILE_DIRECTORY_INFORMATION)
                };
                if dir_info.NextEntryOffset != 0 {
                    self.index = entry_offset + dir_info.NextEntryOffset as usize;
                } else {
                    self.index = self.buf.len();
                }

                // Some filesystem / filter drivers have been observed returning
                // FILE_DIRECTORY_INFORMATION entries with an out-of-range
                // FileNameLength (well beyond the 255-WCHAR NTFS component
                // limit). Clamp to what fits in name_data (destination) and to
                // what remains in buf (source) so a misbehaving driver cannot
                // walk us past the end of either buffer.
                let max_name_u16: usize = if USE_WINDOWS_OSPATH {
                    257 - 1 // self.name_data.len() - 1
                } else {
                    (513 - 1) / 2 // (self.name_data.len() - 1) / 2
                };
                let name_byte_offset =
                    entry_offset + offset_of!(FILE_DIRECTORY_INFORMATION, FileName);
                let buf_remaining_u16: usize =
                    (self.buf.len().saturating_sub(name_byte_offset)) / size_of::<u16>();
                let name_len_u16: usize = (dir_info.FileNameLength as usize / 2)
                    .min(max_name_u16)
                    .min(buf_remaining_u16);
                // SAFETY: FileName is a u16 array of name_len_u16 elements within buf bounds (clamped above)
                let dir_info_name: &[u16] = unsafe {
                    core::slice::from_raw_parts(
                        (&dir_info.FileName as *const _ as *const u16),
                        name_len_u16,
                    )
                };

                if dir_info_name == &[b'.' as u16][..]
                    || dir_info_name == &[b'.' as u16, b'.' as u16][..]
                {
                    continue;
                }

                let kind = 'blk: {
                    let attrs = dir_info.FileAttributes;
                    let isdir = attrs & FILE_ATTRIBUTE_DIRECTORY != 0;
                    let islink = attrs & FILE_ATTRIBUTE_REPARSE_POINT != 0;
                    // on windows symlinks can be directories, too. We prioritize the
                    // "sym_link" kind over the "directory" kind
                    // this will coerce into either .file or .directory later
                    // once the symlink is read
                    if islink {
                        break 'blk EntryKind::SymLink;
                    }
                    if isdir {
                        break 'blk EntryKind::Directory;
                    }
                    EntryKind::File
                };

                if USE_WINDOWS_OSPATH {
                    // SAFETY: name_data is [u16; 257] when USE_WINDOWS_OSPATH; name_len_u16 <= 256
                    let name_data: &mut [u16; 257] = unsafe {
                        &mut *(&mut self.name_data as *mut _ as *mut [u16; 257])
                    };
                    name_data[..name_len_u16].copy_from_slice(dir_info_name);
                    name_data[name_len_u16] = 0;
                    let name_utf16le = IteratorResultWName {
                        data_ptr: name_data.as_ptr(),
                        data_len: name_len_u16,
                    };

                    // TODO(port): Self::ResultT unification — when USE_WINDOWS_OSPATH this is ResultW
                    return Self::ResultT::ok(Some(IteratorResultW {
                        kind,
                        name: name_utf16le,
                    }));
                }

                // SAFETY: name_data is [u8; 513] when !USE_WINDOWS_OSPATH
                let name_data: &mut [u8; 513] = unsafe {
                    &mut *(&mut self.name_data as *mut _ as *mut [u8; 513])
                };
                // Trust that Windows gives us valid UTF-16LE
                let name_utf8 = strings::from_w_path(&mut name_data[..], dir_info_name);

                return Self::ResultT::ok(Some(IteratorResult {
                    name: PathString::init(name_utf8),
                    kind,
                }));
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
        pub type Error = IteratorError;

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
                            self.dir.cast(),
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
                            // TODO(port): Zig returned `error.AccessDenied` (anyerror) but fn
                            // returns `Result` (Maybe). Mirroring as sys error EACCES.
                            return sys::Result::Err(sys::Error {
                                errno: SystemErrno::EACCES as u16,
                                syscall: Syscall::FdReaddir,
                                ..Default::default()
                            });
                        }
                        err => {
                            // TODO(port): Zig called `posix.unexpectedErrno(err)` returning anyerror;
                            // map to sys::Result::Err here.
                            return sys::Result::Err(sys::Error::from_wasi(err, Syscall::FdReaddir));
                        }
                    }
                    if bufused == 0 {
                        return sys::Result::Ok(None);
                    }
                    self.index = 0;
                    self.end_index = bufused;
                }
                // SAFETY: index within filled buf
                let entry = unsafe {
                    &*(self.buf.as_ptr().add(self.index) as *const w::dirent_t)
                };
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
                return sys::Result::Ok(Some(IteratorResult {
                    name: PathString::init(name),
                    kind: entry_kind,
                }));
            }
        }
    }
}

pub use platform::NewIterator;

// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum PathType {
    U8,
    U16,
}

// TODO(port): `IteratorType`/`ResultType` selection by const-enum needs an associated-type
// trait in stable Rust. Phase B may prefer two concrete type aliases instead.
pub trait PathTypeSelect {
    type IteratorType;
    type ResultType;
}
pub struct PathTypeU8;
pub struct PathTypeU16;
impl PathTypeSelect for PathTypeU8 {
    type IteratorType = Iterator;
    type ResultType = Result;
}
impl PathTypeSelect for PathTypeU16 {
    type IteratorType = IteratorW;
    type ResultType = ResultW;
}
pub type SelectPath<const P: PathType> = <() as SelectPathImpl<P>>::T;
pub trait SelectPathImpl<const P: PathType> { type T: PathTypeSelect; }
impl SelectPathImpl<{ PathType::U8 }> for () { type T = PathTypeU8; }
impl SelectPathImpl<{ PathType::U16 }> for () { type T = PathTypeU16; }

pub struct NewWrappedIterator<const PATH_TYPE: PathType>
where
    (): SelectPathImpl<PATH_TYPE>,
{
    pub iter: <SelectPath<PATH_TYPE> as PathTypeSelect>::IteratorType,
}

impl<const PATH_TYPE: PathType> NewWrappedIterator<PATH_TYPE>
where
    (): SelectPathImpl<PATH_TYPE>,
{
    pub type Error = IteratorError;

    #[inline]
    pub fn next(&mut self) -> <SelectPath<PATH_TYPE> as PathTypeSelect>::ResultType {
        self.iter.next()
    }

    pub fn init(dir: Fd) -> Self {
        #[cfg(target_os = "macos")]
        {
            Self {
                iter: NewIterator {
                    dir,
                    seek: 0,
                    index: 0,
                    end_index: 0,
                    // SAFETY: buf is plain [u8; N], any bit pattern valid; matches Zig `= undefined`
                    buf: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
                    received_eof: false,
                },
            }
        }
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        {
            Self {
                iter: NewIterator {
                    dir,
                    index: 0,
                    end_index: 0,
                    // SAFETY: buf is plain [u8; N], any bit pattern valid
                    buf: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
                },
            }
        }
        #[cfg(windows)]
        {
            Self {
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
            }
        }
        #[cfg(target_os = "wasi")]
        {
            Self {
                iter: NewIterator {
                    dir,
                    cookie: bun_sys::wasi::DIRCOOKIE_START,
                    index: 0,
                    end_index: 0,
                    // SAFETY: buf is plain [u8; N]
                    buf: unsafe { core::mem::MaybeUninit::uninit().assume_init() },
                },
            }
        }
    }

    pub fn set_name_filter(&mut self, filter: Option<&[u16]>) {
        #[cfg(not(windows))]
        {
            let _ = filter;
            return;
        }
        #[cfg(windows)]
        {
            self.iter.name_filter = filter.map(|f| (f.as_ptr(), f.len()));
        }
    }
}

pub type WrappedIterator = NewWrappedIterator<{ PathType::U8 }>;
pub type WrappedIteratorW = NewWrappedIterator<{ PathType::U16 }>;

pub fn iterate<const PATH_TYPE: PathType>(self_: Fd) -> NewWrappedIterator<PATH_TYPE>
where
    (): SelectPathImpl<PATH_TYPE>,
{
    NewWrappedIterator::<PATH_TYPE>::init(self_)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/dir_iterator.zig (564 lines)
//   confidence: medium
//   todos:      14
//   notes:      const-bool/enum → field-type selection done via helper traits (Rust const generics can't pick types); Phase B may flatten to two concrete structs. Buffer alignment attrs and bun_sys platform FFI symbol paths need verification.
// ──────────────────────────────────────────────────────────────────────────
