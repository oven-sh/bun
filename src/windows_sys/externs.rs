//! Raw Win32 extern fn declarations + tier-0 Win32 typedefs split from
//! sys/windows/windows.zig. `bun_sys::windows` re-exports FROM here (see
//! CYCLEBREAK.md). This crate is a tier-0 leaf: it depends on nothing above
//! `libuv_sys`.

use core::ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_ushort, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Basic Win32 typedefs (owned here; mirror std.os.windows / winnt.h)
// ──────────────────────────────────────────────────────────────────────────

pub type BOOL = c_int;
pub type BOOLEAN = u8;
pub type BYTE = u8;
pub type WORD = c_ushort;
pub type DWORD = c_ulong;
pub type DWORD_PTR = usize;
pub type UINT = c_uint;
pub type ULONG = c_ulong;
pub type LONG = c_long;
pub type ULONGLONG = u64;
pub type LARGE_INTEGER = i64;
pub type WCHAR = u16;
pub type CHAR = c_char;
pub type HANDLE = *mut c_void;
pub type HMODULE = *mut c_void;
pub type HRESULT = c_long;
pub type LPVOID = *mut c_void;
pub type LPCVOID = *const c_void;
pub type LPSTR = *mut CHAR;
pub type LPCSTR = *const CHAR;
pub type LPWSTR = *mut WCHAR;
pub type LPCWSTR = *const WCHAR;
pub type PWSTR = *mut WCHAR;

pub const FALSE: BOOL = 0;
pub const TRUE: BOOL = 1;
pub const INVALID_HANDLE_VALUE: HANDLE = usize::MAX as isize as HANDLE;

#[repr(C)]
#[derive(Copy, Clone)]
pub struct COORD {
    pub X: i16,
    pub Y: i16,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct FILETIME {
    pub dwLowDateTime: DWORD,
    pub dwHighDateTime: DWORD,
}

#[repr(C)]
pub struct SECURITY_ATTRIBUTES {
    pub nLength: DWORD,
    pub lpSecurityDescriptor: LPVOID,
    pub bInheritHandle: BOOL,
}

#[repr(C)]
pub struct BY_HANDLE_FILE_INFORMATION {
    pub dwFileAttributes: DWORD,
    pub ftCreationTime: FILETIME,
    pub ftLastAccessTime: FILETIME,
    pub ftLastWriteTime: FILETIME,
    pub dwVolumeSerialNumber: DWORD,
    pub nFileSizeHigh: DWORD,
    pub nFileSizeLow: DWORD,
    pub nNumberOfLinks: DWORD,
    pub nFileIndexHigh: DWORD,
    pub nFileIndexLow: DWORD,
}

/// Mirrors `std.os.windows.FILE_INFO_BY_HANDLE_CLASS` (`enum(u32)`).
pub type FILE_INFO_BY_HANDLE_CLASS = u32;

#[repr(C)]
pub struct UNICODE_STRING {
    pub Length: u16,
    pub MaximumLength: u16,
    pub Buffer: *mut WCHAR,
}

// ──────────────────────────────────────────────────────────────────────────
// libuv re-export (tier-0 sibling). Zig: `pub const libuv = @import("../../libuv_sys/libuv.zig")`
// ──────────────────────────────────────────────────────────────────────────
pub use libuv_sys as libuv;

// ──────────────────────────────────────────────────────────────────────────
// kernel32 namespace (subset). Zig: `pub const kernel32 = windows.kernel32`
// ──────────────────────────────────────────────────────────────────────────
pub mod kernel32 {
    use super::DWORD;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub fn GetLastError() -> DWORD;
        pub fn ExitProcess(exit_code: u32) -> !;
    }
}
pub use kernel32::GetLastError;

// ──────────────────────────────────────────────────────────────────────────
// NTSTATUS — Zig `std.os.windows.NTSTATUS` is `enum(u32) { ..., _ }`.
// Ported as a transparent newtype so unmapped codes round-trip.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct NTSTATUS(pub u32);

