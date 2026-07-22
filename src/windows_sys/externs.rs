//! Raw Win32 extern fn declarations + tier-0 Win32 typedefs.
//! `bun_sys::windows` re-exports FROM here (see the layering doc). This crate is a tier-0 leaf: it depends on nothing above
//! `libuv_sys`.

use core::ffi::{c_char, c_int, c_long, c_short, c_uint, c_ulong, c_ushort, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Basic Win32 typedefs (owned here; mirror winnt.h)
// ──────────────────────────────────────────────────────────────────────────

pub type BOOL = c_int;
pub type BOOLEAN = u8;
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

// Layout pins: a typo in any of the above is a silent ABI break across the
// libuv embed boundary; assert the authoritative Windows-x64 sizes. Gated on
// `windows` (not just pointer width) because `DWORD = c_ulong` is 4 bytes
// under LLP64 but 8 under LP64, so the sizes differ on a Linux cross-check.
#[cfg(all(windows, target_pointer_width = "64"))]
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
pub const FILE_APPEND_DATA: ACCESS_MASK = 0x0004;
pub const FILE_READ_EA: ACCESS_MASK = 0x0008;
pub const FILE_TRAVERSE: ACCESS_MASK = 0x0020;
pub const FILE_READ_ATTRIBUTES: ACCESS_MASK = 0x0080;

// `CreateFileW` dwCreationDisposition (`winbase.h`).
pub const OPEN_EXISTING: DWORD = 3;

// `CreateFileW` dwFlagsAndAttributes (`winbase.h`).
pub const FILE_FLAG_BACKUP_SEMANTICS: DWORD = 0x0200_0000;
pub const FILE_FLAG_OVERLAPPED: DWORD = 0x4000_0000;

// Reparse tags (`winnt.h`). `IsReparseTagNameSurrogate` == bit 29: the reparse
// point names another filesystem entity (symlink, mount point). Non-surrogate
// tags such as `IO_REPARSE_TAG_APPEXECLINK` are opaque and not traversed.
#[inline]
pub const fn is_reparse_tag_name_surrogate(tag: DWORD) -> bool {
    (tag & 0x2000_0000) != 0
}

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

/// `FILE_BASIC_INFORMATION` (`wdm.h`) — output of `NtQueryAttributesFile`.
#[repr(C)]
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
    pub const FileDispositionInformation: Self = Self(13);
    pub const FileAllInformation: Self = Self(18);
    pub const FileEndOfFileInformation: Self = Self(20);
    pub const FileDispositionInformationEx: Self = Self(64);
}

/// `FS_INFORMATION_CLASS` (`ntifs.h`) — selector for
/// `NtQueryVolumeInformationFile`. Newtype-over-u32 so unmapped values
/// round-trip.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct FS_INFORMATION_CLASS(pub u32);
impl FS_INFORMATION_CLASS {
    pub const FileFsVolumeInformation: Self = Self(1);
    pub const FileFsDeviceInformation: Self = Self(4);
}

/// `FILE_STANDARD_INFORMATION` (`wdm.h`).
#[repr(C)]
pub struct FILE_STANDARD_INFORMATION {
    pub AllocationSize: LARGE_INTEGER,
    pub EndOfFile: LARGE_INTEGER,
    pub NumberOfLinks: ULONG,
    pub DeletePending: BOOLEAN,
    pub Directory: BOOLEAN,
}

/// `FILE_INTERNAL_INFORMATION` (`ntifs.h`) — the NTFS file reference number.
#[repr(C)]
pub struct FILE_INTERNAL_INFORMATION {
    pub IndexNumber: LARGE_INTEGER,
}

/// `FILE_ALL_INFORMATION` (`ntifs.h`) — aggregate returned by
/// `NtQueryInformationFile(.., FileAllInformation)`. `NameInformation` is
/// variable-length; with a fixed-size buffer the call returns
/// `STATUS_BUFFER_OVERFLOW` (a warning, not an error) and the fixed fields
/// are still populated.
#[repr(C)]
pub struct FILE_ALL_INFORMATION {
    pub BasicInformation: FILE_BASIC_INFORMATION,
    pub StandardInformation: FILE_STANDARD_INFORMATION,
    pub InternalInformation: FILE_INTERNAL_INFORMATION,
    pub EaSize: ULONG,                    // FILE_EA_INFORMATION
    pub AccessFlags: ULONG,               // FILE_ACCESS_INFORMATION
    pub CurrentByteOffset: LARGE_INTEGER, // FILE_POSITION_INFORMATION
    pub Mode: ULONG,                      // FILE_MODE_INFORMATION
    pub AlignmentRequirement: ULONG,      // FILE_ALIGNMENT_INFORMATION
    pub FileNameLength: ULONG,            // FILE_NAME_INFORMATION
    pub FileName: [WCHAR; 1],
}

