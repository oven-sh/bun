//! File system calls that report the same errors as Node.js. Paths are Win32 paths.

use core::ffi::c_void;
use core::mem::MaybeUninit;
use core::ptr;
use core::sync::atomic::{AtomicU32, Ordering};
use std::os::windows::io::{AsRawHandle as _, IntoRawHandle as _, OwnedHandle};

use bun_core::{PathBuffer, S, WStr, ZBox, ZStr};
use bun_paths::{path_buffer_pool, w_path_buffer_pool};
use bun_windows_sys::externs as w;

use super::nt::{self, NtPath};
use super::{
    FILE_OPEN_FOR_BACKUP_INTENT, FILE_TYPE_CHAR, FILE_TYPE_DISK, FILE_TYPE_PIPE, GetFileType,
    HANDLE, NTSTATUS, NtCreateFile, Win32Error, Win32ErrorExt as _, check, fd_table, sync_io,
};
use crate::windows_format::reparse::{self, JunctionError, LinkTarget};
use crate::windows_format::wtf16::{self, EncodeError};
use crate::windows_format::{file_time, open_flags, path_syntax};
use crate::{
    Error, FILE_SHARE, Fd, FdKind, IoVec, IoVecMut, Maybe, Mode, NtCreateFileOptions, Tag,
    TimeLike, syslog,
};

impl From<EncodeError> for Win32Error {
    fn from(error: EncodeError) -> Self {
        match error {
            EncodeError::Malformed => Self::INVALID_NAME,
            EncodeError::TooLong => Self::FILENAME_EXCED_RANGE,
        }
    }
}

fn map_nt_error<T>(result: Result<T, NTSTATUS>) -> Result<T, Win32Error> {
    result.map_err(Win32Error::from_ntstatus)
}

fn map_path_error<T>(result: Result<T, Win32Error>, tag: Tag, path: &ZStr) -> Maybe<T> {
    syslog!(
        "{}({}) = {:?}",
        <&str>::from(tag),
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().err()
    );
    result.map_err(|error| Error::new(error.to_node_errno(), tag).with_path(path.as_bytes()))
}

fn with_fd_handle<T>(
    fd: Fd,
    tag: Tag,
    call: impl FnOnce(HANDLE) -> Result<T, Win32Error>,
) -> Maybe<T> {
    map_fd_error(fd_table::with_handle(fd, call), tag, fd)
}

fn map_fd_error<T>(result: Result<T, Win32Error>, tag: Tag, fd: Fd) -> Maybe<T> {
    syslog!(
        "{}({}) = {:?}",
        <&str>::from(tag),
        fd,
        result.as_ref().err()
    );
    // Not `with_fd`: a missing standard handle is `Fd::INVALID`.
    result.map_err(|error| Error {
        fd,
        ..Error::new(error.to_node_errno(), tag)
    })
}

fn with_wide_path<T>(
    path: &ZStr,
    call: impl FnOnce(&WStr) -> Result<T, Win32Error>,
) -> Result<T, Win32Error> {
    let mut buf = w_path_buffer_pool::get();
    call(wtf16::encode(path.as_bytes(), &mut buf[..])?)
}

fn resolve_nt_path(path: &ZStr) -> Result<NtPath, Win32Error> {
    let mut buf = w_path_buffer_pool::get();
    let len = wtf16::encode(path.as_bytes(), &mut buf[..])?.len();
    NtPath::new(buf, len)
}

/// Resolves `path` against the current directory into `\\?\` form, which is not limited to `MAX_PATH`.
pub fn verbatim_path(path: &[u8]) -> Option<ZBox> {
    let mut buf = path_buffer_pool::get();
    let full_path = if path.starts_with(b"\\\\?\\") || path.starts_with(b"\\??\\") {
        path
    } else {
        let mut wide_buf = w_path_buffer_pool::get();
        let mut full_buf = w_path_buffer_pool::get();
        let wide_path = wtf16::encode(path, &mut wide_buf[..]).ok()?;
        let len = super::GetFullPathNameW(wide_path, &mut full_buf[..]).ok()?;
        if path_syntax::is_console_path(&full_buf[..len])
            && !path_syntax::is_device_path_or_stem(path)
        {
            return None;
        }
        let len = wtf16::decode(full_buf[..len].iter().copied(), &mut buf[..])?;
        &buf[..len]
    };
    let [prefix, rest] = path_syntax::to_verbatim_parts(full_path);
    Some(ZBox::from_vec_with_nul([prefix, rest, &[0]].concat()))
}

fn open_existing(
    (root, name): (Option<HANDLE>, &[u16]),
    access_mask: u32,
    options: u32,
) -> Result<OwnedHandle, NTSTATUS> {
    let options = NtCreateFileOptions {
        access_mask,
        disposition: w::FILE_OPEN,
        options: options | FILE_OPEN_FOR_BACKUP_INTENT,
        attributes: 0,
        sharing_mode: FILE_SHARE,
    };
    NtCreateFile(root, name, options)
}

/// Adds the access rights and options that `CreateFileW` adds.
fn open_synchronous(
    root_and_name: (Option<HANDLE>, &[u16]),
    access: u32,
    options: u32,
) -> Result<OwnedHandle, Win32Error> {
    let access = access | w::SYNCHRONIZE | w::FILE_READ_ATTRIBUTES;
    let options = options | w::FILE_SYNCHRONOUS_IO_NONALERT;
    map_nt_error(open_existing(root_and_name, access, options))
}

#[derive(Clone, Copy, PartialEq)]
enum FollowSymlinks {
    Yes,
    No,
}

impl FollowSymlinks {
    fn create_options(self) -> u32 {
        match self {
            Self::Yes => 0,
            Self::No => w::FILE_OPEN_REPARSE_POINT,
        }
    }
}

