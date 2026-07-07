//! Raw Win32 extern fn declarations + tier-0 Win32 typedefs.
//! `bun_sys::windows` re-exports FROM here (see the layering doc). This crate is a tier-0 leaf: it depends on nothing above
//! `libuv_sys`.

use core::ffi::{c_char, c_int, c_long, c_short, c_uint, c_ulong, c_ushort, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Basic Win32 typedefs (owned here; mirror winnt.h)
// ──────────────────────────────────────────────────────────────────────────

pub type BOOL = c_int;
pub type BOOLEAN = u8;
pub type BYTE = u8;
pub type WORD = c_ushort;
pub type DWORD = u32; // always 32-bit on Windows; c_ulong is 8 bytes on non-Windows hosts
pub type DWORD_PTR = usize;
pub type UINT = c_uint;
pub type ULONG = u32; // Windows ULONG is always 32-bit; c_ulong is 8 bytes on non-Windows hosts
pub type LONG = i32; // always 32-bit on Windows
pub type ULONGLONG = u64;
pub type LARGE_INTEGER = i64;
pub type WCHAR = u16;
pub type CHAR = c_char;
pub type HANDLE = *mut c_void;
pub type HMODULE = *mut c_void;
pub type HRESULT = i32; // always 32-bit on Windows
pub type LPVOID = *mut c_void;
pub type LPCVOID = *const c_void;
pub type LPSTR = *mut CHAR;
pub type LPCSTR = *const CHAR;
pub type LPWSTR = *mut WCHAR;
pub type LPCWSTR = *const WCHAR;
pub type PWSTR = *mut WCHAR;
pub type SHORT = c_short;
pub type ULONG_PTR = usize;

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
pub struct SMALL_RECT {
    pub Left: i16,
    pub Top: i16,
    pub Right: i16,
    pub Bottom: i16,
}

/// `CONSOLE_SCREEN_BUFFER_INFO` (`wincon.h`).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CONSOLE_SCREEN_BUFFER_INFO {
    pub dwSize: COORD,
    pub dwCursorPosition: COORD,
    pub wAttributes: u16,
    pub srWindow: SMALL_RECT,
    pub dwMaximumWindowSize: COORD,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct FILETIME {
    pub dwLowDateTime: DWORD,
    pub dwHighDateTime: DWORD,
}

// ──────────────────────────────────────────────────────────────────────────
// Win32 POD structs shared by `bun_libuv_sys` (uv/win.h embeds) and
// `bun_sys::windows`. Single source of truth.
// All derive Clone+Copy: libuv embeds them in `uv_req_s`/`uv_tty_s`/
// `uv_fs_s` which themselves derive Copy, so non-Copy here would break
// the derive chain.
// ──────────────────────────────────────────────────────────────────────────

/// `OVERLAPPED` (`minwinbase.h`) — 32 bytes / align 8 on x64.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct OVERLAPPED {
    pub Internal: ULONG_PTR,
    pub InternalHigh: ULONG_PTR,
    pub Offset: DWORD,
    pub OffsetHigh: DWORD,
    pub hEvent: HANDLE,
}

/// `OVERLAPPED_ENTRY` (`minwinbase.h`) — one dequeued IOCP completion.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct OVERLAPPED_ENTRY {
    pub lpCompletionKey: ULONG_PTR,
    pub lpOverlapped: *mut OVERLAPPED,
    pub Internal: ULONG_PTR,
    pub dwNumberOfBytesTransferred: DWORD,
}

/// `RTL_CRITICAL_SECTION` (`winnt.h`) — 40 bytes / align 8 on x64.
/// libuv aliases this as `uv_mutex_t`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct CRITICAL_SECTION {
    pub DebugInfo: *mut c_void,
    pub LockCount: LONG,
    pub RecursionCount: LONG,
    pub OwningThread: HANDLE,
    pub LockSemaphore: HANDLE,
    pub SpinCount: ULONG_PTR,
}

/// `WIN32_FIND_DATAW` (`minwinbase.h`) — 592 bytes / align 4.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct WIN32_FIND_DATAW {
    pub dwFileAttributes: DWORD,
    pub ftCreationTime: FILETIME,
    pub ftLastAccessTime: FILETIME,
    pub ftLastWriteTime: FILETIME,
    pub nFileSizeHigh: DWORD,
    pub nFileSizeLow: DWORD,
    pub dwReserved0: DWORD,
    pub dwReserved1: DWORD,
    pub cFileName: [WCHAR; 260],
    pub cAlternateFileName: [WCHAR; 14],
}

// ── Console input records (`wincon.h`) ────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub union KEY_EVENT_RECORD_uChar {
    pub UnicodeChar: WCHAR,
    pub AsciiChar: CHAR,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct KEY_EVENT_RECORD {
    pub bKeyDown: BOOL,
    pub wRepeatCount: WORD,
    pub wVirtualKeyCode: WORD,
    pub wVirtualScanCode: WORD,
    pub uChar: KEY_EVENT_RECORD_uChar,
    pub dwControlKeyState: DWORD,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MOUSE_EVENT_RECORD {
    pub dwMousePosition: COORD,
    pub dwButtonState: DWORD,
    pub dwControlKeyState: DWORD,
    pub dwEventFlags: DWORD,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct WINDOW_BUFFER_SIZE_EVENT {
    pub dwSize: COORD,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MENU_EVENT_RECORD {
    pub dwCommandId: UINT,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FOCUS_EVENT_RECORD {
    pub bSetFocus: BOOL,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub union INPUT_RECORD_Event {
    pub KeyEvent: KEY_EVENT_RECORD,
    pub MouseEvent: MOUSE_EVENT_RECORD,
    pub WindowBufferSizeEvent: WINDOW_BUFFER_SIZE_EVENT,
    pub MenuEvent: MENU_EVENT_RECORD,
    pub FocusEvent: FOCUS_EVENT_RECORD,
}
/// `INPUT_RECORD` (`wincon.h`) — 20 bytes / align 4.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct INPUT_RECORD {
    pub EventType: WORD,
    pub Event: INPUT_RECORD_Event,
}

// Layout pins: a typo in any of the above is a silent ABI break; assert the
// authoritative Windows-x64 sizes. All field types are fixed-width now, so
// these hold on cross-checks from any 64-bit host.
#[cfg(target_pointer_width = "64")]
const _: () = {
    assert!(core::mem::size_of::<OVERLAPPED>() == 32);
    assert!(core::mem::size_of::<CRITICAL_SECTION>() == 40);
    assert!(core::mem::size_of::<WIN32_FIND_DATAW>() == 592);
    assert!(core::mem::size_of::<INPUT_RECORD>() == 20);
};

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

/// `WIN32_FILE_ATTRIBUTE_DATA` — out-param of `GetFileAttributesExW` (fileapi.h).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct WIN32_FILE_ATTRIBUTE_DATA {
    pub dwFileAttributes: DWORD,
    pub ftCreationTime: FILETIME,
    pub ftLastAccessTime: FILETIME,
    pub ftLastWriteTime: FILETIME,
    pub nFileSizeHigh: DWORD,
    pub nFileSizeLow: DWORD,
}

/// `GET_FILEEX_INFO_LEVELS` — enum(u32) selecting `GetFileAttributesExW` payload.
pub type GET_FILEEX_INFO_LEVELS = u32;
pub const GetFileExInfoStandard: GET_FILEEX_INFO_LEVELS = 0;
pub const GetFileExMaxInfoLevel: GET_FILEEX_INFO_LEVELS = 1;

/// `FILE_INFO_BY_HANDLE_CLASS` (`winbase.h`), as a bare `u32`.
pub type FILE_INFO_BY_HANDLE_CLASS = u32;

#[repr(C)]
#[derive(Copy, Clone)]
pub struct UNICODE_STRING {
    pub Length: u16,
    pub MaximumLength: u16,
    pub Buffer: *mut WCHAR,
}

/// `ACCESS_MASK` (`winnt.h`).
pub type ACCESS_MASK = DWORD;

/// `OBJECT_ATTRIBUTES` (`ntdef.h`) — passed to `NtCreateFile` / `NtOpenFile`.
#[repr(C)]
pub struct OBJECT_ATTRIBUTES {
    pub Length: ULONG,
    pub RootDirectory: HANDLE,
    pub ObjectName: *mut UNICODE_STRING,
    pub Attributes: ULONG,
    pub SecurityDescriptor: *mut c_void,
    pub SecurityQualityOfService: *mut c_void,
}

/// `IO_STATUS_BLOCK` (`wdm.h`) — output param of `Nt*` file calls.
#[repr(C)]
pub struct IO_STATUS_BLOCK {
    /// Anonymous union of `NTSTATUS Status` / `PVOID Pointer`; pointer-sized.
    pub Status: usize,
    pub Information: usize,
}

// Path-length constants.
pub const MAX_PATH: usize = 260;
pub const PATH_MAX_WIDE: usize = 32767;

// `SetFilePointer` move methods.
pub const FILE_BEGIN: DWORD = 0;
pub const FILE_CURRENT: DWORD = 1;
pub const FILE_END: DWORD = 2;

// `DuplicateHandle` options.
pub const DUPLICATE_SAME_ACCESS: DWORD = 0x0000_0002;

// `NtCreateFile` ShareAccess (`winnt.h`).
pub const FILE_SHARE_READ: ULONG = 0x0000_0001;
pub const FILE_SHARE_WRITE: ULONG = 0x0000_0002;
pub const FILE_SHARE_DELETE: ULONG = 0x0000_0004;

// File attribute flags (`winnt.h`).
pub const FILE_ATTRIBUTE_READONLY: DWORD = 0x0000_0001;
pub const FILE_ATTRIBUTE_HIDDEN: DWORD = 0x0000_0002;
pub const FILE_ATTRIBUTE_SYSTEM: DWORD = 0x0000_0004;
pub const FILE_ATTRIBUTE_DIRECTORY: DWORD = 0x0000_0010;
pub const FILE_ATTRIBUTE_ARCHIVE: DWORD = 0x0000_0020;
pub const FILE_ATTRIBUTE_DEVICE: DWORD = 0x0000_0040;
pub const FILE_ATTRIBUTE_NORMAL: DWORD = 0x0000_0080;
pub const FILE_ATTRIBUTE_TEMPORARY: DWORD = 0x0000_0100;
pub const FILE_ATTRIBUTE_SPARSE_FILE: DWORD = 0x0000_0200;
pub const FILE_ATTRIBUTE_REPARSE_POINT: DWORD = 0x0000_0400;
pub const FILE_ATTRIBUTE_COMPRESSED: DWORD = 0x0000_0800;
pub const FILE_ATTRIBUTE_OFFLINE: DWORD = 0x0000_1000;
pub const FILE_ATTRIBUTE_NOT_CONTENT_INDEXED: DWORD = 0x0000_2000;

// `NtCreateFile` CreateDisposition (`ntifs.h`).
pub const FILE_SUPERSEDE: ULONG = 0;
pub const FILE_OPEN: ULONG = 1;
pub const FILE_CREATE: ULONG = 2;
pub const FILE_OPEN_IF: ULONG = 3;
pub const FILE_OVERWRITE: ULONG = 4;
pub const FILE_OVERWRITE_IF: ULONG = 5;

// `NtCreateFile` CreateOptions (`ntifs.h`).
pub const FILE_DIRECTORY_FILE: ULONG = 0x0000_0001;
pub const FILE_WRITE_THROUGH: ULONG = 0x0000_0002;
pub const FILE_SEQUENTIAL_ONLY: ULONG = 0x0000_0004;
pub const FILE_SYNCHRONOUS_IO_NONALERT: ULONG = 0x0000_0020;
pub const FILE_NON_DIRECTORY_FILE: ULONG = 0x0000_0040;
pub const FILE_OPEN_REPARSE_POINT: ULONG = 0x0020_0000;

// Standard access rights (`winnt.h`).
pub const DELETE: ACCESS_MASK = 0x0001_0000;
pub const READ_CONTROL: ACCESS_MASK = 0x0002_0000;
pub const SYNCHRONIZE: ACCESS_MASK = 0x0010_0000;
pub const STANDARD_RIGHTS_READ: ACCESS_MASK = READ_CONTROL;
pub const GENERIC_READ: ACCESS_MASK = 0x8000_0000;
pub const GENERIC_WRITE: ACCESS_MASK = 0x4000_0000;

// File-specific access rights (`winnt.h`).
pub const FILE_READ_DATA: ACCESS_MASK = 0x0001;
pub const FILE_LIST_DIRECTORY: ACCESS_MASK = 0x0001;
pub const FILE_ADD_FILE: ACCESS_MASK = 0x0002;
pub const FILE_APPEND_DATA: ACCESS_MASK = 0x0004;
pub const FILE_ADD_SUBDIRECTORY: ACCESS_MASK = 0x0004;
pub const FILE_READ_EA: ACCESS_MASK = 0x0008;
pub const FILE_TRAVERSE: ACCESS_MASK = 0x0020;
pub const FILE_READ_ATTRIBUTES: ACCESS_MASK = 0x0080;
pub const FILE_WRITE_ATTRIBUTES: ACCESS_MASK = 0x0100;

// `CreateFileW` dwCreationDisposition (`winbase.h`).
pub const CREATE_NEW: DWORD = 1;
pub const CREATE_ALWAYS: DWORD = 2;
pub const OPEN_EXISTING: DWORD = 3;
pub const OPEN_ALWAYS: DWORD = 4;
pub const TRUNCATE_EXISTING: DWORD = 5;

// `CreateFileW` dwFlagsAndAttributes (`winbase.h`).
pub const FILE_FLAG_BACKUP_SEMANTICS: DWORD = 0x0200_0000;
pub const FILE_FLAG_OPEN_REPARSE_POINT: DWORD = 0x0020_0000;
pub const FILE_FLAG_OVERLAPPED: DWORD = 0x4000_0000;

// `CreateNamedPipeW` dwOpenMode / dwPipeMode (`winbase.h`).
pub const PIPE_ACCESS_INBOUND: DWORD = 0x0000_0001;
pub const PIPE_ACCESS_OUTBOUND: DWORD = 0x0000_0002;
pub const PIPE_ACCESS_DUPLEX: DWORD = 0x0000_0003;
pub const PIPE_TYPE_BYTE: DWORD = 0x0000_0000;
pub const PIPE_READMODE_BYTE: DWORD = 0x0000_0000;
pub const PIPE_WAIT: DWORD = 0x0000_0000;

/// `CreateSymbolicLinkW` dwFlags (`winbase.h`).
pub const SYMBOLIC_LINK_FLAG_DIRECTORY: DWORD = 0x1;
pub const SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE: DWORD = 0x2;

/// `FILE_BASIC_INFORMATION` (`wdm.h`) — output of `NtQueryAttributesFile`;
/// embedded in `FILE_ALL_INFORMATION`. All-zero is the valid initial state
/// (the kernel fills it), so `Default` is sound.
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_BASIC_INFORMATION {
    pub CreationTime: LARGE_INTEGER,
    pub LastAccessTime: LARGE_INTEGER,
    pub LastWriteTime: LARGE_INTEGER,
    pub ChangeTime: LARGE_INTEGER,
    pub FileAttributes: ULONG,
}

/// `FILE_DIRECTORY_INFORMATION` (`ntifs.h`) — `NtQueryDirectoryFile` record.
/// `FileName` is a flexible array; declared `[WCHAR; 1]` to match C layout
/// (read past it via `FileNameLength`).
#[repr(C)]
pub struct FILE_DIRECTORY_INFORMATION {
    pub NextEntryOffset: ULONG,
    pub FileIndex: ULONG,
    pub CreationTime: LARGE_INTEGER,
    pub LastAccessTime: LARGE_INTEGER,
    pub LastWriteTime: LARGE_INTEGER,
    pub ChangeTime: LARGE_INTEGER,
    pub EndOfFile: LARGE_INTEGER,
    pub AllocationSize: LARGE_INTEGER,
    pub FileAttributes: ULONG,
    pub FileNameLength: ULONG,
    pub FileName: [WCHAR; 1],
}

/// `FILE_INFORMATION_CLASS` (`wdm.h`) — selector for `NtQuery*` /
/// `NtSetInformationFile`. Newtype-over-u32 so unmapped values round-trip.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct FILE_INFORMATION_CLASS(pub u32);
impl FILE_INFORMATION_CLASS {
    pub const FileDirectoryInformation: Self = Self(1);
    pub const FileBasicInformation: Self = Self(4);
    pub const FileRenameInformation: Self = Self(10);
    pub const FileDispositionInformation: Self = Self(13);
    pub const FileEndOfFileInformation: Self = Self(20);
    pub const FileDispositionInformationEx: Self = Self(64);
}

/// `FILE_END_OF_FILE_INFORMATION` (`ntifs.h`) — payload for
/// `NtSetInformationFile(.., FileEndOfFileInformation)`.
#[repr(C)]
pub struct FILE_END_OF_FILE_INFORMATION {
    pub EndOfFile: LARGE_INTEGER,
}

/// CamelCase alias used at some call sites.
pub type FileInformationClass = FILE_INFORMATION_CLASS;

/// `FILE_DISPOSITION_INFORMATION` (`ntifs.h`).
#[repr(C)]
pub struct FILE_DISPOSITION_INFORMATION {
    pub DeleteFile: BOOLEAN,
}

/// `FILE_DISPOSITION_INFORMATION_EX` (`ntifs.h`, ≥ win10 rs1).
#[repr(C)]
pub struct FILE_DISPOSITION_INFORMATION_EX {
    pub Flags: ULONG,
}

/// `FILE_RENAME_INFORMATION` ex variant (`ntifs.h`). `FileName` is a
/// variable-length tail; declared `[u16; 1]` to match the C flex-array idiom.
#[repr(C)]
pub struct FILE_RENAME_INFORMATION_EX {
    pub Flags: ULONG,
    pub RootDirectory: HANDLE,
    pub FileNameLength: ULONG,
    pub FileName: [u16; 1],
}

// `FILE_DISPOSITION_INFORMATION_EX.Flags` bits (winnt.h).
pub const FILE_DISPOSITION_DELETE: ULONG = 0x0000_0001;
pub const FILE_DISPOSITION_POSIX_SEMANTICS: ULONG = 0x0000_0002;
pub const FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE: ULONG = 0x0000_0010;

// `FILE_RENAME_INFORMATION_EX.Flags` bits (winnt.h).
pub const FILE_RENAME_REPLACE_IF_EXISTS: ULONG = 0x0000_0001;
pub const FILE_RENAME_POSIX_SEMANTICS: ULONG = 0x0000_0002;
pub const FILE_RENAME_IGNORE_READONLY_ATTRIBUTE: ULONG = 0x0000_0040;

// `GetFinalPathNameByHandleW` flag bits (fileapi.h).
pub const FILE_NAME_NORMALIZED: DWORD = 0x0;
pub const FILE_NAME_OPENED: DWORD = 0x8;
pub const VOLUME_NAME_DOS: DWORD = 0x0;
pub const VOLUME_NAME_GUID: DWORD = 0x1;
pub const VOLUME_NAME_NT: DWORD = 0x2;
pub const VOLUME_NAME_NONE: DWORD = 0x4;

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum VolumeName {
    #[default]
    Dos,
    Nt,
}

#[derive(Copy, Clone, Debug, Default)]
pub struct GetFinalPathNameByHandleFormat {
    pub volume_name: VolumeName,
}

impl FILE_INFORMATION_CLASS {
    pub const FileRenameInformationEx: Self = Self(65);
    /// `FileAllInformation` (`wdm.h`) — `FILE_ALL_INFORMATION` payload.
    pub const FileAllInformation: Self = Self(18);
    /// `FileIdFullDirectoryInformation` (`wdm.h`) —
    /// `FILE_ID_FULL_DIR_INFORMATION` records from `NtQueryDirectoryFile`.
    pub const FileIdFullDirectoryInformation: Self = Self(38);
}

// ──────────────────────────────────────────────────────────────────────────
// Stat-family NT info structs + consts (consumed by `bun_winfs`).
// Layouts transcribed from libuv src/win/winapi.h (4134-4453) / the Windows
// SDK; values cross-checked against SDK 10.0.26100 headers.
// ──────────────────────────────────────────────────────────────────────────

/// `FS_INFORMATION_CLASS` (`wdm.h`) — selector for
/// `NtQueryVolumeInformationFile`. Newtype-over-u32 so unmapped values
/// round-trip (mirrors `FILE_INFORMATION_CLASS`).
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct FS_INFORMATION_CLASS(pub u32);
impl FS_INFORMATION_CLASS {
    pub const FileFsVolumeInformation: Self = Self(1);
    pub const FileFsDeviceInformation: Self = Self(4);
}

/// `FILE_INFO_BY_NAME_CLASS` (`winnt.h`, ≥ NTDDI_WIN11_ZN) — selector for
/// `GetFileInformationByName`. Re-declared (libuv winapi.h:4798-4804) because
/// pre-Win11-ZN SDKs lack it.
pub type FILE_INFO_BY_NAME_CLASS = u32;
pub const FileStatBasicByNameInfo: FILE_INFO_BY_NAME_CLASS = 3;

/// `FILE_ID_128` (`winnt.h`) — 128-bit ReFS file id.
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_ID_128 {
    pub Identifier: [u8; 16],
}

/// `FILE_STAT_BASIC_INFORMATION` (`winnt.h`, ≥ NTDDI_WIN11_ZN) — payload of
/// `GetFileInformationByName(FileStatBasicByNameInfo)`. Re-declared (libuv
/// winapi.h:4134-4150) because pre-Win11-ZN SDKs lack it. Also doubles as the
/// single stat-normalizer carrier struct. // quirk: FSMETA-01, FSMETA-02
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_STAT_BASIC_INFORMATION {
    pub FileId: LARGE_INTEGER,
    pub CreationTime: LARGE_INTEGER,
    pub LastAccessTime: LARGE_INTEGER,
    pub LastWriteTime: LARGE_INTEGER,
    pub ChangeTime: LARGE_INTEGER,
    pub AllocationSize: LARGE_INTEGER,
    pub EndOfFile: LARGE_INTEGER,
    pub FileAttributes: ULONG,
    pub ReparseTag: ULONG,
    pub NumberOfLinks: ULONG,
    pub DeviceType: ULONG,
    pub DeviceCharacteristics: ULONG,
    pub Reserved: ULONG,
    /// `LARGE_INTEGER` in the SDK; some volumes carry 64 bits here, but the
    /// stat contract reads the low 32 only. // quirk: FSMETA-08
    pub VolumeSerialNumber: LARGE_INTEGER,
    pub FileId128: FILE_ID_128,
}

/// `FILE_STANDARD_INFORMATION` (`wdm.h`).
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_STANDARD_INFORMATION {
    pub AllocationSize: LARGE_INTEGER,
    pub EndOfFile: LARGE_INTEGER,
    pub NumberOfLinks: ULONG,
    pub DeletePending: BOOLEAN,
    pub Directory: BOOLEAN,
}

/// `FILE_INTERNAL_INFORMATION` (`ntifs.h`) — the 64-bit NTFS file index.
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_INTERNAL_INFORMATION {
    pub IndexNumber: LARGE_INTEGER,
}

/// `FILE_EA_INFORMATION` (`wdm.h`).
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_EA_INFORMATION {
    pub EaSize: ULONG,
}

/// `FILE_ACCESS_INFORMATION` (`wdm.h`).
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_ACCESS_INFORMATION {
    pub AccessFlags: ACCESS_MASK,
}

/// `FILE_POSITION_INFORMATION` (`wdm.h`).
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_POSITION_INFORMATION {
    pub CurrentByteOffset: LARGE_INTEGER,
}

/// `FILE_MODE_INFORMATION` (`wdm.h`).
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_MODE_INFORMATION {
    pub Mode: ULONG,
}

/// `FILE_ALIGNMENT_INFORMATION` (`wdm.h`).
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_ALIGNMENT_INFORMATION {
    pub AlignmentRequirement: ULONG,
}

/// `FILE_NAME_INFORMATION` (`ntifs.h`). `FileName` is a flexible array;
/// declared `[WCHAR; 1]` to match the C layout.
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_NAME_INFORMATION {
    pub FileNameLength: ULONG,
    pub FileName: [WCHAR; 1],
}

/// `FILE_ALL_INFORMATION` (`ntifs.h`) — `NtQueryInformationFile`
/// (`FileAllInformation`) payload. Ends with the variable-length
/// `NameInformation`, so a fixed-size query returns `STATUS_BUFFER_OVERFLOW`
/// (warning severity) with every fixed member valid. // quirk: FSMETA-06
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_ALL_INFORMATION {
    pub BasicInformation: FILE_BASIC_INFORMATION,
    pub StandardInformation: FILE_STANDARD_INFORMATION,
    pub InternalInformation: FILE_INTERNAL_INFORMATION,
    pub EaInformation: FILE_EA_INFORMATION,
    pub AccessInformation: FILE_ACCESS_INFORMATION,
    pub PositionInformation: FILE_POSITION_INFORMATION,
    pub ModeInformation: FILE_MODE_INFORMATION,
    pub AlignmentInformation: FILE_ALIGNMENT_INFORMATION,
    pub NameInformation: FILE_NAME_INFORMATION,
}

/// `FILE_ID_FULL_DIR_INFORMATION` (`ntifs.h`) — `NtQueryDirectoryFile`
/// (`FileIdFullDirectoryInformation`) record; carries attributes, all four
/// timestamps, sizes and the 64-bit FileId — a nearly full stat without
/// opening the file. `FileName` is a flexible array. // quirk: FSMETA-10
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_ID_FULL_DIR_INFORMATION {
    pub NextEntryOffset: ULONG,
    pub FileIndex: ULONG,
    pub CreationTime: LARGE_INTEGER,
    pub LastAccessTime: LARGE_INTEGER,
    pub LastWriteTime: LARGE_INTEGER,
    pub ChangeTime: LARGE_INTEGER,
    pub EndOfFile: LARGE_INTEGER,
    pub AllocationSize: LARGE_INTEGER,
    pub FileAttributes: ULONG,
    pub FileNameLength: ULONG,
    pub EaSize: ULONG,
    pub FileId: LARGE_INTEGER,
    pub FileName: [WCHAR; 1],
}

/// `FILE_FS_VOLUME_INFORMATION` (`ntifs.h`) — `NtQueryVolumeInformationFile`
/// (`FileFsVolumeInformation`) payload; `VolumeLabel` is a flexible array, so
/// fixed-size queries return `STATUS_BUFFER_OVERFLOW` with the serial valid.
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_FS_VOLUME_INFORMATION {
    pub VolumeCreationTime: LARGE_INTEGER,
    pub VolumeSerialNumber: ULONG,
    pub VolumeLabelLength: ULONG,
    pub SupportsObjects: BOOLEAN,
    pub VolumeLabel: [WCHAR; 1],
}

/// `FILE_FS_DEVICE_INFORMATION` (`wdm.h`) — `NtQueryVolumeInformationFile`
/// (`FileFsDeviceInformation`) payload.
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_FS_DEVICE_INFORMATION {
    pub DeviceType: DWORD,
    pub Characteristics: ULONG,
}

// `FILE_DEVICE_*` (`winioctl.h`) — `FILE_FS_DEVICE_INFORMATION.DeviceType`
// values consumed by the stat engine.
pub const FILE_DEVICE_FILE_SYSTEM: DWORD = 0x0000_0009;
pub const FILE_DEVICE_NAMED_PIPE: DWORD = 0x0000_0011;
pub const FILE_DEVICE_NULL: DWORD = 0x0000_0015;
pub const FILE_DEVICE_CONSOLE: DWORD = 0x0000_0050;

/// `GetFileType` return values (`fileapi.h`).
pub const FILE_TYPE_UNKNOWN: DWORD = 0x0000;
pub const FILE_TYPE_DISK: DWORD = 0x0001;
pub const FILE_TYPE_CHAR: DWORD = 0x0002;
pub const FILE_TYPE_PIPE: DWORD = 0x0003;
pub const FILE_TYPE_REMOTE: DWORD = 0x8000;

/// `CTL_CODE(FILE_DEVICE_FILE_SYSTEM, 42, METHOD_BUFFERED, FILE_ANY_ACCESS)`
/// (`winioctl.h`): `(device << 16) | (access << 14) | (function << 2) | method`.
pub const FSCTL_GET_REPARSE_POINT: DWORD = (FILE_DEVICE_FILE_SYSTEM << 16) | (42 << 2);
/// `CTL_CODE(FILE_DEVICE_FILE_SYSTEM, 41, METHOD_BUFFERED, FILE_SPECIAL_ACCESS)`
/// (`winioctl.h`); `FILE_SPECIAL_ACCESS == FILE_ANY_ACCESS == 0`.
pub const FSCTL_SET_REPARSE_POINT: DWORD = (FILE_DEVICE_FILE_SYSTEM << 16) | (41 << 2);

/// `MAXIMUM_REPARSE_DATA_BUFFER_SIZE` (`winnt.h`) — upper bound of any
/// `FSCTL_GET_REPARSE_POINT` output.
pub const MAXIMUM_REPARSE_DATA_BUFFER_SIZE: usize = 16 * 1024;

// Reparse tags (`winnt.h`; `IO_REPARSE_TAG_LX_SYMLINK` from libuv
// winapi.h:4590 — absent from older SDKs).
pub const IO_REPARSE_TAG_MOUNT_POINT: ULONG = 0xA000_0003;
pub const IO_REPARSE_TAG_SYMLINK: ULONG = 0xA000_000C;
pub const IO_REPARSE_TAG_LX_SYMLINK: ULONG = 0xA000_001D;
pub const IO_REPARSE_TAG_APPEXECLINK: ULONG = 0x8000_001B;

/// `REPARSE_DATA_BUFFER.SymbolicLinkReparseBuffer` (`ntifs.h`).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct SYMBOLIC_LINK_REPARSE_BUFFER {
    pub SubstituteNameOffset: u16,
    pub SubstituteNameLength: u16,
    pub PrintNameOffset: u16,
    pub PrintNameLength: u16,
    pub Flags: ULONG,
    pub PathBuffer: [WCHAR; 1],
}

/// `REPARSE_DATA_BUFFER.MountPointReparseBuffer` (`ntifs.h`).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct MOUNT_POINT_REPARSE_BUFFER {
    pub SubstituteNameOffset: u16,
    pub SubstituteNameLength: u16,
    pub PrintNameOffset: u16,
    pub PrintNameLength: u16,
    pub PathBuffer: [WCHAR; 1],
}

/// `REPARSE_DATA_BUFFER.LinuxSymbolicLinkReparseBuffer` (libuv
/// winapi.h:4166-4169) — WSL `LX_SYMLINK` payload: a 4-byte version field
/// then raw target bytes (no encoding conversion).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct LINUX_SYMBOLIC_LINK_REPARSE_BUFFER {
    pub Version: ULONG,
    pub PathBuffer: [u8; 1],
}