/// `FILE_FS_DEVICE_INFORMATION` (`ntifs.h`).
#[repr(C)]
pub struct FILE_FS_DEVICE_INFORMATION {
    pub DeviceType: ULONG,
    pub Characteristics: ULONG,
}

/// `FILE_FS_VOLUME_INFORMATION` (`ntifs.h`). `VolumeLabel` is variable-length;
/// with a fixed-size buffer the call returns `STATUS_BUFFER_OVERFLOW` and the
/// fixed fields are still populated.
#[repr(C)]
pub struct FILE_FS_VOLUME_INFORMATION {
    pub VolumeCreationTime: LARGE_INTEGER,
    pub VolumeSerialNumber: ULONG,
    pub VolumeLabelLength: ULONG,
    pub SupportsObjects: BOOLEAN,
    pub VolumeLabel: [WCHAR; 1],
}

// Layout asserts against the C headers (checked via clang on Windows). Gated on
// `windows` because this crate is also compiled on LP64 targets where
// `c_ulong` is 64-bit, which perturbs these offsets.
#[cfg(windows)]
const _: () = {
    assert!(core::mem::size_of::<FILE_ALL_INFORMATION>() == 104);
    assert!(core::mem::offset_of!(FILE_ALL_INFORMATION, StandardInformation) == 40);
    assert!(core::mem::offset_of!(FILE_ALL_INFORMATION, InternalInformation) == 64);
    assert!(core::mem::offset_of!(FILE_ALL_INFORMATION, CurrentByteOffset) == 80);
    assert!(core::mem::offset_of!(FILE_ALL_INFORMATION, FileNameLength) == 96);
    assert!(core::mem::size_of::<FILE_FS_DEVICE_INFORMATION>() == 8);
    assert!(core::mem::size_of::<FILE_FS_VOLUME_INFORMATION>() == 24);
    assert!(core::mem::offset_of!(FILE_FS_VOLUME_INFORMATION, VolumeSerialNumber) == 8);
};

/// `DEVICE_TYPE` values (`ntddk.h`).
pub const FILE_DEVICE_NAMED_PIPE: ULONG = 0x00000011;
pub const FILE_DEVICE_NULL: ULONG = 0x00000015;
pub const FILE_DEVICE_CONSOLE: ULONG = 0x00000050;

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

// `FILE_RENAME_INFORMATION_EX.Flags` bits (winnt.h).
pub const FILE_RENAME_REPLACE_IF_EXISTS: ULONG = 0x0000_0001;
pub const FILE_RENAME_POSIX_SEMANTICS: ULONG = 0x0000_0002;
pub const FILE_RENAME_IGNORE_READONLY_ATTRIBUTE: ULONG = 0x0000_0040;

// `GetFinalPathNameByHandleW` flag bits (fileapi.h).
pub const FILE_NAME_NORMALIZED: DWORD = 0x0;
pub const VOLUME_NAME_DOS: DWORD = 0x0;
pub const VOLUME_NAME_GUID: DWORD = 0x1;
pub const VOLUME_NAME_NT: DWORD = 0x2;
pub const VOLUME_NAME_NONE: DWORD = 0x4;

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum VolumeName {
    #[default]
    Dos,
    Nt,
    /// `VOLUME_NAME_NONE`: the path relative to the volume root, no device.
    None,
}

#[derive(Copy, Clone, Debug, Default)]
pub struct GetFinalPathNameByHandleFormat {
    pub volume_name: VolumeName,
}

impl FILE_INFORMATION_CLASS {
    pub const FileRenameInformationEx: Self = Self(65);
}

// ──────────────────────────────────────────────────────────────────────────
// ntdll namespace (subset).
// ──────────────────────────────────────────────────────────────────────────
pub mod ntdll {
    use super::*;

