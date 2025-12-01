//! Platform specific APIs for Windows
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

pub const ntdll = windows.ntdll;
pub const kernel32 = windows.kernel32;
pub const GetLastError = kernel32.GetLastError;

pub const PATH_MAX_WIDE = windows.PATH_MAX_WIDE;
pub const MAX_PATH = windows.MAX_PATH;
pub const WORD = windows.WORD;
pub const DWORD = windows.DWORD;
pub const CHAR = windows.CHAR;
pub const BOOL = windows.BOOL;
pub const BOOLEAN = windows.BOOLEAN;
pub const LPVOID = windows.LPVOID;
pub const LPCVOID = windows.LPCVOID;
pub const LPWSTR = windows.LPWSTR;
pub const LPCWSTR = windows.LPCWSTR;
pub const LPSTR = windows.LPSTR;
pub const WCHAR = windows.WCHAR;
pub const LPCSTR = windows.LPCSTR;
pub const PWSTR = windows.PWSTR;
pub const FALSE = windows.FALSE;
pub const TRUE = windows.TRUE;
pub const COORD = windows.COORD;
pub const INVALID_HANDLE_VALUE = windows.INVALID_HANDLE_VALUE;
pub const FILE_BEGIN = windows.FILE_BEGIN;
pub const FILE_END = windows.FILE_END;
pub const FILE_CURRENT = windows.FILE_CURRENT;
pub const ULONG = windows.ULONG;
pub const ULONGLONG = windows.ULONGLONG;
pub const UINT = windows.UINT;
pub const LARGE_INTEGER = windows.LARGE_INTEGER;
pub const UNICODE_STRING = windows.UNICODE_STRING;
pub const NTSTATUS = windows.NTSTATUS;
pub const NT_SUCCESS = windows.NT_SUCCESS;
pub const STATUS_SUCCESS = windows.STATUS_SUCCESS;
pub const MOVEFILE_COPY_ALLOWED = 0x2;
pub const MOVEFILE_REPLACE_EXISTING = 0x1;
pub const MOVEFILE_WRITE_THROUGH = 0x8;
pub const FILETIME = windows.FILETIME;

pub const DUPLICATE_SAME_ACCESS = windows.DUPLICATE_SAME_ACCESS;
pub const OBJECT_ATTRIBUTES = windows.OBJECT_ATTRIBUTES;
pub const IO_STATUS_BLOCK = windows.IO_STATUS_BLOCK;
pub const FILE_INFO_BY_HANDLE_CLASS = windows.FILE_INFO_BY_HANDLE_CLASS;
pub const FILE_SHARE_READ = windows.FILE_SHARE_READ;
pub const FILE_SHARE_WRITE = windows.FILE_SHARE_WRITE;
pub const FILE_SHARE_DELETE = windows.FILE_SHARE_DELETE;
pub const FILE_ATTRIBUTE_NORMAL = windows.FILE_ATTRIBUTE_NORMAL;
pub const FILE_ATTRIBUTE_READONLY = windows.FILE_ATTRIBUTE_READONLY;
pub const FILE_ATTRIBUTE_HIDDEN = windows.FILE_ATTRIBUTE_HIDDEN;
pub const FILE_ATTRIBUTE_SYSTEM = windows.FILE_ATTRIBUTE_SYSTEM;
pub const FILE_ATTRIBUTE_DIRECTORY = windows.FILE_ATTRIBUTE_DIRECTORY;
pub const FILE_ATTRIBUTE_ARCHIVE = windows.FILE_ATTRIBUTE_ARCHIVE;
pub const FILE_ATTRIBUTE_DEVICE = windows.FILE_ATTRIBUTE_DEVICE;
pub const FILE_ATTRIBUTE_TEMPORARY = windows.FILE_ATTRIBUTE_TEMPORARY;
pub const FILE_ATTRIBUTE_SPARSE_FILE = windows.FILE_ATTRIBUTE_SPARSE_FILE;
pub const FILE_ATTRIBUTE_REPARSE_POINT = windows.FILE_ATTRIBUTE_REPARSE_POINT;
pub const FILE_ATTRIBUTE_COMPRESSED = windows.FILE_ATTRIBUTE_COMPRESSED;
pub const FILE_ATTRIBUTE_OFFLINE = windows.FILE_ATTRIBUTE_OFFLINE;
pub const FILE_ATTRIBUTE_NOT_CONTENT_INDEXED = windows.FILE_ATTRIBUTE_NOT_CONTENT_INDEXED;
pub const FILE_DIRECTORY_FILE = windows.FILE_DIRECTORY_FILE;
pub const FILE_WRITE_THROUGH = windows.FILE_WRITE_THROUGH;
pub const FILE_SEQUENTIAL_ONLY = windows.FILE_SEQUENTIAL_ONLY;
pub const FILE_SYNCHRONOUS_IO_NONALERT = windows.FILE_SYNCHRONOUS_IO_NONALERT;
pub const FILE_OPEN_REPARSE_POINT = windows.FILE_OPEN_REPARSE_POINT;
pub const user32 = windows.user32;
pub const advapi32 = windows.advapi32;

pub const INVALID_FILE_ATTRIBUTES: u32 = std.math.maxInt(u32);

pub const nt_object_prefix = [4]u16{ '\\', '?', '?', '\\' };
pub const nt_unc_object_prefix = [8]u16{ '\\', '?', '?', '\\', 'U', 'N', 'C', '\\' };
pub const long_path_prefix = [4]u16{ '\\', '\\', '?', '\\' };

pub const nt_object_prefix_u8 = [4]u8{ '\\', '?', '?', '\\' };
pub const nt_unc_object_prefix_u8 = [8]u8{ '\\', '?', '?', '\\', 'U', 'N', 'C', '\\' };
pub const long_path_prefix_u8 = [4]u8{ '\\', '\\', '?', '\\' };

pub const PathBuffer = if (Environment.isWindows) bun.PathBuffer else void;
pub const WPathBuffer = if (Environment.isWindows) bun.WPathBuffer else void;

pub const HANDLE = win32.HANDLE;
pub const HMODULE = win32.HMODULE;

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle
pub extern "kernel32" fn GetFileInformationByHandle(
    hFile: HANDLE,
    lpFileInformation: *windows.BY_HANDLE_FILE_INFORMATION,
) callconv(.winapi) BOOL;

pub extern "kernel32" fn CommandLineToArgvW(
    lpCmdLine: win32.LPCWSTR,
    pNumArgs: *c_int,
) callconv(.winapi) ?[*]win32.LPWSTR;

pub fn GetFileType(hFile: win32.HANDLE) win32.DWORD {
    const function = struct {
        pub extern fn GetFileType(
            hFile: win32.HANDLE,
        ) callconv(.winapi) win32.DWORD;
    }.GetFileType;

    const rc = function(hFile);
    if (comptime Environment.enable_logs)
        bun.sys.syslog("GetFileType({f}) = {d}", .{ bun.FD.fromNative(hFile), rc });
    return rc;
}

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfiletype#return-value
pub const FILE_TYPE_UNKNOWN = 0x0000;
pub const FILE_TYPE_DISK = 0x0001;
pub const FILE_TYPE_CHAR = 0x0002;
pub const FILE_TYPE_PIPE = 0x0003;
pub const FILE_TYPE_REMOTE = 0x8000;

pub const LPDWORD = *win32.DWORD;

