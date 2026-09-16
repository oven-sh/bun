//! Win32 declarations process creation needs.

#![allow(non_snake_case, non_camel_case_types, clippy::upper_case_acronyms)]

use core::ffi::c_int;

pub use bun_windows_sys::externs::kernel32::{
    CreateNamedPipeW, CreateProcessW, DuplicateHandle, GetCurrentProcess, GetExitCodeProcess,
    GetLastError, ReadFile,
};
pub use bun_windows_sys::externs::{
    AssignProcessToJobObject, BOOL, CloseHandle, CreateFileW, CreateJobObjectW,
    DUPLICATE_SAME_ACCESS, DWORD, FILE_ATTRIBUTE_DIRECTORY, FILE_FLAG_OVERLAPPED, FILE_SHARE_READ,
    FILE_SHARE_WRITE, FILETIME, GENERIC_READ, GENERIC_WRITE, GetCurrentDirectoryW,
    GetFileAttributesW, GetProcessTimes, HANDLE, HANDLE_FLAG_INHERIT, HPCON, INFINITE,
    INVALID_HANDLE_VALUE, InitializeProcThreadAttributeList, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, MAX_PATH, OPEN_EXISTING, OVERLAPPED, OpenProcess,
    PIPE_ACCESS_INBOUND, PIPE_ACCESS_OUTBOUND, PROCESS_INFORMATION, SECURITY_ATTRIBUTES,
    STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW, SetHandleInformation,
    SetInformationJobObject, UpdateProcThreadAttribute, WAIT_FAILED, Win32Error,
};

pub const INVALID_FILE_ATTRIBUTES: DWORD = DWORD::MAX;

pub const FILE_TYPE_UNKNOWN: DWORD = 0;
pub const FILE_TYPE_DISK: DWORD = 1;
pub const FILE_TYPE_CHAR: DWORD = 2;
pub const FILE_TYPE_PIPE: DWORD = 3;
pub const FILE_TYPE_REMOTE: DWORD = 0x8000;

pub const FILE_READ_ATTRIBUTES: DWORD = 0x0080;
pub const FILE_WRITE_ATTRIBUTES: DWORD = 0x0100;
pub const WRITE_DAC: DWORD = 0x0004_0000;
pub const FILE_GENERIC_READ: DWORD = 0x0012_0089;
pub const FILE_GENERIC_WRITE: DWORD = 0x0012_0116;

pub const FILE_FLAG_FIRST_PIPE_INSTANCE: DWORD = 0x0008_0000;
pub const SECURITY_SQOS_PRESENT: DWORD = 0x0010_0000;
pub const SECURITY_ANONYMOUS: DWORD = 0;
pub const PIPE_TYPE_BYTE: DWORD = 0;
pub const PIPE_READMODE_BYTE: DWORD = 0;
pub const PIPE_WAIT: DWORD = 0;
pub const PIPE_REJECT_REMOTE_CLIENTS: DWORD = 0x0000_0008;

pub const STARTF_USESHOWWINDOW: DWORD = 0x0000_0001;
pub const SW_HIDE: u16 = 0;
pub const SW_SHOWDEFAULT: u16 = 10;

pub const CREATE_NEW_PROCESS_GROUP: DWORD = 0x0000_0200;
pub const CREATE_UNICODE_ENVIRONMENT: DWORD = 0x0000_0400;
pub const DETACHED_PROCESS: DWORD = 0x0000_0008;
pub const CREATE_NO_WINDOW: DWORD = 0x0800_0000;
pub const EXTENDED_STARTUPINFO_PRESENT: DWORD = 0x0008_0000;

pub const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
pub const PROC_THREAD_ATTRIBUTE_JOB_LIST: usize = 0x0002_000D;
pub const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x0002_0016;

pub const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION: DWORD = 0x0000_0400;
pub const JOB_OBJECT_LIMIT_BREAKAWAY_OK: DWORD = 0x0000_0800;
pub const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK: DWORD = 0x0000_1000;
pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x0000_2000;

