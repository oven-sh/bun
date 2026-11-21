//! Platform specific APIs for Windows
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

#![cfg(windows)]
#![allow(non_snake_case, non_camel_case_types)]

use core::ffi::{c_int, c_void};
use core::mem::{MaybeUninit, size_of};
use core::ptr;
use std::os::windows::io::{
    AsRawHandle as _, FromRawHandle as _, HandleOrInvalid, HandleOrNull, IntoRawHandle as _,
    OwnedHandle,
};

use bun_core::WStr;
use bun_windows_sys as win32;
use bun_windows_sys as windows;
use bun_windows_sys::externs;

use crate as bun_sys;
use crate::{E, Fd, MaybeExt, NtCreateFileOptions, SystemErrno};

pub use bun_windows_sys::CONTEXT;
pub use bun_windows_sys::externs::SetFilePointerEx;
pub use bun_windows_sys::kernel32::GetLastError;
pub use bun_windows_sys::ntdll;
pub use bun_windows_sys::ws2_32;

/// Re-exports the tier-0 `bun_windows_sys::kernel32`
/// surface and layers the additional externs higher-tier crates reach for
/// (`ReadDirectoryChangesW`, IOCP, SRW locks, `CreateProcessW`, …). Declared
/// locally so adding an extern doesn't require touching `bun_windows_sys`.
pub mod kernel32 {
    use super::{
        BOOL, CONDITION_VARIABLE, DWORD, FileNotifyChangeFilter, HANDLE, IO_COUNTERS, LPCWSTR,
        LPOVERLAPPED, LPOVERLAPPED_COMPLETION_ROUTINE, OVERLAPPED, SRWLOCK, STARTUPINFOW,
        SYSTEMTIME, ULONG, ULONG_PTR,
    };
    pub use bun_windows_sys::externs::{GetConsoleMode, GetExitCodeProcess};
    pub use bun_windows_sys::kernel32::*;
    use core::ffi::c_void;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        // safe: by-value DWORD write to the TEB; cannot fault.
        pub safe fn SetLastError(dwErrCode: DWORD);
        // ── IOCP / async directory watching ──
        /// Whoever waits on `ExistingCompletionPort` gets the requests on `FileHandle` from then on.
        pub(super) fn CreateIoCompletionPort(
            FileHandle: HANDLE,
            ExistingCompletionPort: HANDLE,
            CompletionKey: ULONG_PTR,
            NumberOfConcurrentThreads: DWORD,
        ) -> HANDLE;
        pub fn GetQueuedCompletionStatus(
            CompletionPort: HANDLE,
            lpNumberOfBytesTransferred: *mut DWORD,
            lpCompletionKey: *mut ULONG_PTR,
            lpOverlapped: *mut *mut OVERLAPPED,
            dwMilliseconds: DWORD,
        ) -> BOOL;
        pub fn PostQueuedCompletionStatus(
            CompletionPort: HANDLE,
            dwNumberOfBytesTransferred: DWORD,
            dwCompletionKey: ULONG_PTR,
            lpOverlapped: LPOVERLAPPED,
        ) -> BOOL;
        pub fn CancelIoEx(hFile: HANDLE, lpOverlapped: LPOVERLAPPED) -> BOOL;
        pub fn ReadDirectoryChangesW(
            hDirectory: HANDLE,
            lpBuffer: *mut c_void,
            nBufferLength: DWORD,
            bWatchSubtree: BOOL,
            dwNotifyFilter: FileNotifyChangeFilter,
            lpBytesReturned: *mut DWORD,
            lpOverlapped: LPOVERLAPPED,
            lpCompletionRoutine: LPOVERLAPPED_COMPLETION_ROUTINE,
        ) -> BOOL;

        // safe: by-value `HANDLE` + `DWORD`; a bad handle yields
        // `WAIT_FAILED` + GetLastError, no UB.
        pub safe fn WaitForSingleObject(hHandle: HANDLE, dwMilliseconds: DWORD) -> DWORD;
        pub(super) fn CreateEventW(
            lpEventAttributes: *mut c_void,
            bManualReset: BOOL,
            bInitialState: BOOL,
            lpName: LPCWSTR,
        ) -> std::os::windows::io::HandleOrNull;

        // ── file moves ──
        pub(super) fn MoveFileExW(
            lpExistingFileName: LPCWSTR,
            lpNewFileName: LPCWSTR,
            dwFlags: DWORD,
        ) -> BOOL;

        /// `lpOverlapped` may be null for a handle opened without `FILE_FLAG_OVERLAPPED`.
        pub fn DeviceIoControl(
            hDevice: HANDLE,
            dwIoControlCode: DWORD,
            lpInBuffer: *mut c_void,
            nInBufferSize: DWORD,
            lpOutBuffer: *mut c_void,
            nOutBufferSize: DWORD,
            lpBytesReturned: *mut DWORD,
            lpOverlapped: LPOVERLAPPED,
        ) -> BOOL;

        // ── SRW locks / condition variables (`bun_threading` windows arm) ──
        pub fn ReleaseSRWLockExclusive(SRWLock: *mut SRWLOCK);
        pub fn SleepConditionVariableSRW(
            ConditionVariable: *mut CONDITION_VARIABLE,
            SRWLock: *mut SRWLOCK,
            dwMilliseconds: DWORD,
            Flags: ULONG,
        ) -> BOOL;

        /// No preconditions; reads the calling thread's ID.
        pub safe fn GetCurrentThreadId() -> DWORD;
        pub safe fn GetLocalTime(lpSystemTime: &mut SYSTEMTIME);
        pub(super) safe fn SetHandleInformation(
            hObject: HANDLE,
            dwMask: DWORD,
            dwFlags: DWORD,
        ) -> BOOL;
        pub(super) safe fn GetStartupInfoW(lpStartupInfo: &mut STARTUPINFOW);
        pub(super) safe fn GetProcessIoCounters(
            hProcess: HANDLE,
            lpIoCounters: &mut IO_COUNTERS,
        ) -> BOOL;
    }
}

pub use bun_windows_sys::BOOL;
pub use bun_windows_sys::BOOLEAN;
pub use bun_windows_sys::CHAR;
pub use bun_windows_sys::DWORD;
pub use bun_windows_sys::LPVOID;
pub use bun_windows_sys::MAX_PATH;
pub use bun_windows_sys::PATH_MAX_WIDE;
pub use bun_windows_sys::WORD;
/// `PVOID` (winnt.h) — alias of `LPVOID`. Keep the alias so existing
/// callers (`bun_shim_impl`) don't need rewriting.
pub type PVOID = LPVOID;
pub use bun_windows_sys::COORD;
pub use bun_windows_sys::FALSE;
pub use bun_windows_sys::FILE_BEGIN;
pub use bun_windows_sys::FILE_END;
pub use bun_windows_sys::FILE_OPEN;
pub use bun_windows_sys::INVALID_HANDLE_VALUE;
pub use bun_windows_sys::LARGE_INTEGER;
pub use bun_windows_sys::LPCSTR;
pub use bun_windows_sys::LPCVOID;
pub use bun_windows_sys::LPCWSTR;
pub use bun_windows_sys::LPSTR;
pub use bun_windows_sys::LPWSTR;
pub use bun_windows_sys::NT_ERROR;
pub use bun_windows_sys::NT_SUCCESS;
pub use bun_windows_sys::NTSTATUS;
pub use bun_windows_sys::TRUE;
pub use bun_windows_sys::UINT;
pub use bun_windows_sys::ULONG;
pub use bun_windows_sys::UNICODE_STRING;
pub use bun_windows_sys::WCHAR;
/// `STARTF_USESTDHANDLES` (winbase.h).
pub use bun_windows_sys::externs::STARTF_USESTDHANDLES;
/// `ENABLE_VIRTUAL_TERMINAL_PROCESSING` (consoleapi.h).
pub const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;
pub const MOVEFILE_COPY_ALLOWED: DWORD = 0x2;
pub const MOVEFILE_REPLACE_EXISTING: DWORD = 0x1;
pub const MOVEFILE_WRITE_THROUGH: DWORD = 0x8;
/// `FSCTL_SET_SPARSE` (winioctl.h).
pub const FSCTL_SET_SPARSE: DWORD = 0x0009_00C4;
pub use bun_windows_sys::FILETIME;

pub use bun_core::windows_sys::STD_ERROR_HANDLE;
pub use bun_windows_sys::DUPLICATE_SAME_ACCESS;
pub use bun_windows_sys::FILE_ALL_INFORMATION;
pub use bun_windows_sys::FILE_ATTRIBUTE_DIRECTORY;
pub use bun_windows_sys::FILE_ATTRIBUTE_HIDDEN;
pub use bun_windows_sys::FILE_ATTRIBUTE_NORMAL;
pub use bun_windows_sys::FILE_ATTRIBUTE_READONLY;
pub use bun_windows_sys::FILE_ATTRIBUTE_REPARSE_POINT;
pub use bun_windows_sys::FILE_ATTRIBUTE_TEMPORARY;
pub use bun_windows_sys::FILE_BASIC_INFORMATION;
pub use bun_windows_sys::FILE_DEVICE_CONSOLE;
pub use bun_windows_sys::FILE_DEVICE_NAMED_PIPE;
pub use bun_windows_sys::FILE_DEVICE_NULL;
pub use bun_windows_sys::FILE_DIRECTORY_FILE;
pub use bun_windows_sys::FILE_FS_DEVICE_INFORMATION;
pub use bun_windows_sys::FILE_FS_VOLUME_INFORMATION;
pub use bun_windows_sys::FILE_INFO_BY_HANDLE_CLASS;
pub use bun_windows_sys::FILE_INFORMATION_CLASS;
pub use bun_windows_sys::FILE_NON_DIRECTORY_FILE;
pub use bun_windows_sys::FILE_OPEN_REPARSE_POINT;
pub use bun_windows_sys::FILE_SHARE_DELETE;
pub use bun_windows_sys::FILE_SHARE_READ;
pub use bun_windows_sys::FILE_SHARE_WRITE;
pub use bun_windows_sys::FILE_SYNCHRONOUS_IO_NONALERT;
pub use bun_windows_sys::FS_INFORMATION_CLASS;
pub use bun_windows_sys::IO_STATUS_BLOCK;
pub use bun_windows_sys::OBJECT_ATTRIBUTES;
pub use bun_windows_sys::STANDARD_RIGHTS_READ;
pub use bun_windows_sys::advapi32;
pub use bun_windows_sys::kernel32::SetConsoleCtrlHandler;
pub use bun_windows_sys::user32;
pub use bun_windows_sys::{CONSOLE_SCREEN_BUFFER_INFO, SMALL_RECT};
pub use bun_windows_sys::{CTRL_BREAK_EVENT, CTRL_C_EVENT, CTRL_CLOSE_EVENT};
pub use bun_windows_sys::{DELETE, GENERIC_READ, GENERIC_WRITE, SYNCHRONIZE};
pub use bun_windows_sys::{
    FILE_FLAG_OVERLAPPED, PIPE_ACCESS_INBOUND, PIPE_ACCESS_OUTBOUND,
    SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE, SYMBOLIC_LINK_FLAG_DIRECTORY,
};
pub use bun_windows_sys::{FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_READ_EA, FILE_TRAVERSE};

/// 1601-01-01 → 1970-01-01 offset in 100-ns ticks.
pub(crate) const EPOCH_DIFFERENCE_100NS: i64 = 11_644_473_600 * 10_000_000;

/// Convert a 64-bit Windows `FILETIME` (100-ns ticks since 1601-01-01 UTC)
/// into a libuv `uv_timespec_t` (seconds + nanoseconds since the Unix epoch).
/// Matches libuv's `uv__filetime_to_timespec`.
#[inline]
pub(crate) fn filetime_to_timespec(filetime: i64) -> bun_libuv_sys::uv_timespec_t {
    let t = filetime - EPOCH_DIFFERENCE_100NS;
    let mut sec = t / 10_000_000;
    let mut nsec = (t - sec * 10_000_000) * 100;
    if nsec < 0 {
        sec -= 1;
        nsec += 1_000_000_000;
    }
    bun_libuv_sys::uv_timespec_t {
        sec: sec as _,
        nsec: nsec as _,
    }
}

const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;

pub const NT_OBJECT_PREFIX: [u16; 4] = [b'\\' as u16, b'?' as u16, b'?' as u16, b'\\' as u16];
pub(crate) const LONG_PATH_PREFIX: [u16; 4] =
    [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];