    #[link(name = "ntdll")]
    unsafe extern "system" {
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
        /// `NtQueryVolumeInformationFile` (`ntifs.h`) — volume/device
        /// counterpart to `NtQueryInformationFile`.
        pub fn NtQueryVolumeInformationFile(
            FileHandle: HANDLE,
            IoStatusBlock: *mut IO_STATUS_BLOCK,
            FsInformation: *mut c_void,
            Length: ULONG,
            FsInformationClass: FS_INFORMATION_CLASS,
        ) -> NTSTATUS;
        pub fn NtClose(Handle: HANDLE) -> NTSTATUS;

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

        /// `NtQueryInformationProcess` (`winternl.h`). With
        /// `ProcessBasicInformation` (0), fills a [`PROCESS_BASIC_INFORMATION`].
        pub fn NtQueryInformationProcess(
            ProcessHandle: HANDLE,
            ProcessInformationClass: ULONG,
            ProcessInformation: *mut c_void,
            ProcessInformationLength: ULONG,
            ReturnLength: *mut ULONG,
        ) -> NTSTATUS;

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
pub mod user32 {}
/// `advapi32` namespace (subset placeholder; fill in as needed).
pub mod advapi32 {}

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

    #[link(name = "kernel32")]
    unsafe extern "system" {
        /// No preconditions; reads thread-local Win32 error slot.
        pub safe fn GetLastError() -> DWORD;
        /// No preconditions; writes the thread-local Win32 error slot.
        pub safe fn SetLastError(dwErrCode: DWORD);
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
        pub fn GetModuleHandleW(lpModuleName: LPCWSTR) -> HMODULE;
        pub fn VirtualProtect(
            lpAddress: LPVOID,
            dwSize: usize,
            flNewProtect: DWORD,
            lpflOldProtect: *mut DWORD,
        ) -> BOOL;
        pub fn FlushInstructionCache(
            hProcess: HANDLE,
            lpBaseAddress: LPCVOID,
            dwSize: usize,
        ) -> BOOL;
        /// `RtlAddFunctionTable` (`winnt.h`) — kernel32 forwards to ntdll.
        /// `FunctionTable` points at `EntryCount` native RUNTIME_FUNCTION
        /// entries (12 bytes on x64, 8 on ARM64); declared as a raw
        /// pointer so one declaration serves both layouts. Returns BOOLEAN
        /// (u8), not BOOL.
        pub fn RtlAddFunctionTable(
            FunctionTable: *const c_void,
            EntryCount: DWORD,
            BaseAddress: u64,
        ) -> BOOLEAN;
        pub fn GetExitCodeProcess(hProcess: HANDLE, lpExitCode: *mut DWORD) -> BOOL;
        /// `FlushFileBuffers` — fsync(2)-equivalent for HANDLE-backed files.
        pub fn FlushFileBuffers(hFile: HANDLE) -> BOOL;
        /// `SetFileTime` (`fileapi.h`). Any of the three `FILETIME` pointers
        /// may be null to leave that timestamp unchanged.
        pub fn SetFileTime(
            hFile: HANDLE,
            lpCreationTime: *const FILETIME,
            lpLastAccessTime: *const FILETIME,
            lpLastWriteTime: *const FILETIME,
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
    }
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
        CreateFileW, GetCurrentDirectoryW, GetFileAttributesW, GetSystemDirectoryW, GetSystemInfo,
        SYSTEM_INFO, SetCurrentDirectoryW, SetFilePointerEx,
    };
    pub use super::{
        GetConsoleCP, GetConsoleMode, GetConsoleOutputCP, SetConsoleCP, SetConsoleMode,
        SetConsoleOutputCP,
    };
}
pub use kernel32::{GetCurrentProcess, GetExitCodeProcess, GetLastError};

pub const INFINITE: DWORD = 0xFFFF_FFFF;
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
    pub const NOT_IMPLEMENTED: NTSTATUS = NTSTATUS(0xC000_0002);
    pub const NO_MORE_FILES: NTSTATUS = NTSTATUS(0x8000_0006);
    pub const NO_SUCH_FILE: NTSTATUS = NTSTATUS(0xC000_000F);
    /// `STATUS_TIMEOUT` — returned by `NtWaitForSingleObject` /
    /// `RtlWaitOnAddress` when the wait timed out.
    pub const TIMEOUT: NTSTATUS = NTSTATUS(0x0000_0102);
    /// `STATUS_END_OF_FILE` — `NtReadFile` past EOF.
    pub const END_OF_FILE: NTSTATUS = NTSTATUS(0xC000_0011);

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
/// `NT_ERROR` (`ntdef.h`) — severity `== STATUS_SEVERITY_ERROR`. Unlike
/// `!NT_SUCCESS`, this excludes warnings such as `STATUS_BUFFER_OVERFLOW`.
#[inline]
pub const fn NT_ERROR(status: NTSTATUS) -> bool {
    (status.0 >> 30) == 3
}
pub const STATUS_SUCCESS: NTSTATUS = NTSTATUS::SUCCESS;

#[link(name = "ntdll")]
unsafe extern "system" {
    /// Total over `NTSTATUS`; no preconditions.
    pub safe fn RtlNtStatusToDosError(status: NTSTATUS) -> DWORD;
}

/// `ws2_32` — Winsock2 surface (subset).
pub mod ws2_32 {
    use super::*;

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