pub const PROCESS_TERMINATE: DWORD = 0x0001;
pub const PROCESS_QUERY_INFORMATION: DWORD = 0x0400;
pub const SYNCHRONIZE: DWORD = 0x0010_0000;
pub const STILL_ACTIVE: DWORD = 259;
pub const WAIT_OBJECT_0: DWORD = 0;
pub const WAIT_TIMEOUT: DWORD = 258;

pub const CSTR_EQUAL: c_int = 2;

pub const ERROR_FILE_NOT_FOUND: DWORD = 2;
pub const ERROR_ACCESS_DENIED: DWORD = 5;
pub const ERROR_INVALID_HANDLE: DWORD = 6;
pub const ERROR_NOT_SUPPORTED: DWORD = 50;
pub const ERROR_INVALID_PARAMETER: DWORD = 87;
pub const ERROR_BROKEN_PIPE: DWORD = 109;
pub const ERROR_PIPE_BUSY: DWORD = 231;
pub const ERROR_IO_PENDING: DWORD = 997;

unsafe extern "system" {
    pub safe fn TerminateProcess(hProcess: HANDLE, uExitCode: u32) -> BOOL;
    pub safe fn WaitForSingleObject(hHandle: HANDLE, dwMilliseconds: DWORD) -> DWORD;
    pub fn WaitForMultipleObjects(
        nCount: DWORD,
        lpHandles: *const HANDLE,
        bWaitAll: BOOL,
        dwMilliseconds: DWORD,
    ) -> DWORD;
    pub safe fn GetProcessId(Process: HANDLE) -> DWORD;
    pub safe fn GetCurrentProcessId() -> DWORD;
    pub safe fn GetFileType(hFile: HANDLE) -> DWORD;
    pub safe fn SetLastError(dwErrCode: DWORD);
    pub fn DeleteProcThreadAttributeList(lpAttributeList: *mut u8);
    pub fn CompareStringOrdinal(
        lpString1: *const u16,
        cchCount1: c_int,
        lpString2: *const u16,
        cchCount2: c_int,
        bIgnoreCase: BOOL,
    ) -> c_int;
    pub fn GetEnvironmentVariableW(lpName: *const u16, lpBuffer: *mut u16, nSize: DWORD) -> DWORD;
    pub fn NeedCurrentDirectoryForExePathW(ExeName: *const u16) -> BOOL;
    pub fn GetShortPathNameW(
        lpszLongPath: *const u16,
        lpszShortPath: *mut u16,
        cchBuffer: DWORD,
    ) -> DWORD;
    pub fn CreateEventW(
        lpEventAttributes: *mut SECURITY_ATTRIBUTES,
        bManualReset: BOOL,
        bInitialState: BOOL,
        lpName: *const u16,
    ) -> HANDLE;
    pub fn GetOverlappedResult(
        hFile: HANDLE,
        lpOverlapped: *mut OVERLAPPED,
        lpNumberOfBytesTransferred: *mut DWORD,
        bWait: BOOL,
    ) -> BOOL;
    pub fn CancelIoEx(hFile: HANDLE, lpOverlapped: *mut OVERLAPPED) -> BOOL;
    pub fn GetProcessIoCounters(
        hProcess: HANDLE,
        lpIoCounters: *mut bun_windows_sys::IO_COUNTERS,
    ) -> BOOL;
}

/// The calling thread's last error as a [`Win32Error`]-mapped `bun_sys::Error`.
#[inline]
pub fn last_error(tag: bun_sys::Tag) -> bun_sys::Error {
    sys_error(GetLastError(), tag)
}

/// A Win32 error code as a `bun_sys::Error`; a code without an errno is `EUNKNOWN`.
#[inline]
pub fn sys_error(code: DWORD, tag: bun_sys::Tag) -> bun_sys::Error {
    match u16::try_from(code) {
        Ok(code) => bun_sys::Error::from_win32(Win32Error::from_raw(code), tag),
        Err(_) => bun_sys::Error::from_code(bun_sys::E::EUNKNOWN, tag),
    }
}