impl NTSTATUS {
    pub const SUCCESS: NTSTATUS = NTSTATUS(0x0000_0000);
    pub const ACCESS_DENIED: NTSTATUS = NTSTATUS(0xC000_0022);
    pub const INVALID_HANDLE: NTSTATUS = NTSTATUS(0xC000_0008);
    pub const INVALID_PARAMETER: NTSTATUS = NTSTATUS(0xC000_000D);
    pub const OBJECT_NAME_COLLISION: NTSTATUS = NTSTATUS(0xC000_0035);
    pub const FILE_IS_A_DIRECTORY: NTSTATUS = NTSTATUS(0xC000_00BA);
    pub const OBJECT_PATH_NOT_FOUND: NTSTATUS = NTSTATUS(0xC000_003A);
    pub const OBJECT_NAME_NOT_FOUND: NTSTATUS = NTSTATUS(0xC000_0034);
    pub const OBJECT_NAME_INVALID: NTSTATUS = NTSTATUS(0xC000_0033);
    pub const NOT_A_DIRECTORY: NTSTATUS = NTSTATUS(0xC000_0103);
    pub const RETRY: NTSTATUS = NTSTATUS(0xC000_022D);
    pub const DIRECTORY_NOT_EMPTY: NTSTATUS = NTSTATUS(0xC000_0101);
    pub const FILE_TOO_LARGE: NTSTATUS = NTSTATUS(0xC000_0904);
    pub const NOT_SAME_DEVICE: NTSTATUS = NTSTATUS(0xC000_00D4);
    pub const DELETE_PENDING: NTSTATUS = NTSTATUS(0xC000_0056);
    pub const SHARING_VIOLATION: NTSTATUS = NTSTATUS(0xC000_0043);

    #[inline]
    pub const fn from_raw(raw: u32) -> Self { NTSTATUS(raw) }
    #[inline]
    pub const fn raw(self) -> u32 { self.0 }
}

#[inline]
pub const fn NT_SUCCESS(status: NTSTATUS) -> bool {
    (status.0 as i32) >= 0
}
pub const STATUS_SUCCESS: NTSTATUS = NTSTATUS::SUCCESS;

#[link(name = "ntdll")]
unsafe extern "system" {
    /// Zig: `pub extern "ntdll" fn RtlNtStatusToDosError(win32.NTSTATUS) callconv(.winapi) Win32Error`
    pub fn RtlNtStatusToDosError(status: NTSTATUS) -> DWORD;
}

#[link(name = "ws2_32")]
unsafe extern "system" {
    /// Raw `WSAGetLastError`. The Zig wrapper (`?SystemErrno`) lives in `errno`
    /// because `SystemErrno` is a higher-tier type.
    pub fn WSAGetLastError() -> c_int;
}

// ──────────────────────────────────────────────────────────────────────────
// Win32Error — Zig `enum(u16) { ..., _ }`. Ported as a transparent newtype
// with associated consts so unmapped codes round-trip and `match` on consts
// works (structural equality). Only the subset referenced by lower-tier
// crates (errno) is named here; the full 1188-variant table can be extended
// without ABI change.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Win32Error(pub u16);

