//! File-system calls with the Win32 call sequences and errno values Node.js has on Windows.

use core::cell::{OnceCell, UnsafeCell};
use core::ffi::c_void;
use core::mem::size_of;
use core::ptr::{from_mut, from_ref, null, null_mut};
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};

use bun_core::ffi::zeroed;
use bun_core::{S, WStr, ZStr, strings, w};
use bun_paths::{WPathBuffer, is_drive_letter_t, is_sep_any_t, w_path_buffer_pool};
use bun_windows_sys::externs::{
    CloseHandle, CreateDirectoryW, CreateSymbolicLinkW, FILE_APPEND_DATA, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_BASIC_INFORMATION, FILE_BEGIN, FILE_DEVICE_CONSOLE, FILE_DEVICE_NAMED_PIPE,
    FILE_DEVICE_NULL, FILE_DISPOSITION_INFORMATION, FILE_DISPOSITION_INFORMATION_EX,
    FILE_END_OF_FILE_INFORMATION, FILE_FS_DEVICE_INFORMATION, FILE_FS_VOLUME_INFORMATION,
    FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_INFORMATION_CLASS, FILE_READ_ATTRIBUTES,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILETIME, FS_INFORMATION_CLASS,
    GENERIC_WRITE, GetCurrentDirectoryW, GetFileAttributesExW, NT_ERROR, NT_SUCCESS, RtlGenRandom,
    SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE, SYMBOLIC_LINK_FLAG_DIRECTORY, UNICODE_STRING,
    VOLUME_NAME_DOS, WAIT_OBJECT_0, WIN32_FILE_ATTRIBUTE_DATA,
};

use super::{
    BOOL, BY_HANDLE_FILE_INFORMATION, CreateFileW, DELETE, DWORD, FILE_ALL_INFORMATION,
    FILE_DISPOSITION_DELETE, FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    FILE_DISPOSITION_POSIX_SEMANTICS, FILE_FLAG_BACKUP_SEMANTICS, FILE_LIST_DIRECTORY,
    FILE_TYPE_CHAR, FILE_TYPE_DISK, FILE_TYPE_PIPE, GetFileInformationByHandle, HANDLE, INFINITE,
    INVALID_HANDLE_VALUE, IO_STATUS_BLOCK, LPCWSTR, MOVEFILE_REPLACE_EXISTING, NTSTATUS,
    OPEN_EXISTING, SetFilePointerEx, ULONG, Win32Error, Win32ErrorExt as _, kernel32, ntdll,
};
use crate::{E, Error, Fd, Maybe, Mode, PlatformIoVec, PlatformIoVecConst, Tag, TimeLike, syslog};

type Win32Result<T> = Result<T, Win32Error>;

const FILE_SHARE_ALL: DWORD = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
const FILE_WRITE_DATA: DWORD = 0x0002;
const FILE_WRITE_ATTRIBUTES: DWORD = 0x0100;
const FILE_ATTRIBUTE_ARCHIVE: DWORD = 0x0020;
const FILE_FLAG_OPEN_REPARSE_POINT: DWORD = 0x0020_0000;
const FILE_FLAG_NO_BUFFERING: DWORD = 0x2000_0000;
const FILE_FLAG_WRITE_THROUGH: DWORD = 0x8000_0000;
const CREATE_NEW: DWORD = 1;
const CREATE_ALWAYS: DWORD = 2;
const OPEN_ALWAYS: DWORD = 4;
const TRUNCATE_EXISTING: DWORD = 5;
const FILE_CURRENT: DWORD = 1;
const FSCTL_SET_REPARSE_POINT: DWORD = 0x0009_00A4;
const FSCTL_GET_REPARSE_POINT: DWORD = 0x0009_00A8;
const MAXIMUM_REPARSE_DATA_BUFFER_SIZE: usize = 16 * 1024;
const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000_000C;
const IO_REPARSE_TAG_APPEXECLINK: u32 = 0x8000_001B;
const IO_REPARSE_TAG_LX_SYMLINK: u32 = 0xA000_001D;
const FILE_STAT_BASIC_BY_NAME_INFO: u32 = 3;
/// `_S_IWRITE`, the one mode bit Windows can store: its absence is the read-only attribute.
const S_IWRITE: Mode = 0o200;
/// 1601-01-01 to 1970-01-01 in 100 ns ticks.
const EPOCH_DIFFERENCE_TICKS: i64 = 11_644_473_600 * TICKS_PER_SEC;
const TICKS_PER_SEC: i64 = 10_000_000;

unsafe extern "system" {
    // safe: every argument is passed by value, and a bad handle is reported as an error.
    safe fn ReOpenFile(original: HANDLE, access: DWORD, share: DWORD, flags: DWORD) -> HANDLE;
    fn RemoveDirectoryW(path: LPCWSTR) -> BOOL;
    fn GetFullPathNameW(
        path: LPCWSTR,
        capacity: DWORD,
        out: *mut u16,
        file_part: *mut *mut u16,
    ) -> DWORD;
    fn SetFileAttributesW(path: LPCWSTR, attributes: DWORD) -> BOOL;
    fn SetFileTime(
        file: HANDLE,
        creation: *const FILETIME,
        last_access: *const FILETIME,
        last_write: *const FILETIME,
    ) -> BOOL;
}

/// The fields of `libc::stat` on macOS that Windows can fill in.
#[derive(Clone, Copy)]
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

#[derive(Clone, Copy)]
pub struct StatFS {
    pub f_type: u64,
    pub f_bsize: u64,
    pub f_blocks: u64,
    pub f_bfree: u64,
    pub f_bavail: u64,
    pub f_files: u64,
    pub f_ffree: u64,
}

bun_core::impl_zeroable!(Stat, StatFS);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SymlinkKind {
    File,
    Dir,
    Junction,
}

/// `fs.constants.O_*` on Windows: the C runtime's `_O_*` values and Node's additions.
pub mod O {
    pub const RDONLY: i32 = 0x0000;
    pub const WRONLY: i32 = 0x0001;
    pub const RDWR: i32 = 0x0002;
    pub const APPEND: i32 = 0x0008;
    pub const CREAT: i32 = 0x0100;
    pub const TRUNC: i32 = 0x0200;
    pub const EXCL: i32 = 0x0400;
    pub const DIRECT: i32 = 0x0200_0000;
    pub(crate) const DSYNC: i32 = 0x0400_0000;
    pub const SYNC: i32 = 0x0800_0000;
    pub(crate) const FILEMAP: i32 = 0x2000_0000;

    /// Bits of a `bun_sys::O` mask that `bun_sys::O` does not name on Windows.
    mod bun_o {
        pub(super) const DSYNC: i32 = 0o10000;
        pub(super) const DIRECT: i32 = 0o40000;
        pub(super) const SYNC: i32 = 0o4010000;
    }

    const PAIRS: [(i32, i32); 8] = [
        (crate::O::WRONLY, WRONLY),
        (crate::O::RDWR, RDWR),
        (crate::O::CREAT, CREAT),
        (crate::O::EXCL, EXCL),
        (crate::O::TRUNC, TRUNC),
        (crate::O::APPEND, APPEND),
        (bun_o::DIRECT, DIRECT),
        (FILEMAP, FILEMAP),
    ];

    /// From a `bun_sys::O` mask.
    pub fn from_bun_o(bun_flags: i32) -> i32 {
        let mut flags = 0;
        for (bun, native) in PAIRS {
            if bun_flags & bun != 0 {
                flags |= native;
            }
        }
        // `bun_o::SYNC` contains `bun_o::DSYNC`, and Windows has one kind of write-through.
        if bun_flags & bun_o::SYNC != 0 {
            flags |= SYNC;
        }
        flags
    }

    /// To a `bun_sys::O` mask.
    pub fn to_bun_o(native_flags: i32) -> i32 {
        let mut flags = 0;
        for (bun, native) in PAIRS {
            if native_flags & native != 0 {
                flags |= bun;
            }
        }
        if native_flags & SYNC != 0 {
            flags |= bun_o::SYNC;
        } else if native_flags & DSYNC != 0 {
            flags |= bun_o::DSYNC;
        }
        flags
    }
}

/// `FILE_STAT_BASIC_INFORMATION` (`winnt.h`).
#[repr(C)]
#[derive(Clone, Copy)]
struct FileStatBasicInformation {
    FileId: i64,
    CreationTime: i64,
    LastAccessTime: i64,
    LastWriteTime: i64,
    ChangeTime: i64,
    AllocationSize: i64,
    EndOfFile: i64,
    FileAttributes: ULONG,
    ReparseTag: ULONG,
    NumberOfLinks: ULONG,
    DeviceType: ULONG,
    DeviceCharacteristics: ULONG,
    Reserved: ULONG,
    VolumeSerialNumber: i64,
    FileId128: [u8; 16],
}

/// `FILE_ID_FULL_DIR_INFORMATION` (`ntifs.h`). A network share fills in nothing unless the name fits too.
#[repr(C)]
#[derive(Clone, Copy)]
struct FileIdFullDirInformation {
    NextEntryOffset: ULONG,
    FileIndex: ULONG,
    CreationTime: i64,
    LastAccessTime: i64,
    LastWriteTime: i64,
    ChangeTime: i64,
    EndOfFile: i64,
    AllocationSize: i64,
    FileAttributes: ULONG,
    FileNameLength: ULONG,
    EaSize: ULONG,
    FileId: i64,
    FileName: [u16; 256],
}

/// `FILE_FS_FULL_SIZE_INFORMATION` (`ntifs.h`).
#[repr(C)]
#[derive(Clone, Copy)]
struct FileFsFullSizeInformation {
    TotalAllocationUnits: i64,
    CallerAvailableAllocationUnits: i64,
    ActualAvailableAllocationUnits: i64,
    SectorsPerAllocationUnit: ULONG,
    BytesPerSector: ULONG,
}