// ── open ────────────────────────────────────────────────────────────────────

static UMASK: AtomicU32 = AtomicU32::new(0);

pub fn umask(mode: Mode) -> Mode {
    // Relaxed: the value does not publish other data.
    UMASK.swap(mode & (S::IRUSR | S::IWUSR), Ordering::Relaxed)
}

pub fn current_umask() -> Mode {
    UMASK.load(Ordering::Relaxed)
}

fn create_file(
    nt_path: &NtPath,
    params: &open_flags::CreateParams,
) -> Result<OwnedHandle, Win32Error> {
    if let Some(console) = path_syntax::to_console_path(nt_path.full_name()) {
        let disposition = match params.disposition {
            w::FILE_CREATE => w::CREATE_NEW,
            w::FILE_OPEN_IF => w::OPEN_ALWAYS,
            w::FILE_OVERWRITE_IF => w::CREATE_ALWAYS,
            _ => w::OPEN_EXISTING,
        };
        let flags = w::FILE_FLAG_BACKUP_SEMANTICS | params.attributes;
        return super::CreateFileW(console, params.access, FILE_SHARE, disposition, flags);
    }
    let (root, name) = nt_path.root_and_name();
    let options = NtCreateFileOptions {
        access_mask: params.access,
        disposition: params.disposition,
        options: params.options,
        attributes: params.attributes,
        sharing_mode: FILE_SHARE,
    };
    NtCreateFile(root, name, options).map_err(|status| match status {
        NTSTATUS::OBJECT_NAME_COLLISION if params.disposition != w::FILE_CREATE => WIN32_EISDIR,
        NTSTATUS::FILE_IS_A_DIRECTORY if params.should_truncate => WIN32_EISDIR,
        status => Win32Error::from_ntstatus(status),
    })
}

/// The Win32 error that maps to `EISDIR`.
const WIN32_EISDIR: Win32Error = Win32Error::INVALID_FUNCTION;

/// Transfers ownership of `handle` to a new CRT descriptor. Returns -1 and sets `errno` on failure.
pub fn open_osfhandle(handle: HANDLE) -> i32 {
    unsafe extern "C" {
        /// Fails if the descriptor table is full or the file type of `handle` is unknown.
        safe fn _open_osfhandle(handle: HANDLE, flags: i32) -> i32;
    }
    let crt_fd = _open_osfhandle(handle, 0);
    if crt_fd != -1 {
        fd_table::register(crt_fd);
    }
    crt_fd
}

fn into_crt_fd(file: OwnedHandle) -> Result<Fd, Win32Error> {
    match open_osfhandle(file.as_raw_handle()) {
        -1 if crate::last_errno() == libc::EMFILE => Err(Win32Error::TOO_MANY_OPEN_FILES),
        -1 => Err(Win32Error::get()),
        crt_fd => {
            _ = file.into_raw_handle();
            Ok(Fd::from_crt(crt_fd))
        }
    }
}

/// Returns a CRT descriptor.
pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
    let result = resolve_nt_path(path).and_then(|nt_path| {
        if path_syntax::to_console_path(nt_path.full_name()).is_some()
            && !path_syntax::is_device_path_or_stem(path.as_bytes())
        {
            return Err(Win32Error::FILE_NOT_FOUND);
        }
        let params = open_flags::translate(flags, mode & !current_umask())
            .ok_or(Win32Error::INVALID_PARAMETER)?;
        let file = create_file(&nt_path, &params)?;
        if params.should_truncate && GetFileType(file.as_raw_handle()) == FILE_TYPE_DISK {
            set_size(file.as_raw_handle(), 0)?;
        }
        into_crt_fd(file)
    });
    map_path_error(result, Tag::open, path)
}

// ── read / write ────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum IoPosition {
    Current,
    Offset(i64),
    /// The file position is not restored afterwards.
    OffsetNoRestore(i64),
}

impl IoPosition {
    fn run_request(
        self,
        fd: Fd,
        request: impl FnOnce(HANDLE, Option<i64>) -> Result<usize, Win32Error>,
    ) -> Result<usize, Win32Error> {
        let result = match self {
            Self::Current => fd_table::with_position_locked(fd, |handle| request(handle, None)),
            // NT gives negative offsets special meanings.
            Self::Offset(..0) | Self::OffsetNoRestore(..0) => Err(Win32Error::INVALID_PARAMETER),
            Self::Offset(offset) => {
                fd_table::with_position_preserved(fd, |handle| request(handle, Some(offset)))
            }
            Self::OffsetNoRestore(offset) => {
                fd_table::with_handle(fd, |handle| request(handle, Some(offset)))
            }
        };
        result.map_err(|error| match error {
            // The handle was not opened for this direction.
            Win32Error::ACCESS_DENIED => Win32Error::INVALID_HANDLE,
            error => error,
        })
    }
}

fn read_impl(fd: Fd, vecs: &[IoVecMut<'_>], position: IoPosition) -> Maybe<usize> {
    let result = loop {
        match position.run_request(fd, |handle, offset| sync_io::readv(handle, vecs, offset)) {
            Err(Win32Error::HANDLE_EOF | Win32Error::BROKEN_PIPE) => break Ok(0),
            Err(Win32Error::OPERATION_ABORTED)
                if fd.kind() == FdKind::System
                    && !sync_io::is_interruptible()
                    && matches!(guess_handle(fd), HandleKind::Pipe | HandleKind::Tty) => {}
            result => break result,
        }
    };
    map_fd_error(result, Tag::read, fd)
}

fn write_impl(fd: Fd, vecs: &[IoVec<'_>], position: IoPosition) -> Maybe<usize> {
    let result =
        match position.run_request(fd, |handle, offset| sync_io::writev(handle, vecs, offset)) {
            Err(Win32Error::BROKEN_PIPE | Win32Error::NO_DATA) => Err(Win32Error::BAD_PIPE),
            result => result,
        };
    map_fd_error(result, Tag::write, fd)
}

pub(crate) fn read_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>]) -> Maybe<usize> {
    read_impl(fd, &[IoVecMut::new(buf)], IoPosition::Current)
}