impl Win32Error {
    // — core enum variants (values from MS-ERREF / std.os.windows.Win32Error) —
    pub const SUCCESS: Win32Error = Win32Error(0);
    pub const INVALID_FUNCTION: Win32Error = Win32Error(1);
    pub const FILE_NOT_FOUND: Win32Error = Win32Error(2);
    pub const PATH_NOT_FOUND: Win32Error = Win32Error(3);
    pub const TOO_MANY_OPEN_FILES: Win32Error = Win32Error(4);
    pub const ACCESS_DENIED: Win32Error = Win32Error(5);
    pub const INVALID_HANDLE: Win32Error = Win32Error(6);
    pub const NOT_ENOUGH_MEMORY: Win32Error = Win32Error(8);
    pub const INVALID_DATA: Win32Error = Win32Error(13);
    pub const OUTOFMEMORY: Win32Error = Win32Error(14);
    pub const INVALID_DRIVE: Win32Error = Win32Error(15);
    pub const NOT_SAME_DEVICE: Win32Error = Win32Error(17);
    pub const WRITE_PROTECT: Win32Error = Win32Error(19);
    pub const CRC: Win32Error = Win32Error(23);
    pub const GEN_FAILURE: Win32Error = Win32Error(31);
    pub const SHARING_VIOLATION: Win32Error = Win32Error(32);
    pub const LOCK_VIOLATION: Win32Error = Win32Error(33);
    pub const HANDLE_DISK_FULL: Win32Error = Win32Error(39);
    pub const NOT_SUPPORTED: Win32Error = Win32Error(50);
    pub const NETNAME_DELETED: Win32Error = Win32Error(64);
    pub const FILE_EXISTS: Win32Error = Win32Error(80);
    pub const CANNOT_MAKE: Win32Error = Win32Error(82);
    pub const INVALID_PARAMETER: Win32Error = Win32Error(87);
    pub const BROKEN_PIPE: Win32Error = Win32Error(109);
    pub const OPEN_FAILED: Win32Error = Win32Error(110);
    pub const BUFFER_OVERFLOW: Win32Error = Win32Error(111);
    pub const DISK_FULL: Win32Error = Win32Error(112);
    pub const SEM_TIMEOUT: Win32Error = Win32Error(121);
    pub const INSUFFICIENT_BUFFER: Win32Error = Win32Error(122);
    pub const INVALID_NAME: Win32Error = Win32Error(123);
    pub const MOD_NOT_FOUND: Win32Error = Win32Error(126);
    pub const DIR_NOT_EMPTY: Win32Error = Win32Error(145);
    pub const SIGNAL_REFUSED: Win32Error = Win32Error(156);
    pub const BAD_PATHNAME: Win32Error = Win32Error(161);
    pub const ALREADY_EXISTS: Win32Error = Win32Error(183);
    pub const ENVVAR_NOT_FOUND: Win32Error = Win32Error(203);
    pub const NO_SIGNAL_SENT: Win32Error = Win32Error(205);
    pub const FILENAME_EXCED_RANGE: Win32Error = Win32Error(206);
    pub const META_EXPANSION_TOO_LONG: Win32Error = Win32Error(208);
    pub const BAD_PIPE: Win32Error = Win32Error(230);
    pub const PIPE_BUSY: Win32Error = Win32Error(231);
    pub const NO_DATA: Win32Error = Win32Error(232);
    pub const PIPE_NOT_CONNECTED: Win32Error = Win32Error(233);
    pub const DIRECTORY: Win32Error = Win32Error(267);
    pub const EA_TABLE_FULL: Win32Error = Win32Error(277);
    pub const DELETE_PENDING: Win32Error = Win32Error(303);
    pub const ELEVATION_REQUIRED: Win32Error = Win32Error(740);
    pub const OPERATION_ABORTED: Win32Error = Win32Error(995);
    pub const NOACCESS: Win32Error = Win32Error(998);
    pub const INVALID_FLAGS: Win32Error = Win32Error(1004);
    pub const END_OF_MEDIA: Win32Error = Win32Error(1100);
    pub const FILEMARK_DETECTED: Win32Error = Win32Error(1101);
    pub const BEGINNING_OF_MEDIA: Win32Error = Win32Error(1102);
    pub const SETMARK_DETECTED: Win32Error = Win32Error(1103);
    pub const NO_DATA_DETECTED: Win32Error = Win32Error(1104);
    pub const INVALID_BLOCK_LENGTH: Win32Error = Win32Error(1106);
    pub const BUS_RESET: Win32Error = Win32Error(1111);
    pub const NO_UNICODE_TRANSLATION: Win32Error = Win32Error(1113);
    pub const IO_DEVICE: Win32Error = Win32Error(1117);
    pub const EOM_OVERFLOW: Win32Error = Win32Error(1129);
    pub const DEVICE_REQUIRES_CLEANING: Win32Error = Win32Error(1165);
    pub const DEVICE_DOOR_OPEN: Win32Error = Win32Error(1166);
    pub const CONNECTION_REFUSED: Win32Error = Win32Error(1225);
    pub const ADDRESS_ALREADY_ASSOCIATED: Win32Error = Win32Error(1227);
    pub const NETWORK_UNREACHABLE: Win32Error = Win32Error(1231);
    pub const HOST_UNREACHABLE: Win32Error = Win32Error(1232);
    pub const CONNECTION_ABORTED: Win32Error = Win32Error(1236);
    pub const PRIVILEGE_NOT_HELD: Win32Error = Win32Error(1314);
    pub const DISK_CORRUPT: Win32Error = Win32Error(1393);
    pub const SYMLINK_NOT_SUPPORTED: Win32Error = Win32Error(1464);
    pub const CANT_ACCESS_FILE: Win32Error = Win32Error(1920);
    pub const CANT_RESOLVE_FILENAME: Win32Error = Win32Error(1921);
    pub const NOT_CONNECTED: Win32Error = Win32Error(2250);
    pub const INVALID_REPARSE_DATA: Win32Error = Win32Error(3492);
    pub const IO_REISSUE_AS_CACHED: Win32Error = Win32Error(3950);