pub extern "kernel32" fn GetBinaryTypeW(
    lpApplicationName: win32.LPCWSTR,
    lpBinaryType: LPDWORD,
) callconv(.winapi) win32.BOOL;

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
pub extern "kernel32" fn SetCurrentDirectoryW(
    lpPathName: win32.LPCWSTR,
) callconv(.winapi) win32.BOOL;
pub const SetCurrentDirectory = SetCurrentDirectoryW;
pub extern "ntdll" fn RtlNtStatusToDosError(win32.NTSTATUS) callconv(.winapi) Win32Error;
pub extern "advapi32" fn SaferiIsExecutableFileType(szFullPathname: win32.LPCWSTR, bFromShellExecute: win32.BOOLEAN) callconv(.winapi) win32.BOOL;
// This was originally copied from Zig's standard library
/// Codes are from https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/18d8fbe8-a967-4f1c-ae50-99ca8e491d2d
pub const Win32Error = enum(u16) {
    /// The operation completed successfully.
    SUCCESS = 0,
    /// Incorrect function.
    INVALID_FUNCTION = 1,
    /// The system cannot find the file specified.
    FILE_NOT_FOUND = 2,
    /// The system cannot find the path specified.
    PATH_NOT_FOUND = 3,
    /// The system cannot open the file.
    TOO_MANY_OPEN_FILES = 4,
    /// Access is denied.
    ACCESS_DENIED = 5,
    /// The handle is invalid.
    INVALID_HANDLE = 6,
    /// The storage control blocks were destroyed.
    ARENA_TRASHED = 7,
    /// Not enough storage is available to process this command.
    NOT_ENOUGH_MEMORY = 8,
    /// The storage control block address is invalid.
    INVALID_BLOCK = 9,
    /// The environment is incorrect.
    BAD_ENVIRONMENT = 10,
    /// An attempt was made to load a program with an incorrect format.
    BAD_FORMAT = 11,
    /// The access code is invalid.
    INVALID_ACCESS = 12,
    /// The data is invalid.
    INVALID_DATA = 13,
    /// Not enough storage is available to complete this operation.
    OUTOFMEMORY = 14,
    /// The system cannot find the drive specified.
    INVALID_DRIVE = 15,
    /// The directory cannot be removed.
    CURRENT_DIRECTORY = 16,
    /// The system cannot move the file to a different disk drive.
    NOT_SAME_DEVICE = 17,
    /// There are no more files.
    NO_MORE_FILES = 18,
    /// The media is write protected.
    WRITE_PROTECT = 19,
    /// The system cannot find the device specified.
    BAD_UNIT = 20,
    /// The device is not ready.
    NOT_READY = 21,
    /// The device does not recognize the command.
    BAD_COMMAND = 22,
    /// Data error (cyclic redundancy check).
    CRC = 23,
    /// The program issued a command but the command length is incorrect.
    BAD_LENGTH = 24,
    /// The drive cannot locate a specific area or track on the disk.
    SEEK = 25,
    /// The specified disk or diskette cannot be accessed.
    NOT_DOS_DISK = 26,
    /// The drive cannot find the sector requested.
    SECTOR_NOT_FOUND = 27,
    /// The printer is out of paper.
    OUT_OF_PAPER = 28,
    /// The system cannot write to the specified device.
    WRITE_FAULT = 29,
    /// The system cannot read from the specified device.
    READ_FAULT = 30,
    /// A device attached to the system is not functioning.
    GEN_FAILURE = 31,
    /// The process cannot access the file because it is being used by another process.
    SHARING_VIOLATION = 32,
    /// The process cannot access the file because another process has locked a portion of the file.
    LOCK_VIOLATION = 33,
    /// The wrong diskette is in the drive.
    /// Insert %2 (Volume Serial Number: %3) into drive %1.
    WRONG_DISK = 34,
    /// Too many files opened for sharing.
    SHARING_BUFFER_EXCEEDED = 36,
    /// Reached the end of the file.
    HANDLE_EOF = 38,
    /// The disk is full.
    HANDLE_DISK_FULL = 39,
    /// The request is not supported.
    NOT_SUPPORTED = 50,
    /// Windows cannot find the network path.
    /// Verify that the network path is correct and the destination computer is not busy or turned off.
    /// If Windows still cannot find the network path, contact your network administrator.
    REM_NOT_LIST = 51,
    /// You were not connected because a duplicate name exists on the network.
    /// If joining a domain, go to System in Control Panel to change the computer name and try again.
    /// If joining a workgroup, choose another workgroup name.
    DUP_NAME = 52,
    /// The network path was not found.
    BAD_NETPATH = 53,
    /// The network is busy.
    NETWORK_BUSY = 54,
    /// The specified network resource or device is no longer available.
    DEV_NOT_EXIST = 55,
    /// The network BIOS command limit has been reached.
    TOO_MANY_CMDS = 56,
    /// A network adapter hardware error occurred.
    ADAP_HDW_ERR = 57,
    /// The specified server cannot perform the requested operation.
    BAD_NET_RESP = 58,
    /// An unexpected network error occurred.
    UNEXP_NET_ERR = 59,
    /// The remote adapter is not compatible.
    BAD_REM_ADAP = 60,
    /// The printer queue is full.
    PRINTQ_FULL = 61,
    /// Space to store the file waiting to be printed is not available on the server.
    NO_SPOOL_SPACE = 62,
    /// Your file waiting to be printed was deleted.
    PRINT_CANCELLED = 63,
    /// The specified network name is no longer available.
    NETNAME_DELETED = 64,
    /// Network access is denied.
    NETWORK_ACCESS_DENIED = 65,
    /// The network resource type is not correct.
    BAD_DEV_TYPE = 66,
    /// The network name cannot be found.
    BAD_NET_NAME = 67,
    /// The name limit for the local computer network adapter card was exceeded.
    TOO_MANY_NAMES = 68,
    /// The network BIOS session limit was exceeded.
    TOO_MANY_SESS = 69,
    /// The remote server has been paused or is in the process of being started.
    SHARING_PAUSED = 70,
    /// No more connections can be made to this remote computer at this time because there are already as many connections as the computer can accept.
    REQ_NOT_ACCEP = 71,
    /// The specified printer or disk device has been paused.
    REDIR_PAUSED = 72,
    /// The file exists.
    FILE_EXISTS = 80,
    /// The directory or file cannot be created.
    CANNOT_MAKE = 82,
    /// Fail on INT 24.
    FAIL_I24 = 83,
    /// Storage to process this request is not available.
    OUT_OF_STRUCTURES = 84,
    /// The local device name is already in use.
    ALREADY_ASSIGNED = 85,
    /// The specified network password is not correct.
    INVALID_PASSWORD = 86,
    /// The parameter is incorrect.
    INVALID_PARAMETER = 87,
    /// A write fault occurred on the network.
    NET_WRITE_FAULT = 88,
    /// The system cannot start another process at this time.
    NO_PROC_SLOTS = 89,
    /// Cannot create another system semaphore.
    TOO_MANY_SEMAPHORES = 100,
    /// The exclusive semaphore is owned by another process.
    EXCL_SEM_ALREADY_OWNED = 101,
    /// The semaphore is set and cannot be closed.
    SEM_IS_SET = 102,
    /// The semaphore cannot be set again.
    TOO_MANY_SEM_REQUESTS = 103,
    /// Cannot request exclusive semaphores at interrupt time.
    INVALID_AT_INTERRUPT_TIME = 104,
    /// The previous ownership of this semaphore has ended.
    SEM_OWNER_DIED = 105,
    /// Insert the diskette for drive %1.
    SEM_USER_LIMIT = 106,
    /// The program stopped because an alternate diskette was not inserted.
    DISK_CHANGE = 107,
    /// The disk is in use or locked by another process.
    DRIVE_LOCKED = 108,
    /// The pipe has been ended.
    BROKEN_PIPE = 109,
    /// The system cannot open the device or file specified.
    OPEN_FAILED = 110,
    /// The file name is too long.
    BUFFER_OVERFLOW = 111,
    /// There is not enough space on the disk.
    DISK_FULL = 112,
    /// No more internal file identifiers available.
    NO_MORE_SEARCH_HANDLES = 113,
    /// The target internal file identifier is incorrect.
    INVALID_TARGET_HANDLE = 114,
    /// The IOCTL call made by the application program is not correct.
    INVALID_CATEGORY = 117,
    /// The verify-on-write switch parameter value is not correct.
    INVALID_VERIFY_SWITCH = 118,
    /// The system does not support the command requested.
    BAD_DRIVER_LEVEL = 119,
    /// This function is not supported on this system.
    CALL_NOT_IMPLEMENTED = 120,
    /// The semaphore timeout period has expired.
    SEM_TIMEOUT = 121,
    /// The data area passed to a system call is too small.
    INSUFFICIENT_BUFFER = 122,
    /// The filename, directory name, or volume label syntax is incorrect.
    INVALID_NAME = 123,
    /// The system call level is not correct.
    INVALID_LEVEL = 124,
    /// The disk has no volume label.
    NO_VOLUME_LABEL = 125,
    /// The specified module could not be found.
    MOD_NOT_FOUND = 126,
    /// The specified procedure could not be found.
    PROC_NOT_FOUND = 127,
    /// There are no child processes to wait for.
    WAIT_NO_CHILDREN = 128,
    /// The %1 application cannot be run in Win32 mode.
    CHILD_NOT_COMPLETE = 129,
    /// Attempt to use a file handle to an open disk partition for an operation other than raw disk I/O.
    DIRECT_ACCESS_HANDLE = 130,
    /// An attempt was made to move the file pointer before the beginning of the file.
    NEGATIVE_SEEK = 131,
    /// The file pointer cannot be set on the specified device or file.
    SEEK_ON_DEVICE = 132,
    /// A JOIN or SUBST command cannot be used for a drive that contains previously joined drives.
    IS_JOIN_TARGET = 133,
    /// An attempt was made to use a JOIN or SUBST command on a drive that has already been joined.
    IS_JOINED = 134,
    /// An attempt was made to use a JOIN or SUBST command on a drive that has already been substituted.
    IS_SUBSTED = 135,
    /// The system tried to delete the JOIN of a drive that is not joined.
    NOT_JOINED = 136,
    /// The system tried to delete the substitution of a drive that is not substituted.
    NOT_SUBSTED = 137,
    /// The system tried to join a drive to a directory on a joined drive.
    JOIN_TO_JOIN = 138,
    /// The system tried to substitute a drive to a directory on a substituted drive.
    SUBST_TO_SUBST = 139,
    /// The system tried to join a drive to a directory on a substituted drive.
    JOIN_TO_SUBST = 140,
    /// The system tried to SUBST a drive to a directory on a joined drive.
    SUBST_TO_JOIN = 141,
    /// The system cannot perform a JOIN or SUBST at this time.
    BUSY_DRIVE = 142,
    /// The system cannot join or substitute a drive to or for a directory on the same drive.
    SAME_DRIVE = 143,
    /// The directory is not a subdirectory of the root directory.
    DIR_NOT_ROOT = 144,
    /// The directory is not empty.
    DIR_NOT_EMPTY = 145,
    /// The path specified is being used in a substitute.
    IS_SUBST_PATH = 146,
    /// Not enough resources are available to process this command.
    IS_JOIN_PATH = 147,
    /// The path specified cannot be used at this time.
    PATH_BUSY = 148,
    /// An attempt was made to join or substitute a drive for which a directory on the drive is the target of a previous substitute.
    IS_SUBST_TARGET = 149,
    /// System trace information was not specified in your CONFIG.SYS file, or tracing is disallowed.
    SYSTEM_TRACE = 150,
    /// The number of specified semaphore events for DosMuxSemWait is not correct.
    INVALID_EVENT_COUNT = 151,
    /// DosMuxSemWait did not execute; too many semaphores are already set.
    TOO_MANY_MUXWAITERS = 152,
    /// The DosMuxSemWait list is not correct.
    INVALID_LIST_FORMAT = 153,
    /// The volume label you entered exceeds the label character limit of the target file system.
    LABEL_TOO_LONG = 154,
    /// Cannot create another thread.
    TOO_MANY_TCBS = 155,
    /// The recipient process has refused the signal.
    SIGNAL_REFUSED = 156,
    /// The segment is already discarded and cannot be locked.
    DISCARDED = 157,
    /// The segment is already unlocked.
    NOT_LOCKED = 158,
    /// The address for the thread ID is not correct.
    BAD_THREADID_ADDR = 159,
    /// One or more arguments are not correct.
    BAD_ARGUMENTS = 160,
    /// The specified path is invalid.
    BAD_PATHNAME = 161,
    /// A signal is already pending.
    SIGNAL_PENDING = 162,
    /// No more threads can be created in the system.
    MAX_THRDS_REACHED = 164,
    /// Unable to lock a region of a file.
    LOCK_FAILED = 167,
    /// The requested resource is in use.
    BUSY = 170,
    /// Device's command support detection is in progress.
    DEVICE_SUPPORT_IN_PROGRESS = 171,
    /// A lock request was not outstanding for the supplied cancel region.
    CANCEL_VIOLATION = 173,
    /// The file system does not support atomic changes to the lock type.
    ATOMIC_LOCKS_NOT_SUPPORTED = 174,
    /// The system detected a segment number that was not correct.
    INVALID_SEGMENT_NUMBER = 180,
    /// The operating system cannot run %1.
    INVALID_ORDINAL = 182,
    /// Cannot create a file when that file already exists.
    ALREADY_EXISTS = 183,
    /// The flag passed is not correct.
    INVALID_FLAG_NUMBER = 186,
    /// The specified system semaphore name was not found.
    SEM_NOT_FOUND = 187,
    /// The operating system cannot run %1.
    INVALID_STARTING_CODESEG = 188,
    /// The operating system cannot run %1.
    INVALID_STACKSEG = 189,
    /// The operating system cannot run %1.
    INVALID_MODULETYPE = 190,
    /// Cannot run %1 in Win32 mode.
    INVALID_EXE_SIGNATURE = 191,
    /// The operating system cannot run %1.
    EXE_MARKED_INVALID = 192,
    /// %1 is not a valid Win32 application.
    BAD_EXE_FORMAT = 193,
    /// The operating system cannot run %1.
    ITERATED_DATA_EXCEEDS_64k = 194,
    /// The operating system cannot run %1.
    INVALID_MINALLOCSIZE = 195,
    /// The operating system cannot run this application program.
    DYNLINK_FROM_INVALID_RING = 196,
    /// The operating system is not presently configured to run this application.
    IOPL_NOT_ENABLED = 197,
    /// The operating system cannot run %1.
    INVALID_SEGDPL = 198,
    /// The operating system cannot run this application program.
    AUTODATASEG_EXCEEDS_64k = 199,
    /// The code segment cannot be greater than or equal to 64K.
    RING2SEG_MUST_BE_MOVABLE = 200,
    /// The operating system cannot run %1.
    RELOC_CHAIN_XEEDS_SEGLIM = 201,
    /// The operating system cannot run %1.
    INFLOOP_IN_RELOC_CHAIN = 202,
    /// The system could not find the environment option that was entered.
    ENVVAR_NOT_FOUND = 203,
    /// No process in the command subtree has a signal handler.
    NO_SIGNAL_SENT = 205,
    /// The filename or extension is too long.
    FILENAME_EXCED_RANGE = 206,
    /// The ring 2 stack is in use.
    RING2_STACK_IN_USE = 207,
    /// The global filename characters, * or ?, are entered incorrectly or too many global filename characters are specified.
    META_EXPANSION_TOO_LONG = 208,
    /// The signal being posted is not correct.
    INVALID_SIGNAL_NUMBER = 209,
    /// The signal handler cannot be set.
    THREAD_1_INACTIVE = 210,
    /// The segment is locked and cannot be reallocated.
    LOCKED = 212,
    /// Too many dynamic-link modules are attached to this program or dynamic-link module.
    TOO_MANY_MODULES = 214,
    /// Cannot nest calls to LoadModule.
    NESTING_NOT_ALLOWED = 215,
    /// This version of %1 is not compatible with the version of Windows you're running.
    /// Check your computer's system information and then contact the software publisher.
    EXE_MACHINE_TYPE_MISMATCH = 216,
    /// The image file %1 is signed, unable to modify.
    EXE_CANNOT_MODIFY_SIGNED_BINARY = 217,
    /// The image file %1 is strong signed, unable to modify.
    EXE_CANNOT_MODIFY_STRONG_SIGNED_BINARY = 218,
    /// This file is checked out or locked for editing by another user.
    FILE_CHECKED_OUT = 220,
    /// The file must be checked out before saving changes.
    CHECKOUT_REQUIRED = 221,
    /// The file type being saved or retrieved has been blocked.
    BAD_FILE_TYPE = 222,
    /// The file size exceeds the limit allowed and cannot be saved.
    FILE_TOO_LARGE = 223,
    /// Access Denied. Before opening files in this location, you must first add the web site to your trusted sites list, browse to the web site, and select the option to login automatically.
    FORMS_AUTH_REQUIRED = 224,
    /// Operation did not complete successfully because the file contains a virus or potentially unwanted software.
    VIRUS_INFECTED = 225,
    /// This file contains a virus or potentially unwanted software and cannot be opened.
    /// Due to the nature of this virus or potentially unwanted software, the file has been removed from this location.
    VIRUS_DELETED = 226,
    /// The pipe is local.
    PIPE_LOCAL = 229,
    /// The pipe state is invalid.
    BAD_PIPE = 230,
    /// All pipe instances are busy.
    PIPE_BUSY = 231,
    /// The pipe is being closed.
    NO_DATA = 232,
    /// No process is on the other end of the pipe.
    PIPE_NOT_CONNECTED = 233,
    /// More data is available.
    MORE_DATA = 234,
    /// The session was canceled.
    VC_DISCONNECTED = 240,
    /// The specified extended attribute name was invalid.
    INVALID_EA_NAME = 254,
    /// The extended attributes are inconsistent.
    EA_LIST_INCONSISTENT = 255,
    /// The wait operation timed out.
    IMEOUT = 258,
    /// No more data is available.
    NO_MORE_ITEMS = 259,
    /// The copy functions cannot be used.
    CANNOT_COPY = 266,
    /// The directory name is invalid.
    DIRECTORY = 267,
    /// The extended attributes did not fit in the buffer.
    EAS_DIDNT_FIT = 275,
    /// The extended attribute file on the mounted file system is corrupt.
    EA_FILE_CORRUPT = 276,
    /// The extended attribute table file is full.
    EA_TABLE_FULL = 277,
    /// The specified extended attribute handle is invalid.
    INVALID_EA_HANDLE = 278,
    /// The mounted file system does not support extended attributes.
    EAS_NOT_SUPPORTED = 282,
    /// Attempt to release mutex not owned by caller.
    NOT_OWNER = 288,
    /// Too many posts were made to a semaphore.
    TOO_MANY_POSTS = 298,
    /// Only part of a ReadProcessMemory or WriteProcessMemory request was completed.
    PARTIAL_COPY = 299,
    /// The oplock request is denied.
    OPLOCK_NOT_GRANTED = 300,
    /// An invalid oplock acknowledgment was received by the system.
    INVALID_OPLOCK_PROTOCOL = 301,
    /// The volume is too fragmented to complete this operation.
    DISK_TOO_FRAGMENTED = 302,
    /// The file cannot be opened because it is in the process of being deleted.
    DELETE_PENDING = 303,
    /// Short name settings may not be changed on this volume due to the global registry setting.
    INCOMPATIBLE_WITH_GLOBAL_SHORT_NAME_REGISTRY_SETTING = 304,
    /// Short names are not enabled on this volume.
    SHORT_NAMES_NOT_ENABLED_ON_VOLUME = 305,
    /// The security stream for the given volume is in an inconsistent state. Please run CHKDSK on the volume.
    SECURITY_STREAM_IS_INCONSISTENT = 306,
    /// A requested file lock operation cannot be processed due to an invalid byte range.
    INVALID_LOCK_RANGE = 307,
    /// The subsystem needed to support the image type is not present.
    IMAGE_SUBSYSTEM_NOT_PRESENT = 308,
    /// The specified file already has a notification GUID associated with it.
    NOTIFICATION_GUID_ALREADY_DEFINED = 309,
    /// An invalid exception handler routine has been detected.
    INVALID_EXCEPTION_HANDLER = 310,
    /// Duplicate privileges were specified for the token.
    DUPLICATE_PRIVILEGES = 311,
    /// No ranges for the specified operation were able to be processed.
    NO_RANGES_PROCESSED = 312,
    /// Operation is not allowed on a file system internal file.
    NOT_ALLOWED_ON_SYSTEM_FILE = 313,
    /// The physical resources of this disk have been exhausted.
    DISK_RESOURCES_EXHAUSTED = 314,
    /// The token representing the data is invalid.
    INVALID_TOKEN = 315,
    /// The device does not support the command feature.
    DEVICE_FEATURE_NOT_SUPPORTED = 316,
    /// The system cannot find message text for message number 0x%1 in the message file for %2.
    MR_MID_NOT_FOUND = 317,
    /// The scope specified was not found.
    SCOPE_NOT_FOUND = 318,
    /// The Central Access Policy specified is not defined on the target machine.
    UNDEFINED_SCOPE = 319,
    /// The Central Access Policy obtained from Active Directory is invalid.
    INVALID_CAP = 320,
    /// The device is unreachable.
    DEVICE_UNREACHABLE = 321,
    /// The target device has insufficient resources to complete the operation.
    DEVICE_NO_RESOURCES = 322,
    /// A data integrity checksum error occurred. Data in the file stream is corrupt.
    DATA_CHECKSUM_ERROR = 323,
    /// An attempt was made to modify both a KERNEL and normal Extended Attribute (EA) in the same operation.
    INTERMIXED_KERNEL_EA_OPERATION = 324,
    /// Device does not support file-level TRIM.
    FILE_LEVEL_TRIM_NOT_SUPPORTED = 326,
    /// The command specified a data offset that does not align to the device's granularity/alignment.
    OFFSET_ALIGNMENT_VIOLATION = 327,
    /// The command specified an invalid field in its parameter list.
    INVALID_FIELD_IN_PARAMETER_LIST = 328,
    /// An operation is currently in progress with the device.
    OPERATION_IN_PROGRESS = 329,
    /// An attempt was made to send down the command via an invalid path to the target device.
    BAD_DEVICE_PATH = 330,
    /// The command specified a number of descriptors that exceeded the maximum supported by the device.
    TOO_MANY_DESCRIPTORS = 331,
    /// Scrub is disabled on the specified file.
    SCRUB_DATA_DISABLED = 332,
    /// The storage device does not provide redundancy.
    NOT_REDUNDANT_STORAGE = 333,
    /// An operation is not supported on a resident file.
    RESIDENT_FILE_NOT_SUPPORTED = 334,
    /// An operation is not supported on a compressed file.
    COMPRESSED_FILE_NOT_SUPPORTED = 335,
    /// An operation is not supported on a directory.
    DIRECTORY_NOT_SUPPORTED = 336,
    /// The specified copy of the requested data could not be read.
    NOT_READ_FROM_COPY = 337,
    /// No action was taken as a system reboot is required.
    FAIL_NOACTION_REBOOT = 350,
    /// The shutdown operation failed.
    FAIL_SHUTDOWN = 351,
    /// The restart operation failed.
    FAIL_RESTART = 352,
    /// The maximum number of sessions has been reached.
    MAX_SESSIONS_REACHED = 353,
    /// The thread is already in background processing mode.
    THREAD_MODE_ALREADY_BACKGROUND = 400,
    /// The thread is not in background processing mode.
    THREAD_MODE_NOT_BACKGROUND = 401,
    /// The process is already in background processing mode.
    PROCESS_MODE_ALREADY_BACKGROUND = 402,
    /// The process is not in background processing mode.
    PROCESS_MODE_NOT_BACKGROUND = 403,
    /// Attempt to access invalid address.
    INVALID_ADDRESS = 487,
    /// User profile cannot be loaded.
    USER_PROFILE_LOAD = 500,
    /// Arithmetic result exceeded 32 bits.
    ARITHMETIC_OVERFLOW = 534,
    /// There is a process on other end of the pipe.
    PIPE_CONNECTED = 535,
    /// Waiting for a process to open the other end of the pipe.
    PIPE_LISTENING = 536,
    /// Application verifier has found an error in the current process.
    VERIFIER_STOP = 537,
    /// An error occurred in the ABIOS subsystem.
    ABIOS_ERROR = 538,
    /// A warning occurred in the WX86 subsystem.
    WX86_WARNING = 539,
    /// An error occurred in the WX86 subsystem.
    WX86_ERROR = 540,
    /// An attempt was made to cancel or set a timer that has an associated APC and the subject thread is not the thread that originally set the timer with an associated APC routine.
    TIMER_NOT_CANCELED = 541,
    /// Unwind exception code.
    UNWIND = 542,
    /// An invalid or unaligned stack was encountered during an unwind operation.
    BAD_STACK = 543,
    /// An invalid unwind target was encountered during an unwind operation.
    INVALID_UNWIND_TARGET = 544,
    /// Invalid Object Attributes specified to NtCreatePort or invalid Port Attributes specified to NtConnectPort
    INVALID_PORT_ATTRIBUTES = 545,
    /// Length of message passed to NtRequestPort or NtRequestWaitReplyPort was longer than the maximum message allowed by the port.
    PORT_MESSAGE_TOO_LONG = 546,
    /// An attempt was made to lower a quota limit below the current usage.
    INVALID_QUOTA_LOWER = 547,
    /// An attempt was made to attach to a device that was already attached to another device.
    DEVICE_ALREADY_ATTACHED = 548,
    /// An attempt was made to execute an instruction at an unaligned address and the host system does not support unaligned instruction references.
    INSTRUCTION_MISALIGNMENT = 549,
    /// Profiling not started.
    PROFILING_NOT_STARTED = 550,
    /// Profiling not stopped.
    PROFILING_NOT_STOPPED = 551,
    /// The passed ACL did not contain the minimum required information.
    COULD_NOT_INTERPRET = 552,
    /// The number of active profiling objects is at the maximum and no more may be started.
    PROFILING_AT_LIMIT = 553,
    /// Used to indicate that an operation cannot continue without blocking for I/O.
    CANT_WAIT = 554,
    /// Indicates that a thread attempted to terminate itself by default (called NtTerminateThread with NULL) and it was the last thread in the current process.
    CANT_TERMINATE_SELF = 555,
    /// If an MM error is returned which is not defined in the standard FsRtl filter, it is converted to one of the following errors which is guaranteed to be in the filter.
    /// In this case information is lost, however, the filter correctly handles the exception.
    UNEXPECTED_MM_CREATE_ERR = 556,
    /// If an MM error is returned which is not defined in the standard FsRtl filter, it is converted to one of the following errors which is guaranteed to be in the filter.
    /// In this case information is lost, however, the filter correctly handles the exception.
    UNEXPECTED_MM_MAP_ERROR = 557,
    /// If an MM error is returned which is not defined in the standard FsRtl filter, it is converted to one of the following errors which is guaranteed to be in the filter.
    /// In this case information is lost, however, the filter correctly handles the exception.
    UNEXPECTED_MM_EXTEND_ERR = 558,
    /// A malformed function table was encountered during an unwind operation.
    BAD_FUNCTION_TABLE = 559,
    /// Indicates that an attempt was made to assign protection to a file system file or directory and one of the SIDs in the security descriptor could not be translated into a GUID that could be stored by the file system.
    /// This causes the protection attempt to fail, which may cause a file creation attempt to fail.
    NO_GUID_TRANSLATION = 560,
    /// Indicates that an attempt was made to grow an LDT by setting its size, or that the size was not an even number of selectors.
    INVALID_LDT_SIZE = 561,
    /// Indicates that the starting value for the LDT information was not an integral multiple of the selector size.
    INVALID_LDT_OFFSET = 563,
    /// Indicates that the user supplied an invalid descriptor when trying to set up Ldt descriptors.
    INVALID_LDT_DESCRIPTOR = 564,
    /// Indicates a process has too many threads to perform the requested action.
    /// For example, assignment of a primary token may only be performed when a process has zero or one threads.
    TOO_MANY_THREADS = 565,
    /// An attempt was made to operate on a thread within a specific process, but the thread specified is not in the process specified.
    THREAD_NOT_IN_PROCESS = 566,
    /// Page file quota was exceeded.
    PAGEFILE_QUOTA_EXCEEDED = 567,
    /// The Netlogon service cannot start because another Netlogon service running in the domain conflicts with the specified role.
    LOGON_SERVER_CONFLICT = 568,
    /// The SAM database on a Windows Server is significantly out of synchronization with the copy on the Domain Controller. A complete synchronization is required.
    SYNCHRONIZATION_REQUIRED = 569,
    /// The NtCreateFile API failed. This error should never be returned to an application, it is a place holder for the Windows Lan Manager Redirector to use in its internal error mapping routines.
    NET_OPEN_FAILED = 570,
    /// {Privilege Failed} The I/O permissions for the process could not be changed.
    IO_PRIVILEGE_FAILED = 571,
    /// {Application Exit by CTRL+C} The application terminated as a result of a CTRL+C.
    CONTROL_C_EXIT = 572,
    /// {Missing System File} The required system file %hs is bad or missing.
    MISSING_SYSTEMFILE = 573,
    /// {Application Error} The exception %s (0x%08lx) occurred in the application at location 0x%08lx.
    UNHANDLED_EXCEPTION = 574,
    /// {Application Error} The application was unable to start correctly (0x%lx). Click OK to close the application.
    APP_INIT_FAILURE = 575,
    /// {Unable to Create Paging File} The creation of the paging file %hs failed (%lx). The requested size was %ld.
    PAGEFILE_CREATE_FAILED = 576,
    /// Windows cannot verify the digital signature for this file.
    /// A recent hardware or software change might have installed a file that is signed incorrectly or damaged, or that might be malicious software from an unknown source.
    INVALID_IMAGE_HASH = 577,
    /// {No Paging File Specified} No paging file was specified in the system configuration.
    NO_PAGEFILE = 578,
    /// {EXCEPTION} A real-mode application issued a floating-point instruction and floating-point hardware is not present.
    ILLEGAL_FLOAT_CONTEXT = 579,
    /// An event pair synchronization operation was performed using the thread specific client/server event pair object, but no event pair object was associated with the thread.
    NO_EVENT_PAIR = 580,
    /// A Windows Server has an incorrect configuration.
    DOMAIN_CTRLR_CONFIG_ERROR = 581,
    /// An illegal character was encountered.
    /// For a multi-byte character set this includes a lead byte without a succeeding trail byte.
    /// For the Unicode character set this includes the characters 0xFFFF and 0xFFFE.
    ILLEGAL_CHARACTER = 582,
    /// The Unicode character is not defined in the Unicode character set installed on the system.
    UNDEFINED_CHARACTER = 583,
    /// The paging file cannot be created on a floppy diskette.
    FLOPPY_VOLUME = 584,
    /// The system BIOS failed to connect a system interrupt to the device or bus for which the device is connected.
    BIOS_FAILED_TO_CONNECT_INTERRUPT = 585,
    /// This operation is only allowed for the Primary Domain Controller of the domain.
    BACKUP_CONTROLLER = 586,
    /// An attempt was made to acquire a mutant such that its maximum count would have been exceeded.
    MUTANT_LIMIT_EXCEEDED = 587,
    /// A volume has been accessed for which a file system driver is required that has not yet been loaded.
    FS_DRIVER_REQUIRED = 588,
    /// {Registry File Failure} The registry cannot load the hive (file): %hs or its log or alternate. It is corrupt, absent, or not writable.
    CANNOT_LOAD_REGISTRY_FILE = 589,
    /// {Unexpected Failure in DebugActiveProcess} An unexpected failure occurred while processing a DebugActiveProcess API request.
    /// You may choose OK to terminate the process, or Cancel to ignore the error.
    DEBUG_ATTACH_FAILED = 590,
    /// {Fatal System Error} The %hs system process terminated unexpectedly with a status of 0x%08x (0x%08x 0x%08x). The system has been shut down.
    SYSTEM_PROCESS_TERMINATED = 591,
    /// {Data Not Accepted} The TDI client could not handle the data received during an indication.
    DATA_NOT_ACCEPTED = 592,
    /// NTVDM encountered a hard error.
    VDM_HARD_ERROR = 593,
    /// {Cancel Timeout} The driver %hs failed to complete a cancelled I/O request in the allotted time.
    DRIVER_CANCEL_TIMEOUT = 594,
    /// {Reply Message Mismatch} An attempt was made to reply to an LPC message, but the thread specified by the client ID in the message was not waiting on that message.
    REPLY_MESSAGE_MISMATCH = 595,
    /// {Delayed Write Failed} Windows was unable to save all the data for the file %hs. The data has been lost.
    /// This error may be caused by a failure of your computer hardware or network connection. Please try to save this file elsewhere.
    LOST_WRITEBEHIND_DATA = 596,
    /// The parameter(s) passed to the server in the client/server shared memory window were invalid.
    /// Too much data may have been put in the shared memory window.
    CLIENT_SERVER_PARAMETERS_INVALID = 597,
    /// The stream is not a tiny stream.
    NOT_TINY_STREAM = 598,
    /// The request must be handled by the stack overflow code.
    STACK_OVERFLOW_READ = 599,
    /// Internal OFS status codes indicating how an allocation operation is handled.
    /// Either it is retried after the containing onode is moved or the extent stream is converted to a large stream.
    CONVERT_TO_LARGE = 600,
    /// The attempt to find the object found an object matching by ID on the volume but it is out of the scope of the handle used for the operation.
    FOUND_OUT_OF_SCOPE = 601,
    /// The bucket array must be grown. Retry transaction after doing so.
    ALLOCATE_BUCKET = 602,
    /// The user/kernel marshalling buffer has overflowed.
    MARSHALL_OVERFLOW = 603,
    /// The supplied variant structure contains invalid data.
    INVALID_VARIANT = 604,
    /// The specified buffer contains ill-formed data.
    BAD_COMPRESSION_BUFFER = 605,
    /// {Audit Failed} An attempt to generate a security audit failed.
    AUDIT_FAILED = 606,
    /// The timer resolution was not previously set by the current process.
    TIMER_RESOLUTION_NOT_SET = 607,
    /// There is insufficient account information to log you on.
    INSUFFICIENT_LOGON_INFO = 608,
    /// {Invalid DLL Entrypoint} The dynamic link library %hs is not written correctly.
    /// The stack pointer has been left in an inconsistent state.
    /// The entrypoint should be declared as WINAPI or STDCALL.
    /// Select YES to fail the DLL load. Select NO to continue execution.
    /// Selecting NO may cause the application to operate incorrectly.
    BAD_DLL_ENTRYPOINT = 609,
    /// {Invalid Service Callback Entrypoint} The %hs service is not written correctly.
    /// The stack pointer has been left in an inconsistent state.
    /// The callback entrypoint should be declared as WINAPI or STDCALL.
    /// Selecting OK will cause the service to continue operation.
    /// However, the service process may operate incorrectly.
    BAD_SERVICE_ENTRYPOINT = 610,
    /// There is an IP address conflict with another system on the network.
    IP_ADDRESS_CONFLICT1 = 611,
    /// There is an IP address conflict with another system on the network.
    IP_ADDRESS_CONFLICT2 = 612,
    /// {Low On Registry Space} The system has reached the maximum size allowed for the system part of the registry. Additional storage requests will be ignored.
    REGISTRY_QUOTA_LIMIT = 613,
    /// A callback return system service cannot be executed when no callback is active.
    NO_CALLBACK_ACTIVE = 614,
    /// The password provided is too short to meet the policy of your user account. Please choose a longer password.
    PWD_TOO_SHORT = 615,
    /// The policy of your user account does not allow you to change passwords too frequently.
    /// This is done to prevent users from changing back to a familiar, but potentially discovered, password.
    /// If you feel your password has been compromised then please contact your administrator immediately to have a new one assigned.
    PWD_TOO_RECENT = 616,
    /// You have attempted to change your password to one that you have used in the past.
    /// The policy of your user account does not allow this.
    /// Please select a password that you have not previously used.
    PWD_HISTORY_CONFLICT = 617,
    /// The specified compression format is unsupported.
    UNSUPPORTED_COMPRESSION = 618,
    /// The specified hardware profile configuration is invalid.
    INVALID_HW_PROFILE = 619,
    /// The specified Plug and Play registry device path is invalid.
    INVALID_PLUGPLAY_DEVICE_PATH = 620,
    /// The specified quota list is internally inconsistent with its descriptor.
    QUOTA_LIST_INCONSISTENT = 621,
    /// {Windows Evaluation Notification} The evaluation period for this installation of Windows has expired. This system will shutdown in 1 hour.
    /// To restore access to this installation of Windows, please upgrade this installation using a licensed distribution of this product.
    EVALUATION_EXPIRATION = 622,
    /// {Illegal System DLL Relocation} The system DLL %hs was relocated in memory. The application will not run properly.
    /// The relocation occurred because the DLL %hs occupied an address range reserved for Windows system DLLs.
    /// The vendor supplying the DLL should be contacted for a new DLL.
    ILLEGAL_DLL_RELOCATION = 623,
    /// {DLL Initialization Failed} The application failed to initialize because the window station is shutting down.
    DLL_INIT_FAILED_LOGOFF = 624,
    /// The validation process needs to continue on to the next step.
    VALIDATE_CONTINUE = 625,
    /// There are no more matches for the current index enumeration.
    NO_MORE_MATCHES = 626,
    /// The range could not be added to the range list because of a conflict.
    RANGE_LIST_CONFLICT = 627,
    /// The server process is running under a SID different than that required by client.
    SERVER_SID_MISMATCH = 628,
    /// A group marked use for deny only cannot be enabled.
    CANT_ENABLE_DENY_ONLY = 629,
    /// {EXCEPTION} Multiple floating point faults.
    FLOAT_MULTIPLE_FAULTS = 630,
    /// {EXCEPTION} Multiple floating point traps.
    FLOAT_MULTIPLE_TRAPS = 631,
    /// The requested interface is not supported.
    NOINTERFACE = 632,
    /// {System Standby Failed} The driver %hs does not support standby mode.
    /// Updating this driver may allow the system to go to standby mode.
    DRIVER_FAILED_SLEEP = 633,
    /// The system file %1 has become corrupt and has been replaced.
    CORRUPT_SYSTEM_FILE = 634,
    /// {Virtual Memory Minimum Too Low} Your system is low on virtual memory.
    /// Windows is increasing the size of your virtual memory paging file.
    /// During this process, memory requests for some applications may be denied. For more information, see Help.
    COMMITMENT_MINIMUM = 635,
    /// A device was removed so enumeration must be restarted.
    PNP_RESTART_ENUMERATION = 636,
    /// {Fatal System Error} The system image %s is not properly signed.
    /// The file has been replaced with the signed file. The system has been shut down.
    SYSTEM_IMAGE_BAD_SIGNATURE = 637,
    /// Device will not start without a reboot.
    PNP_REBOOT_REQUIRED = 638,
    /// There is not enough power to complete the requested operation.
    INSUFFICIENT_POWER = 639,
    /// ERROR_MULTIPLE_FAULT_VIOLATION
    MULTIPLE_FAULT_VIOLATION = 640,
    /// The system is in the process of shutting down.
    SYSTEM_SHUTDOWN = 641,
    /// An attempt to remove a processes DebugPort was made, but a port was not already associated with the process.
    PORT_NOT_SET = 642,
    /// This version of Windows is not compatible with the behavior version of directory forest, domain or domain controller.
    DS_VERSION_CHECK_FAILURE = 643,
    /// The specified range could not be found in the range list.
    RANGE_NOT_FOUND = 644,
    /// The driver was not loaded because the system is booting into safe mode.
    NOT_SAFE_MODE_DRIVER = 646,
    /// The driver was not loaded because it failed its initialization call.
    FAILED_DRIVER_ENTRY = 647,
    /// The "%hs" encountered an error while applying power or reading the device configuration.
    /// This may be caused by a failure of your hardware or by a poor connection.
    DEVICE_ENUMERATION_ERROR = 648,
    /// The create operation failed because the name contained at least one mount point which resolves to a volume to which the specified device object is not attached.
    MOUNT_POINT_NOT_RESOLVED = 649,
    /// The device object parameter is either not a valid device object or is not attached to the volume specified by the file name.
    INVALID_DEVICE_OBJECT_PARAMETER = 650,
    /// A Machine Check Error has occurred.
    /// Please check the system eventlog for additional information.
    MCA_OCCURED = 651,
    /// There was error [%2] processing the driver database.
    DRIVER_DATABASE_ERROR = 652,
    /// System hive size has exceeded its limit.
    SYSTEM_HIVE_TOO_LARGE = 653,
    /// The driver could not be loaded because a previous version of the driver is still in memory.
    DRIVER_FAILED_PRIOR_UNLOAD = 654,
    /// {Volume Shadow Copy Service} Please wait while the Volume Shadow Copy Service prepares volume %hs for hibernation.
    VOLSNAP_PREPARE_HIBERNATE = 655,
    /// The system has failed to hibernate (The error code is %hs).
    /// Hibernation will be disabled until the system is restarted.
    HIBERNATION_FAILURE = 656,
    /// The password provided is too long to meet the policy of your user account. Please choose a shorter password.
    PWD_TOO_LONG = 657,
    /// The requested operation could not be completed due to a file system limitation.
    FILE_SYSTEM_LIMITATION = 665,
    /// An assertion failure has occurred.
    ASSERTION_FAILURE = 668,
    /// An error occurred in the ACPI subsystem.
    ACPI_ERROR = 669,
    /// WOW Assertion Error.
    WOW_ASSERTION = 670,
    /// A device is missing in the system BIOS MPS table. This device will not be used.
    /// Please contact your system vendor for system BIOS update.
    PNP_BAD_MPS_TABLE = 671,
    /// A translator failed to translate resources.
    PNP_TRANSLATION_FAILED = 672,
    /// A IRQ translator failed to translate resources.
    PNP_IRQ_TRANSLATION_FAILED = 673,
    /// Driver %2 returned invalid ID for a child device (%3).
    PNP_INVALID_ID = 674,
    /// {Kernel Debugger Awakened} the system debugger was awakened by an interrupt.
    WAKE_SYSTEM_DEBUGGER = 675,
    /// {Handles Closed} Handles to objects have been automatically closed as a result of the requested operation.
    HANDLES_CLOSED = 676,
    /// {Too Much Information} The specified access control list (ACL) contained more information than was expected.
    EXTRANEOUS_INFORMATION = 677,
    /// This warning level status indicates that the transaction state already exists for the registry sub-tree, but that a transaction commit was previously aborted.
    /// The commit has NOT been completed, but has not been rolled back either (so it may still be committed if desired).
    RXACT_COMMIT_NECESSARY = 678,
    /// {Media Changed} The media may have changed.
    MEDIA_CHECK = 679,
    /// {GUID Substitution} During the translation of a global identifier (GUID) to a Windows security ID (SID), no administratively-defined GUID prefix was found.
    /// A substitute prefix was used, which will not compromise system security.
    /// However, this may provide a more restrictive access than intended.
    GUID_SUBSTITUTION_MADE = 680,
    /// The create operation stopped after reaching a symbolic link.
    STOPPED_ON_SYMLINK = 681,
    /// A long jump has been executed.
    LONGJUMP = 682,
    /// The Plug and Play query operation was not successful.
    PLUGPLAY_QUERY_VETOED = 683,
    /// A frame consolidation has been executed.
    UNWIND_CONSOLIDATE = 684,
    /// {Registry Hive Recovered} Registry hive (file): %hs was corrupted and it has been recovered. Some data might have been lost.
    REGISTRY_HIVE_RECOVERED = 685,
    /// The application is attempting to run executable code from the module %hs. This may be insecure.
    /// An alternative, %hs, is available. Should the application use the secure module %hs?
    DLL_MIGHT_BE_INSECURE = 686,
    /// The application is loading executable code from the module %hs.
    /// This is secure, but may be incompatible with previous releases of the operating system.
    /// An alternative, %hs, is available. Should the application use the secure module %hs?
    DLL_MIGHT_BE_INCOMPATIBLE = 687,
    /// Debugger did not handle the exception.
    DBG_EXCEPTION_NOT_HANDLED = 688,
    /// Debugger will reply later.
    DBG_REPLY_LATER = 689,
    /// Debugger cannot provide handle.
    DBG_UNABLE_TO_PROVIDE_HANDLE = 690,
    /// Debugger terminated thread.
    DBG_TERMINATE_THREAD = 691,
    /// Debugger terminated process.
    DBG_TERMINATE_PROCESS = 692,
    /// Debugger got control C.
    DBG_CONTROL_C = 693,
    /// Debugger printed exception on control C.
    DBG_PRINTEXCEPTION_C = 694,
    /// Debugger received RIP exception.
    DBG_RIPEXCEPTION = 695,
    /// Debugger received control break.
    DBG_CONTROL_BREAK = 696,
    /// Debugger command communication exception.
    DBG_COMMAND_EXCEPTION = 697,
    /// {Object Exists} An attempt was made to create an object and the object name already existed.
    OBJECT_NAME_EXISTS = 698,
    /// {Thread Suspended} A thread termination occurred while the thread was suspended.
    /// The thread was resumed, and termination proceeded.
    THREAD_WAS_SUSPENDED = 699,
    /// {Image Relocated} An image file could not be mapped at the address specified in the image file. Local fixups must be performed on this image.
    IMAGE_NOT_AT_BASE = 700,
    /// This informational level status indicates that a specified registry sub-tree transaction state did not yet exist and had to be created.
    RXACT_STATE_CREATED = 701,
    /// {Segment Load} A virtual DOS machine (VDM) is loading, unloading, or moving an MS-DOS or Win16 program segment image.
    /// An exception is raised so a debugger can load, unload or track symbols and breakpoints within these 16-bit segments.
    SEGMENT_NOTIFICATION = 702,
    /// {Invalid Current Directory} The process cannot switch to the startup current directory %hs.
    /// Select OK to set current directory to %hs, or select CANCEL to exit.
    BAD_CURRENT_DIRECTORY = 703,
    /// {Redundant Read} To satisfy a read request, the NT fault-tolerant file system successfully read the requested data from a redundant copy.
    /// This was done because the file system encountered a failure on a member of the fault-tolerant volume, but was unable to reassign the failing area of the device.
    FT_READ_RECOVERY_FROM_BACKUP = 704,
    /// {Redundant Write} To satisfy a write request, the NT fault-tolerant file system successfully wrote a redundant copy of the information.
    /// This was done because the file system encountered a failure on a member of the fault-tolerant volume, but was not able to reassign the failing area of the device.
    FT_WRITE_RECOVERY = 705,
    /// {Machine Type Mismatch} The image file %hs is valid, but is for a machine type other than the current machine.
    /// Select OK to continue, or CANCEL to fail the DLL load.
    IMAGE_MACHINE_TYPE_MISMATCH = 706,
    /// {Partial Data Received} The network transport returned partial data to its client. The remaining data will be sent later.
    RECEIVE_PARTIAL = 707,
    /// {Expedited Data Received} The network transport returned data to its client that was marked as expedited by the remote system.
    RECEIVE_EXPEDITED = 708,
    /// {Partial Expedited Data Received} The network transport returned partial data to its client and this data was marked as expedited by the remote system. The remaining data will be sent later.
    RECEIVE_PARTIAL_EXPEDITED = 709,
    /// {TDI Event Done} The TDI indication has completed successfully.
    EVENT_DONE = 710,
    /// {TDI Event Pending} The TDI indication has entered the pending state.
    EVENT_PENDING = 711,
    /// Checking file system on %wZ.
    CHECKING_FILE_SYSTEM = 712,
    /// {Fatal Application Exit} %hs.
    FATAL_APP_EXIT = 713,
    /// The specified registry key is referenced by a predefined handle.
    PREDEFINED_HANDLE = 714,
    /// {Page Unlocked} The page protection of a locked page was changed to 'No Access' and the page was unlocked from memory and from the process.
    WAS_UNLOCKED = 715,
    /// %hs
    SERVICE_NOTIFICATION = 716,
    /// {Page Locked} One of the pages to lock was already locked.
    WAS_LOCKED = 717,
    /// Application popup: %1 : %2
    LOG_HARD_ERROR = 718,
    /// ERROR_ALREADY_WIN32
    ALREADY_WIN32 = 719,
    /// {Machine Type Mismatch} The image file %hs is valid, but is for a machine type other than the current machine.
    IMAGE_MACHINE_TYPE_MISMATCH_EXE = 720,
    /// A yield execution was performed and no thread was available to run.
    NO_YIELD_PERFORMED = 721,
    /// The resumable flag to a timer API was ignored.
    TIMER_RESUME_IGNORED = 722,
    /// The arbiter has deferred arbitration of these resources to its parent.
    ARBITRATION_UNHANDLED = 723,
    /// The inserted CardBus device cannot be started because of a configuration error on "%hs".
    CARDBUS_NOT_SUPPORTED = 724,
    /// The CPUs in this multiprocessor system are not all the same revision level.
    /// To use all processors the operating system restricts itself to the features of the least capable processor in the system.
    /// Should problems occur with this system, contact the CPU manufacturer to see if this mix of processors is supported.
    MP_PROCESSOR_MISMATCH = 725,
    /// The system was put into hibernation.
    HIBERNATED = 726,
    /// The system was resumed from hibernation.
    RESUME_HIBERNATION = 727,
    /// Windows has detected that the system firmware (BIOS) was updated [previous firmware date = %2, current firmware date %3].
    FIRMWARE_UPDATED = 728,
    /// A device driver is leaking locked I/O pages causing system degradation.
    /// The system has automatically enabled tracking code in order to try and catch the culprit.
    DRIVERS_LEAKING_LOCKED_PAGES = 729,
    /// The system has awoken.
    WAKE_SYSTEM = 730,
    /// ERROR_WAIT_1
    WAIT_1 = 731,
    /// ERROR_WAIT_2
    WAIT_2 = 732,
    /// ERROR_WAIT_3
    WAIT_3 = 733,
    /// ERROR_WAIT_63
    WAIT_63 = 734,
    /// ERROR_ABANDONED_WAIT_0
    ABANDONED_WAIT_0 = 735,
    /// ERROR_ABANDONED_WAIT_63
    ABANDONED_WAIT_63 = 736,
    /// ERROR_USER_APC
    USER_APC = 737,
    /// ERROR_KERNEL_APC
    KERNEL_APC = 738,
    /// ERROR_ALERTED
    ALERTED = 739,
    /// The requested operation requires elevation.
    ELEVATION_REQUIRED = 740,
    /// A reparse should be performed by the Object Manager since the name of the file resulted in a symbolic link.
    REPARSE = 741,
    /// An open/create operation completed while an oplock break is underway.
    OPLOCK_BREAK_IN_PROGRESS = 742,
    /// A new volume has been mounted by a file system.
    VOLUME_MOUNTED = 743,
    /// This success level status indicates that the transaction state already exists for the registry sub-tree, but that a transaction commit was previously aborted. The commit has now been completed.
    RXACT_COMMITTED = 744,
    /// This indicates that a notify change request has been completed due to closing the handle which made the notify change request.
    NOTIFY_CLEANUP = 745,
    /// {Connect Failure on Primary Transport} An attempt was made to connect to the remote server %hs on the primary transport, but the connection failed.
    /// The computer WAS able to connect on a secondary transport.
    PRIMARY_TRANSPORT_CONNECT_FAILED = 746,
    /// Page fault was a transition fault.
    PAGE_FAULT_TRANSITION = 747,
    /// Page fault was a demand zero fault.
    PAGE_FAULT_DEMAND_ZERO = 748,
    /// Page fault was a demand zero fault.
    PAGE_FAULT_COPY_ON_WRITE = 749,
    /// Page fault was a demand zero fault.
    PAGE_FAULT_GUARD_PAGE = 750,
    /// Page fault was satisfied by reading from a secondary storage device.
    PAGE_FAULT_PAGING_FILE = 751,
    /// Cached page was locked during operation.
    CACHE_PAGE_LOCKED = 752,
    /// Crash dump exists in paging file.
    CRASH_DUMP = 753,
    /// Specified buffer contains all zeros.
    BUFFER_ALL_ZEROS = 754,
    /// A reparse should be performed by the Object Manager since the name of the file resulted in a symbolic link.
    REPARSE_OBJECT = 755,
    /// The device has succeeded a query-stop and its resource requirements have changed.
    RESOURCE_REQUIREMENTS_CHANGED = 756,
    /// The translator has translated these resources into the global space and no further translations should be performed.
    TRANSLATION_COMPLETE = 757,
    /// A process being terminated has no threads to terminate.
    NOTHING_TO_TERMINATE = 758,
    /// The specified process is not part of a job.
    PROCESS_NOT_IN_JOB = 759,
    /// The specified process is part of a job.
    PROCESS_IN_JOB = 760,
    /// {Volume Shadow Copy Service} The system is now ready for hibernation.
    VOLSNAP_HIBERNATE_READY = 761,
    /// A file system or file system filter driver has successfully completed an FsFilter operation.
    FSFILTER_OP_COMPLETED_SUCCESSFULLY = 762,
    /// The specified interrupt vector was already connected.
    INTERRUPT_VECTOR_ALREADY_CONNECTED = 763,
    /// The specified interrupt vector is still connected.
    INTERRUPT_STILL_CONNECTED = 764,
    /// An operation is blocked waiting for an oplock.
    WAIT_FOR_OPLOCK = 765,
    /// Debugger handled exception.
    DBG_EXCEPTION_HANDLED = 766,
    /// Debugger continued.
    DBG_CONTINUE = 767,
    /// An exception occurred in a user mode callback and the kernel callback frame should be removed.
    CALLBACK_POP_STACK = 768,
    /// Compression is disabled for this volume.
    COMPRESSION_DISABLED = 769,
    /// The data provider cannot fetch backwards through a result set.
    CANTFETCHBACKWARDS = 770,
    /// The data provider cannot scroll backwards through a result set.
    CANTSCROLLBACKWARDS = 771,
    /// The data provider requires that previously fetched data is released before asking for more data.
    ROWSNOTRELEASED = 772,
    /// The data provider was not able to interpret the flags set for a column binding in an accessor.
    BAD_ACCESSOR_FLAGS = 773,
    /// One or more errors occurred while processing the request.
    ERRORS_ENCOUNTERED = 774,
    /// The implementation is not capable of performing the request.
    NOT_CAPABLE = 775,
    /// The client of a component requested an operation which is not valid given the state of the component instance.
    REQUEST_OUT_OF_SEQUENCE = 776,
    /// A version number could not be parsed.
    VERSION_PARSE_ERROR = 777,
    /// The iterator's start position is invalid.
    BADSTARTPOSITION = 778,
    /// The hardware has reported an uncorrectable memory error.
    MEMORY_HARDWARE = 779,
    /// The attempted operation required self healing to be enabled.
    DISK_REPAIR_DISABLED = 780,
    /// The Desktop heap encountered an error while allocating session memory.
    /// There is more information in the system event log.
    INSUFFICIENT_RESOURCE_FOR_SPECIFIED_SHARED_SECTION_SIZE = 781,
    /// The system power state is transitioning from %2 to %3.
    SYSTEM_POWERSTATE_TRANSITION = 782,
    /// The system power state is transitioning from %2 to %3 but could enter %4.
    SYSTEM_POWERSTATE_COMPLEX_TRANSITION = 783,
    /// A thread is getting dispatched with MCA EXCEPTION because of MCA.
    MCA_EXCEPTION = 784,
    /// Access to %1 is monitored by policy rule %2.
    ACCESS_AUDIT_BY_POLICY = 785,
    /// Access to %1 has been restricted by your Administrator by policy rule %2.
    ACCESS_DISABLED_NO_SAFER_UI_BY_POLICY = 786,
    /// A valid hibernation file has been invalidated and should be abandoned.
    ABANDON_HIBERFILE = 787,
    /// {Delayed Write Failed} Windows was unable to save all the data for the file %hs; the data has been lost.
    /// This error may be caused by network connectivity issues. Please try to save this file elsewhere.
    LOST_WRITEBEHIND_DATA_NETWORK_DISCONNECTED = 788,
    /// {Delayed Write Failed} Windows was unable to save all the data for the file %hs; the data has been lost.
    /// This error was returned by the server on which the file exists. Please try to save this file elsewhere.
    LOST_WRITEBEHIND_DATA_NETWORK_SERVER_ERROR = 789,
    /// {Delayed Write Failed} Windows was unable to save all the data for the file %hs; the data has been lost.
    /// This error may be caused if the device has been removed or the media is write-protected.
    LOST_WRITEBEHIND_DATA_LOCAL_DISK_ERROR = 790,
    /// The resources required for this device conflict with the MCFG table.
    BAD_MCFG_TABLE = 791,
    /// The volume repair could not be performed while it is online.
    /// Please schedule to take the volume offline so that it can be repaired.
    DISK_REPAIR_REDIRECTED = 792,
    /// The volume repair was not successful.
    DISK_REPAIR_UNSUCCESSFUL = 793,
    /// One of the volume corruption logs is full.
    /// Further corruptions that may be detected won't be logged.
    CORRUPT_LOG_OVERFULL = 794,
    /// One of the volume corruption logs is internally corrupted and needs to be recreated.
    /// The volume may contain undetected corruptions and must be scanned.
    CORRUPT_LOG_CORRUPTED = 795,
    /// One of the volume corruption logs is unavailable for being operated on.
    CORRUPT_LOG_UNAVAILABLE = 796,
    /// One of the volume corruption logs was deleted while still having corruption records in them.
    /// The volume contains detected corruptions and must be scanned.
    CORRUPT_LOG_DELETED_FULL = 797,
    /// One of the volume corruption logs was cleared by chkdsk and no longer contains real corruptions.
    CORRUPT_LOG_CLEARED = 798,
    /// Orphaned files exist on the volume but could not be recovered because no more new names could be created in the recovery directory. Files must be moved from the recovery directory.
    ORPHAN_NAME_EXHAUSTED = 799,
    /// The oplock that was associated with this handle is now associated with a different handle.
    OPLOCK_SWITCHED_TO_NEW_HANDLE = 800,
    /// An oplock of the requested level cannot be granted. An oplock of a lower level may be available.
    CANNOT_GRANT_REQUESTED_OPLOCK = 801,
    /// The operation did not complete successfully because it would cause an oplock to be broken.
    /// The caller has requested that existing oplocks not be broken.
    CANNOT_BREAK_OPLOCK = 802,
    /// The handle with which this oplock was associated has been closed. The oplock is now broken.
    OPLOCK_HANDLE_CLOSED = 803,
    /// The specified access control entry (ACE) does not contain a condition.
    NO_ACE_CONDITION = 804,
    /// The specified access control entry (ACE) contains an invalid condition.
    INVALID_ACE_CONDITION = 805,
    /// Access to the specified file handle has been revoked.
    FILE_HANDLE_REVOKED = 806,
    /// An image file was mapped at a different address from the one specified in the image file but fixups will still be automatically performed on the image.
    IMAGE_AT_DIFFERENT_BASE = 807,
    /// Access to the extended attribute was denied.
    EA_ACCESS_DENIED = 994,
    /// The I/O operation has been aborted because of either a thread exit or an application request.
    OPERATION_ABORTED = 995,
    /// Overlapped I/O event is not in a signaled state.
    IO_INCOMPLETE = 996,
    /// Overlapped I/O operation is in progress.
    IO_PENDING = 997,
    /// Invalid access to memory location.
    NOACCESS = 998,
    /// Error performing inpage operation.
    SWAPERROR = 999,
    /// Recursion too deep; the stack overflowed.
    STACK_OVERFLOW = 1001,
    /// The window cannot act on the sent message.
    INVALID_MESSAGE = 1002,
    /// Cannot complete this function.
    CAN_NOT_COMPLETE = 1003,
    /// Invalid flags.
    INVALID_FLAGS = 1004,
    /// The volume does not contain a recognized file system.
    /// Please make sure that all required file system drivers are loaded and that the volume is not corrupted.
    UNRECOGNIZED_VOLUME = 1005,
    /// The volume for a file has been externally altered so that the opened file is no longer valid.
    FILE_INVALID = 1006,
    /// The requested operation cannot be performed in full-screen mode.
    FULLSCREEN_MODE = 1007,
    /// An attempt was made to reference a token that does not exist.
    NO_TOKEN = 1008,
    /// The configuration registry database is corrupt.
    BADDB = 1009,
    /// The configuration registry key is invalid.
    BADKEY = 1010,
    /// The configuration registry key could not be opened.
    CANTOPEN = 1011,
    /// The configuration registry key could not be read.
    CANTREAD = 1012,
    /// The configuration registry key could not be written.
    CANTWRITE = 1013,
    /// One of the files in the registry database had to be recovered by use of a log or alternate copy. The recovery was successful.
    REGISTRY_RECOVERED = 1014,
    /// The registry is corrupted. The structure of one of the files containing registry data is corrupted, or the system's memory image of the file is corrupted, or the file could not be recovered because the alternate copy or log was absent or corrupted.
    REGISTRY_CORRUPT = 1015,
    /// An I/O operation initiated by the registry failed unrecoverably.
    /// The registry could not read in, or write out, or flush, one of the files that contain the system's image of the registry.
    REGISTRY_IO_FAILED = 1016,
    /// The system has attempted to load or restore a file into the registry, but the specified file is not in a registry file format.
    NOT_REGISTRY_FILE = 1017,
    /// Illegal operation attempted on a registry key that has been marked for deletion.
    KEY_DELETED = 1018,
    /// System could not allocate the required space in a registry log.
    NO_LOG_SPACE = 1019,
    /// Cannot create a symbolic link in a registry key that already has subkeys or values.
    KEY_HAS_CHILDREN = 1020,
    /// Cannot create a stable subkey under a volatile parent key.
    CHILD_MUST_BE_VOLATILE = 1021,
    /// A notify change request is being completed and the information is not being returned in the caller's buffer.
    /// The caller now needs to enumerate the files to find the changes.
    NOTIFY_ENUM_DIR = 1022,
    /// A stop control has been sent to a service that other running services are dependent on.
    DEPENDENT_SERVICES_RUNNING = 1051,
    /// The requested control is not valid for this service.
    INVALID_SERVICE_CONTROL = 1052,
    /// The service did not respond to the start or control request in a timely fashion.
    SERVICE_REQUEST_TIMEOUT = 1053,
    /// A thread could not be created for the service.
    SERVICE_NO_THREAD = 1054,
    /// The service database is locked.
    SERVICE_DATABASE_LOCKED = 1055,
    /// An instance of the service is already running.
    SERVICE_ALREADY_RUNNING = 1056,
    /// The account name is invalid or does not exist, or the password is invalid for the account name specified.
    INVALID_SERVICE_ACCOUNT = 1057,
    /// The service cannot be started, either because it is disabled or because it has no enabled devices associated with it.
    SERVICE_DISABLED = 1058,
    /// Circular service dependency was specified.
    CIRCULAR_DEPENDENCY = 1059,
    /// The specified service does not exist as an installed service.
    SERVICE_DOES_NOT_EXIST = 1060,
    /// The service cannot accept control messages at this time.
    SERVICE_CANNOT_ACCEPT_CTRL = 1061,
    /// The service has not been started.
    SERVICE_NOT_ACTIVE = 1062,
    /// The service process could not connect to the service controller.
    FAILED_SERVICE_CONTROLLER_CONNECT = 1063,
    /// An exception occurred in the service when handling the control request.
    EXCEPTION_IN_SERVICE = 1064,
    /// The database specified does not exist.
    DATABASE_DOES_NOT_EXIST = 1065,
    /// The service has returned a service-specific error code.
    SERVICE_SPECIFIC_ERROR = 1066,
    /// The process terminated unexpectedly.
    PROCESS_ABORTED = 1067,
    /// The dependency service or group failed to start.
    SERVICE_DEPENDENCY_FAIL = 1068,
    /// The service did not start due to a logon failure.
    SERVICE_LOGON_FAILED = 1069,
    /// After starting, the service hung in a start-pending state.
    SERVICE_START_HANG = 1070,
    /// The specified service database lock is invalid.
    INVALID_SERVICE_LOCK = 1071,
    /// The specified service has been marked for deletion.
    SERVICE_MARKED_FOR_DELETE = 1072,
    /// The specified service already exists.
    SERVICE_EXISTS = 1073,
    /// The system is currently running with the last-known-good configuration.
    ALREADY_RUNNING_LKG = 1074,
    /// The dependency service does not exist or has been marked for deletion.
    SERVICE_DEPENDENCY_DELETED = 1075,
    /// The current boot has already been accepted for use as the last-known-good control set.
    BOOT_ALREADY_ACCEPTED = 1076,
    /// No attempts to start the service have been made since the last boot.
    SERVICE_NEVER_STARTED = 1077,
    /// The name is already in use as either a service name or a service display name.
    DUPLICATE_SERVICE_NAME = 1078,
    /// The account specified for this service is different from the account specified for other services running in the same process.
    DIFFERENT_SERVICE_ACCOUNT = 1079,
    /// Failure actions can only be set for Win32 services, not for drivers.
    CANNOT_DETECT_DRIVER_FAILURE = 1080,
    /// This service runs in the same process as the service control manager.
    /// Therefore, the service control manager cannot take action if this service's process terminates unexpectedly.
    CANNOT_DETECT_PROCESS_ABORT = 1081,
    /// No recovery program has been configured for this service.
    NO_RECOVERY_PROGRAM = 1082,
    /// The executable program that this service is configured to run in does not implement the service.
    SERVICE_NOT_IN_EXE = 1083,
    /// This service cannot be started in Safe Mode.
    NOT_SAFEBOOT_SERVICE = 1084,
    /// The physical end of the tape has been reached.
    END_OF_MEDIA = 1100,
    /// A tape access reached a filemark.
    FILEMARK_DETECTED = 1101,
    /// The beginning of the tape or a partition was encountered.
    BEGINNING_OF_MEDIA = 1102,
    /// A tape access reached the end of a set of files.
    SETMARK_DETECTED = 1103,
    /// No more data is on the tape.
    NO_DATA_DETECTED = 1104,
    /// Tape could not be partitioned.
    PARTITION_FAILURE = 1105,
    /// When accessing a new tape of a multivolume partition, the current block size is incorrect.
    INVALID_BLOCK_LENGTH = 1106,
    /// Tape partition information could not be found when loading a tape.
    DEVICE_NOT_PARTITIONED = 1107,
    /// Unable to lock the media eject mechanism.
    UNABLE_TO_LOCK_MEDIA = 1108,
    /// Unable to unload the media.
    UNABLE_TO_UNLOAD_MEDIA = 1109,
    /// The media in the drive may have changed.
    MEDIA_CHANGED = 1110,
    /// The I/O bus was reset.
    BUS_RESET = 1111,
    /// No media in drive.
    NO_MEDIA_IN_DRIVE = 1112,
    /// No mapping for the Unicode character exists in the target multi-byte code page.
    NO_UNICODE_TRANSLATION = 1113,
    /// A dynamic link library (DLL) initialization routine failed.
    DLL_INIT_FAILED = 1114,
    /// A system shutdown is in progress.
    SHUTDOWN_IN_PROGRESS = 1115,
    /// Unable to abort the system shutdown because no shutdown was in progress.
    NO_SHUTDOWN_IN_PROGRESS = 1116,
    /// The request could not be performed because of an I/O device error.
    IO_DEVICE = 1117,
    /// No serial device was successfully initialized. The serial driver will unload.
    SERIAL_NO_DEVICE = 1118,
    /// Unable to open a device that was sharing an interrupt request (IRQ) with other devices.
    /// At least one other device that uses that IRQ was already opened.
    IRQ_BUSY = 1119,
    /// A serial I/O operation was completed by another write to the serial port. The IOCTL_SERIAL_XOFF_COUNTER reached zero.)
    MORE_WRITES = 1120,
    /// A serial I/O operation completed because the timeout period expired.
    /// The IOCTL_SERIAL_XOFF_COUNTER did not reach zero.)
    COUNTER_TIMEOUT = 1121,
    /// No ID address mark was found on the floppy disk.
    FLOPPY_ID_MARK_NOT_FOUND = 1122,
    /// Mismatch between the floppy disk sector ID field and the floppy disk controller track address.
    FLOPPY_WRONG_CYLINDER = 1123,
    /// The floppy disk controller reported an error that is not recognized by the floppy disk driver.
    FLOPPY_UNKNOWN_ERROR = 1124,
    /// The floppy disk controller returned inconsistent results in its registers.
    FLOPPY_BAD_REGISTERS = 1125,
    /// While accessing the hard disk, a recalibrate operation failed, even after retries.
    DISK_RECALIBRATE_FAILED = 1126,
    /// While accessing the hard disk, a disk operation failed even after retries.
    DISK_OPERATION_FAILED = 1127,
    /// While accessing the hard disk, a disk controller reset was needed, but even that failed.
    DISK_RESET_FAILED = 1128,
    /// Physical end of tape encountered.
    EOM_OVERFLOW = 1129,
    /// Not enough server storage is available to process this command.
    NOT_ENOUGH_SERVER_MEMORY = 1130,
    /// A potential deadlock condition has been detected.
    POSSIBLE_DEADLOCK = 1131,
    /// The base address or the file offset specified does not have the proper alignment.
    MAPPED_ALIGNMENT = 1132,
    /// An attempt to change the system power state was vetoed by another application or driver.
    SET_POWER_STATE_VETOED = 1140,
    /// The system BIOS failed an attempt to change the system power state.
    SET_POWER_STATE_FAILED = 1141,
    /// An attempt was made to create more links on a file than the file system supports.
    TOO_MANY_LINKS = 1142,
    /// The specified program requires a newer version of Windows.
    OLD_WIN_VERSION = 1150,
    /// The specified program is not a Windows or MS-DOS program.
    APP_WRONG_OS = 1151,
    /// Cannot start more than one instance of the specified program.
    SINGLE_INSTANCE_APP = 1152,
    /// The specified program was written for an earlier version of Windows.
    RMODE_APP = 1153,
    /// One of the library files needed to run this application is damaged.
    INVALID_DLL = 1154,
    /// No application is associated with the specified file for this operation.
    NO_ASSOCIATION = 1155,
    /// An error occurred in sending the command to the application.
    DDE_FAIL = 1156,
    /// One of the library files needed to run this application cannot be found.
    DLL_NOT_FOUND = 1157,
    /// The current process has used all of its system allowance of handles for Window Manager objects.
    NO_MORE_USER_HANDLES = 1158,
    /// The message can be used only with synchronous operations.
    MESSAGE_SYNC_ONLY = 1159,
    /// The indicated source element has no media.
    SOURCE_ELEMENT_EMPTY = 1160,
    /// The indicated destination element already contains media.
    DESTINATION_ELEMENT_FULL = 1161,
    /// The indicated element does not exist.
    ILLEGAL_ELEMENT_ADDRESS = 1162,
    /// The indicated element is part of a magazine that is not present.
    MAGAZINE_NOT_PRESENT = 1163,
    /// The indicated device requires reinitialization due to hardware errors.
    DEVICE_REINITIALIZATION_NEEDED = 1164,
    /// The device has indicated that cleaning is required before further operations are attempted.
    DEVICE_REQUIRES_CLEANING = 1165,
    /// The device has indicated that its door is open.
    DEVICE_DOOR_OPEN = 1166,
    /// The device is not connected.
    DEVICE_NOT_CONNECTED = 1167,
    /// Element not found.
    NOT_FOUND = 1168,
    /// There was no match for the specified key in the index.
    NO_MATCH = 1169,
    /// The property set specified does not exist on the object.
    SET_NOT_FOUND = 1170,
    /// The point passed to GetMouseMovePoints is not in the buffer.
    POINT_NOT_FOUND = 1171,
    /// The tracking (workstation) service is not running.
    NO_TRACKING_SERVICE = 1172,
    /// The Volume ID could not be found.
    NO_VOLUME_ID = 1173,
    /// Unable to remove the file to be replaced.
    UNABLE_TO_REMOVE_REPLACED = 1175,
    /// Unable to move the replacement file to the file to be replaced.
    /// The file to be replaced has retained its original name.
    UNABLE_TO_MOVE_REPLACEMENT = 1176,
    /// Unable to move the replacement file to the file to be replaced.
    /// The file to be replaced has been renamed using the backup name.
    UNABLE_TO_MOVE_REPLACEMENT_2 = 1177,
    /// The volume change journal is being deleted.
    JOURNAL_DELETE_IN_PROGRESS = 1178,
    /// The volume change journal is not active.
    JOURNAL_NOT_ACTIVE = 1179,
    /// A file was found, but it may not be the correct file.
    POTENTIAL_FILE_FOUND = 1180,
    /// The journal entry has been deleted from the journal.
    JOURNAL_ENTRY_DELETED = 1181,
    /// A system shutdown has already been scheduled.
    SHUTDOWN_IS_SCHEDULED = 1190,
    /// The system shutdown cannot be initiated because there are other users logged on to the computer.
    SHUTDOWN_USERS_LOGGED_ON = 1191,
    /// The specified device name is invalid.
    BAD_DEVICE = 1200,
    /// The device is not currently connected but it is a remembered connection.
    CONNECTION_UNAVAIL = 1201,
    /// The local device name has a remembered connection to another network resource.
    DEVICE_ALREADY_REMEMBERED = 1202,
    /// The network path was either typed incorrectly, does not exist, or the network provider is not currently available.
    /// Please try retyping the path or contact your network administrator.
    NO_NET_OR_BAD_PATH = 1203,
    /// The specified network provider name is invalid.
    BAD_PROVIDER = 1204,
    /// Unable to open the network connection profile.
    CANNOT_OPEN_PROFILE = 1205,
    /// The network connection profile is corrupted.
    BAD_PROFILE = 1206,
    /// Cannot enumerate a noncontainer.
    NOT_CONTAINER = 1207,
    /// An extended error has occurred.
    EXTENDED_ERROR = 1208,
    /// The format of the specified group name is invalid.
    INVALID_GROUPNAME = 1209,
    /// The format of the specified computer name is invalid.
    INVALID_COMPUTERNAME = 1210,
    /// The format of the specified event name is invalid.
    INVALID_EVENTNAME = 1211,
    /// The format of the specified domain name is invalid.
    INVALID_DOMAINNAME = 1212,
    /// The format of the specified service name is invalid.
    INVALID_SERVICENAME = 1213,
    /// The format of the specified network name is invalid.
    INVALID_NETNAME = 1214,
    /// The format of the specified share name is invalid.
    INVALID_SHARENAME = 1215,
    /// The format of the specified password is invalid.
    INVALID_PASSWORDNAME = 1216,
    /// The format of the specified message name is invalid.
    INVALID_MESSAGENAME = 1217,
    /// The format of the specified message destination is invalid.
    INVALID_MESSAGEDEST = 1218,
    /// Multiple connections to a server or shared resource by the same user, using more than one user name, are not allowed.
    /// Disconnect all previous connections to the server or shared resource and try again.
    SESSION_CREDENTIAL_CONFLICT = 1219,
    /// An attempt was made to establish a session to a network server, but there are already too many sessions established to that server.
    REMOTE_SESSION_LIMIT_EXCEEDED = 1220,
    /// The workgroup or domain name is already in use by another computer on the network.
    DUP_DOMAINNAME = 1221,
    /// The network is not present or not started.
    NO_NETWORK = 1222,
    /// The operation was canceled by the user.
    CANCELLED = 1223,
    /// The requested operation cannot be performed on a file with a user-mapped section open.
    USER_MAPPED_FILE = 1224,
    /// The remote computer refused the network connection.
    CONNECTION_REFUSED = 1225,
    /// The network connection was gracefully closed.
    GRACEFUL_DISCONNECT = 1226,
    /// The network transport endpoint already has an address associated with it.
    ADDRESS_ALREADY_ASSOCIATED = 1227,
    /// An address has not yet been associated with the network endpoint.
    ADDRESS_NOT_ASSOCIATED = 1228,
    /// An operation was attempted on a nonexistent network connection.
    CONNECTION_INVALID = 1229,
    /// An invalid operation was attempted on an active network connection.
    CONNECTION_ACTIVE = 1230,
    /// The network location cannot be reached.
    /// For information about network troubleshooting, see Windows Help.
    NETWORK_UNREACHABLE = 1231,
    /// The network location cannot be reached.
    /// For information about network troubleshooting, see Windows Help.
    HOST_UNREACHABLE = 1232,
    /// The network location cannot be reached.
    /// For information about network troubleshooting, see Windows Help.
    PROTOCOL_UNREACHABLE = 1233,
    /// No service is operating at the destination network endpoint on the remote system.
    PORT_UNREACHABLE = 1234,
    /// The request was aborted.
    REQUEST_ABORTED = 1235,
    /// The network connection was aborted by the local system.
    CONNECTION_ABORTED = 1236,
    /// The operation could not be completed. A retry should be performed.
    RETRY = 1237,
    /// A connection to the server could not be made because the limit on the number of concurrent connections for this account has been reached.
    CONNECTION_COUNT_LIMIT = 1238,
    /// Attempting to log in during an unauthorized time of day for this account.
    LOGIN_TIME_RESTRICTION = 1239,
    /// The account is not authorized to log in from this station.
    LOGIN_WKSTA_RESTRICTION = 1240,
    /// The network address could not be used for the operation requested.
    INCORRECT_ADDRESS = 1241,
    /// The service is already registered.
    ALREADY_REGISTERED = 1242,
    /// The specified service does not exist.
    SERVICE_NOT_FOUND = 1243,
    /// The operation being requested was not performed because the user has not been authenticated.
    NOT_AUTHENTICATED = 1244,
    /// The operation being requested was not performed because the user has not logged on to the network. The specified service does not exist.
    NOT_LOGGED_ON = 1245,
    /// Continue with work in progress.
    CONTINUE = 1246,
    /// An attempt was made to perform an initialization operation when initialization has already been completed.
    ALREADY_INITIALIZED = 1247,
    /// No more local devices.
    NO_MORE_DEVICES = 1248,
    /// The specified site does not exist.
    NO_SUCH_SITE = 1249,
    /// A domain controller with the specified name already exists.
    DOMAIN_CONTROLLER_EXISTS = 1250,
    /// This operation is supported only when you are connected to the server.
    ONLY_IF_CONNECTED = 1251,
    /// The group policy framework should call the extension even if there are no changes.
    OVERRIDE_NOCHANGES = 1252,
    /// The specified user does not have a valid profile.
    BAD_USER_PROFILE = 1253,
    /// This operation is not supported on a computer running Windows Server 2003 for Small Business Server.
    NOT_SUPPORTED_ON_SBS = 1254,
    /// The server machine is shutting down.
    SERVER_SHUTDOWN_IN_PROGRESS = 1255,
    /// The remote system is not available.
    /// For information about network troubleshooting, see Windows Help.
    HOST_DOWN = 1256,
    /// The security identifier provided is not from an account domain.
    NON_ACCOUNT_SID = 1257,
    /// The security identifier provided does not have a domain component.
    NON_DOMAIN_SID = 1258,
    /// AppHelp dialog canceled thus preventing the application from starting.
    APPHELP_BLOCK = 1259,
    /// This program is blocked by group policy.
    /// For more information, contact your system administrator.
    ACCESS_DISABLED_BY_POLICY = 1260,
    /// A program attempt to use an invalid register value.
    /// Normally caused by an uninitialized register. This error is Itanium specific.
    REG_NAT_CONSUMPTION = 1261,
    /// The share is currently offline or does not exist.
    CSCSHARE_OFFLINE = 1262,
    /// The Kerberos protocol encountered an error while validating the KDC certificate during smartcard logon.
    /// There is more information in the system event log.
    PKINIT_FAILURE = 1263,
    /// The Kerberos protocol encountered an error while attempting to utilize the smartcard subsystem.
    SMARTCARD_SUBSYSTEM_FAILURE = 1264,
    /// The system cannot contact a domain controller to service the authentication request. Please try again later.
    DOWNGRADE_DETECTED = 1265,
    /// The machine is locked and cannot be shut down without the force option.
    MACHINE_LOCKED = 1271,
    /// An application-defined callback gave invalid data when called.
    CALLBACK_SUPPLIED_INVALID_DATA = 1273,
    /// The group policy framework should call the extension in the synchronous foreground policy refresh.
    SYNC_FOREGROUND_REFRESH_REQUIRED = 1274,
    /// This driver has been blocked from loading.
    DRIVER_BLOCKED = 1275,
    /// A dynamic link library (DLL) referenced a module that was neither a DLL nor the process's executable image.
    INVALID_IMPORT_OF_NON_DLL = 1276,
    /// Windows cannot open this program since it has been disabled.
    ACCESS_DISABLED_WEBBLADE = 1277,
    /// Windows cannot open this program because the license enforcement system has been tampered with or become corrupted.
    ACCESS_DISABLED_WEBBLADE_TAMPER = 1278,
    /// A transaction recover failed.
    RECOVERY_FAILURE = 1279,
    /// The current thread has already been converted to a fiber.
    ALREADY_FIBER = 1280,
    /// The current thread has already been converted from a fiber.
    ALREADY_THREAD = 1281,
    /// The system detected an overrun of a stack-based buffer in this application.
    /// This overrun could potentially allow a malicious user to gain control of this application.
    STACK_BUFFER_OVERRUN = 1282,
    /// Data present in one of the parameters is more than the function can operate on.
    PARAMETER_QUOTA_EXCEEDED = 1283,
    /// An attempt to do an operation on a debug object failed because the object is in the process of being deleted.
    DEBUGGER_INACTIVE = 1284,
    /// An attempt to delay-load a .dll or get a function address in a delay-loaded .dll failed.
    DELAY_LOAD_FAILED = 1285,
    /// %1 is a 16-bit application. You do not have permissions to execute 16-bit applications.
    /// Check your permissions with your system administrator.
    VDM_DISALLOWED = 1286,
    /// Insufficient information exists to identify the cause of failure.
    UNIDENTIFIED_ERROR = 1287,
    /// The parameter passed to a C runtime function is incorrect.
    INVALID_CRUNTIME_PARAMETER = 1288,
    /// The operation occurred beyond the valid data length of the file.
    BEYOND_VDL = 1289,
    /// The service start failed since one or more services in the same process have an incompatible service SID type setting.
    /// A service with restricted service SID type can only coexist in the same process with other services with a restricted SID type.
    /// If the service SID type for this service was just configured, the hosting process must be restarted in order to start this service.
    /// On Windows Server 2003 and Windows XP, an unrestricted service cannot coexist in the same process with other services.
    /// The service with the unrestricted service SID type must be moved to an owned process in order to start this service.
    INCOMPATIBLE_SERVICE_SID_TYPE = 1290,
    /// The process hosting the driver for this device has been terminated.
    DRIVER_PROCESS_TERMINATED = 1291,
    /// An operation attempted to exceed an implementation-defined limit.
    IMPLEMENTATION_LIMIT = 1292,
    /// Either the target process, or the target thread's containing process, is a protected process.
    PROCESS_IS_PROTECTED = 1293,
    /// The service notification client is lagging too far behind the current state of services in the machine.
    SERVICE_NOTIFY_CLIENT_LAGGING = 1294,
    /// The requested file operation failed because the storage quota was exceeded.
    /// To free up disk space, move files to a different location or delete unnecessary files.
    /// For more information, contact your system administrator.
    DISK_QUOTA_EXCEEDED = 1295,
    /// The requested file operation failed because the storage policy blocks that type of file.
    /// For more information, contact your system administrator.
    CONTENT_BLOCKED = 1296,
    /// A privilege that the service requires to function properly does not exist in the service account configuration.
    /// You may use the Services Microsoft Management Console (MMC) snap-in (services.msc) and the Local Security Settings MMC snap-in (secpol.msc) to view the service configuration and the account configuration.
    INCOMPATIBLE_SERVICE_PRIVILEGE = 1297,
    /// A thread involved in this operation appears to be unresponsive.
    APP_HANG = 1298,
    /// Indicates a particular Security ID may not be assigned as the label of an object.
    INVALID_LABEL = 1299,
    /// Not all privileges or groups referenced are assigned to the caller.
    NOT_ALL_ASSIGNED = 1300,
    /// Some mapping between account names and security IDs was not done.
    SOME_NOT_MAPPED = 1301,
    /// No system quota limits are specifically set for this account.
    NO_QUOTAS_FOR_ACCOUNT = 1302,
    /// No encryption key is available. A well-known encryption key was returned.
    LOCAL_USER_SESSION_KEY = 1303,
    /// The password is too complex to be converted to a LAN Manager password.
    /// The LAN Manager password returned is a NULL string.
    NULL_LM_PASSWORD = 1304,
    /// The revision level is unknown.
    UNKNOWN_REVISION = 1305,
    /// Indicates two revision levels are incompatible.
    REVISION_MISMATCH = 1306,
    /// This security ID may not be assigned as the owner of this object.
    INVALID_OWNER = 1307,
    /// This security ID may not be assigned as the primary group of an object.
    INVALID_PRIMARY_GROUP = 1308,
    /// An attempt has been made to operate on an impersonation token by a thread that is not currently impersonating a client.
    NO_IMPERSONATION_TOKEN = 1309,
    /// The group may not be disabled.
    CANT_DISABLE_MANDATORY = 1310,
    /// There are currently no logon servers available to service the logon request.
    NO_LOGON_SERVERS = 1311,
    /// A specified logon session does not exist. It may already have been terminated.
    NO_SUCH_LOGON_SESSION = 1312,
    /// A specified privilege does not exist.
    NO_SUCH_PRIVILEGE = 1313,
    /// A required privilege is not held by the client.
    PRIVILEGE_NOT_HELD = 1314,
    /// The name provided is not a properly formed account name.
    INVALID_ACCOUNT_NAME = 1315,
    /// The specified account already exists.
    USER_EXISTS = 1316,
    /// The specified account does not exist.
    NO_SUCH_USER = 1317,
    /// The specified group already exists.
    GROUP_EXISTS = 1318,
    /// The specified group does not exist.
    NO_SUCH_GROUP = 1319,
    /// Either the specified user account is already a member of the specified group, or the specified group cannot be deleted because it contains a member.
    MEMBER_IN_GROUP = 1320,
    /// The specified user account is not a member of the specified group account.
    MEMBER_NOT_IN_GROUP = 1321,
    /// This operation is disallowed as it could result in an administration account being disabled, deleted or unable to log on.
    LAST_ADMIN = 1322,
    /// Unable to update the password. The value provided as the current password is incorrect.
    WRONG_PASSWORD = 1323,
    /// Unable to update the password. The value provided for the new password contains values that are not allowed in passwords.
    ILL_FORMED_PASSWORD = 1324,
    /// Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain.
    PASSWORD_RESTRICTION = 1325,
    /// The user name or password is incorrect.
    LOGON_FAILURE = 1326,
    /// Account restrictions are preventing this user from signing in.
    /// For example: blank passwords aren't allowed, sign-in times are limited, or a policy restriction has been enforced.
    ACCOUNT_RESTRICTION = 1327,
    /// Your account has time restrictions that keep you from signing in right now.
    INVALID_LOGON_HOURS = 1328,
    /// This user isn't allowed to sign in to this computer.
    INVALID_WORKSTATION = 1329,
    /// The password for this account has expired.
    PASSWORD_EXPIRED = 1330,
    /// This user can't sign in because this account is currently disabled.
    ACCOUNT_DISABLED = 1331,
    /// No mapping between account names and security IDs was done.
    NONE_MAPPED = 1332,
    /// Too many local user identifiers (LUIDs) were requested at one time.
    TOO_MANY_LUIDS_REQUESTED = 1333,
    /// No more local user identifiers (LUIDs) are available.
    LUIDS_EXHAUSTED = 1334,
    /// The subauthority part of a security ID is invalid for this particular use.
    INVALID_SUB_AUTHORITY = 1335,
    /// The access control list (ACL) structure is invalid.
    INVALID_ACL = 1336,
    /// The security ID structure is invalid.
    INVALID_SID = 1337,
    /// The security descriptor structure is invalid.
    INVALID_SECURITY_DESCR = 1338,
    /// The inherited access control list (ACL) or access control entry (ACE) could not be built.
    BAD_INHERITANCE_ACL = 1340,
    /// The server is currently disabled.
    SERVER_DISABLED = 1341,
    /// The server is currently enabled.
    SERVER_NOT_DISABLED = 1342,
    /// The value provided was an invalid value for an identifier authority.
    INVALID_ID_AUTHORITY = 1343,
    /// No more memory is available for security information updates.
    ALLOTTED_SPACE_EXCEEDED = 1344,
    /// The specified attributes are invalid, or incompatible with the attributes for the group as a whole.
    INVALID_GROUP_ATTRIBUTES = 1345,
    /// Either a required impersonation level was not provided, or the provided impersonation level is invalid.
    BAD_IMPERSONATION_LEVEL = 1346,
    /// Cannot open an anonymous level security token.
    CANT_OPEN_ANONYMOUS = 1347,
    /// The validation information class requested was invalid.
    BAD_VALIDATION_CLASS = 1348,
    /// The type of the token is inappropriate for its attempted use.
    BAD_TOKEN_TYPE = 1349,
    /// Unable to perform a security operation on an object that has no associated security.
    NO_SECURITY_ON_OBJECT = 1350,
    /// Configuration information could not be read from the domain controller, either because the machine is unavailable, or access has been denied.
    CANT_ACCESS_DOMAIN_INFO = 1351,
    /// The security account manager (SAM) or local security authority (LSA) server was in the wrong state to perform the security operation.
    INVALID_SERVER_STATE = 1352,
    /// The domain was in the wrong state to perform the security operation.
    INVALID_DOMAIN_STATE = 1353,
    /// This operation is only allowed for the Primary Domain Controller of the domain.
    INVALID_DOMAIN_ROLE = 1354,
    /// The specified domain either does not exist or could not be contacted.
    NO_SUCH_DOMAIN = 1355,
    /// The specified domain already exists.
    DOMAIN_EXISTS = 1356,
    /// An attempt was made to exceed the limit on the number of domains per server.
    DOMAIN_LIMIT_EXCEEDED = 1357,
    /// Unable to complete the requested operation because of either a catastrophic media failure or a data structure corruption on the disk.
    INTERNAL_DB_CORRUPTION = 1358,
    /// An internal error occurred.
    INTERNAL_ERROR = 1359,
    /// Generic access types were contained in an access mask which should already be mapped to nongeneric types.
    GENERIC_NOT_MAPPED = 1360,
    /// A security descriptor is not in the right format (absolute or self-relative).
    BAD_DESCRIPTOR_FORMAT = 1361,
    /// The requested action is restricted for use by logon processes only.
    /// The calling process has not registered as a logon process.
    NOT_LOGON_PROCESS = 1362,
    /// Cannot start a new logon session with an ID that is already in use.
    LOGON_SESSION_EXISTS = 1363,
    /// A specified authentication package is unknown.
    NO_SUCH_PACKAGE = 1364,
    /// The logon session is not in a state that is consistent with the requested operation.
    BAD_LOGON_SESSION_STATE = 1365,
    /// The logon session ID is already in use.
    LOGON_SESSION_COLLISION = 1366,
    /// A logon request contained an invalid logon type value.
    INVALID_LOGON_TYPE = 1367,
    /// Unable to impersonate using a named pipe until data has been read from that pipe.
    CANNOT_IMPERSONATE = 1368,
    /// The transaction state of a registry subtree is incompatible with the requested operation.
    RXACT_INVALID_STATE = 1369,
    /// An internal security database corruption has been encountered.
    RXACT_COMMIT_FAILURE = 1370,
    /// Cannot perform this operation on built-in accounts.
    SPECIAL_ACCOUNT = 1371,
    /// Cannot perform this operation on this built-in special group.
    SPECIAL_GROUP = 1372,
    /// Cannot perform this operation on this built-in special user.
    SPECIAL_USER = 1373,
    /// The user cannot be removed from a group because the group is currently the user's primary group.
    MEMBERS_PRIMARY_GROUP = 1374,
    /// The token is already in use as a primary token.
    TOKEN_ALREADY_IN_USE = 1375,
    /// The specified local group does not exist.
    NO_SUCH_ALIAS = 1376,
    /// The specified account name is not a member of the group.
    MEMBER_NOT_IN_ALIAS = 1377,
    /// The specified account name is already a member of the group.
    MEMBER_IN_ALIAS = 1378,
    /// The specified local group already exists.
    ALIAS_EXISTS = 1379,
    /// Logon failure: the user has not been granted the requested logon type at this computer.
    LOGON_NOT_GRANTED = 1380,
    /// The maximum number of secrets that may be stored in a single system has been exceeded.
    TOO_MANY_SECRETS = 1381,
    /// The length of a secret exceeds the maximum length allowed.
    SECRET_TOO_LONG = 1382,
    /// The local security authority database contains an internal inconsistency.
    INTERNAL_DB_ERROR = 1383,
    /// During a logon attempt, the user's security context accumulated too many security IDs.
    TOO_MANY_CONTEXT_IDS = 1384,
    /// Logon failure: the user has not been granted the requested logon type at this computer.
    LOGON_TYPE_NOT_GRANTED = 1385,
    /// A cross-encrypted password is necessary to change a user password.
    NT_CROSS_ENCRYPTION_REQUIRED = 1386,
    /// A member could not be added to or removed from the local group because the member does not exist.
    NO_SUCH_MEMBER = 1387,
    /// A new member could not be added to a local group because the member has the wrong account type.
    INVALID_MEMBER = 1388,
    /// Too many security IDs have been specified.
    TOO_MANY_SIDS = 1389,
    /// A cross-encrypted password is necessary to change this user password.
    LM_CROSS_ENCRYPTION_REQUIRED = 1390,
    /// Indicates an ACL contains no inheritable components.
    NO_INHERITANCE = 1391,
    /// The file or directory is corrupted and unreadable.
    FILE_CORRUPT = 1392,
    /// The disk structure is corrupted and unreadable.
    DISK_CORRUPT = 1393,
    /// There is no user session key for the specified logon session.
    NO_USER_SESSION_KEY = 1394,
    /// The service being accessed is licensed for a particular number of connections.
    /// No more connections can be made to the service at this time because there are already as many connections as the service can accept.
    LICENSE_QUOTA_EXCEEDED = 1395,
    /// The target account name is incorrect.
    WRONG_TARGET_NAME = 1396,
    /// Mutual Authentication failed. The server's password is out of date at the domain controller.
    MUTUAL_AUTH_FAILED = 1397,
    /// There is a time and/or date difference between the client and server.
    TIME_SKEW = 1398,
    /// This operation cannot be performed on the current domain.
    CURRENT_DOMAIN_NOT_ALLOWED = 1399,
    /// Invalid window handle.
    INVALID_WINDOW_HANDLE = 1400,
    /// Invalid menu handle.
    INVALID_MENU_HANDLE = 1401,
    /// Invalid cursor handle.
    INVALID_CURSOR_HANDLE = 1402,
    /// Invalid accelerator table handle.
    INVALID_ACCEL_HANDLE = 1403,
    /// Invalid hook handle.
    INVALID_HOOK_HANDLE = 1404,
    /// Invalid handle to a multiple-window position structure.
    INVALID_DWP_HANDLE = 1405,
    /// Cannot create a top-level child window.
    TLW_WITH_WSCHILD = 1406,
    /// Cannot find window class.
    CANNOT_FIND_WND_CLASS = 1407,
    /// Invalid window; it belongs to other thread.
    WINDOW_OF_OTHER_THREAD = 1408,
    /// Hot key is already registered.
    HOTKEY_ALREADY_REGISTERED = 1409,
    /// Class already exists.
    CLASS_ALREADY_EXISTS = 1410,
    /// Class does not exist.
    CLASS_DOES_NOT_EXIST = 1411,
    /// Class still has openwin32.
    CLASS_HAS_WINDOWS = 1412,
    /// Invalid index.
    INVALID_INDEX = 1413,
    /// Invalid icon handle.
    INVALID_ICON_HANDLE = 1414,
    /// Using private DIALOG window words.
    PRIVATE_DIALOG_INDEX = 1415,
    /// The list box identifier was not found.
    LISTBOX_ID_NOT_FOUND = 1416,
    /// No wildcards were found.
    NO_WILDCARD_CHARACTERS = 1417,
    /// Thread does not have a clipboard open.
    CLIPBOARD_NOT_OPEN = 1418,
    /// Hot key is not registered.
    HOTKEY_NOT_REGISTERED = 1419,
    /// The window is not a valid dialog window.
    WINDOW_NOT_DIALOG = 1420,
    /// Control ID not found.
    CONTROL_ID_NOT_FOUND = 1421,
    /// Invalid message for a combo box because it does not have an edit control.
    INVALID_COMBOBOX_MESSAGE = 1422,
    /// The window is not a combo box.
    WINDOW_NOT_COMBOBOX = 1423,
    /// Height must be less than 256.
    INVALID_EDIT_HEIGHT = 1424,
    /// Invalid device context (DC) handle.
    DC_NOT_FOUND = 1425,
    /// Invalid hook procedure type.
    INVALID_HOOK_FILTER = 1426,
    /// Invalid hook procedure.
    INVALID_FILTER_PROC = 1427,
    /// Cannot set nonlocal hook without a module handle.
    HOOK_NEEDS_HMOD = 1428,
    /// This hook procedure can only be set globally.
    GLOBAL_ONLY_HOOK = 1429,
    /// The journal hook procedure is already installed.
    JOURNAL_HOOK_SET = 1430,
    /// The hook procedure is not installed.
    HOOK_NOT_INSTALLED = 1431,
    /// Invalid message for single-selection list box.
    INVALID_LB_MESSAGE = 1432,
    /// LB_SETCOUNT sent to non-lazy list box.
    SETCOUNT_ON_BAD_LB = 1433,
    /// This list box does not support tab stops.
    LB_WITHOUT_TABSTOPS = 1434,
    /// Cannot destroy object created by another thread.
    DESTROY_OBJECT_OF_OTHER_THREAD = 1435,

    /// The data present in the reparse point buffer is invalid.
    INVALID_REPARSE_DATA = 3492,

    /// Childwin32.cannot have menus.
    CHILD_WINDOW_MENU = 1436,
    /// The window does not have a system menu.
    NO_SYSTEM_MENU = 1437,
    /// Invalid message box style.
    INVALID_MSGBOX_STYLE = 1438,
    /// Invalid system-wide (SPI_*) parameter.
    INVALID_SPI_VALUE = 1439,
    /// Screen already locked.
    SCREEN_ALREADY_LOCKED = 1440,
    /// All handles towin32.in a multiple-window position structure must have the same parent.
    HWNDS_HAVE_DIFF_PARENT = 1441,
    /// The window is not a child window.
    NOT_CHILD_WINDOW = 1442,
    /// Invalid GW_* command.
    INVALID_GW_COMMAND = 1443,
    /// Invalid thread identifier.
    INVALID_THREAD_ID = 1444,
    /// Cannot process a message from a window that is not a multiple document interface (MDI) window.
    NON_MDICHILD_WINDOW = 1445,
    /// Popup menu already active.
    POPUP_ALREADY_ACTIVE = 1446,
    /// The window does not have scroll bars.
    NO_SCROLLBARS = 1447,
    /// Scroll bar range cannot be greater than MAXLONG.
    INVALID_SCROLLBAR_RANGE = 1448,
    /// Cannot show or remove the window in the way specified.
    INVALID_SHOWWIN_COMMAND = 1449,
    /// Insufficient system resources exist to complete the requested service.
    NO_SYSTEM_RESOURCES = 1450,
    /// Insufficient system resources exist to complete the requested service.
    NONPAGED_SYSTEM_RESOURCES = 1451,
    /// Insufficient system resources exist to complete the requested service.
    PAGED_SYSTEM_RESOURCES = 1452,
    /// Insufficient quota to complete the requested service.
    WORKING_SET_QUOTA = 1453,
    /// Insufficient quota to complete the requested service.
    PAGEFILE_QUOTA = 1454,
    /// The paging file is too small for this operation to complete.
    COMMITMENT_LIMIT = 1455,
    /// A menu item was not found.
    MENU_ITEM_NOT_FOUND = 1456,
    /// Invalid keyboard layout handle.
    INVALID_KEYBOARD_HANDLE = 1457,
    /// Hook type not allowed.
    HOOK_TYPE_NOT_ALLOWED = 1458,
    /// This operation requires an interactive window station.
    REQUIRES_INTERACTIVE_WINDOWSTATION = 1459,
    /// This operation returned because the timeout period expired.
    TIMEOUT = 1460,
    /// Invalid monitor handle.
    INVALID_MONITOR_HANDLE = 1461,
    /// Incorrect size argument.
    INCORRECT_SIZE = 1462,
    /// The symbolic link cannot be followed because its type is disabled.
    SYMLINK_CLASS_DISABLED = 1463,
    /// This application does not support the current operation on symbolic links.
    SYMLINK_NOT_SUPPORTED = 1464,
    /// Windows was unable to parse the requested XML data.
    XML_PARSE_ERROR = 1465,
    /// An error was encountered while processing an XML digital signature.
    XMLDSIG_ERROR = 1466,
    /// This application must be restarted.
    RESTART_APPLICATION = 1467,
    /// The caller made the connection request in the wrong routing compartment.
    WRONG_COMPARTMENT = 1468,
    /// There was an AuthIP failure when attempting to connect to the remote host.
    AUTHIP_FAILURE = 1469,
    /// Insufficient NVRAM resources exist to complete the requested service. A reboot might be required.
    NO_NVRAM_RESOURCES = 1470,
    /// Unable to finish the requested operation because the specified process is not a GUI process.
    NOT_GUI_PROCESS = 1471,
    /// The event log file is corrupted.
    EVENTLOG_FILE_CORRUPT = 1500,
    /// No event log file could be opened, so the event logging service did not start.
    EVENTLOG_CANT_START = 1501,
    /// The event log file is full.
    LOG_FILE_FULL = 1502,
    /// The event log file has changed between read operations.
    EVENTLOG_FILE_CHANGED = 1503,
    /// The specified task name is invalid.
    INVALID_TASK_NAME = 1550,
    /// The specified task index is invalid.
    INVALID_TASK_INDEX = 1551,
    /// The specified thread is already joining a task.
    THREAD_ALREADY_IN_TASK = 1552,
    /// The Windows Installer Service could not be accessed.
    /// This can occur if the Windows Installer is not correctly installed. Contact your support personnel for assistance.
    INSTALL_SERVICE_FAILURE = 1601,
    /// User cancelled installation.
    INSTALL_USEREXIT = 1602,
    /// Fatal error during installation.
    INSTALL_FAILURE = 1603,
    /// Installation suspended, incomplete.
    INSTALL_SUSPEND = 1604,
    /// This action is only valid for products that are currently installed.
    UNKNOWN_PRODUCT = 1605,
    /// Feature ID not registered.
    UNKNOWN_FEATURE = 1606,
    /// Component ID not registered.
    UNKNOWN_COMPONENT = 1607,
    /// Unknown property.
    UNKNOWN_PROPERTY = 1608,
    /// Handle is in an invalid state.
    INVALID_HANDLE_STATE = 1609,
    /// The configuration data for this product is corrupt. Contact your support personnel.
    BAD_CONFIGURATION = 1610,
    /// Component qualifier not present.
    INDEX_ABSENT = 1611,
    /// The installation source for this product is not available.
    /// Verify that the source exists and that you can access it.
    INSTALL_SOURCE_ABSENT = 1612,
    /// This installation package cannot be installed by the Windows Installer service.
    /// You must install a Windows service pack that contains a newer version of the Windows Installer service.
    INSTALL_PACKAGE_VERSION = 1613,
    /// Product is uninstalled.
    PRODUCT_UNINSTALLED = 1614,
    /// SQL query syntax invalid or unsupported.
    BAD_QUERY_SYNTAX = 1615,
    /// Record field does not exist.
    INVALID_FIELD = 1616,
    /// The device has been removed.
    DEVICE_REMOVED = 1617,
    /// Another installation is already in progress.
    /// Complete that installation before proceeding with this install.
    INSTALL_ALREADY_RUNNING = 1618,
    /// This installation package could not be opened.
    /// Verify that the package exists and that you can access it, or contact the application vendor to verify that this is a valid Windows Installer package.
    INSTALL_PACKAGE_OPEN_FAILED = 1619,
    /// This installation package could not be opened.
    /// Contact the application vendor to verify that this is a valid Windows Installer package.
    INSTALL_PACKAGE_INVALID = 1620,
    /// There was an error starting the Windows Installer service user interface. Contact your support personnel.
    INSTALL_UI_FAILURE = 1621,
    /// Error opening installation log file.
    /// Verify that the specified log file location exists and that you can write to it.
    INSTALL_LOG_FAILURE = 1622,
    /// The language of this installation package is not supported by your system.
    INSTALL_LANGUAGE_UNSUPPORTED = 1623,
    /// Error applying transforms. Verify that the specified transform paths are valid.
    INSTALL_TRANSFORM_FAILURE = 1624,
    /// This installation is forbidden by system policy. Contact your system administrator.
    INSTALL_PACKAGE_REJECTED = 1625,
    /// Function could not be executed.
    FUNCTION_NOT_CALLED = 1626,
    /// Function failed during execution.
    FUNCTION_FAILED = 1627,
    /// Invalid or unknown table specified.
    INVALID_TABLE = 1628,
    /// Data supplied is of wrong type.
    DATATYPE_MISMATCH = 1629,
    /// Data of this type is not supported.
    UNSUPPORTED_TYPE = 1630,
    /// The Windows Installer service failed to start. Contact your support personnel.
    CREATE_FAILED = 1631,
    /// The Temp folder is on a drive that is full or is inaccessible.
    /// Free up space on the drive or verify that you have write permission on the Temp folder.
    INSTALL_TEMP_UNWRITABLE = 1632,
    /// This installation package is not supported by this processor type. Contact your product vendor.
    INSTALL_PLATFORM_UNSUPPORTED = 1633,
    /// Component not used on this computer.
    INSTALL_NOTUSED = 1634,
    /// This update package could not be opened.
    /// Verify that the update package exists and that you can access it, or contact the application vendor to verify that this is a valid Windows Installer update package.
    PATCH_PACKAGE_OPEN_FAILED = 1635,
    /// This update package could not be opened.
    /// Contact the application vendor to verify that this is a valid Windows Installer update package.
    PATCH_PACKAGE_INVALID = 1636,
    /// This update package cannot be processed by the Windows Installer service.
    /// You must install a Windows service pack that contains a newer version of the Windows Installer service.
    PATCH_PACKAGE_UNSUPPORTED = 1637,
    /// Another version of this product is already installed. Installation of this version cannot continue.
    /// To configure or remove the existing version of this product, use Add/Remove Programs on the Control Panel.
    PRODUCT_VERSION = 1638,
    /// Invalid command line argument. Consult the Windows Installer SDK for detailed command line help.
    INVALID_COMMAND_LINE = 1639,
    /// Only administrators have permission to add, remove, or configure server software during a Terminal services remote session.
    /// If you want to install or configure software on the server, contact your network administrator.
    INSTALL_REMOTE_DISALLOWED = 1640,
    /// The requested operation completed successfully.
    /// The system will be restarted so the changes can take effect.
    SUCCESS_REBOOT_INITIATED = 1641,
    /// The upgrade cannot be installed by the Windows Installer service because the program to be upgraded may be missing, or the upgrade may update a different version of the program.
    /// Verify that the program to be upgraded exists on your computer and that you have the correct upgrade.
    PATCH_TARGET_NOT_FOUND = 1642,
    /// The update package is not permitted by software restriction policy.
    PATCH_PACKAGE_REJECTED = 1643,
    /// One or more customizations are not permitted by software restriction policy.
    INSTALL_TRANSFORM_REJECTED = 1644,
    /// The Windows Installer does not permit installation from a Remote Desktop Connection.
    INSTALL_REMOTE_PROHIBITED = 1645,
    /// Uninstallation of the update package is not supported.
    PATCH_REMOVAL_UNSUPPORTED = 1646,
    /// The update is not applied to this product.
    UNKNOWN_PATCH = 1647,
    /// No valid sequence could be found for the set of updates.
    PATCH_NO_SEQUENCE = 1648,
    /// Update removal was disallowed by policy.
    PATCH_REMOVAL_DISALLOWED = 1649,
    /// The XML update data is invalid.
    INVALID_PATCH_XML = 1650,
    /// Windows Installer does not permit updating of managed advertised products.
    /// At least one feature of the product must be installed before applying the update.
    PATCH_MANAGED_ADVERTISED_PRODUCT = 1651,
    /// The Windows Installer service is not accessible in Safe Mode.
    /// Please try again when your computer is not in Safe Mode or you can use System Restore to return your machine to a previous good state.
    INSTALL_SERVICE_SAFEBOOT = 1652,
    /// A fail fast exception occurred.
    /// Exception handlers will not be invoked and the process will be terminated immediately.
    FAIL_FAST_EXCEPTION = 1653,
    /// The app that you are trying to run is not supported on this version of Windows.
    INSTALL_REJECTED = 1654,
    /// The string binding is invalid.
    RPC_S_INVALID_STRING_BINDING = 1700,
    /// The binding handle is not the correct type.
    RPC_S_WRONG_KIND_OF_BINDING = 1701,
    /// The binding handle is invalid.
    RPC_S_INVALID_BINDING = 1702,
    /// The RPC protocol sequence is not supported.
    RPC_S_PROTSEQ_NOT_SUPPORTED = 1703,
    /// The RPC protocol sequence is invalid.
    RPC_S_INVALID_RPC_PROTSEQ = 1704,
    /// The string universal unique identifier (UUID) is invalid.
    RPC_S_INVALID_STRING_UUID = 1705,
    /// The endpoint format is invalid.
    RPC_S_INVALID_ENDPOINT_FORMAT = 1706,
    /// The network address is invalid.
    RPC_S_INVALID_NET_ADDR = 1707,
    /// No endpoint was found.
    RPC_S_NO_ENDPOINT_FOUND = 1708,
    /// The timeout value is invalid.
    RPC_S_INVALID_TIMEOUT = 1709,
    /// The object universal unique identifier (UUID) was not found.
    RPC_S_OBJECT_NOT_FOUND = 1710,
    /// The object universal unique identifier (UUID) has already been registered.
    RPC_S_ALREADY_REGISTERED = 1711,
    /// The type universal unique identifier (UUID) has already been registered.
    RPC_S_TYPE_ALREADY_REGISTERED = 1712,
    /// The RPC server is already listening.
    RPC_S_ALREADY_LISTENING = 1713,
    /// No protocol sequences have been registered.
    RPC_S_NO_PROTSEQS_REGISTERED = 1714,
    /// The RPC server is not listening.
    RPC_S_NOT_LISTENING = 1715,
    /// The manager type is unknown.
    RPC_S_UNKNOWN_MGR_TYPE = 1716,
    /// The interface is unknown.
    RPC_S_UNKNOWN_IF = 1717,
    /// There are no bindings.
    RPC_S_NO_BINDINGS = 1718,
    /// There are no protocol sequences.
    RPC_S_NO_PROTSEQS = 1719,
    /// The endpoint cannot be created.
    RPC_S_CANT_CREATE_ENDPOINT = 1720,
    /// Not enough resources are available to complete this operation.
    RPC_S_OUT_OF_RESOURCES = 1721,
    /// The RPC server is unavailable.
    RPC_S_SERVER_UNAVAILABLE = 1722,
    /// The RPC server is too busy to complete this operation.
    RPC_S_SERVER_TOO_BUSY = 1723,
    /// The network options are invalid.
    RPC_S_INVALID_NETWORK_OPTIONS = 1724,
    /// There are no remote procedure calls active on this thread.
    RPC_S_NO_CALL_ACTIVE = 1725,
    /// The remote procedure call failed.
    RPC_S_CALL_FAILED = 1726,
    /// The remote procedure call failed and did not execute.
    RPC_S_CALL_FAILED_DNE = 1727,
    /// A remote procedure call (RPC) protocol error occurred.
    RPC_S_PROTOCOL_ERROR = 1728,
    /// Access to the HTTP proxy is denied.
    RPC_S_PROXY_ACCESS_DENIED = 1729,
    /// The transfer syntax is not supported by the RPC server.
    RPC_S_UNSUPPORTED_TRANS_SYN = 1730,
    /// The universal unique identifier (UUID) type is not supported.
    RPC_S_UNSUPPORTED_TYPE = 1732,
    /// The tag is invalid.
    RPC_S_INVALID_TAG = 1733,
    /// The array bounds are invalid.
    RPC_S_INVALID_BOUND = 1734,
    /// The binding does not contain an entry name.
    RPC_S_NO_ENTRY_NAME = 1735,
    /// The name syntax is invalid.
    RPC_S_INVALID_NAME_SYNTAX = 1736,
    /// The name syntax is not supported.
    RPC_S_UNSUPPORTED_NAME_SYNTAX = 1737,
    /// No network address is available to use to construct a universal unique identifier (UUID).
    RPC_S_UUID_NO_ADDRESS = 1739,
    /// The endpoint is a duplicate.
    RPC_S_DUPLICATE_ENDPOINT = 1740,
    /// The authentication type is unknown.
    RPC_S_UNKNOWN_AUTHN_TYPE = 1741,
    /// The maximum number of calls is too small.
    RPC_S_MAX_CALLS_TOO_SMALL = 1742,
    /// The string is too long.
    RPC_S_STRING_TOO_LONG = 1743,
    /// The RPC protocol sequence was not found.
    RPC_S_PROTSEQ_NOT_FOUND = 1744,
    /// The procedure number is out of range.
    RPC_S_PROCNUM_OUT_OF_RANGE = 1745,
    /// The binding does not contain any authentication information.
    RPC_S_BINDING_HAS_NO_AUTH = 1746,
    /// The authentication service is unknown.
    RPC_S_UNKNOWN_AUTHN_SERVICE = 1747,
    /// The authentication level is unknown.
    RPC_S_UNKNOWN_AUTHN_LEVEL = 1748,
    /// The security context is invalid.
    RPC_S_INVALID_AUTH_IDENTITY = 1749,
    /// The authorization service is unknown.
    RPC_S_UNKNOWN_AUTHZ_SERVICE = 1750,
    /// The entry is invalid.
    EPT_S_INVALID_ENTRY = 1751,
    /// The server endpoint cannot perform the operation.
    EPT_S_CANT_PERFORM_OP = 1752,
    /// There are no more endpoints available from the endpoint mapper.
    EPT_S_NOT_REGISTERED = 1753,
    /// No interfaces have been exported.
    RPC_S_NOTHING_TO_EXPORT = 1754,
    /// The entry name is incomplete.
    RPC_S_INCOMPLETE_NAME = 1755,
    /// The version option is invalid.
    RPC_S_INVALID_VERS_OPTION = 1756,
    /// There are no more members.
    RPC_S_NO_MORE_MEMBERS = 1757,
    /// There is nothing to unexport.
    RPC_S_NOT_ALL_OBJS_UNEXPORTED = 1758,
    /// The interface was not found.
    RPC_S_INTERFACE_NOT_FOUND = 1759,
    /// The entry already exists.
    RPC_S_ENTRY_ALREADY_EXISTS = 1760,
    /// The entry is not found.
    RPC_S_ENTRY_NOT_FOUND = 1761,
    /// The name service is unavailable.
    RPC_S_NAME_SERVICE_UNAVAILABLE = 1762,
    /// The network address family is invalid.
    RPC_S_INVALID_NAF_ID = 1763,
    /// The requested operation is not supported.
    RPC_S_CANNOT_SUPPORT = 1764,
    /// No security context is available to allow impersonation.
    RPC_S_NO_CONTEXT_AVAILABLE = 1765,
    /// An internal error occurred in a remote procedure call (RPC).
    RPC_S_INTERNAL_ERROR = 1766,
    /// The RPC server attempted an integer division by zero.
    RPC_S_ZERO_DIVIDE = 1767,
    /// An addressing error occurred in the RPC server.
    RPC_S_ADDRESS_ERROR = 1768,
    /// A floating-point operation at the RPC server caused a division by zero.
    RPC_S_FP_DIV_ZERO = 1769,
    /// A floating-point underflow occurred at the RPC server.
    RPC_S_FP_UNDERFLOW = 1770,
    /// A floating-point overflow occurred at the RPC server.
    RPC_S_FP_OVERFLOW = 1771,
    /// The list of RPC servers available for the binding of auto handles has been exhausted.
    RPC_X_NO_MORE_ENTRIES = 1772,
    /// Unable to open the character translation table file.
    RPC_X_SS_CHAR_TRANS_OPEN_FAIL = 1773,
    /// The file containing the character translation table has fewer than 512 bytes.
    RPC_X_SS_CHAR_TRANS_SHORT_FILE = 1774,
    /// A null context handle was passed from the client to the host during a remote procedure call.
    RPC_X_SS_IN_NULL_CONTEXT = 1775,
    /// The context handle changed during a remote procedure call.
    RPC_X_SS_CONTEXT_DAMAGED = 1777,
    /// The binding handles passed to a remote procedure call do not match.
    RPC_X_SS_HANDLES_MISMATCH = 1778,
    /// The stub is unable to get the remote procedure call handle.
    RPC_X_SS_CANNOT_GET_CALL_HANDLE = 1779,
    /// A null reference pointer was passed to the stub.
    RPC_X_NULL_REF_POINTER = 1780,
    /// The enumeration value is out of range.
    RPC_X_ENUM_VALUE_OUT_OF_RANGE = 1781,
    /// The byte count is too small.
    RPC_X_BYTE_COUNT_TOO_SMALL = 1782,
    /// The stub received bad data.
    RPC_X_BAD_STUB_DATA = 1783,
    /// The supplied user buffer is not valid for the requested operation.
    INVALID_USER_BUFFER = 1784,
    /// The disk media is not recognized. It may not be formatted.
    UNRECOGNIZED_MEDIA = 1785,
    /// The workstation does not have a trust secret.
    NO_TRUST_LSA_SECRET = 1786,
    /// The security database on the server does not have a computer account for this workstation trust relationship.
    NO_TRUST_SAM_ACCOUNT = 1787,
    /// The trust relationship between the primary domain and the trusted domain failed.
    TRUSTED_DOMAIN_FAILURE = 1788,
    /// The trust relationship between this workstation and the primary domain failed.
    TRUSTED_RELATIONSHIP_FAILURE = 1789,
    /// The network logon failed.
    TRUST_FAILURE = 1790,
    /// A remote procedure call is already in progress for this thread.
    RPC_S_CALL_IN_PROGRESS = 1791,
    /// An attempt was made to logon, but the network logon service was not started.
    NETLOGON_NOT_STARTED = 1792,
    /// The user's account has expired.
    ACCOUNT_EXPIRED = 1793,
    /// The redirector is in use and cannot be unloaded.
    REDIRECTOR_HAS_OPEN_HANDLES = 1794,
    /// The specified printer driver is already installed.
    PRINTER_DRIVER_ALREADY_INSTALLED = 1795,
    /// The specified port is unknown.
    UNKNOWN_PORT = 1796,
    /// The printer driver is unknown.
    UNKNOWN_PRINTER_DRIVER = 1797,
    /// The print processor is unknown.
    UNKNOWN_PRINTPROCESSOR = 1798,
    /// The specified separator file is invalid.
    INVALID_SEPARATOR_FILE = 1799,
    /// The specified priority is invalid.
    INVALID_PRIORITY = 1800,
    /// The printer name is invalid.
    INVALID_PRINTER_NAME = 1801,
    /// The printer already exists.
    PRINTER_ALREADY_EXISTS = 1802,
    /// The printer command is invalid.
    INVALID_PRINTER_COMMAND = 1803,
    /// The specified datatype is invalid.
    INVALID_DATATYPE = 1804,
    /// The environment specified is invalid.
    INVALID_ENVIRONMENT = 1805,
    /// There are no more bindings.
    RPC_S_NO_MORE_BINDINGS = 1806,
    /// The account used is an interdomain trust account.
    /// Use your global user account or local user account to access this server.
    NOLOGON_INTERDOMAIN_TRUST_ACCOUNT = 1807,
    /// The account used is a computer account.
    /// Use your global user account or local user account to access this server.
    NOLOGON_WORKSTATION_TRUST_ACCOUNT = 1808,
    /// The account used is a server trust account.
    /// Use your global user account or local user account to access this server.
    NOLOGON_SERVER_TRUST_ACCOUNT = 1809,
    /// The name or security ID (SID) of the domain specified is inconsistent with the trust information for that domain.
    DOMAIN_TRUST_INCONSISTENT = 1810,
    /// The server is in use and cannot be unloaded.
    SERVER_HAS_OPEN_HANDLES = 1811,
    /// The specified image file did not contain a resource section.
    RESOURCE_DATA_NOT_FOUND = 1812,
    /// The specified resource type cannot be found in the image file.
    RESOURCE_TYPE_NOT_FOUND = 1813,
    /// The specified resource name cannot be found in the image file.
    RESOURCE_NAME_NOT_FOUND = 1814,
    /// The specified resource language ID cannot be found in the image file.
    RESOURCE_LANG_NOT_FOUND = 1815,
    /// Not enough quota is available to process this command.
    NOT_ENOUGH_QUOTA = 1816,
    /// No interfaces have been registered.
    RPC_S_NO_INTERFACES = 1817,
    /// The remote procedure call was cancelled.
    RPC_S_CALL_CANCELLED = 1818,
    /// The binding handle does not contain all required information.
    RPC_S_BINDING_INCOMPLETE = 1819,
    /// A communications failure occurred during a remote procedure call.
    RPC_S_COMM_FAILURE = 1820,
    /// The requested authentication level is not supported.
    RPC_S_UNSUPPORTED_AUTHN_LEVEL = 1821,
    /// No principal name registered.
    RPC_S_NO_PRINC_NAME = 1822,
    /// The error specified is not a valid Windows RPC error code.
    RPC_S_NOT_RPC_ERROR = 1823,
    /// A UUID that is valid only on this computer has been allocated.
    RPC_S_UUID_LOCAL_ONLY = 1824,
    /// A security package specific error occurred.
    RPC_S_SEC_PKG_ERROR = 1825,
    /// Thread is not canceled.
    RPC_S_NOT_CANCELLED = 1826,
    /// Invalid operation on the encoding/decoding handle.
    RPC_X_INVALID_ES_ACTION = 1827,
    /// Incompatible version of the serializing package.
    RPC_X_WRONG_ES_VERSION = 1828,
    /// Incompatible version of the RPC stub.
    RPC_X_WRONG_STUB_VERSION = 1829,
    /// The RPC pipe object is invalid or corrupted.
    RPC_X_INVALID_PIPE_OBJECT = 1830,
    /// An invalid operation was attempted on an RPC pipe object.
    RPC_X_WRONG_PIPE_ORDER = 1831,
    /// Unsupported RPC pipe version.
    RPC_X_WRONG_PIPE_VERSION = 1832,
    /// HTTP proxy server rejected the connection because the cookie authentication failed.
    RPC_S_COOKIE_AUTH_FAILED = 1833,
    /// The group member was not found.
    RPC_S_GROUP_MEMBER_NOT_FOUND = 1898,
    /// The endpoint mapper database entry could not be created.
    EPT_S_CANT_CREATE = 1899,
    /// The object universal unique identifier (UUID) is the nil UUID.
    RPC_S_INVALID_OBJECT = 1900,
    /// The specified time is invalid.
    INVALID_TIME = 1901,
    /// The specified form name is invalid.
    INVALID_FORM_NAME = 1902,
    /// The specified form size is invalid.
    INVALID_FORM_SIZE = 1903,
    /// The specified printer handle is already being waited on.
    ALREADY_WAITING = 1904,
    /// The specified printer has been deleted.
    PRINTER_DELETED = 1905,
    /// The state of the printer is invalid.
    INVALID_PRINTER_STATE = 1906,
    /// The user's password must be changed before signing in.
    PASSWORD_MUST_CHANGE = 1907,
    /// Could not find the domain controller for this domain.
    DOMAIN_CONTROLLER_NOT_FOUND = 1908,
    /// The referenced account is currently locked out and may not be logged on to.
    ACCOUNT_LOCKED_OUT = 1909,
    /// The object exporter specified was not found.
    OR_INVALID_OXID = 1910,
    /// The object specified was not found.
    OR_INVALID_OID = 1911,
    /// The object resolver set specified was not found.
    OR_INVALID_SET = 1912,
    /// Some data remains to be sent in the request buffer.
    RPC_S_SEND_INCOMPLETE = 1913,
    /// Invalid asynchronous remote procedure call handle.
    RPC_S_INVALID_ASYNC_HANDLE = 1914,
    /// Invalid asynchronous RPC call handle for this operation.
    RPC_S_INVALID_ASYNC_CALL = 1915,
    /// The RPC pipe object has already been closed.
    RPC_X_PIPE_CLOSED = 1916,
    /// The RPC call completed before all pipes were processed.
    RPC_X_PIPE_DISCIPLINE_ERROR = 1917,
    /// No more data is available from the RPC pipe.
    RPC_X_PIPE_EMPTY = 1918,
    /// No site name is available for this machine.
    NO_SITENAME = 1919,
    /// The file cannot be accessed by the system.
    CANT_ACCESS_FILE = 1920,
    /// The name of the file cannot be resolved by the system.
    CANT_RESOLVE_FILENAME = 1921,
    /// The entry is not of the expected type.
    RPC_S_ENTRY_TYPE_MISMATCH = 1922,
    /// Not all object UUIDs could be exported to the specified entry.
    RPC_S_NOT_ALL_OBJS_EXPORTED = 1923,
    /// Interface could not be exported to the specified entry.
    RPC_S_INTERFACE_NOT_EXPORTED = 1924,
    /// The specified profile entry could not be added.
    RPC_S_PROFILE_NOT_ADDED = 1925,
    /// The specified profile element could not be added.
    RPC_S_PRF_ELT_NOT_ADDED = 1926,
    /// The specified profile element could not be removed.
    RPC_S_PRF_ELT_NOT_REMOVED = 1927,
    /// The group element could not be added.
    RPC_S_GRP_ELT_NOT_ADDED = 1928,
    /// The group element could not be removed.
    RPC_S_GRP_ELT_NOT_REMOVED = 1929,
    /// The printer driver is not compatible with a policy enabled on your computer that blocks NT 4.0 drivers.
    KM_DRIVER_BLOCKED = 1930,
    /// The context has expired and can no longer be used.
    CONTEXT_EXPIRED = 1931,
    /// The current user's delegated trust creation quota has been exceeded.
    PER_USER_TRUST_QUOTA_EXCEEDED = 1932,
    /// The total delegated trust creation quota has been exceeded.
    ALL_USER_TRUST_QUOTA_EXCEEDED = 1933,
    /// The current user's delegated trust deletion quota has been exceeded.
    USER_DELETE_TRUST_QUOTA_EXCEEDED = 1934,
    /// The computer you are signing into is protected by an authentication firewall.
    /// The specified account is not allowed to authenticate to the computer.
    AUTHENTICATION_FIREWALL_FAILED = 1935,
    /// Remote connections to the Print Spooler are blocked by a policy set on your machine.
    REMOTE_PRINT_CONNECTIONS_BLOCKED = 1936,
    /// Authentication failed because NTLM authentication has been disabled.
    NTLM_BLOCKED = 1937,
    /// Logon Failure: EAS policy requires that the user change their password before this operation can be performed.
    PASSWORD_CHANGE_REQUIRED = 1938,
    /// The pixel format is invalid.
    INVALID_PIXEL_FORMAT = 2000,
    /// The specified driver is invalid.
    BAD_DRIVER = 2001,
    /// The window style or class attribute is invalid for this operation.
    INVALID_WINDOW_STYLE = 2002,
    /// The requested metafile operation is not supported.
    METAFILE_NOT_SUPPORTED = 2003,
    /// The requested transformation operation is not supported.
    TRANSFORM_NOT_SUPPORTED = 2004,
    /// The requested clipping operation is not supported.
    CLIPPING_NOT_SUPPORTED = 2005,
    /// The specified color management module is invalid.
    INVALID_CMM = 2010,
    /// The specified color profile is invalid.
    INVALID_PROFILE = 2011,
    /// The specified tag was not found.
    TAG_NOT_FOUND = 2012,
    /// A required tag is not present.
    TAG_NOT_PRESENT = 2013,
    /// The specified tag is already present.
    DUPLICATE_TAG = 2014,
    /// The specified color profile is not associated with the specified device.
    PROFILE_NOT_ASSOCIATED_WITH_DEVICE = 2015,
    /// The specified color profile was not found.
    PROFILE_NOT_FOUND = 2016,
    /// The specified color space is invalid.
    INVALID_COLORSPACE = 2017,
    /// Image Color Management is not enabled.
    ICM_NOT_ENABLED = 2018,
    /// There was an error while deleting the color transform.
    DELETING_ICM_XFORM = 2019,
    /// The specified color transform is invalid.
    INVALID_TRANSFORM = 2020,
    /// The specified transform does not match the bitmap's color space.
    COLORSPACE_MISMATCH = 2021,
    /// The specified named color index is not present in the profile.
    INVALID_COLORINDEX = 2022,
    /// The specified profile is intended for a device of a different type than the specified device.
    PROFILE_DOES_NOT_MATCH_DEVICE = 2023,
    /// The network connection was made successfully, but the user had to be prompted for a password other than the one originally specified.
    CONNECTED_OTHER_PASSWORD = 2108,
    /// The network connection was made successfully using default credentials.
    CONNECTED_OTHER_PASSWORD_DEFAULT = 2109,
    /// The specified username is invalid.
    BAD_USERNAME = 2202,
    /// This network connection does not exist.
    NOT_CONNECTED = 2250,
    /// This network connection has files open or requests pending.
    OPEN_FILES = 2401,
    /// Active connections still exist.
    ACTIVE_CONNECTIONS = 2402,
    /// The device is in use by an active process and cannot be disconnected.
    DEVICE_IN_USE = 2404,
    /// The specified print monitor is unknown.
    UNKNOWN_PRINT_MONITOR = 3000,
    /// The specified printer driver is currently in use.
    PRINTER_DRIVER_IN_USE = 3001,
    /// The spool file was not found.
    SPOOL_FILE_NOT_FOUND = 3002,
    /// A StartDocPrinter call was not issued.
    SPL_NO_STARTDOC = 3003,
    /// An AddJob call was not issued.
    SPL_NO_ADDJOB = 3004,
    /// The specified print processor has already been installed.
    PRINT_PROCESSOR_ALREADY_INSTALLED = 3005,
    /// The specified print monitor has already been installed.
    PRINT_MONITOR_ALREADY_INSTALLED = 3006,
    /// The specified print monitor does not have the required functions.
    INVALID_PRINT_MONITOR = 3007,
    /// The specified print monitor is currently in use.
    PRINT_MONITOR_IN_USE = 3008,
    /// The requested operation is not allowed when there are jobs queued to the printer.
    PRINTER_HAS_JOBS_QUEUED = 3009,
    /// The requested operation is successful.
    /// Changes will not be effective until the system is rebooted.
    SUCCESS_REBOOT_REQUIRED = 3010,
    /// The requested operation is successful.
    /// Changes will not be effective until the service is restarted.
    SUCCESS_RESTART_REQUIRED = 3011,
    /// No printers were found.
    PRINTER_NOT_FOUND = 3012,
    /// The printer driver is known to be unreliable.
    PRINTER_DRIVER_WARNED = 3013,
    /// The printer driver is known to harm the system.
    PRINTER_DRIVER_BLOCKED = 3014,
    /// The specified printer driver package is currently in use.
    PRINTER_DRIVER_PACKAGE_IN_USE = 3015,
    /// Unable to find a core driver package that is required by the printer driver package.
    CORE_DRIVER_PACKAGE_NOT_FOUND = 3016,
    /// The requested operation failed.
    /// A system reboot is required to roll back changes made.
    FAIL_REBOOT_REQUIRED = 3017,
    /// The requested operation failed.
    /// A system reboot has been initiated to roll back changes made.
    FAIL_REBOOT_INITIATED = 3018,
    /// The specified printer driver was not found on the system and needs to be downloaded.
    PRINTER_DRIVER_DOWNLOAD_NEEDED = 3019,
    /// The requested print job has failed to print.
    /// A print system update requires the job to be resubmitted.
    PRINT_JOB_RESTART_REQUIRED = 3020,
    /// The printer driver does not contain a valid manifest, or contains too many manifests.
    INVALID_PRINTER_DRIVER_MANIFEST = 3021,
    /// The specified printer cannot be shared.
    PRINTER_NOT_SHAREABLE = 3022,
    /// The operation was paused.
    REQUEST_PAUSED = 3050,
    /// Reissue the given operation as a cached IO operation.
    IO_REISSUE_AS_CACHED = 3950,
    _,

    /// An application attempts to use an event object, but the specified handle is not valid.
    pub const WSA_INVALID_HANDLE: Win32Error = @enumFromInt(6);

    /// An application used a Windows Sockets function that directly maps to a Windows function. The Windows function is indicating a lack of required memory resources.
    pub const WSA_NOT_ENOUGH_MEMORY: Win32Error = @enumFromInt(8);

    /// An application used a Windows Sockets function which directly maps to a Windows function. The Windows function is indicating a problem with one or more parameters.
    pub const WSA_INVALID_PARAMETER: Win32Error = @enumFromInt(87);

    /// An overlapped operation was canceled due to the closure of the socket, or the execution of the SIO_FLUSH command in WSAIoctl.
    pub const WSA_OPERATION_ABORTED: Win32Error = @enumFromInt(995);

    /// The application has tried to determine the status of an overlapped operation which is not yet completed. Applications that use WSAGetOverlappedResult (with the fWait flag set to FALSE) in a polling mode to determine when an overlapped operation has completed, get this error code until the operation is complete.
    pub const WSA_IO_INCOMPLETE: Win32Error = @enumFromInt(996);

    /// The application has initiated an overlapped operation that cannot be completed immediately. A completion indication will be given later when the operation has been completed.
    pub const WSA_IO_PENDING: Win32Error = @enumFromInt(997);

    /// A blocking operation was interrupted by a call to WSACancelBlockingCall.
    pub const WSAEINTR: Win32Error = @enumFromInt(10004);

    /// The file handle supplied is not valid.
    pub const WSAEBADF: Win32Error = @enumFromInt(10009);

    /// An attempt was made to access a socket in a way forbidden by its access permissions. An example is using a broadcast address for sendto without broadcast permission being set using setsockopt(SO_BROADCAST).
    /// Another possible reason for the WSAEACCES error is that when the bind function is called (on Windows NT 4.0 with SP4 and later), another application, service, or kernel mode driver is bound to the same address with exclusive access. Such exclusive access is a new feature of Windows NT 4.0 with SP4 and later, and is implemented by using the SO_EXCLUSIVEADDRUSE option.
    pub const WSAEACCES: Win32Error = @enumFromInt(10013);

    /// The system detected an invalid pointer address in attempting to use a pointer argument of a call. This error occurs if an application passes an invalid pointer value, or if the length of the buffer is too small. For instance, if the length of an argument, which is a sockaddr structure, is smaller than the sizeof(sockaddr).
    pub const WSAEFAULT: Win32Error = @enumFromInt(10014);

    /// Some invalid argument was supplied (for example, specifying an invalid level to the setsockopt function). In some instances, it also refers to the current state of the socket—for instance, calling accept on a socket that is not listening.
    pub const WSAEINVAL: Win32Error = @enumFromInt(10022);

    /// Too many open sockets. Each implementation may have a maximum number of socket handles available, either globally, per process, or per thread.
    pub const WSAEMFILE: Win32Error = @enumFromInt(10024);

    /// This error is returned from operations on nonblocking sockets that cannot be completed immediately, for example recv when no data is queued to be read from the socket. It is a nonfatal error, and the operation should be retried later. It is normal for WSAEWOULDBLOCK to be reported as the result from calling connect on a nonblocking SOCK_STREAM socket, since some time must elapse for the connection to be established.
    pub const WSAEWOULDBLOCK: Win32Error = @enumFromInt(10035);

    /// A blocking operation is currently executing. Windows Sockets only allows a single blocking operation—per- task or thread—to be outstanding, and if any other function call is made (whether or not it references that or any other socket) the function fails with the WSAEINPROGRESS error.
    pub const WSAEINPROGRESS: Win32Error = @enumFromInt(10036);

    /// An operation was attempted on a nonblocking socket with an operation already in progress—that is, calling connect a second time on a nonblocking socket that is already connecting, or canceling an asynchronous request (WSAAsyncGetXbyY) that has already been canceled or completed.
    pub const WSAEALREADY: Win32Error = @enumFromInt(10037);

    /// An operation was attempted on something that is not a socket. Either the socket handle parameter did not reference a valid socket, or for select, a member of an fd_set was not valid.
    pub const WSAENOTSOCK: Win32Error = @enumFromInt(10038);

    /// A required address was omitted from an operation on a socket. For example, this error is returned if sendto is called with the remote address of ADDR_ANY.
    pub const WSAEDESTADDRREQ: Win32Error = @enumFromInt(10039);

    /// A message sent on a datagram socket was larger than the internal message buffer or some other network limit, or the buffer used to receive a datagram was smaller than the datagram itself.
    pub const WSAEMSGSIZE: Win32Error = @enumFromInt(10040);

    /// A protocol was specified in the socket function call that does not support the semantics of the socket type requested. For example, the ARPA Internet UDP protocol cannot be specified with a socket type of SOCK_STREAM.
    pub const WSAEPROTOTYPE: Win32Error = @enumFromInt(10041);

    /// An unknown, invalid or unsupported option or level was specified in a getsockopt or setsockopt call.
    pub const WSAENOPROTOOPT: Win32Error = @enumFromInt(10042);

    /// The requested protocol has not been configured into the system, or no implementation for it exists. For example, a socket call requests a SOCK_DGRAM socket, but specifies a stream protocol.
    pub const WSAEPROTONOSUPPORT: Win32Error = @enumFromInt(10043);

    /// The support for the specified socket type does not exist in this address family. For example, the optional type SOCK_RAW might be selected in a socket call, and the implementation does not support SOCK_RAW sockets at all.
    pub const WSAESOCKTNOSUPPORT: Win32Error = @enumFromInt(10044);

    /// The attempted operation is not supported for the type of object referenced. Usually this occurs when a socket descriptor to a socket that cannot support this operation is trying to accept a connection on a datagram socket.
    pub const WSAEOPNOTSUPP: Win32Error = @enumFromInt(10045);

    /// The protocol family has not been configured into the system or no implementation for it exists. This message has a slightly different meaning from WSAEAFNOSUPPORT. However, it is interchangeable in most cases, and all Windows Sockets functions that return one of these messages also specify WSAEAFNOSUPPORT.
    pub const WSAEPFNOSUPPORT: Win32Error = @enumFromInt(10046);

    /// An address incompatible with the requested protocol was used. All sockets are created with an associated address family (that is, AF_INET for Internet Protocols) and a generic protocol type (that is, SOCK_STREAM). This error is returned if an incorrect protocol is explicitly requested in the socket call, or if an address of the wrong family is used for a socket, for example, in sendto.
    pub const WSAEAFNOSUPPORT: Win32Error = @enumFromInt(10047);

    /// Typically, only one usage of each socket address (protocol/IP address/port) is permitted. This error occurs if an application attempts to bind a socket to an IP address/port that has already been used for an existing socket, or a socket that was not closed properly, or one that is still in the process of closing. For server applications that need to bind multiple sockets to the same port number, consider using setsockopt (SO_REUSEADDR). Client applications usually need not call bind at all—connect chooses an unused port automatically. When bind is called with a wildcard address (involving ADDR_ANY), a WSAEADDRINUSE error could be delayed until the specific address is committed. This could happen with a call to another function later, including connect, listen, WSAConnect, or WSAJoinLeaf.
    pub const WSAEADDRINUSE: Win32Error = @enumFromInt(10048);

    /// The requested address is not valid in its context. This normally results from an attempt to bind to an address that is not valid for the local computer. This can also result from connect, sendto, WSAConnect, WSAJoinLeaf, or WSASendTo when the remote address or port is not valid for a remote computer (for example, address or port 0).
    pub const WSAEADDRNOTAVAIL: Win32Error = @enumFromInt(10049);

    /// A socket operation encountered a dead network. This could indicate a serious failure of the network system (that is, the protocol stack that the Windows Sockets DLL runs over), the network interface, or the local network itself.
    pub const WSAENETDOWN: Win32Error = @enumFromInt(10050);

    /// A socket operation was attempted to an unreachable network. This usually means the local software knows no route to reach the remote host.
    pub const WSAENETUNREACH: Win32Error = @enumFromInt(10051);

    /// The connection has been broken due to keep-alive activity detecting a failure while the operation was in progress. It can also be returned by setsockopt if an attempt is made to set SO_KEEPALIVE on a connection that has already failed.
    pub const WSAENETRESET: Win32Error = @enumFromInt(10052);

    /// An established connection was aborted by the software in your host computer, possibly due to a data transmission time-out or protocol error.
    pub const WSAECONNABORTED: Win32Error = @enumFromInt(10053);

    /// An existing connection was forcibly closed by the remote host. This normally results if the peer application on the remote host is suddenly stopped, the host is rebooted, the host or remote network interface is disabled, or the remote host uses a hard close (see setsockopt for more information on the SO_LINGER option on the remote socket). This error may also result if a connection was broken due to keep-alive activity detecting a failure while one or more operations are in progress. Operations that were in progress fail with WSAENETRESET. Subsequent operations fail with WSAECONNRESET.
    pub const WSAECONNRESET: Win32Error = @enumFromInt(10054);

    /// An operation on a socket could not be performed because the system lacked sufficient buffer space or because a queue was full.
    pub const WSAENOBUFS: Win32Error = @enumFromInt(10055);

    /// A connect request was made on an already-connected socket. Some implementations also return this error if sendto is called on a connected SOCK_DGRAM socket (for SOCK_STREAM sockets, the to parameter in sendto is ignored) although other implementations treat this as a legal occurrence.
    pub const WSAEISCONN: Win32Error = @enumFromInt(10056);

    /// A request to send or receive data was disallowed because the socket is not connected and (when sending on a datagram socket using sendto) no address was supplied. Any other type of operation might also return this error—for example, setsockopt setting SO_KEEPALIVE if the connection has been reset.
    pub const WSAENOTCONN: Win32Error = @enumFromInt(10057);

    /// A request to send or receive data was disallowed because the socket had already been shut down in that direction with a previous shutdown call. By calling shutdown a partial close of a socket is requested, which is a signal that sending or receiving, or both have been discontinued.
    pub const WSAESHUTDOWN: Win32Error = @enumFromInt(10058);

    /// Too many references to some kernel object.
    pub const WSAETOOMANYREFS: Win32Error = @enumFromInt(10059);

    /// A connection attempt failed because the connected party did not properly respond after a period of time, or the established connection failed because the connected host has failed to respond.
    pub const WSAETIMEDOUT: Win32Error = @enumFromInt(10060);

    /// No connection could be made because the target computer actively refused it. This usually results from trying to connect to a service that is inactive on the foreign host—that is, one with no server application running.
    pub const WSAECONNREFUSED: Win32Error = @enumFromInt(10061);

    /// Cannot translate a name.
    pub const WSAELOOP: Win32Error = @enumFromInt(10062);

    /// A name component or a name was too long.
    pub const WSAENAMETOOLONG: Win32Error = @enumFromInt(10063);

    /// A socket operation failed because the destination host is down. A socket operation encountered a dead host. Networking activity on the local host has not been initiated. These conditions are more likely to be indicated by the error WSAETIMEDOUT.
    pub const WSAEHOSTDOWN: Win32Error = @enumFromInt(10064);

    /// A socket operation was attempted to an unreachable host. See WSAENETUNREACH.
    pub const WSAEHOSTUNREACH: Win32Error = @enumFromInt(10065);

    /// Cannot remove a directory that is not empty.
    pub const WSAENOTEMPTY: Win32Error = @enumFromInt(10066);

    /// A Windows Sockets implementation may have a limit on the number of applications that can use it simultaneously. WSAStartup may fail with this error if the limit has been reached.
    pub const WSAEPROCLIM: Win32Error = @enumFromInt(10067);

    /// Ran out of user quota.
    pub const WSAEUSERS: Win32Error = @enumFromInt(10068);

    /// Ran out of disk quota.
    pub const WSAEDQUOT: Win32Error = @enumFromInt(10069);

    /// The file handle reference is no longer available.
    pub const WSAESTALE: Win32Error = @enumFromInt(10070);

    /// The item is not available locally.
    pub const WSAEREMOTE: Win32Error = @enumFromInt(10071);

    /// This error is returned by WSAStartup if the Windows Sockets implementation cannot function at this time because the underlying system it uses to provide network services is currently unavailable. Users should check:
    pub const WSASYSNOTREADY: Win32Error = @enumFromInt(10091);

    /// The current Windows Sockets implementation does not support the Windows Sockets specification version requested by the application. Check that no old Windows Sockets DLL files are being accessed.
    pub const WSAVERNOTSUPPORTED: Win32Error = @enumFromInt(10092);

    /// Either the application has not called WSAStartup or WSAStartup failed. The application may be accessing a socket that the current active task does not own (that is, trying to share a socket between tasks), or WSACleanup has been called too many times.
    pub const WSANOTINITIALISED: Win32Error = @enumFromInt(10093);

    /// Returned by WSARecv and WSARecvFrom to indicate that the remote party has initiated a graceful shutdown sequence.
    pub const WSAEDISCON: Win32Error = @enumFromInt(10101);

    /// No more results can be returned by the WSALookupServiceNext function.
    pub const WSAENOMORE: Win32Error = @enumFromInt(10102);

    /// A call to the WSALookupServiceEnd function was made while this call was still processing. The call has been canceled.
    pub const WSAECANCELLED: Win32Error = @enumFromInt(10103);

    /// The service provider procedure call table is invalid. A service provider returned a bogus procedure table to Ws2_32.dll. This is usually caused by one or more of the function pointers being NULL.
    pub const WSAEINVALIDPROCTABLE: Win32Error = @enumFromInt(10104);

    /// The requested service provider is invalid. This error is returned by the WSCGetProviderInfo and WSCGetProviderInfo32 functions if the protocol entry specified could not be found. This error is also returned if the service provider returned a version number other than 2.0.
    pub const WSAEINVALIDPROVIDER: Win32Error = @enumFromInt(10105);

    /// The requested service provider could not be loaded or initialized. This error is returned if either a service provider's DLL could not be loaded (LoadLibrary failed) or the provider's WSPStartup or NSPStartup function failed.
    pub const WSAEPROVIDERFAILEDINIT: Win32Error = @enumFromInt(10106);

    /// A system call that should never fail has failed. This is a generic error code, returned under various conditions.
    /// Returned when a system call that should never fail does fail. For example, if a call to WaitForMultipleEvents fails or one of the registry functions fails trying to manipulate the protocol/namespace catalogs.
    /// Returned when a provider does not return SUCCESS and does not provide an extended error code. Can indicate a service provider implementation error.
    pub const WSASYSCALLFAILURE: Win32Error = @enumFromInt(10107);

    /// No such service is known. The service cannot be found in the specified name space.
    pub const WSASERVICE_NOT_FOUND: Win32Error = @enumFromInt(10108);

    /// The specified class was not found.
    pub const WSATYPE_NOT_FOUND: Win32Error = @enumFromInt(10109);

    /// No more results can be returned by the WSALookupServiceNext function.
    pub const WSA_E_NO_MORE: Win32Error = @enumFromInt(10110);

    /// A call to the WSALookupServiceEnd function was made while this call was still processing. The call has been canceled.
    pub const WSA_E_CANCELLED: Win32Error = @enumFromInt(10111);

    /// A database query failed because it was actively refused.
    pub const WSAEREFUSED: Win32Error = @enumFromInt(10112);

    /// No such host is known. The name is not an official host name or alias, or it cannot be found in the database(s) being queried. This error may also be returned for protocol and service queries, and means that the specified name could not be found in the relevant database.
    pub const WSAHOST_NOT_FOUND: Win32Error = @enumFromInt(11001);

    /// This is usually a temporary error during host name resolution and means that the local server did not receive a response from an authoritative server. A retry at some time later may be successful.
    pub const WSATRY_AGAIN: Win32Error = @enumFromInt(11002);

    /// This indicates that some sort of nonrecoverable error occurred during a database lookup. This may be because the database files (for example, BSD-compatible HOSTS, SERVICES, or PROTOCOLS files) could not be found, or a DNS request was returned by the server with a severe error.
    pub const WSANO_RECOVERY: Win32Error = @enumFromInt(11003);

    /// The requested name is valid and was found in the database, but it does not have the correct associated data being resolved for. The usual example for this is a host name-to-address translation attempt (using gethostbyname or WSAAsyncGetHostByName) which uses the DNS (Domain Name Server). An MX record is returned but no A record—indicating the host itself exists, but is not directly reachable.
    pub const WSANO_DATA: Win32Error = @enumFromInt(11004);

    /// At least one QoS reserve has arrived.
    pub const WSA_QOS_RECEIVERS: Win32Error = @enumFromInt(11005);

    /// At least one QoS send path has arrived.
    pub const WSA_QOS_SENDERS: Win32Error = @enumFromInt(11006);

    /// There are no QoS senders.
    pub const WSA_QOS_NO_SENDERS: Win32Error = @enumFromInt(11007);

    /// There are no QoS receivers.
    pub const WSA_QOS_NO_RECEIVERS: Win32Error = @enumFromInt(11008);

    /// The QoS reserve request has been confirmed.
    pub const WSA_QOS_REQUEST_CONFIRMED: Win32Error = @enumFromInt(11009);

    /// A QoS error occurred due to lack of resources.
    pub const WSA_QOS_ADMISSION_FAILURE: Win32Error = @enumFromInt(11010);

    /// The QoS request was rejected because the policy system couldn't allocate the requested resource within the existing policy.
    pub const WSA_QOS_POLICY_FAILURE: Win32Error = @enumFromInt(11011);

    /// An unknown or conflicting QoS style was encountered.
    pub const WSA_QOS_BAD_STYLE: Win32Error = @enumFromInt(11012);

    /// A problem was encountered with some part of the filterspec or the provider-specific buffer in general.
    pub const WSA_QOS_BAD_OBJECT: Win32Error = @enumFromInt(11013);

    /// An error with the underlying traffic control (TC) API as the generic QoS request was converted for local enforcement by the TC API. This could be due to an out of memory error or to an internal QoS provider error.
    pub const WSA_QOS_TRAFFIC_CTRL_ERROR: Win32Error = @enumFromInt(11014);

    /// A general QoS error.
    pub const WSA_QOS_GENERIC_ERROR: Win32Error = @enumFromInt(11015);

    /// An invalid or unrecognized service type was found in the QoS flowspec.
    pub const WSA_QOS_ESERVICETYPE: Win32Error = @enumFromInt(11016);

    /// An invalid or inconsistent flowspec was found in the QOS structure.
    pub const WSA_QOS_EFLOWSPEC: Win32Error = @enumFromInt(11017);

    /// An invalid QoS provider-specific buffer.
    pub const WSA_QOS_EPROVSPECBUF: Win32Error = @enumFromInt(11018);

    /// An invalid QoS filter style was used.
    pub const WSA_QOS_EFILTERSTYLE: Win32Error = @enumFromInt(11019);

    /// An invalid QoS filter type was used.
    pub const WSA_QOS_EFILTERTYPE: Win32Error = @enumFromInt(11020);

    /// An incorrect number of QoS FILTERSPECs were specified in the FLOWDESCRIPTOR.
    pub const WSA_QOS_EFILTERCOUNT: Win32Error = @enumFromInt(11021);

    /// An object with an invalid ObjectLength field was specified in the QoS provider-specific buffer.
    pub const WSA_QOS_EOBJLENGTH: Win32Error = @enumFromInt(11022);

    /// An incorrect number of flow descriptors was specified in the QoS structure.
    pub const WSA_QOS_EFLOWCOUNT: Win32Error = @enumFromInt(11023);

    /// An unrecognized object was found in the QoS provider-specific buffer.
    pub const WSA_QOS_EUNKOWNPSOBJ: Win32Error = @enumFromInt(11024);

    /// An invalid policy object was found in the QoS provider-specific buffer.
    pub const WSA_QOS_EPOLICYOBJ: Win32Error = @enumFromInt(11025);

    /// An invalid QoS flow descriptor was found in the flow descriptor list.
    pub const WSA_QOS_EFLOWDESC: Win32Error = @enumFromInt(11026);

    /// An invalid or inconsistent flowspec was found in the QoS provider-specific buffer.
    pub const WSA_QOS_EPSFLOWSPEC: Win32Error = @enumFromInt(11027);

    /// An invalid FILTERSPEC was found in the QoS provider-specific buffer.
    pub const WSA_QOS_EPSFILTERSPEC: Win32Error = @enumFromInt(11028);

    /// An invalid shape discard mode object was found in the QoS provider-specific buffer.
    pub const WSA_QOS_ESDMODEOBJ: Win32Error = @enumFromInt(11029);

    /// An invalid shaping rate object was found in the QoS provider-specific buffer.
    pub const WSA_QOS_ESHAPERATEOBJ: Win32Error = @enumFromInt(11030);

    /// A reserved policy element was found in the QoS provider-specific buffer.
    pub const WSA_QOS_RESERVED_PETYPE: Win32Error = @enumFromInt(11031);

    pub fn get() Win32Error {
        return @enumFromInt(@intFromEnum(bun.windows.kernel32.GetLastError()));
    }

    pub fn int(this: Win32Error) u16 {
        return @intFromEnum(this);
    }

    pub fn unwrap(this: @This()) !void {
        if (this == .SUCCESS) return;
        if (this.toSystemErrno()) |err| {
            return err.toError();
        }
    }

    pub fn toSystemErrno(this: Win32Error) ?SystemErrno {
        return SystemErrno.init(this);
    }

    pub fn fromNTStatus(status: win32.NTSTATUS) Win32Error {
        return RtlNtStatusToDosError(status);
    }
};

