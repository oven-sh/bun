//! Raw Win32 extern fn declarations split from sys/windows/windows.zig.
//! Custom types (Win32Error) and helper wrappers stay in sys/windows/.

pub const LPDWORD = *DWORD;
pub const HPCON = *anyopaque;

pub extern "kernel32" fn GetFileInformationByHandle(
    hFile: HANDLE,
    lpFileInformation: *windows.BY_HANDLE_FILE_INFORMATION,
) callconv(.winapi) BOOL;

pub extern "kernel32" fn CommandLineToArgvW(
    lpCmdLine: win32.LPCWSTR,
    pNumArgs: *c_int,
) callconv(.winapi) ?[*]win32.LPWSTR;

pub extern "kernel32" fn GetBinaryTypeW(
    lpApplicationName: win32.LPCWSTR,
    lpBinaryType: LPDWORD,
) callconv(.winapi) win32.BOOL;

pub extern "kernel32" fn SetCurrentDirectoryW(
    lpPathName: win32.LPCWSTR,
) callconv(.winapi) win32.BOOL;

pub extern "advapi32" fn SaferiIsExecutableFileType(szFullPathname: win32.LPCWSTR, bFromShellExecute: win32.BOOLEAN) callconv(.winapi) win32.BOOL;

pub extern fn GetProcAddress(
    ptr: ?*anyopaque,
    [*:0]const u16,
) ?*anyopaque;

pub extern fn LoadLibraryA(
    [*:0]const u8,
) ?*anyopaque;

pub extern "kernel32" fn CopyFileW(
    source: LPCWSTR,
    dest: LPCWSTR,
    bFailIfExists: BOOL,
) BOOL;

pub extern "kernel32" fn SetFileInformationByHandle(
    file: HANDLE,
    fileInformationClass: FILE_INFO_BY_HANDLE_CLASS,
    fileInformation: LPVOID,
    bufferSize: DWORD,
) BOOL;

pub extern "kernel32" fn GetHostNameW(
    lpBuffer: PWSTR,
    nSize: c_int,
) callconv(.winapi) BOOL;

pub extern "kernel32" fn GetTempPathW(
    nBufferLength: DWORD, // [in]
    lpBuffer: LPCWSTR, // [out]
) DWORD;

pub extern "kernel32" fn CreateJobObjectA(
    lpJobAttributes: ?*anyopaque, // [in, optional]
    lpName: ?LPCSTR, // [in, optional]
) callconv(.winapi) ?HANDLE;

pub extern "kernel32" fn AssignProcessToJobObject(
    hJob: HANDLE, // [in]
    hProcess: HANDLE, // [in]
) callconv(.winapi) BOOL;

pub extern "kernel32" fn ResumeThread(
    hJob: HANDLE, // [in]
) callconv(.winapi) DWORD;

pub extern "kernel32" fn SetInformationJobObject(
    hJob: HANDLE,
    JobObjectInformationClass: DWORD,
    lpJobObjectInformation: LPVOID,
    cbJobObjectInformationLength: DWORD,
) callconv(.winapi) BOOL;

pub extern "kernel32" fn OpenProcess(
    dwDesiredAccess: DWORD,
    bInheritHandle: BOOL,
    dwProcessId: DWORD,
) callconv(.winapi) ?HANDLE;

pub extern fn GetUserNameW(
    lpBuffer: LPWSTR,
    pcbBuffer: LPDWORD,
) BOOL;

pub extern "kernel32" fn CreateDirectoryExW(
    lpTemplateDirectory: [*:0]const u16,
    lpNewDirectory: [*:0]const u16,
    lpSecurityAttributes: ?*win32.SECURITY_ATTRIBUTES,
) callconv(.winapi) BOOL;

pub extern "kernel32" fn GetModuleHandleExW(
    dwFlags: u32, // [in]
    lpModuleName: ?*anyopaque, // [in, optional]
    phModule: *HMODULE, // [out]
) BOOL;

pub extern "kernel32" fn GetModuleFileNameW(
    hModule: HMODULE, // [in]
    lpFilename: LPWSTR, // [out]
    nSize: DWORD, // [in]
) BOOL;