    // — WSA pseudo-variants (Zig: `pub const WSAE*: Win32Error = @enumFromInt(N)`) —
    pub const WSA_INVALID_HANDLE: Win32Error = Win32Error(6);
    pub const WSA_NOT_ENOUGH_MEMORY: Win32Error = Win32Error(8);
    pub const WSA_INVALID_PARAMETER: Win32Error = Win32Error(87);
    pub const WSA_OPERATION_ABORTED: Win32Error = Win32Error(995);
    pub const WSA_IO_INCOMPLETE: Win32Error = Win32Error(996);
    pub const WSA_IO_PENDING: Win32Error = Win32Error(997);
    pub const WSAEINTR: Win32Error = Win32Error(10004);
    pub const WSAEBADF: Win32Error = Win32Error(10009);
    pub const WSAEACCES: Win32Error = Win32Error(10013);
    pub const WSAEFAULT: Win32Error = Win32Error(10014);
    pub const WSAEINVAL: Win32Error = Win32Error(10022);
    pub const WSAEMFILE: Win32Error = Win32Error(10024);
    pub const WSAEWOULDBLOCK: Win32Error = Win32Error(10035);
    pub const WSAEINPROGRESS: Win32Error = Win32Error(10036);
    pub const WSAEALREADY: Win32Error = Win32Error(10037);
    pub const WSAENOTSOCK: Win32Error = Win32Error(10038);
    pub const WSAEDESTADDRREQ: Win32Error = Win32Error(10039);
    pub const WSAEMSGSIZE: Win32Error = Win32Error(10040);
    pub const WSAEPROTOTYPE: Win32Error = Win32Error(10041);
    pub const WSAENOPROTOOPT: Win32Error = Win32Error(10042);
    pub const WSAEPROTONOSUPPORT: Win32Error = Win32Error(10043);
    pub const WSAESOCKTNOSUPPORT: Win32Error = Win32Error(10044);
    pub const WSAEOPNOTSUPP: Win32Error = Win32Error(10045);
    pub const WSAEPFNOSUPPORT: Win32Error = Win32Error(10046);
    pub const WSAEAFNOSUPPORT: Win32Error = Win32Error(10047);
    pub const WSAEADDRINUSE: Win32Error = Win32Error(10048);
    pub const WSAEADDRNOTAVAIL: Win32Error = Win32Error(10049);
    pub const WSAENETDOWN: Win32Error = Win32Error(10050);
    pub const WSAENETUNREACH: Win32Error = Win32Error(10051);
    pub const WSAENETRESET: Win32Error = Win32Error(10052);
    pub const WSAECONNABORTED: Win32Error = Win32Error(10053);
    pub const WSAECONNRESET: Win32Error = Win32Error(10054);
    pub const WSAENOBUFS: Win32Error = Win32Error(10055);
    pub const WSAEISCONN: Win32Error = Win32Error(10056);
    pub const WSAENOTCONN: Win32Error = Win32Error(10057);
    pub const WSAESHUTDOWN: Win32Error = Win32Error(10058);
    pub const WSAETOOMANYREFS: Win32Error = Win32Error(10059);
    pub const WSAETIMEDOUT: Win32Error = Win32Error(10060);
    pub const WSAECONNREFUSED: Win32Error = Win32Error(10061);
    pub const WSAELOOP: Win32Error = Win32Error(10062);
    pub const WSAENAMETOOLONG: Win32Error = Win32Error(10063);
    pub const WSAEHOSTDOWN: Win32Error = Win32Error(10064);
    pub const WSAEHOSTUNREACH: Win32Error = Win32Error(10065);
    pub const WSAENOTEMPTY: Win32Error = Win32Error(10066);
    pub const WSAEPROCLIM: Win32Error = Win32Error(10067);
    pub const WSAEUSERS: Win32Error = Win32Error(10068);
    pub const WSAEDQUOT: Win32Error = Win32Error(10069);
    pub const WSAESTALE: Win32Error = Win32Error(10070);
    pub const WSAEREMOTE: Win32Error = Win32Error(10071);
    pub const WSASYSNOTREADY: Win32Error = Win32Error(10091);
    pub const WSAVERNOTSUPPORTED: Win32Error = Win32Error(10092);
    pub const WSANOTINITIALISED: Win32Error = Win32Error(10093);
    pub const WSAEDISCON: Win32Error = Win32Error(10101);
    pub const WSAENOMORE: Win32Error = Win32Error(10102);
    pub const WSAECANCELLED: Win32Error = Win32Error(10103);
    pub const WSAEINVALIDPROCTABLE: Win32Error = Win32Error(10104);
    pub const WSAEINVALIDPROVIDER: Win32Error = Win32Error(10105);
    pub const WSAEPROVIDERFAILEDINIT: Win32Error = Win32Error(10106);
    pub const WSASYSCALLFAILURE: Win32Error = Win32Error(10107);
    pub const WSASERVICE_NOT_FOUND: Win32Error = Win32Error(10108);
    pub const WSATYPE_NOT_FOUND: Win32Error = Win32Error(10109);
    pub const WSA_E_NO_MORE: Win32Error = Win32Error(10110);
    pub const WSA_E_CANCELLED: Win32Error = Win32Error(10111);
    pub const WSAEREFUSED: Win32Error = Win32Error(10112);
    pub const WSAHOST_NOT_FOUND: Win32Error = Win32Error(11001);
    pub const WSATRY_AGAIN: Win32Error = Win32Error(11002);
    pub const WSANO_RECOVERY: Win32Error = Win32Error(11003);
    pub const WSANO_DATA: Win32Error = Win32Error(11004);
    pub const WSA_QOS_RESERVED_PETYPE: Win32Error = Win32Error(11031);