    #[link(name = "ws2_32")]
    unsafe extern "system" {
        pub fn getaddrinfo(
            node: *const c_char,
            service: *const c_char,
            hints: *const addrinfo,
            res: *mut *mut addrinfo,
        ) -> c_int;
        pub fn freeaddrinfo(ai: *mut addrinfo);
        /// `WSAStartup` (`winsock2.h`). 0 on success; non-zero is a `WSAE*`.
        pub fn WSAStartup(wVersionRequested: u16, lpWSAData: *mut WSADATA) -> c_int;
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

    #[link(name = "ws2_32")]
    unsafe extern "system" {
        /// Raw `WSAGetLastError`. The `Option<SystemErrno>` wrapper lives in `errno`
        /// because `SystemErrno` is a higher-tier type. No preconditions; reads
        /// thread-local Winsock error slot.
        pub safe fn WSAGetLastError() -> c_int;
        /// No preconditions; writes the thread-local Winsock error slot.
        pub safe fn WSASetLastError(err: c_int);
        pub fn closesocket(s: usize) -> c_int;
        pub fn recv(s: usize, buf: *mut c_void, len: c_int, flags: c_int) -> c_int;
        pub fn send(s: usize, buf: *const c_void, len: c_int, flags: c_int) -> c_int;
        /// `WSAPoll` (`winsock2.h`). Returns count of ready fds, 0 on timeout,
        /// or `SOCKET_ERROR` (-1) on failure (`WSAGetLastError` for the code).
        pub fn WSAPoll(fdArray: *mut WSAPOLLFD, fds: u32, timeout: c_int) -> c_int;
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
}
pub use ws2_32::WSAGetLastError;

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
    pub const CRC: Win32Error = Win32Error(23);
    pub const GEN_FAILURE: Win32Error = Win32Error(31);
    pub const SHARING_VIOLATION: Win32Error = Win32Error(32);
    pub const LOCK_VIOLATION: Win32Error = Win32Error(33);
    pub const HANDLE_EOF: Win32Error = Win32Error(38);
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
    /// `WAIT_TIMEOUT` / `ERROR_TIMEOUT` (1460) — `SleepConditionVariableSRW`,
    /// `GetQueuedCompletionStatus`, etc.
    pub const TIMEOUT: Win32Error = Win32Error(1460);
    pub const SYMLINK_NOT_SUPPORTED: Win32Error = Win32Error(1464);
    pub const CANT_ACCESS_FILE: Win32Error = Win32Error(1920);
    pub const CANT_RESOLVE_FILENAME: Win32Error = Win32Error(1921);
    pub const NOT_CONNECTED: Win32Error = Win32Error(2250);
    pub const IO_REISSUE_AS_CACHED: Win32Error = Win32Error(3950);
    pub const INVALID_REPARSE_DATA: Win32Error = Win32Error(4392);

    // — WSA pseudo-variants —
    pub const WSAEINTR: Win32Error = Win32Error(10004);
    pub const WSAEACCES: Win32Error = Win32Error(10013);
    pub const WSAEFAULT: Win32Error = Win32Error(10014);
    pub const WSAEINVAL: Win32Error = Win32Error(10022);
    pub const WSAEMFILE: Win32Error = Win32Error(10024);
    pub const WSAEWOULDBLOCK: Win32Error = Win32Error(10035);
    pub const WSAEALREADY: Win32Error = Win32Error(10037);
    pub const WSAENOTSOCK: Win32Error = Win32Error(10038);
    pub const WSAEMSGSIZE: Win32Error = Win32Error(10040);
    pub const WSAEPROTONOSUPPORT: Win32Error = Win32Error(10043);
    pub const WSAESOCKTNOSUPPORT: Win32Error = Win32Error(10044);
    pub const WSAEOPNOTSUPP: Win32Error = Win32Error(10045);
    pub const WSAEPFNOSUPPORT: Win32Error = Win32Error(10046);
    pub const WSAEAFNOSUPPORT: Win32Error = Win32Error(10047);
    pub const WSAEADDRINUSE: Win32Error = Win32Error(10048);
    pub const WSAEADDRNOTAVAIL: Win32Error = Win32Error(10049);
    pub const WSAENETUNREACH: Win32Error = Win32Error(10051);
    pub const WSAECONNABORTED: Win32Error = Win32Error(10053);
    pub const WSAECONNRESET: Win32Error = Win32Error(10054);
    pub const WSAENOBUFS: Win32Error = Win32Error(10055);
    pub const WSAEISCONN: Win32Error = Win32Error(10056);
    pub const WSAENOTCONN: Win32Error = Win32Error(10057);
    pub const WSAESHUTDOWN: Win32Error = Win32Error(10058);
    pub const WSAETIMEDOUT: Win32Error = Win32Error(10060);
    pub const WSAECONNREFUSED: Win32Error = Win32Error(10061);
    pub const WSAEHOSTUNREACH: Win32Error = Win32Error(10065);
    pub const WSAHOST_NOT_FOUND: Win32Error = Win32Error(11001);
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

    pub fn FindFirstFileW(lpFileName: LPCWSTR, lpFindFileData: *mut WIN32_FIND_DATAW) -> HANDLE;

    pub fn FindClose(hFindFile: HANDLE) -> BOOL;

    pub fn SetCurrentDirectoryW(lpPathName: LPCWSTR) -> BOOL;

    pub fn GetCurrentDirectoryW(nBufferLength: DWORD, lpBuffer: LPWSTR) -> DWORD;

    pub fn GetSystemDirectoryW(lpBuffer: LPWSTR, uSize: DWORD) -> DWORD;

    pub fn GetFileAttributesW(lpFileName: LPCWSTR) -> DWORD;

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

pub const TOKEN_QUERY: DWORD = 0x0008;
/// `TOKEN_INFORMATION_CLASS::TokenIsAppContainer`
pub const TOKEN_IS_APP_CONTAINER: c_int = 29;

#[link(name = "advapi32")]
unsafe extern "system" {
    pub fn SaferiIsExecutableFileType(szFullPathname: LPCWSTR, bFromShellExecute: BOOLEAN) -> BOOL;

    pub fn OpenProcessToken(
        ProcessHandle: HANDLE,
        DesiredAccess: DWORD,
        TokenHandle: *mut HANDLE,
    ) -> BOOL;

    pub fn GetTokenInformation(
        TokenHandle: HANDLE,
        TokenInformationClass: c_int,
        TokenInformation: LPVOID,
        TokenInformationLength: DWORD,
        ReturnLength: *mut DWORD,
    ) -> BOOL;
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

    pub fn SetEnvironmentVariableW(lpName: LPCWSTR, lpValue: LPCWSTR) -> BOOL;

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

/// `WAITORTIMERCALLBACK` (`winnt.h`) — thread-pool callback for
/// `RegisterWaitForSingleObject`. `TimerOrWaitFired` is `TRUE` on timeout.
pub type WAITORTIMERCALLBACK =
    unsafe extern "system" fn(lpParameter: LPVOID, TimerOrWaitFired: BOOLEAN);
/// `WT_EXECUTEONLYONCE` (`winnt.h`) — fire once; caller does not unregister.
pub const WT_EXECUTEONLYONCE: ULONG = 0x0000_0008;

/// `PROCESS_BASIC_INFORMATION` (`winternl.h`). Only
/// `InheritedFromUniqueProcessId` is read; the rest are layout padding.
#[repr(C)]
pub struct PROCESS_BASIC_INFORMATION {
    pub ExitStatus: NTSTATUS,
    pub PebBaseAddress: *mut c_void,
    pub AffinityMask: usize,
    pub BasePriority: i32,
    pub UniqueProcessId: usize,
    pub InheritedFromUniqueProcessId: usize,
}
/// `PROCESSINFOCLASS::ProcessBasicInformation` (`winternl.h`).
pub const ProcessBasicInformation: ULONG = 0;

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

    /// `RegisterWaitForSingleObject` (`winbase.h`). Queues `Callback` to the
    /// system thread pool once `hObject` is signaled (or `dwMilliseconds`
    /// elapses). Returns non-zero on success; `*phNewWaitObject` receives the
    /// wait handle.
    pub fn RegisterWaitForSingleObject(
        phNewWaitObject: *mut HANDLE,
        hObject: HANDLE,
        Callback: WAITORTIMERCALLBACK,
        Context: LPVOID,
        dwMilliseconds: ULONG,
        dwFlags: ULONG,
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