pub const libuv = @import("./deps/libuv.zig");

pub extern fn GetProcAddress(
    ptr: ?*anyopaque,
    [*:0]const u16,
) ?*anyopaque;

pub fn GetProcAddressA(
    ptr: ?*anyopaque,
    utf8: [:0]const u8,
) ?*anyopaque {
    var wbuf: [2048]u16 = undefined;
    return GetProcAddress(ptr, bun.strings.toWPath(&wbuf, utf8).ptr);
}

pub extern fn LoadLibraryA(
    [*:0]const u8,
) ?*anyopaque;

pub const CreateHardLinkW = struct {
    pub fn wrapper(newFileName: LPCWSTR, existingFileName: LPCWSTR, securityAttributes: ?*win32.SECURITY_ATTRIBUTES) BOOL {
        const run = struct {
            pub extern "kernel32" fn CreateHardLinkW(
                newFileName: LPCWSTR,
                existingFileName: LPCWSTR,
                securityAttributes: ?*win32.SECURITY_ATTRIBUTES,
            ) BOOL;
        }.CreateHardLinkW;

        const rc = run(newFileName, existingFileName, securityAttributes);
        if (comptime Environment.isDebug)
            bun.sys.syslog(
                "CreateHardLinkW({f}, {f}) = {d}",
                .{
                    bun.fmt.fmtOSPath(std.mem.span(newFileName), .{}),
                    bun.fmt.fmtOSPath(std.mem.span(existingFileName), .{}),
                    if (rc == 0) @intFromEnum(Win32Error.get()) else 0,
                },
            );
        return rc;
    }
}.wrapper;

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

