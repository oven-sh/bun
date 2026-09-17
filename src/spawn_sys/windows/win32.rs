//! Win32 declarations process creation needs.

#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::upper_case_acronyms
)]

pub use bun_windows_sys::externs::kernel32::{
    CreateNamedPipeW, CreateProcessW, DuplicateHandle, GetCurrentProcess, GetExitCodeProcess,
    GetLastError, ReadFile, SetLastError,
};
pub use bun_windows_sys::externs::{
    AssignProcessToJobObject, BOOL, CREATE_UNICODE_ENVIRONMENT, CSTR_EQUAL, CancelIoEx,
    CloseHandle, CompareStringOrdinal, CreateEventW, CreateFileW, CreateJobObjectW,
    DUPLICATE_SAME_ACCESS, DWORD, EXTENDED_STARTUPINFO_PRESENT, FILE_ATTRIBUTE_DIRECTORY,
    FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_CHAR, FILE_TYPE_DISK,
    FILE_TYPE_PIPE, FILE_TYPE_REMOTE, FILE_TYPE_UNKNOWN, FILE_WRITE_ATTRIBUTES, FILETIME,
    GENERIC_READ, GENERIC_WRITE, GetCurrentDirectoryW, GetCurrentProcessId,
    GetEnvironmentVariableW, GetFileAttributesW, GetFileType, GetProcessTimes, GetShortPathNameW,
    HANDLE, HPCON, INFINITE, INVALID_FILE_ATTRIBUTES, INVALID_HANDLE_VALUE,
    InitializeProcThreadAttributeList, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, MAX_PATH, NTSTATUS, OPEN_EXISTING, OVERLAPPED, OpenProcess,
    PIPE_ACCESS_INBOUND, PIPE_ACCESS_OUTBOUND, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_BYTE, PIPE_WAIT, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
    RtlNtStatusToDosError, STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW, SYNCHRONIZE,
    SetInformationJobObject, TerminateProcess, UpdateProcThreadAttribute, WAIT_FAILED,
    WAIT_OBJECT_0, WRITE_DAC, WaitForMultipleObjects, WaitForSingleObject, Win32Error,
};

pub const SECURITY_SQOS_PRESENT: DWORD = 0x0010_0000;
pub const SECURITY_ANONYMOUS: DWORD = 0;

pub const STARTF_USESHOWWINDOW: DWORD = 0x0000_0001;
pub const SW_HIDE: u16 = 0;
pub const SW_SHOWDEFAULT: u16 = 10;

pub const CREATE_NEW_PROCESS_GROUP: DWORD = 0x0000_0200;
pub const DETACHED_PROCESS: DWORD = 0x0000_0008;
pub const CREATE_NO_WINDOW: DWORD = 0x0800_0000;

pub const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x0002_0016;

pub const PROCESS_TERMINATE: DWORD = 0x0001;
pub const PROCESS_QUERY_INFORMATION: DWORD = 0x0400;
pub const STILL_ACTIVE: DWORD = 259;
pub const WAIT_TIMEOUT: DWORD = 258;

pub const ERROR_FILE_NOT_FOUND: DWORD = Win32Error::FILE_NOT_FOUND.0 as DWORD;
pub const ERROR_ACCESS_DENIED: DWORD = Win32Error::ACCESS_DENIED.0 as DWORD;
pub const ERROR_INVALID_HANDLE: DWORD = Win32Error::INVALID_HANDLE.0 as DWORD;
pub const ERROR_NOT_SUPPORTED: DWORD = Win32Error::NOT_SUPPORTED.0 as DWORD;
pub const ERROR_INVALID_PARAMETER: DWORD = Win32Error::INVALID_PARAMETER.0 as DWORD;
pub const ERROR_BROKEN_PIPE: DWORD = Win32Error::BROKEN_PIPE.0 as DWORD;
pub const ERROR_PIPE_BUSY: DWORD = Win32Error::PIPE_BUSY.0 as DWORD;
pub const ERROR_IO_PENDING: DWORD = Win32Error::IO_PENDING.0 as DWORD;

#[repr(C)]
pub struct OBJECT_HANDLE_FLAG_INFORMATION {
    pub Inherit: u8,
    pub ProtectFromClose: u8,
}

/// `OBJECT_INFORMATION_CLASS`.
pub const ObjectHandleFlagInformation: DWORD = 4;

#[link(name = "ntdll")]
unsafe extern "system" {
    pub fn NtSetInformationObject(
        Handle: HANDLE,
        ObjectInformationClass: DWORD,
        ObjectInformation: *const core::ffi::c_void,
        ObjectInformationLength: DWORD,
    ) -> NTSTATUS;
}

unsafe extern "system" {
    pub safe fn GetProcessId(Process: HANDLE) -> DWORD;
    pub fn DeleteProcThreadAttributeList(lpAttributeList: *mut u8);
    pub fn NeedCurrentDirectoryForExePathW(ExeName: *const u16) -> BOOL;
    pub fn GetOverlappedResult(
        hFile: HANDLE,
        lpOverlapped: *mut OVERLAPPED,
        lpNumberOfBytesTransferred: *mut DWORD,
        bWait: BOOL,
    ) -> BOOL;
    pub fn GetProcessIoCounters(
        hProcess: HANDLE,
        lpIoCounters: *mut bun_windows_sys::IO_COUNTERS,
    ) -> BOOL;
    pub fn QueryInformationJobObject(
        hJob: HANDLE,
        JobObjectInformationClass: DWORD,
        lpJobObjectInformation: *mut core::ffi::c_void,
        cbJobObjectInformationLength: DWORD,
        lpReturnLength: *mut DWORD,
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
