//! The file calls, with the errors that Node.js reports. Paths follow the rules of Win32.

use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU32, Ordering};
use std::os::windows::io::{AsRawHandle as _, IntoRawHandle as _, OwnedHandle};

use bun_core::{PathBuffer, S, WStr, ZBox, ZStr};
use bun_paths::{path_buffer_pool, w_path_buffer_pool};
use bun_windows_sys::externs as w;

use super::nt::{self, Name};
use super::{
    FILE_OPEN_FOR_BACKUP_INTENT, FILE_TYPE_CHAR, FILE_TYPE_DISK, FILE_TYPE_PIPE, GetFileType,
    HANDLE, NTSTATUS, NtCreateFile, Win32Error, Win32ErrorExt as _, check, file_position, sync_io,
};
use crate::windows_format::reparse::{self, JunctionError, LinkTarget};
use crate::windows_format::wide::{self, EncodeError};
use crate::windows_format::{file_time, names, open_flags};
use crate::{
    Error, FILE_SHARE, Fd, IoVec, IoVecMut, Maybe, Mode, NtCreateFileOptions, Tag, TimeLike, syslog,
};

type Result<T> = core::result::Result<T, Win32Error>;

impl From<EncodeError> for Win32Error {
    fn from(error: EncodeError) -> Self {
        match error {
            EncodeError::Malformed => Self::INVALID_NAME,
            EncodeError::TooLong => Self::FILENAME_EXCED_RANGE,
        }
    }
}

fn win32<T>(result: core::result::Result<T, NTSTATUS>) -> Result<T> {
    result.map_err(Win32Error::from_ntstatus)
}

fn at_path<T>(result: Result<T>, tag: Tag, path: &ZStr) -> Maybe<T> {
    syslog!(
        "{}({}) = {:?}",
        <&str>::from(tag),
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().err()
    );
    result.map_err(|error| Error::new(error.to_node_e(), tag).with_path(path.as_bytes()))
}

fn at_fd<T>(fd: Fd, tag: Tag, call: impl FnOnce(HANDLE) -> Result<T>) -> Maybe<T> {
    of_fd(file_position::ignoring(fd, call), tag, fd)
}

fn of_fd<T>(result: Result<T>, tag: Tag, fd: Fd) -> Maybe<T> {
    syslog!(
        "{}({}) = {:?}",
        <&str>::from(tag),
        fd,
        result.as_ref().err()
    );
    // Not `with_fd`: a missing standard handle is `Fd::INVALID`.
    result.map_err(|error| Error {
        fd,
        ..Error::new(error.to_node_e(), tag)
    })
}

fn with_wide<T>(path: &ZStr, call: impl FnOnce(&WStr) -> Result<T>) -> Result<T> {
    let mut buf = w_path_buffer_pool::get();
    call(wide::encode(path.as_bytes(), &mut buf[..])?)
}

fn name_of(path: &ZStr) -> Result<Name> {
    let mut buf = w_path_buffer_pool::get();
    let len = wide::encode(path.as_bytes(), &mut buf[..])?.len();
    Name::new(buf, len)
}

/// What `path` names now, in a form that does not depend on the current directory and can have any length.
pub fn verbatim_path(path: &[u8]) -> Option<ZBox> {
    let mut buf = path_buffer_pool::get();
    let full_path = if path.starts_with(b"\\\\?\\") || path.starts_with(b"\\??\\") {
        path
    } else {
        let (mut from, mut to) = (w_path_buffer_pool::get(), w_path_buffer_pool::get());
        let from = wide::encode(path, &mut from[..]).ok()?;
        let len = super::GetFullPathNameW(from, &mut to[..]).ok()?;
        if names::is_console_path(&to[..len]) && !names::is_bare(path) {
            return None;
        }
        let len = wide::decode(to[..len].iter().copied(), &mut buf[..])?;
        &buf[..len]
    };
    let [prefix, rest] = names::with_verbatim_prefix(full_path);
    Some(ZBox::from_vec_with_nul([prefix, rest, &[0]].concat()))
}

fn open_existing(
    (root, name): (Option<HANDLE>, &[u16]),
    access_mask: u32,
    options: u32,
) -> core::result::Result<OwnedHandle, NTSTATUS> {
    let options = NtCreateFileOptions {
        access_mask,
        disposition: w::FILE_OPEN,
        options: options | FILE_OPEN_FOR_BACKUP_INTENT,
        attributes: 0,
        sharing_mode: FILE_SHARE,
    };
    NtCreateFile(root, name, options)
}