pub(crate) fn pread_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>], offset: i64) -> Maybe<usize> {
    read_impl(fd, &[IoVecMut::new(buf)], IoPosition::Offset(offset))
}

pub fn readv(fd: Fd, vecs: &[IoVecMut<'_>]) -> Maybe<usize> {
    read_impl(fd, vecs, IoPosition::Current)
}

pub fn preadv(fd: Fd, vecs: &[IoVecMut<'_>], offset: i64) -> Maybe<usize> {
    read_impl(fd, vecs, IoPosition::Offset(offset))
}

pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
    write_impl(fd, &[IoVec::new(buf)], IoPosition::Current)
}

pub fn pwrite(fd: Fd, buf: &[u8], offset: i64) -> Maybe<usize> {
    write_impl(fd, &[IoVec::new(buf)], IoPosition::Offset(offset))
}

pub fn writev(fd: Fd, vecs: &[IoVec<'_>]) -> Maybe<usize> {
    write_impl(fd, vecs, IoPosition::Current)
}

pub fn pwritev(fd: Fd, vecs: &[IoVec<'_>], offset: i64) -> Maybe<usize> {
    write_impl(fd, vecs, IoPosition::Offset(offset))
}

fn select_position(fd: Fd, offset: i64) -> IoPosition {
    if fd_table::is_position_shared(fd) {
        IoPosition::Offset(offset)
    } else {
        IoPosition::OffsetNoRestore(offset)
    }
}

/// `pread` that leaves the file position moved, unless JavaScript can observe it.
pub(crate) fn pread_no_restore(fd: Fd, buf: &mut [MaybeUninit<u8>], offset: i64) -> Maybe<usize> {
    read_impl(fd, &[IoVecMut::new(buf)], select_position(fd, offset))
}

/// See [`pread_no_restore`].
pub(crate) fn pwrite_no_restore(fd: Fd, buf: &[u8], offset: i64) -> Maybe<usize> {
    write_impl(fd, &[IoVec::new(buf)], select_position(fd, offset))
}

fn set_size(file: HANDLE, size: i64) -> Result<(), Win32Error> {
    let info = w::FILE_END_OF_FILE_INFORMATION { EndOfFile: size };
    map_nt_error(nt::set_file_info(file, info))
}

pub fn ftruncate(fd: Fd, size: i64) -> Maybe<()> {
    with_fd_handle(fd, Tag::ftruncate, |file| set_size(file, size))
}

pub fn fsync(fd: Fd) -> Maybe<()> {
    with_fd_handle(fd, Tag::fsync, super::FlushFileBuffers)
}

pub fn fdatasync(fd: Fd) -> Maybe<()> {
    with_fd_handle(fd, Tag::fdatasync, super::FlushFileBuffers)
}

// ── stat ────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct Stat {
    pub st_dev: u64,
    pub st_mode: u64,
    pub st_nlink: u64,
    pub st_uid: u64,
    pub st_gid: u64,
    pub st_rdev: u64,
    pub st_ino: u64,
    pub st_size: u64,
    pub st_blksize: u64,
    pub st_blocks: u64,
    pub st_atime: i64,
    pub st_atime_nsec: i64,
    pub st_mtime: i64,
    pub st_mtime_nsec: i64,
    pub st_ctime: i64,
    pub st_ctime_nsec: i64,
    pub st_birthtime: i64,
    pub st_birthtime_nsec: i64,
}
bun_core::impl_zeroable!(Stat);

impl Stat {
    pub fn is_same_file(&self, other: &Self) -> bool {
        (self.st_dev, self.st_ino) == (other.st_dev, other.st_ino)
            && !matches!(self.st_ino, 0 | u64::MAX)
    }

    fn new_device(mode: Mode, device_type: u32) -> Self {
        Self {
            st_mode: mode.into(),
            st_nlink: 1,
            st_rdev: u64::from(device_type) << 16,
            ..Self::default()
        }
    }

    fn new(info: &w::FILE_STAT_BASIC_INFORMATION, link_size: Option<usize>) -> Self {
        if info.DeviceType == w::FILE_DEVICE_NULL {
            return Self {
                st_blksize: 4096,
                ..Self::new_device(S::IFCHR | 0o666, w::FILE_DEVICE_NULL)
            };
        }
        let (kind, size) = match link_size {
            Some(size) => (S::IFLNK, size as u64),
            None if info.FileAttributes & w::FILE_ATTRIBUTE_DIRECTORY != 0 => (S::IFDIR, 0),
            None => (S::IFREG, info.EndOfFile as u64),
        };
        let permissions = if info.FileAttributes & w::FILE_ATTRIBUTE_READONLY == 0 {
            0o666
        } else {
            0o444
        };
        let [atime, mtime, ctime, birthtime] = [
            info.LastAccessTime,
            info.LastWriteTime,
            info.ChangeTime,
            info.CreationTime,
        ]
        .map(file_time::to_timespec);
        Self {
            st_dev: (info.VolumeSerialNumber as u32).into(),
            st_mode: (kind | permissions).into(),
            st_nlink: info.NumberOfLinks.into(),
            st_ino: info.FileId as u64,
            st_size: size,
            st_blksize: 4096,
            st_blocks: info.AllocationSize as u64 >> 9,
            st_atime: atime.sec,
            st_atime_nsec: atime.nsec,
            st_mtime: mtime.sec,
            st_mtime_nsec: mtime.nsec,
            st_ctime: ctime.sec,
            st_ctime_nsec: ctime.nsec,
            st_birthtime: birthtime.sec,
            st_birthtime_nsec: birthtime.nsec,
            ..Self::default()
        }
    }
}

fn query_volume_serial_number(file: HANDLE) -> Result<i64, Win32Error> {
    match nt::query_volume_info::<w::FILE_FS_VOLUME_INFORMATION>(file) {
        Err(NTSTATUS::NOT_IMPLEMENTED) => Ok(0),
        result => map_nt_error(result).map(|volume| volume.VolumeSerialNumber.into()),
    }
}

fn query_stat_basic(file: HANDLE) -> Result<w::FILE_STAT_BASIC_INFORMATION, Win32Error> {
    if nt::has_stat_basic()
        && let Ok(info) = nt::query_file_info::<w::FILE_STAT_BASIC_INFORMATION>(file)
        // The filter driver that owns any other reparse tag may not support this class.
        && (info.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT == 0
            || reparse::is_link_tag(info.ReparseTag))
    {
        return Ok(info);
    }
    let device: w::FILE_FS_DEVICE_INFORMATION = map_nt_error(nt::query_volume_info(file))?;
    if device.DeviceType == w::FILE_DEVICE_NULL {
        return Ok(w::FILE_STAT_BASIC_INFORMATION {
            DeviceType: device.DeviceType,
            ..bun_core::ffi::zeroed()
        });
    }
    let all: w::FILE_ALL_INFORMATION = map_nt_error(nt::query_file_info(file))?;
    Ok(w::FILE_STAT_BASIC_INFORMATION {
        FileId: all.InternalInformation.IndexNumber,
        CreationTime: all.BasicInformation.CreationTime,
        LastAccessTime: all.BasicInformation.LastAccessTime,
        LastWriteTime: all.BasicInformation.LastWriteTime,
        ChangeTime: all.BasicInformation.ChangeTime,
        AllocationSize: all.StandardInformation.AllocationSize,
        EndOfFile: all.StandardInformation.EndOfFile,
        FileAttributes: all.BasicInformation.FileAttributes,
        NumberOfLinks: all.StandardInformation.NumberOfLinks,
        VolumeSerialNumber: query_volume_serial_number(file)?,
        ..bun_core::ffi::zeroed()
    })
}

fn with_link_target<T>(
    file: HANDLE,
    read: impl FnOnce(LinkTarget<'_>) -> Result<T, Win32Error>,
) -> Result<T, Win32Error> {
    let mut buf = path_buffer_pool::get();
    let data = map_nt_error(nt::get_reparse_point(
        file,
        &mut buf[..reparse::MAXIMUM_REPARSE_DATA_BUFFER_SIZE],
    ))?;
    match reparse::parse_link_target(data) {
        Some(target) => read(target),
        None if reparse::is_missing_substitute_name(data) => Err(Win32Error::INVALID_DATA),
        None => Err(Win32Error::SYMLINK_NOT_SUPPORTED),
    }
}

fn stat_handle(file: HANDLE, follow: FollowSymlinks) -> Result<Stat, Win32Error> {
    let info = query_stat_basic(file)?;
    let is_reparse_point = info.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT != 0;
    let link_size = if is_reparse_point && follow == FollowSymlinks::No {
        match with_link_target(file, |target| Ok(target.len())) {
            Err(Win32Error::INVALID_DATA) => Some(0),
            len => Some(len?),
        }
    } else {
        None
    };
    Ok(Stat::new(&info, link_size))
}

/// Fallback for a file that cannot be opened.
fn stat_directory_entry(
    nt_path: &NtPath,
    follow: FollowSymlinks,
    open_error: Win32Error,
) -> Result<Stat, Win32Error> {
    let (parent, file_name) =
        path_syntax::split_file_name(nt_path.full_name()).ok_or(open_error)?;
    let directory = open_synchronous((None, parent), w::FILE_LIST_DIRECTORY, 0)?;
    let directory = directory.as_raw_handle();
    let entry: w::FILE_ID_FULL_DIR_INFORMATION =
        map_nt_error(nt::query_directory_entry(directory, file_name))?;
    let is_reparse_point = entry.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT != 0;
    if is_reparse_point && follow == FollowSymlinks::Yes {
        return Err(open_error);
    }
    let info = w::FILE_STAT_BASIC_INFORMATION {
        FileId: entry.FileId,
        CreationTime: entry.CreationTime,
        LastAccessTime: entry.LastAccessTime,
        LastWriteTime: entry.LastWriteTime,
        ChangeTime: entry.ChangeTime,
        AllocationSize: entry.AllocationSize,
        EndOfFile: entry.EndOfFile,
        FileAttributes: entry.FileAttributes,
        NumberOfLinks: 1,
        VolumeSerialNumber: query_volume_serial_number(directory)?,
        ..bun_core::ffi::zeroed()
    };
    let is_link = is_reparse_point && reparse::is_link_tag(entry.EaSize);
    Ok(Stat::new(&info, is_link.then_some(0)))
}

fn open_and_stat(nt_path: &NtPath, follow: FollowSymlinks) -> Result<Stat, Win32Error> {
    match open_synchronous(nt_path.root_and_name(), 0, follow.create_options()) {
        Ok(file) => match stat_handle(file.as_raw_handle(), follow) {
            Err(Win32Error::SYMLINK_NOT_SUPPORTED | Win32Error::NOT_A_REPARSE_POINT)
                if follow == FollowSymlinks::No =>
            {
                open_and_stat(nt_path, FollowSymlinks::Yes)
            }
            result => result,
        },
        Err(error @ (Win32Error::ACCESS_DENIED | Win32Error::SHARING_VIOLATION)) => {
            stat_directory_entry(nt_path, follow, error)
        }
        Err(error) => Err(error),
    }
}

fn stat_path(path: &ZStr, follow: FollowSymlinks) -> Result<Stat, Win32Error> {
    let mut buf = w_path_buffer_pool::get();
    let len = path_syntax::len_without_trailing_sep(wtf16::encode(path.as_bytes(), &mut buf[..])?);
    let nt_path = NtPath::new(buf, len)?;
    match map_nt_error(nt::query_stat_basic_by_name(&nt_path)) {
        Ok(info) if info.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT == 0 => {
            Ok(Stat::new(&info, None))
        }
        Err(
            error @ (Win32Error::FILE_NOT_FOUND
            | Win32Error::PATH_NOT_FOUND
            | Win32Error::NOT_READY
            | Win32Error::BAD_NET_NAME),
        ) => Err(error),
        _ => open_and_stat(&nt_path, follow),
    }
}

pub fn stat(path: &ZStr) -> Maybe<Stat> {
    map_path_error(stat_path(path, FollowSymlinks::Yes), Tag::stat, path)
}

pub fn lstat(path: &ZStr) -> Maybe<Stat> {
    map_path_error(stat_path(path, FollowSymlinks::No), Tag::lstat, path)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HandleKind {
    File,
    Pipe,
    Tty,
    Unknown,
}

fn query_handle_kind(handle: HANDLE) -> HandleKind {
    match GetFileType(handle) {
        FILE_TYPE_CHAR if super::console::mode(handle).is_ok() => HandleKind::Tty,
        FILE_TYPE_CHAR | FILE_TYPE_DISK => HandleKind::File,
        FILE_TYPE_PIPE => HandleKind::Pipe,
        _ => HandleKind::Unknown,
    }
}

/// Does not block behind requests in progress on `fd`. Reports a socket as `Pipe`.
pub fn guess_handle(fd: Fd) -> HandleKind {
    query_handle_kind(fd.native())
}

pub fn fstat(fd: Fd) -> Maybe<Stat> {
    with_fd_handle(fd, Tag::fstat, |handle| {
        let (mode, device_type) = match query_handle_kind(handle) {
            HandleKind::File => return stat_handle(handle, FollowSymlinks::Yes),
            HandleKind::Pipe => (S::IFIFO, w::FILE_DEVICE_NAMED_PIPE),
            HandleKind::Tty => (S::IFCHR, w::FILE_DEVICE_CONSOLE),
            HandleKind::Unknown => return Err(Win32Error::INVALID_HANDLE),
        };
        Ok(Stat {
            st_ino: handle.addr() as u64,
            ..Stat::new_device(mode, device_type)
        })
    })
}

/// `CopyFileW` that leaves `dest` without content and fails with `OPERATION_ABORTED` if `source` is not `expected`.
pub fn copy_expected_file(source: &WStr, dest: &WStr, expected: &Stat) -> Result<(), Win32Error> {
    unsafe extern "system" fn check_source(
        _total_size: i64,
        _total_transferred: i64,
        _stream_size: i64,
        _stream_transferred: i64,
        _stream_number: u32,
        _reason: u32,
        source: HANDLE,
        dest: HANDLE,
        expected: *const c_void,
    ) -> u32 {
        const PROGRESS_STOP: u32 = 2;
        const PROGRESS_QUIET: u32 = 3;
        // SAFETY: the pointer passed to `CopyFileExW` below, which has not returned.
        let expected = unsafe { &*expected.cast::<Stat>() };
        match stat_handle(source, FollowSymlinks::Yes) {
            Ok(stat) if stat.is_same_file(expected) => PROGRESS_QUIET,
            _ => {
                // `dest` already has the attributes of `source`.
                _ = nt::set_file_info(dest, new_basic_info(0));
                PROGRESS_STOP
            }
        }
    }
    // SAFETY: both paths are NUL-terminated, and `expected` outlives the call.
    let result = check(unsafe {
        w::CopyFileExW(
            super::path_ptr(source)?,
            super::path_ptr(dest)?,
            check_source,
            ptr::from_ref(expected).cast(),
            ptr::null_mut(),
            0,
        )
    });
    result.map_err(|err| match err {
        Win32Error::REQUEST_ABORTED => Win32Error::OPERATION_ABORTED,
        err => err,
    })
}

#[derive(Default)]
pub struct StatFS {
    pub f_type: u64,
    pub f_bsize: u64,
    pub f_blocks: u64,
    pub f_bfree: u64,
    pub f_bavail: u64,
    pub f_files: u64,
    pub f_ffree: u64,
}

pub fn statfs(path: &ZStr) -> Maybe<StatFS> {
    let result = resolve_nt_path(path).and_then(|nt_path| {
        let options = w::FILE_DIRECTORY_FILE
            | w::FILE_SYNCHRONOUS_IO_NONALERT
            | w::FILE_OPEN_FOR_FREE_SPACE_QUERY;
        let open_directory = |root_and_name| open_existing(root_and_name, w::SYNCHRONIZE, options);
        let directory = match (
            open_directory(nt_path.root_and_name()),
            path_syntax::parent(nt_path.full_name()),
        ) {
            (Err(NTSTATUS::NOT_A_DIRECTORY), Some(parent)) => open_directory((None, parent)),
            (result, _) => result,
        };
        let info: w::FILE_FS_SIZE_INFORMATION = map_nt_error(
            directory.and_then(|directory| nt::query_volume_info(directory.as_raw_handle())),
        )?;
        Ok(StatFS {
            f_bsize: u64::from(info.BytesPerSector) * u64::from(info.SectorsPerAllocationUnit),
            f_blocks: info.TotalAllocationUnits as u64,
            f_bfree: info.AvailableAllocationUnits as u64,
            f_bavail: info.AvailableAllocationUnits as u64,
            ..StatFS::default()
        })
    });
    map_path_error(result, Tag::statfs, path)
}

// ── directories / links ─────────────────────────────────────────────────────

pub fn mkdir(path: &ZStr, _mode: Mode) -> Maybe<()> {
    let result = with_wide_path(path, |path| {
        super::CreateDirectoryW(path).map_err(|error| match error {
            Win32Error::INVALID_NAME | Win32Error::DIRECTORY => Win32Error::INVALID_PARAMETER,
            error => error,
        })
    });
    map_path_error(result, Tag::mkdir, path)
}

/// `template` ends with six placeholder bytes and a NUL.
pub fn mkdtemp(template: &mut [u8], fill_random: fn(&mut [u8])) -> Maybe<&[u8]> {
    const CHARSET: &[u8; 62] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const MAX_ATTEMPTS: u32 = 1000;
    let len = ZStr::from_slice_with_nul(template).len();
    let mut result = Ok(());
    for _ in 0..MAX_ATTEMPTS {
        let mut bytes = [0; 8];
        fill_random(&mut bytes);
        let mut random = u64::from_ne_bytes(bytes);
        for byte in &mut template[len - 6..len] {
            *byte = CHARSET[(random % 62) as usize];
            random /= 62;
        }
        result = with_wide_path(ZStr::from_slice_with_nul(template), super::CreateDirectoryW);
        if result != Err(Win32Error::ALREADY_EXISTS) {
            break;
        }
    }
    map_path_error(result, Tag::mkdtemp, ZStr::from_slice_with_nul(template))?;
    Ok(&template[..len])
}

fn new_basic_info(attributes: u32) -> w::FILE_BASIC_INFORMATION {
    w::FILE_BASIC_INFORMATION {
        // 0 leaves the attributes unchanged.
        FileAttributes: match attributes {
            0 => w::FILE_ATTRIBUTE_NORMAL,
            attributes => attributes,
        },
        ..bun_core::ffi::zeroed()
    }
}

fn set_delete_pending(file: HANDLE) -> Result<(), NTSTATUS> {
    nt::set_file_info(file, w::FILE_DISPOSITION_INFORMATION { DeleteFile: 1 })
}

fn delete_by_handle(file: &OwnedHandle) -> Result<(), Win32Error> {
    let file = file.as_raw_handle();
    let disposition_ex = w::FILE_DISPOSITION_INFORMATION_EX {
        Flags: super::FILE_DISPOSITION_DELETE
            | super::FILE_DISPOSITION_POSIX_SEMANTICS
            | super::FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };
    match map_nt_error(nt::set_file_info(file, disposition_ex)) {
        // Not every file system supports `FileDispositionInformationEx`.
        Err(
            Win32Error::NOT_SUPPORTED
            | Win32Error::INVALID_PARAMETER
            | Win32Error::INVALID_FUNCTION,
        ) => {}
        result => return result,
    }
    match set_delete_pending(file) {
        Err(NTSTATUS::CANNOT_DELETE) => {}
        result => return map_nt_error(result),
    }
    let access = w::FILE_WRITE_ATTRIBUTES;
    let options = w::FILE_OPEN_REPARSE_POINT;
    let reopened = open_synchronous((Some(file), &[]), access, options)?;
    let reopened = reopened.as_raw_handle();
    let old_attributes =
        map_nt_error(nt::query_file_info::<w::FILE_BASIC_INFORMATION>(reopened))?.FileAttributes;
    let new_info = new_basic_info(old_attributes & !w::FILE_ATTRIBUTE_READONLY);
    map_nt_error(nt::set_file_info(reopened, new_info))?;
    map_nt_error(set_delete_pending(file))
        .inspect_err(|_| _ = nt::set_file_info(reopened, new_basic_info(old_attributes)))
}

fn unlink_directory_link(nt_path: &NtPath) -> Result<(), Win32Error> {
    let options = w::FILE_DIRECTORY_FILE | w::FILE_OPEN_REPARSE_POINT;
    let link = open_synchronous(nt_path.root_and_name(), w::DELETE, options)?;
    let info: w::FILE_BASIC_INFORMATION = map_nt_error(nt::query_file_info(link.as_raw_handle()))?;
    if info.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        return Err(Win32Error::ACCESS_DENIED);
    }
    match with_link_target(link.as_raw_handle(), |_| Ok(())) {
        Ok(()) | Err(Win32Error::INVALID_DATA) => delete_by_handle(&link),
        Err(Win32Error::SYMLINK_NOT_SUPPORTED) => Err(Win32Error::ACCESS_DENIED),
        Err(error) => Err(error),
    }
}

pub fn is_delete_pending(file: HANDLE) -> Option<bool> {
    let info: w::FILE_STANDARD_INFORMATION = nt::query_file_info(file).ok()?;
    Some(info.DeletePending != 0)
}

pub fn unlink(path: &ZStr) -> Maybe<()> {
    let result = resolve_nt_path(path).and_then(|nt_path| {
        if nt_path.full_name().ends_with(bun_core::w!("\\")) {
            return unlink_directory_link(&nt_path);
        }
        let options = w::FILE_NON_DIRECTORY_FILE | w::FILE_OPEN_REPARSE_POINT;
        match open_existing(nt_path.root_and_name(), w::DELETE, options) {
            Err(NTSTATUS::FILE_IS_A_DIRECTORY) => unlink_directory_link(&nt_path),
            file => delete_by_handle(&map_nt_error(file)?),
        }
    });
    map_path_error(result, Tag::unlink, path)
}

fn remove_directory(nt_path: &NtPath) -> Result<(), Win32Error> {
    let options = w::FILE_DIRECTORY_FILE | w::FILE_OPEN_REPARSE_POINT;
    let directory = map_nt_error(open_existing(nt_path.root_and_name(), w::DELETE, options))?;
    delete_by_handle(&directory)
}

/// [`crate::rmdir`] differs in path resolution and error mapping.
pub fn rmdir(path: &ZStr) -> Maybe<()> {
    let result = resolve_nt_path(path).and_then(|nt_path| remove_directory(&nt_path));
    map_path_error(result, Tag::rmdir, path)
}

fn with_wide_path_pair(
    from: &ZStr,
    to: &ZStr,
    call: impl FnOnce(&WStr, &WStr) -> Result<(), Win32Error>,
) -> Result<(), Win32Error> {
    with_wide_path(from, |from| with_wide_path(to, |to| call(from, to)))
}

pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let result = with_wide_path_pair(from, to, |from, to| {
        super::MoveFileExW(from, to, super::MOVEFILE_REPLACE_EXISTING)
    });
    map_path_error(result, Tag::rename, from).map_err(|error| error.with_dest(to.as_bytes()))
}

pub fn link(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let result = with_wide_path_pair(from, to, |from, to| super::CreateHardLinkW(to, from));
    map_path_error(result, Tag::link, from).map_err(|error| error.with_dest(to.as_bytes()))
}

fn create_symlink(target: &ZStr, link: &ZStr, flags: u32) -> Maybe<()> {
    let result = with_wide_path_pair(target, link, |target, link| {
        let flags = flags | w::SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE;
        super::CreateSymbolicLinkW(link, target, flags)
    });
    map_path_error(result, Tag::symlink, target).map_err(|error| error.with_dest(link.as_bytes()))
}

/// Creates a file symlink.
pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
    create_symlink(target, link, 0)
}

pub fn symlink_dir(target: &ZStr, link: &ZStr) -> Maybe<()> {
    create_symlink(target, link, w::SYMBOLIC_LINK_FLAG_DIRECTORY)
}

/// `target` must be absolute.
pub fn create_junction(target: &ZStr, link: &ZStr) -> Maybe<()> {
    let result = resolve_nt_path(link).and_then(|nt_path| {
        let reparse_data = with_wide_path(target, |target| {
            reparse::encode_junction(target).map_err(|error| match error {
                JunctionError::RelativeTarget => Win32Error::INVALID_PARAMETER,
                JunctionError::TooLong => Win32Error::FILENAME_EXCED_RANGE,
            })
        })?;
        let options = NtCreateFileOptions {
            access_mask: w::GENERIC_WRITE | w::SYNCHRONIZE,
            disposition: w::FILE_CREATE,
            options: w::FILE_DIRECTORY_FILE
                | w::FILE_OPEN_REPARSE_POINT
                | w::FILE_SYNCHRONOUS_IO_NONALERT
                | FILE_OPEN_FOR_BACKUP_INTENT,
            attributes: w::FILE_ATTRIBUTE_NORMAL,
            sharing_mode: 0,
        };
        let (root, name) = nt_path.root_and_name();
        let directory = map_nt_error(NtCreateFile(root, name, options))?;
        let result = map_nt_error(nt::set_reparse_point(
            directory.as_raw_handle(),
            &reparse_data,
        ));
        // The WSL share cannot delete a directory through the handle that created it.
        drop(directory);
        result.inspect_err(|_| _ = remove_directory(&nt_path))
    });
    map_path_error(result, Tag::symlink, target).map_err(|error| error.with_dest(link.as_bytes()))
}

/// `len` is `None` if the text did not fit in `buf`.
fn nul_terminate(len: Option<usize>, buf: &mut [u8]) -> Result<usize, Win32Error> {
    match len {
        Some(len) if len < buf.len() => {
            buf[len] = 0;
            Ok(len)
        }
        _ => Err(Win32Error::FILENAME_EXCED_RANGE),
    }
}

/// NUL-terminates the target in `buf`.
pub(crate) fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
    let result = resolve_nt_path(path).and_then(|nt_path| {
        let link = open_synchronous(nt_path.root_and_name(), 0, w::FILE_OPEN_REPARSE_POINT)?;
        with_link_target(link.as_raw_handle(), |target| {
            nul_terminate(target.decode(buf), buf)
        })
        .map_err(|error| match error {
            Win32Error::NOT_A_REPARSE_POINT => Win32Error::INVALID_PARAMETER,
            error => error,
        })
    });
    map_path_error(result, Tag::readlink, path)
}