pub fn getLastErrno() bun.sys.E {
    return (bun.sys.SystemErrno.init(bun.windows.kernel32.GetLastError()) orelse SystemErrno.EUNKNOWN).toE();
}

pub fn getLastError() anyerror {
    return bun.errnoToZigErr(getLastErrno());
}

pub fn translateNTStatusToErrno(err: win32.NTSTATUS) bun.sys.E {
    return switch (err) {
        .SUCCESS => .SUCCESS,
        .ACCESS_DENIED => .PERM,
        .INVALID_HANDLE => .BADF,
        .INVALID_PARAMETER => .INVAL,
        .OBJECT_NAME_COLLISION => .EXIST,
        .FILE_IS_A_DIRECTORY => .ISDIR,
        .OBJECT_PATH_NOT_FOUND => .NOENT,
        .OBJECT_NAME_NOT_FOUND => .NOENT,
        .NOT_A_DIRECTORY => .NOTDIR,
        .RETRY => .AGAIN,
        .DIRECTORY_NOT_EMPTY => .NOTEMPTY,
        .FILE_TOO_LARGE => .@"2BIG",
        .NOT_SAME_DEVICE => .XDEV,
        .DELETE_PENDING => .BUSY,
        .SHARING_VIOLATION => if (comptime Environment.isDebug) brk: {
            bun.Output.debugWarn("Received SHARING_VIOLATION, indicates file handle should've been opened with FILE_SHARE_DELETE", .{});
            break :brk .BUSY;
        } else .BUSY,
        .OBJECT_NAME_INVALID => if (comptime Environment.isDebug) brk: {
            bun.Output.debugWarn("Received OBJECT_NAME_INVALID, indicates a file path conversion issue.", .{});
            bun.crash_handler.dumpCurrentStackTrace(null, .{ .frame_count = 10 });
            break :brk .INVAL;
        } else .INVAL,

        else => |t| {
            if (bun.Environment.isDebug) {
                bun.Output.warn("Called translateNTStatusToErrno with {s} which does not have a mapping to errno.", .{@tagName(t)});
                bun.crash_handler.dumpCurrentStackTrace(null, .{ .frame_count = 10 });
            }
            return .UNKNOWN;
        },
    };
}