pub(crate) const NT_OBJECT_PREFIX_U8: [u8; 4] = *b"\\??\\";
pub const LONG_PATH_PREFIX_U8: [u8; 4] = *b"\\\\?\\";

pub use bun_paths::PathBuffer;
pub use bun_paths::WPathBuffer;

pub use bun_windows_sys::HANDLE;
pub use bun_windows_sys::HMODULE;

// ──────────────────────────────────────────────────────────────────────────
// Additional Win32 typedefs / constants surfaced for `bun_watcher`,
// `bun_crash_handler`, `bun_threading`, `bun_install`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_windows_sys::ULONG_PTR;
/// `HRESULT` — 32-bit signed result code.
pub type HRESULT = i32;
/// `WaitForSingleObject` infinite timeout sentinel.
pub const INFINITE: DWORD = 0xFFFF_FFFF;

// ── SRWLOCK / CONDITION_VARIABLE (`bun_threading` windows arm) ────────────
// Win32 defines both as `struct { PVOID Ptr; }`; static-init is all-zero
// (`SRWLOCK_INIT` / `CONDITION_VARIABLE_INIT`).
#[repr(transparent)]
pub struct SRWLOCK {
    ptr: *mut c_void,
}
pub const SRWLOCK_INIT: SRWLOCK = SRWLOCK {
    ptr: ptr::null_mut(),
};
impl Default for SRWLOCK {
    fn default() -> Self {
        SRWLOCK_INIT
    }
}

#[repr(transparent)]
pub struct CONDITION_VARIABLE {
    ptr: *mut c_void,
}
pub const CONDITION_VARIABLE_INIT: CONDITION_VARIABLE = CONDITION_VARIABLE {
    ptr: ptr::null_mut(),
};
impl Default for CONDITION_VARIABLE {
    fn default() -> Self {
        CONDITION_VARIABLE_INIT
    }
}

// `ntdll` is re-exported from `bun_windows_sys` above; the futex primitives
// (`RtlWaitOnAddress` / `RtlWakeAddress*`) live there so this crate doesn't
// shadow the canonical module.

#[repr(C)]
#[derive(Default)]
pub struct SYSTEMTIME {
    pub wYear: WORD,
    pub wMonth: WORD,
    wDayOfWeek: WORD,
    pub wDay: WORD,
    pub wHour: WORD,
    pub wMinute: WORD,
    pub wSecond: WORD,
    wMilliseconds: WORD,
}

// `NtCreateFile` access masks / create-options not yet in `bun_windows_sys`.
pub const FILE_LIST_DIRECTORY: ULONG = 0x0001;
pub const FILE_OPEN_FOR_BACKUP_INTENT: ULONG = 0x0000_4000;

// `ReadDirectoryChangesW` action codes (`winnt.h`).
pub const FILE_ACTION_ADDED: DWORD = 0x0000_0001;
pub const FILE_ACTION_REMOVED: DWORD = 0x0000_0002;
pub const FILE_ACTION_MODIFIED: DWORD = 0x0000_0003;
pub const FILE_ACTION_RENAMED_OLD_NAME: DWORD = 0x0000_0004;
pub const FILE_ACTION_RENAMED_NEW_NAME: DWORD = 0x0000_0005;

bitflags::bitflags! {
    /// `dwNotifyFilter` flags for
    /// `ReadDirectoryChangesW` (`winnt.h` `FILE_NOTIFY_CHANGE_*`).
    ///
    /// `#[repr(transparent)]` is required: this newtype is passed by value
    /// across the `extern "system"` boundary as the `dwNotifyFilter: DWORD`
    /// parameter of `ReadDirectoryChangesW`. bitflags 2.x does NOT add a repr
    /// automatically; without it the struct has Rust's default (unspecified)
    /// layout and is improper_ctypes / UB at the FFI boundary.
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct FileNotifyChangeFilter: DWORD {
        const FILE_NAME   = 0x0000_0001;
        const DIR_NAME    = 0x0000_0002;
        const ATTRIBUTES  = 0x0000_0004;
        const SIZE        = 0x0000_0008;
        const LAST_WRITE  = 0x0000_0010;
        const LAST_ACCESS = 0x0000_0020;
        const CREATION    = 0x0000_0040;
        const SECURITY    = 0x0000_0100;
    }
}

/// `FILE_NOTIFY_INFORMATION` (`winnt.h`) — variable-length record returned
/// by `ReadDirectoryChangesW`. `FileName` is a flexible array; declared as
/// `[WCHAR; 1]` to match the C layout (read past it via `FileNameLength`).
#[repr(C)]
pub struct FILE_NOTIFY_INFORMATION {
    pub NextEntryOffset: DWORD,
    pub Action: DWORD,
    pub FileNameLength: DWORD,
    pub FileName: [WCHAR; 1],
}

pub use bun_windows_sys::OVERLAPPED;
pub type LPOVERLAPPED = *mut OVERLAPPED;
pub type LPOVERLAPPED_COMPLETION_ROUTINE =
    Option<unsafe extern "system" fn(DWORD, DWORD, *mut OVERLAPPED)>;

pub use bun_windows_sys::{PROCESS_INFORMATION, STARTUPINFOEXW, STARTUPINFOW};

/// A new port for the requests on `file_handle`.
pub fn CreateIoCompletionPort(
    file_handle: HANDLE,
    completion_key: ULONG_PTR,
    concurrent_threads: DWORD,
) -> core::result::Result<HANDLE, bun_errno::SystemErrno> {
    // SAFETY: nobody waits on the port yet.
    let h = unsafe {
        kernel32::CreateIoCompletionPort(
            file_handle,
            ptr::null_mut(),
            completion_key,
            concurrent_threads,
        )
    };
    if h.is_null() {
        return Err(bun_errno::SystemErrno::EIO);
    }
    Ok(h)
}

pub use bun_windows_sys::externs::BY_HANDLE_FILE_INFORMATION;
pub use bun_windows_sys::externs::FILE_FLAG_BACKUP_SEMANTICS;
pub use bun_windows_sys::externs::OPEN_EXISTING;

/// `Err(GetLastError())` if `rc` is `FALSE`.
fn check(rc: BOOL) -> Result<(), Win32Error> {
    if rc == FALSE {
        return Err(Win32Error::get());
    }
    Ok(())
}

/// For calls that return the length written, 0 on failure, or the size needed if `capacity` is too small.
fn check_len(rc: DWORD, capacity: usize) -> Result<usize, Win32Error> {
    match rc as usize {
        0 => Err(Win32Error::get()),
        len if len >= capacity => Err(Win32Error::FILENAME_EXCED_RANGE),
        len => Ok(len),
    }
}

/// Manual-reset, not signalled, and without a name.
pub fn CreateEventW() -> Result<OwnedHandle, Win32Error> {
    // SAFETY: both pointers are optional.
    let event = unsafe { kernel32::CreateEventW(ptr::null_mut(), TRUE, FALSE, ptr::null()) };
    OwnedHandle::try_from(event).map_err(|_| Win32Error::get())
}

pub fn CreateFileW(
    file_name: &WStr,
    desired_access: DWORD,
    share_mode: DWORD,
    creation_disposition: DWORD,
    flags_and_attributes: DWORD,
) -> Result<OwnedHandle, Win32Error> {
    // SAFETY: `file_name` is NUL-terminated; the result is a new handle or `INVALID_HANDLE_VALUE`.
    let handle = unsafe {
        HandleOrInvalid::from_raw_handle(externs::CreateFileW(
            file_name.as_ptr(),
            desired_access,
            share_mode,
            ptr::null_mut(),
            creation_disposition,
            flags_and_attributes,
            ptr::null_mut(),
        ))
    };
    OwnedHandle::try_from(handle).map_err(|_| Win32Error::get())
}

/// The only instance of a pipe of bytes. `open_mode` has `PIPE_ACCESS_*` and `FILE_FLAG_*`.
pub fn CreateNamedPipeW(
    name: &WStr,
    open_mode: DWORD,
    buffer_size: DWORD,
) -> Result<OwnedHandle, Win32Error> {
    use externs::{PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT};
    const FILE_FLAG_FIRST_PIPE_INSTANCE: DWORD = 0x0008_0000;
    // SAFETY: `name` is NUL-terminated; the result is a new handle or `INVALID_HANDLE_VALUE`.
    let handle = unsafe {
        HandleOrInvalid::from_raw_handle(kernel32::CreateNamedPipeW(
            name.as_ptr(),
            open_mode | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1,
            buffer_size,
            buffer_size,
            0,
            ptr::null_mut(),
        ))
    };
    OwnedHandle::try_from(handle).map_err(|_| Win32Error::get())
}

pub fn MoveFileExW(from: &WStr, to: &WStr, flags: DWORD) -> Result<(), Win32Error> {
    // SAFETY: both are NUL-terminated.
    check(unsafe { kernel32::MoveFileExW(from.as_ptr(), to.as_ptr(), flags) })
}

pub fn SetEndOfFile(file: HANDLE) -> Result<(), Win32Error> {
    check(externs::SetEndOfFile(file))
}

pub fn FlushFileBuffers(file: HANDLE) -> Result<(), Win32Error> {
    check(kernel32::FlushFileBuffers(file))
}

pub fn make_inheritable(handle: HANDLE) -> Result<(), Win32Error> {
    const HANDLE_FLAG_INHERIT: DWORD = 1;
    check(kernel32::SetHandleInformation(
        handle,
        HANDLE_FLAG_INHERIT,
        HANDLE_FLAG_INHERIT,
    ))
}

/// `root_directory` is `None` if `object_name` is a full NT object name.
pub fn NtCreateFile(
    root_directory: Option<HANDLE>,
    object_name: &[u16],
    options: NtCreateFileOptions,
) -> Result<OwnedHandle, NTSTATUS> {
    let Ok(len_bytes) = u16::try_from(size_of_val(object_name)) else {
        return Err(NTSTATUS::NAME_TOO_LONG);
    };
    let mut nt_name = UNICODE_STRING {
        Length: len_bytes,
        MaximumLength: len_bytes,
        // The Windows API makes this mutable, but it will not mutate here.
        Buffer: object_name.as_ptr().cast_mut(),
    };
    let mut attr = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: root_directory.unwrap_or(ptr::null_mut()),
        Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        ObjectName: &raw mut nt_name,
        SecurityDescriptor: ptr::null_mut(),
        SecurityQualityOfService: ptr::null_mut(),
    };
    let mut io: IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    let mut handle: HANDLE = ptr::null_mut();
    // SAFETY: every pointer is null or valid for the call; `nt_name` describes `object_name`.
    let rc = unsafe {
        ntdll::NtCreateFile(
            &raw mut handle,
            options.access_mask,
            &raw mut attr,
            &raw mut io,
            ptr::null_mut(),
            options.attributes,
            options.sharing_mode,
            options.disposition,
            options.options,
            ptr::null_mut(),
            0,
        )
    };
    if !NT_SUCCESS(rc) {
        return Err(rc);
    }
    let succeeded =
        rc == NTSTATUS::SUCCESS || Win32Error::from_nt_status(rc) == Win32Error::SUCCESS;
    // SAFETY: `NtCreateFile` did not fail, so this is a new handle or still null.
    match OwnedHandle::try_from(unsafe { HandleOrNull::from_raw_handle(handle) }) {
        Ok(handle) if succeeded => Ok(handle),
        _ => Err(rc),
    }
}

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle
pub fn GetFileInformationByHandle(file: HANDLE) -> Result<BY_HANDLE_FILE_INFORMATION, Win32Error> {
    let mut info: BY_HANDLE_FILE_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: `info` is a valid out-param.
    check(unsafe { externs::GetFileInformationByHandle(file, &raw mut info) })?;
    Ok(info)
}

pub fn GetFileAttributesW(file_name: &WStr) -> Result<DWORD, Win32Error> {
    // SAFETY: `file_name` is NUL-terminated.
    match unsafe { externs::GetFileAttributesW(file_name.as_ptr()) } {
        INVALID_FILE_ATTRIBUTES => Err(Win32Error::get()),
        attributes => Ok(attributes),
    }
}

/// Returns the length written. `FILENAME_EXCED_RANGE` if `buf` is too small.
pub fn GetCurrentDirectoryW(buf: &mut [u16]) -> Result<usize, Win32Error> {
    // SAFETY: it writes at most `buf.len()` units.
    let rc = unsafe { externs::GetCurrentDirectoryW(buf.len() as DWORD, buf.as_mut_ptr()) };
    check_len(rc, buf.len())
}

