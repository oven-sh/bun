//! Raw Win32 extern fn declarations split from sys/windows/windows.zig.
//! Custom types (Win32Error) and helper wrappers stay in sys/windows/.

use core::ffi::{c_char, c_int, c_void};

// TODO(port): these basic Win32 typedefs come from Zig's `std.os.windows`; in Rust they
// live in `bun_sys::windows` (see crate map). Phase B may relocate them into this crate
// to avoid a sys→windows_sys→sys dep cycle.
use bun_sys::windows::{
    BOOL, BOOLEAN, BY_HANDLE_FILE_INFORMATION, COORD, DWORD, DWORD_PTR, FILETIME,
    FILE_INFO_BY_HANDLE_CLASS, HANDLE, HMODULE, HRESULT, LPCSTR, LPCWSTR, LPVOID, LPWSTR, PWSTR,
    SECURITY_ATTRIBUTES, UINT,
};

pub type LPDWORD = *mut DWORD;
pub type HPCON = *mut c_void;

#[link(name = "kernel32")]
unsafe extern "system" {
    pub fn GetFileInformationByHandle(
        hFile: HANDLE,
        lpFileInformation: *mut BY_HANDLE_FILE_INFORMATION,
    ) -> BOOL;

    pub fn CommandLineToArgvW(
        lpCmdLine: LPCWSTR,
        pNumArgs: *mut c_int,
    ) -> *mut LPWSTR;

    pub fn GetBinaryTypeW(
        lpApplicationName: LPCWSTR,
        lpBinaryType: LPDWORD,
    ) -> BOOL;

    pub fn SetCurrentDirectoryW(
        lpPathName: LPCWSTR,
    ) -> BOOL;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    pub fn SaferiIsExecutableFileType(szFullPathname: LPCWSTR, bFromShellExecute: BOOLEAN) -> BOOL;
}

// PORT NOTE: the Zig declared these without an explicit library/callconv (defaults to .c).
unsafe extern "C" {
    pub fn GetProcAddress(
        ptr: *mut c_void,
        name: *const u16,
    ) -> *mut c_void;

    pub fn LoadLibraryA(
        name: *const c_char,
    ) -> *mut c_void;
}

// PORT NOTE: the following kernel32 fns lacked `callconv(.winapi)` in the Zig (works on
// x64 where winapi == C). Declared here as "system" for correctness on all targets.
#[link(name = "kernel32")]
unsafe extern "system" {
    pub fn CopyFileW(
        source: LPCWSTR,
        dest: LPCWSTR,
        bFailIfExists: BOOL,
    ) -> BOOL;

    pub fn SetFileInformationByHandle(
        file: HANDLE,
        fileInformationClass: FILE_INFO_BY_HANDLE_CLASS,
        fileInformation: LPVOID,
        bufferSize: DWORD,
    ) -> BOOL;

    pub fn GetHostNameW(
        lpBuffer: PWSTR,
        nSize: c_int,
    ) -> BOOL;

    pub fn GetTempPathW(
        nBufferLength: DWORD, // [in]
        lpBuffer: LPCWSTR,    // [out]
    ) -> DWORD;

    pub fn CreateJobObjectA(
        lpJobAttributes: *mut c_void, // [in, optional]
        lpName: LPCSTR,               // [in, optional]
    ) -> HANDLE;

    pub fn AssignProcessToJobObject(
        hJob: HANDLE,    // [in]
        hProcess: HANDLE, // [in]
    ) -> BOOL;

    pub fn ResumeThread(
        hJob: HANDLE, // [in]
    ) -> DWORD;

    pub fn SetInformationJobObject(
        hJob: HANDLE,
        JobObjectInformationClass: DWORD,
        lpJobObjectInformation: LPVOID,
        cbJobObjectInformationLength: DWORD,
    ) -> BOOL;

    pub fn OpenProcess(
        dwDesiredAccess: DWORD,
        bInheritHandle: BOOL,
        dwProcessId: DWORD,
    ) -> HANDLE;
}