/// `REPARSE_DATA_BUFFER.AppExecLinkReparseBuffer` (libuv winapi.h:4180-4183)
/// — `StringList` is `StringCount` NUL-separated strings.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct APP_EXEC_LINK_REPARSE_BUFFER {
    pub StringCount: ULONG,
    pub StringList: [WCHAR; 1],
}

/// `REPARSE_DATA_BUFFER.GenericReparseBuffer` (`ntifs.h`).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GENERIC_REPARSE_BUFFER {
    pub DataBuffer: [u8; 1],
}

/// The anonymous payload union of `REPARSE_DATA_BUFFER` (`ntifs.h`); named
/// `u` here because Rust lacks anonymous unions.
#[repr(C)]
#[derive(Copy, Clone)]
pub union REPARSE_DATA_BUFFER_u {
    pub SymbolicLinkReparseBuffer: SYMBOLIC_LINK_REPARSE_BUFFER,
    pub MountPointReparseBuffer: MOUNT_POINT_REPARSE_BUFFER,
    pub LinuxSymbolicLinkReparseBuffer: LINUX_SYMBOLIC_LINK_REPARSE_BUFFER,
    pub AppExecLinkReparseBuffer: APP_EXEC_LINK_REPARSE_BUFFER,
    pub GenericReparseBuffer: GENERIC_REPARSE_BUFFER,
}

/// `REPARSE_DATA_BUFFER` (`ntifs.h`) — header of `FSCTL_GET_REPARSE_POINT`
/// output. All `PathBuffer` members are flexible arrays; read past them via
/// the offset/length fields, bounded by `ReparseDataLength`.
#[repr(C)]
pub struct REPARSE_DATA_BUFFER {
    pub ReparseTag: ULONG,
    pub ReparseDataLength: u16,
    pub Reserved: u16,
    pub u: REPARSE_DATA_BUFFER_u,
}

// Layout pins for the stat-family structs (authoritative Windows-x64 sizes;
// `FILE_ID_FULL_DIR_INFORMATION == 88` is also the empirically verified
// `IO_STATUS_BLOCK.Information` of a fixed-size single-entry query).
// // quirk: FSMETA-06, FSMETA-12
#[cfg(all(windows, target_pointer_width = "64"))]
const _: () = {
    assert!(core::mem::size_of::<FILE_STAT_BASIC_INFORMATION>() == 104);
    assert!(core::mem::size_of::<FILE_ALL_INFORMATION>() == 104);
    assert!(core::mem::size_of::<FILE_STANDARD_INFORMATION>() == 24);
    assert!(core::mem::size_of::<FILE_ID_FULL_DIR_INFORMATION>() == 88);
    assert!(core::mem::size_of::<FILE_FS_VOLUME_INFORMATION>() == 24);
    assert!(core::mem::size_of::<FILE_FS_DEVICE_INFORMATION>() == 8);
    assert!(core::mem::size_of::<REPARSE_DATA_BUFFER>() == 24);
};

// ──────────────────────────────────────────────────────────────────────────
// ntdll namespace (subset).
// ──────────────────────────────────────────────────────────────────────────
pub mod ntdll {
    use super::*;

    /// `SystemProcessorPerformanceInformation` (class 8) row — 100ns units.
    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub struct SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION {
        pub IdleTime: i64,
        pub KernelTime: i64,
        pub UserTime: i64,
        pub DpcTime: i64,
        pub InterruptTime: i64,
        pub InterruptCount: u32,
    }
    pub const SystemProcessorPerformanceInformation: u32 = 8;

    /// `RTL_OSVERSIONINFOW` (`wdm.h`) — out-param of `RtlGetVersion`;
    /// `dwOSVersionInfoSize` must be stamped with `size_of` before the call.
    #[repr(C)]
    pub struct RTL_OSVERSIONINFOW {
        pub dwOSVersionInfoSize: ULONG,
        pub dwMajorVersion: ULONG,
        pub dwMinorVersion: ULONG,
        pub dwBuildNumber: ULONG,
        pub dwPlatformId: ULONG,
        /// Service-pack string; empty on every modern Windows.
        pub szCSDVersion: [WCHAR; 128],
    }
    // Layout pin: fixed-width fields only, so this holds on cross-host checks.
    const _: () = assert!(core::mem::size_of::<RTL_OSVERSIONINFOW>() == 276);

    #[link(name = "ntdll")]
    unsafe extern "system" {
        /// `NtQuerySystemInformation` (`winternl.h`).
        pub fn NtQuerySystemInformation(
            SystemInformationClass: u32,
            SystemInformation: *mut c_void,
            SystemInformationLength: u32,
            ReturnLength: *mut u32,
        ) -> NTSTATUS;
        /// `RtlGetVersion` (`wdm.h`) — the unmanifested `GetVersionExW`:
        /// reports the real OS version regardless of compatibility shims.
        /// safe: out-param is a non-null `&mut` that ntdll only writes; the
        /// caller-stamped `dwOSVersionInfoSize` is validated, not trusted.
        pub safe fn RtlGetVersion(VersionInformation: &mut RTL_OSVERSIONINFOW) -> NTSTATUS;
        pub fn RtlCaptureStackBackTrace(
            FramesToSkip: u32,
            FramesToCapture: u32,
            BackTrace: *mut *mut c_void,
            BackTraceHash: *mut u32,
        ) -> u16;
        pub fn NtCreateFile(
            FileHandle: *mut HANDLE,
            DesiredAccess: ACCESS_MASK,
            ObjectAttributes: *mut OBJECT_ATTRIBUTES,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            AllocationSize: *mut LARGE_INTEGER,
            FileAttributes: ULONG,
            ShareAccess: ULONG,
            CreateDisposition: ULONG,
            CreateOptions: ULONG,
            EaBuffer: *mut c_void,
            EaLength: ULONG,
        ) -> NTSTATUS;
        pub fn NtQueryDirectoryFile(
            FileHandle: HANDLE,
            Event: HANDLE,
            ApcRoutine: *mut c_void,
            ApcContext: *mut c_void,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            FileInformation: *mut c_void,
            Length: ULONG,
            FileInformationClass: FILE_INFORMATION_CLASS,
            ReturnSingleEntry: BOOLEAN,
            FileName: *mut UNICODE_STRING,
            RestartScan: BOOLEAN,
        ) -> NTSTATUS;
        pub fn NtQueryAttributesFile(
            ObjectAttributes: *const OBJECT_ATTRIBUTES,
            FileInformation: *mut FILE_BASIC_INFORMATION,
        ) -> NTSTATUS;
        pub fn NtSetInformationFile(
            FileHandle: HANDLE,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            FileInformation: *mut c_void,
            Length: ULONG,
            FileInformationClass: FILE_INFORMATION_CLASS,
        ) -> NTSTATUS;
        /// `NtQueryInformationFile` (`ntifs.h`) — generic counterpart to
        /// `NtSetInformationFile`; populates `FileInformation` per `class`.
        pub fn NtQueryInformationFile(
            FileHandle: HANDLE,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            FileInformation: *mut c_void,
            Length: ULONG,
            FileInformationClass: FILE_INFORMATION_CLASS,
        ) -> NTSTATUS;
        /// `NtQueryVolumeInformationFile` (`ntifs.h`) — volume-level info
        /// classes (`FS_INFORMATION_CLASS`). `STATUS_BUFFER_OVERFLOW`
        /// (warning severity) means the fixed-size members are valid.
        /// // quirk: FSMETA-06
        pub fn NtQueryVolumeInformationFile(
            FileHandle: HANDLE,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            FsInformation: *mut c_void,
            Length: ULONG,
            FsInformationClass: FS_INFORMATION_CLASS,
        ) -> NTSTATUS;
        pub fn NtClose(Handle: HANDLE) -> NTSTATUS;
        /// `NtDeviceIoControlFile` (`ntifs.h`; libuv winapi.h:4607-4617).
        /// `ApcContext` is what an associated IOCP dequeues as `lpOverlapped`:
        /// pass the OVERLAPPED to get a completion packet, NULL to suppress
        /// it. Linked directly — ntdll exports it since NT, no GetProcAddress
        /// probe needed on the supported baseline. // quirk: POLL-33, POLL-43
        pub fn NtDeviceIoControlFile(
            FileHandle: HANDLE,
            Event: HANDLE,
            ApcRoutine: *mut c_void,
            ApcContext: *mut c_void,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            IoControlCode: ULONG,
            InputBuffer: *mut c_void,
            InputBufferLength: ULONG,
            OutputBuffer: *mut c_void,
            OutputBufferLength: ULONG,
        ) -> NTSTATUS;

        // ── futex (`WaitOnAddress`) — used by `bun_threading::Futex` ──
        // Linked from ntdll instead of `API-MS-Win-Core-Synch-l1-2-0.dll`
        // because ntdll is autoloaded into every process; the Rtl* wrappers
        // forward to the same kernel objects.
        pub fn RtlWaitOnAddress(
            Address: *const c_void,
            CompareAddress: *const c_void,
            AddressSize: usize,
            Timeout: *const LARGE_INTEGER,
        ) -> NTSTATUS;
        pub fn RtlWakeAddressSingle(Address: *const c_void);
        pub fn RtlWakeAddressAll(Address: *const c_void);

        /// `RtlExitUserProcess` (ntdll). The Win32 `ExitProcess` forwards to
        /// this; the freestanding `bun_shim_impl` calls it directly to avoid
        /// linking kernel32 in the standalone PE.
        pub fn RtlExitUserProcess(ExitStatus: u32) -> !;

        pub fn NtReadFile(
            FileHandle: HANDLE,
            Event: HANDLE,
            ApcRoutine: *mut c_void,
            ApcContext: *mut c_void,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            Buffer: *mut c_void,
            Length: ULONG,
            ByteOffset: *const LARGE_INTEGER,
            Key: *const ULONG,
        ) -> NTSTATUS;
        pub fn NtWriteFile(
            FileHandle: HANDLE,
            Event: HANDLE,
            ApcRoutine: *mut c_void,
            ApcContext: *mut c_void,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            Buffer: *const c_void,
            Length: ULONG,
            ByteOffset: *const LARGE_INTEGER,
            Key: *const ULONG,
        ) -> NTSTATUS;
    }
    pub use super::RtlNtStatusToDosError;
}
pub use ntdll::NtClose;

/// `user32` namespace (subset placeholder; fill in as needed).
pub mod user32 {
    /// `SM_CLEANBOOT` (winuser.h) — `GetSystemMetrics` index: 0 normal
    /// boot, 1 safe mode, 2 safe mode with networking.
    pub const SM_CLEANBOOT: i32 = 67;

    #[link(name = "user32")]
    unsafe extern "system" {
        pub safe fn GetSystemMetrics(nIndex: i32) -> i32;
    }
}
/// `advapi32` namespace.
pub mod advapi32 {
    use super::*;

    pub type HKEY = *mut c_void;
    pub const HKEY_LOCAL_MACHINE: HKEY = 0x8000_0002usize as HKEY;
    pub const KEY_QUERY_VALUE: u32 = 0x0001;
    /// `KEY_WOW64_64KEY` (`winnt.h`) — force the 64-bit registry view.
    pub const KEY_WOW64_64KEY: u32 = 0x0100;
    /// `RRF_RT_REG_SZ` (`winreg.h`) — `RegGetValueW` type filter.
    pub const RRF_RT_REG_SZ: DWORD = 0x0000_0002;
    pub const TOKEN_READ: DWORD = 0x0002_0008;

    #[link(name = "advapi32")]
    unsafe extern "system" {
        /// `RegOpenKeyExW` (`winreg.h`).
        pub fn RegOpenKeyExW(
            hKey: HKEY,
            lpSubKey: LPCWSTR,
            ulOptions: DWORD,
            samDesired: u32,
            phkResult: *mut HKEY,
        ) -> i32;
        /// `RegQueryValueExW` (`winreg.h`).
        pub fn RegQueryValueExW(
            hKey: HKEY,
            lpValueName: LPCWSTR,
            lpReserved: *mut DWORD,
            lpType: *mut DWORD,
            lpData: *mut u8,
            lpcbData: *mut DWORD,
        ) -> i32;
        /// `RegCloseKey` (`winreg.h`).
        pub fn RegCloseKey(hKey: HKEY) -> i32;
        /// `RegGetValueW` (`winreg.h`). Unlike `RegQueryValueExW`, the
        /// returned string is guaranteed NUL-terminated and `pcbData`
        /// includes that terminator.
        pub fn RegGetValueW(
            hkey: HKEY,
            lpSubKey: LPCWSTR,
            lpValue: LPCWSTR,
            dwFlags: DWORD,
            pdwType: *mut DWORD,
            pvData: *mut c_void,
            pcbData: *mut DWORD,
        ) -> i32;
        /// `OpenProcessToken` (`processthreadsapi.h`).
        pub fn OpenProcessToken(
            ProcessHandle: HANDLE,
            DesiredAccess: DWORD,
            TokenHandle: *mut HANDLE,
        ) -> BOOL;
    }
}