pub extern "kernel32" fn GetThreadDescription(
    thread: ?*anyopaque, // [in]
    *PWSTR, // [out]
) std.os.windows.HRESULT;

pub extern fn SetStdHandle(nStdHandle: u32, hHandle: *anyopaque) u32;

pub extern fn GetConsoleOutputCP() u32;

pub extern fn GetConsoleCP() u32;

pub extern "kernel32" fn SetConsoleCP(wCodePageID: std.os.windows.UINT) callconv(.winapi) std.os.windows.BOOL;

pub extern "kernel32" fn InitializeProcThreadAttributeList(
    lpAttributeList: ?[*]u8,
    dwAttributeCount: DWORD,
    dwFlags: DWORD,
    size: *usize,
) BOOL;

pub extern "kernel32" fn UpdateProcThreadAttribute(
    lpAttributeList: [*]u8, // [in, out]
    dwFlags: DWORD, // [in]
    Attribute: windows.DWORD_PTR, // [in]
    lpValue: *const anyopaque, // [in]
    cbSize: usize, // [in]
    lpPreviousValue: ?*anyopaque, // [out, optional]
    lpReturnSize: ?*usize, // [in, optional]
) BOOL;

pub extern "kernel32" fn IsProcessInJob(process: HANDLE, job: HANDLE, result: *BOOL) BOOL;

pub extern "kernel32" fn CreatePseudoConsole(
    size: COORD,
    hInput: HANDLE,
    hOutput: HANDLE,
    dwFlags: DWORD,
    phPC: *HPCON,
) callconv(.winapi) std.os.windows.HRESULT;

pub extern "kernel32" fn ResizePseudoConsole(
    hPC: HPCON,
    size: COORD,
) callconv(.winapi) std.os.windows.HRESULT;

pub extern "kernel32" fn ClosePseudoConsole(hPC: HPCON) callconv(.winapi) void;

pub extern "kernel32" fn CloseHandle(hObject: HANDLE) callconv(.winapi) BOOL;

pub extern "kernel32" fn GetFinalPathNameByHandleW(hFile: HANDLE, lpszFilePath: [*]u16, cchFilePath: DWORD, dwFlags: DWORD) callconv(.winapi) DWORD;

pub extern "kernel32" fn DeleteFileW(lpFileName: [*:0]const u16) callconv(.winapi) BOOL;

pub extern "kernel32" fn CreateSymbolicLinkW(lpSymlinkFileName: [*:0]const u16, lpTargetFileName: [*:0]const u16, dwFlags: DWORD) callconv(.winapi) BOOLEAN;

pub extern "kernel32" fn GetCurrentThread() callconv(.winapi) HANDLE;

pub extern "kernel32" fn GetCommandLineW() callconv(.winapi) LPWSTR;

pub extern "kernel32" fn CreateDirectoryW(lpPathName: [*:0]const u16, lpSecurityAttributes: ?*windows.SECURITY_ATTRIBUTES) callconv(.winapi) BOOL;

pub extern "kernel32" fn SetEndOfFile(hFile: HANDLE) callconv(.winapi) BOOL;

pub extern "kernel32" fn GetProcessTimes(in_hProcess: HANDLE, out_lpCreationTime: *FILETIME, out_lpExitTime: *FILETIME, out_lpKernelTime: *FILETIME, out_lpUserTime: *FILETIME) callconv(.winapi) BOOL;

pub extern fn windows_enable_stdio_inheritance() void;

const std = @import("std");

const win32 = std.os.windows;
const windows = std.os.windows;
const BOOL = windows.BOOL;
const BOOLEAN = windows.BOOLEAN;
const COORD = windows.COORD;
const DWORD = windows.DWORD;
const FILETIME = windows.FILETIME;
const FILE_INFO_BY_HANDLE_CLASS = windows.FILE_INFO_BY_HANDLE_CLASS;
const HANDLE = windows.HANDLE;
const HMODULE = windows.HMODULE;
const LPCSTR = windows.LPCSTR;
const LPCWSTR = windows.LPCWSTR;
const LPVOID = windows.LPVOID;
const LPWSTR = windows.LPWSTR;
const PWSTR = windows.PWSTR;
const UINT = windows.UINT;