/// Returns the length written. `FILENAME_EXCED_RANGE` if `buf` is too small.
pub fn GetSystemDirectoryW(buf: &mut [u16]) -> Result<usize, Win32Error> {
    // SAFETY: it writes at most `buf.len()` units.
    let rc = unsafe { externs::GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as DWORD) };
    check_len(rc, buf.len())
}

unsafe extern "system" {
    // safe: `HANDLE` is a by-value opaque; bad handle → FILE_TYPE_UNKNOWN +
    // GetLastError, no UB.
    #[link_name = "GetFileType"]
    safe fn GetFileType_raw(hFile: HANDLE) -> DWORD;
}

pub fn GetFileType(hFile: HANDLE) -> DWORD {
    let rc = GetFileType_raw(hFile);
    // `syslog!` self-gates on `env::IS_DEBUG` (see lib.rs); no extra feature
    // flag needed (there is no `debug_logs` feature in bun_sys).
    bun_sys::syslog!("GetFileType({}) = {}", Fd::from_system(hFile), rc);
    rc
}

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfiletype#return-value
pub(crate) const FILE_TYPE_UNKNOWN: DWORD = 0x0000;
pub(crate) const FILE_TYPE_DISK: DWORD = 0x0001;
pub const FILE_TYPE_CHAR: DWORD = 0x0002;
pub const FILE_TYPE_PIPE: DWORD = 0x0003;
pub(crate) const FILE_TYPE_REMOTE: DWORD = 0x8000;

pub use SetCurrentDirectoryW as SetCurrentDirectory;
/// Each process has a single current directory made up of two parts:
///
/// - A disk designator that is either a drive letter followed by a colon, or a server name and share name (\\servername\sharename)
/// - A directory on the disk designator
///
/// The current directory is shared by all threads of the process: If one thread changes the current directory, it affects all threads in the process. Multithreaded applications and shared library code should avoid calling the SetCurrentDirectory function due to the risk of affecting relative path calculations being performed by other threads. Conversely, multithreaded applications and shared library code should avoid using relative paths so that they are unaffected by changes to the current directory performed by other threads.
///
/// Note that the current directory for a process is locked while the process is executing. This will prevent the directory from being deleted, moved, or renamed.
pub use bun_windows_sys::externs::SetCurrentDirectoryW;

pub use bun_windows_sys::externs::RtlNtStatusToDosError;

pub use bun_windows_sys::externs::SaferiIsExecutableFileType;

/// Codes from <https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/18d8fbe8-a967-4f1c-ae50-99ca8e491d2d>.
/// Canonical newtype lives in `bun_windows_sys` (tier-0); re-exported here so
/// `bun_sys::windows::Win32Error` and `bun_errno::Win32Error` are one nominal
/// type.
pub use bun_windows_sys::Win32Error;

/// `to_system_errno()` / `to_e()` — extension trait from `bun_errno` (the
/// `SystemErrno` mapping table is a higher-tier concern than the tier-0
/// newtype).
pub use bun_errno::Win32ErrorExt;

pub use bun_libuv_sys as libuv;

/// This process's access token, opened for `TOKEN_QUERY`.
pub(crate) fn process_token() -> Option<OwnedHandle> {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: this process's pseudo-handle, and an out-param that success fills with a new handle.
    unsafe {
        (win32::OpenProcessToken(
            win32::GetCurrentProcess(),
            win32::TOKEN_QUERY,
            &raw mut token,
        ) != 0)
            .then(|| OwnedHandle::from_raw_handle(token))
    }
}

/// True when the process token is a Windows AppContainer (lowbox) token.
/// Cached for the process lifetime; the token's AppContainer bit is immutable.
pub fn is_app_container() -> bool {
    static CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| {
        let Some(token) = process_token() else {
            return false;
        };
        let mut is_ac: win32::DWORD = 0;
        let mut ret_len: win32::DWORD = 0;
        // SAFETY: `token` is open; the buffer is writable for the length given.
        let ok = unsafe {
            win32::GetTokenInformation(
                token.as_raw_handle(),
                win32::TOKEN_IS_APP_CONTAINER,
                (&raw mut is_ac).cast(),
                size_of::<win32::DWORD>() as win32::DWORD,
                &mut ret_len,
            )
        };
        ok != 0 && is_ac != 0
    })
}

pub use bun_errno::translate_uv_error_to_e;

unsafe extern "system" {
    #[link_name = "CreateHardLinkW"]
    fn CreateHardLinkW_raw(
        newFileName: LPCWSTR,
        existingFileName: LPCWSTR,
        securityAttributes: *mut win32::SECURITY_ATTRIBUTES,
    ) -> BOOL;
}

pub fn CreateHardLinkW(new_file_name: &WStr, existing_file_name: &WStr) -> Result<(), Win32Error> {
    // SAFETY: both are NUL-terminated; null security attributes.
    let result = check(unsafe {
        CreateHardLinkW_raw(
            new_file_name.as_ptr(),
            existing_file_name.as_ptr(),
            ptr::null_mut(),
        )
    });
    bun_sys::syslog!(
        "CreateHardLinkW({}, {}) = {}",
        bun_core::fmt::utf16(new_file_name),
        bun_core::fmt::utf16(existing_file_name),
        result.err().unwrap_or(Win32Error::SUCCESS).0,
    );
    result
}

/// Calls `CopyFileW`. kernel32 reads the code unit before an empty destination
/// name, so an empty `dest` is replaced with a pointer to the second of two NULs.
pub fn CopyFileW(source: &WStr, dest: &WStr, fail_if_exists: bool) -> Result<(), Win32Error> {
    static EMPTY_DEST: [u16; 2] = [0, 0];
    let dest = match dest.first() {
        None | Some(0) => EMPTY_DEST[1..].as_ptr(),
        Some(_) => dest.as_ptr(),
    };
    // SAFETY: both are NUL-terminated.
    check(unsafe { externs::CopyFileW(source.as_ptr(), dest, fail_if_exists.into()) })
}

/// `bun.windows.Error` — alias for `Win32Error`.
pub type Error = Win32Error;

/// `bun.windows.translateNTStatusToErrno` — thin wrapper over the canonical
/// table in `bun_errno::windows::translate_ntstatus_to_errno`. This crate only
/// adds the debug-build `Output::debug_warn` diagnostics (which `bun_errno`
/// cannot emit without an upward dep).
pub fn translate_nt_status_to_errno(err: NTSTATUS) -> E {
    // Both `NTSTATUS` newtypes are `#[repr(transparent)] (pub u32)`; round-trip
    // via the raw value so the lower-tier crate owns the only mapping table.
    let e = bun_errno::windows::translate_ntstatus_to_errno(bun_errno::windows::NTSTATUS(err.0));
    #[cfg(debug_assertions)]
    {
        use bun_windows_sys::ntstatus::{OBJECT_NAME_INVALID, SHARING_VIOLATION};
        match err {
            SHARING_VIOLATION => bun_core::debug_warn!(
                "Received SHARING_VIOLATION, indicates file handle should've been opened with FILE_SHARE_DELETE",
            ),
            OBJECT_NAME_INVALID => bun_core::debug_warn!(
                "Received OBJECT_NAME_INVALID, indicates a file path conversion issue.",
            ),
            t if e == E::UNKNOWN => bun_core::debug_warn!(
                "Called translateNTStatusToErrno with {:?} which does not have a mapping to errno.",
                t
            ),
            _ => {}
        }
    }
    e
}

pub fn GetHostNameW(buf: &mut [u16]) -> Option<&[u16]> {
    libuv::uv__winsock_ensure();
    // SAFETY: it writes at most `buf.len()` units.
    if unsafe { externs::GetHostNameW(buf.as_mut_ptr(), buf.len() as c_int) } != 0 {
        return None;
    }
    let len = bun_core::strings::index_of_scalar(buf, 0).unwrap_or(buf.len());
    Some(&buf[..len])
}

/// Returns the length written. `FILENAME_EXCED_RANGE` if `buf` is too small.
pub fn GetTempPathW(buf: &mut [u16]) -> Result<usize, Win32Error> {
    // SAFETY: it writes at most `buf.len()` units.
    let rc = unsafe { externs::GetTempPathW(buf.len() as DWORD, buf.as_mut_ptr()) };
    check_len(rc, buf.len())
}

/// `GetCurrentProcessId` (processthreadsapi.h) — current PID. Safe wrapper:
/// the underlying call has no preconditions and never fails.
#[inline]
pub fn GetCurrentProcessId() -> DWORD {
    unsafe extern "system" {
        // No preconditions; reads thread-local kernel state.
        safe fn GetCurrentProcessId() -> DWORD;
    }
    GetCurrentProcessId()
}

pub use bun_windows_sys::{PEB, RTL_USER_PROCESS_PARAMETERS, TEB, teb};

pub fn AssignProcessToJobObject(job: &OwnedHandle, process: HANDLE) -> Result<(), Win32Error> {
    // SAFETY: by-value handles only; a bad one fails the call.
    check(unsafe { externs::AssignProcessToJobObject(job.as_raw_handle(), process) })
}

pub use bun_windows_sys::externs::GetCurrentProcess;

/// The id that the creator of this process had. Not `uv_os_getppid`, which needs libuv to have started.
pub fn parent_process_id() -> Option<DWORD> {
    use externs::{PROCESS_BASIC_INFORMATION, ProcessBasicInformation};
    let mut info = MaybeUninit::<PROCESS_BASIC_INFORMATION>::zeroed();
    // SAFETY: it writes at most the size given, and any bytes are a valid `info`.
    unsafe {
        let rc = ntdll::NtQueryInformationProcess(
            GetCurrentProcess(),
            ProcessBasicInformation,
            info.as_mut_ptr().cast(),
            size_of_val(&info) as ULONG,
            ptr::null_mut(),
        );
        NT_SUCCESS(rc).then(|| info.assume_init().InheritedFromUniqueProcessId as DWORD)
    }
}

/// A thread of the system's pool calls `callback` once. `object` stays open for that.
pub fn call_when_signaled(
    object: OwnedHandle,
    callback: extern "system" fn(LPVOID, BOOLEAN),
) -> Result<(), Win32Error> {
    let mut wait = ptr::null_mut();
    // SAFETY: it writes `wait`, and only passes the context on.
    check(unsafe {
        externs::RegisterWaitForSingleObject(
            &raw mut wait,
            object.as_raw_handle(),
            callback,
            ptr::null_mut(),
            INFINITE,
            externs::WT_EXECUTEONLYONCE,
        )
    })?;
    let _ = object.into_raw_handle();
    Ok(())
}

/// `lpReserved2`, in which a parent describes its file descriptors to the C runtime of its child.
pub fn inherited_descriptors() -> &'static [u8] {
    let mut info: STARTUPINFOW = bun_core::ffi::zeroed();
    kernel32::GetStartupInfoW(&mut info);
    if info.lpReserved2.is_null() {
        return &[];
    }
    // SAFETY: the block is part of the parameters of this process, which are never freed.
    unsafe { core::slice::from_raw_parts(info.lpReserved2, info.cbReserved2.into()) }
}

/// Does not wait for the process, which inherits handles. Panics unless `command_line` ends with a NUL.
pub fn start_process(command_line: &mut [u16]) -> Result<(), Win32Error> {
    assert!(command_line.last() == Some(&0));
    let mut startup_info: STARTUPINFOW = bun_core::ffi::zeroed();
    startup_info.cb = size_of_val(&startup_info) as DWORD;
    let mut process: PROCESS_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: `command_line` is NUL-terminated and writable. On success both handles are new.
    unsafe {
        check(kernel32::CreateProcessW(
            ptr::null(),
            command_line.as_mut_ptr(),
            ptr::null_mut(),
            ptr::null_mut(),
            TRUE,
            0,
            ptr::null_mut(),
            ptr::null(),
            &raw mut startup_info,
            &raw mut process,
        ))?;
        externs::CloseHandle(process.hProcess);
        externs::CloseHandle(process.hThread);
    }
    Ok(())
}

/// The C runtime calls `handler` on the thread that calls `abort()`, once it has put the default back.
pub fn set_abort_handler(handler: Option<extern "C" fn(c_int)>) {
    let handler = handler.map_or(libc::SIG_DFL, |handler| handler as usize);
    // SAFETY: `handler` has the type that it calls.
    unsafe { libc::signal(libc::SIGABRT, handler) };
}