/// `normaliz` namespace — IDN conversions, resolved dynamically so
/// Normaliz.dll never becomes a load-time PE import (symbols.test allowlist;
/// absent on some minimal Server SKUs — degrade to no-IDN, never
/// STATUS_DLL_NOT_FOUND at process start).
pub mod normaliz {
    use core::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    type IdnToAsciiFn =
        unsafe extern "system" fn(DWORD, *const u16, c_int, *mut u16, c_int) -> c_int;

    // 0 = unresolved, 1 = unavailable, else the fn address.
    static IDN_TO_ASCII: AtomicUsize = AtomicUsize::new(0);

    /// `IdnToAscii` (`winnls.h`) — Unicode host label(s) → Punycode ASCII
    /// (RFC 3490). Returns the written length, 0 on failure or when
    /// Normaliz.dll / the export is unavailable. Flags 0 = default mapping.
    ///
    /// # Safety
    /// Same contract as the Win32 API: both buffers valid for their counts.
    pub unsafe fn IdnToAscii(
        dw_flags: DWORD,
        unicode: *const u16,
        unicode_len: c_int,
        ascii: *mut u16,
        ascii_cap: c_int,
    ) -> c_int {
        let mut addr = IDN_TO_ASCII.load(Ordering::Acquire);
        if addr == 0 {
            // SAFETY: NUL-terminated literals; benign to race — both
            // winners store the same address.
            addr = unsafe {
                let lib = LoadLibraryA(c"normaliz.dll".as_ptr().cast());
                if lib.is_null() {
                    1
                } else {
                    let f = GetProcAddress(lib, c"IdnToAscii".as_ptr().cast());
                    if f.is_null() { 1 } else { f as usize }
                }
            };
            IDN_TO_ASCII.store(addr, Ordering::Release);
        }
        if addr == 1 {
            return 0;
        }
        // SAFETY: `addr` is the resolved export with the documented signature.
        let f: IdnToAsciiFn = unsafe { core::mem::transmute(addr) };
        // SAFETY: caller upholds the buffer contract.
        unsafe { f(dw_flags, unicode, unicode_len, ascii, ascii_cap) }
    }
}

/// `userenv` namespace.
pub mod userenv {
    use super::*;

    #[link(name = "userenv")]
    unsafe extern "system" {
        /// `GetUserProfileDirectoryW` (`userenv.h`). Size-probe-then-fill.
        pub fn GetUserProfileDirectoryW(
            hToken: HANDLE,
            lpProfileDir: LPWSTR,
            lpcchSize: *mut DWORD,
        ) -> BOOL;
    }
}

/// `iphlpapi` namespace — adapter enumeration for `os.networkInterfaces`.
pub mod iphlpapi {
    use super::*;

    /// `SOCKET_ADDRESS` (`ws2def.h`).
    #[repr(C)]
    pub struct SOCKET_ADDRESS {
        pub lpSockaddr: *mut ws2_32::sockaddr,
        pub iSockaddrLength: c_int,
    }

    /// `MAX_ADAPTER_ADDRESS_LENGTH` (`iptypes.h`).
    pub const MAX_ADAPTER_ADDRESS_LENGTH: usize = 8;

    /// `IP_ADAPTER_UNICAST_ADDRESS_LH` (`iptypes.h`) — node of the
    /// per-adapter unicast address list.
    #[repr(C)]
    pub struct IP_ADAPTER_UNICAST_ADDRESS {
        /// Anonymous `{ULONG Length; DWORD Flags}` union, kept as one u64.
        pub Alignment: u64,
        pub Next: *mut IP_ADAPTER_UNICAST_ADDRESS,
        pub Address: SOCKET_ADDRESS,
        /// `IP_PREFIX_ORIGIN` (4-byte enum).
        pub PrefixOrigin: u32,
        /// `IP_SUFFIX_ORIGIN` (4-byte enum).
        pub SuffixOrigin: u32,
        /// `IP_DAD_STATE` (4-byte enum).
        pub DadState: u32,
        pub ValidLifetime: ULONG,
        pub PreferredLifetime: ULONG,
        pub LeaseLifetime: ULONG,
        pub OnLinkPrefixLength: u8,
    }

    /// `IP_ADAPTER_ADDRESSES_LH` (`iptypes.h`) — **version-stable prefix**:
    /// the OS record is 448 bytes on x64 but only the fields through
    /// `OperStatus` are declared (all this crate reads). Never allocate or
    /// index arrays of this type — records are walked via `Next` inside the
    /// caller-allocated `GetAdaptersAddresses` buffer.
    #[repr(C)]
    pub struct IP_ADAPTER_ADDRESSES {
        /// Anonymous `{ULONG Length; IF_INDEX IfIndex}` union, kept as one u64.
        pub Alignment: u64,
        pub Next: *mut IP_ADAPTER_ADDRESSES,
        pub AdapterName: *mut c_char,
        pub FirstUnicastAddress: *mut IP_ADAPTER_UNICAST_ADDRESS,
        pub FirstAnycastAddress: *mut c_void,
        pub FirstMulticastAddress: *mut c_void,
        pub FirstDnsServerAddress: *mut c_void,
        pub DnsSuffix: *mut WCHAR,
        pub Description: *mut WCHAR,
        /// NUL-terminated UTF-16 display name (may be localized).
        pub FriendlyName: *mut WCHAR,
        pub PhysicalAddress: [BYTE; MAX_ADAPTER_ADDRESS_LENGTH],
        pub PhysicalAddressLength: ULONG,
        pub Flags: ULONG,
        pub Mtu: ULONG,
        /// `IF_TYPE_*` (`ipifcons.h`).
        pub IfType: ULONG,
        /// `IF_OPER_STATUS` (`ifdef.h`).
        pub OperStatus: u32,
    }

    /// `IfOperStatusUp` (`ifdef.h`, `IF_OPER_STATUS`).
    pub const IfOperStatusUp: u32 = 1;
    /// `IF_TYPE_SOFTWARE_LOOPBACK` (`ipifcons.h`).
    pub const IF_TYPE_SOFTWARE_LOOPBACK: ULONG = 24;

    // `GAA_FLAG_*` (`iptypes.h`).
    pub const GAA_FLAG_SKIP_ANYCAST: ULONG = 0x0002;
    pub const GAA_FLAG_SKIP_MULTICAST: ULONG = 0x0004;
    pub const GAA_FLAG_SKIP_DNS_SERVER: ULONG = 0x0008;

    // Layout pins (x64 sizes/offsets from the Windows SDK; the prefix size is
    // the through-`OperStatus` slice of the 448-byte LH record).
    #[cfg(target_pointer_width = "64")]
    const _: () = {
        assert!(core::mem::size_of::<SOCKET_ADDRESS>() == 16);
        assert!(core::mem::size_of::<IP_ADAPTER_UNICAST_ADDRESS>() == 64);
        assert!(core::mem::offset_of!(IP_ADAPTER_UNICAST_ADDRESS, Address) == 16);
        assert!(core::mem::offset_of!(IP_ADAPTER_UNICAST_ADDRESS, OnLinkPrefixLength) == 56);
        assert!(core::mem::size_of::<IP_ADAPTER_ADDRESSES>() == 112);
        assert!(core::mem::offset_of!(IP_ADAPTER_ADDRESSES, FriendlyName) == 72);
        assert!(core::mem::offset_of!(IP_ADAPTER_ADDRESSES, PhysicalAddress) == 80);
        assert!(core::mem::offset_of!(IP_ADAPTER_ADDRESSES, IfType) == 100);
        assert!(core::mem::offset_of!(IP_ADAPTER_ADDRESSES, OperStatus) == 104);
    };

    #[link(name = "iphlpapi")]
    unsafe extern "system" {
        /// `GetAdaptersAddresses` (`iphlpapi.h`). Size-probe-then-fill:
        /// returns `ERROR_BUFFER_OVERFLOW` with the required byte count in
        /// `SizePointer` until the buffer is large enough; on success the
        /// buffer holds a `Next`-linked list of adapter records.
        pub fn GetAdaptersAddresses(
            Family: ULONG,
            Flags: ULONG,
            Reserved: *mut c_void,
            AdapterAddresses: *mut IP_ADAPTER_ADDRESSES,
            SizePointer: *mut ULONG,
        ) -> ULONG;
    }
}

// `bun.windows.libuv` is exposed from the higher-tier `bun_sys::windows`
// module, NOT here — `bun_windows_sys` is the leaf Win32 externs crate and
// must not depend on `bun_libuv_sys` (would invert the tier ordering).

// ──────────────────────────────────────────────────────────────────────────
// kernel32 namespace (subset).
// ──────────────────────────────────────────────────────────────────────────
pub mod kernel32 {
    use super::*;

    #[repr(C)]
    pub struct MEMORY_BASIC_INFORMATION {
        pub BaseAddress: LPVOID,
        pub AllocationBase: LPVOID,
        pub AllocationProtect: u32,
        pub PartitionId: u16,
        pub RegionSize: usize,
        pub State: u32,
        pub Protect: u32,
        pub Type: u32,
    }
    pub const MEM_FREE: u32 = 0x10000;

    /// `MEMORYSTATUSEX` (`sysinfoapi.h`) — out-param of `GlobalMemoryStatusEx`;
    /// `dwLength` must be stamped with `size_of` before the call.
    #[repr(C)]
    pub struct MEMORYSTATUSEX {
        pub dwLength: DWORD,
        pub dwMemoryLoad: DWORD,
        pub ullTotalPhys: ULONGLONG,
        pub ullAvailPhys: ULONGLONG,
        pub ullTotalPageFile: ULONGLONG,
        pub ullAvailPageFile: ULONGLONG,
        pub ullTotalVirtual: ULONGLONG,
        pub ullAvailVirtual: ULONGLONG,
        pub ullAvailExtendedVirtual: ULONGLONG,
    }
    // Layout pin: fixed-width fields only, so this holds on cross-host checks.
    const _: () = assert!(core::mem::size_of::<MEMORYSTATUSEX>() == 64);

    #[link(name = "kernel32")]
    unsafe extern "system" {
        /// No preconditions; reads thread-local Win32 error slot.
        pub safe fn GetLastError() -> DWORD;
        pub fn VirtualQuery(
            lpAddress: LPCVOID,
            lpBuffer: *mut MEMORY_BASIC_INFORMATION,
            dwLength: usize,
        ) -> usize;
        /// No preconditions; terminates the process (cf. `std::process::exit`).
        pub safe fn ExitProcess(exit_code: u32) -> !;
        /// No preconditions; returns the cached console/std handle (or
        /// `INVALID_HANDLE_VALUE`/null on failure).
        pub safe fn GetStdHandle(nStdHandle: DWORD) -> HANDLE;
        /// No preconditions; returns the pseudo-handle constant `(HANDLE)-1`.
        pub safe fn GetCurrentProcess() -> HANDLE;
        /// `GetTickCount64` (`sysinfoapi.h`) — milliseconds since boot. No
        /// preconditions; cannot fail.
        pub safe fn GetTickCount64() -> ULONGLONG;
        /// `GlobalMemoryStatusEx` (`sysinfoapi.h`). safe: out-param is a
        /// non-null `&mut` the kernel only writes; the caller-stamped
        /// `dwLength` is validated (bad length → FALSE), never trusted.
        pub safe fn GlobalMemoryStatusEx(lpBuffer: &mut MEMORYSTATUSEX) -> BOOL;
        pub fn DuplicateHandle(
            hSourceProcessHandle: HANDLE,
            hSourceHandle: HANDLE,
            hTargetProcessHandle: HANDLE,
            lpTargetHandle: *mut HANDLE,
            dwDesiredAccess: DWORD,
            bInheritHandle: BOOL,
            dwOptions: DWORD,
        ) -> BOOL;
        pub fn GetFileSizeEx(hFile: HANDLE, lpFileSize: *mut LARGE_INTEGER) -> BOOL;
        /// `ReadFile` (`fileapi.h`) — synchronous read on a HANDLE.
        /// `lpOverlapped` may be null for non-OVERLAPPED I/O.
        /// `GetOverlappedResult` (`ioapiset.h`) — waits (bWait=TRUE) for or
        /// polls an overlapped op's completion and yields its transfer count.
        pub fn GetOverlappedResult(
            hFile: HANDLE,
            lpOverlapped: *mut OVERLAPPED,
            lpNumberOfBytesTransferred: *mut DWORD,
            bWait: BOOL,
        ) -> BOOL;
        pub fn ReadFile(
            hFile: HANDLE,
            lpBuffer: *mut u8,
            nNumberOfBytesToRead: DWORD,
            lpNumberOfBytesRead: *mut DWORD,
            lpOverlapped: *mut c_void,
        ) -> BOOL;
        /// `WriteFile` (`fileapi.h`) — synchronous write on a HANDLE.
        /// `lpOverlapped` may be null for non-OVERLAPPED I/O.
        pub fn WriteFile(
            hFile: HANDLE,
            lpBuffer: *const u8,
            nNumberOfBytesToWrite: DWORD,
            lpNumberOfBytesWritten: *mut DWORD,
            lpOverlapped: *mut c_void,
        ) -> BOOL;
        pub fn LoadLibraryExW(lpLibFileName: LPCWSTR, hFile: HANDLE, dwFlags: DWORD) -> HMODULE;
        /// Cannot fail on XP+ (always returns TRUE and writes the count).
        pub fn QueryPerformanceCounter(lpPerformanceCount: *mut i64) -> BOOL;
        /// Cannot fail on XP+. The frequency is fixed at boot; cacheable.
        pub fn QueryPerformanceFrequency(lpFrequency: *mut i64) -> BOOL;
        /// Process-global; returns the previous mode (last writer wins).
        pub safe fn SetErrorMode(uMode: DWORD) -> DWORD;
        /// No preconditions; reads the process error mode.
        pub safe fn GetErrorMode() -> DWORD;
        /// `CreateIoCompletionPort` (`ioapiset.h`). Creates a port
        /// (`FileHandle = INVALID_HANDLE_VALUE`, `ExistingCompletionPort =
        /// null`) or associates a handle with one.
        pub fn CreateIoCompletionPort(
            FileHandle: HANDLE,
            ExistingCompletionPort: HANDLE,
            CompletionKey: ULONG_PTR,
            NumberOfConcurrentThreads: DWORD,
        ) -> HANDLE;
        /// `GetQueuedCompletionStatusEx` (`ioapiset.h`). May return before
        /// `dwMilliseconds` elapses (timeouts quantize to the scheduler
        /// tick); deadline callers must recompute and re-arm. // quirk: LOOP-02
        pub fn GetQueuedCompletionStatusEx(
            CompletionPort: HANDLE,
            lpCompletionPortEntries: *mut OVERLAPPED_ENTRY,
            ulCount: ULONG,
            ulNumEntriesRemoved: *mut ULONG,
            dwMilliseconds: DWORD,
            fAlertable: BOOL,
        ) -> BOOL;
        /// `PostQueuedCompletionStatus` (`ioapiset.h`). `lpOverlapped` may be
        /// null — consumers must filter null entries before dereferencing.
        /// // quirk: LOOP-03
        pub fn PostQueuedCompletionStatus(
            CompletionPort: HANDLE,
            dwNumberOfBytesTransferred: DWORD,
            dwCompletionKey: ULONG_PTR,
            lpOverlapped: *mut OVERLAPPED,
        ) -> BOOL;
        pub fn GetExitCodeProcess(hProcess: HANDLE, lpExitCode: *mut DWORD) -> BOOL;
        /// `FlushFileBuffers` — fsync(2)-equivalent for HANDLE-backed files.
        pub fn FlushFileBuffers(hFile: HANDLE) -> BOOL;
        /// `DeviceIoControl` (`ioapiset.h`). `lpOverlapped` may be null for
        /// synchronous handles.
        pub fn DeviceIoControl(
            hDevice: HANDLE,
            dwIoControlCode: DWORD,
            lpInBuffer: LPVOID,
            nInBufferSize: DWORD,
            lpOutBuffer: LPVOID,
            nOutBufferSize: DWORD,
            lpBytesReturned: *mut DWORD,
            lpOverlapped: *mut OVERLAPPED,
        ) -> BOOL;
        /// safe: `HANDLE` is a by-value opaque; bad handle →
        /// `FILE_TYPE_UNKNOWN` + GetLastError, no UB.
        pub safe fn GetFileType(hFile: HANDLE) -> DWORD;
        /// `GetModuleHandleW` (`libloaderapi.h`). Resolution-only — returns
        /// the already-loaded module's base or NULL; never loads, so probing
        /// an apiset DLL has no DLL-planting surface. // quirk: FSMETA-02
        pub fn GetModuleHandleW(lpModuleName: LPCWSTR) -> HMODULE;
        /// `RemoveDirectoryW` (`fileapi.h`).
        pub fn RemoveDirectoryW(lpPathName: LPCWSTR) -> BOOL;
        /// `GetVolumeNameForVolumeMountPointW` (`fileapi.h`) — yields the
        /// `\\?\Volume{guid}\` name backing a mount point / drive root.
        pub fn GetVolumeNameForVolumeMountPointW(
            lpszVolumeMountPoint: LPCWSTR,
            lpszVolumeName: LPWSTR,
            cchBufferLength: DWORD,
        ) -> BOOL;
        /// `SetHandleInformation` (`handleapi.h`). No pointer preconditions:
        /// `hObject` is an opaque kernel handle (validated kernel-side; bad
        /// handle → `FALSE` + `GetLastError`), `dwMask`/`dwFlags` are by-value.
        pub safe fn SetHandleInformation(hObject: HANDLE, dwMask: DWORD, dwFlags: DWORD) -> BOOL;
        /// `CreateProcessW` (`processthreadsapi.h`).
        pub fn CreateProcessW(
            lpApplicationName: LPCWSTR,
            lpCommandLine: LPWSTR,
            lpProcessAttributes: *mut c_void,
            lpThreadAttributes: *mut c_void,
            bInheritHandles: BOOL,
            dwCreationFlags: DWORD,
            lpEnvironment: *mut c_void,
            lpCurrentDirectory: LPCWSTR,
            lpStartupInfo: *mut STARTUPINFOW,
            lpProcessInformation: *mut PROCESS_INFORMATION,
        ) -> BOOL;
        /// `SetConsoleCtrlHandler` — install/uninstall a console ctrl handler.
        /// No pointer preconditions: the handler is an `Option<fn>` (null-safe)
        /// and `Add` is a by-value BOOL.
        pub safe fn SetConsoleCtrlHandler(
            HandlerRoutine: Option<unsafe extern "system" fn(DWORD) -> BOOL>,
            Add: BOOL,
        ) -> BOOL;
        /// `CancelIoEx` (`ioapiset.h`). Cancels pending I/O on `hFile`
        /// matching `lpOverlapped` (all of the handle's I/O when null); the
        /// cancelled operations complete with STATUS_CANCELLED.
        pub fn CancelIoEx(hFile: HANDLE, lpOverlapped: *mut OVERLAPPED) -> BOOL;
        /// `CreateEventW` (`synchapi.h`). Null name = anonymous event.
        pub fn CreateEventW(
            lpEventAttributes: *mut SECURITY_ATTRIBUTES,
            bManualReset: BOOL,
            bInitialState: BOOL,
            lpName: LPCWSTR,
        ) -> HANDLE;
        /// `QueueUserWorkItem` (`threadpoollegacyapiset.h`) — run `Function`
        /// on the SYSTEM thread pool (not a Bun pool). `Context` is passed
        /// through verbatim; lifetime is the caller's contract.
        pub fn QueueUserWorkItem(
            Function: unsafe extern "system" fn(*mut c_void) -> DWORD,
            Context: *mut c_void,
            Flags: ULONG,
        ) -> BOOL;
    }
    /// `WT_EXECUTELONGFUNCTION` (`winnt.h`) — hints the pool that the work
    /// item may block, so it spins up extra threads instead of starving.
    pub const WT_EXECUTELONGFUNCTION: ULONG = 0x0000_0010;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        /// `GetConsoleScreenBufferInfo` (`wincon.h`).
        pub fn GetConsoleScreenBufferInfo(
            hConsoleOutput: HANDLE,
            lpConsoleScreenBufferInfo: *mut CONSOLE_SCREEN_BUFFER_INFO,
        ) -> BOOL;
        /// `FillConsoleOutputAttribute` (`wincon.h`).
        pub fn FillConsoleOutputAttribute(
            hConsoleOutput: HANDLE,
            wAttribute: WORD,
            nLength: DWORD,
            dwWriteCoord: COORD,
            lpNumberOfAttrsWritten: *mut DWORD,
        ) -> BOOL;
        /// `FillConsoleOutputCharacterW` (`wincon.h`).
        pub fn FillConsoleOutputCharacterW(
            hConsoleOutput: HANDLE,
            cCharacter: WCHAR,
            nLength: DWORD,
            dwWriteCoord: COORD,
            lpNumberOfCharsWritten: *mut DWORD,
        ) -> BOOL;
        /// `SetConsoleCursorPosition` (`wincon.h`).
        pub fn SetConsoleCursorPosition(hConsoleOutput: HANDLE, dwCursorPosition: COORD) -> BOOL;
        /// `ExitThread` (`processthreadsapi.h`). No preconditions; terminates
        /// the calling thread.
        pub safe fn ExitThread(dwExitCode: DWORD) -> !;
        /// `CreateNamedPipeW` (`winbase.h`).
        pub fn CreateNamedPipeW(
            lpName: LPCWSTR,
            dwOpenMode: DWORD,
            dwPipeMode: DWORD,
            nMaxInstances: DWORD,
            nOutBufferSize: DWORD,
            nInBufferSize: DWORD,
            nDefaultTimeOut: DWORD,
            lpSecurityAttributes: *mut c_void,
        ) -> HANDLE;
        /// `AddVectoredExceptionHandler` (`errhandlingapi.h`).
        pub fn AddVectoredExceptionHandler(
            First: u32,
            Handler: unsafe extern "system" fn(*mut c_void) -> i32,
        ) -> *mut c_void;
        /// `RemoveVectoredExceptionHandler` (`errhandlingapi.h`).
        pub fn RemoveVectoredExceptionHandler(Handle: *mut c_void) -> u32;
    }
    // Re-export externs declared at the crate root so `kernel32::Foo` resolves.
    pub use super::{
        CreateFileW, GetCurrentDirectoryW, GetFileAttributesW, GetSystemInfo, SYSTEM_INFO,
        SetCurrentDirectoryW, SetFilePointerEx,
    };
    pub use super::{
        GetConsoleCP, GetConsoleMode, GetConsoleOutputCP, SetConsoleCP, SetConsoleMode,
        SetConsoleOutputCP,
    };
}
pub use kernel32::{GetCurrentProcess, GetExitCodeProcess, GetLastError};