/// With what `CreateFileW` adds.
fn open_synchronous(
    name: (Option<HANDLE>, &[u16]),
    access: u32,
    options: u32,
) -> Result<OwnedHandle> {
    let access = access | w::SYNCHRONIZE | w::FILE_READ_ATTRIBUTES;
    let options = options | w::FILE_SYNCHRONOUS_IO_NONALERT;
    win32(open_existing(name, access, options))
}

#[derive(Clone, Copy, PartialEq)]
enum Follow {
    Yes,
    No,
}

impl Follow {
    fn options(self) -> u32 {
        match self {
            Self::Yes => 0,
            Self::No => w::FILE_OPEN_REPARSE_POINT,
        }
    }
}

// ── open ────────────────────────────────────────────────────────────────────

static UMASK: AtomicU32 = AtomicU32::new(0);

pub fn umask(mode: Mode) -> Mode {
    // Nothing is published with it: a later call reads the value, in any order.
    UMASK.swap(mode & (S::IRUSR | S::IWUSR), Ordering::Relaxed)
}

pub fn current_umask() -> Mode {
    UMASK.load(Ordering::Relaxed)
}

fn create(name: &Name, create: &open_flags::Create) -> Result<OwnedHandle> {
    if let Some(console) = names::console(name.full()) {
        let disposition = match create.disposition {
            w::FILE_CREATE => w::CREATE_NEW,
            w::FILE_OPEN_IF => w::OPEN_ALWAYS,
            w::FILE_OVERWRITE_IF => w::CREATE_ALWAYS,
            _ => w::OPEN_EXISTING,
        };
        let flags = w::FILE_FLAG_BACKUP_SEMANTICS | create.attributes;
        return super::CreateFileW(console, create.access, FILE_SHARE, disposition, flags);
    }
    let (root, name) = name.parts();
    let options = NtCreateFileOptions {
        access_mask: create.access,
        disposition: create.disposition,
        options: create.options,
        attributes: create.attributes,
        sharing_mode: FILE_SHARE,
    };
    NtCreateFile(root, name, options).map_err(|status| match status {
        NTSTATUS::OBJECT_NAME_COLLISION if create.disposition != w::FILE_CREATE => IS_DIRECTORY,
        NTSTATUS::FILE_IS_A_DIRECTORY if create.truncate => IS_DIRECTORY,
        status => Win32Error::from_ntstatus(status),
    })
}

/// The code that stands for `EISDIR`.
const IS_DIRECTORY: Win32Error = Win32Error::INVALID_FUNCTION;

/// The new descriptor owns `handle`. -1 and `errno` if there is none.
pub fn open_osfhandle(handle: HANDLE) -> i32 {
    unsafe extern "C" {
        /// The new descriptor owns `handle`. -1 if the table is full or `handle` has no file type.
        safe fn _open_osfhandle(handle: HANDLE, flags: i32) -> i32;
    }
    let number = _open_osfhandle(handle, 0);
    if number != -1 {
        file_position::opened(number);
    }
    number
}

fn into_descriptor(file: OwnedHandle) -> Result<Fd> {
    match open_osfhandle(file.as_raw_handle()) {
        -1 if crate::last_errno() == libc::EMFILE => Err(Win32Error::TOO_MANY_OPEN_FILES),
        -1 => Err(Win32Error::get()),
        fd => {
            _ = file.into_raw_handle();
            Ok(Fd::from_crt(fd))
        }
    }
}

/// Returns a descriptor of the C runtime.
pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
    let result = name_of(path).and_then(|name| {
        if names::console(name.full()).is_some() && !names::is_bare(path.as_bytes()) {
            return Err(Win32Error::FILE_NOT_FOUND);
        }
        let options = open_flags::translate(flags, mode & !current_umask())
            .ok_or(Win32Error::INVALID_PARAMETER)?;
        let file = create(&name, &options)?;
        if options.truncate && GetFileType(file.as_raw_handle()) == FILE_TYPE_DISK {
            set_size(file.as_raw_handle(), 0)?;
        }
        into_descriptor(file)
    });
    at_path(result, Tag::open, path)
}