// Job Object structures + JOBOBJECTINFOCLASS consts — canonical definitions
// live in bun_windows_sys::externs. Do NOT re-declare here.
pub use bun_windows_sys::externs::{
    IO_COUNTERS, JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_BASIC_LIMIT_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectAssociateCompletionPortInformation,
    JobObjectExtendedLimitInformation,
};

pub fn OpenProcess(desired_access: DWORD, process_id: DWORD) -> Result<OwnedHandle, Win32Error> {
    // SAFETY: the result is a new handle or null.
    let process = unsafe {
        HandleOrNull::from_raw_handle(externs::OpenProcess(desired_access, FALSE, process_id))
    };
    OwnedHandle::try_from(process).map_err(|_| Win32Error::get())
}

// https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights
pub const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;

pub fn exe_path_w() -> &'static bun_core::WStr {
    // SAFETY: PEB ImagePathName is valid for the lifetime of the process.
    // `peb()` lives in `bun_core::windows_sys` (tier-0; needs inline asm),
    // not `bun_windows_sys`.
    unsafe {
        let pp = (*bun_core::windows_sys::peb()).ProcessParameters;
        let image_path = core::ptr::addr_of!((*pp).ImagePathName);
        let len = ((*image_path).Length as usize) / 2;
        bun_core::WStr::from_raw((*image_path).Buffer, len)
    }
}

pub use bun_windows_sys::{
    FOCUS_EVENT_RECORD, INPUT_RECORD, INPUT_RECORD_Event, KEY_EVENT_RECORD, KEY_EVENT_RECORD_uChar,
    MENU_EVENT_RECORD, MOUSE_EVENT_RECORD, WINDOW_BUFFER_SIZE_EVENT,
};

// Bun__UVSignalHandle__{init,close}: see src/runtime/node/uv_signal_handle_windows.rs

/// Is not the actual UID of the user, but just a hash of username.
pub fn user_unique_id() -> u32 {
    // https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tsch/165836c1-89d7-4abb-840d-80cf2510aa3e
    // UNLEN + 1
    let mut buf: [u16; 257] = [0; 257];
    let mut size: u32 = buf.len() as u32;
    // SAFETY: buf and size are valid
    if unsafe { externs::GetUserNameW(buf.as_mut_ptr(), &mut size) } == 0 {
        #[cfg(debug_assertions)]
        {
            let err = GetLastError();
            panic!("GetUserNameW failed: {:?}", err);
        }
        #[cfg(not(debug_assertions))]
        return 0;
    }
    let name = &buf[0..size as usize];
    bun_core::scoped_log!(
        windowsUserUniqueId,
        "username: {}",
        bun_core::fmt::utf16(name)
    );
    bun_wyhash::hash32(bun_core::slice_as_bytes(name))
}

pub fn CreateDirectoryExW(
    template_directory: &WStr,
    new_directory: &WStr,
) -> Result<(), Win32Error> {
    // SAFETY: both are NUL-terminated; null security attributes.
    check(unsafe {
        externs::CreateDirectoryExW(
            template_directory.as_ptr(),
            new_directory.as_ptr(),
            ptr::null_mut(),
        )
    })
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum GetFinalPathNameByHandleError {
    #[error("FileNotFound")]
    FileNotFound,
    #[error("NameTooLong")]
    NameTooLong,
}

enum FinalNameError {
    BufferTooSmall,
    LastError(DWORD),
}

fn final_name_raw(h: HANDLE, flags: DWORD, buf: &mut [u16]) -> Result<usize, FinalNameError> {
    // SAFETY: buf valid for buf.len().
    let rc =
        unsafe { externs::GetFinalPathNameByHandleW(h, buf.as_mut_ptr(), buf.len() as u32, flags) };
    match rc as usize {
        0 => Err(FinalNameError::LastError(GetLastError())),
        len if len >= buf.len() => Err(FinalNameError::BufferTooSmall),
        len => Ok(len),
    }
}

/// Attribute-only `CreateFileW` (0 access): exempt from share-mode arbitration
/// and the smallest ACL surface — don't add access bits.
/// `FILE_FLAG_BACKUP_SEMANTICS` covers directories, harmless on files.
fn attr_only_open(path: &WStr) -> Option<OwnedHandle> {
    CreateFileW(
        path,
        0,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
    )
    .ok()
}

/// `(\Device\<volume>, letter)` for the system volume, resolved once via
/// `GetSystemDirectoryW`: the Windows directory carries an inherited
/// `ALL APPLICATION PACKAGES:(RX)` ACE, so an attribute-only open there
/// succeeds in any lowbox where the mount manager is denied.
fn system_volume_device() -> Option<&'static (Vec<u16>, u16)> {
    static CACHE: std::sync::OnceLock<Option<(Vec<u16>, u16)>> = std::sync::OnceLock::new();
    CACHE
        .get_or_init(|| {
            let mut sysdir = bun_paths::w_path_buffer_pool::get();
            let n = GetSystemDirectoryW(&mut sysdir.0).ok()?;
            if n < 3 {
                return None;
            }
            let letter = sysdir.0[0];
            if letter >= 128
                || !(letter as u8).is_ascii_alphabetic()
                || sysdir.0[1] != u16::from(b':')
            {
                return None;
            }
            sysdir.0[n] = 0;
            let h = attr_only_open(WStr::from_buf(&sysdir.0, n))?;
            let mut nt = bun_paths::w_path_buffer_pool::get();
            let mut none = bun_paths::w_path_buffer_pool::get();
            let nt_len = final_name_raw(
                h.as_raw_handle(),
                win32::FILE_NAME_NORMALIZED | win32::VOLUME_NAME_NT,
                &mut nt.0[..],
            )
            .ok()?;
            let none_len = final_name_raw(
                h.as_raw_handle(),
                win32::FILE_NAME_NORMALIZED | win32::VOLUME_NAME_NONE,
                &mut none.0[..],
            )
            .ok()?;
            if none_len >= nt_len {
                return None;
            }
            let (device, tail) = nt.0[..nt_len].split_at(nt_len - none_len);
            if tail != &none.0[..none_len] {
                return None;
            }
            Some((
                device.to_vec(),
                u16::from((letter as u8).to_ascii_uppercase()),
            ))
        })
        .as_ref()
}

/// `VOLUME_NAME_DOS` was denied (AppContainer token). Answer only for handles
/// on the system volume: `<system drive>:<VOLUME_NAME_NT minus device prefix>`,
/// byte-identical to what the real API would have composed. Any other device
/// surfaces the original denial. Callers gate on `is_app_container()`.
fn lowbox_dos_name_fallback(
    hFile: HANDLE,
    out_buffer: &mut [u16],
) -> Result<&mut [u16], GetFinalPathNameByHandleError> {
    debug_assert!(is_app_container());
    let mut nt_buf = bun_paths::w_path_buffer_pool::get();
    let Ok(nt_len) = final_name_raw(
        hFile,
        win32::FILE_NAME_NORMALIZED | win32::VOLUME_NAME_NT,
        &mut nt_buf.0[..],
    ) else {
        bun_sys::syslog!(
            "GetFinalPathNameByHandleW({:p}) = denied (no NT name)",
            hFile
        );
        return Err(GetFinalPathNameByHandleError::FileNotFound);
    };
    let nt = &nt_buf.0[..nt_len];
    let Some((device, letter)) = system_volume_device() else {
        bun_sys::syslog!(
            "GetFinalPathNameByHandleW({:p}) = denied (system volume unresolved)",
            hFile
        );
        return Err(GetFinalPathNameByHandleError::FileNotFound);
    };
    if !(nt.len() > device.len()
        && nt[..device.len()] == device[..]
        && nt[device.len()] == u16::from(b'\\'))
    {
        bun_sys::syslog!(
            "GetFinalPathNameByHandleW({:p}) = denied (not on system volume: {})",
            hFile,
            bun_core::fmt::utf16(nt)
        );
        return Err(GetFinalPathNameByHandleError::FileNotFound);
    }
    let rest = &nt[device.len()..];
    let total = 2 + rest.len();
    if total >= out_buffer.len() {
        return Err(GetFinalPathNameByHandleError::NameTooLong);
    }
    out_buffer[0] = *letter;
    out_buffer[1] = u16::from(b':');
    out_buffer[2..total].copy_from_slice(rest);
    // The real API NUL-terminates; the bounds check above reserved that slot.
    out_buffer[total] = 0;
    bun_sys::syslog!(
        "GetFinalPathNameByHandleW({:p}) = {} (system-volume fallback)",
        hFile,
        bun_core::fmt::utf16(&out_buffer[..total])
    );
    Ok(&mut out_buffer[..total])
}

/// This module's spelling of `GetFinalPathNameByHandleW`: returns the length
/// written (`FILENAME_EXCED_RANGE` if `out` is too small) plus, inside an
/// AppContainer, the same lowbox fallback as [`GetFinalPathNameByHandle`]. The
/// fallback output keeps the `\\?\` prefix the raw API produces for
/// `VOLUME_NAME_DOS`, and any failure of it is `ACCESS_DENIED`.
pub fn GetFinalPathNameByHandleW(
    hFile: HANDLE,
    out: &mut [u16],
    flags: DWORD,
) -> Result<usize, Win32Error> {
    let err = match final_name_raw(hFile, flags, out) {
        Ok(len) => return Ok(len),
        Err(FinalNameError::BufferTooSmall) => return Err(Win32Error::FILENAME_EXCED_RANGE),
        Err(FinalNameError::LastError(err)) => err,
    };
    let volume_kind =
        flags & (win32::VOLUME_NAME_GUID | win32::VOLUME_NAME_NT | win32::VOLUME_NAME_NONE);
    if err != u32::from(Win32Error::ACCESS_DENIED.0)
        || volume_kind != win32::VOLUME_NAME_DOS
        || !is_app_container()
        || out.len() <= LONG_PATH_PREFIX.len()
    {
        return Err(Win32Error::from_u32(err));
    }
    let Ok(rest) = lowbox_dos_name_fallback(hFile, &mut out[LONG_PATH_PREFIX.len()..]) else {
        return Err(Win32Error::ACCESS_DENIED);
    };
    let rest_len = rest.len();
    out[..LONG_PATH_PREFIX.len()].copy_from_slice(&LONG_PATH_PREFIX);
    Ok(LONG_PATH_PREFIX.len() + rest_len)
}

pub(crate) fn GetFinalPathNameByHandle(
    hFile: HANDLE,
    fmt: win32::GetFinalPathNameByHandleFormat,
    out_buffer: &mut [u16],
) -> Result<&mut [u16], GetFinalPathNameByHandleError> {
    let flags = match fmt.volume_name {
        win32::VolumeName::Dos => win32::FILE_NAME_NORMALIZED | win32::VOLUME_NAME_DOS,
        win32::VolumeName::Nt => win32::FILE_NAME_NORMALIZED | win32::VOLUME_NAME_NT,
        win32::VolumeName::None => win32::FILE_NAME_NORMALIZED | win32::VOLUME_NAME_NONE,
    };
    let return_length = match final_name_raw(hFile, flags, out_buffer) {
        Ok(len) => len,
        Err(FinalNameError::BufferTooSmall) => {
            bun_sys::syslog!("GetFinalPathNameByHandleW({:p}) = NAMETOOLONG", hFile);
            return Err(GetFinalPathNameByHandleError::NameTooLong);
        }
        Err(FinalNameError::LastError(err)) => {
            bun_sys::syslog!("GetFinalPathNameByHandleW({:p}) = {:?}", hFile, err);
            // An AppContainer (lowbox) token is denied the mount-manager lookup
            // behind the DOS volume-name translation while the NT form still
            // works; rebuild `X:\…` from the NT name (system volume only).
            if fmt.volume_name == win32::VolumeName::Dos
                && err == u32::from(Win32Error::ACCESS_DENIED.0)
                && is_app_container()
            {
                return lowbox_dos_name_fallback(hFile, out_buffer);
            }
            return Err(GetFinalPathNameByHandleError::FileNotFound);
        }
    };

    let mut ret = &mut out_buffer[0..return_length];

    bun_sys::syslog!(
        "GetFinalPathNameByHandleW({:p}) = {}",
        hFile,
        bun_core::fmt::utf16(ret)
    );

    if ret.starts_with(&LONG_PATH_PREFIX) {
        // '\\?\C:\absolute\path' -> 'C:\absolute\path'
        ret = &mut ret[4..];
        if bun_core::has_prefix_comptime_utf16(ret, b"UNC\\") {
            // '\\?\UNC\absolute\path' -> '\\absolute\path'
            ret[2] = b'\\' as u16;
            ret = &mut ret[2..];
        }
    }

    Ok(ret)
}

const GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT: DWORD = 0x00000002;
const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS: DWORD = 0x00000004;

pub fn get_module_handle_from_address(addr: usize) -> Option<HMODULE> {
    let mut module: HMODULE = ptr::null_mut();
    // SAFETY: addr cast to LPCWSTR per Win32 docs when FROM_ADDRESS flag set
    let rc = unsafe {
        externs::GetModuleHandleExW(
            // UNCHANGED_REFCOUNT: per MSDN, GetModuleHandleExW increments the
            // module's reference count unless this flag is set. Callers only
            // inspect the returned HMODULE (crash-handler symbolication) and
            // never FreeLibrary it, so omitting the flag leaks one refcount
            // per call.
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            // Docs: when FROM_ADDRESS is set, lpModuleName is "an address in
            // the module" — typed as LPCWSTR but really an opaque pointer.
            addr as *mut c_void,
            &mut module,
        )
    };
    // If the function succeeds, the return value is nonzero.
    if rc != 0 { Some(module) } else { None }
}

pub fn get_module_name_w(module: HMODULE, buf: &mut [u16]) -> Option<&[u16]> {
    // SAFETY: buf valid for buf.len()
    let rc = unsafe {
        externs::GetModuleFileNameW(
            module,
            buf.as_mut_ptr(),
            u32::try_from(buf.len()).expect("int cast"),
        )
    };
    if rc == 0 {
        return None;
    }
    Some(&buf[0..(rc as usize)])
}

/// Leaks it: for a process that is about to end.
pub fn name_of_current_thread() -> &'static [u16] {
    let mut name = ptr::null_mut();
    // SAFETY: on success it points `name` to a new NUL-terminated string.
    unsafe {
        match externs::GetThreadDescription(externs::GetCurrentThread(), &raw mut name) {
            0.. if !name.is_null() => bun_core::ffi::wstr_units(name),
            _ => &[],
        }
    }
}

pub const ENABLE_ECHO_INPUT: DWORD = 0x004;
pub const ENABLE_LINE_INPUT: DWORD = 0x002;
pub const ENABLE_PROCESSED_INPUT: DWORD = 0x001;
pub const ENABLE_VIRTUAL_TERMINAL_INPUT: DWORD = 0x200;
pub const ENABLE_WRAP_AT_EOL_OUTPUT: DWORD = 0x0002;
pub const ENABLE_PROCESSED_OUTPUT: DWORD = 0x0001;

pub use bun_windows_sys::externs::GetConsoleCP;
pub use bun_windows_sys::externs::GetConsoleOutputCP;
pub use bun_windows_sys::externs::SetConsoleCP;
pub use bun_windows_sys::externs::SetStdHandle;

pub struct DeleteFileOptions {
    pub(crate) dir: Option<HANDLE>,
    pub(crate) remove_dir: bool,
}

impl Default for DeleteFileOptions {
    fn default() -> Self {
        Self {
            dir: None,
            remove_dir: false,
        }
    }
}

const FILE_DISPOSITION_DELETE: ULONG = 0x00000001;
const FILE_DISPOSITION_POSIX_SEMANTICS: ULONG = 0x00000002;
const FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE: ULONG = 0x00000010;

// Copy-paste of the standard library function except without unreachable.
pub fn DeleteFileBun(sub_path_w: &[u16], options: DeleteFileOptions) -> bun_sys::Result<()> {
    let create_options_flags: ULONG = if options.remove_dir {
        FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT
    } else {
        windows::FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT // would we ever want to delete the target instead?
    };

    let object_name = if sub_path_w.starts_with(&[b'.' as u16, 0]) {
        // Windows does not recognize this, but it does work with empty string.
        &sub_path_w[..0]
    } else {
        sub_path_w
    };

    let opened = NtCreateFile(
        options
            .dir
            .filter(|_| !bun_paths::is_absolute_windows_wtf16(sub_path_w)),
        object_name,
        NtCreateFileOptions {
            access_mask: windows::SYNCHRONIZE | windows::DELETE,
            disposition: windows::FILE_OPEN,
            options: create_options_flags,
            attributes: 0,
            sharing_mode: FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        },
    );
    bun_sys::syslog!(
        "NtCreateFile({}, DELETE) = {:?}",
        bun_core::fmt::fmt_path_u16(sub_path_w, Default::default()),
        opened
    );
    let handle = match opened {
        Ok(handle) => handle,
        // Treat `STATUS_DELETE_PENDING`/`STATUS_FILE_DELETED` from the open as
        // success — the target is already (being) deleted, which is what the
        // caller wanted. Recursive `rmSync` on Windows reaches this function via
        // `Syscall::unlinkat`; without this short-circuit it fails with
        // `EBUSY`/`UNKNOWN`→`EFAULT` whenever it races a still-open handle
        // (e.g. node test `tmpdir.refresh()` after a stream-heavy test).
        Err(windows::ntstatus::DELETE_PENDING | windows::ntstatus::FILE_DELETED) => {
            return bun_sys::Result::success();
        }
        Err(rc) => return bun_sys::Result::errno(rc, bun_sys::Tag::open),
    };
    let mut io: IO_STATUS_BLOCK = bun_core::ffi::zeroed();

    // FileDispositionInformationEx (and therefore FILE_DISPOSITION_POSIX_SEMANTICS and FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE)
    // are only supported on NTFS filesystems, so the version check on its own is only a partial solution. To support non-NTFS filesystems
    // like FAT32, we need to fallback to FileDispositionInformation if the usage of FileDispositionInformationEx gives
    // us INVALID_PARAMETER.
    // The same reasoning for win10_rs5 as in os.renameatW() applies (FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE requires >= win10_rs5).
    let mut need_fallback = true;
    // Deletion with posix semantics if the filesystem supports it.
    let mut info = windows::FILE_DISPOSITION_INFORMATION_EX {
        Flags: FILE_DISPOSITION_DELETE
            | FILE_DISPOSITION_POSIX_SEMANTICS
            | FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };

    // SAFETY: handle and io are valid
    let mut rc = unsafe {
        ntdll::NtSetInformationFile(
            handle.as_raw_handle(),
            &mut io,
            core::ptr::from_mut(&mut info).cast::<c_void>(),
            size_of::<windows::FILE_DISPOSITION_INFORMATION_EX>() as u32,
            windows::FileInformationClass::FileDispositionInformationEx,
        )
    };
    bun_sys::syslog!(
        "NtSetInformationFile({}, DELETE) = {:?}",
        bun_core::fmt::fmt_path_u16(sub_path_w, Default::default()),
        rc
    );
    match rc {
        x if x == windows::ntstatus::SUCCESS => return bun_sys::Result::success(),
        // INVALID_PARAMETER here means that the filesystem does not support FileDispositionInformationEx
        x if x == windows::ntstatus::INVALID_PARAMETER => {}
        // For all other statuses, fall down to the switch below to handle them.
        _ => need_fallback = false,
    }
    if need_fallback {
        // Deletion with file pending semantics, which requires waiting or moving
        // files to get them removed (from here).
        let mut file_dispo = windows::FILE_DISPOSITION_INFORMATION {
            DeleteFile: TRUE as BOOLEAN,
        };

        // SAFETY: handle and io are valid
        rc = unsafe {
            ntdll::NtSetInformationFile(
                handle.as_raw_handle(),
                &mut io,
                core::ptr::from_mut(&mut file_dispo).cast::<c_void>(),
                size_of::<windows::FILE_DISPOSITION_INFORMATION>() as u32,
                windows::FileInformationClass::FileDispositionInformation,
            )
        };
        bun_sys::syslog!(
            "NtSetInformationFile({}, DELETE) = {:?}",
            bun_core::fmt::fmt_path_u16(sub_path_w, Default::default()),
            rc
        );
    }
    // Another handle already set the delete disposition; the file is on its
    // way out, which is what the caller asked for. Checked here so it covers
    // both the FileDispositionInformationEx result and the legacy fallback.
    if rc == windows::ntstatus::DELETE_PENDING || rc == windows::ntstatus::FILE_DELETED {
        return bun_sys::Result::success();
    }
    if let Some(err) = bun_sys::Result::<()>::errno_sys(rc, bun_sys::Tag::NtSetInformationFile) {
        return err;
    }

    bun_sys::Result::success()
}

pub const EXCEPTION_CONTINUE_EXECUTION: i32 = -1;
pub const EXCEPTION_CONTINUE_SEARCH: i32 = 0;
pub const MS_VC_EXCEPTION: u32 = 0x406d1388;

/// `EXCEPTION_DISPOSITION` (excpt.h): return type of a `PEXCEPTION_ROUTINE`
/// language-specific handler. A different enum from the filter/VEH constants
/// above (`EXCEPTION_CONTINUE_SEARCH == 0` there, `ExceptionContinueSearch ==
/// 1` here); mixing the two turns "continue search" into "resume at fault".
#[allow(nonstandard_style)]
pub mod disposition {
    use core::ffi::c_long;
    pub const ExceptionContinueExecution: c_long = 0;
    pub const ExceptionContinueSearch: c_long = 1;
}

/// `EXCEPTION_UNWIND` (winnt.h): mask of `ExceptionFlags` bits set during the
/// unwind (not search) phase of frame-based dispatch.
pub const EXCEPTION_UNWIND: u32 = 0x66;

/// `[base, base + SizeOfImage)` of the process executable, read once from the
/// mapped PE header. The crash handler uses this to tell first-chance
/// exceptions raised inside Bun's own code from those raised inside foreign
/// modules.
pub fn exe_image_range() -> core::ops::Range<usize> {
    // SAFETY: null module name returns the exe's HMODULE, which on Windows is
    // its mapped base address. The IMAGE_DOS_HEADER at `base` and
    // IMAGE_NT_HEADERS at `base + e_lfanew` are part of the loader-mapped
    // image and remain valid for the process lifetime.
    unsafe {
        let base = bun_windows_sys::kernel32::GetModuleHandleW(ptr::null()) as usize;
        let e_lfanew = *(base as *const u8).add(0x3C).cast::<u32>() as usize;
        // IMAGE_NT_HEADERS64: Signature(4) + IMAGE_FILE_HEADER(20) +
        // IMAGE_OPTIONAL_HEADER64.SizeOfImage at offset 56.
        let size_of_image = *(base as *const u8)
            .add(e_lfanew + 4 + 20 + 56)
            .cast::<u32>() as usize;
        base..base + size_of_image
    }
}

// `STATUS_*` values surfaced as `ExceptionCode` (winnt.h).
pub const EXCEPTION_ACCESS_VIOLATION: u32 = 0xC0000005;
pub const EXCEPTION_DATATYPE_MISALIGNMENT: u32 = 0x80000002;
pub const EXCEPTION_ILLEGAL_INSTRUCTION: u32 = 0xC000001D;
pub const EXCEPTION_STACK_OVERFLOW: u32 = 0xC00000FD;
/// Exit code of a process terminated by the default `CTRL_C_EVENT` handler.
pub const STATUS_CONTROL_C_EXIT: u32 = 0xC000013A;

/// `EXCEPTION_RECORD` (winnt.h).
#[repr(C)]
pub struct EXCEPTION_RECORD {
    pub ExceptionCode: u32,
    pub ExceptionFlags: u32,
    pub ExceptionRecord: *mut EXCEPTION_RECORD,
    pub ExceptionAddress: *mut core::ffi::c_void,
    pub NumberParameters: u32,
    pub ExceptionInformation: [usize; 15],
}
/// `EXCEPTION_POINTERS` (winnt.h) — passed to vectored handlers.
#[repr(C)]
pub struct EXCEPTION_POINTERS<'a> {
    pub ExceptionRecord: &'a EXCEPTION_RECORD,
    pub ContextRecord: Option<&'a CONTEXT>,
}

/// Best-effort `major.build` string from `RtlGetVersion`. Cached in a
/// `OnceLock<String>` so the per-call allocation goes away after the first
/// call.
pub fn detect_runtime_version() -> &'static str {
    #[repr(C)]
    struct OSVERSIONINFOW {
        dwOSVersionInfoSize: u32,
        dwMajorVersion: u32,
        dwMinorVersion: u32,
        dwBuildNumber: u32,
        dwPlatformId: u32,
        szCSDVersion: [u16; 128],
    }
    unsafe extern "system" {
        fn RtlGetVersion(info: &mut OSVERSIONINFOW) -> i32;
    }
    static CACHE: std::sync::OnceLock<std::string::String> = std::sync::OnceLock::new();
    bun_core::impl_zeroable!(OSVERSIONINFOW);
    CACHE.get_or_init(|| {
        let mut info: OSVERSIONINFOW = bun_core::ffi::zeroed();
        info.dwOSVersionInfoSize = core::mem::size_of::<OSVERSIONINFOW>() as u32;
        // SAFETY: `info` is as large as it says.
        if unsafe { RtlGetVersion(&mut info) } != 0 {
            return std::string::String::from("unknown");
        }
        std::format!("{}.{}", info.dwMajorVersion, info.dwBuildNumber)
    })
}

