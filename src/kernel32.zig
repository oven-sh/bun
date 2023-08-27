const kernel = @import("std").os.windows.kernel32;
const windows = @import("std").os.windows;
pub usingnamespace kernel;

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfilevaliddata
pub extern "kernel32" fn SetFileValidData(
    hFile: windows.HANDLE,
    validDataLength: c_longlong,
) callconv(windows.WINAPI) windows.BOOL;

pub extern fn CommandLineToArgvW(
    lpCmdLine: windows.LPCWSTR,
    pNumArgs: *c_int,
) [*]windows.LPWSTR;