pub const INFINITE: DWORD = 0xFFFF_FFFF;
pub const WAIT_OBJECT_0: DWORD = 0;
pub const WAIT_TIMEOUT: DWORD = 258;
pub const WAIT_FAILED: DWORD = 0xFFFF_FFFF;
pub const STARTF_USESTDHANDLES: DWORD = 0x0000_0100;

#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "WaitForSingleObject"]
    fn WaitForSingleObject_raw(hHandle: HANDLE, dwMilliseconds: DWORD) -> DWORD;
}
/// SAFETY: `handle` must be a valid waitable kernel object.
pub unsafe fn WaitForSingleObject(handle: HANDLE, ms: DWORD) -> Result<DWORD, Win32Error> {
    // SAFETY: caller contract guarantees `handle` is a valid waitable kernel
    // object; `ms` is a by-value DWORD with no pointer preconditions.
    let rc = unsafe { WaitForSingleObject_raw(handle, ms) };
    if rc == WAIT_FAILED {
        Err(Win32Error::get())
    } else {
        Ok(rc)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NTSTATUS — a transparent newtype so unmapped codes round-trip.
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
    /// `STATUS_FILE_DELETED` — an I/O request other than close was performed on
    /// a file after it was deleted (typically `NtCreateFile` against a name
    /// that has already been POSIX-delete-pended).
    pub const FILE_DELETED: NTSTATUS = NTSTATUS(0xC000_0123);
    pub const SHARING_VIOLATION: NTSTATUS = NTSTATUS(0xC000_0043);
    /// `STATUS_CANNOT_DELETE` — the file has `FILE_ATTRIBUTE_READONLY` (and the
    /// filesystem rejected `FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE`), or a
    /// memory-mapped section exists for the file. Returned by
    /// `NtSetInformationFile(FileDispositionInformation)`.
    pub const CANNOT_DELETE: NTSTATUS = NTSTATUS(0xC000_0121);
    pub const OBJECT_PATH_SYNTAX_BAD: NTSTATUS = NTSTATUS(0xC000_003B);
    pub const NO_MORE_FILES: NTSTATUS = NTSTATUS(0x8000_0006);
    pub const NO_SUCH_FILE: NTSTATUS = NTSTATUS(0xC000_000F);
    /// `STATUS_TIMEOUT` — returned by `NtWaitForSingleObject` /
    /// `RtlWaitOnAddress` when the wait timed out.
    pub const TIMEOUT: NTSTATUS = NTSTATUS(0x0000_0102);
    /// `STATUS_END_OF_FILE` — `NtReadFile` past EOF.
    pub const END_OF_FILE: NTSTATUS = NTSTATUS(0xC000_0011);

    // Statuses surfaced by AFD/socket completions, consumed by
    // `bun_sys::windows::win_error::ntstatus_to_winsock` (values transcribed
    // from libuv src/win/winapi.h).
    pub const PENDING: NTSTATUS = NTSTATUS(0x0000_0103);
    pub const ACCESS_VIOLATION: NTSTATUS = NTSTATUS(0xC000_0005);
    pub const OBJECT_TYPE_MISMATCH: NTSTATUS = NTSTATUS(0xC000_0024);
    pub const INSUFFICIENT_RESOURCES: NTSTATUS = NTSTATUS(0xC000_009A);
    pub const PAGEFILE_QUOTA: NTSTATUS = NTSTATUS(0xC000_0007);
    pub const COMMITMENT_LIMIT: NTSTATUS = NTSTATUS(0xC000_012D);
    pub const WORKING_SET_QUOTA: NTSTATUS = NTSTATUS(0xC000_00A1);
    pub const NO_MEMORY: NTSTATUS = NTSTATUS(0xC000_0017);
    pub const QUOTA_EXCEEDED: NTSTATUS = NTSTATUS(0xC000_0044);
    pub const TOO_MANY_PAGING_FILES: NTSTATUS = NTSTATUS(0xC000_0097);
    pub const REMOTE_RESOURCES: NTSTATUS = NTSTATUS(0xC000_013D);
    pub const TOO_MANY_ADDRESSES: NTSTATUS = NTSTATUS(0xC000_0209);
    pub const ADDRESS_ALREADY_EXISTS: NTSTATUS = NTSTATUS(0xC000_020A);
    pub const LINK_TIMEOUT: NTSTATUS = NTSTATUS(0xC000_013F);
    pub const IO_TIMEOUT: NTSTATUS = NTSTATUS(0xC000_00B5);
    pub const GRACEFUL_DISCONNECT: NTSTATUS = NTSTATUS(0xC000_0237);
    pub const REMOTE_DISCONNECT: NTSTATUS = NTSTATUS(0xC000_013C);
    pub const CONNECTION_RESET: NTSTATUS = NTSTATUS(0xC000_020D);
    pub const LINK_FAILED: NTSTATUS = NTSTATUS(0xC000_013E);
    pub const CONNECTION_DISCONNECTED: NTSTATUS = NTSTATUS(0xC000_020C);
    pub const PORT_UNREACHABLE: NTSTATUS = NTSTATUS(0xC000_023F);
    pub const HOPLIMIT_EXCEEDED: NTSTATUS = NTSTATUS(0xC000_A012);
    pub const LOCAL_DISCONNECT: NTSTATUS = NTSTATUS(0xC000_013B);
    pub const TRANSACTION_ABORTED: NTSTATUS = NTSTATUS(0xC000_020F);
    pub const CONNECTION_ABORTED: NTSTATUS = NTSTATUS(0xC000_0241);
    pub const BAD_NETWORK_PATH: NTSTATUS = NTSTATUS(0xC000_00BE);
    pub const NETWORK_UNREACHABLE: NTSTATUS = NTSTATUS(0xC000_023C);
    pub const PROTOCOL_UNREACHABLE: NTSTATUS = NTSTATUS(0xC000_023E);
    pub const HOST_UNREACHABLE: NTSTATUS = NTSTATUS(0xC000_023D);
    pub const CANCELLED: NTSTATUS = NTSTATUS(0xC000_0120);
    pub const REQUEST_ABORTED: NTSTATUS = NTSTATUS(0xC000_0240);
    /// Warning severity (0x8...), unlike most of its neighbors.
    pub const BUFFER_OVERFLOW: NTSTATUS = NTSTATUS(0x8000_0005);
    pub const INVALID_BUFFER_SIZE: NTSTATUS = NTSTATUS(0xC000_0206);
    pub const BUFFER_TOO_SMALL: NTSTATUS = NTSTATUS(0xC000_0023);
    pub const DEVICE_NOT_READY: NTSTATUS = NTSTATUS(0xC000_00A3);
    pub const REQUEST_NOT_ACCEPTED: NTSTATUS = NTSTATUS(0xC000_00D0);
    pub const INVALID_NETWORK_RESPONSE: NTSTATUS = NTSTATUS(0xC000_00C3);
    pub const NETWORK_BUSY: NTSTATUS = NTSTATUS(0xC000_00BF);
    pub const NO_SUCH_DEVICE: NTSTATUS = NTSTATUS(0xC000_000E);
    pub const UNEXPECTED_NETWORK_ERROR: NTSTATUS = NTSTATUS(0xC000_00C4);
    pub const INVALID_CONNECTION: NTSTATUS = NTSTATUS(0xC000_0140);
    pub const REMOTE_NOT_LISTENING: NTSTATUS = NTSTATUS(0xC000_00BC);
    pub const CONNECTION_REFUSED: NTSTATUS = NTSTATUS(0xC000_0236);
    pub const PIPE_DISCONNECTED: NTSTATUS = NTSTATUS(0xC000_00B0);
    pub const CONFLICTING_ADDRESSES: NTSTATUS = NTSTATUS(0xC000_0018);
    pub const INVALID_ADDRESS: NTSTATUS = NTSTATUS(0xC000_0141);
    pub const INVALID_ADDRESS_COMPONENT: NTSTATUS = NTSTATUS(0xC000_0207);
    pub const NOT_SUPPORTED: NTSTATUS = NTSTATUS(0xC000_00BB);
    pub const NOT_IMPLEMENTED: NTSTATUS = NTSTATUS(0xC000_0002);

    #[inline]
    pub const fn from_raw(raw: u32) -> Self {
        NTSTATUS(raw)
    }
    #[inline]
    pub const fn raw(self) -> u32 {
        self.0
    }
}

#[inline]
pub const fn NT_SUCCESS(status: NTSTATUS) -> bool {
    (status.0 as i32) >= 0
}
/// `NT_ERROR` (`ntdef.h`): severity field == 3. NOT `!NT_SUCCESS` —
/// warning-severity statuses (e.g. `STATUS_BUFFER_OVERFLOW`) fail
/// `NT_SUCCESS` yet carry valid data. // quirk: FSMETA-06
#[inline]
pub const fn NT_ERROR(status: NTSTATUS) -> bool {
    (status.0 >> 30) == 3
}
pub const STATUS_SUCCESS: NTSTATUS = NTSTATUS::SUCCESS;

/// NTSTATUS facility code for wrapped Win32 errors.
pub const FACILITY_NTWIN32: u32 = 0x7;
pub const ERROR_SEVERITY_WARNING: u32 = 0x8000_0000;
pub const ERROR_SEVERITY_ERROR: u32 = 0xC000_0000;

/// Embed a Win32 error in an NTSTATUS. The DDK's `NTSTATUS_FROM_WIN32` macro
/// uses ERROR severity (0xC007xxxx); the kernel's own convention for
/// FACILITY_NTWIN32-wrapped errors is WARNING severity (0x8007xxxx), and only
/// the warning form round-trips through `RtlNtStatusToDosError`.
/// // quirk: OS-49
#[inline]
pub const fn ntstatus_from_win32(code: Win32Error) -> NTSTATUS {
    NTSTATUS(ERROR_SEVERITY_WARNING | (FACILITY_NTWIN32 << 16) | code.0 as u32)
}

/// If `status` is a FACILITY_NTWIN32-wrapped Win32 error, extract it.
///
/// Kept bit-for-bit at libuv parity (a bit-subset test on the facility field,
/// not full-field equality): the predecessor of this check AND-ed the combined
/// facility+severity mask, classifying nearly every real NTSTATUS as a wrapped
/// Win32 error (upstream 0ded5d29). // quirk: POLL-44
#[inline]
pub const fn ntwin32_unwrap(status: NTSTATUS) -> Option<Win32Error> {
    let s = status.0;
    if (s & (FACILITY_NTWIN32 << 16)) == (FACILITY_NTWIN32 << 16)
        && (s & (ERROR_SEVERITY_ERROR | ERROR_SEVERITY_WARNING)) != 0
    {
        Some(Win32Error((s & 0xffff) as u16))
    } else {
        None
    }
}

#[link(name = "ntdll")]
unsafe extern "system" {
    /// Total over `NTSTATUS`; no preconditions.
    pub safe fn RtlNtStatusToDosError(status: NTSTATUS) -> DWORD;
}

/// `ws2_32` — Winsock2 surface (subset).
pub mod ws2_32 {
    use super::*;
    use core::sync::atomic::{AtomicBool, Ordering};

    pub const AF_UNSPEC: c_int = 0;
    pub const AF_UNIX: c_int = 1;
    pub const AF_INET: c_int = 2;
    pub const AF_INET6: c_int = 23;
    pub const SOCK_STREAM: c_int = 1;
    pub const SOCK_DGRAM: c_int = 2;
    pub const IPPROTO_TCP: c_int = 6;
    pub const IPPROTO_UDP: c_int = 17;

    /// `ADDRINFOA` (`ws2def.h`). Field names match POSIX `addrinfo` so
    /// cross-platform `bun_dns` code can dot-access without cfg arms.
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct addrinfo {
        pub ai_flags: c_int,
        pub ai_family: c_int,
        pub ai_socktype: c_int,
        pub ai_protocol: c_int,
        pub ai_addrlen: usize, // size_t
        pub ai_canonname: *mut c_char,
        pub ai_addr: *mut sockaddr,
        pub ai_next: *mut addrinfo,
    }

    /// `WSADATA` (`winsock2.h`, **`_WIN64` layout** — on 64-bit Windows
    /// `iMaxSockets`/`iMaxUdpDg`/`lpVendorInfo` come *before* the
    /// `szDescription`/`szSystemStatus` arrays; the 32-bit header swaps that
    /// order). Only ever read back from `WSAStartup`; callers zero-initialise
    /// and never project fields beyond `wVersion`.
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct WSADATA {
        pub wVersion: u16,
        pub wHighVersion: u16,
        pub iMaxSockets: u16,
        pub iMaxUdpDg: u16,
        pub lpVendorInfo: *mut u8,
        pub szDescription: [u8; 257],
        pub szSystemStatus: [u8; 129],
    }
    const _: () = assert!(core::mem::size_of::<WSADATA>() == 408);

    /// `SOCKADDR_STORAGE` (`ws2def.h`). 128 bytes, 8-aligned.
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_storage {
        pub ss_family: u16,
        __ss_pad1: [u8; 6],
        __ss_align: i64,
        __ss_pad2: [u8; 112],
    }
    const _: () = assert!(core::mem::size_of::<sockaddr_storage>() == 128);
    const _: () = assert!(core::mem::align_of::<sockaddr_storage>() == 8);

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr {
        pub sa_family: u16,
        pub sa_data: [u8; 14],
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_in {
        pub sin_family: u16,
        pub sin_port: u16,
        pub sin_addr: in_addr,
        pub sin_zero: [u8; 8],
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct in_addr {
        pub s_addr: u32,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct sockaddr_in6 {
        pub sin6_family: u16,
        pub sin6_port: u16,
        pub sin6_flowinfo: u32,
        pub sin6_addr: in6_addr,
        pub sin6_scope_id: u32,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct in6_addr {
        pub s6_addr: [u8; 16],
    }

    /// Winsock error codes — `WSAE*` (`WSABASEERR` = 10000).
    /// Newtype so `bun_sys::windows::win_sock_error_to_zig_error` can `match` on
    /// associated consts. Values from `winsock2.h`.
    #[repr(transparent)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct WinsockError(pub u16);
    impl WinsockError {
        #[inline]
        pub const fn raw(self) -> u16 {
            self.0
        }
        pub const WSA_INVALID_HANDLE: Self = Self(6);
        pub const WSA_NOT_ENOUGH_MEMORY: Self = Self(8);
        pub const WSA_INVALID_PARAMETER: Self = Self(87);
        pub const WSA_OPERATION_ABORTED: Self = Self(995);
        pub const WSA_IO_INCOMPLETE: Self = Self(996);
        pub const WSA_IO_PENDING: Self = Self(997);
        pub const WSAEINTR: Self = Self(10004);
        pub const WSAEBADF: Self = Self(10009);
        pub const WSAEACCES: Self = Self(10013);
        pub const WSAEFAULT: Self = Self(10014);
        pub const WSAEINVAL: Self = Self(10022);
        pub const WSAEMFILE: Self = Self(10024);
        pub const WSAEWOULDBLOCK: Self = Self(10035);
        pub const WSAEINPROGRESS: Self = Self(10036);
        pub const WSAEALREADY: Self = Self(10037);
        pub const WSAENOTSOCK: Self = Self(10038);
        pub const WSAEDESTADDRREQ: Self = Self(10039);
        pub const WSAEMSGSIZE: Self = Self(10040);
        pub const WSAEPROTOTYPE: Self = Self(10041);
        pub const WSAENOPROTOOPT: Self = Self(10042);
        pub const WSAEPROTONOSUPPORT: Self = Self(10043);
        pub const WSAESOCKTNOSUPPORT: Self = Self(10044);
        pub const WSAEOPNOTSUPP: Self = Self(10045);
        pub const WSAEPFNOSUPPORT: Self = Self(10046);
        pub const WSAEAFNOSUPPORT: Self = Self(10047);
        pub const WSAEADDRINUSE: Self = Self(10048);
        pub const WSAEADDRNOTAVAIL: Self = Self(10049);
        pub const WSAENETDOWN: Self = Self(10050);
        pub const WSAENETUNREACH: Self = Self(10051);
        pub const WSAENETRESET: Self = Self(10052);
        pub const WSAECONNABORTED: Self = Self(10053);
        pub const WSAECONNRESET: Self = Self(10054);
        pub const WSAENOBUFS: Self = Self(10055);
        pub const WSAEISCONN: Self = Self(10056);
        pub const WSAENOTCONN: Self = Self(10057);
        pub const WSAESHUTDOWN: Self = Self(10058);
        pub const WSAETOOMANYREFS: Self = Self(10059);
        pub const WSAETIMEDOUT: Self = Self(10060);
        pub const WSAECONNREFUSED: Self = Self(10061);
        pub const WSAELOOP: Self = Self(10062);
        pub const WSAENAMETOOLONG: Self = Self(10063);
        pub const WSAEHOSTDOWN: Self = Self(10064);
        pub const WSAEHOSTUNREACH: Self = Self(10065);
        pub const WSAENOTEMPTY: Self = Self(10066);
        pub const WSAEPROCLIM: Self = Self(10067);
        pub const WSAEUSERS: Self = Self(10068);
        pub const WSAEDQUOT: Self = Self(10069);
        pub const WSAESTALE: Self = Self(10070);
        pub const WSAEREMOTE: Self = Self(10071);
        pub const WSASYSNOTREADY: Self = Self(10091);
        pub const WSAVERNOTSUPPORTED: Self = Self(10092);
        pub const WSANOTINITIALISED: Self = Self(10093);
        pub const WSAEDISCON: Self = Self(10101);
        pub const WSAENOMORE: Self = Self(10102);
        pub const WSAECANCELLED: Self = Self(10103);
        pub const WSAEINVALIDPROCTABLE: Self = Self(10104);
        pub const WSAEINVALIDPROVIDER: Self = Self(10105);
        pub const WSAEPROVIDERFAILEDINIT: Self = Self(10106);
        pub const WSASYSCALLFAILURE: Self = Self(10107);
        pub const WSASERVICE_NOT_FOUND: Self = Self(10108);
        pub const WSATYPE_NOT_FOUND: Self = Self(10109);
        pub const WSA_E_NO_MORE: Self = Self(10110);
        pub const WSA_E_CANCELLED: Self = Self(10111);
        pub const WSAEREFUSED: Self = Self(10112);
        pub const WSAHOST_NOT_FOUND: Self = Self(11001);
        pub const WSATRY_AGAIN: Self = Self(11002);
        pub const WSANO_RECOVERY: Self = Self(11003);
        pub const WSANO_DATA: Self = Self(11004);
        pub const WSA_QOS_RECEIVERS: Self = Self(11005);
        pub const WSA_QOS_SENDERS: Self = Self(11006);
        pub const WSA_QOS_NO_SENDERS: Self = Self(11007);
        pub const WSA_QOS_NO_RECEIVERS: Self = Self(11008);
        pub const WSA_QOS_REQUEST_CONFIRMED: Self = Self(11009);
        pub const WSA_QOS_ADMISSION_FAILURE: Self = Self(11010);
        pub const WSA_QOS_POLICY_FAILURE: Self = Self(11011);
        pub const WSA_QOS_BAD_STYLE: Self = Self(11012);
        pub const WSA_QOS_BAD_OBJECT: Self = Self(11013);
        pub const WSA_QOS_TRAFFIC_CTRL_ERROR: Self = Self(11014);
        pub const WSA_QOS_GENERIC_ERROR: Self = Self(11015);
        pub const WSA_QOS_ESERVICETYPE: Self = Self(11016);
        pub const WSA_QOS_EFLOWSPEC: Self = Self(11017);
        pub const WSA_QOS_EPROVSPECBUF: Self = Self(11018);
        pub const WSA_QOS_EFILTERSTYLE: Self = Self(11019);
        pub const WSA_QOS_EFILTERTYPE: Self = Self(11020);
        pub const WSA_QOS_EFILTERCOUNT: Self = Self(11021);
        pub const WSA_QOS_EOBJLENGTH: Self = Self(11022);
        pub const WSA_QOS_EFLOWCOUNT: Self = Self(11023);
        pub const WSA_QOS_EUNKOWNPSOBJ: Self = Self(11024);
        pub const WSA_QOS_EPOLICYOBJ: Self = Self(11025);
        pub const WSA_QOS_EFLOWDESC: Self = Self(11026);
        pub const WSA_QOS_EPSFLOWSPEC: Self = Self(11027);
        pub const WSA_QOS_EPSFILTERSPEC: Self = Self(11028);
        pub const WSA_QOS_ESDMODEOBJ: Self = Self(11029);
        pub const WSA_QOS_ESHAPERATEOBJ: Self = Self(11030);
        pub const WSA_QOS_RESERVED_PETYPE: Self = Self(11031);
    }

    /// `WSAPOLLFD` (`winsock2.h`). `fd` is a `SOCKET` (= `UINT_PTR`).
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct WSAPOLLFD {
        pub fd: usize,
        pub events: i16,
        pub revents: i16,
    }
    pub const SOCKET_ERROR: c_int = -1;
    /// `POLLWRNORM` (`winsock2.h`).
    pub const POLLWRNORM: i16 = 0x0010;

    // ── AFD socket-poll support: provider identification, peer-socket
    // creation, LSP base-handle unwrap, and the select() slow path
    // (consumed by `bun_iocp::afd`). ──────────────────────────────────────

    /// `SOCKET` (`winsock2.h`) — `UINT_PTR`.
    pub type SOCKET = usize;
    pub const INVALID_SOCKET: SOCKET = usize::MAX;

    /// `WSAPROTOCOLCHAIN` (`winsock2.h`); `MAX_PROTOCOL_CHAIN` = 7.
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct WSAPROTOCOLCHAIN {
        pub ChainLen: c_int,
        pub ChainEntries: [DWORD; 7],
    }

    /// `WSAPROTOCOL_INFOW` (`winsock2.h`) — a socket's winsock catalog entry;
    /// `ProviderId` names the base provider (the AFD fast-poll eligibility
    /// check) and the whole struct seeds `WSASocketW` to create a peer from
    /// the exact same catalog entry. // quirk: POLL-06, POLL-14
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct WSAPROTOCOL_INFOW {
        pub dwServiceFlags1: DWORD,
        pub dwServiceFlags2: DWORD,
        pub dwServiceFlags3: DWORD,
        pub dwServiceFlags4: DWORD,
        pub dwProviderFlags: DWORD,
        pub ProviderId: GUID,
        pub dwCatalogEntryId: DWORD,
        pub ProtocolChain: WSAPROTOCOLCHAIN,
        pub iVersion: c_int,
        pub iAddressFamily: c_int,
        pub iMaxSockAddr: c_int,
        pub iMinSockAddr: c_int,
        pub iSocketType: c_int,
        pub iProtocol: c_int,
        pub iProtocolMaxOffset: c_int,
        pub iNetworkByteOrder: c_int,
        pub iSecurityScheme: c_int,
        pub iMessageSize: c_int,
        pub iProviderReserved: c_int,
        pub szProtocol: [WCHAR; 256],
    }
    const _: () = assert!(core::mem::size_of::<WSAPROTOCOL_INFOW>() == 628);

    /// The four MSAFD base-provider GUIDs whose sockets are real AFD handles
    /// and accept `IOCTL_AFD_POLL`: MSAFD Tcpip IPv4, MSAFD Tcpip IPv6, MSAFD
    /// RfComm (Bluetooth), AF_UNIX (Win10+). Any other provider is not
    /// pollable via AFD. Values transcribed from libuv src/win/poll.c:31-40.
    /// // quirk: POLL-07
    pub const MSAFD_PROVIDER_IDS: [GUID; 4] = [
        GUID {
            Data1: 0xe70f1aa0,
            Data2: 0xab8b,
            Data3: 0x11cf,
            Data4: [0x8c, 0xa3, 0x00, 0x80, 0x5f, 0x48, 0xa1, 0x92],
        },
        GUID {
            Data1: 0xf9eab0c0,
            Data2: 0x26d4,
            Data3: 0x11d0,
            Data4: [0xbb, 0xbf, 0x00, 0xaa, 0x00, 0x6c, 0x34, 0xe4],
        },
        GUID {
            Data1: 0x9fc48064,
            Data2: 0x7298,
            Data3: 0x43e4,
            Data4: [0xb7, 0xbd, 0x18, 0x1f, 0x20, 0x89, 0x79, 0x2a],
        },
        GUID {
            Data1: 0xa00943d9,
            Data2: 0x9c2e,
            Data3: 0x4633,
            Data4: [0x9b, 0x59, 0x00, 0x57, 0xa3, 0x16, 0x09, 0x94],
        },
    ];

    /// `LINGER` (`winsock2.h`).
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct LINGER {
        pub l_onoff: u16,
        pub l_linger: u16,
    }

    /// `TIMEVAL` (`winsock2.h`).
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct TIMEVAL {
        pub tv_sec: i32,
        pub tv_usec: i32,
    }

    pub const SOL_SOCKET: c_int = 0xffff;
    /// `SO_PROTOCOL_INFOW` (`winsock2.h`).
    pub const SO_PROTOCOL_INFOW: c_int = 0x2005;
    pub const SO_LINGER: c_int = 0x0080;
    /// `FIONBIO` (`winsock2.h`): `_IOW('f', 126, u_long)` = 0x8004667E
    /// (negative in the `c_long` `ioctlsocket` takes).
    pub const FIONBIO: i32 = 0x8004_667Eu32 as i32;
    /// `SIO_BASE_HANDLE` (`mswsock.h`): `_WSAIOR(IOC_WS2, 34)`. Returns the
    /// bottom-of-LSP-chain socket. // quirk: POLL-11
    pub const SIO_BASE_HANDLE: DWORD = 0x4800_0022;
    /// `SIO_BSP_HANDLE_POLL` (`mswsock.h`): `_WSAIOR(IOC_WS2, 29)`. Returns
    /// the next-lower chain entry's socket; Komodia-family LSPs deliberately
    /// break `SIO_BASE_HANDLE` but not this. // quirk: POLL-12
    pub const SIO_BSP_HANDLE_POLL: DWORD = 0x4800_001D;
    pub const WSA_FLAG_OVERLAPPED: DWORD = 0x01;
    /// Atomic non-inheritability at creation time — never the two-step
    /// `SetHandleInformation` dance (race: a concurrent `CreateProcess`
    /// between the two calls leaks the handle). // quirk: POLL-10
    pub const WSA_FLAG_NO_HANDLE_INHERIT: DWORD = 0x80;

    // ── Lazy Winsock initialisation (quirk: HIST-06) ─────────────────────
    //
    // Every ws2_32 function below routes through `ensure_winsock()` so a
    // caller physically cannot reach Winsock before `WSAStartup` has run. The
    // gate is a single acquire load after first use. `WSAStartup` itself is
    // refcounted (MSDN: "An application can call WSAStartup more than once"),
    // so the rare cold-path race where two threads both miss the flag is
    // harmless — no spin or Once blocking is needed, which keeps this
    // `no_std` crate dependency-free.

    static WINSOCK_UP: AtomicBool = AtomicBool::new(false);

    #[inline]
    pub fn ensure_winsock() {
        if !WINSOCK_UP.load(Ordering::Acquire) {
            ensure_winsock_slow();
        }
    }

    #[cold]
    fn ensure_winsock_slow() {
        // Safe mode (SM_CLEANBOOT == 1) has no Winsock: skip like libuv does
        // and let socket calls fail with WSANOTINITIALISED instead of aborting.
        if user32::GetSystemMetrics(user32::SM_CLEANBOOT) != 1 {
            let mut wsa_data = core::mem::MaybeUninit::<WSADATA>::zeroed();
            // SAFETY: valid out-pointer; Winsock 2.2 is always present.
            let r = unsafe { raw::WSAStartup(0x0202, wsa_data.as_mut_ptr()) };
            assert!(r == 0, "WSAStartup failed: {r}");
        }
        WINSOCK_UP.store(true, Ordering::Release);
    }

    /// Raw ws2_32 externs. Unreachable outside this module; every public
    /// `ws2_32::fn` routes through `ensure_winsock()` first.
    mod raw {
        use super::*;
        #[link(name = "ws2_32")]
        unsafe extern "system" {
            pub(super) fn getaddrinfo(
                node: *const c_char,
                service: *const c_char,
                hints: *const addrinfo,
                res: *mut *mut addrinfo,
            ) -> c_int;
            pub(super) fn freeaddrinfo(ai: *mut addrinfo);
            /// `WSAStartup` (`winsock2.h`). 0 on success; non-zero is a `WSAE*`.
            pub(super) fn WSAStartup(wVersionRequested: u16, lpWSAData: *mut WSADATA) -> c_int;
            /// Raw `WSAGetLastError`. The `Option<SystemErrno>` wrapper lives in `errno`
            /// because `SystemErrno` is a higher-tier type. No preconditions; reads
            /// thread-local Winsock error slot.
            pub(super) safe fn WSAGetLastError() -> c_int;
            /// No preconditions; writes the thread-local Winsock error slot.
            pub(super) safe fn WSASetLastError(err: c_int);
            pub(super) fn closesocket(s: usize) -> c_int;
            pub(super) fn recv(s: usize, buf: *mut c_void, len: c_int, flags: c_int) -> c_int;
            pub(super) fn send(s: usize, buf: *const c_void, len: c_int, flags: c_int) -> c_int;
            /// `WSAPoll` (`winsock2.h`). Returns count of ready fds, 0 on timeout,
            /// or `SOCKET_ERROR` (-1) on failure (`WSAGetLastError` for the code).
            pub(super) fn WSAPoll(fdArray: *mut WSAPOLLFD, fds: u32, timeout: c_int) -> c_int;
            pub(super) fn WSASocketW(
                af: c_int,
                ty: c_int,
                protocol: c_int,
                lpProtocolInfo: *mut WSAPROTOCOL_INFOW,
                g: c_uint,
                dwFlags: DWORD,
            ) -> SOCKET;
            pub(super) fn WSAIoctl(
                s: SOCKET,
                dwIoControlCode: DWORD,
                lpvInBuffer: *mut c_void,
                cbInBuffer: DWORD,
                lpvOutBuffer: *mut c_void,
                cbOutBuffer: DWORD,
                lpcbBytesReturned: *mut DWORD,
                lpOverlapped: *mut OVERLAPPED,
                lpCompletionRoutine: *mut c_void,
            ) -> c_int;
            pub(super) fn ioctlsocket(s: SOCKET, cmd: c_long, argp: *mut c_ulong) -> c_int;
            pub(super) fn getsockopt(
                s: SOCKET,
                level: c_int,
                optname: c_int,
                optval: *mut u8,
                optlen: *mut c_int,
            ) -> c_int;
            pub(super) fn setsockopt(
                s: SOCKET,
                level: c_int,
                optname: c_int,
                optval: *const u8,
                optlen: c_int,
            ) -> c_int;
            /// `select` (`winsock2.h`). `nfds` is ignored on Windows. The set
            /// pointers use the `{u_int fd_count; SOCKET fd_array[]}` ABI prefix,
            /// so callers may pass shorter-than-`fd_set` single-slot sets.
            /// // quirk: POLL-40
            pub(super) fn select(
                nfds: c_int,
                readfds: *mut c_void,
                writefds: *mut c_void,
                exceptfds: *mut c_void,
                timeout: *const TIMEVAL,
            ) -> c_int;
            pub(super) fn bind(s: SOCKET, name: *const sockaddr, namelen: c_int) -> c_int;
            pub(super) fn listen(s: SOCKET, backlog: c_int) -> c_int;
            pub(super) fn connect(s: SOCKET, name: *const sockaddr, namelen: c_int) -> c_int;
            pub(super) fn accept(s: SOCKET, addr: *mut sockaddr, addrlen: *mut c_int) -> SOCKET;
            pub(super) fn getsockname(s: SOCKET, name: *mut sockaddr, namelen: *mut c_int) -> c_int;
        }
    }

    // `WSAStartup` is the init itself; the error accessors are thread-local
    // slot reads/writes with no init requirement. Ungated forwarders.
    #[inline]
    pub unsafe fn WSAStartup(wVersionRequested: u16, lpWSAData: *mut WSADATA) -> c_int {
        unsafe { raw::WSAStartup(wVersionRequested, lpWSAData) }
    }
    #[inline]
    pub fn WSAGetLastError() -> c_int {
        raw::WSAGetLastError()
    }
    #[inline]
    pub fn WSASetLastError(err: c_int) {
        raw::WSASetLastError(err)
    }

    // ── Gated wrappers: every call routes through `ensure_winsock()`. ─────
    // SAFETY contracts for each are unchanged from the raw externs.

    #[inline]
    pub unsafe fn getaddrinfo(
        node: *const c_char,
        service: *const c_char,
        hints: *const addrinfo,
        res: *mut *mut addrinfo,
    ) -> c_int {
        ensure_winsock();
        unsafe { raw::getaddrinfo(node, service, hints, res) }
    }
    #[inline]
    pub unsafe fn freeaddrinfo(ai: *mut addrinfo) {
        ensure_winsock();
        unsafe { raw::freeaddrinfo(ai) }
    }
    #[inline]
    pub unsafe fn closesocket(s: usize) -> c_int {
        ensure_winsock();
        unsafe { raw::closesocket(s) }
    }
    #[inline]
    pub unsafe fn recv(s: usize, buf: *mut c_void, len: c_int, flags: c_int) -> c_int {
        ensure_winsock();
        unsafe { raw::recv(s, buf, len, flags) }
    }
    #[inline]
    pub unsafe fn send(s: usize, buf: *const c_void, len: c_int, flags: c_int) -> c_int {
        ensure_winsock();
        unsafe { raw::send(s, buf, len, flags) }
    }
    #[inline]
    pub unsafe fn WSAPoll(fdArray: *mut WSAPOLLFD, fds: u32, timeout: c_int) -> c_int {
        ensure_winsock();
        unsafe { raw::WSAPoll(fdArray, fds, timeout) }
    }
    #[inline]
    pub unsafe fn WSASocketW(
        af: c_int,
        ty: c_int,
        protocol: c_int,
        lpProtocolInfo: *mut WSAPROTOCOL_INFOW,
        g: c_uint,
        dwFlags: DWORD,
    ) -> SOCKET {
        ensure_winsock();
        unsafe { raw::WSASocketW(af, ty, protocol, lpProtocolInfo, g, dwFlags) }
    }
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn WSAIoctl(
        s: SOCKET,
        dwIoControlCode: DWORD,
        lpvInBuffer: *mut c_void,
        cbInBuffer: DWORD,
        lpvOutBuffer: *mut c_void,
        cbOutBuffer: DWORD,
        lpcbBytesReturned: *mut DWORD,
        lpOverlapped: *mut OVERLAPPED,
        lpCompletionRoutine: *mut c_void,
    ) -> c_int {
        ensure_winsock();
        unsafe {
            raw::WSAIoctl(
                s,
                dwIoControlCode,
                lpvInBuffer,
                cbInBuffer,
                lpvOutBuffer,
                cbOutBuffer,
                lpcbBytesReturned,
                lpOverlapped,
                lpCompletionRoutine,
            )
        }
    }
    #[inline]
    pub unsafe fn ioctlsocket(s: SOCKET, cmd: c_long, argp: *mut c_ulong) -> c_int {
        ensure_winsock();
        unsafe { raw::ioctlsocket(s, cmd, argp) }
    }
    #[inline]
    pub unsafe fn getsockopt(
        s: SOCKET,
        level: c_int,
        optname: c_int,
        optval: *mut u8,
        optlen: *mut c_int,
    ) -> c_int {
        ensure_winsock();
        unsafe { raw::getsockopt(s, level, optname, optval, optlen) }
    }
    #[inline]
    pub unsafe fn setsockopt(
        s: SOCKET,
        level: c_int,
        optname: c_int,
        optval: *const u8,
        optlen: c_int,
    ) -> c_int {
        ensure_winsock();
        unsafe { raw::setsockopt(s, level, optname, optval, optlen) }
    }
    #[inline]
    pub unsafe fn select(
        nfds: c_int,
        readfds: *mut c_void,
        writefds: *mut c_void,
        exceptfds: *mut c_void,
        timeout: *const TIMEVAL,
    ) -> c_int {
        ensure_winsock();
        unsafe { raw::select(nfds, readfds, writefds, exceptfds, timeout) }
    }
    #[inline]
    pub unsafe fn bind(s: SOCKET, name: *const sockaddr, namelen: c_int) -> c_int {
        ensure_winsock();
        unsafe { raw::bind(s, name, namelen) }
    }
    #[inline]
    pub unsafe fn listen(s: SOCKET, backlog: c_int) -> c_int {
        ensure_winsock();
        unsafe { raw::listen(s, backlog) }
    }
    #[inline]
    pub unsafe fn connect(s: SOCKET, name: *const sockaddr, namelen: c_int) -> c_int {
        ensure_winsock();
        unsafe { raw::connect(s, name, namelen) }
    }
    #[inline]
    pub unsafe fn accept(s: SOCKET, addr: *mut sockaddr, addrlen: *mut c_int) -> SOCKET {
        ensure_winsock();
        unsafe { raw::accept(s, addr, addrlen) }
    }
    #[inline]
    pub unsafe fn getsockname(s: SOCKET, name: *mut sockaddr, namelen: *mut c_int) -> c_int {
        ensure_winsock();
        unsafe { raw::getsockname(s, name, namelen) }
    }
}
pub use ws2_32::WSAGetLastError;

// ──────────────────────────────────────────────────────────────────────────
// AFD (`\Device\Afd`) poll surface — the kernel driver winsock dispatches
// to; the only IOCP-compatible socket-readiness primitive Windows has.
// Undocumented ABI: values/layouts transcribed from libuv
// src/win/winsock.h:116-178 + include/uv/win.h:206-217 and match
// wepoll/ReactOS bit-exactly. // quirk: POLL-01
// ──────────────────────────────────────────────────────────────────────────

/// `GUID` (`guiddef.h`).
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct GUID {
    pub Data1: u32,
    pub Data2: u16,
    pub Data3: u16,
    pub Data4: [u8; 8],
}

// AFD poll event bits (DDK-only, absent from user-mode SDK headers; libuv
// src/win/winsock.h:116-140). Eleven exist; the poll machinery requests and
// consumes seven (RECEIVE, SEND, DISCONNECT, ABORT, LOCAL_CLOSE, ACCEPT,
// CONNECT_FAIL) — the rest are defined for documentation and the ALL mask.
// // quirk: POLL-48
pub const AFD_POLL_RECEIVE: ULONG = 1 << 0;
pub const AFD_POLL_RECEIVE_EXPEDITED: ULONG = 1 << 1;
pub const AFD_POLL_SEND: ULONG = 1 << 2;
pub const AFD_POLL_DISCONNECT: ULONG = 1 << 3;
pub const AFD_POLL_ABORT: ULONG = 1 << 4;
pub const AFD_POLL_LOCAL_CLOSE: ULONG = 1 << 5;
pub const AFD_POLL_CONNECT: ULONG = 1 << 6;
pub const AFD_POLL_ACCEPT: ULONG = 1 << 7;
pub const AFD_POLL_CONNECT_FAIL: ULONG = 1 << 8;
pub const AFD_POLL_QOS: ULONG = 1 << 9;
pub const AFD_POLL_GROUP_QOS: ULONG = 1 << 10;
pub const AFD_NUM_POLL_EVENTS: u32 = 11;
pub const AFD_POLL_ALL: ULONG = (1 << AFD_NUM_POLL_EVENTS) - 1;

/// `IOCTL_AFD_POLL` = `(FSCTL_AFD_BASE << 12) | (AFD_POLL << 2) | METHOD_BUFFERED`
/// = `(0x12 << 12) | (9 << 2) | 0` = 0x00012024 — AFD packs its control codes
/// nonstandardly; the SDK `CTL_CODE` macro yields 0x120024, which the driver
/// rejects. (libuv src/win/winsock.h:159-178.) // quirk: POLL-02
pub const IOCTL_AFD_POLL: ULONG = 0x0001_2024;

/// `AFD_POLL_HANDLE_INFO` (libuv include/uv/win.h:206-210). On input,
/// `Handle` is the TARGET socket (which need not be the socket the ioctl is
/// issued through) and `Events` the requested mask; on output `Events` holds
/// the triggered bits and `Status` a per-handle NTSTATUS.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct AFD_POLL_HANDLE_INFO {
    pub Handle: HANDLE,
    pub Events: ULONG,
    pub Status: NTSTATUS,
}

/// `AFD_POLL_INFO` (libuv include/uv/win.h:212-217) — the `IOCTL_AFD_POLL`
/// input AND output payload (METHOD_BUFFERED). Undocumented kernel ABI that
/// must be replicated bit-exactly: a wrong layout is
/// `STATUS_INVALID_PARAMETER` or garbage polls. // quirk: POLL-03
#[repr(C)]
#[derive(Copy, Clone)]
pub struct AFD_POLL_INFO {
    pub Timeout: LARGE_INTEGER,
    pub NumberOfHandles: ULONG,
    pub Exclusive: ULONG,
    pub Handles: [AFD_POLL_HANDLE_INFO; 1],
}

// Layout pins (authoritative x64 values, identical to wepoll's afd.h):
// Timeout [0,8), NumberOfHandles [8,12), Exclusive [12,16), Handles [16,32)
// — zero padding; size 32. // quirk: POLL-03
#[cfg(all(windows, target_pointer_width = "64"))]
const _: () = {
    assert!(core::mem::size_of::<GUID>() == 16);
    assert!(core::mem::size_of::<AFD_POLL_HANDLE_INFO>() == 16);
    assert!(core::mem::size_of::<AFD_POLL_INFO>() == 32);
    assert!(core::mem::offset_of!(AFD_POLL_INFO, NumberOfHandles) == 8);
    assert!(core::mem::offset_of!(AFD_POLL_INFO, Exclusive) == 12);
    assert!(core::mem::offset_of!(AFD_POLL_INFO, Handles) == 16);
};

// ──────────────────────────────────────────────────────────────────────────
// Win32Error — a transparent newtype with associated consts so unmapped
// codes round-trip and `match` on consts works (structural equality). Only the subset referenced by lower-tier
// crates (errno) is named here; the full 1188-variant table can be extended
// without ABI change.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Win32Error(pub u16);

impl Win32Error {
    // — core enum variants (values from MS-ERREF) —
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
    /// Drive exists but has no media (e.g. empty CD/card reader).
    pub const NOT_READY: Win32Error = Win32Error(21);
    pub const CRC: Win32Error = Win32Error(23);
    pub const GEN_FAILURE: Win32Error = Win32Error(31);
    pub const SHARING_VIOLATION: Win32Error = Win32Error(32);
    pub const LOCK_VIOLATION: Win32Error = Win32Error(33);
    pub const HANDLE_EOF: Win32Error = Win32Error(38);
    pub const HANDLE_DISK_FULL: Win32Error = Win32Error(39);
    pub const NOT_SUPPORTED: Win32Error = Win32Error(50);
    pub const NETNAME_DELETED: Win32Error = Win32Error(64);
    /// `ERROR_BAD_NET_NAME` — the UNC share name cannot be found.
    pub const BAD_NET_NAME: Win32Error = Win32Error(67);
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
    /// CreateProcessW/LoadLibrary on a non-PE or wrong-architecture file.
    pub const BAD_EXE_FORMAT: Win32Error = Win32Error(193);
    /// What current Win11 (probed: 26200) actually returns for non-PE spawns
    /// where older kernels returned BAD_EXE_FORMAT. // quirk: PROC-58
    pub const EXE_MACHINE_TYPE_MISMATCH: Win32Error = Win32Error(216);
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
    /// `ERROR_ADDRESS_NOT_ASSOCIATED` — `GetAdaptersAddresses` before any
    /// address has been associated (transient; uv maps it to EAGAIN).
    pub const ADDRESS_NOT_ASSOCIATED: Win32Error = Win32Error(1228);
    pub const NETWORK_UNREACHABLE: Win32Error = Win32Error(1231);
    pub const HOST_UNREACHABLE: Win32Error = Win32Error(1232);
    pub const CONNECTION_ABORTED: Win32Error = Win32Error(1236);
    pub const PRIVILEGE_NOT_HELD: Win32Error = Win32Error(1314);
    pub const DISK_CORRUPT: Win32Error = Win32Error(1393);
    /// `WAIT_TIMEOUT` / `ERROR_TIMEOUT` (1460) — `SleepConditionVariableSRW`,
    /// `GetQueuedCompletionStatus`, etc.
    pub const TIMEOUT: Win32Error = Win32Error(1460);
    pub const SYMLINK_NOT_SUPPORTED: Win32Error = Win32Error(1464);
    pub const CANT_ACCESS_FILE: Win32Error = Win32Error(1920);
    pub const CANT_RESOLVE_FILENAME: Win32Error = Win32Error(1921);
    pub const NOT_CONNECTED: Win32Error = Win32Error(2250);
    pub const IO_REISSUE_AS_CACHED: Win32Error = Win32Error(3950);
    /// `ERROR_NOT_A_REPARSE_POINT` — `FSCTL_GET_REPARSE_POINT` on a file whose
    /// reparse attribute is set but carries no reparse data.
    pub const NOT_A_REPARSE_POINT: Win32Error = Win32Error(4390);
    pub const INVALID_REPARSE_DATA: Win32Error = Win32Error(4392);

    // — WSA pseudo-variants —
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

    #[inline]
    pub fn get() -> Win32Error {
        Win32Error(kernel32::GetLastError() as u16)
    }

    #[inline]
    pub const fn from_raw(raw: u16) -> Win32Error {
        Win32Error(raw)
    }

    #[inline]
    pub const fn int(self) -> u16 {
        self.0
    }

    #[inline]
    pub fn from_ntstatus(status: NTSTATUS) -> Win32Error {
        Win32Error(RtlNtStatusToDosError(status) as u16)
    }
    /// Snake-cased alias for [`from_ntstatus`] (matches `bun_sys::windows`
    /// callers — `from_nt_status`).
    #[inline]
    pub fn from_nt_status(status: NTSTATUS) -> Win32Error {
        Self::from_ntstatus(status)
    }

    // NOTE: `toSystemErrno()` is intentionally NOT defined here — it returns
    // `errno::SystemErrno`, a higher-tier type. The mapping lives in
    // `errno::SystemErrno::init_win32_error`; callers in `errno` should invoke
    // that directly (T0 must not depend on T1).
}

pub type LPDWORD = *mut DWORD;
pub type HPCON = *mut c_void;

#[link(name = "shell32")]
unsafe extern "system" {
    pub fn CommandLineToArgvW(lpCmdLine: LPCWSTR, pNumArgs: *mut c_int) -> *mut LPWSTR;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    pub fn GetFileInformationByHandle(
        hFile: HANDLE,
        lpFileInformation: *mut BY_HANDLE_FILE_INFORMATION,
    ) -> BOOL;

    pub fn GetBinaryTypeW(lpApplicationName: LPCWSTR, lpBinaryType: LPDWORD) -> BOOL;

    pub fn SetCurrentDirectoryW(lpPathName: LPCWSTR) -> BOOL;

    pub fn GetCurrentDirectoryW(nBufferLength: DWORD, lpBuffer: LPWSTR) -> DWORD;

    pub fn GetFileAttributesW(lpFileName: LPCWSTR) -> DWORD;

    /// `SetFileAttributesW` (`fileapi.h`). Acts on the named file itself —
    /// does NOT follow symlinks.
    pub fn SetFileAttributesW(lpFileName: LPCWSTR, dwFileAttributes: DWORD) -> BOOL;

    pub fn CreateFileW(
        lpFileName: LPCWSTR,
        dwDesiredAccess: DWORD,
        dwShareMode: DWORD,
        lpSecurityAttributes: *mut SECURITY_ATTRIBUTES,
        dwCreationDisposition: DWORD,
        dwFlagsAndAttributes: DWORD,
        hTemplateFile: HANDLE,
    ) -> HANDLE;

    pub fn SetFilePointerEx(
        hFile: HANDLE,
        liDistanceToMove: LARGE_INTEGER,
        lpNewFilePointer: *mut LARGE_INTEGER,
        dwMoveMethod: DWORD,
    ) -> BOOL;
}

/// `SYSTEM_INFO` (`sysinfoapi.h`).
#[repr(C)]
pub struct SYSTEM_INFO {
    pub wProcessorArchitecture: WORD,
    pub wReserved: WORD,
    pub dwPageSize: DWORD,
    pub lpMinimumApplicationAddress: *mut c_void,
    pub lpMaximumApplicationAddress: *mut c_void,
    pub dwActiveProcessorMask: usize,
    pub dwNumberOfProcessors: DWORD,
    pub dwProcessorType: DWORD,
    pub dwAllocationGranularity: DWORD,
    pub wProcessorLevel: WORD,
    pub wProcessorRevision: WORD,
}
#[link(name = "kernel32")]
unsafe extern "system" {
    pub fn GetSystemInfo(lpSystemInfo: *mut SYSTEM_INFO);
}

#[link(name = "advapi32")]
unsafe extern "system" {
    pub fn SaferiIsExecutableFileType(szFullPathname: LPCWSTR, bFromShellExecute: BOOLEAN) -> BOOL;
}

// `GetProcAddress`/`LoadLibraryA` are kernel32 stdcall — use `extern "system"` so the
// callconv is correct on all targets (winapi == C only on x64). `GetProcAddress`
// takes `LPCSTR` (narrow), not wide.
#[link(name = "kernel32")]
unsafe extern "system" {
    pub fn GetProcAddress(ptr: *mut c_void, name: *const c_char) -> *mut c_void;

    pub fn LoadLibraryA(name: *const c_char) -> *mut c_void;
}

// Declared as `extern "system"` so the callconv is correct on all targets
// (winapi == C only on x64).
#[link(name = "kernel32")]
unsafe extern "system" {
    pub fn CopyFileW(source: LPCWSTR, dest: LPCWSTR, bFailIfExists: BOOL) -> BOOL;

    pub fn SetFileInformationByHandle(
        file: HANDLE,
        fileInformationClass: FILE_INFO_BY_HANDLE_CLASS,
        fileInformation: LPVOID,
        bufferSize: DWORD,
    ) -> BOOL;

    pub fn GetHostNameW(lpBuffer: PWSTR, nSize: c_int) -> BOOL;

    pub fn GetTempPathW(
        nBufferLength: DWORD, // [in]
        lpBuffer: LPCWSTR,    // [out]
    ) -> DWORD;

    pub fn CreateJobObjectA(
        lpJobAttributes: *mut c_void, // [in, optional]
        lpName: LPCSTR,               // [in, optional]
    ) -> HANDLE;

    pub fn AssignProcessToJobObject(
        hJob: HANDLE,     // [in]
        hProcess: HANDLE, // [in]
    ) -> BOOL;

    pub fn ResumeThread(hJob: HANDLE, // [in]
    ) -> DWORD;

    pub fn SetInformationJobObject(
        hJob: HANDLE,
        JobObjectInformationClass: DWORD,
        lpJobObjectInformation: LPVOID,
        cbJobObjectInformationLength: DWORD,
    ) -> BOOL;

    pub fn CreateJobObjectW(
        lpJobAttributes: *mut c_void, // *mut SECURITY_ATTRIBUTES
        lpName: LPCWSTR,
    ) -> HANDLE;

    pub fn OpenProcess(dwDesiredAccess: DWORD, bInheritHandle: BOOL, dwProcessId: DWORD) -> HANDLE;
}

unsafe extern "C" {
    pub fn GetUserNameW(lpBuffer: LPWSTR, pcbBuffer: LPDWORD) -> BOOL;
}

// ── Job Object structures (`winnt.h`) ─────────────────────────────────────
// NOTE: These are the SINGLE canonical definitions. bun_sys::windows and
// bun_core re-export / impl-Zeroable against these types directly; do NOT
// re-declare them downstream.

/// `JOBOBJECTINFOCLASS::JobObjectAssociateCompletionPortInformation` (`winnt.h`).
pub const JobObjectAssociateCompletionPortInformation: DWORD = 7;
/// `JOBOBJECTINFOCLASS::JobObjectExtendedLimitInformation` (`winnt.h`).
pub const JobObjectExtendedLimitInformation: DWORD = 9;
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — kill all job processes when the
/// last job handle closes.
pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x0000_2000;

/// `JOBOBJECT_ASSOCIATE_COMPLETION_PORT` (`winnt.h`).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
    pub CompletionKey: LPVOID, // PVOID
    pub CompletionPort: HANDLE,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    pub PerProcessUserTimeLimit: LARGE_INTEGER,
    pub PerJobUserTimeLimit: LARGE_INTEGER,
    pub LimitFlags: DWORD,
    pub MinimumWorkingSetSize: usize,
    pub MaximumWorkingSetSize: usize,
    pub ActiveProcessLimit: DWORD,
    /// `ULONG_PTR` in `winnt.h` — pointer-width integer, NOT a `*mut ULONG`.
    pub Affinity: usize,
    pub PriorityClass: DWORD,
    pub SchedulingClass: DWORD,
}

// winnt.h _IO_COUNTERS — out-param of GetProcessIoCounters / embedded in
// JOBOBJECT_EXTENDED_LIMIT_INFORMATION. All-zero is the valid initial state
// (Win32 zero-inits before fill), so `Default` is sound and lets callers write
// `IO_COUNTERS::default()` instead of `unsafe { zeroed_unchecked() }`.
// Zeroable impl lives in bun_core/lib.rs (orphan-rule home).
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct IO_COUNTERS {
    pub ReadOperationCount: u64,
    pub WriteOperationCount: u64,
    pub OtherOperationCount: u64,
    pub ReadTransferCount: u64,
    pub WriteTransferCount: u64,
    pub OtherTransferCount: u64,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    pub BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
    pub IoInfo: IO_COUNTERS,
    pub ProcessMemoryLimit: usize,
    pub JobMemoryLimit: usize,
    pub PeakProcessMemoryUsed: usize,
    pub PeakJobMemoryUsed: usize,
}

// ──────────────────────────────────────────────────────────────────────────
// Process creation POD (`processthreadsapi.h`).
// ──────────────────────────────────────────────────────────────────────────

/// `STARTUPINFOW` (`processthreadsapi.h`).
#[repr(C)]
pub struct STARTUPINFOW {
    pub cb: DWORD,
    pub lpReserved: PWSTR,
    pub lpDesktop: PWSTR,
    pub lpTitle: PWSTR,
    pub dwX: DWORD,
    pub dwY: DWORD,
    pub dwXSize: DWORD,
    pub dwYSize: DWORD,
    pub dwXCountChars: DWORD,
    pub dwYCountChars: DWORD,
    pub dwFillAttribute: DWORD,
    pub dwFlags: DWORD,
    pub wShowWindow: WORD,
    pub cbReserved2: WORD,
    pub lpReserved2: *mut u8,
    pub hStdInput: HANDLE,
    pub hStdOutput: HANDLE,
    pub hStdError: HANDLE,
}

/// `STARTUPINFOEXW` (`winbase.h`) — `STARTUPINFOW` + proc-thread attribute list.
#[repr(C)]
pub struct STARTUPINFOEXW {
    pub StartupInfo: STARTUPINFOW,
    pub lpAttributeList: *mut u8,
}

/// `PROCESS_INFORMATION` (`processthreadsapi.h`).
#[repr(C)]
pub struct PROCESS_INFORMATION {
    pub hProcess: HANDLE,
    pub hThread: HANDLE,
    pub dwProcessId: DWORD,
    pub dwThreadId: DWORD,
}

// ──────────────────────────────────────────────────────────────────────────
// TEB → PEB → RTL_USER_PROCESS_PARAMETERS chain (`winternl.h` / phnt).
// `teb`/`peb` accessors plus the `TEB`, `PEB`, `RTL_USER_PROCESS_PARAMETERS`,
// and `CURDIR` structs live here so the three former duplicators (`bun_core::windows_sys`,
// `bun_sys::windows`, the freestanding `bun_shim_impl` shim) all re-export
// from this tier-0 leaf. Only fields actually dereferenced by Bun are
// modelled; `offset_of!` asserts pin them to the documented x64 offsets so a
// typo in a padding array fails at compile time, not at runtime.
// ──────────────────────────────────────────────────────────────────────────

/// `CURDIR` (`winternl.h` / phnt) — `RTL_USER_PROCESS_PARAMETERS.CurrentDirectory`.
#[repr(C)]
pub struct CURDIR {
    pub DosPath: UNICODE_STRING,
    pub Handle: HANDLE,
}
/// CamelCase alias (`bun_core` callers).
pub type Curdir = CURDIR;

/// `RTL_USER_PROCESS_PARAMETERS` (`winternl.h`) — minimal view.
#[repr(C)]
pub struct RTL_USER_PROCESS_PARAMETERS {
    // {MaximumLength, Length, Flags, DebugFlags} — 4 × ULONG.
    _reserved1: [u8; 16],
    // {ConsoleHandle, ConsoleFlags+pad} — 2 × pointer-size.
    _reserved2: [*mut c_void; 2],
    pub hStdInput: HANDLE,
    pub hStdOutput: HANDLE,
    pub hStdError: HANDLE,
    /// `CURDIR` — `{ UNICODE_STRING DosPath; HANDLE Handle; }`. `Fd::cwd()`
    /// reads the handle so `openat(Fd::cwd(), …)` resolves relative paths
    /// against the live process cwd via `NtCreateFile`'s `RootDirectory`.
    pub CurrentDirectory: CURDIR,
    pub DllPath: UNICODE_STRING,
    pub ImagePathName: UNICODE_STRING,
    pub CommandLine: UNICODE_STRING,
    // (fields beyond CommandLine are not read by Bun)
}
/// CamelCase alias (`bun_core` callers).
pub type ProcessParameters = RTL_USER_PROCESS_PARAMETERS;
// `RTL_USER_PROCESS_PARAMETERS` places `StandardInput` at 0x20,
// `CurrentDirectory.Handle` at 0x48, and `ImagePathName` at 0x60 on x64.
#[cfg(target_pointer_width = "64")]
const _: () = {
    assert!(core::mem::offset_of!(RTL_USER_PROCESS_PARAMETERS, hStdInput) == 0x20);
    assert!(
        core::mem::offset_of!(RTL_USER_PROCESS_PARAMETERS, CurrentDirectory)
            + core::mem::offset_of!(CURDIR, Handle)
            == 0x48
    );
    assert!(core::mem::offset_of!(RTL_USER_PROCESS_PARAMETERS, ImagePathName) == 0x60);
};

/// `PEB` (`winternl.h`) — minimal view.
#[repr(C)]
pub struct PEB {
    _reserved1: [u8; 2],
    pub BeingDebugged: u8,
    _reserved2: [u8; 1],
    _reserved3: [*mut c_void; 2],
    pub Ldr: *mut c_void,
    // Raw pointer, NOT `&'static`: the OS/CRT mutate `RTL_USER_PROCESS_PARAMETERS`
    // out-of-band (e.g. `SetStdHandle()` writes `hStd*`), so a Rust shared
    // reference would assert false immutability to the optimizer (UB).
    pub ProcessParameters: *const RTL_USER_PROCESS_PARAMETERS,
}
/// Legacy alias (former `bun_core::windows_sys` name).
pub type PebView = PEB;

/// `TEB` (`winternl.h`) — minimal view; only `ProcessEnvironmentBlock` is read.
#[repr(C)]
pub struct TEB {
    /// `NT_TIB` is 7 pointers on x64 (`ExceptionList`, `StackBase`,
    /// `StackLimit`, `SubSystemTib`, `FiberData`/`Version`,
    /// `ArbitraryUserPointer`, `Self`).
    _nt_tib: [*mut c_void; 7],
    pub EnvironmentPointer: *mut c_void,
    /// `CLIENT_ID` — `{UniqueProcess, UniqueThread}`.
    _client_id: [*mut c_void; 2],
    pub ActiveRpcHandle: *mut c_void,
    pub ThreadLocalStoragePointer: *mut c_void,
    pub ProcessEnvironmentBlock: *mut PEB,
    // (fields beyond ProcessEnvironmentBlock are not read by Bun)
}
#[cfg(target_pointer_width = "64")]
const _: () = assert!(core::mem::offset_of!(TEB, ProcessEnvironmentBlock) == 0x60);

/// Reads the TEB pointer — `gs:[0x30]` (x64) / `x18` (ARM64).
///
/// Safe fn: the only precondition — that the segment register / `x18`
/// reservation is the OS thread-block pointer — is guaranteed by the Windows
/// ABI for every thread, so there is no caller-side obligation. The deref
/// obligation lives with the caller of the returned `*mut TEB`.
#[inline(always)]
pub fn teb() -> *mut TEB {
    #[cfg(target_arch = "x86_64")]
    // SAFETY: on Windows x64 `gs:[0x30]` is the OS-maintained TEB self-
    // pointer; reading it has no side effects and is always valid.
    unsafe {
        let p: *mut TEB;
        core::arch::asm!("mov {}, gs:[0x30]", out(reg) p, options(nostack, pure, readonly));
        p
    }
    #[cfg(target_arch = "aarch64")]
    // SAFETY: on Windows ARM64 `x18` is the reserved OS thread-block
    // pointer; reading it has no side effects and is always valid.
    unsafe {
        let p: *mut TEB;
        core::arch::asm!("mov {}, x18", out(reg) p, options(nostack, pure, readonly));
        p
    }
}

/// Reads the PEB pointer — `gs:[0x60]` (x64) / `TEB+0x60` (ARM64).
///
/// Returns a raw pointer (NOT `&'static PEB`): the PEB is owned and mutated
/// by the OS/CRT behind Rust's back (`SetStdHandle`, debugger toggling
/// `BeingDebugged`, …). Materializing a `&'static` to it would be UB under
/// Rust's aliasing rules. Callers must read fields through raw-pointer deref.
#[inline(always)]
pub fn peb() -> *const PEB {
    #[cfg(target_arch = "x86_64")]
    // SAFETY: reading `gs:[0x60]` is the documented Windows-x64 ABI for the
    // current thread's PEB pointer; no caller precondition.
    unsafe {
        let p: *const PEB;
        core::arch::asm!("mov {}, gs:[0x60]", out(reg) p, options(nostack, pure, readonly));
        p
    }
    #[cfg(target_arch = "aarch64")]
    // SAFETY: `x18` holds the TEB on Windows-arm64 by ABI; TEB+0x60 is the PEB
    // pointer field. Both are valid for the calling thread's lifetime.
    unsafe {
        *teb()
            .cast::<u8>()
            .add(0x60)
            .cast::<core::ffi::c_void>()
            .cast::<*const PEB>()
    }
}

// ── Console ctrl-handler dwCtrlType values (`wincon.h`) ───────────────────
pub const CTRL_C_EVENT: DWORD = 0;
pub const CTRL_BREAK_EVENT: DWORD = 1;
pub const CTRL_CLOSE_EVENT: DWORD = 2;
pub const CTRL_LOGOFF_EVENT: DWORD = 5;
pub const CTRL_SHUTDOWN_EVENT: DWORD = 6;

// `SetErrorMode` flags (`errhandlingapi.h`).
pub const SEM_FAILCRITICALERRORS: DWORD = 0x0001;
pub const SEM_NOGPFAULTERRORBOX: DWORD = 0x0002;
pub const SEM_NOOPENFILEERRORBOX: DWORD = 0x8000;

// Power broadcast events (`winuser.h`) delivered to suspend/resume callbacks.
/// Resume triggered by user input; only follows RESUMEAUTOMATIC.
pub const PBT_APMRESUMESUSPEND: ULONG = 7;
/// Any resume from suspend — the reliable one to act on.
pub const PBT_APMRESUMEAUTOMATIC: ULONG = 18;

/// `DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS.Callback` (`powrprof.h`).
pub type DeviceNotifyCallbackRoutine =
    unsafe extern "system" fn(context: *mut c_void, ty: ULONG, setting: *mut c_void) -> ULONG;

/// `_DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS` (`powrprof.h`).
#[repr(C)]
pub struct DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
    pub Callback: DeviceNotifyCallbackRoutine,
    pub Context: *mut c_void,
}

/// `Recipient` is `DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS*` when `Flags` is
/// `DEVICE_NOTIFY_CALLBACK` (2). Win8+; always present on Bun's baseline.
pub const DEVICE_NOTIFY_CALLBACK: DWORD = 2;

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
        hModule: HMODULE,   // [in]
        lpFilename: LPWSTR, // [out]
        nSize: DWORD,       // [in]
    ) -> BOOL;

    pub fn GetThreadDescription(
        thread: *mut c_void,               // [in]
        ppszThreadDescription: *mut PWSTR, // [out]
    ) -> HRESULT;
}