pub fn realpath<'a>(path: &ZStr, buf: &'a mut PathBuffer) -> Maybe<&'a [u8]> {
    let result = resolve_nt_path(path).and_then(|nt_path| {
        let file = open_synchronous(nt_path.root_and_name(), 0, 0)?;
        let mut wide_buf = w_path_buffer_pool::get();
        let len = super::GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            &mut wide_buf[..],
            w::VOLUME_NAME_DOS,
        )?;
        let final_path = path_syntax::strip_verbatim_prefix(&mut wide_buf[..len])
            .ok_or(Win32Error::INVALID_HANDLE)?;
        let decoded_len = wtf16::decode(final_path.iter().copied(), &mut buf[..]);
        nul_terminate(decoded_len, &mut buf[..])
    });
    map_path_error(result, Tag::realpath, path).map(|len| &buf[..len])
}

/// The path of `file` below `\Device`, which does not depend on where its volume is mounted.
pub fn device_path(file: HANDLE) -> Option<Vec<u8>> {
    let mut buf = w_path_buffer_pool::get();
    let len = super::GetFinalPathNameByHandleW(file, &mut buf[..], w::VOLUME_NAME_NT).ok()?;
    Some(bun_core::strings::wtf16_to_wtf8(&buf[..len]))
}

// ── attributes ──────────────────────────────────────────────────────────────