pub extern "kernel32" fn GetHostNameW(
    lpBuffer: PWSTR,
    nSize: c_int,
) callconv(.winapi) BOOL;

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw
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

pub const JOBOBJECT_ASSOCIATE_COMPLETION_PORT = extern struct {
    CompletionKey: windows.PVOID,
    CompletionPort: HANDLE,
};

pub const JOBOBJECT_EXTENDED_LIMIT_INFORMATION = extern struct {
    BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
    ///Reserved
    IoInfo: IO_COUNTERS,
    ProcessMemoryLimit: usize,
    JobMemoryLimit: usize,
    PeakProcessMemoryUsed: usize,
    PeakJobMemoryUsed: usize,
};

pub const IO_COUNTERS = extern struct {
    ReadOperationCount: ULONGLONG,
    WriteOperationCount: ULONGLONG,
    OtherOperationCount: ULONGLONG,
    ReadTransferCount: ULONGLONG,
    WriteTransferCount: ULONGLONG,
    OtherTransferCount: ULONGLONG,
};

pub const JOBOBJECT_BASIC_LIMIT_INFORMATION = extern struct {
    PerProcessUserTimeLimit: LARGE_INTEGER,
    PerJobUserTimeLimit: LARGE_INTEGER,
    LimitFlags: DWORD,
    MinimumWorkingSetSize: usize,
    MaximumWorkingSetSize: usize,
    ActiveProcessLimit: DWORD,
    Affinity: *ULONG,
    PriorityClass: DWORD,
    SchedulingClass: DWORD,
};