// ── read / write ────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum At {
    Position,
    Offset(i64),
    /// The position is not put back.
    OffsetOnly(i64),
}

impl At {
    fn run(
        self,
        fd: Fd,
        request: impl FnOnce(HANDLE, Option<i64>) -> Result<usize>,
    ) -> Result<usize> {
        let result = match self {
            Self::Position => file_position::using(fd, |handle| request(handle, None)),
            // The system has other meanings for these.
            Self::Offset(..0) | Self::OffsetOnly(..0) => Err(Win32Error::INVALID_PARAMETER),
            Self::Offset(at) => file_position::keeping(fd, |handle| request(handle, Some(at))),
            Self::OffsetOnly(at) => file_position::ignoring(fd, |handle| request(handle, Some(at))),
        };
        result.map_err(|error| match error {
            // Not open in this direction.
            Win32Error::ACCESS_DENIED => Win32Error::INVALID_HANDLE,
            error => error,
        })
    }
}

fn read_at(fd: Fd, vecs: &[IoVecMut<'_>], at: At) -> Maybe<usize> {
    let result = match at.run(fd, |handle, offset| sync_io::readv(handle, vecs, offset)) {
        Err(Win32Error::HANDLE_EOF | Win32Error::BROKEN_PIPE) => Ok(0),
        result => result,
    };
    of_fd(result, Tag::read, fd)
}

fn write_at(fd: Fd, vecs: &[IoVec<'_>], at: At) -> Maybe<usize> {
    let result = match at.run(fd, |handle, offset| sync_io::writev(handle, vecs, offset)) {
        Err(Win32Error::BROKEN_PIPE | Win32Error::NO_DATA) => Err(Win32Error::BAD_PIPE),
        result => result,
    };
    of_fd(result, Tag::write, fd)
}

pub(crate) fn read_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>]) -> Maybe<usize> {
    read_at(fd, &[IoVecMut::new(buf)], At::Position)
}

pub(crate) fn pread_uninit(fd: Fd, buf: &mut [MaybeUninit<u8>], offset: i64) -> Maybe<usize> {
    read_at(fd, &[IoVecMut::new(buf)], At::Offset(offset))
}