unsafe extern "C" {
    pub fn SetStdHandle(nStdHandle: u32, hHandle: *mut c_void) -> u32;

    /// No preconditions.
    pub safe fn GetConsoleOutputCP() -> u32;

    /// No preconditions.
    pub safe fn GetConsoleCP() -> u32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    /// No preconditions; returns 0 on failure.
    pub safe fn SetConsoleCP(wCodePageID: UINT) -> BOOL;

    /// No preconditions; returns 0 on failure.
    pub safe fn SetConsoleOutputCP(wCodePageID: UINT) -> BOOL;

    pub fn GetConsoleMode(hConsoleHandle: HANDLE, lpMode: *mut DWORD) -> BOOL;

    pub fn SetConsoleMode(hConsoleHandle: HANDLE, dwMode: DWORD) -> BOOL;

    pub fn InitializeProcThreadAttributeList(
        lpAttributeList: *mut u8,
        dwAttributeCount: DWORD,
        dwFlags: DWORD,
        size: *mut usize,
    ) -> BOOL;

    pub fn UpdateProcThreadAttribute(
        lpAttributeList: *mut u8,     // [in, out]
        dwFlags: DWORD,               // [in]
        Attribute: DWORD_PTR,         // [in]
        lpValue: *const c_void,       // [in]
        cbSize: usize,                // [in]
        lpPreviousValue: *mut c_void, // [out, optional]
        lpReturnSize: *mut usize,     // [in, optional]
    ) -> BOOL;

    pub fn IsProcessInJob(process: HANDLE, job: HANDLE, result: *mut BOOL) -> BOOL;

    pub fn CreatePseudoConsole(
        size: COORD,
        hInput: HANDLE,
        hOutput: HANDLE,
        dwFlags: DWORD,
        phPC: *mut HPCON,
    ) -> HRESULT;

    pub fn ResizePseudoConsole(hPC: HPCON, size: COORD) -> HRESULT;

    pub fn ClosePseudoConsole(hPC: HPCON);

    pub fn CloseHandle(hObject: HANDLE) -> BOOL;

    pub fn GetFinalPathNameByHandleW(
        hFile: HANDLE,
        lpszFilePath: *mut u16,
        cchFilePath: DWORD,
        dwFlags: DWORD,
    ) -> DWORD;

    pub fn DeleteFileW(lpFileName: *const u16) -> BOOL;

    pub fn CreateSymbolicLinkW(
        lpSymlinkFileName: *const u16,
        lpTargetFileName: *const u16,
        dwFlags: DWORD,
    ) -> BOOLEAN;

    pub fn GetCurrentThread() -> HANDLE;

    pub fn GetCommandLineW() -> LPWSTR;

    pub fn CreateDirectoryW(
        lpPathName: *const u16,
        lpSecurityAttributes: *mut SECURITY_ATTRIBUTES,
    ) -> BOOL;

    pub fn SetEndOfFile(hFile: HANDLE) -> BOOL;

    pub fn GetProcessTimes(
        in_hProcess: HANDLE,
        out_lpCreationTime: *mut FILETIME,
        out_lpExitTime: *mut FILETIME,
        out_lpKernelTime: *mut FILETIME,
        out_lpUserTime: *mut FILETIME,
    ) -> BOOL;

    pub fn GetFileAttributesExW(
        lpFileName: LPCWSTR,
        fInfoLevelId: GET_FILEEX_INFO_LEVELS,
        lpFileInformation: LPVOID,
    ) -> BOOL;
}