pub const JobObjectAssociateCompletionPortInformation: DWORD = 7;
pub const JobObjectExtendedLimitInformation: DWORD = 9;

pub extern "kernel32" fn SetInformationJobObject(
    hJob: HANDLE,
    JobObjectInformationClass: DWORD,
    lpJobObjectInformation: LPVOID,
    cbJobObjectInformationLength: DWORD,
) callconv(.winapi) BOOL;

// Found experimentally:
// #include <stdio.h>
// #include <windows.h>
//
// int main() {
//         printf("%ld\n", JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO);
//         printf("%ld\n", JOB_OBJECT_MSG_EXIT_PROCESS);
// }
//
// Output:
// 4
// 7
pub const JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO = 4;
pub const JOB_OBJECT_MSG_EXIT_PROCESS = 7;

pub extern "kernel32" fn OpenProcess(
    dwDesiredAccess: DWORD,
    bInheritHandle: BOOL,
    dwProcessId: DWORD,
) callconv(.winapi) ?HANDLE;

// https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights
pub const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;

pub fn exePathW() [:0]const u16 {
    const image_path_unicode_string = &std.os.windows.peb().ProcessParameters.ImagePathName;
    return image_path_unicode_string.Buffer.?[0 .. image_path_unicode_string.Length / 2 :0];
}