bun_core::impl_zeroable!(
    FileStatBasicInformation,
    FileIdFullDirInformation,
    FileFsFullSizeInformation
);

/// The errno Node reports for a Win32 error code.
pub fn errno(code: Win32Error) -> E {
    match code {
        Win32Error::NOACCESS => E::EFAULT,
        Win32Error::NO_DATA => E::EAGAIN,
        Win32Error::BUFFER_OVERFLOW => E::ENAMETOOLONG,
        Win32Error::DIRECTORY => E::ENOENT,
        Win32Error::BROKEN_PIPE => E::EOF,
        code => code.to_system_errno(),
    }
}

fn is_wtf8(text: &[u8]) -> bool {
    let mut at = 0;
    while at < text.len() {
        let (code_point, len) = strings::wtf8_codepoint_at(text, at);
        if len == 1 && code_point == strings::UNICODE_REPLACEMENT {
            return false;
        }
        at += len;
    }
    true
}

/// Fills `buf` with `text` in UTF-16 and a NUL. Returns the length without the NUL.
fn convert(buf: &mut WPathBuffer, text: &[u8]) -> Win32Result<usize> {
    if !strings::is_valid_utf8(text) && !is_wtf8(text) {
        return Err(Win32Error::INVALID_NAME);
    }
    let capacity = buf.0.len() - 1;
    let Some(len) = strings::try_convert_utf8_to_utf16_in_buffer(&mut buf.0[..capacity], text)
        .map(|wide| wide.len())
    else {
        return Err(Win32Error::FILENAME_EXCED_RANGE);
    };
    buf.0[len] = 0;
    Ok(len)
}

/// `MAX_PATH` less the 8.3 name that a directory has to leave room for: from here on Win32 wants the `\\?\` prefix.
const LONG_PATH: usize = 248;

/// Gives the path of `len` units in `buf` the form without a limit if it is near the limit. Returns the new length.
fn lift_max_path(buf: &mut [u16], len: usize) -> Win32Result<usize> {
    let base = match buf[..len] {
        [a, b, ..] if is_sep_any_t(a) && is_sep_any_t(b) => 0,
        [_, colon, slash, ..] if colon == u16::from(b':') && is_sep_any_t(slash) => 0,
        // SAFETY: without a buffer it only tells the length.
        _ => unsafe { GetCurrentDirectoryW(0, null_mut()) as usize },
    };
    if len + base < LONG_PATH || strings::has_prefix_comptime_utf16(&buf[..len], b"\\\\?\\") {
        return Ok(len);
    }
    // Another spelling of that prefix, which `CreateDirectoryW` for one does not know.
    if strings::has_prefix_comptime_utf16(&buf[..len], b"\\??\\") {
        buf[1] = u16::from(b'\\');
        return Ok(len);
    }
    let mut full = w_path_buffer_pool::get();
    let capacity = full.0.len();
    // SAFETY: `buf` is NUL-terminated, `full` has room for `capacity` units, and the last out-param is optional.
    let full_len = unsafe {
        GetFullPathNameW(
            buf.as_ptr(),
            capacity as DWORD,
            full.0.as_mut_ptr(),
            null_mut(),
        )
    } as usize;
    if full_len == 0 {
        return Err(Win32Error::get());
    }
    if full_len >= capacity {
        return Err(Win32Error::FILENAME_EXCED_RANGE);
    }
    let (prefix, rest): (&[u16], &[u16]) = match &full.0[..full_len] {
        // It was `//?/`.
        lifted if strings::has_prefix_comptime_utf16(lifted, b"\\\\?\\") => (&[], lifted),
        device if strings::has_prefix_comptime_utf16(device, b"\\\\.\\") => {
            (w!("\\\\?\\"), &device[4..])
        }
        unc if strings::has_prefix_comptime_utf16(unc, b"\\\\") => (w!("\\\\?\\UNC\\"), &unc[2..]),
        absolute => (w!("\\\\?\\"), absolute),
    };
    let lifted_len = prefix.len() + rest.len();
    if lifted_len >= buf.len() {
        return Err(Win32Error::FILENAME_EXCED_RANGE);
    }
    buf[..prefix.len()].copy_from_slice(prefix);
    buf[prefix.len()..lifted_len].copy_from_slice(rest);
    buf[lifted_len] = 0;
    Ok(lifted_len)
}

/// `bun_paths`' function of this name, which lifts the limit only for `C:\…`, for every kind of path.
pub fn to_kernel32_path<'a>(buf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    let len = bun_paths::string_paths::to_kernel32_path(buf, utf8).len();
    let len = lift_max_path(buf, len).unwrap_or(len);
    WStr::from_slice_with_nul(&buf[..=len])
}

/// `path` for Win32 to look up, followed by a NUL that the slice includes.
fn to_wide_mut<'a>(buf: &'a mut WPathBuffer, path: &[u8]) -> Win32Result<&'a mut [u16]> {
    let len = convert(buf, path)?;
    let len = lift_max_path(&mut buf.0, len)?;
    Ok(&mut buf.0[..=len])
}

fn to_wide<'a>(buf: &'a mut WPathBuffer, path: &ZStr) -> Win32Result<&'a WStr> {
    to_wide_mut(buf, path.as_bytes()).map(|wide| WStr::from_slice_with_nul(wide))
}

/// Writes `wide` as WTF-8 and a NUL. `None` if `out` is too small.
fn from_wide(out: &mut [u8], wide: &[u16]) -> Option<usize> {
    let mut written = 0;
    let mut rest = wide;
    while !rest.is_empty() {
        let (code_point, units) = strings::decode_wtf16_raw(rest);
        let mut encoded = [0u8; 4];
        let len = strings::encode_wtf8_rune(&mut encoded, code_point);
        out.get_mut(written..written + len)?
            .copy_from_slice(&encoded[..len]);
        written += len;
        rest = &rest[usize::from(units)..];
    }
    *out.get_mut(written)? = 0;
    Some(written)
}

struct Handle(HANDLE);

impl Handle {
    fn open(
        path: &WStr,
        access: DWORD,
        share: DWORD,
        disposition: DWORD,
        flags: DWORD,
    ) -> Win32Result<Handle> {
        // SAFETY: `path` is NUL-terminated; the security attributes and the template are optional.
        let handle = unsafe {
            CreateFileW(
                path.as_ptr(),
                access,
                share,
                null_mut(),
                disposition,
                flags,
                null_mut(),
            )
        };
        Handle::checked(handle)
    }

    fn reopen(original: HANDLE, access: DWORD, share: DWORD, flags: DWORD) -> Win32Result<Handle> {
        Handle::checked(ReOpenFile(original, access, share, flags))
    }

    fn checked(handle: HANDLE) -> Win32Result<Handle> {
        if handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::get());
        }
        Ok(Handle(handle))
    }

    fn into_raw(self) -> HANDLE {
        core::mem::ManuallyDrop::new(self).0
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: `self` owns the handle.
        unsafe { CloseHandle(self.0) };
    }
}

fn valid_handle(fd: Fd) -> Win32Result<HANDLE> {
    match fd.native() {
        INVALID_HANDLE_VALUE => Err(Win32Error::INVALID_HANDLE),
        handle => Ok(handle),
    }
}

fn set_information<T>(
    handle: HANDLE,
    class: FILE_INFORMATION_CLASS,
    info: &mut T,
) -> Win32Result<()> {
    let mut io: IO_STATUS_BLOCK = zeroed();
    // SAFETY: `info` is the structure `class` takes, and both out-params outlive the call.
    let status = unsafe {
        ntdll::NtSetInformationFile(
            handle,
            &raw mut io,
            from_mut(info).cast(),
            size_of::<T>() as ULONG,
            class,
        )
    };
    if NT_SUCCESS(status) {
        Ok(())
    } else {
        Err(Win32Error::from_ntstatus(status))
    }
}

fn query_volume_information<T>(
    handle: HANDLE,
    class: FS_INFORMATION_CLASS,
    info: &mut T,
) -> NTSTATUS {
    let mut io: IO_STATUS_BLOCK = zeroed();
    // SAFETY: `info` is the fixed part of the structure `class` fills, and both out-params outlive the call.
    unsafe {
        ntdll::NtQueryVolumeInformationFile(
            handle,
            &raw mut io,
            from_mut(info).cast(),
            size_of::<T>() as ULONG,
            class,
        )
    }
}

fn path_error(code: Win32Error, tag: Tag, path: &ZStr) -> Error {
    Error::new(errno(code), tag).with_path(path.as_bytes())
}

fn fd_error(code: Win32Error, tag: Tag, fd: Fd) -> Error {
    Error::new(errno(code), tag).with_fd(fd)
}