pub use bun_windows_sys::externs::InitializeProcThreadAttributeList;

pub use bun_windows_sys::externs::UpdateProcThreadAttribute;

pub use bun_windows_sys::externs::IsProcessInJob;

pub(crate) const EXTENDED_STARTUPINFO_PRESENT: DWORD = 0x80000;
pub(crate) const PROC_THREAD_ATTRIBUTE_JOB_LIST: DWORD = 0x2000D;

/// Handle to a Windows pseudoconsole (ConPTY).
pub use bun_windows_sys::externs::HPCON;

mod pseudo_console;
pub use pseudo_console::PseudoConsole;

pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x2000;
pub(crate) const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION: DWORD = 0x400;
pub(crate) const JOB_OBJECT_LIMIT_BREAKAWAY_OK: DWORD = 0x800;
pub(crate) const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK: DWORD = 0x00001000;

/// `LimitFlags` for a kill-on-close Job whose members are added by
/// inheritance (`--no-orphans`, the parallel-test coordinator). Omits
/// `SILENT_BREAKAWAY_OK` on purpose: that would make every child escape the
/// Job. libuv's global job sets it because libuv assigns each child itself.
const JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE: DWORD = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
    | JOB_OBJECT_LIMIT_BREAKAWAY_OK;

/// An anonymous Job.
fn CreateJobObjectA() -> Result<OwnedHandle, Win32Error> {
    // SAFETY: null arguments ask for an anonymous Job; the result is a new handle or null.
    let job = unsafe {
        HandleOrNull::from_raw_handle(externs::CreateJobObjectA(ptr::null_mut(), ptr::null()))
    };
    OwnedHandle::try_from(job).map_err(|_| Win32Error::get())
}

/// `SetInformationJobObject(job, JobObjectExtendedLimitInformation)` with only `LimitFlags` set.
fn set_job_limit_flags(job: &OwnedHandle, limit_flags: DWORD) -> Result<(), Win32Error> {
    let mut jeli: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = bun_core::ffi::zeroed();
    jeli.BasicLimitInformation.LimitFlags = limit_flags;
    // SAFETY: `jeli` is readable for the size given.
    check(unsafe {
        externs::SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&raw mut jeli).cast(),
            size_of_val(&jeli) as u32,
        )
    })
}

/// An anonymous Job. Dropping it ends its members.
pub fn create_kill_on_close_job() -> Option<OwnedHandle> {
    let job = CreateJobObjectA().ok()?;
    set_job_limit_flags(&job, JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE).ok()?;
    Some(job)
}

pub mod rescle {
    use super::*;

    unsafe extern "C" {
        fn rescle__setWindowsMetadata(
            exe_path: *const u16,    // exe_path
            icon_path: *const u16,   // icon_path (nullable)
            title: *const u16,       // title (nullable)
            publisher: *const u16,   // publisher (nullable)
            version: *const u16,     // version (nullable)
            description: *const u16, // description (nullable)
            copyright: *const u16,   // copyright (nullable)
        ) -> c_int;
    }

    #[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
    pub enum RescleError {
        #[error("IconEditError")]
        IconEditError,
        #[error("InvalidVersionFormat")]
        InvalidVersionFormat,
        #[error("FailedToLoadExecutable")]
        FailedToLoadExecutable,
        #[error("FailedToSetIcon")]
        FailedToSetIcon,
        #[error("FailedToSetProductName")]
        FailedToSetProductName,
        #[error("FailedToSetCompanyName")]
        FailedToSetCompanyName,
        #[error("FailedToSetDescription")]
        FailedToSetDescription,
        #[error("FailedToSetCopyright")]
        FailedToSetCopyright,
        #[error("FailedToSetFileVersion")]
        FailedToSetFileVersion,
        #[error("FailedToSetProductVersion")]
        FailedToSetProductVersion,
        #[error("FailedToSetFileVersionString")]
        FailedToSetFileVersionString,
        #[error("FailedToSetProductVersionString")]
        FailedToSetProductVersionString,
        #[error("FailedToCommit")]
        FailedToCommit,
        #[error("WindowsMetadataEditError")]
        WindowsMetadataEditError,
        #[error(transparent)]
        Utf16(#[from] bun_core::strings::ToUTF16Error),
    }