pub const KEY_EVENT_RECORD = extern struct {
    bKeyDown: BOOL,
    wRepeatCount: WORD,
    wVirtualKeyCode: WORD,
    wVirtualScanCode: WORD,
    uChar: extern union {
        UnicodeChar: WCHAR,
        AsciiChar: CHAR,
    },
    dwControlKeyState: DWORD,
};

pub const MOUSE_EVENT_RECORD = extern struct {
    dwMousePosition: COORD,
    dwButtonState: COORD,
    dwControlKeyState: DWORD,
    dwEventFlags: DWORD,
};

pub const WINDOW_BUFFER_SIZE_EVENT = extern struct {
    dwSize: COORD,
};

pub const MENU_EVENT_RECORD = extern struct {
    dwCommandId: UINT,
};

pub const FOCUS_EVENT_RECORD = extern struct {
    bSetFocus: BOOL,
};

pub const INPUT_RECORD = extern struct {
    EventType: WORD,
    Event: extern union {
        KeyEvent: KEY_EVENT_RECORD,
        MouseEvent: MOUSE_EVENT_RECORD,
        WindowBufferSizeEvent: WINDOW_BUFFER_SIZE_EVENT,
        MenuEvent: MENU_EVENT_RECORD,
        FocusEvent: FOCUS_EVENT_RECORD,
    },
};

fn Bun__UVSignalHandle__init(
    global: *bun.jsc.JSGlobalObject,
    signal_num: i32,
    callback: *const fn (sig: *libuv.uv_signal_t, num: c_int) callconv(.c) void,
) callconv(.c) ?*libuv.uv_signal_t {
    const signal = bun.new(libuv.uv_signal_t, undefined);

    var rc = libuv.uv_signal_init(global.bunVM().uvLoop(), signal);
    if (rc.errno()) |_| {
        bun.destroy(signal);
        return null;
    }

    rc = libuv.uv_signal_start(signal, callback, signal_num);
    if (rc.errno()) |_| {
        libuv.uv_close(@ptrCast(signal), &freeWithDefaultAllocator);
        return null;
    }

    libuv.uv_unref(@ptrCast(signal));

    return signal;
}

fn freeWithDefaultAllocator(signal: *anyopaque) callconv(.c) void {
    bun.destroy(@as(*libuv.uv_signal_t, @ptrCast(@alignCast(signal))));
}

fn Bun__UVSignalHandle__close(signal: *libuv.uv_signal_t) callconv(.c) void {
    _ = libuv.uv_signal_stop(signal);
    libuv.uv_close(@ptrCast(signal), &freeWithDefaultAllocator);
}

comptime {
    if (Environment.isWindows) {
        @export(&Bun__UVSignalHandle__init, .{ .name = "Bun__UVSignalHandle__init" });
        @export(&Bun__UVSignalHandle__close, .{ .name = "Bun__UVSignalHandle__close" });
        @export(&@"windows process.dlopen", .{ .name = "Bun__LoadLibraryBunString" });
    }
}

extern fn GetUserNameW(
    lpBuffer: bun.windows.LPWSTR,
    pcbBuffer: bun.windows.LPDWORD,
) bun.windows.BOOL;

/// Is not the actual UID of the user, but just a hash of username.
pub fn userUniqueId() u32 {
    // https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tsch/165836c1-89d7-4abb-840d-80cf2510aa3e
    // UNLEN + 1
    var buf: [257]u16 = undefined;
    var size: u32 = buf.len;
    if (GetUserNameW(@ptrCast(&buf), &size) == 0) {
        if (Environment.isDebug) std.debug.panic("GetUserNameW failed: {}", .{bun.windows.GetLastError()});
        return 0;
    }
    const name = buf[0..size];
    bun.Output.scoped(.windowsUserUniqueId, .visible)("username: {f}", .{bun.fmt.utf16(name)});
    return bun.hash32(std.mem.sliceAsBytes(name));
}

pub fn winSockErrorToZigError(err: std.os.windows.ws2_32.WinsockError) !void {
    return switch (err) {
        // TODO: use `inline else` if https://github.com/ziglang/zig/issues/12250 is accepted
        .WSA_INVALID_HANDLE => error.WSA_INVALID_HANDLE,
        .WSA_NOT_ENOUGH_MEMORY => error.WSA_NOT_ENOUGH_MEMORY,
        .WSA_INVALID_PARAMETER => error.WSA_INVALID_PARAMETER,
        .WSA_OPERATION_ABORTED => error.WSA_OPERATION_ABORTED,
        .WSA_IO_INCOMPLETE => error.WSA_IO_INCOMPLETE,
        .WSA_IO_PENDING => error.WSA_IO_PENDING,
        .WSAEINTR => error.WSAEINTR,
        .WSAEBADF => error.WSAEBADF,
        .WSAEACCES => error.WSAEACCES,
        .WSAEFAULT => error.WSAEFAULT,
        .WSAEINVAL => error.WSAEINVAL,
        .WSAEMFILE => error.WSAEMFILE,
        .WSAEWOULDBLOCK => error.WSAEWOULDBLOCK,
        .WSAEINPROGRESS => error.WSAEINPROGRESS,
        .WSAEALREADY => error.WSAEALREADY,
        .WSAENOTSOCK => error.WSAENOTSOCK,
        .WSAEDESTADDRREQ => error.WSAEDESTADDRREQ,
        .WSAEMSGSIZE => error.WSAEMSGSIZE,
        .WSAEPROTOTYPE => error.WSAEPROTOTYPE,
        .WSAENOPROTOOPT => error.WSAENOPROTOOPT,
        .WSAEPROTONOSUPPORT => error.WSAEPROTONOSUPPORT,
        .WSAESOCKTNOSUPPORT => error.WSAESOCKTNOSUPPORT,
        .WSAEOPNOTSUPP => error.WSAEOPNOTSUPP,
        .WSAEPFNOSUPPORT => error.WSAEPFNOSUPPORT,
        .WSAEAFNOSUPPORT => error.WSAEAFNOSUPPORT,
        .WSAEADDRINUSE => error.WSAEADDRINUSE,
        .WSAEADDRNOTAVAIL => error.WSAEADDRNOTAVAIL,
        .WSAENETDOWN => error.WSAENETDOWN,
        .WSAENETUNREACH => error.WSAENETUNREACH,
        .WSAENETRESET => error.WSAENETRESET,
        .WSAECONNABORTED => error.WSAECONNABORTED,
        .WSAECONNRESET => error.WSAECONNRESET,
        .WSAENOBUFS => error.WSAENOBUFS,
        .WSAEISCONN => error.WSAEISCONN,
        .WSAENOTCONN => error.WSAENOTCONN,
        .WSAESHUTDOWN => error.WSAESHUTDOWN,
        .WSAETOOMANYREFS => error.WSAETOOMANYREFS,
        .WSAETIMEDOUT => error.WSAETIMEDOUT,
        .WSAECONNREFUSED => error.WSAECONNREFUSED,
        .WSAELOOP => error.WSAELOOP,
        .WSAENAMETOOLONG => error.WSAENAMETOOLONG,
        .WSAEHOSTDOWN => error.WSAEHOSTDOWN,
        .WSAEHOSTUNREACH => error.WSAEHOSTUNREACH,
        .WSAENOTEMPTY => error.WSAENOTEMPTY,
        .WSAEPROCLIM => error.WSAEPROCLIM,
        .WSAEUSERS => error.WSAEUSERS,
        .WSAEDQUOT => error.WSAEDQUOT,
        .WSAESTALE => error.WSAESTALE,
        .WSAEREMOTE => error.WSAEREMOTE,
        .WSASYSNOTREADY => error.WSASYSNOTREADY,
        .WSAVERNOTSUPPORTED => error.WSAVERNOTSUPPORTED,
        .WSANOTINITIALISED => error.WSANOTINITIALISED,
        .WSAEDISCON => error.WSAEDISCON,
        .WSAENOMORE => error.WSAENOMORE,
        .WSAECANCELLED => error.WSAECANCELLED,
        .WSAEINVALIDPROCTABLE => error.WSAEINVALIDPROCTABLE,
        .WSAEINVALIDPROVIDER => error.WSAEINVALIDPROVIDER,
        .WSAEPROVIDERFAILEDINIT => error.WSAEPROVIDERFAILEDINIT,
        .WSASYSCALLFAILURE => error.WSASYSCALLFAILURE,
        .WSASERVICE_NOT_FOUND => error.WSASERVICE_NOT_FOUND,
        .WSATYPE_NOT_FOUND => error.WSATYPE_NOT_FOUND,
        .WSA_E_NO_MORE => error.WSA_E_NO_MORE,
        .WSA_E_CANCELLED => error.WSA_E_CANCELLED,
        .WSAEREFUSED => error.WSAEREFUSED,
        .WSAHOST_NOT_FOUND => error.WSAHOST_NOT_FOUND,
        .WSATRY_AGAIN => error.WSATRY_AGAIN,
        .WSANO_RECOVERY => error.WSANO_RECOVERY,
        .WSANO_DATA => error.WSANO_DATA,
        .WSA_QOS_RECEIVERS => error.WSA_QOS_RECEIVERS,
        .WSA_QOS_SENDERS => error.WSA_QOS_SENDERS,
        .WSA_QOS_NO_SENDERS => error.WSA_QOS_NO_SENDERS,
        .WSA_QOS_NO_RECEIVERS => error.WSA_QOS_NO_RECEIVERS,
        .WSA_QOS_REQUEST_CONFIRMED => error.WSA_QOS_REQUEST_CONFIRMED,
        .WSA_QOS_ADMISSION_FAILURE => error.WSA_QOS_ADMISSION_FAILURE,
        .WSA_QOS_POLICY_FAILURE => error.WSA_QOS_POLICY_FAILURE,
        .WSA_QOS_BAD_STYLE => error.WSA_QOS_BAD_STYLE,
        .WSA_QOS_BAD_OBJECT => error.WSA_QOS_BAD_OBJECT,
        .WSA_QOS_TRAFFIC_CTRL_ERROR => error.WSA_QOS_TRAFFIC_CTRL_ERROR,
        .WSA_QOS_GENERIC_ERROR => error.WSA_QOS_GENERIC_ERROR,
        .WSA_QOS_ESERVICETYPE => error.WSA_QOS_ESERVICETYPE,
        .WSA_QOS_EFLOWSPEC => error.WSA_QOS_EFLOWSPEC,
        .WSA_QOS_EPROVSPECBUF => error.WSA_QOS_EPROVSPECBUF,
        .WSA_QOS_EFILTERSTYLE => error.WSA_QOS_EFILTERSTYLE,
        .WSA_QOS_EFILTERTYPE => error.WSA_QOS_EFILTERTYPE,
        .WSA_QOS_EFILTERCOUNT => error.WSA_QOS_EFILTERCOUNT,
        .WSA_QOS_EOBJLENGTH => error.WSA_QOS_EOBJLENGTH,
        .WSA_QOS_EFLOWCOUNT => error.WSA_QOS_EFLOWCOUNT,
        .WSA_QOS_EUNKOWNPSOBJ => error.WSA_QOS_EUNKOWNPSOBJ,
        .WSA_QOS_EPOLICYOBJ => error.WSA_QOS_EPOLICYOBJ,
        .WSA_QOS_EFLOWDESC => error.WSA_QOS_EFLOWDESC,
        .WSA_QOS_EPSFLOWSPEC => error.WSA_QOS_EPSFLOWSPEC,
        .WSA_QOS_EPSFILTERSPEC => error.WSA_QOS_EPSFILTERSPEC,
        .WSA_QOS_ESDMODEOBJ => error.WSA_QOS_ESDMODEOBJ,
        .WSA_QOS_ESHAPERATEOBJ => error.WSA_QOS_ESHAPERATEOBJ,
        .WSA_QOS_RESERVED_PETYPE => error.WSA_QOS_RESERVED_PETYPE,
        _ => |t| {
            if (@intFromEnum(t) != 0) {
                if (Environment.isDebug) {
                    bun.Output.debugWarn("Unknown WinSockError: {d}", .{@intFromEnum(t)});
                }
            }
        },
    };
}

pub fn WSAGetLastError() ?SystemErrno {
    return SystemErrno.init(@intFromEnum(std.os.windows.ws2_32.WSAGetLastError()));
}

// BOOL CreateDirectoryExW(
//   [in]           LPCWSTR               lpTemplateDirectory,
//   [in]           LPCWSTR               lpNewDirectory,
//   [in, optional] LPSECURITY_ATTRIBUTES lpSecurityAttributes
// );
pub extern "kernel32" fn CreateDirectoryExW(
    lpTemplateDirectory: [*:0]const u16,
    lpNewDirectory: [*:0]const u16,
    lpSecurityAttributes: ?*win32.SECURITY_ATTRIBUTES,
) callconv(.winapi) BOOL;

pub fn GetFinalPathNameByHandle(
    hFile: HANDLE,
    fmt: std.os.windows.GetFinalPathNameByHandleFormat,
    out_buffer: []u16,
) std.os.windows.GetFinalPathNameByHandleError![]u16 {
    const return_length = bun.windows.GetFinalPathNameByHandleW(hFile, out_buffer.ptr, @truncate(out_buffer.len), switch (fmt.volume_name) {
        .Dos => win32.FILE_NAME_NORMALIZED | win32.VOLUME_NAME_DOS,
        .Nt => win32.FILE_NAME_NORMALIZED | win32.VOLUME_NAME_NT,
    });

    if (return_length == 0) {
        bun.sys.syslog("GetFinalPathNameByHandleW({*p}) = {}", .{ hFile, GetLastError() });
        return error.FileNotFound;
    }

    var ret = out_buffer[0..@intCast(return_length)];

    bun.sys.syslog("GetFinalPathNameByHandleW({*p}) = {f}", .{ hFile, bun.fmt.utf16(ret) });

    if (bun.strings.hasPrefixComptimeType(u16, ret, long_path_prefix)) {
        // '\\?\C:\absolute\path' -> 'C:\absolute\path'
        ret = ret[4..];
        if (bun.strings.hasPrefixComptimeUTF16(ret, "UNC\\")) {
            // '\\?\UNC\absolute\path' -> '\\absolute\path'
            ret[2] = '\\';
            ret = ret[2..];
        }
    }

    return ret;
}

extern "kernel32" fn GetModuleHandleExW(
    dwFlags: u32, // [in]
    lpModuleName: ?*anyopaque, // [in, optional]
    phModule: *HMODULE, // [out]
) BOOL;

extern "kernel32" fn GetModuleFileNameW(
    hModule: HMODULE, // [in]
    lpFilename: LPWSTR, // [out]
    nSize: DWORD, // [in]
) BOOL;

const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS = 0x00000004;

pub fn getModuleHandleFromAddress(addr: usize) ?HMODULE {
    var module: HMODULE = undefined;
    const rc = GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
        @ptrFromInt(addr),
        &module,
    );
    // If the function succeeds, the return value is nonzero.
    return if (rc != 0) module else null;
}

pub fn getModuleNameW(module: HMODULE, buf: []u16) ?[]const u16 {
    const rc = GetModuleFileNameW(module, @ptrCast(buf.ptr), @intCast(buf.len));
    if (rc == 0) return null;
    return buf[0..@intCast(rc)];
}

pub extern "kernel32" fn GetThreadDescription(
    thread: ?*anyopaque, // [in]
    *PWSTR, // [out]
) std.os.windows.HRESULT;

pub const ENABLE_ECHO_INPUT = 0x004;
pub const ENABLE_LINE_INPUT = 0x002;
pub const ENABLE_PROCESSED_INPUT = 0x001;
pub const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x200;
pub const ENABLE_WRAP_AT_EOL_OUTPUT = 0x0002;
pub const ENABLE_PROCESSED_OUTPUT = 0x0001;

pub extern fn SetStdHandle(nStdHandle: u32, hHandle: *anyopaque) u32;
pub extern fn GetConsoleOutputCP() u32;
pub extern fn GetConsoleCP() u32;
pub extern "kernel32" fn SetConsoleCP(wCodePageID: std.os.windows.UINT) callconv(.winapi) std.os.windows.BOOL;

pub const DeleteFileOptions = struct {
    dir: ?HANDLE,
    remove_dir: bool = false,
};

const FILE_DISPOSITION_DELETE: ULONG = 0x00000001;
const FILE_DISPOSITION_POSIX_SEMANTICS: ULONG = 0x00000002;
const FILE_DISPOSITION_FORCE_IMAGE_SECTION_CHECK: ULONG = 0x00000004;
const FILE_DISPOSITION_ON_CLOSE: ULONG = 0x00000008;
const FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE: ULONG = 0x00000010;