fn open_impl(path: &ZStr, flags: i32, mode: Mode) -> Result<Fd, E> {
    let mut buf = w_path_buffer_pool::get();
    let path = to_wide(&mut buf, path).map_err(errno)?;

    let mut access = match flags & (O::WRONLY | O::RDWR) {
        O::RDONLY => FILE_GENERIC_READ,
        O::WRONLY => FILE_GENERIC_WRITE,
        O::RDWR => FILE_GENERIC_READ | FILE_GENERIC_WRITE,
        _ => return Err(E::EINVAL),
    };
    if flags & O::APPEND != 0 {
        access &= !FILE_WRITE_DATA;
        access |= FILE_APPEND_DATA;
    }

    const CREAT_EXCL: i32 = O::CREAT | O::EXCL;
    const CREAT_TRUNC: i32 = O::CREAT | O::TRUNC;
    const TRUNC_EXCL: i32 = O::TRUNC | O::EXCL;
    const CREAT_TRUNC_EXCL: i32 = O::CREAT | O::TRUNC | O::EXCL;
    let disposition = match flags & CREAT_TRUNC_EXCL {
        O::CREAT => OPEN_ALWAYS,
        CREAT_EXCL | CREAT_TRUNC_EXCL => CREATE_NEW,
        O::TRUNC | TRUNC_EXCL => TRUNCATE_EXISTING,
        CREAT_TRUNC => CREATE_ALWAYS,
        _ => OPEN_EXISTING,
    };

    let mut attributes = FILE_ATTRIBUTE_NORMAL;
    if flags & O::CREAT != 0 && (mode & !crate::current_umask()) & S_IWRITE == 0 {
        attributes |= FILE_ATTRIBUTE_READONLY;
    }
    if flags & O::DIRECT != 0 {
        // Windows rejects unbuffered I/O on a handle with `FILE_APPEND_DATA`, which `FILE_WRITE_DATA` covers.
        if access & FILE_APPEND_DATA != 0 {
            if access & FILE_WRITE_DATA == 0 {
                return Err(E::EINVAL);
            }
            access &= !FILE_APPEND_DATA;
        }
        attributes |= FILE_FLAG_NO_BUFFERING;
    }
    if flags & O::SYNC != 0 {
        attributes |= FILE_FLAG_WRITE_THROUGH;
    }
    // Lets a directory be opened.
    attributes |= FILE_FLAG_BACKUP_SEMANTICS;
    if disposition == CREATE_NEW {
        // As POSIX.
        attributes |= FILE_FLAG_OPEN_REPARSE_POINT;
    }

    let file =
        Handle::open(path, access, FILE_SHARE_ALL, disposition, attributes).map_err(|code| {
            match code {
                // The path is a directory.
                Win32Error::FILE_EXISTS if flags & CREAT_EXCL == O::CREAT => E::EISDIR,
                code => errno(code),
            }
        })?;
    // The C runtime sets no last error for a full table. It sets one for a handle whose type the system does not tell.
    kernel32::SetLastError(0);
    match bun_core::fd::open_osfhandle(file.0) {
        -1 => Err(match Win32Error::get() {
            Win32Error::SUCCESS => E::EMFILE,
            code => errno(code),
        }),
        fd => {
            let _ = file.into_raw();
            Ok(Fd::from_crt(fd))
        }
    }
}

/// The result is a C runtime descriptor. `O::FILEMAP` is accepted and changes nothing.
pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
    let mode = if mode == 0 { 0o644 } else { mode };
    let result = open_impl(path, O::from_bun_o(flags), mode);
    syslog!(
        "open({}, {}, {}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        flags,
        mode,
        result
    );
    result.map_err(|e| Error::new(e, Tag::open).with_path(path.as_bytes()))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Direction {
    Read,
    Write,
}

thread_local! {
    static TRANSFER_EVENT: OnceCell<Handle> = const { OnceCell::new() };
}

/// Calls `transfer` with the event for the one operation that this thread has at a time.
fn with_transfer_event<R>(transfer: impl FnOnce(HANDLE) -> R) -> Win32Result<R> {
    // SAFETY: the attributes and the name are optional.
    let create = || match unsafe { kernel32::CreateEventW(null_mut(), 1, 0, null()) } {
        event if event.is_null() => Err(Win32Error::get()),
        event => Ok(Handle(event)),
    };
    let of_thread = TRANSFER_EVENT.try_with(|cell| match cell.get() {
        Some(event) => Ok(event.0),
        None => {
            let event = create()?;
            Ok(cell.get_or_init(|| event).0)
        }
    });
    match of_thread {
        Ok(event) => Ok(transfer(event?)),
        // The thread is ending and has closed its own.
        Err(_) => {
            let event = create()?;
            Ok(transfer(event.0))
        }
    }
}

/// An operation on an overlapped handle that its thread waits for in [`transfer_once`].
struct PendingTransfer {
    thread_id: DWORD,
    handle: HANDLE,
    io: *mut IO_STATUS_BLOCK,
}

// SAFETY: only the system follows the pointers, under the lock that their thread takes to remove the entry.
unsafe impl Send for PendingTransfer {}

static PENDING_TRANSFERS: Mutex<Vec<PendingTransfer>> = Mutex::new(Vec::new());

fn pending_transfers() -> MutexGuard<'static, Vec<PendingTransfer>> {
    PENDING_TRANSFERS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

/// This thread's entry in [`PENDING_TRANSFERS`].
struct PendingTransferEntry;

impl PendingTransferEntry {
    fn new(handle: HANDLE, io: *mut IO_STATUS_BLOCK) -> Self {
        pending_transfers().push(PendingTransfer {
            thread_id: kernel32::GetCurrentThreadId(),
            handle,
            io,
        });
        Self
    }
}

impl Drop for PendingTransferEntry {
    fn drop(&mut self) {
        let thread_id = kernel32::GetCurrentThreadId();
        pending_transfers().retain(|it| it.thread_id != thread_id);
    }
}

/// Ends the read or write on an overlapped handle that thread `thread_id` waits for. `ERROR_NOT_FOUND`: it waits for none.
pub(super) fn cancel_transfer(thread_id: DWORD) -> Win32Result<()> {
    let pending = pending_transfers();
    let Some(transfer) = pending.iter().find(|it| it.thread_id == thread_id) else {
        return Err(Win32Error::NOT_FOUND);
    };
    // SAFETY: `io` is valid for as long as its entry is there, and an `OVERLAPPED` starts with an `IO_STATUS_BLOCK`.
    unsafe { kernel32::CancelIoEx(transfer.handle, transfer.io.cast()) };
    Ok(())
}

/// [`transfer_once`], and again for as long as a pipe takes nothing of a write without saying why.
fn transfer(
    handle: HANDLE,
    direction: Direction,
    buf: PlatformIoVec,
    offset: Option<i64>,
) -> (usize, Option<Win32Error>) {
    loop {
        let (transferred, error) = transfer_once(handle, direction, buf, offset);
        // A pipe write that does not fit succeeds with 0 bytes in `PIPE_NOWAIT` mode, or if the reader takes a read back just then.
        let again = direction == Direction::Write
            && transferred == 0
            && error.is_none()
            && buf.iov_len != 0
            && super::pipe::make_writes_wait(handle);
        if !again {
            return (transferred, error);
        }
    }
}

/// One `NtReadFile` or `NtWriteFile` of what a `DWORD` can count (`None`: at the file position), over when this returns, and unseen by a completion port.
fn transfer_once(
    handle: HANDLE,
    direction: Direction,
    buf: PlatformIoVec,
    offset: Option<i64>,
) -> (usize, Option<Win32Error>) {
    let cell = UnsafeCell::new(zeroed::<IO_STATUS_BLOCK>());
    let io = cell.get();
    let status = with_transfer_event(|event| {
        let offset = offset.as_ref().map_or(null(), from_ref);
        let (base, len) = (buf.iov_base, buf.iov_len as u32);
        // SAFETY: an iovec names memory of its length, writable if it is read into. That, `io` and `offset`
        // outlive the operation, which is over when this function returns.
        let status = unsafe {
            match direction {
                Direction::Read => ntdll::NtReadFile(
                    handle,
                    event,
                    null_mut(),
                    null_mut(),
                    io,
                    base,
                    len,
                    offset,
                    null(),
                ),
                Direction::Write => ntdll::NtWriteFile(
                    handle,
                    event,
                    null_mut(),
                    null_mut(),
                    io,
                    base,
                    len,
                    offset,
                    null(),
                ),
            }
        };
        // The answer of an overlapped handle, such as a pipe for the event loop that `fs` is used on.
        if status != NTSTATUS::PENDING {
            return status;
        }
        let _entry = PendingTransferEntry::new(handle, io);
        // Until the event is set, `io` and the buffer are the system's to write to.
        assert_eq!(
            kernel32::WaitForSingleObject(event, INFINITE),
            WAIT_OBJECT_0
        );
        // SAFETY: the operation is over.
        NTSTATUS(unsafe { (*io).Status } as u32)
    });
    let status = match status {
        Ok(status) => status,
        Err(code) => return (0, Some(code)),
    };

    let transferred = if NT_ERROR(status) {
        0
    } else {
        // SAFETY: the operation is over.
        unsafe { (*io).Information }
    };
    let error = (!NT_SUCCESS(status)).then(|| Win32Error::from_ntstatus(status));
    (transferred, error)
}

/// One transfer per buffer, or per `DWORD`'s worth of it, until one fails. Positional I/O leaves the file position as it was.
fn for_each_buffer(
    handle: HANDLE,
    direction: Direction,
    bufs: &[PlatformIoVec],
    position: i64,
) -> Win32Result<usize> {
    let positional = position != -1;
    let mut original_position: i64 = 0;
    // SAFETY: `original_position` is a valid out-param. It fails on what has no position, such as a pipe.
    let restore_position = positional
        && unsafe { SetFilePointerEx(handle, 0, &raw mut original_position, FILE_CURRENT) } != 0;

    let mut bytes: usize = 0;
    let mut error = None;
    'buffers: for buf in bufs {
        let mut done = 0;
        loop {
            let part = PlatformIoVec {
                iov_base: buf.iov_base.wrapping_byte_add(done),
                iov_len: (buf.iov_len - done).min(u32::MAX as usize),
            };
            let offset = positional.then(|| position.wrapping_add(bytes as i64));
            let (transferred, failure) = transfer(handle, direction, part, offset);
            bytes += transferred;
            done += transferred;
            if failure.is_some() {
                error = failure;
                break 'buffers;
            }
            if transferred < part.iov_len || done == buf.iov_len {
                break;
            }
        }
    }

    if restore_position {
        // SAFETY: the new position is not asked for.
        unsafe { SetFilePointerEx(handle, original_position, null_mut(), FILE_BEGIN) };
    }
    match error {
        Some(code) if bytes == 0 => Err(code),
        _ => Ok(bytes),
    }
}