    pub fn set_windows_metadata(
        exe_path: &WStr,
        icon: Option<&[u8]>,
        title: Option<&[u8]>,
        publisher: Option<&[u8]>,
        version: Option<&[u8]>,
        description: Option<&[u8]>,
        copyright: Option<&[u8]>,
    ) -> Result<(), RescleError> {
        const _: () = assert!(cfg!(windows));

        // Validate version string format if provided
        if let Some(v) = version {
            // Empty version string is invalid
            if v.is_empty() {
                return Err(RescleError::InvalidVersionFormat.into());
            }

            // Basic validation: check format and ranges
            let mut parts_count: u32 = 0;
            for part in bun_core::strings::tokenize(v, b".") {
                if parts_count >= 4 {
                    return Err(RescleError::InvalidVersionFormat.into());
                }
                let Ok(_num) = bun_core::fmt::parse_int::<u16>(part, 10) else {
                    return Err(RescleError::InvalidVersionFormat.into());
                };
                // u16 already ensures value is 0-65535
                parts_count += 1;
            }
            if parts_count == 0 {
                return Err(RescleError::InvalidVersionFormat.into());
            }
        }

        // Allocate UTF-16 strings (global mimalloc; allocator param dropped)

        // Icon is a path, so use toWPathNormalized with proper buffer handling
        let mut icon_buf = bun_paths::w_path_buffer_pool::get();
        let icon_w: Option<&bun_core::WStr> = if let Some(i) = icon {
            let path_w = bun_paths::string_paths::to_w_path_normalized(&mut icon_buf, i);
            // toWPathNormalized returns a slice into icon_buf, need to null-terminate it
            let len = path_w.len();
            let buf_u16 = icon_buf.as_mut_slice();
            buf_u16[len] = 0;
            // SAFETY: buf_u16[len] == 0 written above; pointer + len form a valid NUL-terminated wide slice
            Some(bun_core::WStr::from_buf(&buf_u16[..], len))
        } else {
            None
        };

        let title_w = title
            .map(|t| bun_core::strings::to_utf16_alloc_for_real(t, false, true))
            .transpose()?;
        let publisher_w = publisher
            .map(|p| bun_core::strings::to_utf16_alloc_for_real(p, false, true))
            .transpose()?;
        let version_w = version
            .map(|v| bun_core::strings::to_utf16_alloc_for_real(v, false, true))
            .transpose()?;
        let description_w = description
            .map(|d| bun_core::strings::to_utf16_alloc_for_real(d, false, true))
            .transpose()?;
        let copyright_w = copyright
            .map(|cr| bun_core::strings::to_utf16_alloc_for_real(cr, false, true))
            .transpose()?;

        // SAFETY: all pointers are NUL-terminated wide strings or null
        let status = unsafe {
            rescle__setWindowsMetadata(
                exe_path.as_ptr(),
                icon_w.map_or(ptr::null(), |iw| iw.as_ptr()),
                title_w.as_ref().map_or(ptr::null(), |tw| tw.as_ptr()),
                publisher_w.as_ref().map_or(ptr::null(), |pw| pw.as_ptr()),
                version_w.as_ref().map_or(ptr::null(), |vw| vw.as_ptr()),
                description_w.as_ref().map_or(ptr::null(), |dw| dw.as_ptr()),
                copyright_w.as_ref().map_or(ptr::null(), |cw| cw.as_ptr()),
            )
        };
        match status {
            0 => Ok(()),
            -1 => Err(RescleError::FailedToLoadExecutable.into()),
            -2 => Err(RescleError::FailedToSetIcon.into()),
            -3 => Err(RescleError::FailedToSetProductName.into()),
            -4 => Err(RescleError::FailedToSetCompanyName.into()),
            -5 => Err(RescleError::FailedToSetDescription.into()),
            -6 => Err(RescleError::FailedToSetCopyright.into()),
            -7 => Err(RescleError::FailedToSetFileVersion.into()),
            -8 => Err(RescleError::FailedToSetProductVersion.into()),
            -9 => Err(RescleError::FailedToSetFileVersionString.into()),
            -10 => Err(RescleError::FailedToSetProductVersionString.into()),
            -11 => Err(RescleError::InvalidVersionFormat.into()),
            -12 => Err(RescleError::FailedToCommit.into()),
            _ => Err(RescleError::WindowsMetadataEditError.into()),
        }
    }
}

pub use bun_windows_sys::externs::CreateDirectoryW;
pub use bun_windows_sys::externs::CreateSymbolicLinkW;
pub use bun_windows_sys::externs::DeleteFileW;

/// In 100-ns ticks.
pub struct ProcessTimes {
    pub creation: u64,
    pub kernel: u64,
    pub user: u64,
}

pub fn GetProcessTimes(process: HANDLE) -> Result<ProcessTimes, Win32Error> {
    let [mut creation, mut exit, mut kernel, mut user]: [FILETIME; 4] = bun_core::ffi::zeroed();
    // SAFETY: each is a valid out-param.
    check(unsafe {
        externs::GetProcessTimes(
            process,
            &raw mut creation,
            &raw mut exit,
            &raw mut kernel,
            &raw mut user,
        )
    })?;
    let ticks = |t: FILETIME| (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime);
    Ok(ProcessTimes {
        creation: ticks(creation),
        kernel: ticks(kernel),
        user: ticks(user),
    })
}

pub fn GetProcessIoCounters(process: HANDLE) -> Result<IO_COUNTERS, Win32Error> {
    let mut counters = IO_COUNTERS::default();
    check(kernel32::GetProcessIoCounters(process, &mut counters))?;
    Ok(counters)
}

/// `PROCESS_MEMORY_COUNTERS` (`psapi.h`).
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct PROCESS_MEMORY_COUNTERS {
    pub(crate) cb: DWORD,
    pub(crate) PageFaultCount: DWORD,
    pub PeakWorkingSetSize: usize,
    pub(crate) WorkingSetSize: usize,
    pub(crate) QuotaPeakPagedPoolUsage: usize,
    pub(crate) QuotaPagedPoolUsage: usize,
    pub(crate) QuotaPeakNonPagedPoolUsage: usize,
    pub(crate) QuotaNonPagedPoolUsage: usize,
    pub(crate) PagefileUsage: usize,
    pub(crate) PeakPagefileUsage: usize,
}

/// psapi `K32GetProcessMemoryInfo`
/// (kernel32 hosts the K32* shims since Windows 7, no separate psapi.lib).
pub fn GetProcessMemoryInfo(process: HANDLE) -> Result<PROCESS_MEMORY_COUNTERS, Win32Error> {
    unsafe extern "system" {
        fn K32GetProcessMemoryInfo(
            hProcess: HANDLE,
            ppsmemCounters: &mut PROCESS_MEMORY_COUNTERS,
            cb: DWORD,
        ) -> BOOL;
    }
    let cb = size_of::<PROCESS_MEMORY_COUNTERS>() as DWORD;
    let mut out = PROCESS_MEMORY_COUNTERS {
        cb,
        ..Default::default()
    };
    // SAFETY: `out` holds `cb` bytes.
    check(unsafe { K32GetProcessMemoryInfo(process, &mut out, cb) })?;
    Ok(out)
}
pub use bun_windows_sys::externs::GetConsoleMode;

#[derive(Default)]
pub struct UpdateStdioModeFlagsOpts {
    pub set: DWORD,
    pub unset: DWORD,
}

/// Returns the original mode, or null on failure
fn update_stdio_mode_flags(
    i: bun_sys::Stdio,
    opts: UpdateStdioModeFlagsOpts,
) -> Result<DWORD, SystemErrno> {
    let fd = i.fd();
    let mut original_mode: DWORD = 0;
    if kernel32_2::GetConsoleMode(fd.native(), &mut original_mode) == 0
        || kernel32_2::SetConsoleMode(fd.native(), (original_mode | opts.set) & !opts.unset) == 0
    {
        return Err(Win32Error::get().to_system_errno());
    }
    Ok(original_mode)
}

/// RAII guard: applies [`update_stdio_mode_flags`] to **stdin** on construction
/// and restores the original console mode on `Drop`.
///
/// If the underlying `GetConsoleMode`/`SetConsoleMode` fails (e.g. stdin is not
/// a console), the guard is inert and `Drop` is a no-op.
pub struct StdinModeGuard {
    original: Option<DWORD>,
}

impl StdinModeGuard {
    #[inline]
    pub fn set(opts: UpdateStdioModeFlagsOpts) -> Self {
        Self {
            original: update_stdio_mode_flags(bun_sys::Stdio::StdIn, opts).ok(),
        }
    }
}

impl Drop for StdinModeGuard {
    #[inline]
    fn drop(&mut self) {
        if let Some(mode) = self.original {
            let _ = kernel32_2::SetConsoleMode(bun_sys::Stdio::StdIn.fd().native(), mode);
        }
    }
}

const WATCHER_CHILD_ENV: &WStr = bun_core::wstr!("_BUN_WATCHER_CHILD");

// magic exit code to indicate to the watcher manager that the child process should be re-spawned
// this was randomly generated - we need to avoid using a common exit code that might be used by the script itself
pub(crate) const WATCHER_RELOAD_EXIT: DWORD = 3224497970;

pub fn is_watcher_child() -> bool {
    GetEnvironmentVariableW(WATCHER_CHILD_ENV, &mut [0]) > 0
}

pub fn become_watcher_manager() -> ! {
    // this process will be the parent of the child process that actually runs the script
    unsafe extern "C" {
        // safe: no args; C++ shim mutates process-global stdio inheritance
        // flags — no preconditions.
        safe fn windows_enable_stdio_inheritance();
    }
    windows_enable_stdio_inheritance();
    let job = CreateJobObjectA().unwrap_or_else(|err| {
        // Print the Win32 error name, not the raw DWORD.
        bun_core::Output::panic(format_args!(
            "Could not create watcher Job Object: {:?}",
            err
        ))
    });
    if let Err(err) = set_job_limit_flags(
        &job,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_BREAKAWAY_OK
            | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
            | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
    ) {
        bun_core::Output::panic(format_args!(
            "Could not configure watcher Job Object: {:?}",
            err
        ));
    }

    loop {
        let child = spawn_watcher_child(job.as_raw_handle()).unwrap_or_else(|code| {
            // The executable can be renamed or replaced while `--watch` runs.
            bun_core::err_generic!(
                "Failed to start \"<b>{}<r>\": {} <d>(CreateProcessW)<r>",
                bun_core::fmt::utf16(exe_path_w().as_slice()),
                <&'static str>::from(code.to_system_errno()),
            );
            bun_core::Output::flush();
            bun_core::Global::exit(1);
        });
        // `kernel32::WaitForSingleObject` is the local `safe fn` re-decl
        // (by-value `HANDLE`/`DWORD` only); check `WAIT_FAILED` inline.
        if kernel32::WaitForSingleObject(child.as_raw_handle(), win32::INFINITE)
            == externs::WAIT_FAILED
        {
            let err = Win32Error::get();
            bun_core::Output::panic(format_args!(
                "Failed to wait for child process: {}\n",
                err.0
            ));
        }
        let mut exit_code: DWORD = 0;
        if kernel32_2::GetExitCodeProcess(child.as_raw_handle(), &mut exit_code) == 0 {
            let err = Win32Error::get();
            bun_core::Output::panic(format_args!(
                "Failed to get exit code of child process: {:?}\n",
                err
            ));
        }

        // magic exit code to indicate that the child process should be re-spawned
        if exit_code == WATCHER_RELOAD_EXIT {
            continue;
        } else {
            bun_core::Global::exit(exit_code);
        }
    }
}

/// Returns the failing call's `GetLastError()` as `Err`.
fn spawn_watcher_child(job: HANDLE) -> Result<OwnedHandle, Win32Error> {
    // https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812
    let mut attr_size: usize = 0;
    // SAFETY: query size with null buffer
    unsafe {
        let _ = externs::InitializeProcThreadAttributeList(ptr::null_mut(), 1, 0, &mut attr_size);
    }
    let mut p: Vec<u8> = vec![0u8; attr_size];
    // SAFETY: p has attr_size bytes
    if unsafe { externs::InitializeProcThreadAttributeList(p.as_mut_ptr(), 1, 0, &mut attr_size) }
        == 0
    {
        return Err(Win32Error::get());
    }
    let mut job_local = job;
    // SAFETY: p initialized above; job_local valid for sizeof(HANDLE)
    if unsafe {
        externs::UpdateProcThreadAttribute(
            p.as_mut_ptr(),
            0,
            PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
            core::ptr::from_mut(&mut job_local).cast::<c_void>(),
            size_of::<HANDLE>(),
            ptr::null_mut(),
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(Win32Error::get());
    }

    // The win32 layer exposes these as DWORD constants — assemble the raw mask.
    const CREATE_UNICODE_ENVIRONMENT: DWORD = 0x00000400;
    let flags: DWORD = CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT;

    let image_path = exe_path_w();
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    wbuf.as_mut_slice()[0..image_path.len()].copy_from_slice(image_path.as_slice());
    wbuf.as_mut_slice()[image_path.len()] = 0;

    // SAFETY: NUL written at [len]
    let image_path_z = bun_core::WStr::from_buf(&wbuf[..], image_path.len());

    let environment = EnvironmentStrings::get();
    let kernelenv = environment
        .as_ref()
        .map_or(&[0][..], |environment| environment.measure().0);
    // Without the empty string that ends the block.
    let size = kernelenv.len() - 1;

    let mut envbuf: Vec<u16> = vec![0u16; size + WATCHER_CHILD_ENV.len() + 4];
    envbuf[..size].copy_from_slice(&kernelenv[..size]);
    envbuf[size..size + WATCHER_CHILD_ENV.len()].copy_from_slice(WATCHER_CHILD_ENV);
    envbuf[size + WATCHER_CHILD_ENV.len()] = b'=' as u16;
    envbuf[size + WATCHER_CHILD_ENV.len() + 1] = b'1' as u16;
    envbuf[size + WATCHER_CHILD_ENV.len() + 2] = 0;
    envbuf[size + WATCHER_CHILD_ENV.len() + 3] = 0;

    let mut startupinfo = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: size_of::<STARTUPINFOEXW>() as u32,
            lpReserved: ptr::null_mut(),
            lpDesktop: ptr::null_mut(),
            lpTitle: ptr::null_mut(),
            dwX: 0,
            dwY: 0,
            dwXSize: 0,
            dwYSize: 0,
            dwXCountChars: 0,
            dwYCountChars: 0,
            dwFillAttribute: 0,
            dwFlags: win32::STARTF_USESTDHANDLES,
            wShowWindow: 0,
            cbReserved2: 0,
            lpReserved2: ptr::null_mut(),
            hStdInput: bun_sys::Fd::stdin().native(),
            hStdOutput: bun_sys::Fd::stdout().native(),
            hStdError: bun_sys::Fd::stderr().native(),
        },
        lpAttributeList: p.as_mut_ptr(),
    };
    let mut procinfo: PROCESS_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: all pointers valid; envbuf double-NUL terminated
    let rc = unsafe {
        kernel32::CreateProcessW(
            image_path_z.as_ptr(),
            externs::GetCommandLineW(),
            ptr::null_mut(),
            ptr::null_mut(),
            1,
            flags,
            envbuf.as_mut_ptr().cast::<c_void>(),
            ptr::null(),
            core::ptr::from_mut(&mut startupinfo).cast::<STARTUPINFOW>(),
            &raw mut procinfo,
        )
    };
    if rc == 0 {
        return Err(Win32Error::get());
    }
    // SAFETY: `CreateProcessW` succeeded, so both are new handles.
    let (process, _thread) = unsafe {
        (
            OwnedHandle::from_raw_handle(procinfo.hProcess),
            OwnedHandle::from_raw_handle(procinfo.hThread),
        )
    };
    let mut is_in_job: BOOL = 0;
    let _ = kernel32_2::IsProcessInJob(process.as_raw_handle(), job, &mut is_in_job);
    debug_assert!(is_in_job != 0);
    Ok(process)
}

/// Returns null on error. Use windows API to lookup the actual error.
/// Implemented here so that we can use our own utf16-conversion functions.
///
/// Using characters16() does not seem to always have the sentinel. or something else
/// broke when I just used it. Not sure. ... but this works!
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__LoadLibraryBunString(str_: &bun_core::String) -> *mut c_void {
    let mut buf = bun_paths::w_path_buffer_pool::get();
    // The path is JS-supplied; over-length input must surface as the same
    // `null + GetLastError()` shape `LoadLibraryExW` itself would yield, not
    // a Rust panic unwinding across the `extern "C"` boundary.
    if str_.encode_into_utf16_buf_z(buf.as_mut_slice()).is_none() {
        kernel32::SetLastError(DWORD::from(Win32Error::FILENAME_EXCED_RANGE.int()));
        return ptr::null_mut();
    }
    const LOAD_WITH_ALTERED_SEARCH_PATH: DWORD = 0x00000008;
    // SAFETY: buf NUL-terminated by `encode_into_utf16_buf_z`.
    unsafe {
        kernel32::LoadLibraryExW(buf.as_ptr(), ptr::null_mut(), LOAD_WITH_ALTERED_SEARCH_PATH)
    }
}

pub use bun_windows_sys::externs::windows_enable_stdio_inheritance;