fn compute_attributes(mode: Mode, attributes: u32) -> u32 {
    if mode & S::IWUSR == 0 {
        attributes | w::FILE_ATTRIBUTE_READONLY
    } else {
        attributes & !w::FILE_ATTRIBUTE_READONLY
    }
}

/// Does not follow symlinks.
pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> {
    let result = with_wide_path(path, |path| {
        let attributes = compute_attributes(mode, super::GetFileAttributesW(path)?);
        // SAFETY: `path` is NUL-terminated.
        check(unsafe { w::SetFileAttributesW(path.as_ptr(), attributes) })
    });
    map_path_error(result, Tag::chmod, path)
}

pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
    let set_mode = |file: HANDLE, should_preserve_ctime: bool| {
        let old_info: w::FILE_BASIC_INFORMATION = nt::query_file_info(file)?;
        if old_info.FileAttributes & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
            return Err(NTSTATUS::FILE_IS_A_DIRECTORY);
        }
        let new_info = w::FILE_BASIC_INFORMATION {
            ChangeTime: if should_preserve_ctime {
                old_info.ChangeTime
            } else {
                0
            },
            ..new_basic_info(compute_attributes(mode, old_info.FileAttributes))
        };
        nt::set_file_info(file, new_info)
    };
    with_fd_handle(fd, Tag::fchmod, |file| {
        let access = w::FILE_READ_ATTRIBUTES | w::FILE_WRITE_ATTRIBUTES | w::SYNCHRONIZE;
        let options = w::FILE_NON_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT;
        map_nt_error(match open_existing((Some(file), &[]), access, options) {
            Ok(reopened) => set_mode(reopened.as_raw_handle(), true),
            // Node.js fails here. A timestamp set through `file` would stop later writes from updating it.
            Err(
                reopen_error @ (NTSTATUS::NO_SUCH_FILE
                | NTSTATUS::OBJECT_NAME_INVALID
                | NTSTATUS::OBJECT_NAME_NOT_FOUND
                | NTSTATUS::OBJECT_PATH_NOT_FOUND
                | NTSTATUS::SHARING_VIOLATION
                | NTSTATUS::DELETE_PENDING
                | NTSTATUS::FILE_DELETED),
            ) if super::is_disk_file(fd) => set_mode(file, false).map_err(|_| reopen_error),
            Err(reopen_error) => Err(reopen_error),
        })
    })
}