// Copy-paste of the standard library function except without unreachable.
pub fn DeleteFileBun(sub_path_w: []const u16, options: DeleteFileOptions) bun.sys.Maybe(void) {
    const create_options_flags: ULONG = if (options.remove_dir)
        FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT
    else
        windows.FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT; // would we ever want to delete the target instead?

    const path_len_bytes = @as(u16, @intCast(sub_path_w.len * 2));
    var nt_name = UNICODE_STRING{
        .Length = path_len_bytes,
        .MaximumLength = path_len_bytes,
        // The Windows API makes this mutable, but it will not mutate here.
        .Buffer = @constCast(sub_path_w.ptr),
    };

    if (sub_path_w[0] == '.' and sub_path_w[1] == 0) {
        // Windows does not recognize this, but it does work with empty string.
        nt_name.Length = 0;
    }

    var attr = OBJECT_ATTRIBUTES{
        .Length = @sizeOf(OBJECT_ATTRIBUTES),
        .RootDirectory = if (std.fs.path.isAbsoluteWindowsWTF16(sub_path_w)) null else options.dir,
        .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        .ObjectName = &nt_name,
        .SecurityDescriptor = null,
        .SecurityQualityOfService = null,
    };
    var io: IO_STATUS_BLOCK = undefined;
    var tmp_handle: HANDLE = undefined;
    var rc = ntdll.NtCreateFile(
        &tmp_handle,
        windows.SYNCHRONIZE | windows.DELETE,
        &attr,
        &io,
        null,
        0,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        windows.FILE_OPEN,
        create_options_flags,
        null,
        0,
    );
    bun.sys.syslog("NtCreateFile({f}, DELETE) = {}", .{ bun.fmt.fmtPath(u16, sub_path_w, .{}), rc });
    if (bun.sys.Maybe(void).errnoSys(rc, .open)) |err| {
        return err;
    }
    defer _ = bun.windows.CloseHandle(tmp_handle);

    // FileDispositionInformationEx (and therefore FILE_DISPOSITION_POSIX_SEMANTICS and FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE)
    // are only supported on NTFS filesystems, so the version check on its own is only a partial solution. To support non-NTFS filesystems
    // like FAT32, we need to fallback to FileDispositionInformation if the usage of FileDispositionInformationEx gives
    // us INVALID_PARAMETER.
    // The same reasoning for win10_rs5 as in os.renameatW() applies (FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE requires >= win10_rs5).
    var need_fallback = true;
    // Deletion with posix semantics if the filesystem supports it.
    var info = windows.FILE_DISPOSITION_INFORMATION_EX{
        .Flags = FILE_DISPOSITION_DELETE |
            FILE_DISPOSITION_POSIX_SEMANTICS |
            FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };

    rc = ntdll.NtSetInformationFile(
        tmp_handle,
        &io,
        &info,
        @sizeOf(windows.FILE_DISPOSITION_INFORMATION_EX),
        .FileDispositionInformationEx,
    );
    bun.sys.syslog("NtSetInformationFile({f}, DELETE) = {}", .{ bun.fmt.fmtPath(u16, sub_path_w, .{}), rc });
    switch (rc) {
        .SUCCESS => return .success,
        // INVALID_PARAMETER here means that the filesystem does not support FileDispositionInformationEx
        .INVALID_PARAMETER => {},
        // For all other statuses, fall down to the switch below to handle them.
        else => need_fallback = false,
    }
    if (need_fallback) {
        // Deletion with file pending semantics, which requires waiting or moving
        // files to get them removed (from here).
        var file_dispo = windows.FILE_DISPOSITION_INFORMATION{
            .DeleteFile = TRUE,
        };

        rc = ntdll.NtSetInformationFile(
            tmp_handle,
            &io,
            &file_dispo,
            @sizeOf(windows.FILE_DISPOSITION_INFORMATION),
            .FileDispositionInformation,
        );
        bun.sys.syslog("NtSetInformationFile({f}, DELETE) = {}", .{ bun.fmt.fmtPath(u16, sub_path_w, .{}), rc });
    }
    if (bun.sys.Maybe(void).errnoSys(rc, .NtSetInformationFile)) |err| {
        return err;
    }

    return .success;
}

pub const EXCEPTION_CONTINUE_EXECUTION = -1;
pub const MS_VC_EXCEPTION = 0x406d1388;

pub const STARTUPINFOEXW = extern struct {
    StartupInfo: std.os.windows.STARTUPINFOW,
    lpAttributeList: [*]u8,
};

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

pub const EXTENDED_STARTUPINFO_PRESENT = 0x80000;
pub const PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x2000D;
pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
pub const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400;
pub const JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x800;
pub const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x00001000;

const pe_header_offset_location = 0x3C;
const subsystem_offset = 0x5C;

pub const Subsystem = enum(u16) {
    windows_gui = 2,
};

pub fn editWin32BinarySubsystem(fd: bun.sys.File, subsystem: Subsystem) !void {
    comptime bun.assert(bun.Environment.isWindows);
    if (bun.windows.SetFilePointerEx(fd.handle.cast(), pe_header_offset_location, null, std.os.windows.FILE_BEGIN) == 0)
        return error.Win32Error;
    const offset = try fd.reader().readInt(u32, .little);
    if (bun.windows.SetFilePointerEx(fd.handle.cast(), offset + subsystem_offset, null, std.os.windows.FILE_BEGIN) == 0)
        return error.Win32Error;
    try fd.writer().writeInt(u16, @intFromEnum(subsystem), .little);
}

pub const rescle = struct {
    extern fn rescle__setIcon([*:0]const u16, [*:0]const u16) c_int;
    extern fn rescle__setWindowsMetadata(
        [*:0]const u16, // exe_path
        ?[*:0]const u16, // icon_path (nullable)
        ?[*:0]const u16, // title (nullable)
        ?[*:0]const u16, // publisher (nullable)
        ?[*:0]const u16, // version (nullable)
        ?[*:0]const u16, // description (nullable)
        ?[*:0]const u16, // copyright (nullable)
    ) c_int;

    pub fn setIcon(exe_path: [*:0]const u16, icon: [*:0]const u16) !void {
        comptime bun.assert(bun.Environment.isWindows);
        const status = rescle__setIcon(exe_path, icon);
        return switch (status) {
            0 => {},
            else => error.IconEditError,
        };
    }

    pub fn setWindowsMetadata(
        exe_path: [*:0]const u16,
        icon: ?[]const u8,
        title: ?[]const u8,
        publisher: ?[]const u8,
        version: ?[]const u8,
        description: ?[]const u8,
        copyright: ?[]const u8,
    ) !void {
        comptime bun.assert(bun.Environment.isWindows);

        // Validate version string format if provided
        if (version) |v| {
            // Empty version string is invalid
            if (v.len == 0) {
                return error.InvalidVersionFormat;
            }

            // Basic validation: check format and ranges
            var parts_count: u32 = 0;
            var iter = std.mem.tokenizeAny(u8, v, ".");
            while (iter.next()) |part| : (parts_count += 1) {
                if (parts_count >= 4) {
                    return error.InvalidVersionFormat;
                }
                const num = std.fmt.parseInt(u16, part, 10) catch {
                    return error.InvalidVersionFormat;
                };
                // u16 already ensures value is 0-65535
                _ = num;
            }
            if (parts_count == 0) {
                return error.InvalidVersionFormat;
            }
        }

        // Allocate UTF-16 strings
        const allocator = bun.default_allocator;

        // Icon is a path, so use toWPathNormalized with proper buffer handling
        var icon_buf: bun.OSPathBuffer = undefined;
        const icon_w = if (icon) |i| brk: {
            const path_w = bun.strings.toWPathNormalized(&icon_buf, i);
            // toWPathNormalized returns a slice into icon_buf, need to null-terminate it
            const buf_u16 = bun.reinterpretSlice(u16, &icon_buf);
            buf_u16[path_w.len] = 0;
            break :brk buf_u16[0..path_w.len :0];
        } else null;

        const title_w = if (title) |t| try bun.strings.toUTF16AllocForReal(allocator, t, false, true) else null;
        defer if (title_w) |tw| allocator.free(tw);

        const publisher_w = if (publisher) |p| try bun.strings.toUTF16AllocForReal(allocator, p, false, true) else null;
        defer if (publisher_w) |pw| allocator.free(pw);

        const version_w = if (version) |v| try bun.strings.toUTF16AllocForReal(allocator, v, false, true) else null;
        defer if (version_w) |vw| allocator.free(vw);

        const description_w = if (description) |d| try bun.strings.toUTF16AllocForReal(allocator, d, false, true) else null;
        defer if (description_w) |dw| allocator.free(dw);

        const copyright_w = if (copyright) |cr| try bun.strings.toUTF16AllocForReal(allocator, cr, false, true) else null;
        defer if (copyright_w) |cw| allocator.free(cw);

        const status = rescle__setWindowsMetadata(
            exe_path,
            if (icon_w) |iw| iw.ptr else null,
            if (title_w) |tw| tw.ptr else null,
            if (publisher_w) |pw| pw.ptr else null,
            if (version_w) |vw| vw.ptr else null,
            if (description_w) |dw| dw.ptr else null,
            if (copyright_w) |cw| cw.ptr else null,
        );
        return switch (status) {
            0 => {},
            -1 => error.FailedToLoadExecutable,
            -2 => error.FailedToSetIcon,
            -3 => error.FailedToSetProductName,
            -4 => error.FailedToSetCompanyName,
            -5 => error.FailedToSetDescription,
            -6 => error.FailedToSetCopyright,
            -7 => error.FailedToSetFileVersion,
            -8 => error.FailedToSetProductVersion,
            -9 => error.FailedToSetFileVersionString,
            -10 => error.FailedToSetProductVersionString,
            -11 => error.InvalidVersionFormat,
            -12 => error.FailedToCommit,
            else => error.WindowsMetadataEditError,
        };
    }
};

pub extern "kernel32" fn CloseHandle(hObject: HANDLE) callconv(.winapi) BOOL;
pub extern "kernel32" fn GetFinalPathNameByHandleW(hFile: HANDLE, lpszFilePath: [*]u16, cchFilePath: DWORD, dwFlags: DWORD) callconv(.winapi) DWORD;
pub extern "kernel32" fn DeleteFileW(lpFileName: [*:0]const u16) callconv(.winapi) BOOL;
pub extern "kernel32" fn CreateSymbolicLinkW(lpSymlinkFileName: [*:0]const u16, lpTargetFileName: [*:0]const u16, dwFlags: DWORD) callconv(.winapi) BOOLEAN;
pub extern "kernel32" fn GetCurrentThread() callconv(.winapi) HANDLE;
pub extern "kernel32" fn GetCommandLineW() callconv(.winapi) LPWSTR;
pub extern "kernel32" fn CreateDirectoryW(lpPathName: [*:0]const u16, lpSecurityAttributes: ?*windows.SECURITY_ATTRIBUTES) callconv(.winapi) BOOL;
pub extern "kernel32" fn SetEndOfFile(hFile: HANDLE) callconv(.winapi) BOOL;
pub extern "kernel32" fn GetProcessTimes(in_hProcess: HANDLE, out_lpCreationTime: *FILETIME, out_lpExitTime: *FILETIME, out_lpKernelTime: *FILETIME, out_lpUserTime: *FILETIME) callconv(.winapi) BOOL;

/// Returns the original mode, or null on failure
pub fn updateStdioModeFlags(i: bun.FD.Stdio, opts: struct { set: DWORD = 0, unset: DWORD = 0 }) !DWORD {
    const fd = i.fd();
    var original_mode: DWORD = 0;
    if (c.GetConsoleMode(fd.cast(), &original_mode) != 0) {
        if (c.SetConsoleMode(fd.cast(), (original_mode | opts.set) & ~opts.unset) == 0) {
            return getLastError();
        }
    } else return getLastError();
    return original_mode;
}

const watcherChildEnv: [:0]const u16 = bun.strings.toUTF16Literal("_BUN_WATCHER_CHILD");

// magic exit code to indicate to the watcher manager that the child process should be re-spawned
// this was randomly generated - we need to avoid using a common exit code that might be used by the script itself
pub const watcher_reload_exit: DWORD = 3224497970;

pub const spawn = @import("./bun.js/api/bun/spawn.zig").PosixSpawn;

pub fn isWatcherChild() bool {
    var buf: [1]u16 = undefined;
    return c.GetEnvironmentVariableW(@constCast(watcherChildEnv.ptr), &buf, 1) > 0;
}

pub fn becomeWatcherManager(allocator: std.mem.Allocator) noreturn {
    // this process will be the parent of the child process that actually runs the script
    var procinfo: std.os.windows.PROCESS_INFORMATION = undefined;
    windows_enable_stdio_inheritance();
    const job = CreateJobObjectA(null, null) orelse Output.panic(
        "Could not create watcher Job Object: {s}",
        .{@tagName(std.os.windows.kernel32.GetLastError())},
    );
    var jeli = std.mem.zeroes(c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION);
    jeli.BasicLimitInformation.LimitFlags =
        c.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
        c.JOB_OBJECT_LIMIT_BREAKAWAY_OK |
        c.JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK |
        c.JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    if (c.SetInformationJobObject(
        job,
        c.JobObjectExtendedLimitInformation,
        &jeli,
        @sizeOf(c.JOBOBJECT_EXTENDED_LIMIT_INFORMATION),
    ) == 0) {
        Output.panic(
            "Could not configure watcher Job Object: {s}",
            .{@tagName(std.os.windows.kernel32.GetLastError())},
        );
    }

    while (true) {
        spawnWatcherChild(allocator, &procinfo, job) catch |err| {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            if (err == error.Win32Error) {
                Output.panic("Failed to spawn process: {s}\n", .{@tagName(GetLastError())});
            }
            Output.panic("Failed to spawn process: {s}\n", .{@errorName(err)});
        };
        windows.WaitForSingleObject(procinfo.hProcess, c.INFINITE) catch |err| {
            Output.panic("Failed to wait for child process: {s}\n", .{@errorName(err)});
        };
        var exit_code: DWORD = 0;
        if (c.GetExitCodeProcess(procinfo.hProcess, &exit_code) == 0) {
            const err = windows.GetLastError();
            _ = c.NtClose(procinfo.hProcess);
            Output.panic("Failed to get exit code of child process: {s}\n", .{@tagName(err)});
        }
        _ = c.NtClose(procinfo.hProcess);

        // magic exit code to indicate that the child process should be re-spawned
        if (exit_code == watcher_reload_exit) {
            continue;
        } else {
            bun.Global.exit(exit_code);
        }
    }
}

pub fn spawnWatcherChild(
    allocator: std.mem.Allocator,
    procinfo: *std.os.windows.PROCESS_INFORMATION,
    job: HANDLE,
) !void {
    // https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812
    var attr_size: usize = undefined;
    _ = InitializeProcThreadAttributeList(null, 1, 0, &attr_size);
    const p = try allocator.alloc(u8, attr_size);
    defer allocator.free(p);
    if (InitializeProcThreadAttributeList(p.ptr, 1, 0, &attr_size) == 0) {
        return error.Win32Error;
    }
    if (UpdateProcThreadAttribute(
        p.ptr,
        0,
        c.PROC_THREAD_ATTRIBUTE_JOB_LIST,
        @ptrCast(&job),
        @sizeOf(HANDLE),
        null,
        null,
    ) == 0) {
        return error.Win32Error;
    }

    const flags: std.os.windows.CreateProcessFlags = .{ .create_unicode_environment = true, .extended_startupinfo_present = true };

    const image_path = exePathW();
    var wbuf: WPathBuffer = undefined;
    @memcpy(wbuf[0..image_path.len], image_path);
    wbuf[image_path.len] = 0;

    const image_pathZ = wbuf[0..image_path.len :0];

    const kernelenv = kernel32_2.GetEnvironmentStringsW();
    defer if (kernelenv) |envptr| {
        _ = kernel32_2.FreeEnvironmentStringsW(envptr);
    };

    var size: usize = 0;
    if (kernelenv) |pointer| {
        // check that env is non-empty
        if (pointer[0] != 0 or pointer[1] != 0) {
            // array is terminated by two nulls
            while (pointer[size] != 0 or pointer[size + 1] != 0) size += 1;
            size += 1;
        }
    }
    // now pointer[size] is the first null

    const envbuf = try allocator.alloc(u16, size + watcherChildEnv.len + 4);
    defer allocator.free(envbuf);
    if (kernelenv) |pointer| {
        @memcpy(envbuf[0..size], pointer);
    }
    @memcpy(envbuf[size .. size + watcherChildEnv.len], watcherChildEnv);
    envbuf[size + watcherChildEnv.len] = '=';
    envbuf[size + watcherChildEnv.len + 1] = '1';
    envbuf[size + watcherChildEnv.len + 2] = 0;
    envbuf[size + watcherChildEnv.len + 3] = 0;

    var startupinfo = STARTUPINFOEXW{
        .StartupInfo = .{
            .cb = @sizeOf(STARTUPINFOEXW),
            .lpReserved = null,
            .lpDesktop = null,
            .lpTitle = null,
            .dwX = 0,
            .dwY = 0,
            .dwXSize = 0,
            .dwYSize = 0,
            .dwXCountChars = 0,
            .dwYCountChars = 0,
            .dwFillAttribute = 0,
            .dwFlags = c.STARTF_USESTDHANDLES,
            .wShowWindow = 0,
            .cbReserved2 = 0,
            .lpReserved2 = null,
            .hStdInput = std.fs.File.stdin().handle,
            .hStdOutput = std.fs.File.stdout().handle,
            .hStdError = std.fs.File.stderr().handle,
        },
        .lpAttributeList = p.ptr,
    };
    @memset(std.mem.asBytes(procinfo), 0);
    const rc = kernel32.CreateProcessW(
        image_pathZ.ptr,
        c.GetCommandLineW(),
        null,
        null,
        1,
        flags,
        envbuf.ptr,
        null,
        @ptrCast(&startupinfo),
        procinfo,
    );
    if (rc == 0) {
        return error.Win32Error;
    }
    var is_in_job: c.BOOL = 0;
    _ = c.IsProcessInJob(procinfo.hProcess, job, &is_in_job);
    bun.debugAssert(is_in_job != 0);
    _ = c.NtClose(procinfo.hThread);
}

/// Returns null on error. Use windows API to lookup the actual error.
/// The reason this function is in zig is so that we can use our own utf16-conversion functions.
///
/// Using characters16() does not seem to always have the sentinel. or something else
/// broke when I just used it. Not sure. ... but this works!
fn @"windows process.dlopen"(str: *bun.String) callconv(.c) ?*anyopaque {
    if (comptime !bun.Environment.isWindows) {
        @compileError("unreachable");
    }

    var buf: bun.WPathBuffer = undefined;
    const data = switch (str.encoding()) {
        .utf8 => bun.strings.convertUTF8toUTF16InBuffer(&buf, str.utf8()),
        .utf16 => brk: {
            @memcpy(buf[0..str.length()], str.utf16());
            break :brk buf[0..str.length()];
        },
        .latin1 => brk: {
            bun.strings.copyU8IntoU16(&buf, str.latin1());
            break :brk buf[0..str.length()];
        },
    };
    buf[data.len] = 0;
    const LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008;
    return bun.windows.kernel32.LoadLibraryExW(buf[0..data.len :0].ptr, null, LOAD_WITH_ALTERED_SEARCH_PATH);
}

pub extern fn windows_enable_stdio_inheritance() void;

/// Extracted from standard library except this takes an open file descriptor
///
/// NOTE: THE FILE MUST BE OPENED WITH ACCESS_MASK "DELETE" OR THIS WILL FAIL
pub fn deleteOpenedFile(fd: bun.FileDescriptor) Maybe(void) {
    comptime bun.assert(builtin.target.os.version_range.windows.min.isAtLeast(.win10_rs5));
    var info = w.FILE_DISPOSITION_INFORMATION_EX{
        .Flags = FILE_DISPOSITION_DELETE |
            FILE_DISPOSITION_POSIX_SEMANTICS |
            FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };

    var io: w.IO_STATUS_BLOCK = undefined;
    const rc = w.ntdll.NtSetInformationFile(
        fd.cast(),
        &io,
        &info,
        @sizeOf(w.FILE_DISPOSITION_INFORMATION_EX),
        .FileDispositionInformationEx,
    );

    log("deleteOpenedFile({}) = {s}", .{ fd, @tagName(rc) });

    return if (rc == .SUCCESS)
        .success
    else
        .errno(rc, .NtSetInformationFile);
}

/// With an open file source_fd, move it into the directory new_dir_fd with the name new_path_w.
/// Does not close the file descriptor.
///
/// For this to succeed
/// - source_fd must have been opened with access_mask=w.DELETE
/// - new_path_w must be the name of a file. it cannot be a path relative to new_dir_fd. see moveOpenedFileAtLoose
pub fn moveOpenedFileAt(
    src_fd: bun.FileDescriptor,
    new_dir_fd: bun.FileDescriptor,
    new_file_name: []const u16,
    replace_if_exists: bool,
) Maybe(void) {
    // FILE_RENAME_INFORMATION_EX and FILE_RENAME_POSIX_SEMANTICS require >= win10_rs1,
    // but FILE_RENAME_IGNORE_READONLY_ATTRIBUTE requires >= win10_rs5. We check >= rs5 here
    // so that we only use POSIX_SEMANTICS when we know IGNORE_READONLY_ATTRIBUTE will also be
    // supported in order to avoid either (1) using a redundant call that we can know in advance will return
    // STATUS_NOT_SUPPORTED or (2) only setting IGNORE_READONLY_ATTRIBUTE when >= rs5
    // and therefore having different behavior when the Windows version is >= rs1 but < rs5.
    comptime bun.assert(builtin.target.os.version_range.windows.min.isAtLeast(.win10_rs5));

    if (bun.Environment.allow_assert) {
        bun.assert(std.mem.indexOfScalar(u16, new_file_name, '/') == null); // Call moveOpenedFileAtLoose
    }

    const struct_buf_len = @sizeOf(w.FILE_RENAME_INFORMATION_EX) + (bun.MAX_PATH_BYTES - 1);
    var rename_info_buf: [struct_buf_len]u8 align(@alignOf(w.FILE_RENAME_INFORMATION_EX)) = undefined;

    const struct_len = @sizeOf(w.FILE_RENAME_INFORMATION_EX) - 1 + new_file_name.len * 2;
    if (struct_len > struct_buf_len) return Maybe(void).errno(bun.sys.E.NAMETOOLONG, .NtSetInformationFile);

    const rename_info = @as(*w.FILE_RENAME_INFORMATION_EX, @ptrCast(&rename_info_buf));
    var io_status_block: w.IO_STATUS_BLOCK = undefined;

    var flags: w.ULONG = w.FILE_RENAME_POSIX_SEMANTICS | w.FILE_RENAME_IGNORE_READONLY_ATTRIBUTE;
    if (replace_if_exists) flags |= w.FILE_RENAME_REPLACE_IF_EXISTS;
    rename_info.* = .{
        .Flags = flags,
        .RootDirectory = if (std.fs.path.isAbsoluteWindowsWTF16(new_file_name)) null else new_dir_fd.cast(),
        .FileNameLength = @intCast(new_file_name.len * 2), // already checked error.NameTooLong
        .FileName = undefined,
    };
    @memcpy(@as([*]u16, &rename_info.FileName)[0..new_file_name.len], new_file_name);
    const rc = w.ntdll.NtSetInformationFile(
        src_fd.cast(),
        &io_status_block,
        rename_info,
        @intCast(struct_len), // already checked for error.NameTooLong
        .FileRenameInformationEx,
    );
    log("moveOpenedFileAt({f} ->> {f} '{f}', {s}) = {s}", .{ src_fd, new_dir_fd, bun.fmt.utf16(new_file_name), if (replace_if_exists) "replace_if_exists" else "no flag", @tagName(rc) });

    if (bun.Environment.isDebug) {
        if (rc == .ACCESS_DENIED) {
            bun.Output.debugWarn("moveOpenedFileAt was called on a file descriptor without access_mask=w.DELETE", .{});
        }
    }

    return if (rc == .SUCCESS)
        .success
    else
        .errno(rc, .NtSetInformationFile);
}

/// Same as moveOpenedFileAt but allows new_path to be a path relative to new_dir_fd.
///
/// Aka: moveOpenedFileAtLoose(fd, dir, ".\\a\\relative\\not-normalized-path.txt", false);
pub fn moveOpenedFileAtLoose(
    src_fd: bun.FileDescriptor,
    new_dir_fd: bun.FileDescriptor,
    new_path: []const u16,
    replace_if_exists: bool,
) Maybe(void) {
    bun.assert(std.mem.indexOfScalar(u16, new_path, '/') == null); // Call bun.strings.toWPathNormalized first

    const without_leading_dot_slash = if (new_path.len >= 2 and new_path[0] == '.' and new_path[1] == '\\')
        new_path[2..]
    else
        new_path;

    if (std.mem.lastIndexOfScalar(u16, new_path, '\\')) |last_slash| {
        const dirname = new_path[0..last_slash];
        const fd = switch (bun.sys.openDirAtWindows(new_dir_fd, dirname, .{ .can_rename_or_delete = true, .iterable = false })) {
            .err => |e| return .{ .err = e },
            .result => |fd| fd,
        };
        defer fd.close();

        const basename = new_path[last_slash + 1 ..];
        return moveOpenedFileAt(src_fd, fd, basename, replace_if_exists);
    }

    // easy mode
    return moveOpenedFileAt(src_fd, new_dir_fd, without_leading_dot_slash, replace_if_exists);
}

/// Derived from std.os.windows.renameAtW
/// Allows more errors
pub fn renameAtW(
    old_dir_fd: bun.FileDescriptor,
    old_path_w: []const u16,
    new_dir_fd: bun.FileDescriptor,
    new_path_w: []const u16,
    replace_if_exists: bool,
) Maybe(void) {
    const src_fd = brk: {
        switch (bun.sys.openFileAtWindows(
            old_dir_fd,
            old_path_w,
            .{
                .access_mask = w.SYNCHRONIZE | w.GENERIC_WRITE | w.DELETE | w.FILE_TRAVERSE,
                .disposition = w.FILE_OPEN,
                .options = w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_REPARSE_POINT,
            },
        )) {
            .err => {
                // retry, wtihout FILE_TRAVERSE flag
                switch (bun.sys.openFileAtWindows(
                    old_dir_fd,
                    old_path_w,
                    .{
                        .access_mask = w.SYNCHRONIZE | w.GENERIC_WRITE | w.DELETE,
                        .disposition = w.FILE_OPEN,
                        .options = w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_REPARSE_POINT,
                    },
                )) {
                    .err => |err2| return .{ .err = err2 },
                    .result => |fd| break :brk fd,
                }
            },
            .result => |fd| break :brk fd,
        }
    };
    defer src_fd.close();

    return moveOpenedFileAt(src_fd, new_dir_fd, new_path_w, replace_if_exists);
}

const kernel32_2 = struct {
    pub extern "kernel32" fn GetEnvironmentStringsW() callconv(.winapi) ?LPWSTR;

    pub extern "kernel32" fn FreeEnvironmentStringsW(
        penv: LPWSTR,
    ) callconv(.winapi) BOOL;

    pub extern "kernel32" fn GetEnvironmentVariableW(
        lpName: ?LPCWSTR,
        lpBuffer: ?[*]WCHAR,
        nSize: DWORD,
    ) callconv(.winapi) DWORD;
};
pub const GetEnvironmentStringsError = error{OutOfMemory};

pub fn GetEnvironmentStringsW() GetEnvironmentStringsError![*:0]u16 {
    return kernel32_2.GetEnvironmentStringsW() orelse return error.OutOfMemory;
}

pub fn FreeEnvironmentStringsW(penv: [*:0]u16) void {
    std.debug.assert(kernel32_2.FreeEnvironmentStringsW(penv) != 0);
}

pub const GetEnvironmentVariableError = error{
    EnvironmentVariableNotFound,

    Unexpected,
};

pub fn GetEnvironmentVariableW(lpName: LPWSTR, lpBuffer: [*]u16, nSize: DWORD) GetEnvironmentVariableError!DWORD {
    const rc = kernel32_2.GetEnvironmentVariableW(lpName, lpBuffer, nSize);

    if (rc == 0) {
        switch (GetLastError()) {
            .ENVVAR_NOT_FOUND => return error.EnvironmentVariableNotFound,

            else => return error.Unexpected,
        }
    }

    return rc;
}

pub const env = @import("./windows/env.zig");

const builtin = @import("builtin");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const c = bun.c;

const Maybe = bun.sys.Maybe;
const SystemErrno = bun.sys.SystemErrno;
const log = bun.sys.syslog;

const w = std.os.windows;
const win32 = windows;
const windows = std.os.windows;