/// One read per buffer; -1 reads at the file position.
pub fn preadv(fd: Fd, bufs: &[PlatformIoVec], position: i64) -> Maybe<usize> {
    if bufs.is_empty() {
        return Ok(0);
    }
    let result = valid_handle(fd)
        .and_then(|handle| for_each_buffer(handle, Direction::Read, bufs, position));
    syslog!(
        "read({}, {} bufs, {}) = {:?}",
        fd,
        bufs.len(),
        position,
        result
    );
    match result {
        Ok(bytes) => Ok(bytes),
        Err(Win32Error::HANDLE_EOF | Win32Error::BROKEN_PIPE) => Ok(0),
        // The handle was not opened for reading.
        Err(Win32Error::ACCESS_DENIED) => Err(Error::new(E::EBADF, Tag::read).with_fd(fd)),
        Err(code) => Err(fd_error(code, Tag::read, fd)),
    }
}

fn write_buffers(fd: Fd, bufs: &[PlatformIoVec], position: i64) -> Maybe<usize> {
    if bufs.is_empty() {
        return Ok(0);
    }
    let result = valid_handle(fd)
        .and_then(|handle| for_each_buffer(handle, Direction::Write, bufs, position));
    syslog!(
        "write({}, {} bufs, {}) = {:?}",
        fd,
        bufs.len(),
        position,
        result
    );
    result.map_err(|code| {
        let e = match code {
            // The handle was not opened for writing.
            Win32Error::ACCESS_DENIED => E::EBADF,
            Win32Error::BROKEN_PIPE | Win32Error::NO_DATA => E::EPIPE,
            code => errno(code),
        };
        Error::new(e, Tag::write).with_fd(fd)
    })
}

/// One write per buffer; -1 writes at the file position.
pub fn pwritev(fd: Fd, bufs: &[PlatformIoVecConst], position: i64) -> Maybe<usize> {
    // SAFETY: the two types differ only in the mutability of `base` (layout asserted at their definition), and a write does not write to it.
    let bufs = unsafe { core::slice::from_raw_parts(bufs.as_ptr().cast(), bufs.len()) };
    write_buffers(fd, bufs, position)
}

pub fn readv(fd: Fd, bufs: &[PlatformIoVec]) -> Maybe<usize> {
    preadv(fd, bufs, -1)
}

pub fn writev(fd: Fd, bufs: &[PlatformIoVec]) -> Maybe<usize> {
    write_buffers(fd, bufs, -1)
}

pub fn pread(fd: Fd, buf: &mut [u8], position: i64) -> Maybe<usize> {
    preadv(fd, &[crate::platform_iovec_create(buf)], position)
}

pub fn pwrite(fd: Fd, buf: &[u8], position: i64) -> Maybe<usize> {
    pwritev(fd, &[crate::platform_iovec_const_create(buf)], position)
}

pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
    pread(fd, buf, -1)
}

pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
    pwrite(fd, buf, -1)
}

/// Seconds and nanoseconds since the Unix epoch.
fn filetime_to_stat_time(filetime: i64) -> (i64, i64) {
    let ticks = filetime.wrapping_sub(EPOCH_DIFFERENCE_TICKS);
    let mut sec = ticks / TICKS_PER_SEC;
    let mut nsec = (ticks % TICKS_PER_SEC) * 100;
    if nsec < 0 {
        sec -= 1;
        nsec += 1_000_000_000;
    }
    (sec, nsec)
}

const fn for_everyone(owner_bits: Mode) -> u64 {
    (owner_bits | owner_bits >> 3 | owner_bits >> 6) as u64
}

fn stat_of_nul_device() -> Stat {
    let mut stat: Stat = zeroed();
    stat.st_mode = S::IFCHR as u64 | for_everyone(S::IRUSR | S::IWUSR);
    stat.st_nlink = 1;
    stat.st_blksize = 4096;
    stat.st_rdev = u64::from(FILE_DEVICE_NULL) << 16;
    stat
}

fn stat_from_info(info: &FileStatBasicInformation, do_lstat: bool) -> Stat {
    let mut stat: Stat = zeroed();
    stat.st_dev = u64::from(info.VolumeSerialNumber as u32);
    // Only `lstat` reports a reparse point as a link.
    if do_lstat && info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        stat.st_mode = S::IFLNK as u64;
        stat.st_size = info.EndOfFile as u64;
    } else if info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
        stat.st_mode = S::IFDIR as u64;
    } else {
        stat.st_mode = S::IFREG as u64;
        stat.st_size = info.EndOfFile as u64;
    }
    stat.st_mode |= if info.FileAttributes & FILE_ATTRIBUTE_READONLY != 0 {
        for_everyone(S::IRUSR)
    } else {
        for_everyone(S::IRUSR | S::IWUSR)
    };
    (stat.st_atime, stat.st_atime_nsec) = filetime_to_stat_time(info.LastAccessTime);
    (stat.st_ctime, stat.st_ctime_nsec) = filetime_to_stat_time(info.ChangeTime);
    (stat.st_mtime, stat.st_mtime_nsec) = filetime_to_stat_time(info.LastWriteTime);
    (stat.st_birthtime, stat.st_birthtime_nsec) = filetime_to_stat_time(info.CreationTime);
    stat.st_ino = info.FileId as u64;
    stat.st_blocks = (info.AllocationSize as u64) >> 9;
    stat.st_nlink = u64::from(info.NumberOfLinks);
    stat.st_blksize = 4096;
    stat
}

/// The volume's serial number, which is 0 for a file system that has none.
fn volume_serial_number(handle: HANDLE) -> Win32Result<i64> {
    let mut volume_info: FILE_FS_VOLUME_INFORMATION = zeroed();
    let status = query_volume_information(
        handle,
        FS_INFORMATION_CLASS::FileFsVolumeInformation,
        &mut volume_info,
    );
    if status == NTSTATUS::NOT_IMPLEMENTED {
        return Ok(0);
    }
    // The label does not fit, which is a warning.
    if NT_ERROR(status) {
        return Err(Win32Error::from_ntstatus(status));
    }
    Ok(i64::from(volume_info.VolumeSerialNumber))
}

fn device_type(handle: HANDLE) -> Win32Result<ULONG> {
    let mut device_info: FILE_FS_DEVICE_INFORMATION = zeroed();
    let status = query_volume_information(
        handle,
        FS_INFORMATION_CLASS::FileFsDeviceInformation,
        &mut device_info,
    );
    if NT_ERROR(status) {
        return Err(Win32Error::from_ntstatus(status));
    }
    Ok(device_info.DeviceType)
}

fn stat_handle(handle: HANDLE, do_lstat: bool) -> Win32Result<Stat> {
    let mut info: FileStatBasicInformation = zeroed();
    info.DeviceType = device_type(handle)?;
    if info.DeviceType == FILE_DEVICE_NULL {
        return Ok(stat_of_nul_device());
    }

    let mut io: IO_STATUS_BLOCK = zeroed();
    let mut file_info: FILE_ALL_INFORMATION = zeroed();
    // SAFETY: both out-params outlive the call.
    let status = unsafe {
        ntdll::NtQueryInformationFile(
            handle,
            &raw mut io,
            from_mut(&mut file_info).cast(),
            size_of::<FILE_ALL_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileAllInformation,
        )
    };
    // The name does not fit, which is a warning.
    if NT_ERROR(status) {
        return Err(Win32Error::from_ntstatus(status));
    }

    info.VolumeSerialNumber = volume_serial_number(handle)?;
    info.FileAttributes = file_info.BasicInformation.FileAttributes;
    info.NumberOfLinks = file_info.StandardInformation.NumberOfLinks;
    info.FileId = file_info.InternalInformation.IndexNumber;
    info.ChangeTime = file_info.BasicInformation.ChangeTime;
    info.CreationTime = file_info.BasicInformation.CreationTime;
    info.LastAccessTime = file_info.BasicInformation.LastAccessTime;
    info.LastWriteTime = file_info.BasicInformation.LastWriteTime;
    info.AllocationSize = file_info.StandardInformation.AllocationSize;
    info.EndOfFile = if do_lstat && info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        let mut buf = w_path_buffer_pool::get();
        strings::element_length_utf16_into_utf8(readlink_handle(handle, &mut buf)?) as i64
    } else {
        file_info.StandardInformation.EndOfFile
    };
    Ok(stat_from_info(&info, do_lstat))
}

type GetFileInformationByName =
    unsafe extern "system" fn(LPCWSTR, class: u32, info: *mut c_void, size: ULONG) -> BOOL;

/// Windows 11 24H2 and later.
fn get_file_information_by_name() -> Option<GetFileInformationByName> {
    static FUNCTION: OnceLock<Option<GetFileInformationByName>> = OnceLock::new();
    *FUNCTION.get_or_init(|| {
        // SAFETY: the name is NUL-terminated.
        let module =
            unsafe { kernel32::GetModuleHandleW(w!("api-ms-win-core-file-l2-1-4.dll\0").as_ptr()) };
        if module.is_null() {
            return None;
        }
        let name = ZStr::from_static(b"GetFileInformationByName\0");
        let function = super::GetProcAddressA(Some(module.cast()), name)?;
        // SAFETY: this is the signature of the export of that name.
        Some(unsafe { core::mem::transmute::<*mut c_void, GetFileInformationByName>(function) })
    })
}