unsafe extern "C" {
    pub fn windows_enable_stdio_inheritance();
}

// ──────────────────────────────────────────────────────────────────────────
// bun_winfs fsio engine (open/read/write) — file access rights and
// CreateFileW flag constants. Values transcribed from the Windows SDK
// 10.0.26100 headers (`um/winnt.h` access masks, `um/winbase.h` FILE_FLAG_*).
// ──────────────────────────────────────────────────────────────────────────

// `winnt.h` specific file access rights (file & pipe).
pub const FILE_WRITE_DATA: ACCESS_MASK = 0x0002;
pub const FILE_WRITE_EA: ACCESS_MASK = 0x0010;
// `winnt.h`: STANDARD_RIGHTS_WRITE == READ_CONTROL (same as the READ variant).
pub const STANDARD_RIGHTS_WRITE: ACCESS_MASK = READ_CONTROL;
// `winnt.h` composite generic-mapping rights. Decomposed (unlike GENERIC_*)
// so individual bits can be subtracted — O_APPEND needs `FILE_GENERIC_WRITE &
// ~FILE_WRITE_DATA | FILE_APPEND_DATA`.
pub const FILE_GENERIC_READ: ACCESS_MASK =
    STANDARD_RIGHTS_READ | FILE_READ_DATA | FILE_READ_ATTRIBUTES | FILE_READ_EA | SYNCHRONIZE;
