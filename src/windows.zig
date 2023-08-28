const kernel = @import("std").os.windows.kernel32;
const windows = @import("std").os.windows;
pub usingnamespace kernel;
pub usingnamespace windows.ntdll;

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfilevaliddata
pub extern "kernel32" fn SetFileValidData(
    hFile: windows.HANDLE,
    validDataLength: c_longlong,
) callconv(windows.WINAPI) windows.BOOL;

pub extern fn CommandLineToArgvW(
    lpCmdLine: windows.LPCWSTR,
    pNumArgs: *c_int,
) [*]windows.LPWSTR;

pub const LPDWORD = *windows.DWORD;

pub extern "kernel32" fn GetBinaryTypeW(
    lpApplicationName: windows.LPCWSTR,
    lpBinaryType: LPDWORD,
) callconv(windows.WINAPI) windows.BOOL;

/// A 32-bit Windows-based application
pub const SCS_32BIT_BINARY = 0;
/// A 64-bit Windows-based application.
pub const SCS_64BIT_BINARY = 6;
/// An MS-DOS – based application
pub const SCS_DOS_BINARY = 1;
/// A 16-bit OS/2-based application
pub const SCS_OS216_BINARY = 5;
/// A PIF file that executes an MS-DOS – based application
pub const SCS_PIF_BINARY = 3;
/// A POSIX – based application
pub const SCS_POSIX_BINARY = 4;

/// Each process has a single current directory made up of two parts:
///
/// - A disk designator that is either a drive letter followed by a colon, or a server name and share name (\\servername\sharename)
/// - A directory on the disk designator
///
/// The current directory is shared by all threads of the process: If one thread changes the current directory, it affects all threads in the process. Multithreaded applications and shared library code should avoid calling the SetCurrentDirectory function due to the risk of affecting relative path calculations being performed by other threads. Conversely, multithreaded applications and shared library code should avoid using relative paths so that they are unaffected by changes to the current directory performed by other threads.
///
/// Note that the current directory for a process is locked while the process is executing. This will prevent the directory from being deleted, moved, or renamed.
pub extern "kernel32" fn SetCurrentDirectory(
    lpPathName: windows.LPCWSTR,
) callconv(windows.WINAPI) windows.BOOL;