    /// Zig: `pub fn get() Win32Error { @enumFromInt(@intFromEnum(kernel32.GetLastError())) }`
    #[inline]
    pub fn get() -> Win32Error {
        Win32Error(unsafe { kernel32::GetLastError() } as u16)
    }

    #[inline]
    pub const fn from_raw(raw: u16) -> Win32Error { Win32Error(raw) }

    #[inline]
    pub const fn int(self) -> u16 { self.0 }

    /// Zig: `pub fn fromNTStatus(status) Win32Error { RtlNtStatusToDosError(status) }`
    #[inline]
    pub fn from_ntstatus(status: NTSTATUS) -> Win32Error {
        Win32Error(unsafe { RtlNtStatusToDosError(status) } as u16)
    }

    // NOTE: `toSystemErrno()` is intentionally NOT defined here — it returns
    // `errno::SystemErrno`, a higher-tier type. The mapping lives in
    // `errno::SystemErrno::init_win32_error`; callers in `errno` should invoke
    // that directly (CYCLEBREAK: T0 must not depend on T1).
}

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
//   source:     src/windows_sys/externs.zig + MOVE_DOWN from src/sys/windows/windows.zig
//   confidence: high
//   todos:      0
//   notes:      callconv(.winapi) → extern "system"; Win32 typedefs + Win32Error/NTSTATUS
//               owned locally (crate root). `translate_ntstatus_to_errno` /
//               `wsa_get_last_error` / `Win32Error::to_system_errno` intentionally
//               NOT moved here — they return `errno::{E,SystemErrno}` (T1) and would
//               create a back-edge. Raw building blocks (RtlNtStatusToDosError,
//               WSAGetLastError, Win32Error::get/from_ntstatus) are provided instead.
// ──────────────────────────────────────────────────────────────────────────