/// `None` unless `fd` is unbuffered (whole sectors only) or overlapped (no position, so writes append).
pub fn reopen_buffered(fd: Fd, flags: i32) -> Maybe<Option<Fd>> {
    const FILE_WRITE_DATA: u32 = 0x2;
    const FILE_WRITE_THROUGH: u32 = 0x2;
    const FILE_NO_INTERMEDIATE_BUFFERING: u32 = 0x8;
    const SYNCHRONOUS_IO: u32 = 0x10 | w::FILE_SYNCHRONOUS_IO_NONALERT;
    with_fd_handle(fd, Tag::open, |file| {
        let mode = map_nt_error(nt::query_file_info::<w::FILE_MODE_INFORMATION>(file))?.Mode;
        let is_overlapped = mode & SYNCHRONOUS_IO == 0;
        if !is_overlapped && mode & FILE_NO_INTERMEDIATE_BUFFERING == 0 {
            return Ok(None);
        }
        let granted = map_nt_error(nt::query_file_info::<w::FILE_ACCESS_INFORMATION>(file))?;
        let mut access = granted.AccessFlags
            & match flags & crate::O::ACCMODE {
                crate::O::RDONLY => w::FILE_READ_DATA,
                _ => FILE_WRITE_DATA | w::FILE_APPEND_DATA,
            };
        if is_overlapped && access & FILE_WRITE_DATA != 0 {
            access = w::FILE_APPEND_DATA;
        }
        let options = w::FILE_NON_DIRECTORY_FILE | (mode & FILE_WRITE_THROUGH);
        let reopened = open_synchronous((Some(file), &[]), access, options)?;
        let position = map_nt_error(nt::query_file_info::<w::FILE_POSITION_INFORMATION>(file))?;
        map_nt_error(nt::set_file_info(reopened.as_raw_handle(), position))?;
        Ok(Some(Fd::from_system(reopened.into_raw_handle())))
    })
}