pub const FILE_GENERIC_WRITE: ACCESS_MASK = STANDARD_RIGHTS_WRITE
    | FILE_WRITE_DATA
    | FILE_WRITE_ATTRIBUTES
    | FILE_WRITE_EA
    | FILE_APPEND_DATA
    | SYNCHRONIZE;

// `winbase.h` CreateFileW dwFlagsAndAttributes (BACKUP_SEMANTICS,
// OPEN_REPARSE_POINT, OVERLAPPED already declared above).
pub const FILE_FLAG_WRITE_THROUGH: DWORD = 0x8000_0000;
pub const FILE_FLAG_NO_BUFFERING: DWORD = 0x2000_0000;
pub const FILE_FLAG_RANDOM_ACCESS: DWORD = 0x1000_0000;
pub const FILE_FLAG_SEQUENTIAL_SCAN: DWORD = 0x0800_0000;
pub const FILE_FLAG_DELETE_ON_CLOSE: DWORD = 0x0400_0000;

// `wdm.h` FileModeInformation (class 16): NtQueryInformationFile returns the
// handle's open mode; `FILE_WRITE_THROUGH` (0x2, declared above with the NT
// create options) is set when the handle was opened write-through — the only
// way to observe FILE_FLAG_WRITE_THROUGH/O_DSYNC on a live handle.
impl FILE_INFORMATION_CLASS {
    pub const FileModeInformation: Self = Self(16);
}

// ──────────────────────────────────────────────────────────────────────────
// bun_winfs fslnk engine (links/dirs) — externs + constants. Values from
// the Windows SDK 10.0.26100 `um/winbase.h` FILE_INFO_BY_HANDLE_CLASS enum.
// ──────────────────────────────────────────────────────────────────────────

/// `FileBasicInfo` — `FILE_BASIC_INFO` payload (layout-identical to the wdm
/// `FILE_BASIC_INFORMATION` declared above).
pub const FileBasicInfo: FILE_INFO_BY_HANDLE_CLASS = 0;
/// `FileRenameInfo` — classic rename; first field is `BOOLEAN
/// ReplaceIfExists` (union with the Ex `Flags` DWORD, so
/// `FILE_RENAME_INFORMATION_EX` with `Flags = 1` is the same bytes).
pub const FileRenameInfo: FILE_INFO_BY_HANDLE_CLASS = 3;
/// `FileRenameInfoEx` (≥ win10 rs1) — `FILE_RENAME_INFORMATION_EX` payload
/// with `FILE_RENAME_*` flag bits.
pub const FileRenameInfoEx: FILE_INFO_BY_HANDLE_CLASS = 22;

#[link(name = "kernel32")]
unsafe extern "system" {
    /// `GetFileInformationByHandleEx` (`winbase.h`) — one syscall, unlike
    /// legacy `GetFileInformationByHandle` which also queries volume info.
    pub fn GetFileInformationByHandleEx(
        hFile: HANDLE,
        FileInformationClass: FILE_INFO_BY_HANDLE_CLASS,
        lpFileInformation: LPVOID,
        dwBufferSize: DWORD,
    ) -> BOOL;
    /// `ReOpenFile` (`winbase.h`) — reopens an open handle's file with a new
    /// access mask without a path round trip.
    pub fn ReOpenFile(
        hOriginalFile: HANDLE,
        dwDesiredAccess: DWORD,
        dwShareMode: DWORD,
        dwFlagsAndAttributes: DWORD,
    ) -> HANDLE;
    /// `CreateHardLinkW` (`winbase.h`) — argument order is (new, existing),
    /// the reverse of POSIX `link(2)`.
    pub fn CreateHardLinkW(
        lpFileName: LPCWSTR,
        lpExistingFileName: LPCWSTR,
        lpSecurityAttributes: *mut SECURITY_ATTRIBUTES,
    ) -> BOOL;
}

// ──────────────────────────────────────────────────────────────────────────
// bun_iocp pipe engine (src/iocp/pipe.rs) — named-pipe externs, modes and
// the NT pipe info classes. Values from SDK 10.0.26100 winbase.h/winnt.h;
// FILE_PIPE_LOCAL_INFORMATION transcribed from libuv src/win/winapi.h
// (4379-4390). // quirk: PIPE-04, PIPE-50, PIPE-60
// ──────────────────────────────────────────────────────────────────────────

/// `FILE_FLAG_FIRST_PIPE_INSTANCE` (`winbase.h`) — CreateNamedPipe fails if
/// the name already exists, making bind-on-existing detectable.
/// // quirk: PIPE-01, PIPE-21
pub const FILE_FLAG_FIRST_PIPE_INSTANCE: DWORD = 0x0008_0000;
/// `PIPE_UNLIMITED_INSTANCES` (`winbase.h`).
pub const PIPE_UNLIMITED_INSTANCES: DWORD = 255;
/// `PIPE_NOWAIT` (`winbase.h`) — LAN Manager 2.0 relic; rejected outright.
/// // quirk: PIPE-11
pub const PIPE_NOWAIT: DWORD = 0x0000_0001;
/// `PIPE_READMODE_MESSAGE` (`winbase.h`) — tolerated on adopted handles
/// (Cygwin/MSYS stdio). // quirk: PIPE-10
pub const PIPE_READMODE_MESSAGE: DWORD = 0x0000_0002;
/// `WRITE_DAC` (`winnt.h`) — required at creation for any later pipe chmod.
/// // quirk: PIPE-59
pub const WRITE_DAC: ACCESS_MASK = 0x0004_0000;
/// `FILE_SYNCHRONOUS_IO_ALERT` (`wdm.h`) — with NONALERT (0x20, declared
/// above), the FileModeInformation bits that mark a handle synchronous.
/// // quirk: PIPE-13
pub const FILE_SYNCHRONOUS_IO_ALERT: ULONG = 0x0000_0010;

// `SetFileCompletionNotificationModes` flag bytes (`winbase.h`).
// // quirk: PIPE-18
pub const FILE_SKIP_COMPLETION_PORT_ON_SUCCESS: u8 = 0x1;
pub const FILE_SKIP_SET_EVENT_ON_HANDLE: u8 = 0x2;

/// `FILE_PIPE_LOCAL_INFORMATION` (`ntifs.h`; libuv winapi.h:4379-4390) —
/// `NtQueryInformationFile(FilePipeLocalInformation)` payload. The shutdown
/// probe compares `WriteQuotaAvailable` against `OutboundQuota`: equal iff
/// the peer drained every written byte. // quirk: PIPE-50
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_PIPE_LOCAL_INFORMATION {
    pub NamedPipeType: ULONG,
    pub NamedPipeConfiguration: ULONG,
    pub MaximumInstances: ULONG,
    pub CurrentInstances: ULONG,
    pub InboundQuota: ULONG,
    pub ReadDataAvailable: ULONG,
    pub OutboundQuota: ULONG,
    pub WriteQuotaAvailable: ULONG,
    pub NamedPipeState: ULONG,
    pub NamedPipeEnd: ULONG,
}

impl FILE_INFORMATION_CLASS {
    /// `FileAccessInformation` (`wdm.h`) — the handle's granted access mask;
    /// how adopted pipe fds report readable/writable. // quirk: PIPE-15
    pub const FileAccessInformation: Self = Self(8);
    /// `FilePipeLocalInformation` (`ntifs.h`) — shutdown probe input.
    /// // quirk: PIPE-50, PIPE-60
    pub const FilePipeLocalInformation: Self = Self(24);
}

impl Win32Error {
    /// `ERROR_PIPE_CONNECTED` (535) — ConnectNamedPipe on an already
    /// connected client; means success. // quirk: PIPE-07
    pub const PIPE_CONNECTED: Win32Error = Win32Error(535);
    /// `ERROR_IO_PENDING` (997) under its overlapped-I/O name (the WSA alias
    /// above carries the same value).
    pub const IO_PENDING: Win32Error = Win32Error(997);
    /// `ERROR_MORE_DATA` (234) — message-mode read into a short buffer; the
    /// buffer IS full, remainder follows. // quirk: PIPE-10
    pub const MORE_DATA: Win32Error = Win32Error(234);
}

#[link(name = "kernel32")]
unsafe extern "system" {
    /// `ConnectNamedPipe` (`namedpipeapi.h`). Overlapped form returns 0;
    /// ERROR_PIPE_CONNECTED means already connected (success).
    /// // quirk: PIPE-07
    pub fn ConnectNamedPipe(hNamedPipe: HANDLE, lpOverlapped: *mut OVERLAPPED) -> BOOL;
    /// `DisconnectNamedPipe` (`namedpipeapi.h`) — server-side disconnect;
    /// pending client I/O fails with ERROR_PIPE_NOT_CONNECTED.
    pub fn DisconnectNamedPipe(hNamedPipe: HANDLE) -> BOOL;
    /// `WaitNamedPipeW` (`namedpipeapi.h`) — blocks until an instance of the
    /// named pipe is listening, or the timeout elapses. // quirk: PIPE-27
    pub fn WaitNamedPipeW(lpNamedPipeName: LPCWSTR, nTimeOut: DWORD) -> BOOL;
    /// `SetNamedPipeHandleState` (`namedpipeapi.h`). Requires GENERIC_WRITE
    /// or FILE_WRITE_ATTRIBUTES on the handle. // quirk: PIPE-10
    pub fn SetNamedPipeHandleState(
        hNamedPipe: HANDLE,
        lpMode: *mut DWORD,
        lpMaxCollectionCount: *mut DWORD,
        lpCollectDataTimeout: *mut DWORD,
    ) -> BOOL;
    /// `GetNamedPipeHandleStateW` (`namedpipeapi.h`).
    pub fn GetNamedPipeHandleStateW(
        hNamedPipe: HANDLE,
        lpState: *mut DWORD,
        lpCurInstances: *mut DWORD,
        lpMaxCollectionCount: *mut DWORD,
        lpCollectDataTimeout: *mut DWORD,
        lpUserName: LPWSTR,
        nMaxUserNameSize: DWORD,
    ) -> BOOL;
    /// `SetFileCompletionNotificationModes` (`winbase.h`). // quirk: PIPE-18
    pub fn SetFileCompletionNotificationModes(FileHandle: HANDLE, Flags: u8) -> BOOL;
    /// `CreatePipe` (`namedpipeapi.h`) — anonymous (non-overlapped) pipe
    /// pair, the shape inherited from cmd.exe-spawned parents.
    /// // quirk: PIPE-13
    pub fn CreatePipe(
        hReadPipe: *mut HANDLE,
        hWritePipe: *mut HANDLE,
        lpPipeAttributes: *mut SECURITY_ATTRIBUTES,
        nSize: DWORD,
    ) -> BOOL;
    /// `CancelSynchronousIo` (`ioapiset.h`) — cancels the synchronous I/O
    /// the target thread is currently blocked in; ERROR_NOT_FOUND when the
    /// thread is not inside a cancellable wait (caller must spin).
    /// // quirk: PIPE-35
    pub fn CancelSynchronousIo(hThread: HANDLE) -> BOOL;
    /// `SwitchToThread` (`processthreadsapi.h`) — yield to any ready thread.
    /// No preconditions.
    pub safe fn SwitchToThread() -> BOOL;
    /// `GetCurrentProcessId` (`processthreadsapi.h`). No preconditions.
    pub safe fn GetCurrentProcessId() -> DWORD;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    /// `RtlGenRandom` (`ntsecapi.h`, exported as `SystemFunction036`) — the
    /// tier-0 CSPRNG; seeds pipe-pair names (the retry loop, not the seed,
    /// is the uniqueness mechanism). // quirk: PIPE-03
    #[link_name = "SystemFunction036"]
    pub fn RtlGenRandom(RandomBuffer: *mut c_void, RandomBufferLength: ULONG) -> BOOLEAN;
}

// `GetStdHandle` selectors (`processenv.h`): `(DWORD)-10/-11/-12`.
pub const STD_INPUT_HANDLE: DWORD = -10i32 as DWORD;
pub const STD_OUTPUT_HANDLE: DWORD = -11i32 as DWORD;
pub const STD_ERROR_HANDLE: DWORD = -12i32 as DWORD;

impl Win32Error {
    /// `ERROR_SEEK_ON_DEVICE` (132, `winerror.h`) — "the file pointer cannot
    /// be set on the specified device or file": the raw ESPIPE shape the fd
    /// table reports for positioned I/O on non-seekable fd kinds. Not in the
    /// libuv general table (it never produced it); the fd-table consumer maps
    /// it to ESPIPE at its boundary.
    pub const SEEK_ON_DEVICE: Win32Error = Win32Error(132);
}

impl NTSTATUS {
    /// `STATUS_INVALID_INFO_CLASS` (`ntstatus.h`) — the object/filesystem does
    /// not implement the requested information class (e.g. npfs rejects the
    /// FileId directory-enumeration classes); distinct from the
    /// `STATUS_INVALID_PARAMETER` that `NtQueryDirectoryFile` returns for a
    /// non-directory handle. // quirk: FSLNK-35
    pub const INVALID_INFO_CLASS: NTSTATUS = NTSTATUS(0xC000_0003);
}

// ──────────────────────────────────────────────────────────────────────────
// Console I/O (wincon.h / consoleapi.h) — the uv_tty_t replacement surface.
// Console handles cannot use IOCP/overlapped I/O at all; everything below is
// synchronous and is driven from wait registrations or pool workers.
// // quirk: TTY-56
// ──────────────────────────────────────────────────────────────────────────

#[link(name = "kernel32")]
unsafe extern "system" {
    /// `ReadConsoleW` (`consoleapi.h`) — cooked-mode UTF-16 console read;
    /// blocks until Enter (or a trap injection). // quirk: TTY-35
    pub fn ReadConsoleW(
        hConsoleInput: HANDLE,
        lpBuffer: *mut c_void,
        nNumberOfCharsToRead: DWORD,
        lpNumberOfCharsRead: *mut DWORD,
        pInputControl: *mut c_void,
    ) -> BOOL;
    /// `ReadConsoleInputW` (`consoleapi.h`) — blocks when no records are
    /// queued; gate on `GetNumberOfConsoleInputEvents`. // quirk: TTY-26
    pub fn ReadConsoleInputW(
        hConsoleInput: HANDLE,
        lpBuffer: *mut INPUT_RECORD,
        nLength: DWORD,
        lpNumberOfEventsRead: *mut DWORD,
    ) -> BOOL;
    /// `WriteConsoleW` (`consoleapi.h`) — keep single writes at or below 8192
    /// WCHARs; large writes fail outright. // quirk: TTY-15
    pub fn WriteConsoleW(
        hConsoleOutput: HANDLE,
        lpBuffer: *const c_void,
        nNumberOfCharsToWrite: DWORD,
        lpNumberOfCharsWritten: *mut DWORD,
        lpReserved: *mut c_void,
    ) -> BOOL;
    /// `WriteConsoleInputW` (`consoleapi.h`) — injects records into the input
    /// queue; `EventType` must be a valid type (0 is rejected by modern
    /// Windows). // quirk: TTY-34, TTY-37
    pub fn WriteConsoleInputW(
        hConsoleInput: HANDLE,
        lpBuffer: *const INPUT_RECORD,
        nLength: DWORD,
        lpNumberOfEventsWritten: *mut DWORD,
    ) -> BOOL;
    /// `GetNumberOfConsoleInputEvents` (`consoleapi.h`) — also the
    /// is-this-an-input-handle probe (fails on screen buffers).
    /// // quirk: TTY-05
    pub fn GetNumberOfConsoleInputEvents(
        hConsoleInput: HANDLE,
        lpcNumberOfEvents: *mut DWORD,
    ) -> BOOL;
    /// `FlushConsoleInputBuffer` (`consoleapi.h`).
    pub fn FlushConsoleInputBuffer(hConsoleInput: HANDLE) -> BOOL;
    /// `AllocConsole` (`consoleapi.h`) — attach a fresh console to a process
    /// that has none. No pointer preconditions.
    pub safe fn AllocConsole() -> BOOL;
    /// `FreeConsole` (`consoleapi.h`). No pointer preconditions.
    pub safe fn FreeConsole() -> BOOL;
    /// `CreateSemaphoreW` (`synchapi.h`). Null name = anonymous. A semaphore
    /// (not a mutex) is required when the release happens on a different
    /// thread than the acquire. // quirk: TTY-10
    pub fn CreateSemaphoreW(
        lpSemaphoreAttributes: *mut SECURITY_ATTRIBUTES,
        lInitialCount: LONG,
        lMaximumCount: LONG,
        lpName: LPCWSTR,
    ) -> HANDLE;
    /// `ReleaseSemaphore` (`synchapi.h`).
    pub fn ReleaseSemaphore(
        hSemaphore: HANDLE,
        lReleaseCount: LONG,
        lpPreviousCount: *mut LONG,
    ) -> BOOL;
    /// `SetEvent` (`synchapi.h`).
    pub fn SetEvent(hEvent: HANDLE) -> BOOL;
    /// `ResetEvent` (`synchapi.h`).
    pub fn ResetEvent(hEvent: HANDLE) -> BOOL;
    /// `Sleep` (`synchapi.h`). No preconditions.
    pub safe fn Sleep(dwMilliseconds: DWORD);
    /// `RegisterWaitForSingleObject` (`winbase.h`) — fires `Callback` on a
    /// thread-pool wait thread when `hObject` signals. Console input handles
    /// are waitable: signaled while records are queued. // quirk: TTY-25
    pub fn RegisterWaitForSingleObject(
        phNewWaitObject: *mut HANDLE,
        hObject: HANDLE,
        Callback: WAITORTIMERCALLBACK,
        Context: *mut c_void,
        dwMilliseconds: ULONG,
        dwFlags: ULONG,
    ) -> BOOL;
    /// `UnregisterWait` (`winbase.h`) — non-blocking; ERROR_IO_PENDING means
    /// a callback is still running and deletion is deferred. // quirk: TTY-46
    pub fn UnregisterWait(WaitHandle: HANDLE) -> BOOL;
}