/// `stat` in one system call that opens nothing. `None` if it takes a handle to tell.
fn stat_by_name(path: &WStr, do_lstat: bool) -> Option<Win32Result<Stat>> {
    let by_name = get_file_information_by_name()?;
    let mut info: FileStatBasicInformation = zeroed();
    // SAFETY: `path` is NUL-terminated, and `info` is the structure of this class.
    let ok = unsafe {
        by_name(
            path.as_ptr(),
            FILE_STAT_BASIC_BY_NAME_INFO,
            from_mut(&mut info).cast(),
            size_of::<FileStatBasicInformation>() as ULONG,
        )
    };
    if ok == 0 {
        return match Win32Error::get() {
            code @ (Win32Error::FILE_NOT_FOUND
            | Win32Error::PATH_NOT_FOUND
            | Win32Error::NOT_READY
            | Win32Error::BAD_NET_NAME) => Some(Err(code)),
            _ => None,
        };
    }
    if info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return None;
    }
    if info.DeviceType == FILE_DEVICE_NULL {
        return Some(Ok(stat_of_nul_device()));
    }
    Some(Ok(stat_from_info(&info, do_lstat)))
}

/// What the directory `dir` has on its entry `name`. `open_error` is why `name` could not be opened.
fn stat_directory_entry(
    dir: &WStr,
    name: &[u16],
    do_lstat: bool,
    open_error: Win32Error,
) -> Win32Result<Stat> {
    // As a pattern these would match other names.
    if strings::index_of_any16(name, w!("*?><\"")).is_some() {
        return Err(Win32Error::INVALID_NAME);
    }
    let dir = Handle::open(
        dir,
        FILE_LIST_DIRECTORY,
        FILE_SHARE_ALL,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
    )?;

    let mut pattern = UNICODE_STRING {
        Length: (name.len() * 2) as u16,
        MaximumLength: (name.len() * 2) as u16,
        Buffer: name.as_ptr().cast_mut(),
    };
    let mut io: IO_STATUS_BLOCK = zeroed();
    let mut dir_info: FileIdFullDirInformation = zeroed();
    // SAFETY: the out-params and `pattern`, which is only read, outlive the call.
    let status = unsafe {
        ntdll::NtQueryDirectoryFile(
            dir.0,
            null_mut(),
            null_mut(),
            null_mut(),
            &raw mut io,
            from_mut(&mut dir_info).cast(),
            size_of::<FileIdFullDirInformation>() as ULONG,
            FILE_INFORMATION_CLASS::FileIdFullDirectoryInformation,
            1,
            &raw mut pattern,
            1,
        )
    };
    if !NT_SUCCESS(status) {
        return Err(match status {
            NTSTATUS::NO_MORE_FILES => Win32Error::PATH_NOT_FOUND,
            status => Win32Error::from_ntstatus(status),
        });
    }

    let mut info: FileStatBasicInformation = zeroed();
    info.FileAttributes = dir_info.FileAttributes;
    info.CreationTime = dir_info.CreationTime;
    info.LastAccessTime = dir_info.LastAccessTime;
    info.LastWriteTime = dir_info.LastWriteTime;
    info.ChangeTime = dir_info.ChangeTime;
    info.FileId = dir_info.FileId;
    if info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        // Neither the link's target nor its length can be read without a handle.
        if !do_lstat {
            return Err(open_error);
        }
    } else {
        info.EndOfFile = dir_info.EndOfFile;
        info.AllocationSize = dir_info.AllocationSize;
    }
    info.VolumeSerialNumber = volume_serial_number(dir.0)?;
    info.NumberOfLinks = 1;
    Ok(stat_from_info(&info, do_lstat))
}

/// `stat` of a file that cannot be opened, from its parent directory. `path` includes its NUL.
fn stat_directory(path: &mut [u16], do_lstat: bool, open_error: Win32Error) -> Win32Result<Stat> {
    let len = path.len() - 1;
    let mut split = len;
    let mut includes_name = false;
    while split > 0 && !is_sep_any_t(path[split - 1]) && path[split - 1] != u16::from(b':') {
        includes_name |= path[split - 1] != u16::from(b'.');
        split -= 1;
    }

    if split == 0 && includes_name {
        let dir = WStr::from_slice_with_nul(w!(".\0"));
        return stat_directory_entry(dir, &path[..len], do_lstat, open_error);
    }
    if split == 0 || path[split - 1] == u16::from(b':') || !includes_name {
        let dir = WStr::from_slice_with_nul(path);
        return stat_directory_entry(dir, &[], do_lstat, open_error);
    }
    // `\name`, `X:\name` and `\\?\X:\name`: without its separator the root is something else.
    if split == 1 || ((3..=7).contains(&split) && path[split - 2] == u16::from(b':')) {
        let mut root = [0u16; 8];
        root[..split].copy_from_slice(&path[..split]);
        let dir = WStr::from_slice_with_nul(&root[..=split]);
        return stat_directory_entry(dir, &path[split..len], do_lstat, open_error);
    }
    let separator = core::mem::replace(&mut path[split - 1], 0);
    let (dir, name) = path[..len].split_at(split);
    let result = stat_directory_entry(WStr::from_slice_with_nul(dir), name, do_lstat, open_error);
    path[split - 1] = separator;
    result
}

/// `path` includes its NUL.
fn stat_from_path(path: &mut [u16], do_lstat: bool) -> Win32Result<Stat> {
    if let Some(result) = stat_by_name(WStr::from_slice_with_nul(path), do_lstat) {
        return result;
    }
    let mut flags = FILE_FLAG_BACKUP_SEMANTICS;
    if do_lstat {
        flags |= FILE_FLAG_OPEN_REPARSE_POINT;
    }
    match Handle::open(
        WStr::from_slice_with_nul(path),
        FILE_READ_ATTRIBUTES,
        FILE_SHARE_ALL,
        OPEN_EXISTING,
        flags,
    ) {
        Ok(handle) => stat_handle(handle.0, do_lstat),
        Err(code @ (Win32Error::ACCESS_DENIED | Win32Error::SHARING_VIOLATION)) => {
            stat_directory(path, do_lstat, code)
        }
        Err(code) => Err(code),
    }
}

/// A reparse point that is not a link is what it stands for.
fn is_not_a_link(code: Win32Error) -> bool {
    matches!(
        code,
        Win32Error::SYMLINK_NOT_SUPPORTED | Win32Error::NOT_A_REPARSE_POINT
    )
}

fn stat_impl(path: &ZStr, do_lstat: bool) -> Win32Result<Stat> {
    let mut buf = w_path_buffer_pool::get();
    let path = match path.as_bytes() {
        [rest @ .., b'\\' | b'/'] if rest.last().is_some_and(|&before| before != b':') => rest,
        path => path,
    };
    let path = to_wide_mut(&mut buf, path)?;
    match stat_from_path(path, do_lstat) {
        Err(code) if do_lstat && is_not_a_link(code) => stat_from_path(path, false),
        result => result,
    }
}

pub fn stat(path: &ZStr) -> Maybe<Stat> {
    let result = stat_impl(path, false);
    syslog!(
        "stat({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().err()
    );
    result.map_err(|code| path_error(code, Tag::stat, path))
}

pub fn lstat(path: &ZStr) -> Maybe<Stat> {
    let result = stat_impl(path, true);
    syslog!(
        "lstat({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().err()
    );
    result.map_err(|code| path_error(code, Tag::lstat, path))
}

fn fstat_impl(fd: Fd) -> Win32Result<Stat> {
    let handle = valid_handle(fd)?;
    let (mode, device) = match super::GetFileType(handle) {
        FILE_TYPE_DISK => return stat_handle(handle, false),
        FILE_TYPE_PIPE => (S::IFIFO, FILE_DEVICE_NAMED_PIPE),
        FILE_TYPE_CHAR => {
            let mut console_mode: DWORD = 0;
            // SAFETY: `console_mode` is a valid out-param.
            if unsafe { kernel32::GetConsoleMode(handle, &raw mut console_mode) } == 0 {
                return stat_handle(handle, false);
            }
            (S::IFCHR, FILE_DEVICE_CONSOLE)
        }
        _ => return Err(Win32Error::INVALID_HANDLE),
    };
    let mut stat: Stat = zeroed();
    stat.st_mode = mode as u64;
    stat.st_nlink = 1;
    stat.st_rdev = u64::from(device) << 16;
    stat.st_ino = handle as usize as u64;
    Ok(stat)
}

pub fn fstat(fd: Fd) -> Maybe<Stat> {
    let result = fstat_impl(fd);
    syslog!("fstat({}) = {:?}", fd, result.as_ref().err());
    result.map_err(|code| fd_error(code, Tag::fstat, fd))
}