pub fn readv(fd: Fd, vecs: &[IoVecMut<'_>]) -> Maybe<usize> {
    read_at(fd, vecs, At::Position)
}

pub fn preadv(fd: Fd, vecs: &[IoVecMut<'_>], offset: i64) -> Maybe<usize> {
    read_at(fd, vecs, At::Offset(offset))
}

pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
    write_at(fd, &[IoVec::new(buf)], At::Position)
}

pub fn pwrite(fd: Fd, buf: &[u8], offset: i64) -> Maybe<usize> {
    write_at(fd, &[IoVec::new(buf)], At::Offset(offset))
}

pub fn writev(fd: Fd, vecs: &[IoVec<'_>]) -> Maybe<usize> {
    write_at(fd, vecs, At::Position)
}

pub fn pwritev(fd: Fd, vecs: &[IoVec<'_>], offset: i64) -> Maybe<usize> {
    write_at(fd, vecs, At::Offset(offset))
}

fn for_owner(fd: Fd, offset: i64) -> At {
    match file_position::is_shared(fd) {
        true => At::Offset(offset),
        false => At::OffsetOnly(offset),
    }
}

/// `pread` in one call for a `HANDLE` that no script shares. Its position ends up behind the bytes.
pub(crate) fn pread_owned(fd: Fd, buf: &mut [MaybeUninit<u8>], offset: i64) -> Maybe<usize> {
    read_at(fd, &[IoVecMut::new(buf)], for_owner(fd, offset))
}

/// As [`pread_owned`].
pub(crate) fn pwrite_owned(fd: Fd, buf: &[u8], offset: i64) -> Maybe<usize> {
    write_at(fd, &[IoVec::new(buf)], for_owner(fd, offset))
}

fn set_size(file: HANDLE, size: i64) -> Result<()> {
    let info = w::FILE_END_OF_FILE_INFORMATION { EndOfFile: size };
    win32(nt::set(file, info))
}

pub fn ftruncate(fd: Fd, size: i64) -> Maybe<()> {
    at_fd(fd, Tag::ftruncate, |file| set_size(file, size))
}

pub fn fsync(fd: Fd) -> Maybe<()> {
    at_fd(fd, Tag::fsync, super::FlushFileBuffers)
}

pub fn fdatasync(fd: Fd) -> Maybe<()> {
    at_fd(fd, Tag::fdatasync, super::FlushFileBuffers)
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

    fn device(mode: Mode, device_type: u32) -> Self {
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
                ..Self::device(S::IFCHR | 0o666, w::FILE_DEVICE_NULL)
            };
        }
        let (kind, size) = match link_size {
            Some(size) => (S::IFLNK, size as u64),
            None if info.FileAttributes & w::FILE_ATTRIBUTE_DIRECTORY != 0 => (S::IFDIR, 0),
            None => (S::IFREG, info.EndOfFile as u64),
        };
        let permissions = match info.FileAttributes & w::FILE_ATTRIBUTE_READONLY {
            0 => 0o666,
            _ => 0o444,
        };
        let [accessed, written, changed, created] = [
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
            st_atime: accessed.sec,
            st_atime_nsec: accessed.nsec,
            st_mtime: written.sec,
            st_mtime_nsec: written.nsec,
            st_ctime: changed.sec,
            st_ctime_nsec: changed.nsec,
            st_birthtime: created.sec,
            st_birthtime_nsec: created.nsec,
            ..Self::default()
        }
    }
}

fn volume_serial_number(file: HANDLE) -> Result<i64> {
    match nt::query_volume::<w::FILE_FS_VOLUME_INFORMATION>(file) {
        Err(NTSTATUS::NOT_IMPLEMENTED) => Ok(0),
        result => win32(result).map(|volume| volume.VolumeSerialNumber.into()),
    }
}

fn stat_basic(file: HANDLE) -> Result<w::FILE_STAT_BASIC_INFORMATION> {
    if nt::has_stat_basic()
        && let Ok(info) = nt::query::<w::FILE_STAT_BASIC_INFORMATION>(file)
        // The filter that owns any other tag may not know this class.
        && (info.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT == 0
            || reparse::can_be_link(info.ReparseTag))
    {
        return Ok(info);
    }
    let device: w::FILE_FS_DEVICE_INFORMATION = win32(nt::query_volume(file))?;
    if device.DeviceType == w::FILE_DEVICE_NULL {
        return Ok(w::FILE_STAT_BASIC_INFORMATION {
            DeviceType: device.DeviceType,
            ..bun_core::ffi::zeroed()
        });
    }
    let all: w::FILE_ALL_INFORMATION = win32(nt::query(file))?;
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
        VolumeSerialNumber: volume_serial_number(file)?,
        ..bun_core::ffi::zeroed()
    })
}