/// With an open file source_fd, move it into the directory new_dir_fd with the name new_path_w.
/// Does not close the file descriptor.
///
/// For this to succeed
/// - source_fd must have been opened with access_mask=w.DELETE
/// - new_path_w must be the name of a file. it cannot be a path relative to new_dir_fd. see moveOpenedFileAtLoose
pub fn move_opened_file_at(
    src_fd: Fd,
    new_dir_fd: Fd,
    new_file_name: &[u16],
    replace_if_exists: bool,
) -> bun_sys::Result<()> {
    // FILE_RENAME_INFORMATION_EX and FILE_RENAME_POSIX_SEMANTICS require >= win10_rs1,
    // but FILE_RENAME_IGNORE_READONLY_ATTRIBUTE requires >= win10_rs5. We check >= rs5 here
    // so that we only use POSIX_SEMANTICS when we know IGNORE_READONLY_ATTRIBUTE will also be
    // supported in order to avoid either (1) using a redundant call that we can know in advance will return
    // STATUS_NOT_SUPPORTED or (2) only setting IGNORE_READONLY_ATTRIBUTE when >= rs5
    // and therefore having different behavior when the Windows version is >= rs1 but < rs5.
    // Bun's minimum supported Windows version is >= win10_rs5.

    debug_assert!(!new_file_name.contains(&(b'/' as u16))); // Call moveOpenedFileAtLoose

    // The FileName tail here is UTF-16, so the correct cap is
    // `PATH_MAX_WIDE * 2` bytes — sizing against the UTF-8 worst case
    // (PATH_MAX_WIDE*3+1, ≈98 KB) would just waste ~32 KB of stack on a
    // function called from already-deep install/bundler call chains. Any
    // `new_file_name.len() <= PATH_MAX_WIDE` still fits.
    const STRUCT_BUF_LEN: usize =
        size_of::<win32::FILE_RENAME_INFORMATION_EX>() + (bun_paths::PATH_MAX_WIDE * 2 - 1);
    #[repr(align(8))] // align_of FILE_RENAME_INFORMATION_EX
    struct AlignedBuf {
        _buf: [u8; STRUCT_BUF_LEN],
    }
    let mut rename_info_buf = MaybeUninit::<AlignedBuf>::uninit();

    let struct_len = size_of::<win32::FILE_RENAME_INFORMATION_EX>() - 1 + new_file_name.len() * 2;
    if struct_len > STRUCT_BUF_LEN {
        return bun_sys::Result::errno(E::NAMETOOLONG, bun_sys::Tag::NtSetInformationFile);
    }

    // SAFETY: AlignedBuf is #[repr(align(8))] which matches FILE_RENAME_INFORMATION_EX alignment.
    // Kept as a raw pointer (not &mut) so provenance covers the full STRUCT_BUF_LEN bytes; the
    // trailing FileName write extends past size_of::<FILE_RENAME_INFORMATION_EX>() and a &mut
    // reborrow would shrink provenance to just the struct, making that write UB. The buffer is
    // uniquely owned on this stack frame, so no aliasing is possible.
    let rename_info: *mut win32::FILE_RENAME_INFORMATION_EX = rename_info_buf.as_mut_ptr().cast();
    let mut io_status_block: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();

    let mut flags: ULONG =
        win32::FILE_RENAME_POSIX_SEMANTICS | win32::FILE_RENAME_IGNORE_READONLY_ATTRIBUTE;
    if replace_if_exists {
        flags |= win32::FILE_RENAME_REPLACE_IF_EXISTS;
    }
    // SAFETY: rename_info is aligned, non-null, and points into uninitialized storage we own;
    // ptr::write initializes the header without dropping prior (uninit) contents.
    unsafe {
        ptr::write(
            rename_info,
            win32::FILE_RENAME_INFORMATION_EX {
                Flags: flags,
                RootDirectory: if bun_paths::is_absolute_windows_wtf16(new_file_name) {
                    ptr::null_mut()
                } else {
                    new_dir_fd.native()
                },
                FileNameLength: u32::try_from(new_file_name.len() * 2).expect("int cast"), // already checked error.NameTooLong
                FileName: [0; 1], // overwritten below
            },
        );
    }
    // SAFETY: rename_info_buf has STRUCT_BUF_LEN bytes (>= struct_len, checked above) reserved for
    // the variable-length FileName tail. addr_of_mut! on the raw pointer preserves full-buffer
    // provenance so writing new_file_name.len() u16s here stays in-bounds.
    unsafe {
        ptr::copy_nonoverlapping(
            new_file_name.as_ptr(),
            ptr::addr_of_mut!((*rename_info).FileName).cast::<u16>(),
            new_file_name.len(),
        );
    }
    let mut rename_as = |class: win32::FileInformationClass, flags: ULONG| {
        // SAFETY: src_fd valid; rename_info is aligned and has struct_len initialized bytes
        unsafe {
            ptr::addr_of_mut!((*rename_info).Flags).write(flags);
            ntdll::NtSetInformationFile(
                src_fd.native(),
                &mut io_status_block,
                rename_info.cast::<c_void>(),
                u32::try_from(struct_len).expect("int cast"), // already checked for error.NameTooLong
                class,
            )
        }
    };
    let mut rc = rename_as(win32::FileInformationClass::FileRenameInformationEx, flags);
    // exFAT and FAT32 only implement the legacy class, where `Flags` is `BOOLEAN ReplaceIfExists`.
    if rc == win32::ntstatus::INVALID_PARAMETER {
        rc = rename_as(
            win32::FileInformationClass::FileRenameInformation,
            ULONG::from(replace_if_exists),
        );
    }
    bun_sys::syslog!(
        "moveOpenedFileAt({} ->> {} '{}', {}) = {}",
        src_fd,
        new_dir_fd,
        bun_core::fmt::utf16(new_file_name),
        if replace_if_exists {
            "replace_if_exists"
        } else {
            "no flag"
        },
        format_args!("{:?}", rc)
    );

    #[cfg(debug_assertions)]
    if rc == win32::ntstatus::ACCESS_DENIED {
        bun_core::debug_warn!(
            "moveOpenedFileAt was called on a file descriptor without access_mask=w.DELETE",
        );
    }

    if rc == win32::ntstatus::SUCCESS {
        bun_sys::Result::success()
    } else {
        bun_sys::Result::errno(rc, bun_sys::Tag::NtSetInformationFile)
    }
}

/// Rename `old_path_w` (relative to `old_dir_fd`) to `new_path_w` (relative to
/// `new_dir_fd`) via NT file-information rename. Surfaces more error cases
/// than typical rename wrappers.
pub(crate) fn rename_at_w(
    old_dir_fd: Fd,
    old_path_w: &[u16],
    new_dir_fd: Fd,
    new_path_w: &[u16],
    replace_if_exists: bool,
) -> bun_sys::Result<()> {
    // FILE_TRAVERSE is FILE_EXECUTE for files and can force synchronous antivirus scans.
    let src = bun_sys::CloseOnDrop::new(bun_sys::open_file_at_windows(
        old_dir_fd,
        old_path_w,
        bun_sys::NtCreateFileOptions {
            access_mask: win32::SYNCHRONIZE | win32::GENERIC_WRITE | win32::DELETE,
            disposition: win32::FILE_OPEN,
            options: win32::FILE_SYNCHRONOUS_IO_NONALERT | win32::FILE_OPEN_REPARSE_POINT,
            ..Default::default()
        },
    )?);

    move_opened_file_at(src.fd(), new_dir_fd, new_path_w, replace_if_exists)
}

mod kernel32_2 {
    use super::*;
    unsafe extern "system" {
        /// No preconditions; allocates and returns the env block (or null).
        pub(super) safe fn GetEnvironmentStringsW() -> LPWSTR;
        pub(super) fn FreeEnvironmentStringsW(penv: LPWSTR) -> BOOL;
        pub(super) fn GetEnvironmentVariableW(
            lpName: LPCWSTR,
            lpBuffer: *mut WCHAR,
            nSize: DWORD,
        ) -> DWORD;
        // safe: by-value `HANDLE`/`DWORD` only; bad handle → BOOL 0 +
        // GetLastError, never UB. Out-param is `&mut DWORD` (non-null, valid
        // for write). Local `safe fn` re-decls so in-crate callers drop the
        // per-site `unsafe { }`; the `bun_windows_sys::externs` raw decls stay
        // re-exported for out-of-crate callers.
        pub(super) safe fn GetConsoleMode(hConsoleHandle: HANDLE, lpMode: &mut DWORD) -> BOOL;
        pub(super) safe fn SetConsoleMode(hConsoleHandle: HANDLE, dwMode: DWORD) -> BOOL;
        pub(super) safe fn GetExitCodeProcess(hProcess: HANDLE, lpExitCode: &mut DWORD) -> BOOL;
        // safe: by-value `HANDLE`×2; out-param is `&mut BOOL` (non-null, valid
        // for write). Bad handle → BOOL 0 + GetLastError, never UB.
        pub(super) safe fn IsProcessInJob(
            hProcess: HANDLE,
            hJob: HANDLE,
            result: &mut BOOL,
        ) -> BOOL;
    }
}

/// A copy of the environment block: NUL-terminated strings, the last one empty.
pub(crate) struct EnvironmentStrings(ptr::NonNull<u16>);

impl EnvironmentStrings {
    pub(crate) fn get() -> Option<Self> {
        ptr::NonNull::new(kernel32_2::GetEnvironmentStringsW()).map(Self)
    }

    /// The whole block, including every NUL, and the number of NULs.
    pub(crate) fn measure(&self) -> (&[u16], usize) {
        let block = self.0.as_ptr();
        let (mut len, mut strings) = (0, 0);
        loop {
            // SAFETY: a string starts at `len`, because the previous one was not empty.
            let str_len = unsafe { bun_core::ffi::wcslen(block.add(len)) };
            len += str_len + 1;
            strings += 1;
            if str_len == 0 {
                break;
            }
        }
        // SAFETY: `len` units were just read, and the block lives until `drop`.
        (unsafe { core::slice::from_raw_parts(block, len) }, strings)
    }
}

impl Drop for EnvironmentStrings {
    fn drop(&mut self) {
        // SAFETY: from `GetEnvironmentStringsW`, and freed nowhere else.
        let rc = unsafe { kernel32_2::FreeEnvironmentStringsW(self.0.as_ptr()) };
        debug_assert!(rc != 0);
    }
}

/// Returns the length written (0 if `name` is not set), or the size needed if `buf` is too small.
pub fn GetEnvironmentVariableW(name: &WStr, buf: &mut [u16]) -> usize {
    // SAFETY: `name` is NUL-terminated; it writes at most `buf.len()` units.
    let rc = unsafe {
        kernel32_2::GetEnvironmentVariableW(name.as_ptr(), buf.as_mut_ptr(), buf.len() as DWORD)
    };
    rc as usize
}

/// `None` deletes the variable.
pub fn SetEnvironmentVariableW(name: &WStr, value: Option<&WStr>) -> Result<(), Win32Error> {
    let value = value.map_or(ptr::null(), WStr::as_ptr);
    // SAFETY: `name` is NUL-terminated; `value` is null or NUL-terminated.
    check(unsafe { externs::SetEnvironmentVariableW(name.as_ptr(), value) })
}

pub mod env;
pub mod private_folder;
pub(crate) mod sync_io;

// ──────────────────────────────────────────────────────────────────────────
// Additional surface unblocked for dependents.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.windows.getenvW` — read a UTF-16 env var into an owned `Vec<u16>`.
pub fn getenv_w(name: &WStr) -> Option<Vec<u16>> {
    let mut buf = vec![0u16; 256];
    loop {
        let n = GetEnvironmentVariableW(name, &mut buf);
        if n == 0 {
            return None;
        }
        if n < buf.len() {
            buf.truncate(n);
            return Some(buf);
        }
        buf.resize(n + 1, 0);
    }
}

// `bun.windows.libuv` — re-exported as `pub use bun_libuv_sys as libuv` above.
// The duplicate inline `pub mod libuv { ... }` that lived here caused E0260 and
// has been removed; its items belong in `bun_libuv_sys`.

bun_core::declare_scope!(windowsUserUniqueId, visible);

// SetFilePointerEx referenced via the `pub use` at the top of this module.

#[cfg(test)]
mod tests {
    use super::{
        DeleteFileBun, DeleteFileOptions, E, EnvironmentStrings, Win32Error, Win32ErrorExt as _,
        check_len, system_volume_device,
    };
    use crate::{Error, Tag};

    /// A Win32 code with no entry in `SystemErrno::init_win32_error`.
    const UNMAPPED: Win32Error = Win32Error(0xFFFE);

    /// A failed Win32 call can leave a code with no row in the table (e.g.
    /// `ERROR_BAD_NET_NAME` from `CopyFileW` to a missing share) or 0; neither
    /// may read as success.
    #[test]
    fn to_e_never_success() {
        assert_eq!(Win32Error::FILE_NOT_FOUND.to_e(), E::NOENT);
        assert_eq!(UNMAPPED.to_e(), E::UNKNOWN);
        assert_eq!(Win32Error::SUCCESS.to_e(), E::UNKNOWN);
        // `HRESULT_FROM_WIN32(ERROR_ACCESS_DENIED)` unwraps; other HRESULTs do not.
        assert_eq!(Win32Error::from_u32(0x8007_0005).to_e(), E::PERM);
        assert_eq!(Win32Error::from_u32(0x8000_4005).to_e(), E::UNKNOWN);
        assert_eq!(Win32Error::from_u32(5), Win32Error::ACCESS_DENIED);
        assert_eq!(
            Error::from_win32(UNMAPPED, Tag::open).get_errno(),
            E::UNKNOWN
        );
        assert_eq!(
            Error::from_win32(Win32Error::ACCESS_DENIED, Tag::open).get_errno(),
            E::PERM
        );
    }

    /// Outside an AppContainer this exercises the same open + NT/NONE split
    /// the lowbox fallback relies on; the system directory is always present.
    #[test]
    fn system_volume_device_resolves() {
        let (device, letter) = system_volume_device().expect("system volume");
        assert!((*letter as u8).is_ascii_uppercase());
        let prefix: Vec<u16> = "\\Device\\".encode_utf16().collect();
        assert!(device.starts_with(&prefix));
    }

    #[test]
    fn check_len_needs_room_for_the_nul() {
        assert_eq!(check_len(3, 4), Ok(3));
        assert_eq!(check_len(4, 4), Err(Win32Error::FILENAME_EXCED_RANGE));
        assert_eq!(check_len(5, 4), Err(Win32Error::FILENAME_EXCED_RANGE));
    }

    #[test]
    fn delete_file_bun_rejects_a_name_above_32767_units() {
        let name = vec![u16::from(b'a'); 32768];
        let err = DeleteFileBun(&name, DeleteFileOptions::default()).unwrap_err();
        assert_eq!(err.get_errno(), E::NAMETOOLONG);
    }

    #[test]
    fn environment_strings_end_at_the_first_empty_string() {
        let environment = EnvironmentStrings::get().expect("environment block");
        let (block, _) = environment.measure();
        let first_empty = block.windows(2).position(|pair| pair == [0, 0]);
        assert_eq!(first_empty, Some(block.len() - 2));
    }
}