fn unlink_or_rmdir(path: &ZStr, is_rmdir: bool) -> Win32Result<()> {
    let mut buf = w_path_buffer_pool::get();
    let handle = Handle::open(
        to_wide(&mut buf, path)?,
        FILE_READ_ATTRIBUTES | DELETE,
        FILE_SHARE_ALL,
        OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
    )?;

    let mut info: BY_HANDLE_FILE_INFORMATION = zeroed();
    // SAFETY: `info` is a valid out-param.
    if unsafe { GetFileInformationByHandle(handle.0, &raw mut info) } == 0 {
        return Err(Win32Error::get());
    }
    let is_directory = info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    if is_rmdir && !is_directory {
        return Err(Win32Error::DIRECTORY);
    }
    // `unlink` removes a directory only if it is a link.
    if !is_rmdir && is_directory {
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
            return Err(Win32Error::ACCESS_DENIED);
        }
        readlink_handle(handle.0, &mut buf).map_err(|code| match code {
            Win32Error::SYMLINK_NOT_SUPPORTED => Win32Error::ACCESS_DENIED,
            code => code,
        })?;
    }

    let mut disposition_ex = FILE_DISPOSITION_INFORMATION_EX {
        Flags: FILE_DISPOSITION_DELETE
            | FILE_DISPOSITION_POSIX_SEMANTICS
            | FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };
    match set_information(
        handle.0,
        FILE_INFORMATION_CLASS::FileDispositionInformationEx,
        &mut disposition_ex,
    ) {
        // The file system or the Windows version has no POSIX delete.
        Err(
            Win32Error::NOT_SUPPORTED
            | Win32Error::INVALID_PARAMETER
            | Win32Error::INVALID_FUNCTION,
        ) => {}
        result => return result,
    }

    if info.dwFileAttributes & FILE_ATTRIBUTE_READONLY != 0 {
        let mut basic: FILE_BASIC_INFORMATION = zeroed();
        basic.FileAttributes =
            (info.dwFileAttributes & !FILE_ATTRIBUTE_READONLY) | FILE_ATTRIBUTE_ARCHIVE;
        let writable = Handle::reopen(
            handle.0,
            FILE_WRITE_ATTRIBUTES,
            FILE_SHARE_ALL,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
        )?;
        set_information(
            writable.0,
            FILE_INFORMATION_CLASS::FileBasicInformation,
            &mut basic,
        )?;
    }
    let mut disposition = FILE_DISPOSITION_INFORMATION { DeleteFile: 1 };
    set_information(
        handle.0,
        FILE_INFORMATION_CLASS::FileDispositionInformation,
        &mut disposition,
    )
}

pub fn unlink(path: &ZStr) -> Maybe<()> {
    let result = unlink_or_rmdir(path, false);
    syslog!(
        "unlink({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result
    );
    result.map_err(|code| path_error(code, Tag::unlink, path))
}

/// `fs.rmdir`: ENOENT for what is not a directory.
pub fn rmdir(path: &ZStr) -> Maybe<()> {
    let result = unlink_or_rmdir(path, true);
    syslog!("rmdir({}) = {:?}", bstr::BStr::new(path.as_bytes()), result);
    result.map_err(|code| path_error(code, Tag::rmdir, path))
}

fn create_directory(path: &WStr) -> Win32Result<()> {
    // SAFETY: `path` is NUL-terminated; the security attributes are optional.
    if unsafe { CreateDirectoryW(path.as_ptr(), null_mut()) } == 0 {
        return Err(Win32Error::get());
    }
    Ok(())
}

pub fn mkdir(path: &ZStr, _mode: Mode) -> Maybe<()> {
    let mut buf = w_path_buffer_pool::get();
    let result = to_wide(&mut buf, path).map_err(errno).and_then(|path| {
        create_directory(path).map_err(|code| match code {
            Win32Error::INVALID_NAME | Win32Error::DIRECTORY => E::EINVAL,
            code => errno(code),
        })
    });
    syslog!("mkdir({}) = {:?}", bstr::BStr::new(path.as_bytes()), result);
    result.map_err(|e| Error::new(e, Tag::mkdir).with_path(path.as_bytes()))
}

fn mkdtemp_impl(template: &mut [u8]) -> Result<(), E> {
    const CHARS: &[u8; 62] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const TMP_MAX: u32 = i32::MAX as u32;
    let mut buf = w_path_buffer_pool::get();
    let path = to_wide_mut(&mut buf, template).map_err(errno)?;
    let Some(suffix_at) = (path.len() - 1).checked_sub(6) else {
        return Err(E::EINVAL);
    };
    if !strings::eql_comptime_utf16(&path[suffix_at..suffix_at + 6], b"XXXXXX") {
        return Err(E::EINVAL);
    }

    for _ in 0..TMP_MAX {
        let mut random: u64 = 0;
        // SAFETY: `random` is 8 writable bytes.
        if unsafe { RtlGenRandom(from_mut(&mut random).cast(), 8) } == 0 {
            return Err(E::EIO);
        }
        let mut suffix = [0u8; 6];
        for (char, unit) in suffix.iter_mut().zip(&mut path[suffix_at..]) {
            *char = CHARS[(random % 62) as usize];
            *unit = u16::from(*char);
            random /= 62;
        }
        match create_directory(WStr::from_slice_with_nul(path)) {
            Ok(()) => {
                let len = template.len();
                template[len - 6..].copy_from_slice(&suffix);
                return Ok(());
            }
            Err(Win32Error::ALREADY_EXISTS) => {}
            Err(code) => return Err(errno(code)),
        }
    }
    Err(E::EEXIST)
}

/// Creates a directory named `template` with its trailing `XXXXXX` replaced, in place, by random characters.
pub fn mkdtemp(template: &mut [u8]) -> Maybe<()> {
    let result = mkdtemp_impl(template);
    syslog!("mkdtemp({}) = {:?}", bstr::BStr::new(template), result);
    result.map_err(|e| Error::new(e, Tag::mkdtemp).with_path(template))
}

pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let mut from_buf = w_path_buffer_pool::get();
    let mut to_buf = w_path_buffer_pool::get();
    let result = to_wide(&mut from_buf, from).and_then(|from| {
        let to = to_wide(&mut to_buf, to)?;
        // SAFETY: both paths are NUL-terminated.
        if unsafe { kernel32::MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_REPLACE_EXISTING) }
            == 0
        {
            return Err(Win32Error::get());
        }
        Ok(())
    });
    syslog!(
        "rename({}, {}) = {:?}",
        bstr::BStr::new(from.as_bytes()),
        bstr::BStr::new(to.as_bytes()),
        result
    );
    result.map_err(|code| Error::new(errno(code), Tag::rename))
}

pub fn link(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let mut from_buf = w_path_buffer_pool::get();
    let mut to_buf = w_path_buffer_pool::get();
    let result = to_wide(&mut from_buf, from).and_then(|from| {
        let to = to_wide(&mut to_buf, to)?;
        if super::CreateHardLinkW(to.as_ptr(), from.as_ptr(), None) == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    });
    syslog!(
        "link({}, {}) = {:?}",
        bstr::BStr::new(from.as_bytes()),
        bstr::BStr::new(to.as_bytes()),
        result
    );
    result.map_err(|code| {
        Error::new(errno(code), Tag::link).with_path_dest(from.as_bytes(), to.as_bytes())
    })
}

fn is_same_file(a: &ZStr, b: &ZStr) -> bool {
    matches!(
        (stat_impl(a, false), stat_impl(b, false)),
        (Ok(a), Ok(b)) if a.st_dev == b.st_dev && a.st_ino == b.st_ino
    )
}

/// Replaces `to`. Copying a file onto itself succeeds.
pub fn copyfile(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let mut from_buf = w_path_buffer_pool::get();
    let mut to_buf = w_path_buffer_pool::get();
    let result = to_wide(&mut from_buf, from).and_then(|wide_from| {
        let wide_to = to_wide(&mut to_buf, to)?;
        // SAFETY: both paths are NUL-terminated.
        if unsafe { super::CopyFileW(wide_from.as_ptr(), wide_to.as_ptr(), 0) } != 0 {
            return Ok(());
        }
        match Win32Error::get() {
            code if errno(code) == E::EBUSY && is_same_file(from, to) => Ok(()),
            code => Err(code),
        }
    });
    syslog!(
        "copyfile({}, {}) = {:?}",
        bstr::BStr::new(from.as_bytes()),
        bstr::BStr::new(to.as_bytes()),
        result
    );
    result.map_err(|code| Error::new(errno(code), Tag::copyfile))
}

/// `CreateSymbolicLinkW` without the need for a privilege, where Windows has that.
pub(crate) fn create_symbolic_link(link: &WStr, target: &WStr, directory: bool) -> Win32Result<()> {
    static UNPRIVILEGED_FLAG: AtomicU32 =
        AtomicU32::new(SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE);
    loop {
        let unprivileged = UNPRIVILEGED_FLAG.load(Ordering::Relaxed);
        let flags = unprivileged
            | if directory {
                SYMBOLIC_LINK_FLAG_DIRECTORY
            } else {
                0
            };
        // SAFETY: both paths are NUL-terminated.
        if unsafe { CreateSymbolicLinkW(link.as_ptr(), target.as_ptr(), flags) } != 0 {
            return Ok(());
        }
        match Win32Error::get() {
            // This Windows does not know the flag.
            Win32Error::INVALID_PARAMETER if unprivileged != 0 => {
                UNPRIVILEGED_FLAG.store(0, Ordering::Relaxed);
            }
            code => return Err(code),
        }
    }
}

/// Appends `path` with each run of separators as one backslash. Whether it ended in one, which is left out.
fn push_with_single_backslashes(out: &mut Vec<u16>, path: &[u16]) -> bool {
    let mut add_slash = false;
    for &unit in path {
        if is_sep_any_t(unit) {
            add_slash = true;
            continue;
        }
        if add_slash {
            out.push(u16::from(b'\\'));
            add_slash = false;
        }
        out.push(unit);
    }
    add_slash
}