fn with_link_target<T>(file: HANDLE, read: impl FnOnce(LinkTarget<'_>) -> Result<T>) -> Result<T> {
    let mut buf = path_buffer_pool::get();
    let data = win32(nt::get_reparse_point(file, &mut buf[..reparse::MAX_SIZE]))?;
    match reparse::link_target(data) {
        Some(target) => read(target),
        None if reparse::lacks_name(data) => Err(Win32Error::INVALID_DATA),
        None => Err(Win32Error::SYMLINK_NOT_SUPPORTED),
    }
}

fn stat_handle(file: HANDLE, follow: Follow) -> Result<Stat> {
    let info = stat_basic(file)?;
    let link_size = match info.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT {
        1.. if follow == Follow::No => match with_link_target(file, |target| Ok(target.len())) {
            Err(Win32Error::INVALID_DATA) => Some(0),
            len => Some(len?),
        },
        _ => None,
    };
    Ok(Stat::new(&info, link_size))
}

/// For a file that could not be opened because of `error`.
fn stat_entry(name: &Name, follow: Follow, error: Win32Error) -> Result<Stat> {
    let (directory, entry) = names::split_entry(name.full()).ok_or(error)?;
    let directory = open_synchronous((None, directory), w::FILE_LIST_DIRECTORY, 0)?;
    let directory = directory.as_raw_handle();
    let entry: w::FILE_ID_FULL_DIR_INFORMATION = win32(nt::query_entry(directory, entry))?;
    let is_reparse_point = entry.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT != 0;
    if is_reparse_point && follow == Follow::Yes {
        return Err(error);
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
        VolumeSerialNumber: volume_serial_number(directory)?,
        ..bun_core::ffi::zeroed()
    };
    let is_link = is_reparse_point && reparse::can_be_link(entry.EaSize);
    Ok(Stat::new(&info, is_link.then_some(0)))
}

fn stat_by_handle(name: &Name, follow: Follow) -> Result<Stat> {
    match open_synchronous(name.parts(), 0, follow.options()) {
        Ok(file) => match stat_handle(file.as_raw_handle(), follow) {
            Err(Win32Error::SYMLINK_NOT_SUPPORTED | Win32Error::NOT_A_REPARSE_POINT)
                if follow == Follow::No =>
            {
                stat_by_handle(name, Follow::Yes)
            }
            result => result,
        },
        Err(error @ (Win32Error::ACCESS_DENIED | Win32Error::SHARING_VIOLATION)) => {
            stat_entry(name, follow, error)
        }
        Err(error) => Err(error),
    }
}

fn stat_path(path: &ZStr, follow: Follow) -> Result<Stat> {
    let mut buf = w_path_buffer_pool::get();
    let len = names::len_without_last_separator(wide::encode(path.as_bytes(), &mut buf[..])?);
    let name = Name::new(buf, len)?;
    match win32(nt::stat_basic_by_name(&name)) {
        Ok(info) if info.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT == 0 => {
            Ok(Stat::new(&info, None))
        }
        Err(
            error @ (Win32Error::FILE_NOT_FOUND
            | Win32Error::PATH_NOT_FOUND
            | Win32Error::NOT_READY
            | Win32Error::BAD_NET_NAME),
        ) => Err(error),
        _ => stat_by_handle(&name, follow),
    }
}

pub fn stat(path: &ZStr) -> Maybe<Stat> {
    at_path(stat_path(path, Follow::Yes), Tag::stat, path)
}

pub fn lstat(path: &ZStr) -> Maybe<Stat> {
    at_path(stat_path(path, Follow::No), Tag::lstat, path)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HandleKind {
    File,
    Pipe,
    Tty,
    Unknown,
}

fn kind_of(handle: HANDLE) -> HandleKind {
    match GetFileType(handle) {
        FILE_TYPE_CHAR if super::console::mode(handle).is_ok() => HandleKind::Tty,
        FILE_TYPE_CHAR | FILE_TYPE_DISK => HandleKind::File,
        FILE_TYPE_PIPE => HandleKind::Pipe,
        _ => HandleKind::Unknown,
    }
}

/// Does not wait for requests that are running on `fd`. A socket is a pipe.
pub fn guess_handle(fd: Fd) -> HandleKind {
    kind_of(fd.native())
}

pub fn fstat(fd: Fd) -> Maybe<Stat> {
    at_fd(fd, Tag::fstat, |handle| {
        let (mode, device_type) = match kind_of(handle) {
            HandleKind::File => return stat_handle(handle, Follow::Yes),
            HandleKind::Pipe => (S::IFIFO, w::FILE_DEVICE_NAMED_PIPE),
            HandleKind::Tty => (S::IFCHR, w::FILE_DEVICE_CONSOLE),
            HandleKind::Unknown => return Err(Win32Error::INVALID_HANDLE),
        };
        Ok(Stat {
            st_ino: handle.addr() as u64,
            ..Stat::device(mode, device_type)
        })
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
    let result = name_of(path).and_then(|name| {
        let options = w::FILE_DIRECTORY_FILE
            | w::FILE_SYNCHRONOUS_IO_NONALERT
            | w::FILE_OPEN_FOR_FREE_SPACE_QUERY;
        let open_directory = |name| open_existing(name, w::SYNCHRONIZE, options);
        let directory = match (open_directory(name.parts()), names::parent(name.full())) {
            (Err(NTSTATUS::NOT_A_DIRECTORY), Some(parent)) => open_directory((None, parent)),
            (result, _) => result,
        };
        let size: w::FILE_FS_SIZE_INFORMATION =
            win32(directory.and_then(|it| nt::query_volume(it.as_raw_handle())))?;
        Ok(StatFS {
            f_bsize: u64::from(size.BytesPerSector) * u64::from(size.SectorsPerAllocationUnit),
            f_blocks: size.TotalAllocationUnits as u64,
            f_bfree: size.AvailableAllocationUnits as u64,
            f_bavail: size.AvailableAllocationUnits as u64,
            ..StatFS::default()
        })
    });
    at_path(result, Tag::statfs, path)
}

// ── names ───────────────────────────────────────────────────────────────────

pub fn mkdir(path: &ZStr, _mode: Mode) -> Maybe<()> {
    let result = with_wide(path, |path| {
        super::CreateDirectoryW(path).map_err(|error| match error {
            Win32Error::INVALID_NAME | Win32Error::DIRECTORY => Win32Error::INVALID_PARAMETER,
            error => error,
        })
    });
    at_path(result, Tag::mkdir, path)
}

/// `template` ends with six units to replace and a NUL. `random` is a source fit for keys.
pub fn mkdtemp(template: &mut [u8], random: fn(&mut [u8])) -> Maybe<&[u8]> {
    const LETTERS: &[u8; 62] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let len = ZStr::from_slice_with_nul(template).len();
    let mut result = Ok(());
    for _ in 0..1000 {
        let mut bytes = [0; 8];
        random(&mut bytes);
        let mut number = u64::from_ne_bytes(bytes);
        for letter in &mut template[len - 6..len] {
            *letter = LETTERS[(number % 62) as usize];
            number /= 62;
        }
        result = with_wide(ZStr::from_slice_with_nul(template), super::CreateDirectoryW);
        if result != Err(Win32Error::ALREADY_EXISTS) {
            break;
        }
    }
    at_path(result, Tag::mkdtemp, ZStr::from_slice_with_nul(template))?;
    Ok(&template[..len])
}

fn attributes_only(attributes: u32) -> w::FILE_BASIC_INFORMATION {
    w::FILE_BASIC_INFORMATION {
        // 0 leaves them as they are.
        FileAttributes: match attributes {
            0 => w::FILE_ATTRIBUTE_NORMAL,
            attributes => attributes,
        },
        ..bun_core::ffi::zeroed()
    }
}

fn delete_when_closed(file: HANDLE) -> core::result::Result<(), NTSTATUS> {
    nt::set(file, w::FILE_DISPOSITION_INFORMATION { DeleteFile: 1 })
}

fn delete(file: &OwnedHandle) -> Result<()> {
    let file = file.as_raw_handle();
    let at_once = w::FILE_DISPOSITION_INFORMATION_EX {
        Flags: super::FILE_DISPOSITION_DELETE
            | super::FILE_DISPOSITION_POSIX_SEMANTICS
            | super::FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };
    match win32(nt::set(file, at_once)) {
        // Not every file system has it.
        Err(
            Win32Error::NOT_SUPPORTED
            | Win32Error::INVALID_PARAMETER
            | Win32Error::INVALID_FUNCTION,
        ) => {}
        result => return result,
    }
    match delete_when_closed(file) {
        Err(NTSTATUS::CANNOT_DELETE) => {}
        result => return win32(result),
    }
    let (access, options) = (w::FILE_WRITE_ATTRIBUTES, w::FILE_OPEN_REPARSE_POINT);
    let again = open_synchronous((Some(file), &[]), access, options)?;
    let again = again.as_raw_handle();
    let before = win32(nt::query::<w::FILE_BASIC_INFORMATION>(again))?.FileAttributes;
    let writable = attributes_only(before & !w::FILE_ATTRIBUTE_READONLY);
    win32(nt::set(again, writable))?;
    win32(delete_when_closed(file)).inspect_err(|_| _ = nt::set(again, attributes_only(before)))
}

fn unlink_directory(name: &Name) -> Result<()> {
    let options = w::FILE_DIRECTORY_FILE | w::FILE_OPEN_REPARSE_POINT;
    let link = open_synchronous(name.parts(), w::DELETE, options)?;
    let info: w::FILE_BASIC_INFORMATION = win32(nt::query(link.as_raw_handle()))?;
    if info.FileAttributes & w::FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        return Err(Win32Error::ACCESS_DENIED);
    }
    match with_link_target(link.as_raw_handle(), |_| Ok(())) {
        Ok(()) | Err(Win32Error::INVALID_DATA) => delete(&link),
        Err(Win32Error::SYMLINK_NOT_SUPPORTED) => Err(Win32Error::ACCESS_DENIED),
        Err(error) => Err(error),
    }
}

pub fn is_delete_pending(file: HANDLE) -> Option<bool> {
    let info: w::FILE_STANDARD_INFORMATION = nt::query(file).ok()?;
    Some(info.DeletePending != 0)
}

pub fn unlink(path: &ZStr) -> Maybe<()> {
    let result = name_of(path).and_then(|name| {
        if name.full().ends_with(bun_core::w!("\\")) {
            return unlink_directory(&name);
        }
        let options = w::FILE_NON_DIRECTORY_FILE | w::FILE_OPEN_REPARSE_POINT;
        match open_existing(name.parts(), w::DELETE, options) {
            Err(NTSTATUS::FILE_IS_A_DIRECTORY) => unlink_directory(&name),
            file => delete(&win32(file)?),
        }
    });
    at_path(result, Tag::unlink, path)
}

fn remove_directory(name: &Name) -> Result<()> {
    let options = w::FILE_DIRECTORY_FILE | w::FILE_OPEN_REPARSE_POINT;
    delete(&win32(open_existing(name.parts(), w::DELETE, options))?)
}

/// [`crate::rmdir`] has other rules for paths and other errors.
pub fn rmdir(path: &ZStr) -> Maybe<()> {
    let result = name_of(path).and_then(|name| remove_directory(&name));
    at_path(result, Tag::rmdir, path)
}

fn with_both(from: &ZStr, to: &ZStr, call: impl FnOnce(&WStr, &WStr) -> Result<()>) -> Result<()> {
    with_wide(from, |from| with_wide(to, |to| call(from, to)))
}

pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let result = with_both(from, to, |from, to| {
        super::MoveFileExW(from, to, super::MOVEFILE_REPLACE_EXISTING)
    });
    at_path(result, Tag::rename, from).map_err(|error| error.with_dest(to.as_bytes()))
}

pub fn link(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let result = with_both(from, to, |from, to| super::CreateHardLinkW(to, from));
    at_path(result, Tag::link, from).map_err(|error| error.with_dest(to.as_bytes()))
}

fn symbolic_link(target: &ZStr, link: &ZStr, flags: u32) -> Maybe<()> {
    let result = with_both(target, link, |target, link| {
        let flags = flags | w::SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE;
        super::CreateSymbolicLinkW(link, target, flags)
    });
    at_path(result, Tag::symlink, target).map_err(|error| error.with_dest(link.as_bytes()))
}

/// To a file.
pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
    symbolic_link(target, link, 0)
}

pub fn symlink_directory(target: &ZStr, link: &ZStr) -> Maybe<()> {
    symbolic_link(target, link, w::SYMBOLIC_LINK_FLAG_DIRECTORY)
}

/// `target` is absolute.
pub fn junction(target: &ZStr, link: &ZStr) -> Maybe<()> {
    let result = name_of(link).and_then(|name| {
        let data = with_wide(target, |target| {
            reparse::junction(target).map_err(|error| match error {
                JunctionError::TargetIsRelative => Win32Error::INVALID_PARAMETER,
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
        let (root, relative) = name.parts();
        let directory = win32(NtCreateFile(root, relative, options))?;
        let result = win32(nt::set_reparse_point(directory.as_raw_handle(), &data));
        // The share of WSL does not delete through the handle that created the directory.
        drop(directory);
        result.inspect_err(|_| _ = remove_directory(&name))
    });
    at_path(result, Tag::symlink, target).map_err(|error| error.with_dest(link.as_bytes()))
}

/// Puts a NUL behind the `len` bytes.
fn terminated(len: Option<usize>, buf: &mut [u8]) -> Result<usize> {
    let end = len.and_then(|len| buf.get_mut(len).map(|end| (len, end)));
    let (len, end) = end.ok_or(Win32Error::FILENAME_EXCED_RANGE)?;
    *end = 0;
    Ok(len)
}

/// A NUL follows the target in `buf`.
pub(crate) fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
    let result = name_of(path).and_then(|name| {
        let link = open_synchronous(name.parts(), 0, w::FILE_OPEN_REPARSE_POINT)?;
        with_link_target(link.as_raw_handle(), |target| {
            terminated(target.decode(buf), buf)
        })
        .map_err(|error| match error {
            Win32Error::NOT_A_REPARSE_POINT => Win32Error::INVALID_PARAMETER,
            error => error,
        })
    });
    at_path(result, Tag::readlink, path)
}

pub fn realpath<'a>(path: &ZStr, buf: &'a mut PathBuffer) -> Maybe<&'a [u8]> {
    let result = name_of(path).and_then(|name| {
        let file = open_synchronous(name.parts(), 0, 0)?;
        let mut wide = w_path_buffer_pool::get();
        let len = super::GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            &mut wide[..],
            w::VOLUME_NAME_DOS,
        )?;
        let real = names::without_verbatim_prefix(&mut wide[..len]);
        let real = real.ok_or(Win32Error::INVALID_HANDLE)?.iter().copied();
        terminated(wide::decode(real, &mut buf[..]), &mut buf[..])
    });
    at_path(result, Tag::realpath, path).map(|len| &buf[..len])
}

// ── attributes ──────────────────────────────────────────────────────────────

fn attributes_for(mode: Mode, attributes: u32) -> u32 {
    match mode & S::IWUSR {
        0 => attributes | w::FILE_ATTRIBUTE_READONLY,
        _ => attributes & !w::FILE_ATTRIBUTE_READONLY,
    }
}

/// Of a link it changes the link.
pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> {
    let result = with_wide(path, |path| {
        let attributes = attributes_for(mode, super::GetFileAttributesW(path)?);
        // SAFETY: `path` is NUL-terminated.
        check(unsafe { w::SetFileAttributesW(path.as_ptr(), attributes) })
    });
    at_path(result, Tag::chmod, path)
}

pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
    let change = |file: HANDLE, keeps_time: bool| {
        let before: w::FILE_BASIC_INFORMATION = nt::query(file)?;
        if before.FileAttributes & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
            return Err(NTSTATUS::FILE_IS_A_DIRECTORY);
        }
        let after = w::FILE_BASIC_INFORMATION {
            ChangeTime: if keeps_time { before.ChangeTime } else { 0 },
            ..attributes_only(attributes_for(mode, before.FileAttributes))
        };
        nt::set(file, after)
    };
    at_fd(fd, Tag::fchmod, |file| {
        let access = w::FILE_READ_ATTRIBUTES | w::FILE_WRITE_ATTRIBUTES | w::SYNCHRONIZE;
        let options = w::FILE_NON_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT;
        win32(match open_existing((Some(file), &[]), access, options) {
            Ok(again) => change(again.as_raw_handle(), true),
            // Node.js gives up. A time that is set through a handle no longer follows its writes.
            Err(
                refused @ (NTSTATUS::NO_SUCH_FILE
                | NTSTATUS::OBJECT_NAME_INVALID
                | NTSTATUS::OBJECT_NAME_NOT_FOUND
                | NTSTATUS::OBJECT_PATH_NOT_FOUND
                | NTSTATUS::SHARING_VIOLATION
                | NTSTATUS::DELETE_PENDING
                | NTSTATUS::FILE_DELETED),
            ) if super::is_disk(fd) => change(file, false).map_err(|_| refused),
            Err(refused) => Err(refused),
        })
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

fn set_times(file: HANDLE, atime: TimeLike, mtime: TimeLike) -> Result<()> {
    let ticks = |time: TimeLike| {
        file_time::from_unix(time.sec, time.nsec).ok_or(Win32Error::INVALID_PARAMETER)
    };
    let times = w::FILE_BASIC_INFORMATION {
        LastAccessTime: ticks(atime)?,
        LastWriteTime: ticks(mtime)?,
        ..bun_core::ffi::zeroed()
    };
    win32(nt::set(file, times))
}

fn set_times_at(path: &ZStr, atime: TimeLike, mtime: TimeLike, follow: Follow) -> Result<()> {
    let name = name_of(path)?;
    let file = open_synchronous(name.parts(), w::FILE_WRITE_ATTRIBUTES, follow.options())?;
    set_times(file.as_raw_handle(), atime, mtime)
}

pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    let result = set_times_at(path, atime, mtime, Follow::Yes);
    at_path(result, Tag::utime, path)
}

pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    let result = set_times_at(path, atime, mtime, Follow::No);
    at_path(result, Tag::lutime, path)
}

pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    at_fd(fd, Tag::futime, |file| set_times(file, atime, mtime))
}