pub fn chown(_: &ZStr, _uid: u32, _gid: u32) -> Maybe<()> {
    Ok(())
}

pub fn lchown(_: &ZStr, _uid: u32, _gid: u32) -> Maybe<()> {
    Ok(())
}

pub fn fchown(_: Fd, _uid: u32, _gid: u32) -> Maybe<()> {
    Ok(())
}

fn set_times(file: HANDLE, atime: TimeLike, mtime: TimeLike) -> Result<(), Win32Error> {
    let to_file_time = |time: TimeLike| {
        file_time::from_unix_time(time.sec, time.nsec).ok_or(Win32Error::INVALID_PARAMETER)
    };
    let times = w::FILE_BASIC_INFORMATION {
        LastAccessTime: to_file_time(atime)?,
        LastWriteTime: to_file_time(mtime)?,
        ..bun_core::ffi::zeroed()
    };
    map_nt_error(nt::set_file_info(file, times))
}

fn set_path_times(
    path: &ZStr,
    atime: TimeLike,
    mtime: TimeLike,
    follow: FollowSymlinks,
) -> Result<(), Win32Error> {
    let nt_path = resolve_nt_path(path)?;
    let file = open_synchronous(
        nt_path.root_and_name(),
        w::FILE_WRITE_ATTRIBUTES,
        follow.create_options(),
    )?;
    set_times(file.as_raw_handle(), atime, mtime)
}

pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    let result = set_path_times(path, atime, mtime, FollowSymlinks::Yes);
    map_path_error(result, Tag::utime, path)
}

pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    let result = set_path_times(path, atime, mtime, FollowSymlinks::No);
    map_path_error(result, Tag::lutime, path)
}

pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    with_fd_handle(fd, Tag::futime, |file| set_times(file, atime, mtime))
}