/// `WAITORTIMERCALLBACK` (`winnt.h`).
pub type WAITORTIMERCALLBACK = unsafe extern "system" fn(*mut c_void, BOOLEAN);

/// `WT_EXECUTEINWAITTHREAD` (`winnt.h`) — run the callback on the wait thread
/// itself (short, non-blocking callbacks only).
pub const WT_EXECUTEINWAITTHREAD: ULONG = 0x0000_0004;
/// `WT_EXECUTEONLYONCE` (`winnt.h`) — one-shot wait registration.
pub const WT_EXECUTEONLYONCE: ULONG = 0x0000_0008;

#[link(name = "ntdll")]
unsafe extern "system" {
    /// `NtQueryInformationProcess` (`winternl.h`) — undocumented info classes
    /// included; `ProcessConsoleHostProcess` yields the conhost PID for
    /// scoping `SetWinEventHook` (hooking pid 0 froze machines).
    /// // quirk: TTY-49
    pub fn NtQueryInformationProcess(
        ProcessHandle: HANDLE,
        ProcessInformationClass: u32,
        ProcessInformation: *mut c_void,
        ProcessInformationLength: ULONG,
        ReturnLength: *mut ULONG,
    ) -> NTSTATUS;
}

/// `ProcessConsoleHostProcess` info class (=49). The returned ULONG_PTR
/// carries flag bits in its low 2 bits — mask with `!3` before use as a PID.
/// // quirk: TTY-49
pub const ProcessConsoleHostProcess: u32 = 49;

// Console input-mode flags (`wincon.h`). NORMAL mode deliberately sets only
// ECHO|LINE|PROCESSED without ENABLE_EXTENDED_FLAGS so the user's
// insert/quick-edit preferences survive. // quirk: TTY-43
pub const ENABLE_PROCESSED_INPUT: DWORD = 0x0001;
pub const ENABLE_LINE_INPUT: DWORD = 0x0002;
pub const ENABLE_ECHO_INPUT: DWORD = 0x0004;
pub const ENABLE_WINDOW_INPUT: DWORD = 0x0008;
pub const ENABLE_MOUSE_INPUT: DWORD = 0x0010;
pub const ENABLE_INSERT_MODE: DWORD = 0x0020;
pub const ENABLE_QUICK_EDIT_MODE: DWORD = 0x0040;
pub const ENABLE_EXTENDED_FLAGS: DWORD = 0x0080;
/// Win10 1607+: conhost delivers keys as VT byte sequences. Rejected by the
/// legacy console; callers must retry without it. // quirk: TTY-44
pub const ENABLE_VIRTUAL_TERMINAL_INPUT: DWORD = 0x0200;
/// Console output-mode flag (`wincon.h`): conhost interprets ANSI/VT
/// sequences natively. No query API — probe by setting it. // quirk: TTY-08
pub const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;

// `INPUT_RECORD.EventType` values (`wincon.h`). NOTE: the *struct* named
// `WINDOW_BUFFER_SIZE_EVENT` above is canonically `WINDOW_BUFFER_SIZE_RECORD`
// in wincon.h; the constant below is the real Win32 spelling of the event
// type and coexists in the value namespace.
pub const KEY_EVENT: WORD = 0x0001;
pub const MOUSE_EVENT: WORD = 0x0002;
pub const WINDOW_BUFFER_SIZE_EVENT: WORD = 0x0004;
pub const MENU_EVENT: WORD = 0x0008;
pub const FOCUS_EVENT: WORD = 0x0010;

// `KEY_EVENT_RECORD.dwControlKeyState` flags (`wincon.h`).
pub const RIGHT_ALT_PRESSED: DWORD = 0x0001;
pub const LEFT_ALT_PRESSED: DWORD = 0x0002;
pub const RIGHT_CTRL_PRESSED: DWORD = 0x0004;
pub const LEFT_CTRL_PRESSED: DWORD = 0x0008;
pub const SHIFT_PRESSED: DWORD = 0x0010;
/// Gray nav-cluster keys carry this; the numpad twins (same VK codes) do
/// not — the only way to tell them apart. // quirk: TTY-29
pub const ENHANCED_KEY: DWORD = 0x0100;

// Virtual-key codes (`winuser.h`) used by the console key translator.
pub const VK_CLEAR: WORD = 0x0C;
pub const VK_RETURN: WORD = 0x0D;
pub const VK_MENU: WORD = 0x12;
pub const VK_PRIOR: WORD = 0x21;
pub const VK_NEXT: WORD = 0x22;
pub const VK_END: WORD = 0x23;
pub const VK_HOME: WORD = 0x24;
pub const VK_LEFT: WORD = 0x25;
pub const VK_UP: WORD = 0x26;
pub const VK_RIGHT: WORD = 0x27;
pub const VK_DOWN: WORD = 0x28;
pub const VK_INSERT: WORD = 0x2D;
pub const VK_DELETE: WORD = 0x2E;
pub const VK_NUMPAD0: WORD = 0x60;
pub const VK_NUMPAD1: WORD = 0x61;
pub const VK_NUMPAD2: WORD = 0x62;
pub const VK_NUMPAD3: WORD = 0x63;
pub const VK_NUMPAD4: WORD = 0x64;
pub const VK_NUMPAD5: WORD = 0x65;
pub const VK_NUMPAD6: WORD = 0x66;
pub const VK_NUMPAD7: WORD = 0x67;
pub const VK_NUMPAD8: WORD = 0x68;
pub const VK_NUMPAD9: WORD = 0x69;
pub const VK_DECIMAL: WORD = 0x6E;
pub const VK_F1: WORD = 0x70;
pub const VK_F2: WORD = 0x71;
pub const VK_F3: WORD = 0x72;
pub const VK_F4: WORD = 0x73;
pub const VK_F5: WORD = 0x74;
pub const VK_F6: WORD = 0x75;
pub const VK_F7: WORD = 0x76;
pub const VK_F8: WORD = 0x77;
pub const VK_F9: WORD = 0x78;
pub const VK_F10: WORD = 0x79;
pub const VK_F11: WORD = 0x7A;
pub const VK_F12: WORD = 0x7B;

/// `EVENT_CONSOLE_LAYOUT` (`winuser.h`) — the WinEvent conhost emits on
/// console layout (size) changes. // quirk: TTY-49
pub const EVENT_CONSOLE_LAYOUT: DWORD = 0x4005;
/// `WINEVENT_OUTOFCONTEXT` (`winuser.h`) — hook callback delivered via the
/// registering thread's message queue (which therefore needs a pump).
/// // quirk: TTY-51
pub const WINEVENT_OUTOFCONTEXT: DWORD = 0x0000;
/// `MAPVK_VK_TO_VSC` (`winuser.h`) — `MapVirtualKeyW` mapping selector.
pub const MAPVK_VK_TO_VSC: u32 = 0;

// ──────────────────────────────────────────────────────────────────────────
// bun_iocp fs-event engine (src/iocp/fsevent.rs) — ReadDirectoryChangesW
// externs and notify constants. Values from SDK 10.0.26100 winnt.h /
// fileapi.h / winbase.h / stringapiset.h.
// ──────────────────────────────────────────────────────────────────────────

// `winnt.h` ReadDirectoryChangesW dwNotifyFilter bits. // quirk: SIGEV-24
pub const FILE_NOTIFY_CHANGE_FILE_NAME: DWORD = 0x0000_0001;
pub const FILE_NOTIFY_CHANGE_DIR_NAME: DWORD = 0x0000_0002;
pub const FILE_NOTIFY_CHANGE_ATTRIBUTES: DWORD = 0x0000_0004;
pub const FILE_NOTIFY_CHANGE_SIZE: DWORD = 0x0000_0008;
pub const FILE_NOTIFY_CHANGE_LAST_WRITE: DWORD = 0x0000_0010;
pub const FILE_NOTIFY_CHANGE_LAST_ACCESS: DWORD = 0x0000_0020;
pub const FILE_NOTIFY_CHANGE_CREATION: DWORD = 0x0000_0040;
pub const FILE_NOTIFY_CHANGE_SECURITY: DWORD = 0x0000_0100;

// `winnt.h` FILE_NOTIFY_INFORMATION.Action values. A rename produces TWO
// records (OLD_NAME then NEW_NAME). // quirk: SIGEV-45
pub const FILE_ACTION_ADDED: DWORD = 0x0000_0001;
pub const FILE_ACTION_REMOVED: DWORD = 0x0000_0002;
pub const FILE_ACTION_MODIFIED: DWORD = 0x0000_0003;
pub const FILE_ACTION_RENAMED_OLD_NAME: DWORD = 0x0000_0004;
pub const FILE_ACTION_RENAMED_NEW_NAME: DWORD = 0x0000_0005;

impl FILE_INFORMATION_CLASS {
    /// `FileStandardInformation` (`wdm.h`) — `FILE_STANDARD_INFORMATION`
    /// payload; the DeletePending/Directory probe input. // quirk: SIGEV-47
    pub const FileStandardInformation: Self = Self(5);
}

/// `CompareStringOrdinal` "equal" result (`winnls.h`; CSTR_LESS_THAN=1,
/// CSTR_EQUAL=2, CSTR_GREATER_THAN=3, 0=error).
pub const CSTR_EQUAL: c_int = 2;

/// `MoveFileExW` dwFlags bit (`winbase.h`).
pub const MOVEFILE_REPLACE_EXISTING: DWORD = 0x0000_0001;

#[link(name = "kernel32")]
unsafe extern "system" {
    /// `ReadDirectoryChangesW` (`winbase.h`). The buffer must be
    /// DWORD-aligned and at most 64 KiB for network paths; for overlapped
    /// calls the result arrives only via the OVERLAPPED (`lpBytesReturned`
    /// is undefined). // quirk: SIGEV-22, SIGEV-23
    pub fn ReadDirectoryChangesW(
        hDirectory: HANDLE,
        lpBuffer: LPVOID,
        nBufferLength: DWORD,
        bWatchSubtree: BOOL,
        dwNotifyFilter: DWORD,
        lpBytesReturned: *mut DWORD,
        lpOverlapped: *mut OVERLAPPED,
        lpCompletionRoutine: *mut c_void,
    ) -> BOOL;
    /// `GetShortPathNameW` (`fileapi.h`). Two-call sizing: a too-small
    /// buffer returns the required size INCLUDING the NUL; success returns
    /// chars written EXCLUDING it. Fails legitimately on volumes with 8.3
    /// generation disabled. // quirk: SIGEV-29, SIGEV-33
    pub fn GetShortPathNameW(
        lpszLongPath: LPCWSTR,
        lpszShortPath: LPWSTR,
        cchBuffer: DWORD,
    ) -> DWORD;
    /// `GetLongPathNameW` (`fileapi.h`). Same two-call size convention as
    /// `GetShortPathNameW`; resolves against the live filesystem, so it
    /// fails for paths that no longer exist. // quirk: SIGEV-33
    pub fn GetLongPathNameW(
        lpszShortPath: LPCWSTR,
        lpszLongPath: LPWSTR,
        cchBuffer: DWORD,
    ) -> DWORD;
    /// `CompareStringOrdinal` (`stringapiset.h`) — binary comparison via the
    /// OS upcase table when bIgnoreCase is set, which matches kernel/NTFS
    /// case folding (unlike CRT `_wcsnicmp`'s locale folding).
    /// // quirk: SIGEV-31
    pub fn CompareStringOrdinal(
        lpString1: LPCWSTR,
        cchCount1: c_int,
        lpString2: LPCWSTR,
        cchCount2: c_int,
        bIgnoreCase: BOOL,
    ) -> c_int;
    /// `MoveFileExW` (`winbase.h`).
    pub fn MoveFileExW(lpExistingFileName: LPCWSTR, lpNewFileName: LPCWSTR, dwFlags: DWORD)
    -> BOOL;
}

// ──────────────────────────────────────────────────────────────────────────
// bun_iocp process engine (src/iocp/process.rs) — spawn/wait/kill externs
// and constants. Values from SDK 10.0.26100 winbase.h / winnt.h /
// processthreadsapi.h / processenv.h.
// ──────────────────────────────────────────────────────────────────────────

// `CreateProcessW` dwCreationFlags (`winbase.h`).
pub const CREATE_SUSPENDED: DWORD = 0x0000_0004;
/// `DETACHED_PROCESS` — child gets no inherited console. Deliberately paired
/// with `CREATE_NEW_PROCESS_GROUP`, never `CREATE_BREAKAWAY_FROM_JOB` (which
/// fails the spawn under no-breakaway job control). // quirk: PROC-40
pub const DETACHED_PROCESS: DWORD = 0x0000_0008;
pub const CREATE_NEW_PROCESS_GROUP: DWORD = 0x0000_0200;
/// Without this flag lpEnvironment is parsed as ANSI and the child gets
/// mojibake. // quirk: PROC-07
pub const CREATE_UNICODE_ENVIRONMENT: DWORD = 0x0000_0400;
pub const EXTENDED_STARTUPINFO_PRESENT: DWORD = 0x0008_0000;
/// Prevents console-subsystem children from getting a console AT ALL —
/// breaks children that inherit the parent console's fds. // quirk: PROC-39
pub const CREATE_NO_WINDOW: DWORD = 0x0800_0000;

// `STARTUPINFOW.dwFlags` / `wShowWindow` (`winbase.h` / `winuser.h`).
pub const STARTF_USESHOWWINDOW: DWORD = 0x0000_0001;
pub const SW_HIDE: WORD = 0;
pub const SW_SHOWDEFAULT: WORD = 10;

/// `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE` (`winbase.h`, Win10 1809+) —
/// ProcThreadAttributeValue(22, FALSE, TRUE, FALSE).
pub const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x0002_0016;

/// `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` (`winbase.h`) —
/// ProcThreadAttributeHandleList(2) | PROC_THREAD_ATTRIBUTE_INPUT(0x20000).
/// Restricts bInheritHandles=TRUE to exactly the listed handles.
/// // quirk: PROC-33
pub const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: DWORD_PTR = 0x0002_0002;

// `JOBOBJECT_BASIC_LIMIT_INFORMATION.LimitFlags` bits (`winnt.h`); composes
// with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` declared above. // quirk: PROC-42
pub const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION: DWORD = 0x0000_0400;
pub const JOB_OBJECT_LIMIT_BREAKAWAY_OK: DWORD = 0x0000_0800;
pub const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK: DWORD = 0x0000_1000;

/// `STILL_ACTIVE` (`winbase.h`, = STATUS_PENDING & 0x103) —
/// `GetExitCodeProcess` for a running process; ambiguous with a process that
/// exited with code 259. // quirk: PROC-53
pub const STILL_ACTIVE: DWORD = 259;

// `OpenProcess` access rights (`winnt.h`). SYNCHRONIZE is declared above;
// forgetting it breaks the WaitForSingleObject liveness probes.
// // quirk: PROC-54
pub const PROCESS_TERMINATE: ACCESS_MASK = 0x0001;
pub const PROCESS_QUERY_INFORMATION: ACCESS_MASK = 0x0400;

/// `SetHandleInformation` mask bit (`winbase.h`).
pub const HANDLE_FLAG_INHERIT: DWORD = 0x0000_0001;

/// `GetFileAttributesW` failure sentinel (`fileapi.h`).
pub const INVALID_FILE_ATTRIBUTES: DWORD = 0xFFFF_FFFF;

#[link(name = "kernel32")]
unsafe extern "system" {
    /// `TerminateProcess` (`processthreadsapi.h`). Fails ACCESS_DENIED on an
    /// exited-but-handle-open process — same code as a real permissions
    /// failure; disambiguate with the two-step probe. // quirk: PROC-52
    pub fn TerminateProcess(hProcess: HANDLE, uExitCode: UINT) -> BOOL;
    /// `UnregisterWaitEx` (`winbase.h`). With CompletionEvent =
    /// INVALID_HANDLE_VALUE, blocks until the wait was cancelled or the
    /// callback completed — the only race-free teardown. // quirk: PROC-46
    pub fn UnregisterWaitEx(WaitHandle: HANDLE, CompletionEvent: HANDLE) -> BOOL;
    /// `GetEnvironmentVariableW` (`processenv.h`). Size-probe-then-fill; the
    /// second call can return MORE than the probe (concurrent mutation) —
    /// re-check, never trust probe==fill. // quirk: PROC-63, PROC-13
    pub fn GetEnvironmentVariableW(lpName: LPCWSTR, lpBuffer: LPWSTR, nSize: DWORD) -> DWORD;
    /// `SetEnvironmentVariableW` (`processenv.h`). Null value deletes.
    pub fn SetEnvironmentVariableW(lpName: LPCWSTR, lpValue: LPCWSTR) -> BOOL;
    /// `NeedCurrentDirectoryForExePathW` (`processenv.h`) — consults the
    /// `NoDefaultCurrentDirectoryInExePath` env var; gates the cwd-before-
    /// PATH search step. // quirk: PROC-18
    pub fn NeedCurrentDirectoryForExePathW(ExeName: LPCWSTR) -> BOOL;
    /// `DeleteProcThreadAttributeList` (`processthreadsapi.h`).
    pub fn DeleteProcThreadAttributeList(lpAttributeList: *mut u8);
    /// `GetStartupInfoW` (`processenv.h`) — cannot fail; yields OUR inherited
    /// lpReserved2 blob, which must be verified before walking.
    /// // quirk: PROC-35
    pub fn GetStartupInfoW(lpStartupInfo: *mut STARTUPINFOW);
    /// `SetLastError` (`errhandlingapi.h`). No preconditions.
    pub safe fn SetLastError(dwErrCode: DWORD);
}

// ──────────────────────────────────────────────────────────────────────────
// bun_winfs misc engine (src/winfs/fsmisc.rs) — utimes/statfs externs.
// Values from SDK 10.0.26100 fileapi.h/sysinfoapi.h/ntifs.h.
// ──────────────────────────────────────────────────────────────────────────

/// `FILE_FS_FULL_SIZE_INFORMATION` (`ntifs.h`) — `NtQueryVolumeInformationFile`
/// (`FileFsFullSizeInformation`) payload. 64-bit allocation-unit counts, so
/// volumes with more than 2^32 clusters report correctly; `CallerAvailable`
/// respects per-user NTFS quotas while `ActualAvailable` is the raw free
/// count. // quirk: FSMETA-44, FSMETA-45
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct FILE_FS_FULL_SIZE_INFORMATION {
    pub TotalAllocationUnits: LARGE_INTEGER,
    pub CallerAvailableAllocationUnits: LARGE_INTEGER,
    pub ActualAvailableAllocationUnits: LARGE_INTEGER,
    pub SectorsPerAllocationUnit: ULONG,
    pub BytesPerSector: ULONG,
}

const _: () = assert!(core::mem::size_of::<FILE_FS_FULL_SIZE_INFORMATION>() == 32);

impl FS_INFORMATION_CLASS {
    pub const FileFsFullSizeInformation: Self = Self(7);
}

#[link(name = "kernel32")]
unsafe extern "system" {
    /// `SetFileTime` (`fileapi.h`) — needs `FILE_WRITE_ATTRIBUTES` on the
    /// handle; a NULL timestamp pointer natively means "leave unchanged"
    /// (the perfect UTIME_OMIT match). // quirk: FSMETA-30, FSMETA-31
    pub fn SetFileTime(
        hFile: HANDLE,
        lpCreationTime: *const FILETIME,
        lpLastAccessTime: *const FILETIME,
        lpLastWriteTime: *const FILETIME,
    ) -> BOOL;
    /// `GetSystemTimeAsFileTime` (`sysinfoapi.h`). Cannot fail.
    pub fn GetSystemTimeAsFileTime(lpSystemTimeAsFileTime: *mut FILETIME);
    /// `GetDiskFreeSpaceExW` (`fileapi.h`) — byte-granular volume totals.
    /// Out-params are `ULARGE_INTEGER` (plain u64 here); any may be null.
    pub fn GetDiskFreeSpaceExW(
        lpDirectoryName: LPCWSTR,
        lpFreeBytesAvailableToCaller: *mut u64,
        lpTotalNumberOfBytes: *mut u64,
        lpTotalNumberOfFreeBytes: *mut u64,
    ) -> BOOL;
}