fn create_junction(target: &WStr, link: &WStr) -> Result<(), E> {
    // In units of `u16`: `REPARSE_DATA_BUFFER` up to its union, then up to `MountPointReparseBuffer.PathBuffer`.
    const HEADER: usize = 4;
    const PATH_BUFFER: usize = 8;
    let target = match target.as_slice() {
        long if strings::has_prefix_comptime_utf16(long, b"\\\\?\\") => &long[4..],
        absolute @ [letter, colon, slash, ..]
            if is_drive_letter_t(*letter) && *colon == u16::from(b':') && is_sep_any_t(*slash) =>
        {
            absolute
        }
        _ => return Err(E::EINVAL),
    };

    let mut buffer: Vec<u16> = Vec::with_capacity(PATH_BUFFER + 4 + 2 * (target.len() + 2));
    buffer.resize(PATH_BUFFER, 0);
    buffer.extend_from_slice(w!("\\??\\"));
    if push_with_single_backslashes(&mut buffer, target) {
        buffer.push(u16::from(b'\\'));
    }
    let substitute_name_len = buffer.len() - PATH_BUFFER;
    buffer.push(0);

    let print_name_at = buffer.len();
    if push_with_single_backslashes(&mut buffer, target) || buffer.len() - print_name_at == 2 {
        buffer.push(u16::from(b'\\'));
    }
    let print_name_len = buffer.len() - print_name_at;
    buffer.push(0);

    buffer[0] = IO_REPARSE_TAG_MOUNT_POINT as u16;
    buffer[1] = (IO_REPARSE_TAG_MOUNT_POINT >> 16) as u16;
    buffer[2] = ((buffer.len() - HEADER) * 2) as u16;
    buffer[4] = 0;
    buffer[5] = (substitute_name_len * 2) as u16;
    buffer[6] = ((print_name_at - PATH_BUFFER) * 2) as u16;
    buffer[7] = (print_name_len * 2) as u16;

    create_directory(link).map_err(errno)?;
    let result = Handle::open(
        link,
        GENERIC_WRITE,
        FILE_SHARE_ALL,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
    )
    .and_then(|handle| {
        let mut returned: DWORD = 0;
        // SAFETY: the input is `buffer`, there is no output, and `returned` is a valid out-param.
        let ok = unsafe {
            kernel32::DeviceIoControl(
                handle.0,
                FSCTL_SET_REPARSE_POINT,
                buffer.as_mut_ptr().cast(),
                (buffer.len() * 2) as DWORD,
                null_mut(),
                0,
                &raw mut returned,
                null_mut(),
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    });
    if result.is_err() {
        // SAFETY: `link` is NUL-terminated.
        unsafe { RemoveDirectoryW(link.as_ptr()) };
    }
    result.map_err(errno)
}

/// A junction's `target` has to be absolute.
pub fn symlink_as(target: &ZStr, link: &ZStr, kind: SymlinkKind) -> Maybe<()> {
    let mut target_buf = w_path_buffer_pool::get();
    let mut link_buf = w_path_buffer_pool::get();
    let result = convert(&mut target_buf, target.as_bytes())
        .map_err(errno)
        .and_then(|len| {
            let target = WStr::from_slice_with_nul(&target_buf.0[..=len]);
            let link = to_wide(&mut link_buf, link).map_err(errno)?;
            match kind {
                SymlinkKind::Junction => create_junction(target, link),
                kind => create_symbolic_link(link, target, kind == SymlinkKind::Dir).map_err(errno),
            }
        });
    syslog!(
        "symlink({}, {}, {:?}) = {:?}",
        bstr::BStr::new(target.as_bytes()),
        bstr::BStr::new(link.as_bytes()),
        kind,
        result
    );
    result.map_err(|e| Error::new(e, Tag::symlink))
}

pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
    symlink_as(target, link, SymlinkKind::File)
}

fn starts_with_nt_drive(path: &[u16]) -> bool {
    strings::has_prefix_comptime_utf16(path, b"\\??\\")
        && path.len() >= 6
        && is_drive_letter_t(path[4])
        && path[5] == u16::from(b':')
        && (path.len() == 6 || path[6] == u16::from(b'\\'))
}

/// The target of the link `handle` is open on: symbolic link, WSL link, junction to a drive or app execution alias.
fn readlink_handle(handle: HANDLE, buf: &mut WPathBuffer) -> Win32Result<&[u16]> {
    let mut returned: DWORD = 0;
    // SAFETY: the output is the start of `buf`, which is larger, and `returned` is a valid out-param.
    let ok = unsafe {
        kernel32::DeviceIoControl(
            handle,
            FSCTL_GET_REPARSE_POINT,
            null_mut(),
            0,
            buf.0.as_mut_ptr().cast(),
            MAXIMUM_REPARSE_DATA_BUFFER_SIZE as DWORD,
            &raw mut returned,
            null_mut(),
        )
    };
    if ok == 0 {
        return Err(Win32Error::get());
    }
    let returned = returned as usize;
    let (data, spare) = buf.0.split_at_mut(MAXIMUM_REPARSE_DATA_BUFFER_SIZE / 2);
    let not_a_link = Win32Error::SYMLINK_NOT_SUPPORTED;
    // `REPARSE_DATA_BUFFER` in units of `u16`.
    let &[tag_low, tag_high, data_length, _, ..] = &data[..returned / 2] else {
        return Err(not_a_link);
    };
    let tag = u32::from(tag_low) | u32::from(tag_high) << 16;
    if tag == IO_REPARSE_TAG_LX_SYMLINK {
        // The data is a version and the target in UTF-8.
        let end = returned.min(8 + usize::from(data_length));
        let target = bun_core::cast_slice::<u16, u8>(data).get(12..end);
        return target
            .and_then(|target| strings::try_convert_utf8_to_utf16_in_buffer(spare, target))
            .map(|target| &*target)
            .ok_or(not_a_link);
    }
    let data = &mut data[..returned / 2];
    // `SubstituteNameOffset` and `SubstituteNameLength` are in bytes, from `PathBuffer`.
    let substitute_name = |data: &[u16], path_buffer: usize| {
        let start = path_buffer + usize::from(*data.get(4)?) / 2;
        Some(start..start + usize::from(*data.get(5)?) / 2)
    };
    match tag {
        IO_REPARSE_TAG_SYMLINK => {
            let range = substitute_name(data, 10).ok_or(not_a_link)?;
            let target = data.get_mut(range).ok_or(not_a_link)?;
            // Undoes what `CreateSymbolicLinkW` does to an absolute target.
            if starts_with_nt_drive(target) {
                return Ok(&target[4..]);
            }
            if target.len() >= 8 && strings::eql_case_insensitive_t(&target[..8], b"\\??\\UNC\\") {
                target[6] = u16::from(b'\\');
                return Ok(&target[6..]);
            }
            Ok(target)
        }
        IO_REPARSE_TAG_MOUNT_POINT => {
            let range = substitute_name(data, 8).ok_or(not_a_link)?;
            let target = data.get(range).ok_or(not_a_link)?;
            // A junction to `\??\Volume{guid}` is a mount point, and no path a program can use.
            if !starts_with_nt_drive(target) {
                return Err(not_a_link);
            }
            Ok(&target[4..])
        }
        IO_REPARSE_TAG_APPEXECLINK => {
            let &[_, _, _, _, count_low, count_high, ref list @ ..] = &*data else {
                return Err(not_a_link);
            };
            if u32::from(count_low) | u32::from(count_high) << 16 < 3 {
                return Err(not_a_link);
            }
            // The third of the NUL-terminated strings is the executable. An empty one ends the list.
            let mut list = list;
            let mut target: &[u16] = &[];
            for _ in 0..3 {
                let len = strings::index_of_any16(list, w!("\0")).ok_or(not_a_link)?;
                (target, list) = (&list[..len], &list[len + 1..]);
                if target.is_empty() {
                    return Err(not_a_link);
                }
            }
            match target {
                [letter, colon, backslash, ..]
                    if is_drive_letter_t(*letter)
                        && *colon == u16::from(b':')
                        && *backslash == u16::from(b'\\') =>
                {
                    Ok(target)
                }
                _ => Err(not_a_link),
            }
        }
        _ => Err(not_a_link),
    }
}

/// Writes the target and a NUL to `out`, and returns the target's length.
pub fn readlink(path: &ZStr, out: &mut [u8]) -> Maybe<usize> {
    let mut buf = w_path_buffer_pool::get();
    let result = to_wide(&mut buf, path)
        .and_then(|path| {
            Handle::open(
                path,
                0,
                0,
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            )
        })
        .and_then(|handle| {
            let target = readlink_handle(handle.0, &mut buf)?;
            // Node.js reads libuv's answer as a C string.
            let len = strings::index_of_any16(target, w!("\0")).unwrap_or(target.len());
            from_wide(out, &target[..len]).ok_or(Win32Error::FILENAME_EXCED_RANGE)
        });
    syslog!(
        "readlink({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result
    );
    result.map_err(|code| match code {
        Win32Error::NOT_A_REPARSE_POINT => {
            Error::new(E::EINVAL, Tag::readlink).with_path(path.as_bytes())
        }
        code => path_error(code, Tag::readlink, path),
    })
}

fn realpath_impl(path: &ZStr, out: &mut [u8]) -> Win32Result<usize> {
    let mut buf = w_path_buffer_pool::get();
    let handle = Handle::open(
        to_wide(&mut buf, path)?,
        0,
        0,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS,
    )?;
    // SAFETY: `buf` is writable for the length passed.
    let len = unsafe {
        super::GetFinalPathNameByHandleW(
            handle.0,
            buf.0.as_mut_ptr(),
            buf.0.len() as DWORD,
            VOLUME_NAME_DOS,
        )
    } as usize;
    if len == 0 {
        return Err(Win32Error::get());
    }
    let Some(real) = buf.0.get_mut(..len) else {
        return Err(Win32Error::FILENAME_EXCED_RANGE);
    };
    let real = if strings::has_prefix_comptime_utf16(real, b"\\\\?\\UNC\\") {
        real[6] = u16::from(b'\\');
        &real[6..]
    } else if strings::has_prefix_comptime_utf16(real, b"\\\\?\\") {
        &real[4..]
    } else {
        return Err(Win32Error::INVALID_HANDLE);
    };
    from_wide(out, real).ok_or(Win32Error::FILENAME_EXCED_RANGE)
}

pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Maybe<&'a [u8]> {
    let result = realpath_impl(path, &mut buf.0);
    syslog!(
        "realpath({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result
    );
    match result {
        Ok(len) => Ok(&buf.0[..len]),
        Err(code) => Err(path_error(code, Tag::realpath, path)),
    }
}

pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> {
    let mut buf = w_path_buffer_pool::get();
    let result = to_wide(&mut buf, path).and_then(|path| {
        let mut data: WIN32_FILE_ATTRIBUTE_DATA = zeroed();
        // SAFETY: `path` is NUL-terminated, and `data` is what level 0 (`GetFileExInfoStandard`) fills.
        if unsafe { GetFileAttributesExW(path.as_ptr(), 0, from_mut(&mut data).cast()) } == 0 {
            return Err(Win32Error::get());
        }
        let attributes = if mode & S_IWRITE != 0 {
            data.dwFileAttributes & !FILE_ATTRIBUTE_READONLY
        } else {
            data.dwFileAttributes | FILE_ATTRIBUTE_READONLY
        };
        // SAFETY: `path` is NUL-terminated.
        if unsafe { SetFileAttributesW(path.as_ptr(), attributes) } == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    });
    syslog!(
        "chmod({}, {}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        mode,
        result
    );
    result.map_err(|code| path_error(code, Tag::chmod, path))
}

fn fchmod_impl(fd: Fd, mode: Mode) -> Win32Result<()> {
    let handle = Handle::reopen(fd.native(), FILE_WRITE_ATTRIBUTES, 0, 0)?;
    let mut io: IO_STATUS_BLOCK = zeroed();
    let mut info: FILE_BASIC_INFORMATION = zeroed();
    // SAFETY: both out-params outlive the call.
    let status = unsafe {
        ntdll::NtQueryInformationFile(
            handle.0,
            &raw mut io,
            from_mut(&mut info).cast(),
            size_of::<FILE_BASIC_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileBasicInformation,
        )
    };
    if !NT_SUCCESS(status) {
        return Err(Win32Error::from_ntstatus(status));
    }

    // Attributes of 0 mean "no change", so a lone read-only attribute can only go while another one is set.
    let clear_archive = info.FileAttributes & FILE_ATTRIBUTE_ARCHIVE == 0;
    if clear_archive {
        info.FileAttributes |= FILE_ATTRIBUTE_ARCHIVE;
        set_information(
            handle.0,
            FILE_INFORMATION_CLASS::FileBasicInformation,
            &mut info,
        )?;
    }
    if mode & S_IWRITE != 0 {
        info.FileAttributes &= !FILE_ATTRIBUTE_READONLY;
    } else {
        info.FileAttributes |= FILE_ATTRIBUTE_READONLY;
    }
    set_information(
        handle.0,
        FILE_INFORMATION_CLASS::FileBasicInformation,
        &mut info,
    )?;
    if clear_archive {
        info.FileAttributes &= !FILE_ATTRIBUTE_ARCHIVE;
        if info.FileAttributes == 0 {
            info.FileAttributes = FILE_ATTRIBUTE_NORMAL;
        }
        set_information(
            handle.0,
            FILE_INFORMATION_CLASS::FileBasicInformation,
            &mut info,
        )?;
    }
    Ok(())
}

pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
    let result = fchmod_impl(fd, mode);
    syslog!("fchmod({}, {}) = {:?}", fd, mode, result);
    result.map_err(|code| fd_error(code, Tag::fchmod, fd))
}

fn chown_impl(path: &ZStr, tag: Tag) -> Maybe<()> {
    let mut buf = w_path_buffer_pool::get();
    match to_wide(&mut buf, path) {
        Ok(_) => Ok(()),
        Err(code) => Err(path_error(code, tag, path)),
    }
}

/// Succeeds without looking at the file, as in Node.
pub fn chown(path: &ZStr, _uid: u32, _gid: u32) -> Maybe<()> {
    chown_impl(path, Tag::chown)
}

/// Succeeds without looking at the file, as in Node.
pub fn lchown(path: &ZStr, _uid: u32, _gid: u32) -> Maybe<()> {
    chown_impl(path, Tag::lchown)
}

/// Succeeds without looking at the descriptor, as in Node.
pub fn fchown(_fd: Fd, _uid: u32, _gid: u32) -> Maybe<()> {
    Ok(())
}

/// `seconds` since the Unix epoch. The arithmetic is Node's, in `f64`, so the low bits agree with it.
fn seconds_to_filetime(seconds: f64) -> Win32Result<FILETIME> {
    let ticks = seconds * TICKS_PER_SEC as f64 + EPOCH_DIFFERENCE_TICKS as f64;
    // The system takes what an `i64` holds, and `as` makes the last of those of anything later.
    if !(0.0..i64::MAX as f64).contains(&ticks) {
        return Err(Win32Error::INVALID_PARAMETER);
    }
    let ticks = ticks as u64;
    Ok(FILETIME {
        dwLowDateTime: ticks as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    })
}

fn utime_handle(handle: HANDLE, atime: f64, mtime: f64) -> Win32Result<()> {
    let atime = seconds_to_filetime(atime)?;
    let mtime = seconds_to_filetime(mtime)?;
    // SAFETY: the creation time is optional, and the other two outlive the call.
    if unsafe { SetFileTime(handle, null(), &raw const atime, &raw const mtime) } == 0 {
        return Err(Win32Error::get());
    }
    Ok(())
}

fn utime_impl(path: &ZStr, atime: f64, mtime: f64, do_lutime: bool) -> Win32Result<()> {
    let mut buf = w_path_buffer_pool::get();
    let path = to_wide(&mut buf, path)?;
    let from_path = |do_lutime: bool| {
        let mut flags = FILE_FLAG_BACKUP_SEMANTICS;
        if do_lutime {
            flags |= FILE_FLAG_OPEN_REPARSE_POINT;
        }
        let handle = Handle::open(
            path,
            FILE_WRITE_ATTRIBUTES,
            FILE_SHARE_ALL,
            OPEN_EXISTING,
            flags,
        )?;
        utime_handle(handle.0, atime, mtime)
    };
    match from_path(do_lutime) {
        Err(code) if do_lutime && is_not_a_link(code) => from_path(false),
        result => result,
    }
}

/// Times are in seconds since the Unix epoch.
pub fn utime(path: &ZStr, atime: f64, mtime: f64) -> Maybe<()> {
    let result = utime_impl(path, atime, mtime, false);
    syslog!("utime({}) = {:?}", bstr::BStr::new(path.as_bytes()), result);
    result.map_err(|code| path_error(code, Tag::utime, path))
}

/// [`utime`] of the link itself.
pub fn lutime(path: &ZStr, atime: f64, mtime: f64) -> Maybe<()> {
    let result = utime_impl(path, atime, mtime, true);
    syslog!(
        "lutime({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result
    );
    result.map_err(|code| path_error(code, Tag::lutime, path))
}

/// [`utime`] of an open file.
pub fn futime(fd: Fd, atime: f64, mtime: f64) -> Maybe<()> {
    let result = valid_handle(fd).and_then(|handle| utime_handle(handle, atime, mtime));
    syslog!("futime({}) = {:?}", fd, result);
    result.map_err(|code| fd_error(code, Tag::futime, fd))
}

pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    let seconds = |time: TimeLike| time.sec as f64 + time.nsec as f64 / 1e9;
    utime(path, seconds(atime), seconds(mtime))
}

pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()> {
    let mut eof = FILE_END_OF_FILE_INFORMATION { EndOfFile: len };
    let result = set_information(
        fd.native(),
        FILE_INFORMATION_CLASS::FileEndOfFileInformation,
        &mut eof,
    );
    syslog!("ftruncate({}, {}) = {:?}", fd, len, result);
    result.map_err(|code| fd_error(code, Tag::ftruncate, fd))
}

fn flush(fd: Fd, tag: Tag) -> Maybe<()> {
    // SAFETY: a bad handle is reported as an error.
    if unsafe { kernel32::FlushFileBuffers(fd.native()) } == 0 {
        return Err(fd_error(Win32Error::get(), tag, fd));
    }
    Ok(())
}

pub fn fsync(fd: Fd) -> Maybe<()> {
    flush(fd, Tag::fsync)
}

pub fn fdatasync(fd: Fd) -> Maybe<()> {
    flush(fd, Tag::fdatasync)
}

fn statfs_impl(path: &ZStr) -> Win32Result<StatFS> {
    let mut buf = w_path_buffer_pool::get();
    let handle = Handle::open(
        to_wide(&mut buf, path)?,
        FILE_READ_ATTRIBUTES,
        FILE_SHARE_ALL,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
    )?;
    let mut info: FileFsFullSizeInformation = zeroed();
    let status = query_volume_information(
        handle.0,
        FS_INFORMATION_CLASS::FileFsFullSizeInformation,
        &mut info,
    );
    if NT_ERROR(status) {
        return Err(Win32Error::from_ntstatus(status));
    }

    let mut stat: StatFS = zeroed();
    stat.f_bsize = u64::from(info.SectorsPerAllocationUnit) * u64::from(info.BytesPerSector);
    stat.f_blocks = info.TotalAllocationUnits as u64;
    stat.f_bfree = info.ActualAvailableAllocationUnits as u64;
    stat.f_bavail = info.CallerAvailableAllocationUnits as u64;
    Ok(stat)
}

pub fn statfs(path: &ZStr) -> Maybe<StatFS> {
    let result = statfs_impl(path);
    syslog!(
        "statfs({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().err()
    );
    result.map_err(|code| path_error(code, Tag::statfs, path))
}