unsafe extern "C" {
    pub fn GetUserNameW(
        lpBuffer: LPWSTR,
        pcbBuffer: LPDWORD,
    ) -> BOOL;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    pub fn CreateDirectoryExW(
        lpTemplateDirectory: *const u16,
        lpNewDirectory: *const u16,
        lpSecurityAttributes: *mut SECURITY_ATTRIBUTES,
    ) -> BOOL;

    pub fn GetModuleHandleExW(
        dwFlags: u32,              // [in]
        lpModuleName: *mut c_void, // [in, optional]
        phModule: *mut HMODULE,    // [out]
    ) -> BOOL;

    pub fn GetModuleFileNameW(
        hModule: HMODULE, // [in]
        lpFilename: LPWSTR, // [out]
        nSize: DWORD,     // [in]
    ) -> BOOL;

    pub fn GetThreadDescription(
        thread: *mut c_void, // [in]
        ppszThreadDescription: *mut PWSTR, // [out]
    ) -> HRESULT;
}

unsafe extern "C" {
    pub fn SetStdHandle(nStdHandle: u32, hHandle: *mut c_void) -> u32;

    pub fn GetConsoleOutputCP() -> u32;

    pub fn GetConsoleCP() -> u32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    pub fn SetConsoleCP(wCodePageID: UINT) -> BOOL;

    pub fn InitializeProcThreadAttributeList(
        lpAttributeList: *mut u8,
        dwAttributeCount: DWORD,
        dwFlags: DWORD,
        size: *mut usize,
    ) -> BOOL;

    pub fn UpdateProcThreadAttribute(
        lpAttributeList: *mut u8,      // [in, out]
        dwFlags: DWORD,                // [in]
        Attribute: DWORD_PTR,          // [in]
        lpValue: *const c_void,        // [in]
        cbSize: usize,                 // [in]
        lpPreviousValue: *mut c_void,  // [out, optional]
        lpReturnSize: *mut usize,      // [in, optional]
    ) -> BOOL;

    pub fn IsProcessInJob(process: HANDLE, job: HANDLE, result: *mut BOOL) -> BOOL;

    pub fn CreatePseudoConsole(
        size: COORD,
        hInput: HANDLE,
        hOutput: HANDLE,
        dwFlags: DWORD,
        phPC: *mut HPCON,
    ) -> HRESULT;

    pub fn ResizePseudoConsole(
        hPC: HPCON,
        size: COORD,
    ) -> HRESULT;

    pub fn ClosePseudoConsole(hPC: HPCON);

    pub fn CloseHandle(hObject: HANDLE) -> BOOL;

    pub fn GetFinalPathNameByHandleW(hFile: HANDLE, lpszFilePath: *mut u16, cchFilePath: DWORD, dwFlags: DWORD) -> DWORD;

    pub fn DeleteFileW(lpFileName: *const u16) -> BOOL;

    pub fn CreateSymbolicLinkW(lpSymlinkFileName: *const u16, lpTargetFileName: *const u16, dwFlags: DWORD) -> BOOLEAN;

    pub fn GetCurrentThread() -> HANDLE;

    pub fn GetCommandLineW() -> LPWSTR;

    pub fn CreateDirectoryW(lpPathName: *const u16, lpSecurityAttributes: *mut SECURITY_ATTRIBUTES) -> BOOL;

    pub fn SetEndOfFile(hFile: HANDLE) -> BOOL;

    pub fn GetProcessTimes(in_hProcess: HANDLE, out_lpCreationTime: *mut FILETIME, out_lpExitTime: *mut FILETIME, out_lpKernelTime: *mut FILETIME, out_lpUserTime: *mut FILETIME) -> BOOL;
}

unsafe extern "C" {
    pub fn windows_enable_stdio_inheritance();
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/windows_sys/externs.zig (194 lines)
//   confidence: high
//   todos:      1
//   notes:      callconv(.winapi) → extern "system"; Win32 typedefs imported from bun_sys::windows (Phase B: verify no dep cycle)
// ──────────────────────────────────────────────────────────────────────────
