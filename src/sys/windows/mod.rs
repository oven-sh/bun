//! Platform specific APIs for Windows
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

#![cfg(windows)]
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use core::ffi::{c_char, c_int, c_void};
use core::mem::{size_of, MaybeUninit};
use core::ptr;

use bun_windows_sys as win32;
use bun_windows_sys as windows;
use bun_windows_sys::externs as externs;

use crate as bun_sys;
use crate::{E, Fd, SystemErrno};

pub use bun_windows_sys::ntdll;
pub use bun_windows_sys::kernel32;
pub use bun_windows_sys::kernel32::GetLastError;

pub use bun_windows_sys::PATH_MAX_WIDE;
pub use bun_windows_sys::MAX_PATH;
pub use bun_windows_sys::WORD;
pub use bun_windows_sys::DWORD;
pub use bun_windows_sys::CHAR;
pub use bun_windows_sys::BOOL;
pub use bun_windows_sys::BOOLEAN;
pub use bun_windows_sys::LPVOID;
pub use bun_windows_sys::LPCVOID;
pub use bun_windows_sys::LPWSTR;
pub use bun_windows_sys::LPCWSTR;
pub use bun_windows_sys::LPSTR;
pub use bun_windows_sys::WCHAR;
pub use bun_windows_sys::LPCSTR;
pub use bun_windows_sys::PWSTR;
pub use bun_windows_sys::FALSE;
pub use bun_windows_sys::TRUE;
pub use bun_windows_sys::COORD;
pub use bun_windows_sys::INVALID_HANDLE_VALUE;
pub use bun_windows_sys::FILE_BEGIN;
pub use bun_windows_sys::FILE_END;
pub use bun_windows_sys::FILE_CURRENT;
pub use bun_windows_sys::ULONG;
pub use bun_windows_sys::ULONGLONG;
pub use bun_windows_sys::UINT;
pub use bun_windows_sys::LARGE_INTEGER;
pub use bun_windows_sys::UNICODE_STRING;
pub use bun_windows_sys::NTSTATUS;
pub use bun_windows_sys::NT_SUCCESS;
pub use bun_windows_sys::STATUS_SUCCESS;
pub const MOVEFILE_COPY_ALLOWED: DWORD = 0x2;
pub const MOVEFILE_REPLACE_EXISTING: DWORD = 0x1;
pub const MOVEFILE_WRITE_THROUGH: DWORD = 0x8;
pub use bun_windows_sys::FILETIME;

pub use bun_windows_sys::DUPLICATE_SAME_ACCESS;
pub use bun_windows_sys::OBJECT_ATTRIBUTES;
pub use bun_windows_sys::IO_STATUS_BLOCK;
pub use bun_windows_sys::FILE_INFO_BY_HANDLE_CLASS;
pub use bun_windows_sys::FILE_SHARE_READ;
pub use bun_windows_sys::FILE_SHARE_WRITE;
pub use bun_windows_sys::FILE_SHARE_DELETE;
pub use bun_windows_sys::FILE_ATTRIBUTE_NORMAL;
pub use bun_windows_sys::FILE_ATTRIBUTE_READONLY;
pub use bun_windows_sys::FILE_ATTRIBUTE_HIDDEN;
pub use bun_windows_sys::FILE_ATTRIBUTE_SYSTEM;
pub use bun_windows_sys::FILE_ATTRIBUTE_DIRECTORY;
pub use bun_windows_sys::FILE_ATTRIBUTE_ARCHIVE;
pub use bun_windows_sys::FILE_ATTRIBUTE_DEVICE;
pub use bun_windows_sys::FILE_ATTRIBUTE_TEMPORARY;
pub use bun_windows_sys::FILE_ATTRIBUTE_SPARSE_FILE;
pub use bun_windows_sys::FILE_ATTRIBUTE_REPARSE_POINT;
pub use bun_windows_sys::FILE_ATTRIBUTE_COMPRESSED;
pub use bun_windows_sys::FILE_ATTRIBUTE_OFFLINE;
pub use bun_windows_sys::FILE_ATTRIBUTE_NOT_CONTENT_INDEXED;
pub use bun_windows_sys::FILE_DIRECTORY_FILE;
pub use bun_windows_sys::FILE_WRITE_THROUGH;
pub use bun_windows_sys::FILE_SEQUENTIAL_ONLY;
pub use bun_windows_sys::FILE_SYNCHRONOUS_IO_NONALERT;
pub use bun_windows_sys::FILE_OPEN_REPARSE_POINT;
pub use bun_windows_sys::user32;
pub use bun_windows_sys::advapi32;

pub const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;

pub const NT_OBJECT_PREFIX: [u16; 4] = [b'\\' as u16, b'?' as u16, b'?' as u16, b'\\' as u16];
pub const NT_UNC_OBJECT_PREFIX: [u16; 8] = [b'\\' as u16, b'?' as u16, b'?' as u16, b'\\' as u16, b'U' as u16, b'N' as u16, b'C' as u16, b'\\' as u16];
pub const LONG_PATH_PREFIX: [u16; 4] = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];

pub const NT_OBJECT_PREFIX_U8: [u8; 4] = *b"\\??\\";
pub const NT_UNC_OBJECT_PREFIX_U8: [u8; 8] = *b"\\??\\UNC\\";
pub const LONG_PATH_PREFIX_U8: [u8; 4] = *b"\\\\?\\";

#[cfg(windows)]
pub use bun_paths::PathBuffer;
#[cfg(windows)]
pub use bun_paths::WPathBuffer;

pub use bun_windows_sys::HANDLE;
pub use bun_windows_sys::HMODULE;

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle
pub use bun_windows_sys::externs::GetFileInformationByHandle;

pub use bun_windows_sys::externs::CommandLineToArgvW;

// TODO(port): move to windows_sys
unsafe extern "system" {
    #[link_name = "GetFileType"]
    fn GetFileType_raw(hFile: HANDLE) -> DWORD;
}

pub fn GetFileType(hFile: HANDLE) -> DWORD {
    // SAFETY: hFile is a valid HANDLE owned by caller
    let rc = unsafe { GetFileType_raw(hFile) };
    if cfg!(feature = "debug_logs") {
        bun_sys::syslog!("GetFileType({}) = {}", Fd::from_native(hFile), rc);
    }
    rc
}

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfiletype#return-value
pub const FILE_TYPE_UNKNOWN: DWORD = 0x0000;
pub const FILE_TYPE_DISK: DWORD = 0x0001;
pub const FILE_TYPE_CHAR: DWORD = 0x0002;
pub const FILE_TYPE_PIPE: DWORD = 0x0003;
pub const FILE_TYPE_REMOTE: DWORD = 0x8000;

pub use bun_windows_sys::externs::LPDWORD;

pub use bun_windows_sys::externs::GetBinaryTypeW;

/// A 32-bit Windows-based application
pub const SCS_32BIT_BINARY: DWORD = 0;
/// A 64-bit Windows-based application.
pub const SCS_64BIT_BINARY: DWORD = 6;
/// An MS-DOS – based application
pub const SCS_DOS_BINARY: DWORD = 1;
/// A 16-bit OS/2-based application
pub const SCS_OS216_BINARY: DWORD = 5;
/// A PIF file that executes an MS-DOS – based application
pub const SCS_PIF_BINARY: DWORD = 3;
/// A POSIX – based application
pub const SCS_POSIX_BINARY: DWORD = 4;

/// Each process has a single current directory made up of two parts:
///
/// - A disk designator that is either a drive letter followed by a colon, or a server name and share name (\\servername\sharename)
/// - A directory on the disk designator
///
/// The current directory is shared by all threads of the process: If one thread changes the current directory, it affects all threads in the process. Multithreaded applications and shared library code should avoid calling the SetCurrentDirectory function due to the risk of affecting relative path calculations being performed by other threads. Conversely, multithreaded applications and shared library code should avoid using relative paths so that they are unaffected by changes to the current directory performed by other threads.
///
/// Note that the current directory for a process is locked while the process is executing. This will prevent the directory from being deleted, moved, or renamed.
pub use bun_windows_sys::externs::SetCurrentDirectoryW;
pub use SetCurrentDirectoryW as SetCurrentDirectory;

// TODO(port): move to windows_sys
unsafe extern "system" {
    pub fn RtlNtStatusToDosError(status: NTSTATUS) -> Win32Error;
}

pub use bun_windows_sys::externs::SaferiIsExecutableFileType;

// This was originally copied from Zig's standard library
/// Codes are from https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/18d8fbe8-a967-4f1c-ae50-99ca8e491d2d
///
/// Non-exhaustive (Zig had `_,`): represented as a transparent u16 newtype with associated consts.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Win32Error(pub u16);

#[allow(dead_code)]
impl Win32Error {
    /// The operation completed successfully.
    pub const SUCCESS: Win32Error = Win32Error(0);
    /// Incorrect function.
    pub const INVALID_FUNCTION: Win32Error = Win32Error(1);
    /// The system cannot find the file specified.
    pub const FILE_NOT_FOUND: Win32Error = Win32Error(2);
    /// The system cannot find the path specified.
    pub const PATH_NOT_FOUND: Win32Error = Win32Error(3);
    /// The system cannot open the file.
    pub const TOO_MANY_OPEN_FILES: Win32Error = Win32Error(4);
    /// Access is denied.
    pub const ACCESS_DENIED: Win32Error = Win32Error(5);
    /// The handle is invalid.
    pub const INVALID_HANDLE: Win32Error = Win32Error(6);
    /// The storage control blocks were destroyed.
    pub const ARENA_TRASHED: Win32Error = Win32Error(7);
    /// Not enough storage is available to process this command.
    pub const NOT_ENOUGH_MEMORY: Win32Error = Win32Error(8);
    /// The storage control block address is invalid.
    pub const INVALID_BLOCK: Win32Error = Win32Error(9);
    /// The environment is incorrect.
    pub const BAD_ENVIRONMENT: Win32Error = Win32Error(10);
    /// An attempt was made to load a program with an incorrect format.
    pub const BAD_FORMAT: Win32Error = Win32Error(11);
    /// The access code is invalid.
    pub const INVALID_ACCESS: Win32Error = Win32Error(12);
    /// The data is invalid.
    pub const INVALID_DATA: Win32Error = Win32Error(13);
    /// Not enough storage is available to complete this operation.
    pub const OUTOFMEMORY: Win32Error = Win32Error(14);
    /// The system cannot find the drive specified.
    pub const INVALID_DRIVE: Win32Error = Win32Error(15);
    /// The directory cannot be removed.
    pub const CURRENT_DIRECTORY: Win32Error = Win32Error(16);
    /// The system cannot move the file to a different disk drive.
    pub const NOT_SAME_DEVICE: Win32Error = Win32Error(17);
    /// There are no more files.
    pub const NO_MORE_FILES: Win32Error = Win32Error(18);
    /// The media is write protected.
    pub const WRITE_PROTECT: Win32Error = Win32Error(19);
    /// The system cannot find the device specified.
    pub const BAD_UNIT: Win32Error = Win32Error(20);
    /// The device is not ready.
    pub const NOT_READY: Win32Error = Win32Error(21);
    /// The device does not recognize the command.
    pub const BAD_COMMAND: Win32Error = Win32Error(22);
    /// Data error (cyclic redundancy check).
    pub const CRC: Win32Error = Win32Error(23);
    /// The program issued a command but the command length is incorrect.
    pub const BAD_LENGTH: Win32Error = Win32Error(24);
    /// The drive cannot locate a specific area or track on the disk.
    pub const SEEK: Win32Error = Win32Error(25);
    /// The specified disk or diskette cannot be accessed.
    pub const NOT_DOS_DISK: Win32Error = Win32Error(26);
    /// The drive cannot find the sector requested.
    pub const SECTOR_NOT_FOUND: Win32Error = Win32Error(27);
    /// The printer is out of paper.
    pub const OUT_OF_PAPER: Win32Error = Win32Error(28);
    /// The system cannot write to the specified device.
    pub const WRITE_FAULT: Win32Error = Win32Error(29);
    /// The system cannot read from the specified device.
    pub const READ_FAULT: Win32Error = Win32Error(30);
    /// A device attached to the system is not functioning.
    pub const GEN_FAILURE: Win32Error = Win32Error(31);
    /// The process cannot access the file because it is being used by another process.
    pub const SHARING_VIOLATION: Win32Error = Win32Error(32);
    /// The process cannot access the file because another process has locked a portion of the file.
    pub const LOCK_VIOLATION: Win32Error = Win32Error(33);
    /// The wrong diskette is in the drive.
    /// Insert %2 (Volume Serial Number: %3) into drive %1.
    pub const WRONG_DISK: Win32Error = Win32Error(34);
    /// Too many files opened for sharing.
    pub const SHARING_BUFFER_EXCEEDED: Win32Error = Win32Error(36);
    /// Reached the end of the file.
    pub const HANDLE_EOF: Win32Error = Win32Error(38);
    /// The disk is full.
    pub const HANDLE_DISK_FULL: Win32Error = Win32Error(39);
    /// The request is not supported.
    pub const NOT_SUPPORTED: Win32Error = Win32Error(50);
    /// Windows cannot find the network path.
    /// Verify that the network path is correct and the destination computer is not busy or turned off.
    /// If Windows still cannot find the network path, contact your network administrator.
    pub const REM_NOT_LIST: Win32Error = Win32Error(51);
    /// You were not connected because a duplicate name exists on the network.
    /// If joining a domain, go to System in Control Panel to change the computer name and try again.
    /// If joining a workgroup, choose another workgroup name.
    pub const DUP_NAME: Win32Error = Win32Error(52);
    /// The network path was not found.
    pub const BAD_NETPATH: Win32Error = Win32Error(53);
    /// The network is busy.
    pub const NETWORK_BUSY: Win32Error = Win32Error(54);
    /// The specified network resource or device is no longer available.
    pub const DEV_NOT_EXIST: Win32Error = Win32Error(55);
    /// The network BIOS command limit has been reached.
    pub const TOO_MANY_CMDS: Win32Error = Win32Error(56);
    /// A network adapter hardware error occurred.
    pub const ADAP_HDW_ERR: Win32Error = Win32Error(57);
    /// The specified server cannot perform the requested operation.
    pub const BAD_NET_RESP: Win32Error = Win32Error(58);
    /// An unexpected network error occurred.
    pub const UNEXP_NET_ERR: Win32Error = Win32Error(59);
    /// The remote adapter is not compatible.
    pub const BAD_REM_ADAP: Win32Error = Win32Error(60);
    /// The printer queue is full.
    pub const PRINTQ_FULL: Win32Error = Win32Error(61);
    /// Space to store the file waiting to be printed is not available on the server.
    pub const NO_SPOOL_SPACE: Win32Error = Win32Error(62);
    /// Your file waiting to be printed was deleted.
    pub const PRINT_CANCELLED: Win32Error = Win32Error(63);
    /// The specified network name is no longer available.
    pub const NETNAME_DELETED: Win32Error = Win32Error(64);
    /// Network access is denied.
    pub const NETWORK_ACCESS_DENIED: Win32Error = Win32Error(65);
    /// The network resource type is not correct.
    pub const BAD_DEV_TYPE: Win32Error = Win32Error(66);
    /// The network name cannot be found.
    pub const BAD_NET_NAME: Win32Error = Win32Error(67);
    /// The name limit for the local computer network adapter card was exceeded.
    pub const TOO_MANY_NAMES: Win32Error = Win32Error(68);
    /// The network BIOS session limit was exceeded.
    pub const TOO_MANY_SESS: Win32Error = Win32Error(69);
    /// The remote server has been paused or is in the process of being started.
    pub const SHARING_PAUSED: Win32Error = Win32Error(70);
    /// No more connections can be made to this remote computer at this time because there are already as many connections as the computer can accept.
    pub const REQ_NOT_ACCEP: Win32Error = Win32Error(71);
    /// The specified printer or disk device has been paused.
    pub const REDIR_PAUSED: Win32Error = Win32Error(72);
    /// The file exists.
    pub const FILE_EXISTS: Win32Error = Win32Error(80);
    /// The directory or file cannot be created.
    pub const CANNOT_MAKE: Win32Error = Win32Error(82);
    /// Fail on INT 24.
    pub const FAIL_I24: Win32Error = Win32Error(83);
    /// Storage to process this request is not available.
    pub const OUT_OF_STRUCTURES: Win32Error = Win32Error(84);
    /// The local device name is already in use.
    pub const ALREADY_ASSIGNED: Win32Error = Win32Error(85);
    /// The specified network password is not correct.
    pub const INVALID_PASSWORD: Win32Error = Win32Error(86);
    /// The parameter is incorrect.
    pub const INVALID_PARAMETER: Win32Error = Win32Error(87);
    /// A write fault occurred on the network.
    pub const NET_WRITE_FAULT: Win32Error = Win32Error(88);
    /// The system cannot start another process at this time.
    pub const NO_PROC_SLOTS: Win32Error = Win32Error(89);
    /// Cannot create another system semaphore.
    pub const TOO_MANY_SEMAPHORES: Win32Error = Win32Error(100);
    /// The exclusive semaphore is owned by another process.
    pub const EXCL_SEM_ALREADY_OWNED: Win32Error = Win32Error(101);
    /// The semaphore is set and cannot be closed.
    pub const SEM_IS_SET: Win32Error = Win32Error(102);
    /// The semaphore cannot be set again.
    pub const TOO_MANY_SEM_REQUESTS: Win32Error = Win32Error(103);
    /// Cannot request exclusive semaphores at interrupt time.
    pub const INVALID_AT_INTERRUPT_TIME: Win32Error = Win32Error(104);
    /// The previous ownership of this semaphore has ended.
    pub const SEM_OWNER_DIED: Win32Error = Win32Error(105);
    /// Insert the diskette for drive %1.
    pub const SEM_USER_LIMIT: Win32Error = Win32Error(106);
    /// The program stopped because an alternate diskette was not inserted.
    pub const DISK_CHANGE: Win32Error = Win32Error(107);
    /// The disk is in use or locked by another process.
    pub const DRIVE_LOCKED: Win32Error = Win32Error(108);
    /// The pipe has been ended.
    pub const BROKEN_PIPE: Win32Error = Win32Error(109);
    /// The system cannot open the device or file specified.
    pub const OPEN_FAILED: Win32Error = Win32Error(110);
    /// The file name is too long.
    pub const BUFFER_OVERFLOW: Win32Error = Win32Error(111);
    /// There is not enough space on the disk.
    pub const DISK_FULL: Win32Error = Win32Error(112);
    /// No more internal file identifiers available.
    pub const NO_MORE_SEARCH_HANDLES: Win32Error = Win32Error(113);
    /// The target internal file identifier is incorrect.
    pub const INVALID_TARGET_HANDLE: Win32Error = Win32Error(114);
    /// The IOCTL call made by the application program is not correct.
    pub const INVALID_CATEGORY: Win32Error = Win32Error(117);
    /// The verify-on-write switch parameter value is not correct.
    pub const INVALID_VERIFY_SWITCH: Win32Error = Win32Error(118);
    /// The system does not support the command requested.
    pub const BAD_DRIVER_LEVEL: Win32Error = Win32Error(119);
    /// This function is not supported on this system.
    pub const CALL_NOT_IMPLEMENTED: Win32Error = Win32Error(120);
    /// The semaphore timeout period has expired.
    pub const SEM_TIMEOUT: Win32Error = Win32Error(121);
    /// The data area passed to a system call is too small.
    pub const INSUFFICIENT_BUFFER: Win32Error = Win32Error(122);
    /// The filename, directory name, or volume label syntax is incorrect.
    pub const INVALID_NAME: Win32Error = Win32Error(123);
    /// The system call level is not correct.
    pub const INVALID_LEVEL: Win32Error = Win32Error(124);
    /// The disk has no volume label.
    pub const NO_VOLUME_LABEL: Win32Error = Win32Error(125);
    /// The specified module could not be found.
    pub const MOD_NOT_FOUND: Win32Error = Win32Error(126);
    /// The specified procedure could not be found.
    pub const PROC_NOT_FOUND: Win32Error = Win32Error(127);
    /// There are no child processes to wait for.
    pub const WAIT_NO_CHILDREN: Win32Error = Win32Error(128);
    /// The %1 application cannot be run in Win32 mode.
    pub const CHILD_NOT_COMPLETE: Win32Error = Win32Error(129);
    /// Attempt to use a file handle to an open disk partition for an operation other than raw disk I/O.
    pub const DIRECT_ACCESS_HANDLE: Win32Error = Win32Error(130);
    /// An attempt was made to move the file pointer before the beginning of the file.
    pub const NEGATIVE_SEEK: Win32Error = Win32Error(131);
    /// The file pointer cannot be set on the specified device or file.
    pub const SEEK_ON_DEVICE: Win32Error = Win32Error(132);
    /// A JOIN or SUBST command cannot be used for a drive that contains previously joined drives.
    pub const IS_JOIN_TARGET: Win32Error = Win32Error(133);
    /// An attempt was made to use a JOIN or SUBST command on a drive that has already been joined.
    pub const IS_JOINED: Win32Error = Win32Error(134);
    /// An attempt was made to use a JOIN or SUBST command on a drive that has already been substituted.
    pub const IS_SUBSTED: Win32Error = Win32Error(135);
    /// The system tried to delete the JOIN of a drive that is not joined.
    pub const NOT_JOINED: Win32Error = Win32Error(136);
    /// The system tried to delete the substitution of a drive that is not substituted.
    pub const NOT_SUBSTED: Win32Error = Win32Error(137);
    /// The system tried to join a drive to a directory on a joined drive.
    pub const JOIN_TO_JOIN: Win32Error = Win32Error(138);
    /// The system tried to substitute a drive to a directory on a substituted drive.
    pub const SUBST_TO_SUBST: Win32Error = Win32Error(139);
    /// The system tried to join a drive to a directory on a substituted drive.
    pub const JOIN_TO_SUBST: Win32Error = Win32Error(140);
    /// The system tried to SUBST a drive to a directory on a joined drive.
    pub const SUBST_TO_JOIN: Win32Error = Win32Error(141);
    /// The system cannot perform a JOIN or SUBST at this time.
    pub const BUSY_DRIVE: Win32Error = Win32Error(142);
    /// The system cannot join or substitute a drive to or for a directory on the same drive.
    pub const SAME_DRIVE: Win32Error = Win32Error(143);
    /// The directory is not a subdirectory of the root directory.
    pub const DIR_NOT_ROOT: Win32Error = Win32Error(144);
    /// The directory is not empty.
    pub const DIR_NOT_EMPTY: Win32Error = Win32Error(145);
    /// The path specified is being used in a substitute.
    pub const IS_SUBST_PATH: Win32Error = Win32Error(146);
    /// Not enough resources are available to process this command.
    pub const IS_JOIN_PATH: Win32Error = Win32Error(147);
    /// The path specified cannot be used at this time.
    pub const PATH_BUSY: Win32Error = Win32Error(148);
    /// An attempt was made to join or substitute a drive for which a directory on the drive is the target of a previous substitute.
    pub const IS_SUBST_TARGET: Win32Error = Win32Error(149);
    /// System trace information was not specified in your CONFIG.SYS file, or tracing is disallowed.
    pub const SYSTEM_TRACE: Win32Error = Win32Error(150);
    /// The number of specified semaphore events for DosMuxSemWait is not correct.
    pub const INVALID_EVENT_COUNT: Win32Error = Win32Error(151);
    /// DosMuxSemWait did not execute; too many semaphores are already set.
    pub const TOO_MANY_MUXWAITERS: Win32Error = Win32Error(152);
    /// The DosMuxSemWait list is not correct.
    pub const INVALID_LIST_FORMAT: Win32Error = Win32Error(153);
    /// The volume label you entered exceeds the label character limit of the target file system.
    pub const LABEL_TOO_LONG: Win32Error = Win32Error(154);
    /// Cannot create another thread.
    pub const TOO_MANY_TCBS: Win32Error = Win32Error(155);
    /// The recipient process has refused the signal.
    pub const SIGNAL_REFUSED: Win32Error = Win32Error(156);
    /// The segment is already discarded and cannot be locked.
    pub const DISCARDED: Win32Error = Win32Error(157);
    /// The segment is already unlocked.
    pub const NOT_LOCKED: Win32Error = Win32Error(158);
    /// The address for the thread ID is not correct.
    pub const BAD_THREADID_ADDR: Win32Error = Win32Error(159);
    /// One or more arguments are not correct.
    pub const BAD_ARGUMENTS: Win32Error = Win32Error(160);
    /// The specified path is invalid.
    pub const BAD_PATHNAME: Win32Error = Win32Error(161);
    /// A signal is already pending.
    pub const SIGNAL_PENDING: Win32Error = Win32Error(162);
    /// No more threads can be created in the system.
    pub const MAX_THRDS_REACHED: Win32Error = Win32Error(164);
    /// Unable to lock a region of a file.
    pub const LOCK_FAILED: Win32Error = Win32Error(167);
    /// The requested resource is in use.
    pub const BUSY: Win32Error = Win32Error(170);
    /// Device's command support detection is in progress.
    pub const DEVICE_SUPPORT_IN_PROGRESS: Win32Error = Win32Error(171);
    /// A lock request was not outstanding for the supplied cancel region.
    pub const CANCEL_VIOLATION: Win32Error = Win32Error(173);
    /// The file system does not support atomic changes to the lock type.
    pub const ATOMIC_LOCKS_NOT_SUPPORTED: Win32Error = Win32Error(174);
    /// The system detected a segment number that was not correct.
    pub const INVALID_SEGMENT_NUMBER: Win32Error = Win32Error(180);
    /// The operating system cannot run %1.
    pub const INVALID_ORDINAL: Win32Error = Win32Error(182);
    /// Cannot create a file when that file already exists.
    pub const ALREADY_EXISTS: Win32Error = Win32Error(183);
    /// The flag passed is not correct.
    pub const INVALID_FLAG_NUMBER: Win32Error = Win32Error(186);
    /// The specified system semaphore name was not found.
    pub const SEM_NOT_FOUND: Win32Error = Win32Error(187);
    /// The operating system cannot run %1.
    pub const INVALID_STARTING_CODESEG: Win32Error = Win32Error(188);
    /// The operating system cannot run %1.
    pub const INVALID_STACKSEG: Win32Error = Win32Error(189);
    /// The operating system cannot run %1.
    pub const INVALID_MODULETYPE: Win32Error = Win32Error(190);
    /// Cannot run %1 in Win32 mode.
    pub const INVALID_EXE_SIGNATURE: Win32Error = Win32Error(191);
    /// The operating system cannot run %1.
    pub const EXE_MARKED_INVALID: Win32Error = Win32Error(192);
    /// %1 is not a valid Win32 application.
    pub const BAD_EXE_FORMAT: Win32Error = Win32Error(193);
    /// The operating system cannot run %1.
    pub const ITERATED_DATA_EXCEEDS_64k: Win32Error = Win32Error(194);
    /// The operating system cannot run %1.
    pub const INVALID_MINALLOCSIZE: Win32Error = Win32Error(195);
    /// The operating system cannot run this application program.
    pub const DYNLINK_FROM_INVALID_RING: Win32Error = Win32Error(196);
    /// The operating system is not presently configured to run this application.
    pub const IOPL_NOT_ENABLED: Win32Error = Win32Error(197);
    /// The operating system cannot run %1.
    pub const INVALID_SEGDPL: Win32Error = Win32Error(198);
    /// The operating system cannot run this application program.
    pub const AUTODATASEG_EXCEEDS_64k: Win32Error = Win32Error(199);
    /// The code segment cannot be greater than or equal to 64K.
    pub const RING2SEG_MUST_BE_MOVABLE: Win32Error = Win32Error(200);
    /// The operating system cannot run %1.
    pub const RELOC_CHAIN_XEEDS_SEGLIM: Win32Error = Win32Error(201);
    /// The operating system cannot run %1.
    pub const INFLOOP_IN_RELOC_CHAIN: Win32Error = Win32Error(202);
    /// The system could not find the environment option that was entered.
    pub const ENVVAR_NOT_FOUND: Win32Error = Win32Error(203);
    /// No process in the command subtree has a signal handler.
    pub const NO_SIGNAL_SENT: Win32Error = Win32Error(205);
    /// The filename or extension is too long.
    pub const FILENAME_EXCED_RANGE: Win32Error = Win32Error(206);
    /// The ring 2 stack is in use.
    pub const RING2_STACK_IN_USE: Win32Error = Win32Error(207);
    /// The global filename characters, * or ?, are entered incorrectly or too many global filename characters are specified.
    pub const META_EXPANSION_TOO_LONG: Win32Error = Win32Error(208);
    /// The signal being posted is not correct.
    pub const INVALID_SIGNAL_NUMBER: Win32Error = Win32Error(209);
    /// The signal handler cannot be set.
    pub const THREAD_1_INACTIVE: Win32Error = Win32Error(210);
    /// The segment is locked and cannot be reallocated.
    pub const LOCKED: Win32Error = Win32Error(212);
    /// Too many dynamic-link modules are attached to this program or dynamic-link module.
    pub const TOO_MANY_MODULES: Win32Error = Win32Error(214);
    /// Cannot nest calls to LoadModule.
    pub const NESTING_NOT_ALLOWED: Win32Error = Win32Error(215);
    /// This version of %1 is not compatible with the version of Windows you're running.
    /// Check your computer's system information and then contact the software publisher.
    pub const EXE_MACHINE_TYPE_MISMATCH: Win32Error = Win32Error(216);
    /// The image file %1 is signed, unable to modify.
    pub const EXE_CANNOT_MODIFY_SIGNED_BINARY: Win32Error = Win32Error(217);
    /// The image file %1 is strong signed, unable to modify.
    pub const EXE_CANNOT_MODIFY_STRONG_SIGNED_BINARY: Win32Error = Win32Error(218);
    /// This file is checked out or locked for editing by another user.
    pub const FILE_CHECKED_OUT: Win32Error = Win32Error(220);
    /// The file must be checked out before saving changes.
    pub const CHECKOUT_REQUIRED: Win32Error = Win32Error(221);
    /// The file type being saved or retrieved has been blocked.
    pub const BAD_FILE_TYPE: Win32Error = Win32Error(222);
    /// The file size exceeds the limit allowed and cannot be saved.
    pub const FILE_TOO_LARGE: Win32Error = Win32Error(223);
    /// Access Denied. Before opening files in this location, you must first add the web site to your trusted sites list, browse to the web site, and select the option to login automatically.
    pub const FORMS_AUTH_REQUIRED: Win32Error = Win32Error(224);
    /// Operation did not complete successfully because the file contains a virus or potentially unwanted software.
    pub const VIRUS_INFECTED: Win32Error = Win32Error(225);
    /// This file contains a virus or potentially unwanted software and cannot be opened.
    /// Due to the nature of this virus or potentially unwanted software, the file has been removed from this location.
    pub const VIRUS_DELETED: Win32Error = Win32Error(226);
    /// The pipe is local.
    pub const PIPE_LOCAL: Win32Error = Win32Error(229);
    /// The pipe state is invalid.
    pub const BAD_PIPE: Win32Error = Win32Error(230);
    /// All pipe instances are busy.
    pub const PIPE_BUSY: Win32Error = Win32Error(231);
    /// The pipe is being closed.
    pub const NO_DATA: Win32Error = Win32Error(232);
    /// No process is on the other end of the pipe.
    pub const PIPE_NOT_CONNECTED: Win32Error = Win32Error(233);
    /// More data is available.
    pub const MORE_DATA: Win32Error = Win32Error(234);
    /// The session was canceled.
    pub const VC_DISCONNECTED: Win32Error = Win32Error(240);
    /// The specified extended attribute name was invalid.
    pub const INVALID_EA_NAME: Win32Error = Win32Error(254);
    /// The extended attributes are inconsistent.
    pub const EA_LIST_INCONSISTENT: Win32Error = Win32Error(255);
    /// The wait operation timed out.
    pub const IMEOUT: Win32Error = Win32Error(258);
    /// No more data is available.
    pub const NO_MORE_ITEMS: Win32Error = Win32Error(259);
    /// The copy functions cannot be used.
    pub const CANNOT_COPY: Win32Error = Win32Error(266);
    /// The directory name is invalid.
    pub const DIRECTORY: Win32Error = Win32Error(267);
    /// The extended attributes did not fit in the buffer.
    pub const EAS_DIDNT_FIT: Win32Error = Win32Error(275);
    /// The extended attribute file on the mounted file system is corrupt.
    pub const EA_FILE_CORRUPT: Win32Error = Win32Error(276);
    /// The extended attribute table file is full.
    pub const EA_TABLE_FULL: Win32Error = Win32Error(277);
    /// The specified extended attribute handle is invalid.
    pub const INVALID_EA_HANDLE: Win32Error = Win32Error(278);
    /// The mounted file system does not support extended attributes.
    pub const EAS_NOT_SUPPORTED: Win32Error = Win32Error(282);
    /// Attempt to release mutex not owned by caller.
    pub const NOT_OWNER: Win32Error = Win32Error(288);
    /// Too many posts were made to a semaphore.
    pub const TOO_MANY_POSTS: Win32Error = Win32Error(298);
    /// Only part of a ReadProcessMemory or WriteProcessMemory request was completed.
    pub const PARTIAL_COPY: Win32Error = Win32Error(299);
    /// The oplock request is denied.
    pub const OPLOCK_NOT_GRANTED: Win32Error = Win32Error(300);
    /// An invalid oplock acknowledgment was received by the system.
    pub const INVALID_OPLOCK_PROTOCOL: Win32Error = Win32Error(301);
    /// The volume is too fragmented to complete this operation.
    pub const DISK_TOO_FRAGMENTED: Win32Error = Win32Error(302);
    /// The file cannot be opened because it is in the process of being deleted.
    pub const DELETE_PENDING: Win32Error = Win32Error(303);
    /// Short name settings may not be changed on this volume due to the global registry setting.
    pub const INCOMPATIBLE_WITH_GLOBAL_SHORT_NAME_REGISTRY_SETTING: Win32Error = Win32Error(304);
    /// Short names are not enabled on this volume.
    pub const SHORT_NAMES_NOT_ENABLED_ON_VOLUME: Win32Error = Win32Error(305);
    /// The security stream for the given volume is in an inconsistent state. Please run CHKDSK on the volume.
    pub const SECURITY_STREAM_IS_INCONSISTENT: Win32Error = Win32Error(306);
    /// A requested file lock operation cannot be processed due to an invalid byte range.
    pub const INVALID_LOCK_RANGE: Win32Error = Win32Error(307);
    /// The subsystem needed to support the image type is not present.
    pub const IMAGE_SUBSYSTEM_NOT_PRESENT: Win32Error = Win32Error(308);
    /// The specified file already has a notification GUID associated with it.
    pub const NOTIFICATION_GUID_ALREADY_DEFINED: Win32Error = Win32Error(309);
    /// An invalid exception handler routine has been detected.
    pub const INVALID_EXCEPTION_HANDLER: Win32Error = Win32Error(310);
    /// Duplicate privileges were specified for the token.
    pub const DUPLICATE_PRIVILEGES: Win32Error = Win32Error(311);
    /// No ranges for the specified operation were able to be processed.
    pub const NO_RANGES_PROCESSED: Win32Error = Win32Error(312);
    /// Operation is not allowed on a file system internal file.
    pub const NOT_ALLOWED_ON_SYSTEM_FILE: Win32Error = Win32Error(313);
    /// The physical resources of this disk have been exhausted.
    pub const DISK_RESOURCES_EXHAUSTED: Win32Error = Win32Error(314);
    /// The token representing the data is invalid.
    pub const INVALID_TOKEN: Win32Error = Win32Error(315);
    /// The device does not support the command feature.
    pub const DEVICE_FEATURE_NOT_SUPPORTED: Win32Error = Win32Error(316);
    /// The system cannot find message text for message number 0x%1 in the message file for %2.
    pub const MR_MID_NOT_FOUND: Win32Error = Win32Error(317);
    /// The scope specified was not found.
    pub const SCOPE_NOT_FOUND: Win32Error = Win32Error(318);
    /// The Central Access Policy specified is not defined on the target machine.
    pub const UNDEFINED_SCOPE: Win32Error = Win32Error(319);
    /// The Central Access Policy obtained from Active Directory is invalid.
    pub const INVALID_CAP: Win32Error = Win32Error(320);
    /// The device is unreachable.
    pub const DEVICE_UNREACHABLE: Win32Error = Win32Error(321);
    /// The target device has insufficient resources to complete the operation.
    pub const DEVICE_NO_RESOURCES: Win32Error = Win32Error(322);
    /// A data integrity checksum error occurred. Data in the file stream is corrupt.
    pub const DATA_CHECKSUM_ERROR: Win32Error = Win32Error(323);
    /// An attempt was made to modify both a KERNEL and normal Extended Attribute (EA) in the same operation.
    pub const INTERMIXED_KERNEL_EA_OPERATION: Win32Error = Win32Error(324);
    /// Device does not support file-level TRIM.
    pub const FILE_LEVEL_TRIM_NOT_SUPPORTED: Win32Error = Win32Error(326);
    /// The command specified a data offset that does not align to the device's granularity/alignment.
    pub const OFFSET_ALIGNMENT_VIOLATION: Win32Error = Win32Error(327);
    /// The command specified an invalid field in its parameter list.
    pub const INVALID_FIELD_IN_PARAMETER_LIST: Win32Error = Win32Error(328);
    /// An operation is currently in progress with the device.
    pub const OPERATION_IN_PROGRESS: Win32Error = Win32Error(329);
    /// An attempt was made to send down the command via an invalid path to the target device.
    pub const BAD_DEVICE_PATH: Win32Error = Win32Error(330);
    /// The command specified a number of descriptors that exceeded the maximum supported by the device.
    pub const TOO_MANY_DESCRIPTORS: Win32Error = Win32Error(331);
    /// Scrub is disabled on the specified file.
    pub const SCRUB_DATA_DISABLED: Win32Error = Win32Error(332);
    /// The storage device does not provide redundancy.
    pub const NOT_REDUNDANT_STORAGE: Win32Error = Win32Error(333);
    /// An operation is not supported on a resident file.
    pub const RESIDENT_FILE_NOT_SUPPORTED: Win32Error = Win32Error(334);
    /// An operation is not supported on a compressed file.
    pub const COMPRESSED_FILE_NOT_SUPPORTED: Win32Error = Win32Error(335);
    /// An operation is not supported on a directory.
    pub const DIRECTORY_NOT_SUPPORTED: Win32Error = Win32Error(336);
    /// The specified copy of the requested data could not be read.
    pub const NOT_READ_FROM_COPY: Win32Error = Win32Error(337);
    /// No action was taken as a system reboot is required.
    pub const FAIL_NOACTION_REBOOT: Win32Error = Win32Error(350);
    /// The shutdown operation failed.
    pub const FAIL_SHUTDOWN: Win32Error = Win32Error(351);
    /// The restart operation failed.
    pub const FAIL_RESTART: Win32Error = Win32Error(352);
    /// The maximum number of sessions has been reached.
    pub const MAX_SESSIONS_REACHED: Win32Error = Win32Error(353);
    /// The thread is already in background processing mode.
    pub const THREAD_MODE_ALREADY_BACKGROUND: Win32Error = Win32Error(400);
    /// The thread is not in background processing mode.
    pub const THREAD_MODE_NOT_BACKGROUND: Win32Error = Win32Error(401);
    /// The process is already in background processing mode.
    pub const PROCESS_MODE_ALREADY_BACKGROUND: Win32Error = Win32Error(402);
    /// The process is not in background processing mode.
    pub const PROCESS_MODE_NOT_BACKGROUND: Win32Error = Win32Error(403);
    /// Attempt to access invalid address.
    pub const INVALID_ADDRESS: Win32Error = Win32Error(487);
    /// User profile cannot be loaded.
    pub const USER_PROFILE_LOAD: Win32Error = Win32Error(500);
    /// Arithmetic result exceeded 32 bits.
    pub const ARITHMETIC_OVERFLOW: Win32Error = Win32Error(534);
    /// There is a process on other end of the pipe.
    pub const PIPE_CONNECTED: Win32Error = Win32Error(535);
    /// Waiting for a process to open the other end of the pipe.
    pub const PIPE_LISTENING: Win32Error = Win32Error(536);
    /// Application verifier has found an error in the current process.
    pub const VERIFIER_STOP: Win32Error = Win32Error(537);
    /// An error occurred in the ABIOS subsystem.
    pub const ABIOS_ERROR: Win32Error = Win32Error(538);
    /// A warning occurred in the WX86 subsystem.
    pub const WX86_WARNING: Win32Error = Win32Error(539);
    /// An error occurred in the WX86 subsystem.
    pub const WX86_ERROR: Win32Error = Win32Error(540);
    /// An attempt was made to cancel or set a timer that has an associated APC and the subject thread is not the thread that originally set the timer with an associated APC routine.
    pub const TIMER_NOT_CANCELED: Win32Error = Win32Error(541);
    /// Unwind exception code.
    pub const UNWIND: Win32Error = Win32Error(542);
    /// An invalid or unaligned stack was encountered during an unwind operation.
    pub const BAD_STACK: Win32Error = Win32Error(543);
    /// An invalid unwind target was encountered during an unwind operation.
    pub const INVALID_UNWIND_TARGET: Win32Error = Win32Error(544);
    /// Invalid Object Attributes specified to NtCreatePort or invalid Port Attributes specified to NtConnectPort
    pub const INVALID_PORT_ATTRIBUTES: Win32Error = Win32Error(545);
    /// Length of message passed to NtRequestPort or NtRequestWaitReplyPort was longer than the maximum message allowed by the port.
    pub const PORT_MESSAGE_TOO_LONG: Win32Error = Win32Error(546);
    /// An attempt was made to lower a quota limit below the current usage.
    pub const INVALID_QUOTA_LOWER: Win32Error = Win32Error(547);
    /// An attempt was made to attach to a device that was already attached to another device.
    pub const DEVICE_ALREADY_ATTACHED: Win32Error = Win32Error(548);
    /// An attempt was made to execute an instruction at an unaligned address and the host system does not support unaligned instruction references.
    pub const INSTRUCTION_MISALIGNMENT: Win32Error = Win32Error(549);
    /// Profiling not started.
    pub const PROFILING_NOT_STARTED: Win32Error = Win32Error(550);
    /// Profiling not stopped.
    pub const PROFILING_NOT_STOPPED: Win32Error = Win32Error(551);
    /// The passed ACL did not contain the minimum required information.
    pub const COULD_NOT_INTERPRET: Win32Error = Win32Error(552);
    /// The number of active profiling objects is at the maximum and no more may be started.
    pub const PROFILING_AT_LIMIT: Win32Error = Win32Error(553);
    /// Used to indicate that an operation cannot continue without blocking for I/O.
    pub const CANT_WAIT: Win32Error = Win32Error(554);
    /// Indicates that a thread attempted to terminate itself by default (called NtTerminateThread with NULL) and it was the last thread in the current process.
    pub const CANT_TERMINATE_SELF: Win32Error = Win32Error(555);
    /// If an MM error is returned which is not defined in the standard FsRtl filter, it is converted to one of the following errors which is guaranteed to be in the filter.
    /// In this case information is lost, however, the filter correctly handles the exception.
    pub const UNEXPECTED_MM_CREATE_ERR: Win32Error = Win32Error(556);
    /// If an MM error is returned which is not defined in the standard FsRtl filter, it is converted to one of the following errors which is guaranteed to be in the filter.
    /// In this case information is lost, however, the filter correctly handles the exception.
    pub const UNEXPECTED_MM_MAP_ERROR: Win32Error = Win32Error(557);
    /// If an MM error is returned which is not defined in the standard FsRtl filter, it is converted to one of the following errors which is guaranteed to be in the filter.
    /// In this case information is lost, however, the filter correctly handles the exception.
    pub const UNEXPECTED_MM_EXTEND_ERR: Win32Error = Win32Error(558);
    /// A malformed function table was encountered during an unwind operation.
    pub const BAD_FUNCTION_TABLE: Win32Error = Win32Error(559);
    /// Indicates that an attempt was made to assign protection to a file system file or directory and one of the SIDs in the security descriptor could not be translated into a GUID that could be stored by the file system.
    /// This causes the protection attempt to fail, which may cause a file creation attempt to fail.
    pub const NO_GUID_TRANSLATION: Win32Error = Win32Error(560);
    /// Indicates that an attempt was made to grow an LDT by setting its size, or that the size was not an even number of selectors.
    pub const INVALID_LDT_SIZE: Win32Error = Win32Error(561);
    /// Indicates that the starting value for the LDT information was not an integral multiple of the selector size.
    pub const INVALID_LDT_OFFSET: Win32Error = Win32Error(563);
    /// Indicates that the user supplied an invalid descriptor when trying to set up Ldt descriptors.
    pub const INVALID_LDT_DESCRIPTOR: Win32Error = Win32Error(564);
    /// Indicates a process has too many threads to perform the requested action.
    /// For example, assignment of a primary token may only be performed when a process has zero or one threads.
    pub const TOO_MANY_THREADS: Win32Error = Win32Error(565);
    /// An attempt was made to operate on a thread within a specific process, but the thread specified is not in the process specified.
    pub const THREAD_NOT_IN_PROCESS: Win32Error = Win32Error(566);
    /// Page file quota was exceeded.
    pub const PAGEFILE_QUOTA_EXCEEDED: Win32Error = Win32Error(567);
    /// The Netlogon service cannot start because another Netlogon service running in the domain conflicts with the specified role.
    pub const LOGON_SERVER_CONFLICT: Win32Error = Win32Error(568);
    /// The SAM database on a Windows Server is significantly out of synchronization with the copy on the Domain Controller. A complete synchronization is required.
    pub const SYNCHRONIZATION_REQUIRED: Win32Error = Win32Error(569);
    /// The NtCreateFile API failed. This error should never be returned to an application, it is a place holder for the Windows Lan Manager Redirector to use in its internal error mapping routines.
    pub const NET_OPEN_FAILED: Win32Error = Win32Error(570);
    /// {Privilege Failed} The I/O permissions for the process could not be changed.
    pub const IO_PRIVILEGE_FAILED: Win32Error = Win32Error(571);
    /// {Application Exit by CTRL+C} The application terminated as a result of a CTRL+C.
    pub const CONTROL_C_EXIT: Win32Error = Win32Error(572);
    /// {Missing System File} The required system file %hs is bad or missing.
    pub const MISSING_SYSTEMFILE: Win32Error = Win32Error(573);
    /// {Application Error} The exception %s (0x%08lx) occurred in the application at location 0x%08lx.
    pub const UNHANDLED_EXCEPTION: Win32Error = Win32Error(574);
    /// {Application Error} The application was unable to start correctly (0x%lx). Click OK to close the application.
    pub const APP_INIT_FAILURE: Win32Error = Win32Error(575);
    /// {Unable to Create Paging File} The creation of the paging file %hs failed (%lx). The requested size was %ld.
    pub const PAGEFILE_CREATE_FAILED: Win32Error = Win32Error(576);
    /// Windows cannot verify the digital signature for this file.
    /// A recent hardware or software change might have installed a file that is signed incorrectly or damaged, or that might be malicious software from an unknown source.
    pub const INVALID_IMAGE_HASH: Win32Error = Win32Error(577);
    /// {No Paging File Specified} No paging file was specified in the system configuration.
    pub const NO_PAGEFILE: Win32Error = Win32Error(578);
    /// {EXCEPTION} A real-mode application issued a floating-point instruction and floating-point hardware is not present.
    pub const ILLEGAL_FLOAT_CONTEXT: Win32Error = Win32Error(579);
    /// An event pair synchronization operation was performed using the thread specific client/server event pair object, but no event pair object was associated with the thread.
    pub const NO_EVENT_PAIR: Win32Error = Win32Error(580);
    /// A Windows Server has an incorrect configuration.
    pub const DOMAIN_CTRLR_CONFIG_ERROR: Win32Error = Win32Error(581);
    /// An illegal character was encountered.
    /// For a multi-byte character set this includes a lead byte without a succeeding trail byte.
    /// For the Unicode character set this includes the characters 0xFFFF and 0xFFFE.
    pub const ILLEGAL_CHARACTER: Win32Error = Win32Error(582);
    /// The Unicode character is not defined in the Unicode character set installed on the system.
    pub const UNDEFINED_CHARACTER: Win32Error = Win32Error(583);
    /// The paging file cannot be created on a floppy diskette.
    pub const FLOPPY_VOLUME: Win32Error = Win32Error(584);
    /// The system BIOS failed to connect a system interrupt to the device or bus for which the device is connected.
    pub const BIOS_FAILED_TO_CONNECT_INTERRUPT: Win32Error = Win32Error(585);
    /// This operation is only allowed for the Primary Domain Controller of the domain.
    pub const BACKUP_CONTROLLER: Win32Error = Win32Error(586);
    /// An attempt was made to acquire a mutant such that its maximum count would have been exceeded.
    pub const MUTANT_LIMIT_EXCEEDED: Win32Error = Win32Error(587);
    /// A volume has been accessed for which a file system driver is required that has not yet been loaded.
    pub const FS_DRIVER_REQUIRED: Win32Error = Win32Error(588);
    /// {Registry File Failure} The registry cannot load the hive (file): %hs or its log or alternate. It is corrupt, absent, or not writable.
    pub const CANNOT_LOAD_REGISTRY_FILE: Win32Error = Win32Error(589);
    /// {Unexpected Failure in DebugActiveProcess} An unexpected failure occurred while processing a DebugActiveProcess API request.
    /// You may choose OK to terminate the process, or Cancel to ignore the error.
    pub const DEBUG_ATTACH_FAILED: Win32Error = Win32Error(590);
    /// {Fatal System Error} The %hs system process terminated unexpectedly with a status of 0x%08x (0x%08x 0x%08x). The system has been shut down.
    pub const SYSTEM_PROCESS_TERMINATED: Win32Error = Win32Error(591);
    /// {Data Not Accepted} The TDI client could not handle the data received during an indication.
    pub const DATA_NOT_ACCEPTED: Win32Error = Win32Error(592);
    /// NTVDM encountered a hard error.
    pub const VDM_HARD_ERROR: Win32Error = Win32Error(593);
    /// {Cancel Timeout} The driver %hs failed to complete a cancelled I/O request in the allotted time.
    pub const DRIVER_CANCEL_TIMEOUT: Win32Error = Win32Error(594);
    /// {Reply Message Mismatch} An attempt was made to reply to an LPC message, but the thread specified by the client ID in the message was not waiting on that message.
    pub const REPLY_MESSAGE_MISMATCH: Win32Error = Win32Error(595);
    /// {Delayed Write Failed} Windows was unable to save all the data for the file %hs. The data has been lost.
    /// This error may be caused by a failure of your computer hardware or network connection. Please try to save this file elsewhere.
    pub const LOST_WRITEBEHIND_DATA: Win32Error = Win32Error(596);
    /// The parameter(s) passed to the server in the client/server shared memory window were invalid.
    /// Too much data may have been put in the shared memory window.
    pub const CLIENT_SERVER_PARAMETERS_INVALID: Win32Error = Win32Error(597);
    /// The stream is not a tiny stream.
    pub const NOT_TINY_STREAM: Win32Error = Win32Error(598);
    /// The request must be handled by the stack overflow code.
    pub const STACK_OVERFLOW_READ: Win32Error = Win32Error(599);
    /// Internal OFS status codes indicating how an allocation operation is handled.
    /// Either it is retried after the containing onode is moved or the extent stream is converted to a large stream.
    pub const CONVERT_TO_LARGE: Win32Error = Win32Error(600);
    /// The attempt to find the object found an object matching by ID on the volume but it is out of the scope of the handle used for the operation.
    pub const FOUND_OUT_OF_SCOPE: Win32Error = Win32Error(601);
    /// The bucket array must be grown. Retry transaction after doing so.
    pub const ALLOCATE_BUCKET: Win32Error = Win32Error(602);
    /// The user/kernel marshalling buffer has overflowed.
    pub const MARSHALL_OVERFLOW: Win32Error = Win32Error(603);
    /// The supplied variant structure contains invalid data.
    pub const INVALID_VARIANT: Win32Error = Win32Error(604);
    /// The specified buffer contains ill-formed data.
    pub const BAD_COMPRESSION_BUFFER: Win32Error = Win32Error(605);
    /// {Audit Failed} An attempt to generate a security audit failed.
    pub const AUDIT_FAILED: Win32Error = Win32Error(606);
    /// The timer resolution was not previously set by the current process.
    pub const TIMER_RESOLUTION_NOT_SET: Win32Error = Win32Error(607);
    /// There is insufficient account information to log you on.
    pub const INSUFFICIENT_LOGON_INFO: Win32Error = Win32Error(608);
    /// {Invalid DLL Entrypoint} The dynamic link library %hs is not written correctly.
    /// The stack pointer has been left in an inconsistent state.
    /// The entrypoint should be declared as WINAPI or STDCALL.
    /// Select YES to fail the DLL load. Select NO to continue execution.
    /// Selecting NO may cause the application to operate incorrectly.
    pub const BAD_DLL_ENTRYPOINT: Win32Error = Win32Error(609);
    /// {Invalid Service Callback Entrypoint} The %hs service is not written correctly.
    /// The stack pointer has been left in an inconsistent state.
    /// The callback entrypoint should be declared as WINAPI or STDCALL.
    /// Selecting OK will cause the service to continue operation.
    /// However, the service process may operate incorrectly.
    pub const BAD_SERVICE_ENTRYPOINT: Win32Error = Win32Error(610);
    /// There is an IP address conflict with another system on the network.
    pub const IP_ADDRESS_CONFLICT1: Win32Error = Win32Error(611);
    /// There is an IP address conflict with another system on the network.
    pub const IP_ADDRESS_CONFLICT2: Win32Error = Win32Error(612);
    /// {Low On Registry Space} The system has reached the maximum size allowed for the system part of the registry. Additional storage requests will be ignored.
    pub const REGISTRY_QUOTA_LIMIT: Win32Error = Win32Error(613);
    /// A callback return system service cannot be executed when no callback is active.
    pub const NO_CALLBACK_ACTIVE: Win32Error = Win32Error(614);
    /// The password provided is too short to meet the policy of your user account. Please choose a longer password.
    pub const PWD_TOO_SHORT: Win32Error = Win32Error(615);
    /// The policy of your user account does not allow you to change passwords too frequently.
    /// This is done to prevent users from changing back to a familiar, but potentially discovered, password.
    /// If you feel your password has been compromised then please contact your administrator immediately to have a new one assigned.
    pub const PWD_TOO_RECENT: Win32Error = Win32Error(616);
    /// You have attempted to change your password to one that you have used in the past.
    /// The policy of your user account does not allow this.
    /// Please select a password that you have not previously used.
    pub const PWD_HISTORY_CONFLICT: Win32Error = Win32Error(617);
    /// The specified compression format is unsupported.
    pub const UNSUPPORTED_COMPRESSION: Win32Error = Win32Error(618);
    /// The specified hardware profile configuration is invalid.
    pub const INVALID_HW_PROFILE: Win32Error = Win32Error(619);
    /// The specified Plug and Play registry device path is invalid.
    pub const INVALID_PLUGPLAY_DEVICE_PATH: Win32Error = Win32Error(620);
    /// The specified quota list is internally inconsistent with its descriptor.
    pub const QUOTA_LIST_INCONSISTENT: Win32Error = Win32Error(621);
    /// {Windows Evaluation Notification} The evaluation period for this installation of Windows has expired. This system will shutdown in 1 hour.
    /// To restore access to this installation of Windows, please upgrade this installation using a licensed distribution of this product.
    pub const EVALUATION_EXPIRATION: Win32Error = Win32Error(622);
    /// {Illegal System DLL Relocation} The system DLL %hs was relocated in memory. The application will not run properly.
    /// The relocation occurred because the DLL %hs occupied an address range reserved for Windows system DLLs.
    /// The vendor supplying the DLL should be contacted for a new DLL.
    pub const ILLEGAL_DLL_RELOCATION: Win32Error = Win32Error(623);
    /// {DLL Initialization Failed} The application failed to initialize because the window station is shutting down.
    pub const DLL_INIT_FAILED_LOGOFF: Win32Error = Win32Error(624);
    /// The validation process needs to continue on to the next step.
    pub const VALIDATE_CONTINUE: Win32Error = Win32Error(625);
    /// There are no more matches for the current index enumeration.
    pub const NO_MORE_MATCHES: Win32Error = Win32Error(626);
    /// The range could not be added to the range list because of a conflict.
    pub const RANGE_LIST_CONFLICT: Win32Error = Win32Error(627);
    /// The server process is running under a SID different than that required by client.
    pub const SERVER_SID_MISMATCH: Win32Error = Win32Error(628);
    /// A group marked use for deny only cannot be enabled.
    pub const CANT_ENABLE_DENY_ONLY: Win32Error = Win32Error(629);
    /// {EXCEPTION} Multiple floating point faults.
    pub const FLOAT_MULTIPLE_FAULTS: Win32Error = Win32Error(630);
    /// {EXCEPTION} Multiple floating point traps.
    pub const FLOAT_MULTIPLE_TRAPS: Win32Error = Win32Error(631);
    /// The requested interface is not supported.
    pub const NOINTERFACE: Win32Error = Win32Error(632);
    /// {System Standby Failed} The driver %hs does not support standby mode.
    /// Updating this driver may allow the system to go to standby mode.
    pub const DRIVER_FAILED_SLEEP: Win32Error = Win32Error(633);
    /// The system file %1 has become corrupt and has been replaced.
    pub const CORRUPT_SYSTEM_FILE: Win32Error = Win32Error(634);
    /// {Virtual Memory Minimum Too Low} Your system is low on virtual memory.
    /// Windows is increasing the size of your virtual memory paging file.
    /// During this process, memory requests for some applications may be denied. For more information, see Help.
    pub const COMMITMENT_MINIMUM: Win32Error = Win32Error(635);
    /// A device was removed so enumeration must be restarted.
    pub const PNP_RESTART_ENUMERATION: Win32Error = Win32Error(636);
    /// {Fatal System Error} The system image %s is not properly signed.
    /// The file has been replaced with the signed file. The system has been shut down.
    pub const SYSTEM_IMAGE_BAD_SIGNATURE: Win32Error = Win32Error(637);
    /// Device will not start without a reboot.
    pub const PNP_REBOOT_REQUIRED: Win32Error = Win32Error(638);
    /// There is not enough power to complete the requested operation.
    pub const INSUFFICIENT_POWER: Win32Error = Win32Error(639);
    /// ERROR_MULTIPLE_FAULT_VIOLATION
    pub const MULTIPLE_FAULT_VIOLATION: Win32Error = Win32Error(640);
    /// The system is in the process of shutting down.
    pub const SYSTEM_SHUTDOWN: Win32Error = Win32Error(641);
    /// An attempt to remove a processes DebugPort was made, but a port was not already associated with the process.
    pub const PORT_NOT_SET: Win32Error = Win32Error(642);
    /// This version of Windows is not compatible with the behavior version of directory forest, domain or domain controller.
    pub const DS_VERSION_CHECK_FAILURE: Win32Error = Win32Error(643);
    /// The specified range could not be found in the range list.
    pub const RANGE_NOT_FOUND: Win32Error = Win32Error(644);
    /// The driver was not loaded because the system is booting into safe mode.
    pub const NOT_SAFE_MODE_DRIVER: Win32Error = Win32Error(646);
    /// The driver was not loaded because it failed its initialization call.
    pub const FAILED_DRIVER_ENTRY: Win32Error = Win32Error(647);
    /// The "%hs" encountered an error while applying power or reading the device configuration.
    /// This may be caused by a failure of your hardware or by a poor connection.
    pub const DEVICE_ENUMERATION_ERROR: Win32Error = Win32Error(648);
    /// The create operation failed because the name contained at least one mount point which resolves to a volume to which the specified device object is not attached.
    pub const MOUNT_POINT_NOT_RESOLVED: Win32Error = Win32Error(649);
    /// The device object parameter is either not a valid device object or is not attached to the volume specified by the file name.
    pub const INVALID_DEVICE_OBJECT_PARAMETER: Win32Error = Win32Error(650);
    /// A Machine Check Error has occurred.
    /// Please check the system eventlog for additional information.
    pub const MCA_OCCURED: Win32Error = Win32Error(651);
    /// There was error [%2] processing the driver database.
    pub const DRIVER_DATABASE_ERROR: Win32Error = Win32Error(652);
    /// System hive size has exceeded its limit.
    pub const SYSTEM_HIVE_TOO_LARGE: Win32Error = Win32Error(653);
    /// The driver could not be loaded because a previous version of the driver is still in memory.
    pub const DRIVER_FAILED_PRIOR_UNLOAD: Win32Error = Win32Error(654);
    /// {Volume Shadow Copy Service} Please wait while the Volume Shadow Copy Service prepares volume %hs for hibernation.
    pub const VOLSNAP_PREPARE_HIBERNATE: Win32Error = Win32Error(655);
    /// The system has failed to hibernate (The error code is %hs).
    /// Hibernation will be disabled until the system is restarted.
    pub const HIBERNATION_FAILURE: Win32Error = Win32Error(656);
    /// The password provided is too long to meet the policy of your user account. Please choose a shorter password.
    pub const PWD_TOO_LONG: Win32Error = Win32Error(657);
    /// The requested operation could not be completed due to a file system limitation.
    pub const FILE_SYSTEM_LIMITATION: Win32Error = Win32Error(665);
    /// An assertion failure has occurred.
    pub const ASSERTION_FAILURE: Win32Error = Win32Error(668);
    /// An error occurred in the ACPI subsystem.
    pub const ACPI_ERROR: Win32Error = Win32Error(669);
    /// WOW Assertion Error.
    pub const WOW_ASSERTION: Win32Error = Win32Error(670);
    /// A device is missing in the system BIOS MPS table. This device will not be used.
    /// Please contact your system vendor for system BIOS update.
    pub const PNP_BAD_MPS_TABLE: Win32Error = Win32Error(671);
    /// A translator failed to translate resources.
    pub const PNP_TRANSLATION_FAILED: Win32Error = Win32Error(672);
    /// A IRQ translator failed to translate resources.
    pub const PNP_IRQ_TRANSLATION_FAILED: Win32Error = Win32Error(673);
    /// Driver %2 returned invalid ID for a child device (%3).
    pub const PNP_INVALID_ID: Win32Error = Win32Error(674);
    /// {Kernel Debugger Awakened} the system debugger was awakened by an interrupt.
    pub const WAKE_SYSTEM_DEBUGGER: Win32Error = Win32Error(675);
    /// {Handles Closed} Handles to objects have been automatically closed as a result of the requested operation.
    pub const HANDLES_CLOSED: Win32Error = Win32Error(676);
    /// {Too Much Information} The specified access control list (ACL) contained more information than was expected.
    pub const EXTRANEOUS_INFORMATION: Win32Error = Win32Error(677);
    /// This warning level status indicates that the transaction state already exists for the registry sub-tree, but that a transaction commit was previously aborted.
    /// The commit has NOT been completed, but has not been rolled back either (so it may still be committed if desired).
    pub const RXACT_COMMIT_NECESSARY: Win32Error = Win32Error(678);
    /// {Media Changed} The media may have changed.
    pub const MEDIA_CHECK: Win32Error = Win32Error(679);
    /// {GUID Substitution} During the translation of a global identifier (GUID) to a Windows security ID (SID), no administratively-defined GUID prefix was found.
    /// A substitute prefix was used, which will not compromise system security.
    /// However, this may provide a more restrictive access than intended.
    pub const GUID_SUBSTITUTION_MADE: Win32Error = Win32Error(680);
    /// The create operation stopped after reaching a symbolic link.
    pub const STOPPED_ON_SYMLINK: Win32Error = Win32Error(681);
    /// A long jump has been executed.
    pub const LONGJUMP: Win32Error = Win32Error(682);
    /// The Plug and Play query operation was not successful.
    pub const PLUGPLAY_QUERY_VETOED: Win32Error = Win32Error(683);
    /// A frame consolidation has been executed.
    pub const UNWIND_CONSOLIDATE: Win32Error = Win32Error(684);
    /// {Registry Hive Recovered} Registry hive (file): %hs was corrupted and it has been recovered. Some data might have been lost.
    pub const REGISTRY_HIVE_RECOVERED: Win32Error = Win32Error(685);
    /// The application is attempting to run executable code from the module %hs. This may be insecure.
    /// An alternative, %hs, is available. Should the application use the secure module %hs?
    pub const DLL_MIGHT_BE_INSECURE: Win32Error = Win32Error(686);
    /// The application is loading executable code from the module %hs.
    /// This is secure, but may be incompatible with previous releases of the operating system.
    /// An alternative, %hs, is available. Should the application use the secure module %hs?
    pub const DLL_MIGHT_BE_INCOMPATIBLE: Win32Error = Win32Error(687);
    /// Debugger did not handle the exception.
    pub const DBG_EXCEPTION_NOT_HANDLED: Win32Error = Win32Error(688);
    /// Debugger will reply later.
    pub const DBG_REPLY_LATER: Win32Error = Win32Error(689);
    /// Debugger cannot provide handle.
    pub const DBG_UNABLE_TO_PROVIDE_HANDLE: Win32Error = Win32Error(690);
    /// Debugger terminated thread.
    pub const DBG_TERMINATE_THREAD: Win32Error = Win32Error(691);
    /// Debugger terminated process.
    pub const DBG_TERMINATE_PROCESS: Win32Error = Win32Error(692);
    /// Debugger got control C.
    pub const DBG_CONTROL_C: Win32Error = Win32Error(693);
    /// Debugger printed exception on control C.
    pub const DBG_PRINTEXCEPTION_C: Win32Error = Win32Error(694);
    /// Debugger received RIP exception.
    pub const DBG_RIPEXCEPTION: Win32Error = Win32Error(695);
    /// Debugger received control break.
    pub const DBG_CONTROL_BREAK: Win32Error = Win32Error(696);
    /// Debugger command communication exception.
    pub const DBG_COMMAND_EXCEPTION: Win32Error = Win32Error(697);
    /// {Object Exists} An attempt was made to create an object and the object name already existed.
    pub const OBJECT_NAME_EXISTS: Win32Error = Win32Error(698);
    /// {Thread Suspended} A thread termination occurred while the thread was suspended.
    /// The thread was resumed, and termination proceeded.
    pub const THREAD_WAS_SUSPENDED: Win32Error = Win32Error(699);
    /// {Image Relocated} An image file could not be mapped at the address specified in the image file. Local fixups must be performed on this image.
    pub const IMAGE_NOT_AT_BASE: Win32Error = Win32Error(700);
    /// This informational level status indicates that a specified registry sub-tree transaction state did not yet exist and had to be created.
    pub const RXACT_STATE_CREATED: Win32Error = Win32Error(701);
    /// {Segment Load} A virtual DOS machine (VDM) is loading, unloading, or moving an MS-DOS or Win16 program segment image.
    /// An exception is raised so a debugger can load, unload or track symbols and breakpoints within these 16-bit segments.
    pub const SEGMENT_NOTIFICATION: Win32Error = Win32Error(702);
    /// {Invalid Current Directory} The process cannot switch to the startup current directory %hs.
    /// Select OK to set current directory to %hs, or select CANCEL to exit.
    pub const BAD_CURRENT_DIRECTORY: Win32Error = Win32Error(703);
    /// {Redundant Read} To satisfy a read request, the NT fault-tolerant file system successfully read the requested data from a redundant copy.
    /// This was done because the file system encountered a failure on a member of the fault-tolerant volume, but was unable to reassign the failing area of the device.
    pub const FT_READ_RECOVERY_FROM_BACKUP: Win32Error = Win32Error(704);
    /// {Redundant Write} To satisfy a write request, the NT fault-tolerant file system successfully wrote a redundant copy of the information.
    /// This was done because the file system encountered a failure on a member of the fault-tolerant volume, but was not able to reassign the failing area of the device.
    pub const FT_WRITE_RECOVERY: Win32Error = Win32Error(705);
    /// {Machine Type Mismatch} The image file %hs is valid, but is for a machine type other than the current machine.
    /// Select OK to continue, or CANCEL to fail the DLL load.
    pub const IMAGE_MACHINE_TYPE_MISMATCH: Win32Error = Win32Error(706);
    /// {Partial Data Received} The network transport returned partial data to its client. The remaining data will be sent later.
    pub const RECEIVE_PARTIAL: Win32Error = Win32Error(707);
    /// {Expedited Data Received} The network transport returned data to its client that was marked as expedited by the remote system.
    pub const RECEIVE_EXPEDITED: Win32Error = Win32Error(708);
    /// {Partial Expedited Data Received} The network transport returned partial data to its client and this data was marked as expedited by the remote system. The remaining data will be sent later.
    pub const RECEIVE_PARTIAL_EXPEDITED: Win32Error = Win32Error(709);
    /// {TDI Event Done} The TDI indication has completed successfully.
    pub const EVENT_DONE: Win32Error = Win32Error(710);
    /// {TDI Event Pending} The TDI indication has entered the pending state.
    pub const EVENT_PENDING: Win32Error = Win32Error(711);
    /// Checking file system on %wZ.
    pub const CHECKING_FILE_SYSTEM: Win32Error = Win32Error(712);
    /// {Fatal Application Exit} %hs.
    pub const FATAL_APP_EXIT: Win32Error = Win32Error(713);
    /// The specified registry key is referenced by a predefined handle.
    pub const PREDEFINED_HANDLE: Win32Error = Win32Error(714);
    /// {Page Unlocked} The page protection of a locked page was changed to 'No Access' and the page was unlocked from memory and from the process.
    pub const WAS_UNLOCKED: Win32Error = Win32Error(715);
    /// %hs
    pub const SERVICE_NOTIFICATION: Win32Error = Win32Error(716);
    /// {Page Locked} One of the pages to lock was already locked.
    pub const WAS_LOCKED: Win32Error = Win32Error(717);
    /// Application popup: %1 : %2
    pub const LOG_HARD_ERROR: Win32Error = Win32Error(718);
    /// ERROR_ALREADY_WIN32
    pub const ALREADY_WIN32: Win32Error = Win32Error(719);
    /// {Machine Type Mismatch} The image file %hs is valid, but is for a machine type other than the current machine.
    pub const IMAGE_MACHINE_TYPE_MISMATCH_EXE: Win32Error = Win32Error(720);
    /// A yield execution was performed and no thread was available to run.
    pub const NO_YIELD_PERFORMED: Win32Error = Win32Error(721);
    /// The resumable flag to a timer API was ignored.
    pub const TIMER_RESUME_IGNORED: Win32Error = Win32Error(722);
    /// The arbiter has deferred arbitration of these resources to its parent.
    pub const ARBITRATION_UNHANDLED: Win32Error = Win32Error(723);
    /// The inserted CardBus device cannot be started because of a configuration error on "%hs".
    pub const CARDBUS_NOT_SUPPORTED: Win32Error = Win32Error(724);
    /// The CPUs in this multiprocessor system are not all the same revision level.
    /// To use all processors the operating system restricts itself to the features of the least capable processor in the system.
    /// Should problems occur with this system, contact the CPU manufacturer to see if this mix of processors is supported.
    pub const MP_PROCESSOR_MISMATCH: Win32Error = Win32Error(725);
    /// The system was put into hibernation.
    pub const HIBERNATED: Win32Error = Win32Error(726);
    /// The system was resumed from hibernation.
    pub const RESUME_HIBERNATION: Win32Error = Win32Error(727);
    /// Windows has detected that the system firmware (BIOS) was updated [previous firmware date = %2, current firmware date %3].
    pub const FIRMWARE_UPDATED: Win32Error = Win32Error(728);
    /// A device driver is leaking locked I/O pages causing system degradation.
    /// The system has automatically enabled tracking code in order to try and catch the culprit.
    pub const DRIVERS_LEAKING_LOCKED_PAGES: Win32Error = Win32Error(729);
    /// The system has awoken.
    pub const WAKE_SYSTEM: Win32Error = Win32Error(730);
    /// ERROR_WAIT_1
    pub const WAIT_1: Win32Error = Win32Error(731);
    /// ERROR_WAIT_2
    pub const WAIT_2: Win32Error = Win32Error(732);
    /// ERROR_WAIT_3
    pub const WAIT_3: Win32Error = Win32Error(733);
    /// ERROR_WAIT_63
    pub const WAIT_63: Win32Error = Win32Error(734);
    /// ERROR_ABANDONED_WAIT_0
    pub const ABANDONED_WAIT_0: Win32Error = Win32Error(735);
    /// ERROR_ABANDONED_WAIT_63
    pub const ABANDONED_WAIT_63: Win32Error = Win32Error(736);
    /// ERROR_USER_APC
    pub const USER_APC: Win32Error = Win32Error(737);
    /// ERROR_KERNEL_APC
    pub const KERNEL_APC: Win32Error = Win32Error(738);
    /// ERROR_ALERTED
    pub const ALERTED: Win32Error = Win32Error(739);
    /// The requested operation requires elevation.
    pub const ELEVATION_REQUIRED: Win32Error = Win32Error(740);
    /// A reparse should be performed by the Object Manager since the name of the file resulted in a symbolic link.
    pub const REPARSE: Win32Error = Win32Error(741);
    /// An open/create operation completed while an oplock break is underway.
    pub const OPLOCK_BREAK_IN_PROGRESS: Win32Error = Win32Error(742);
    /// A new volume has been mounted by a file system.
    pub const VOLUME_MOUNTED: Win32Error = Win32Error(743);
    /// This success level status indicates that the transaction state already exists for the registry sub-tree, but that a transaction commit was previously aborted. The commit has now been completed.
    pub const RXACT_COMMITTED: Win32Error = Win32Error(744);
    /// This indicates that a notify change request has been completed due to closing the handle which made the notify change request.
    pub const NOTIFY_CLEANUP: Win32Error = Win32Error(745);
    /// {Connect Failure on Primary Transport} An attempt was made to connect to the remote server %hs on the primary transport, but the connection failed.
    /// The computer WAS able to connect on a secondary transport.
    pub const PRIMARY_TRANSPORT_CONNECT_FAILED: Win32Error = Win32Error(746);
    /// Page fault was a transition fault.
    pub const PAGE_FAULT_TRANSITION: Win32Error = Win32Error(747);
    /// Page fault was a demand zero fault.
    pub const PAGE_FAULT_DEMAND_ZERO: Win32Error = Win32Error(748);
    /// Page fault was a demand zero fault.
    pub const PAGE_FAULT_COPY_ON_WRITE: Win32Error = Win32Error(749);
    /// Page fault was a demand zero fault.
    pub const PAGE_FAULT_GUARD_PAGE: Win32Error = Win32Error(750);
    /// Page fault was satisfied by reading from a secondary storage device.
    pub const PAGE_FAULT_PAGING_FILE: Win32Error = Win32Error(751);
    /// Cached page was locked during operation.
    pub const CACHE_PAGE_LOCKED: Win32Error = Win32Error(752);
    /// Crash dump exists in paging file.
    pub const CRASH_DUMP: Win32Error = Win32Error(753);
    /// Specified buffer contains all zeros.
    pub const BUFFER_ALL_ZEROS: Win32Error = Win32Error(754);
    /// A reparse should be performed by the Object Manager since the name of the file resulted in a symbolic link.
    pub const REPARSE_OBJECT: Win32Error = Win32Error(755);
    /// The device has succeeded a query-stop and its resource requirements have changed.
    pub const RESOURCE_REQUIREMENTS_CHANGED: Win32Error = Win32Error(756);
    /// The translator has translated these resources into the global space and no further translations should be performed.
    pub const TRANSLATION_COMPLETE: Win32Error = Win32Error(757);
    /// A process being terminated has no threads to terminate.
    pub const NOTHING_TO_TERMINATE: Win32Error = Win32Error(758);
    /// The specified process is not part of a job.
    pub const PROCESS_NOT_IN_JOB: Win32Error = Win32Error(759);
    /// The specified process is part of a job.
    pub const PROCESS_IN_JOB: Win32Error = Win32Error(760);
    /// {Volume Shadow Copy Service} The system is now ready for hibernation.
    pub const VOLSNAP_HIBERNATE_READY: Win32Error = Win32Error(761);
    /// A file system or file system filter driver has successfully completed an FsFilter operation.
    pub const FSFILTER_OP_COMPLETED_SUCCESSFULLY: Win32Error = Win32Error(762);
    /// The specified interrupt vector was already connected.
    pub const INTERRUPT_VECTOR_ALREADY_CONNECTED: Win32Error = Win32Error(763);
    /// The specified interrupt vector is still connected.
    pub const INTERRUPT_STILL_CONNECTED: Win32Error = Win32Error(764);
    /// An operation is blocked waiting for an oplock.
    pub const WAIT_FOR_OPLOCK: Win32Error = Win32Error(765);
    /// Debugger handled exception.
    pub const DBG_EXCEPTION_HANDLED: Win32Error = Win32Error(766);
    /// Debugger continued.
    pub const DBG_CONTINUE: Win32Error = Win32Error(767);
    /// An exception occurred in a user mode callback and the kernel callback frame should be removed.
    pub const CALLBACK_POP_STACK: Win32Error = Win32Error(768);
    /// Compression is disabled for this volume.
    pub const COMPRESSION_DISABLED: Win32Error = Win32Error(769);
    /// The data provider cannot fetch backwards through a result set.
    pub const CANTFETCHBACKWARDS: Win32Error = Win32Error(770);
    /// The data provider cannot scroll backwards through a result set.
    pub const CANTSCROLLBACKWARDS: Win32Error = Win32Error(771);
    /// The data provider requires that previously fetched data is released before asking for more data.
    pub const ROWSNOTRELEASED: Win32Error = Win32Error(772);
    /// The data provider was not able to interpret the flags set for a column binding in an accessor.
    pub const BAD_ACCESSOR_FLAGS: Win32Error = Win32Error(773);
    /// One or more errors occurred while processing the request.
    pub const ERRORS_ENCOUNTERED: Win32Error = Win32Error(774);
    /// The implementation is not capable of performing the request.
    pub const NOT_CAPABLE: Win32Error = Win32Error(775);
    /// The client of a component requested an operation which is not valid given the state of the component instance.
    pub const REQUEST_OUT_OF_SEQUENCE: Win32Error = Win32Error(776);
    /// A version number could not be parsed.
    pub const VERSION_PARSE_ERROR: Win32Error = Win32Error(777);
    /// The iterator's start position is invalid.
    pub const BADSTARTPOSITION: Win32Error = Win32Error(778);
    /// The hardware has reported an uncorrectable memory error.
    pub const MEMORY_HARDWARE: Win32Error = Win32Error(779);
    /// The attempted operation required self healing to be enabled.
    pub const DISK_REPAIR_DISABLED: Win32Error = Win32Error(780);
    /// The Desktop heap encountered an error while allocating session memory.
    /// There is more information in the system event log.
    pub const INSUFFICIENT_RESOURCE_FOR_SPECIFIED_SHARED_SECTION_SIZE: Win32Error = Win32Error(781);
    /// The system power state is transitioning from %2 to %3.
    pub const SYSTEM_POWERSTATE_TRANSITION: Win32Error = Win32Error(782);
    /// The system power state is transitioning from %2 to %3 but could enter %4.
    pub const SYSTEM_POWERSTATE_COMPLEX_TRANSITION: Win32Error = Win32Error(783);
    /// A thread is getting dispatched with MCA EXCEPTION because of MCA.
    pub const MCA_EXCEPTION: Win32Error = Win32Error(784);
    /// Access to %1 is monitored by policy rule %2.
    pub const ACCESS_AUDIT_BY_POLICY: Win32Error = Win32Error(785);
    /// Access to %1 has been restricted by your Administrator by policy rule %2.
    pub const ACCESS_DISABLED_NO_SAFER_UI_BY_POLICY: Win32Error = Win32Error(786);
    /// A valid hibernation file has been invalidated and should be abandoned.
    pub const ABANDON_HIBERFILE: Win32Error = Win32Error(787);
    /// {Delayed Write Failed} Windows was unable to save all the data for the file %hs; the data has been lost.
    /// This error may be caused by network connectivity issues. Please try to save this file elsewhere.
    pub const LOST_WRITEBEHIND_DATA_NETWORK_DISCONNECTED: Win32Error = Win32Error(788);
    /// {Delayed Write Failed} Windows was unable to save all the data for the file %hs; the data has been lost.
    /// This error was returned by the server on which the file exists. Please try to save this file elsewhere.
    pub const LOST_WRITEBEHIND_DATA_NETWORK_SERVER_ERROR: Win32Error = Win32Error(789);
    /// {Delayed Write Failed} Windows was unable to save all the data for the file %hs; the data has been lost.
    /// This error may be caused if the device has been removed or the media is write-protected.
    pub const LOST_WRITEBEHIND_DATA_LOCAL_DISK_ERROR: Win32Error = Win32Error(790);
    /// The resources required for this device conflict with the MCFG table.
    pub const BAD_MCFG_TABLE: Win32Error = Win32Error(791);
    /// The volume repair could not be performed while it is online.
    /// Please schedule to take the volume offline so that it can be repaired.
    pub const DISK_REPAIR_REDIRECTED: Win32Error = Win32Error(792);
    /// The volume repair was not successful.
    pub const DISK_REPAIR_UNSUCCESSFUL: Win32Error = Win32Error(793);
    /// One of the volume corruption logs is full.
    /// Further corruptions that may be detected won't be logged.
    pub const CORRUPT_LOG_OVERFULL: Win32Error = Win32Error(794);
    /// One of the volume corruption logs is internally corrupted and needs to be recreated.
    /// The volume may contain undetected corruptions and must be scanned.
    pub const CORRUPT_LOG_CORRUPTED: Win32Error = Win32Error(795);
    /// One of the volume corruption logs is unavailable for being operated on.
    pub const CORRUPT_LOG_UNAVAILABLE: Win32Error = Win32Error(796);
    /// One of the volume corruption logs was deleted while still having corruption records in them.
    /// The volume contains detected corruptions and must be scanned.
    pub const CORRUPT_LOG_DELETED_FULL: Win32Error = Win32Error(797);
    /// One of the volume corruption logs was cleared by chkdsk and no longer contains real corruptions.
    pub const CORRUPT_LOG_CLEARED: Win32Error = Win32Error(798);
    /// Orphaned files exist on the volume but could not be recovered because no more new names could be created in the recovery directory. Files must be moved from the recovery directory.
    pub const ORPHAN_NAME_EXHAUSTED: Win32Error = Win32Error(799);
    /// The oplock that was associated with this handle is now associated with a different handle.
    pub const OPLOCK_SWITCHED_TO_NEW_HANDLE: Win32Error = Win32Error(800);
    /// An oplock of the requested level cannot be granted. An oplock of a lower level may be available.
    pub const CANNOT_GRANT_REQUESTED_OPLOCK: Win32Error = Win32Error(801);
    /// The operation did not complete successfully because it would cause an oplock to be broken.
    /// The caller has requested that existing oplocks not be broken.
    pub const CANNOT_BREAK_OPLOCK: Win32Error = Win32Error(802);
    /// The handle with which this oplock was associated has been closed. The oplock is now broken.
    pub const OPLOCK_HANDLE_CLOSED: Win32Error = Win32Error(803);
    /// The specified access control entry (ACE) does not contain a condition.
    pub const NO_ACE_CONDITION: Win32Error = Win32Error(804);
    /// The specified access control entry (ACE) contains an invalid condition.
    pub const INVALID_ACE_CONDITION: Win32Error = Win32Error(805);
    /// Access to the specified file handle has been revoked.
    pub const FILE_HANDLE_REVOKED: Win32Error = Win32Error(806);
    /// An image file was mapped at a different address from the one specified in the image file but fixups will still be automatically performed on the image.
    pub const IMAGE_AT_DIFFERENT_BASE: Win32Error = Win32Error(807);
    /// Access to the extended attribute was denied.
    pub const EA_ACCESS_DENIED: Win32Error = Win32Error(994);
    /// The I/O operation has been aborted because of either a thread exit or an application request.
    pub const OPERATION_ABORTED: Win32Error = Win32Error(995);
    /// Overlapped I/O event is not in a signaled state.
    pub const IO_INCOMPLETE: Win32Error = Win32Error(996);
    /// Overlapped I/O operation is in progress.
    pub const IO_PENDING: Win32Error = Win32Error(997);
    /// Invalid access to memory location.
    pub const NOACCESS: Win32Error = Win32Error(998);
    /// Error performing inpage operation.
    pub const SWAPERROR: Win32Error = Win32Error(999);
    /// Recursion too deep; the stack overflowed.
    pub const STACK_OVERFLOW: Win32Error = Win32Error(1001);
    /// The window cannot act on the sent message.
    pub const INVALID_MESSAGE: Win32Error = Win32Error(1002);
    /// Cannot complete this function.
    pub const CAN_NOT_COMPLETE: Win32Error = Win32Error(1003);
    /// Invalid flags.
    pub const INVALID_FLAGS: Win32Error = Win32Error(1004);
    /// The volume does not contain a recognized file system.
    /// Please make sure that all required file system drivers are loaded and that the volume is not corrupted.
    pub const UNRECOGNIZED_VOLUME: Win32Error = Win32Error(1005);
    /// The volume for a file has been externally altered so that the opened file is no longer valid.
    pub const FILE_INVALID: Win32Error = Win32Error(1006);
    /// The requested operation cannot be performed in full-screen mode.
    pub const FULLSCREEN_MODE: Win32Error = Win32Error(1007);
    /// An attempt was made to reference a token that does not exist.
    pub const NO_TOKEN: Win32Error = Win32Error(1008);
    /// The configuration registry database is corrupt.
    pub const BADDB: Win32Error = Win32Error(1009);
    /// The configuration registry key is invalid.
    pub const BADKEY: Win32Error = Win32Error(1010);
    /// The configuration registry key could not be opened.
    pub const CANTOPEN: Win32Error = Win32Error(1011);
    /// The configuration registry key could not be read.
    pub const CANTREAD: Win32Error = Win32Error(1012);
    /// The configuration registry key could not be written.
    pub const CANTWRITE: Win32Error = Win32Error(1013);
    /// One of the files in the registry database had to be recovered by use of a log or alternate copy. The recovery was successful.
    pub const REGISTRY_RECOVERED: Win32Error = Win32Error(1014);
    /// The registry is corrupted. The structure of one of the files containing registry data is corrupted, or the system's memory image of the file is corrupted, or the file could not be recovered because the alternate copy or log was absent or corrupted.
    pub const REGISTRY_CORRUPT: Win32Error = Win32Error(1015);
    /// An I/O operation initiated by the registry failed unrecoverably.
    /// The registry could not read in, or write out, or flush, one of the files that contain the system's image of the registry.
    pub const REGISTRY_IO_FAILED: Win32Error = Win32Error(1016);
    /// The system has attempted to load or restore a file into the registry, but the specified file is not in a registry file format.
    pub const NOT_REGISTRY_FILE: Win32Error = Win32Error(1017);
    /// Illegal operation attempted on a registry key that has been marked for deletion.
    pub const KEY_DELETED: Win32Error = Win32Error(1018);
    /// System could not allocate the required space in a registry log.
    pub const NO_LOG_SPACE: Win32Error = Win32Error(1019);
    /// Cannot create a symbolic link in a registry key that already has subkeys or values.
    pub const KEY_HAS_CHILDREN: Win32Error = Win32Error(1020);
    /// Cannot create a stable subkey under a volatile parent key.
    pub const CHILD_MUST_BE_VOLATILE: Win32Error = Win32Error(1021);
    /// A notify change request is being completed and the information is not being returned in the caller's buffer.
    /// The caller now needs to enumerate the files to find the changes.
    pub const NOTIFY_ENUM_DIR: Win32Error = Win32Error(1022);
    /// A stop control has been sent to a service that other running services are dependent on.
    pub const DEPENDENT_SERVICES_RUNNING: Win32Error = Win32Error(1051);
    /// The requested control is not valid for this service.
    pub const INVALID_SERVICE_CONTROL: Win32Error = Win32Error(1052);
    /// The service did not respond to the start or control request in a timely fashion.
    pub const SERVICE_REQUEST_TIMEOUT: Win32Error = Win32Error(1053);
    /// A thread could not be created for the service.
    pub const SERVICE_NO_THREAD: Win32Error = Win32Error(1054);
    /// The service database is locked.
    pub const SERVICE_DATABASE_LOCKED: Win32Error = Win32Error(1055);
    /// An instance of the service is already running.
    pub const SERVICE_ALREADY_RUNNING: Win32Error = Win32Error(1056);
    /// The account name is invalid or does not exist, or the password is invalid for the account name specified.
    pub const INVALID_SERVICE_ACCOUNT: Win32Error = Win32Error(1057);
    /// The service cannot be started, either because it is disabled or because it has no enabled devices associated with it.
    pub const SERVICE_DISABLED: Win32Error = Win32Error(1058);
    /// Circular service dependency was specified.
    pub const CIRCULAR_DEPENDENCY: Win32Error = Win32Error(1059);
    /// The specified service does not exist as an installed service.
    pub const SERVICE_DOES_NOT_EXIST: Win32Error = Win32Error(1060);
    /// The service cannot accept control messages at this time.
    pub const SERVICE_CANNOT_ACCEPT_CTRL: Win32Error = Win32Error(1061);
    /// The service has not been started.
    pub const SERVICE_NOT_ACTIVE: Win32Error = Win32Error(1062);
    /// The service process could not connect to the service controller.
    pub const FAILED_SERVICE_CONTROLLER_CONNECT: Win32Error = Win32Error(1063);
    /// An exception occurred in the service when handling the control request.
    pub const EXCEPTION_IN_SERVICE: Win32Error = Win32Error(1064);
    /// The database specified does not exist.
    pub const DATABASE_DOES_NOT_EXIST: Win32Error = Win32Error(1065);
    /// The service has returned a service-specific error code.
    pub const SERVICE_SPECIFIC_ERROR: Win32Error = Win32Error(1066);
    /// The process terminated unexpectedly.
    pub const PROCESS_ABORTED: Win32Error = Win32Error(1067);
    /// The dependency service or group failed to start.
    pub const SERVICE_DEPENDENCY_FAIL: Win32Error = Win32Error(1068);
    /// The service did not start due to a logon failure.
    pub const SERVICE_LOGON_FAILED: Win32Error = Win32Error(1069);
    /// After starting, the service hung in a start-pending state.
    pub const SERVICE_START_HANG: Win32Error = Win32Error(1070);
    /// The specified service database lock is invalid.
    pub const INVALID_SERVICE_LOCK: Win32Error = Win32Error(1071);
    /// The specified service has been marked for deletion.
    pub const SERVICE_MARKED_FOR_DELETE: Win32Error = Win32Error(1072);
    /// The specified service already exists.
    pub const SERVICE_EXISTS: Win32Error = Win32Error(1073);
    /// The system is currently running with the last-known-good configuration.
    pub const ALREADY_RUNNING_LKG: Win32Error = Win32Error(1074);
    /// The dependency service does not exist or has been marked for deletion.
    pub const SERVICE_DEPENDENCY_DELETED: Win32Error = Win32Error(1075);
    /// The current boot has already been accepted for use as the last-known-good control set.
    pub const BOOT_ALREADY_ACCEPTED: Win32Error = Win32Error(1076);
    /// No attempts to start the service have been made since the last boot.
    pub const SERVICE_NEVER_STARTED: Win32Error = Win32Error(1077);
    /// The name is already in use as either a service name or a service display name.
    pub const DUPLICATE_SERVICE_NAME: Win32Error = Win32Error(1078);
    /// The account specified for this service is different from the account specified for other services running in the same process.
    pub const DIFFERENT_SERVICE_ACCOUNT: Win32Error = Win32Error(1079);
    /// Failure actions can only be set for Win32 services, not for drivers.
    pub const CANNOT_DETECT_DRIVER_FAILURE: Win32Error = Win32Error(1080);
    /// This service runs in the same process as the service control manager.
    /// Therefore, the service control manager cannot take action if this service's process terminates unexpectedly.
    pub const CANNOT_DETECT_PROCESS_ABORT: Win32Error = Win32Error(1081);
    /// No recovery program has been configured for this service.
    pub const NO_RECOVERY_PROGRAM: Win32Error = Win32Error(1082);
    /// The executable program that this service is configured to run in does not implement the service.
    pub const SERVICE_NOT_IN_EXE: Win32Error = Win32Error(1083);
    /// This service cannot be started in Safe Mode.
    pub const NOT_SAFEBOOT_SERVICE: Win32Error = Win32Error(1084);
    /// The physical end of the tape has been reached.
    pub const END_OF_MEDIA: Win32Error = Win32Error(1100);
    /// A tape access reached a filemark.
    pub const FILEMARK_DETECTED: Win32Error = Win32Error(1101);
    /// The beginning of the tape or a partition was encountered.
    pub const BEGINNING_OF_MEDIA: Win32Error = Win32Error(1102);
    /// A tape access reached the end of a set of files.
    pub const SETMARK_DETECTED: Win32Error = Win32Error(1103);
    /// No more data is on the tape.
    pub const NO_DATA_DETECTED: Win32Error = Win32Error(1104);
    /// Tape could not be partitioned.
    pub const PARTITION_FAILURE: Win32Error = Win32Error(1105);
    /// When accessing a new tape of a multivolume partition, the current block size is incorrect.
    pub const INVALID_BLOCK_LENGTH: Win32Error = Win32Error(1106);
    /// Tape partition information could not be found when loading a tape.
    pub const DEVICE_NOT_PARTITIONED: Win32Error = Win32Error(1107);
    /// Unable to lock the media eject mechanism.
    pub const UNABLE_TO_LOCK_MEDIA: Win32Error = Win32Error(1108);
    /// Unable to unload the media.
    pub const UNABLE_TO_UNLOAD_MEDIA: Win32Error = Win32Error(1109);
    /// The media in the drive may have changed.
    pub const MEDIA_CHANGED: Win32Error = Win32Error(1110);
    /// The I/O bus was reset.
    pub const BUS_RESET: Win32Error = Win32Error(1111);
    /// No media in drive.
    pub const NO_MEDIA_IN_DRIVE: Win32Error = Win32Error(1112);
    /// No mapping for the Unicode character exists in the target multi-byte code page.
    pub const NO_UNICODE_TRANSLATION: Win32Error = Win32Error(1113);
    /// A dynamic link library (DLL) initialization routine failed.
    pub const DLL_INIT_FAILED: Win32Error = Win32Error(1114);
    /// A system shutdown is in progress.
    pub const SHUTDOWN_IN_PROGRESS: Win32Error = Win32Error(1115);
    /// Unable to abort the system shutdown because no shutdown was in progress.
    pub const NO_SHUTDOWN_IN_PROGRESS: Win32Error = Win32Error(1116);
    /// The request could not be performed because of an I/O device error.
    pub const IO_DEVICE: Win32Error = Win32Error(1117);
    /// No serial device was successfully initialized. The serial driver will unload.
    pub const SERIAL_NO_DEVICE: Win32Error = Win32Error(1118);
    /// Unable to open a device that was sharing an interrupt request (IRQ) with other devices.
    /// At least one other device that uses that IRQ was already opened.
    pub const IRQ_BUSY: Win32Error = Win32Error(1119);
    /// A serial I/O operation was completed by another write to the serial port. The IOCTL_SERIAL_XOFF_COUNTER reached zero.)
    pub const MORE_WRITES: Win32Error = Win32Error(1120);
    /// A serial I/O operation completed because the timeout period expired.
    /// The IOCTL_SERIAL_XOFF_COUNTER did not reach zero.)
    pub const COUNTER_TIMEOUT: Win32Error = Win32Error(1121);
    /// No ID address mark was found on the floppy disk.
    pub const FLOPPY_ID_MARK_NOT_FOUND: Win32Error = Win32Error(1122);
    /// Mismatch between the floppy disk sector ID field and the floppy disk controller track address.
    pub const FLOPPY_WRONG_CYLINDER: Win32Error = Win32Error(1123);
    /// The floppy disk controller reported an error that is not recognized by the floppy disk driver.
    pub const FLOPPY_UNKNOWN_ERROR: Win32Error = Win32Error(1124);
    /// The floppy disk controller returned inconsistent results in its registers.
    pub const FLOPPY_BAD_REGISTERS: Win32Error = Win32Error(1125);
    /// While accessing the hard disk, a recalibrate operation failed, even after retries.
    pub const DISK_RECALIBRATE_FAILED: Win32Error = Win32Error(1126);
    /// While accessing the hard disk, a disk operation failed even after retries.
    pub const DISK_OPERATION_FAILED: Win32Error = Win32Error(1127);
    /// While accessing the hard disk, a disk controller reset was needed, but even that failed.
    pub const DISK_RESET_FAILED: Win32Error = Win32Error(1128);
    /// Physical end of tape encountered.
    pub const EOM_OVERFLOW: Win32Error = Win32Error(1129);
    /// Not enough server storage is available to process this command.
    pub const NOT_ENOUGH_SERVER_MEMORY: Win32Error = Win32Error(1130);
    /// A potential deadlock condition has been detected.
    pub const POSSIBLE_DEADLOCK: Win32Error = Win32Error(1131);
    /// The base address or the file offset specified does not have the proper alignment.
    pub const MAPPED_ALIGNMENT: Win32Error = Win32Error(1132);
    /// An attempt to change the system power state was vetoed by another application or driver.
    pub const SET_POWER_STATE_VETOED: Win32Error = Win32Error(1140);
    /// The system BIOS failed an attempt to change the system power state.
    pub const SET_POWER_STATE_FAILED: Win32Error = Win32Error(1141);
    /// An attempt was made to create more links on a file than the file system supports.
    pub const TOO_MANY_LINKS: Win32Error = Win32Error(1142);
    /// The specified program requires a newer version of Windows.
    pub const OLD_WIN_VERSION: Win32Error = Win32Error(1150);
    /// The specified program is not a Windows or MS-DOS program.
    pub const APP_WRONG_OS: Win32Error = Win32Error(1151);
    /// Cannot start more than one instance of the specified program.
    pub const SINGLE_INSTANCE_APP: Win32Error = Win32Error(1152);
    /// The specified program was written for an earlier version of Windows.
    pub const RMODE_APP: Win32Error = Win32Error(1153);
    /// One of the library files needed to run this application is damaged.
    pub const INVALID_DLL: Win32Error = Win32Error(1154);
    /// No application is associated with the specified file for this operation.
    pub const NO_ASSOCIATION: Win32Error = Win32Error(1155);
    /// An error occurred in sending the command to the application.
    pub const DDE_FAIL: Win32Error = Win32Error(1156);
    /// One of the library files needed to run this application cannot be found.
    pub const DLL_NOT_FOUND: Win32Error = Win32Error(1157);
    /// The current process has used all of its system allowance of handles for Window Manager objects.
    pub const NO_MORE_USER_HANDLES: Win32Error = Win32Error(1158);
    /// The message can be used only with synchronous operations.
    pub const MESSAGE_SYNC_ONLY: Win32Error = Win32Error(1159);
    /// The indicated source element has no media.
    pub const SOURCE_ELEMENT_EMPTY: Win32Error = Win32Error(1160);
    /// The indicated destination element already contains media.
    pub const DESTINATION_ELEMENT_FULL: Win32Error = Win32Error(1161);
    /// The indicated element does not exist.
    pub const ILLEGAL_ELEMENT_ADDRESS: Win32Error = Win32Error(1162);
    /// The indicated element is part of a magazine that is not present.
    pub const MAGAZINE_NOT_PRESENT: Win32Error = Win32Error(1163);
    /// The indicated device requires reinitialization due to hardware errors.
    pub const DEVICE_REINITIALIZATION_NEEDED: Win32Error = Win32Error(1164);
    /// The device has indicated that cleaning is required before further operations are attempted.
    pub const DEVICE_REQUIRES_CLEANING: Win32Error = Win32Error(1165);
    /// The device has indicated that its door is open.
    pub const DEVICE_DOOR_OPEN: Win32Error = Win32Error(1166);
    /// The device is not connected.
    pub const DEVICE_NOT_CONNECTED: Win32Error = Win32Error(1167);
    /// Element not found.
    pub const NOT_FOUND: Win32Error = Win32Error(1168);
    /// There was no match for the specified key in the index.
    pub const NO_MATCH: Win32Error = Win32Error(1169);
    /// The property set specified does not exist on the object.
    pub const SET_NOT_FOUND: Win32Error = Win32Error(1170);
    /// The point passed to GetMouseMovePoints is not in the buffer.
    pub const POINT_NOT_FOUND: Win32Error = Win32Error(1171);
    /// The tracking (workstation) service is not running.
    pub const NO_TRACKING_SERVICE: Win32Error = Win32Error(1172);
    /// The Volume ID could not be found.
    pub const NO_VOLUME_ID: Win32Error = Win32Error(1173);
    /// Unable to remove the file to be replaced.
    pub const UNABLE_TO_REMOVE_REPLACED: Win32Error = Win32Error(1175);
    /// Unable to move the replacement file to the file to be replaced.
    /// The file to be replaced has retained its original name.
    pub const UNABLE_TO_MOVE_REPLACEMENT: Win32Error = Win32Error(1176);
    /// Unable to move the replacement file to the file to be replaced.
    /// The file to be replaced has been renamed using the backup name.
    pub const UNABLE_TO_MOVE_REPLACEMENT_2: Win32Error = Win32Error(1177);
    /// The volume change journal is being deleted.
    pub const JOURNAL_DELETE_IN_PROGRESS: Win32Error = Win32Error(1178);
    /// The volume change journal is not active.
    pub const JOURNAL_NOT_ACTIVE: Win32Error = Win32Error(1179);
    /// A file was found, but it may not be the correct file.
    pub const POTENTIAL_FILE_FOUND: Win32Error = Win32Error(1180);
    /// The journal entry has been deleted from the journal.
    pub const JOURNAL_ENTRY_DELETED: Win32Error = Win32Error(1181);
    /// A system shutdown has already been scheduled.
    pub const SHUTDOWN_IS_SCHEDULED: Win32Error = Win32Error(1190);
    /// The system shutdown cannot be initiated because there are other users logged on to the computer.
    pub const SHUTDOWN_USERS_LOGGED_ON: Win32Error = Win32Error(1191);
    /// The specified device name is invalid.
    pub const BAD_DEVICE: Win32Error = Win32Error(1200);
    /// The device is not currently connected but it is a remembered connection.
    pub const CONNECTION_UNAVAIL: Win32Error = Win32Error(1201);
    /// The local device name has a remembered connection to another network resource.
    pub const DEVICE_ALREADY_REMEMBERED: Win32Error = Win32Error(1202);
    /// The network path was either typed incorrectly, does not exist, or the network provider is not currently available.
    /// Please try retyping the path or contact your network administrator.
    pub const NO_NET_OR_BAD_PATH: Win32Error = Win32Error(1203);
    /// The specified network provider name is invalid.
    pub const BAD_PROVIDER: Win32Error = Win32Error(1204);
    /// Unable to open the network connection profile.
    pub const CANNOT_OPEN_PROFILE: Win32Error = Win32Error(1205);
    /// The network connection profile is corrupted.
    pub const BAD_PROFILE: Win32Error = Win32Error(1206);
    /// Cannot enumerate a noncontainer.
    pub const NOT_CONTAINER: Win32Error = Win32Error(1207);
    /// An extended error has occurred.
    pub const EXTENDED_ERROR: Win32Error = Win32Error(1208);
    /// The format of the specified group name is invalid.
    pub const INVALID_GROUPNAME: Win32Error = Win32Error(1209);
    /// The format of the specified computer name is invalid.
    pub const INVALID_COMPUTERNAME: Win32Error = Win32Error(1210);
    /// The format of the specified event name is invalid.
    pub const INVALID_EVENTNAME: Win32Error = Win32Error(1211);
    /// The format of the specified domain name is invalid.
    pub const INVALID_DOMAINNAME: Win32Error = Win32Error(1212);
    /// The format of the specified service name is invalid.
    pub const INVALID_SERVICENAME: Win32Error = Win32Error(1213);
    /// The format of the specified network name is invalid.
    pub const INVALID_NETNAME: Win32Error = Win32Error(1214);
    /// The format of the specified share name is invalid.
    pub const INVALID_SHARENAME: Win32Error = Win32Error(1215);
    /// The format of the specified password is invalid.
    pub const INVALID_PASSWORDNAME: Win32Error = Win32Error(1216);
    /// The format of the specified message name is invalid.
    pub const INVALID_MESSAGENAME: Win32Error = Win32Error(1217);
    /// The format of the specified message destination is invalid.
    pub const INVALID_MESSAGEDEST: Win32Error = Win32Error(1218);
    /// Multiple connections to a server or shared resource by the same user, using more than one user name, are not allowed.
    /// Disconnect all previous connections to the server or shared resource and try again.
    pub const SESSION_CREDENTIAL_CONFLICT: Win32Error = Win32Error(1219);
    /// An attempt was made to establish a session to a network server, but there are already too many sessions established to that server.
    pub const REMOTE_SESSION_LIMIT_EXCEEDED: Win32Error = Win32Error(1220);
    /// The workgroup or domain name is already in use by another computer on the network.
    pub const DUP_DOMAINNAME: Win32Error = Win32Error(1221);
    /// The network is not present or not started.
    pub const NO_NETWORK: Win32Error = Win32Error(1222);
    /// The operation was canceled by the user.
    pub const CANCELLED: Win32Error = Win32Error(1223);
    /// The requested operation cannot be performed on a file with a user-mapped section open.
    pub const USER_MAPPED_FILE: Win32Error = Win32Error(1224);
    /// The remote computer refused the network connection.
    pub const CONNECTION_REFUSED: Win32Error = Win32Error(1225);
    /// The network connection was gracefully closed.
    pub const GRACEFUL_DISCONNECT: Win32Error = Win32Error(1226);
    /// The network transport endpoint already has an address associated with it.
    pub const ADDRESS_ALREADY_ASSOCIATED: Win32Error = Win32Error(1227);
    /// An address has not yet been associated with the network endpoint.
    pub const ADDRESS_NOT_ASSOCIATED: Win32Error = Win32Error(1228);
    /// An operation was attempted on a nonexistent network connection.
    pub const CONNECTION_INVALID: Win32Error = Win32Error(1229);
    /// An invalid operation was attempted on an active network connection.
    pub const CONNECTION_ACTIVE: Win32Error = Win32Error(1230);
    /// The network location cannot be reached.
    /// For information about network troubleshooting, see Windows Help.
    pub const NETWORK_UNREACHABLE: Win32Error = Win32Error(1231);
    /// The network location cannot be reached.
    /// For information about network troubleshooting, see Windows Help.
    pub const HOST_UNREACHABLE: Win32Error = Win32Error(1232);
    /// The network location cannot be reached.
    /// For information about network troubleshooting, see Windows Help.
    pub const PROTOCOL_UNREACHABLE: Win32Error = Win32Error(1233);
    /// No service is operating at the destination network endpoint on the remote system.
    pub const PORT_UNREACHABLE: Win32Error = Win32Error(1234);
    /// The request was aborted.
    pub const REQUEST_ABORTED: Win32Error = Win32Error(1235);
    /// The network connection was aborted by the local system.
    pub const CONNECTION_ABORTED: Win32Error = Win32Error(1236);
    /// The operation could not be completed. A retry should be performed.
    pub const RETRY: Win32Error = Win32Error(1237);
    /// A connection to the server could not be made because the limit on the number of concurrent connections for this account has been reached.
    pub const CONNECTION_COUNT_LIMIT: Win32Error = Win32Error(1238);
    /// Attempting to log in during an unauthorized time of day for this account.
    pub const LOGIN_TIME_RESTRICTION: Win32Error = Win32Error(1239);
    /// The account is not authorized to log in from this station.
    pub const LOGIN_WKSTA_RESTRICTION: Win32Error = Win32Error(1240);
    /// The network address could not be used for the operation requested.
    pub const INCORRECT_ADDRESS: Win32Error = Win32Error(1241);
    /// The service is already registered.
    pub const ALREADY_REGISTERED: Win32Error = Win32Error(1242);
    /// The specified service does not exist.
    pub const SERVICE_NOT_FOUND: Win32Error = Win32Error(1243);
    /// The operation being requested was not performed because the user has not been authenticated.
    pub const NOT_AUTHENTICATED: Win32Error = Win32Error(1244);
    /// The operation being requested was not performed because the user has not logged on to the network. The specified service does not exist.
    pub const NOT_LOGGED_ON: Win32Error = Win32Error(1245);
    /// Continue with work in progress.
    pub const CONTINUE: Win32Error = Win32Error(1246);
    /// An attempt was made to perform an initialization operation when initialization has already been completed.
    pub const ALREADY_INITIALIZED: Win32Error = Win32Error(1247);
    /// No more local devices.
    pub const NO_MORE_DEVICES: Win32Error = Win32Error(1248);
    /// The specified site does not exist.
    pub const NO_SUCH_SITE: Win32Error = Win32Error(1249);
    /// A domain controller with the specified name already exists.
    pub const DOMAIN_CONTROLLER_EXISTS: Win32Error = Win32Error(1250);
    /// This operation is supported only when you are connected to the server.
    pub const ONLY_IF_CONNECTED: Win32Error = Win32Error(1251);
    /// The group policy framework should call the extension even if there are no changes.
    pub const OVERRIDE_NOCHANGES: Win32Error = Win32Error(1252);
    /// The specified user does not have a valid profile.
    pub const BAD_USER_PROFILE: Win32Error = Win32Error(1253);
    /// This operation is not supported on a computer running Windows Server 2003 for Small Business Server.
    pub const NOT_SUPPORTED_ON_SBS: Win32Error = Win32Error(1254);
    /// The server machine is shutting down.
    pub const SERVER_SHUTDOWN_IN_PROGRESS: Win32Error = Win32Error(1255);
    /// The remote system is not available.
    /// For information about network troubleshooting, see Windows Help.
    pub const HOST_DOWN: Win32Error = Win32Error(1256);
    /// The security identifier provided is not from an account domain.
    pub const NON_ACCOUNT_SID: Win32Error = Win32Error(1257);
    /// The security identifier provided does not have a domain component.
    pub const NON_DOMAIN_SID: Win32Error = Win32Error(1258);
    /// AppHelp dialog canceled thus preventing the application from starting.
    pub const APPHELP_BLOCK: Win32Error = Win32Error(1259);
    /// This program is blocked by group policy.
    /// For more information, contact your system administrator.
    pub const ACCESS_DISABLED_BY_POLICY: Win32Error = Win32Error(1260);
    /// A program attempt to use an invalid register value.
    /// Normally caused by an uninitialized register. This error is Itanium specific.
    pub const REG_NAT_CONSUMPTION: Win32Error = Win32Error(1261);
    /// The share is currently offline or does not exist.
    pub const CSCSHARE_OFFLINE: Win32Error = Win32Error(1262);
    /// The Kerberos protocol encountered an error while validating the KDC certificate during smartcard logon.
    /// There is more information in the system event log.
    pub const PKINIT_FAILURE: Win32Error = Win32Error(1263);
    /// The Kerberos protocol encountered an error while attempting to utilize the smartcard subsystem.
    pub const SMARTCARD_SUBSYSTEM_FAILURE: Win32Error = Win32Error(1264);
    /// The system cannot contact a domain controller to service the authentication request. Please try again later.
    pub const DOWNGRADE_DETECTED: Win32Error = Win32Error(1265);
    /// The machine is locked and cannot be shut down without the force option.
    pub const MACHINE_LOCKED: Win32Error = Win32Error(1271);
    /// An application-defined callback gave invalid data when called.
    pub const CALLBACK_SUPPLIED_INVALID_DATA: Win32Error = Win32Error(1273);
    /// The group policy framework should call the extension in the synchronous foreground policy refresh.
    pub const SYNC_FOREGROUND_REFRESH_REQUIRED: Win32Error = Win32Error(1274);
    /// This driver has been blocked from loading.
    pub const DRIVER_BLOCKED: Win32Error = Win32Error(1275);
    /// A dynamic link library (DLL) referenced a module that was neither a DLL nor the process's executable image.
    pub const INVALID_IMPORT_OF_NON_DLL: Win32Error = Win32Error(1276);
    /// Windows cannot open this program since it has been disabled.
    pub const ACCESS_DISABLED_WEBBLADE: Win32Error = Win32Error(1277);
    /// Windows cannot open this program because the license enforcement system has been tampered with or become corrupted.
    pub const ACCESS_DISABLED_WEBBLADE_TAMPER: Win32Error = Win32Error(1278);
    /// A transaction recover failed.
    pub const RECOVERY_FAILURE: Win32Error = Win32Error(1279);
    /// The current thread has already been converted to a fiber.
    pub const ALREADY_FIBER: Win32Error = Win32Error(1280);
    /// The current thread has already been converted from a fiber.
    pub const ALREADY_THREAD: Win32Error = Win32Error(1281);
    /// The system detected an overrun of a stack-based buffer in this application.
    /// This overrun could potentially allow a malicious user to gain control of this application.
    pub const STACK_BUFFER_OVERRUN: Win32Error = Win32Error(1282);
    /// Data present in one of the parameters is more than the function can operate on.
    pub const PARAMETER_QUOTA_EXCEEDED: Win32Error = Win32Error(1283);
    /// An attempt to do an operation on a debug object failed because the object is in the process of being deleted.
    pub const DEBUGGER_INACTIVE: Win32Error = Win32Error(1284);
    /// An attempt to delay-load a .dll or get a function address in a delay-loaded .dll failed.
    pub const DELAY_LOAD_FAILED: Win32Error = Win32Error(1285);
    /// %1 is a 16-bit application. You do not have permissions to execute 16-bit applications.
    /// Check your permissions with your system administrator.
    pub const VDM_DISALLOWED: Win32Error = Win32Error(1286);
    /// Insufficient information exists to identify the cause of failure.
    pub const UNIDENTIFIED_ERROR: Win32Error = Win32Error(1287);
    /// The parameter passed to a C runtime function is incorrect.
    pub const INVALID_CRUNTIME_PARAMETER: Win32Error = Win32Error(1288);
    /// The operation occurred beyond the valid data length of the file.
    pub const BEYOND_VDL: Win32Error = Win32Error(1289);
    /// The service start failed since one or more services in the same process have an incompatible service SID type setting.
    /// A service with restricted service SID type can only coexist in the same process with other services with a restricted SID type.
    /// If the service SID type for this service was just configured, the hosting process must be restarted in order to start this service.
    /// On Windows Server 2003 and Windows XP, an unrestricted service cannot coexist in the same process with other services.
    /// The service with the unrestricted service SID type must be moved to an owned process in order to start this service.
    pub const INCOMPATIBLE_SERVICE_SID_TYPE: Win32Error = Win32Error(1290);
    /// The process hosting the driver for this device has been terminated.
    pub const DRIVER_PROCESS_TERMINATED: Win32Error = Win32Error(1291);
    /// An operation attempted to exceed an implementation-defined limit.
    pub const IMPLEMENTATION_LIMIT: Win32Error = Win32Error(1292);
    /// Either the target process, or the target thread's containing process, is a protected process.
    pub const PROCESS_IS_PROTECTED: Win32Error = Win32Error(1293);
    /// The service notification client is lagging too far behind the current state of services in the machine.
    pub const SERVICE_NOTIFY_CLIENT_LAGGING: Win32Error = Win32Error(1294);
    /// The requested file operation failed because the storage quota was exceeded.
    /// To free up disk space, move files to a different location or delete unnecessary files.
    /// For more information, contact your system administrator.
    pub const DISK_QUOTA_EXCEEDED: Win32Error = Win32Error(1295);
    /// The requested file operation failed because the storage policy blocks that type of file.
    /// For more information, contact your system administrator.
    pub const CONTENT_BLOCKED: Win32Error = Win32Error(1296);
    /// A privilege that the service requires to function properly does not exist in the service account configuration.
    /// You may use the Services Microsoft Management Console (MMC) snap-in (services.msc) and the Local Security Settings MMC snap-in (secpol.msc) to view the service configuration and the account configuration.
    pub const INCOMPATIBLE_SERVICE_PRIVILEGE: Win32Error = Win32Error(1297);
    /// A thread involved in this operation appears to be unresponsive.
    pub const APP_HANG: Win32Error = Win32Error(1298);
    /// Indicates a particular Security ID may not be assigned as the label of an object.
    pub const INVALID_LABEL: Win32Error = Win32Error(1299);
    /// Not all privileges or groups referenced are assigned to the caller.
    pub const NOT_ALL_ASSIGNED: Win32Error = Win32Error(1300);
    /// Some mapping between account names and security IDs was not done.
    pub const SOME_NOT_MAPPED: Win32Error = Win32Error(1301);
    /// No system quota limits are specifically set for this account.
    pub const NO_QUOTAS_FOR_ACCOUNT: Win32Error = Win32Error(1302);
    /// No encryption key is available. A well-known encryption key was returned.
    pub const LOCAL_USER_SESSION_KEY: Win32Error = Win32Error(1303);
    /// The password is too complex to be converted to a LAN Manager password.
    /// The LAN Manager password returned is a NULL string.
    pub const NULL_LM_PASSWORD: Win32Error = Win32Error(1304);
    /// The revision level is unknown.
    pub const UNKNOWN_REVISION: Win32Error = Win32Error(1305);
    /// Indicates two revision levels are incompatible.
    pub const REVISION_MISMATCH: Win32Error = Win32Error(1306);
    /// This security ID may not be assigned as the owner of this object.
    pub const INVALID_OWNER: Win32Error = Win32Error(1307);
    /// This security ID may not be assigned as the primary group of an object.
    pub const INVALID_PRIMARY_GROUP: Win32Error = Win32Error(1308);
    /// An attempt has been made to operate on an impersonation token by a thread that is not currently impersonating a client.
    pub const NO_IMPERSONATION_TOKEN: Win32Error = Win32Error(1309);
    /// The group may not be disabled.
    pub const CANT_DISABLE_MANDATORY: Win32Error = Win32Error(1310);
    /// There are currently no logon servers available to service the logon request.
    pub const NO_LOGON_SERVERS: Win32Error = Win32Error(1311);
    /// A specified logon session does not exist. It may already have been terminated.
    pub const NO_SUCH_LOGON_SESSION: Win32Error = Win32Error(1312);
    /// A specified privilege does not exist.
    pub const NO_SUCH_PRIVILEGE: Win32Error = Win32Error(1313);
    /// A required privilege is not held by the client.
    pub const PRIVILEGE_NOT_HELD: Win32Error = Win32Error(1314);
    /// The name provided is not a properly formed account name.
    pub const INVALID_ACCOUNT_NAME: Win32Error = Win32Error(1315);
    /// The specified account already exists.
    pub const USER_EXISTS: Win32Error = Win32Error(1316);
    /// The specified account does not exist.
    pub const NO_SUCH_USER: Win32Error = Win32Error(1317);
    /// The specified group already exists.
    pub const GROUP_EXISTS: Win32Error = Win32Error(1318);
    /// The specified group does not exist.
    pub const NO_SUCH_GROUP: Win32Error = Win32Error(1319);
    /// Either the specified user account is already a member of the specified group, or the specified group cannot be deleted because it contains a member.
    pub const MEMBER_IN_GROUP: Win32Error = Win32Error(1320);
    /// The specified user account is not a member of the specified group account.
    pub const MEMBER_NOT_IN_GROUP: Win32Error = Win32Error(1321);
    /// This operation is disallowed as it could result in an administration account being disabled, deleted or unable to log on.
    pub const LAST_ADMIN: Win32Error = Win32Error(1322);
    /// Unable to update the password. The value provided as the current password is incorrect.
    pub const WRONG_PASSWORD: Win32Error = Win32Error(1323);
    /// Unable to update the password. The value provided for the new password contains values that are not allowed in passwords.
    pub const ILL_FORMED_PASSWORD: Win32Error = Win32Error(1324);
    /// Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain.
    pub const PASSWORD_RESTRICTION: Win32Error = Win32Error(1325);
    /// The user name or password is incorrect.
    pub const LOGON_FAILURE: Win32Error = Win32Error(1326);
    /// Account restrictions are preventing this user from signing in.
    /// For example: blank passwords aren't allowed, sign-in times are limited, or a policy restriction has been enforced.
    pub const ACCOUNT_RESTRICTION: Win32Error = Win32Error(1327);
    /// Your account has time restrictions that keep you from signing in right now.
    pub const INVALID_LOGON_HOURS: Win32Error = Win32Error(1328);
    /// This user isn't allowed to sign in to this computer.
    pub const INVALID_WORKSTATION: Win32Error = Win32Error(1329);
    /// The password for this account has expired.
    pub const PASSWORD_EXPIRED: Win32Error = Win32Error(1330);
    /// This user can't sign in because this account is currently disabled.
    pub const ACCOUNT_DISABLED: Win32Error = Win32Error(1331);
    /// No mapping between account names and security IDs was done.
    pub const NONE_MAPPED: Win32Error = Win32Error(1332);
    /// Too many local user identifiers (LUIDs) were requested at one time.
    pub const TOO_MANY_LUIDS_REQUESTED: Win32Error = Win32Error(1333);
    /// No more local user identifiers (LUIDs) are available.
    pub const LUIDS_EXHAUSTED: Win32Error = Win32Error(1334);
    /// The subauthority part of a security ID is invalid for this particular use.
    pub const INVALID_SUB_AUTHORITY: Win32Error = Win32Error(1335);
    /// The access control list (ACL) structure is invalid.
    pub const INVALID_ACL: Win32Error = Win32Error(1336);
    /// The security ID structure is invalid.
    pub const INVALID_SID: Win32Error = Win32Error(1337);
    /// The security descriptor structure is invalid.
    pub const INVALID_SECURITY_DESCR: Win32Error = Win32Error(1338);
    /// The inherited access control list (ACL) or access control entry (ACE) could not be built.
    pub const BAD_INHERITANCE_ACL: Win32Error = Win32Error(1340);
    /// The server is currently disabled.
    pub const SERVER_DISABLED: Win32Error = Win32Error(1341);
    /// The server is currently enabled.
    pub const SERVER_NOT_DISABLED: Win32Error = Win32Error(1342);
    /// The value provided was an invalid value for an identifier authority.
    pub const INVALID_ID_AUTHORITY: Win32Error = Win32Error(1343);
    /// No more memory is available for security information updates.
    pub const ALLOTTED_SPACE_EXCEEDED: Win32Error = Win32Error(1344);
    /// The specified attributes are invalid, or incompatible with the attributes for the group as a whole.
    pub const INVALID_GROUP_ATTRIBUTES: Win32Error = Win32Error(1345);
    /// Either a required impersonation level was not provided, or the provided impersonation level is invalid.
    pub const BAD_IMPERSONATION_LEVEL: Win32Error = Win32Error(1346);
    /// Cannot open an anonymous level security token.
    pub const CANT_OPEN_ANONYMOUS: Win32Error = Win32Error(1347);
    /// The validation information class requested was invalid.
    pub const BAD_VALIDATION_CLASS: Win32Error = Win32Error(1348);
    /// The type of the token is inappropriate for its attempted use.
    pub const BAD_TOKEN_TYPE: Win32Error = Win32Error(1349);
    /// Unable to perform a security operation on an object that has no associated security.
    pub const NO_SECURITY_ON_OBJECT: Win32Error = Win32Error(1350);
    /// Configuration information could not be read from the domain controller, either because the machine is unavailable, or access has been denied.
    pub const CANT_ACCESS_DOMAIN_INFO: Win32Error = Win32Error(1351);
    /// The security account manager (SAM) or local security authority (LSA) server was in the wrong state to perform the security operation.
    pub const INVALID_SERVER_STATE: Win32Error = Win32Error(1352);
    /// The domain was in the wrong state to perform the security operation.
    pub const INVALID_DOMAIN_STATE: Win32Error = Win32Error(1353);
    /// This operation is only allowed for the Primary Domain Controller of the domain.
    pub const INVALID_DOMAIN_ROLE: Win32Error = Win32Error(1354);
    /// The specified domain either does not exist or could not be contacted.
    pub const NO_SUCH_DOMAIN: Win32Error = Win32Error(1355);
    /// The specified domain already exists.
    pub const DOMAIN_EXISTS: Win32Error = Win32Error(1356);
    /// An attempt was made to exceed the limit on the number of domains per server.
    pub const DOMAIN_LIMIT_EXCEEDED: Win32Error = Win32Error(1357);
    /// Unable to complete the requested operation because of either a catastrophic media failure or a data structure corruption on the disk.
    pub const INTERNAL_DB_CORRUPTION: Win32Error = Win32Error(1358);
    /// An internal error occurred.
    pub const INTERNAL_ERROR: Win32Error = Win32Error(1359);
    /// Generic access types were contained in an access mask which should already be mapped to nongeneric types.
    pub const GENERIC_NOT_MAPPED: Win32Error = Win32Error(1360);
    /// A security descriptor is not in the right format (absolute or self-relative).
    pub const BAD_DESCRIPTOR_FORMAT: Win32Error = Win32Error(1361);
    /// The requested action is restricted for use by logon processes only.
    /// The calling process has not registered as a logon process.
    pub const NOT_LOGON_PROCESS: Win32Error = Win32Error(1362);
    /// Cannot start a new logon session with an ID that is already in use.
    pub const LOGON_SESSION_EXISTS: Win32Error = Win32Error(1363);
    /// A specified authentication package is unknown.
    pub const NO_SUCH_PACKAGE: Win32Error = Win32Error(1364);
    /// The logon session is not in a state that is consistent with the requested operation.
    pub const BAD_LOGON_SESSION_STATE: Win32Error = Win32Error(1365);
    /// The logon session ID is already in use.
    pub const LOGON_SESSION_COLLISION: Win32Error = Win32Error(1366);
    /// A logon request contained an invalid logon type value.
    pub const INVALID_LOGON_TYPE: Win32Error = Win32Error(1367);
    /// Unable to impersonate using a named pipe until data has been read from that pipe.
    pub const CANNOT_IMPERSONATE: Win32Error = Win32Error(1368);
    /// The transaction state of a registry subtree is incompatible with the requested operation.
    pub const RXACT_INVALID_STATE: Win32Error = Win32Error(1369);
    /// An internal security database corruption has been encountered.
    pub const RXACT_COMMIT_FAILURE: Win32Error = Win32Error(1370);
    /// Cannot perform this operation on built-in accounts.
    pub const SPECIAL_ACCOUNT: Win32Error = Win32Error(1371);
    /// Cannot perform this operation on this built-in special group.
    pub const SPECIAL_GROUP: Win32Error = Win32Error(1372);
    /// Cannot perform this operation on this built-in special user.
    pub const SPECIAL_USER: Win32Error = Win32Error(1373);
    /// The user cannot be removed from a group because the group is currently the user's primary group.
    pub const MEMBERS_PRIMARY_GROUP: Win32Error = Win32Error(1374);
    /// The token is already in use as a primary token.
    pub const TOKEN_ALREADY_IN_USE: Win32Error = Win32Error(1375);
    /// The specified local group does not exist.
    pub const NO_SUCH_ALIAS: Win32Error = Win32Error(1376);
    /// The specified account name is not a member of the group.
    pub const MEMBER_NOT_IN_ALIAS: Win32Error = Win32Error(1377);
    /// The specified account name is already a member of the group.
    pub const MEMBER_IN_ALIAS: Win32Error = Win32Error(1378);
    /// The specified local group already exists.
    pub const ALIAS_EXISTS: Win32Error = Win32Error(1379);
    /// Logon failure: the user has not been granted the requested logon type at this computer.
    pub const LOGON_NOT_GRANTED: Win32Error = Win32Error(1380);
    /// The maximum number of secrets that may be stored in a single system has been exceeded.
    pub const TOO_MANY_SECRETS: Win32Error = Win32Error(1381);
    /// The length of a secret exceeds the maximum length allowed.
    pub const SECRET_TOO_LONG: Win32Error = Win32Error(1382);
    /// The local security authority database contains an internal inconsistency.
    pub const INTERNAL_DB_ERROR: Win32Error = Win32Error(1383);
    /// During a logon attempt, the user's security context accumulated too many security IDs.
    pub const TOO_MANY_CONTEXT_IDS: Win32Error = Win32Error(1384);
    /// Logon failure: the user has not been granted the requested logon type at this computer.
    pub const LOGON_TYPE_NOT_GRANTED: Win32Error = Win32Error(1385);
    /// A cross-encrypted password is necessary to change a user password.
    pub const NT_CROSS_ENCRYPTION_REQUIRED: Win32Error = Win32Error(1386);
    /// A member could not be added to or removed from the local group because the member does not exist.
    pub const NO_SUCH_MEMBER: Win32Error = Win32Error(1387);
    /// A new member could not be added to a local group because the member has the wrong account type.
    pub const INVALID_MEMBER: Win32Error = Win32Error(1388);
    /// Too many security IDs have been specified.
    pub const TOO_MANY_SIDS: Win32Error = Win32Error(1389);
    /// A cross-encrypted password is necessary to change this user password.
    pub const LM_CROSS_ENCRYPTION_REQUIRED: Win32Error = Win32Error(1390);
    /// Indicates an ACL contains no inheritable components.
    pub const NO_INHERITANCE: Win32Error = Win32Error(1391);
    /// The file or directory is corrupted and unreadable.
    pub const FILE_CORRUPT: Win32Error = Win32Error(1392);
    /// The disk structure is corrupted and unreadable.
    pub const DISK_CORRUPT: Win32Error = Win32Error(1393);
    /// There is no user session key for the specified logon session.
    pub const NO_USER_SESSION_KEY: Win32Error = Win32Error(1394);
    /// The service being accessed is licensed for a particular number of connections.
    /// No more connections can be made to the service at this time because there are already as many connections as the service can accept.
    pub const LICENSE_QUOTA_EXCEEDED: Win32Error = Win32Error(1395);
    /// The target account name is incorrect.
    pub const WRONG_TARGET_NAME: Win32Error = Win32Error(1396);
    /// Mutual Authentication failed. The server's password is out of date at the domain controller.
    pub const MUTUAL_AUTH_FAILED: Win32Error = Win32Error(1397);
    /// There is a time and/or date difference between the client and server.
    pub const TIME_SKEW: Win32Error = Win32Error(1398);
    /// This operation cannot be performed on the current domain.
    pub const CURRENT_DOMAIN_NOT_ALLOWED: Win32Error = Win32Error(1399);
    /// Invalid window handle.
    pub const INVALID_WINDOW_HANDLE: Win32Error = Win32Error(1400);
    /// Invalid menu handle.
    pub const INVALID_MENU_HANDLE: Win32Error = Win32Error(1401);
    /// Invalid cursor handle.
    pub const INVALID_CURSOR_HANDLE: Win32Error = Win32Error(1402);
    /// Invalid accelerator table handle.
    pub const INVALID_ACCEL_HANDLE: Win32Error = Win32Error(1403);
    /// Invalid hook handle.
    pub const INVALID_HOOK_HANDLE: Win32Error = Win32Error(1404);
    /// Invalid handle to a multiple-window position structure.
    pub const INVALID_DWP_HANDLE: Win32Error = Win32Error(1405);
    /// Cannot create a top-level child window.
    pub const TLW_WITH_WSCHILD: Win32Error = Win32Error(1406);
    /// Cannot find window class.
    pub const CANNOT_FIND_WND_CLASS: Win32Error = Win32Error(1407);
    /// Invalid window; it belongs to other thread.
    pub const WINDOW_OF_OTHER_THREAD: Win32Error = Win32Error(1408);
    /// Hot key is already registered.
    pub const HOTKEY_ALREADY_REGISTERED: Win32Error = Win32Error(1409);
    /// Class already exists.
    pub const CLASS_ALREADY_EXISTS: Win32Error = Win32Error(1410);
    /// Class does not exist.
    pub const CLASS_DOES_NOT_EXIST: Win32Error = Win32Error(1411);
    /// Class still has openwin32.
    pub const CLASS_HAS_WINDOWS: Win32Error = Win32Error(1412);
    /// Invalid index.
    pub const INVALID_INDEX: Win32Error = Win32Error(1413);
    /// Invalid icon handle.
    pub const INVALID_ICON_HANDLE: Win32Error = Win32Error(1414);
    /// Using private DIALOG window words.
    pub const PRIVATE_DIALOG_INDEX: Win32Error = Win32Error(1415);
    /// The list box identifier was not found.
    pub const LISTBOX_ID_NOT_FOUND: Win32Error = Win32Error(1416);
    /// No wildcards were found.
    pub const NO_WILDCARD_CHARACTERS: Win32Error = Win32Error(1417);
    /// Thread does not have a clipboard open.
    pub const CLIPBOARD_NOT_OPEN: Win32Error = Win32Error(1418);
    /// Hot key is not registered.
    pub const HOTKEY_NOT_REGISTERED: Win32Error = Win32Error(1419);
    /// The window is not a valid dialog window.
    pub const WINDOW_NOT_DIALOG: Win32Error = Win32Error(1420);
    /// Control ID not found.
    pub const CONTROL_ID_NOT_FOUND: Win32Error = Win32Error(1421);
    /// Invalid message for a combo box because it does not have an edit control.
    pub const INVALID_COMBOBOX_MESSAGE: Win32Error = Win32Error(1422);
    /// The window is not a combo box.
    pub const WINDOW_NOT_COMBOBOX: Win32Error = Win32Error(1423);
    /// Height must be less than 256.
    pub const INVALID_EDIT_HEIGHT: Win32Error = Win32Error(1424);
    /// Invalid device context (DC) handle.
    pub const DC_NOT_FOUND: Win32Error = Win32Error(1425);
    /// Invalid hook procedure type.
    pub const INVALID_HOOK_FILTER: Win32Error = Win32Error(1426);
    /// Invalid hook procedure.
    pub const INVALID_FILTER_PROC: Win32Error = Win32Error(1427);
    /// Cannot set nonlocal hook without a module handle.
    pub const HOOK_NEEDS_HMOD: Win32Error = Win32Error(1428);
    /// This hook procedure can only be set globally.
    pub const GLOBAL_ONLY_HOOK: Win32Error = Win32Error(1429);
    /// The journal hook procedure is already installed.
    pub const JOURNAL_HOOK_SET: Win32Error = Win32Error(1430);
    /// The hook procedure is not installed.
    pub const HOOK_NOT_INSTALLED: Win32Error = Win32Error(1431);
    /// Invalid message for single-selection list box.
    pub const INVALID_LB_MESSAGE: Win32Error = Win32Error(1432);
    /// LB_SETCOUNT sent to non-lazy list box.
    pub const SETCOUNT_ON_BAD_LB: Win32Error = Win32Error(1433);
    /// This list box does not support tab stops.
    pub const LB_WITHOUT_TABSTOPS: Win32Error = Win32Error(1434);
    /// Cannot destroy object created by another thread.
    pub const DESTROY_OBJECT_OF_OTHER_THREAD: Win32Error = Win32Error(1435);

    /// The data present in the reparse point buffer is invalid.
    pub const INVALID_REPARSE_DATA: Win32Error = Win32Error(3492);

    /// Childwin32.cannot have menus.
    pub const CHILD_WINDOW_MENU: Win32Error = Win32Error(1436);
    /// The window does not have a system menu.
    pub const NO_SYSTEM_MENU: Win32Error = Win32Error(1437);
    /// Invalid message box style.
    pub const INVALID_MSGBOX_STYLE: Win32Error = Win32Error(1438);
    /// Invalid system-wide (SPI_*) parameter.
    pub const INVALID_SPI_VALUE: Win32Error = Win32Error(1439);
    /// Screen already locked.
    pub const SCREEN_ALREADY_LOCKED: Win32Error = Win32Error(1440);
    /// All handles towin32.in a multiple-window position structure must have the same parent.
    pub const HWNDS_HAVE_DIFF_PARENT: Win32Error = Win32Error(1441);
    /// The window is not a child window.
    pub const NOT_CHILD_WINDOW: Win32Error = Win32Error(1442);
    /// Invalid GW_* command.
    pub const INVALID_GW_COMMAND: Win32Error = Win32Error(1443);
    /// Invalid thread identifier.
    pub const INVALID_THREAD_ID: Win32Error = Win32Error(1444);
    /// Cannot process a message from a window that is not a multiple document interface (MDI) window.
    pub const NON_MDICHILD_WINDOW: Win32Error = Win32Error(1445);
    /// Popup menu already active.
    pub const POPUP_ALREADY_ACTIVE: Win32Error = Win32Error(1446);
    /// The window does not have scroll bars.
    pub const NO_SCROLLBARS: Win32Error = Win32Error(1447);
    /// Scroll bar range cannot be greater than MAXLONG.
    pub const INVALID_SCROLLBAR_RANGE: Win32Error = Win32Error(1448);
    /// Cannot show or remove the window in the way specified.
    pub const INVALID_SHOWWIN_COMMAND: Win32Error = Win32Error(1449);
    /// Insufficient system resources exist to complete the requested service.
    pub const NO_SYSTEM_RESOURCES: Win32Error = Win32Error(1450);
    /// Insufficient system resources exist to complete the requested service.
    pub const NONPAGED_SYSTEM_RESOURCES: Win32Error = Win32Error(1451);
    /// Insufficient system resources exist to complete the requested service.
    pub const PAGED_SYSTEM_RESOURCES: Win32Error = Win32Error(1452);
    /// Insufficient quota to complete the requested service.
    pub const WORKING_SET_QUOTA: Win32Error = Win32Error(1453);
    /// Insufficient quota to complete the requested service.
    pub const PAGEFILE_QUOTA: Win32Error = Win32Error(1454);
    /// The paging file is too small for this operation to complete.
    pub const COMMITMENT_LIMIT: Win32Error = Win32Error(1455);
    /// A menu item was not found.
    pub const MENU_ITEM_NOT_FOUND: Win32Error = Win32Error(1456);
    /// Invalid keyboard layout handle.
    pub const INVALID_KEYBOARD_HANDLE: Win32Error = Win32Error(1457);
    /// Hook type not allowed.
    pub const HOOK_TYPE_NOT_ALLOWED: Win32Error = Win32Error(1458);
    /// This operation requires an interactive window station.
    pub const REQUIRES_INTERACTIVE_WINDOWSTATION: Win32Error = Win32Error(1459);
    /// This operation returned because the timeout period expired.
    pub const TIMEOUT: Win32Error = Win32Error(1460);
    /// Invalid monitor handle.
    pub const INVALID_MONITOR_HANDLE: Win32Error = Win32Error(1461);
    /// Incorrect size argument.
    pub const INCORRECT_SIZE: Win32Error = Win32Error(1462);
    /// The symbolic link cannot be followed because its type is disabled.
    pub const SYMLINK_CLASS_DISABLED: Win32Error = Win32Error(1463);
    /// This application does not support the current operation on symbolic links.
    pub const SYMLINK_NOT_SUPPORTED: Win32Error = Win32Error(1464);
    /// Windows was unable to parse the requested XML data.
    pub const XML_PARSE_ERROR: Win32Error = Win32Error(1465);
    /// An error was encountered while processing an XML digital signature.
    pub const XMLDSIG_ERROR: Win32Error = Win32Error(1466);
    /// This application must be restarted.
    pub const RESTART_APPLICATION: Win32Error = Win32Error(1467);
    /// The caller made the connection request in the wrong routing compartment.
    pub const WRONG_COMPARTMENT: Win32Error = Win32Error(1468);
    /// There was an AuthIP failure when attempting to connect to the remote host.
    pub const AUTHIP_FAILURE: Win32Error = Win32Error(1469);
    /// Insufficient NVRAM resources exist to complete the requested service. A reboot might be required.
    pub const NO_NVRAM_RESOURCES: Win32Error = Win32Error(1470);
    /// Unable to finish the requested operation because the specified process is not a GUI process.
    pub const NOT_GUI_PROCESS: Win32Error = Win32Error(1471);
    /// The event log file is corrupted.
    pub const EVENTLOG_FILE_CORRUPT: Win32Error = Win32Error(1500);
    /// No event log file could be opened, so the event logging service did not start.
    pub const EVENTLOG_CANT_START: Win32Error = Win32Error(1501);
    /// The event log file is full.
    pub const LOG_FILE_FULL: Win32Error = Win32Error(1502);
    /// The event log file has changed between read operations.
    pub const EVENTLOG_FILE_CHANGED: Win32Error = Win32Error(1503);
    /// The specified task name is invalid.
    pub const INVALID_TASK_NAME: Win32Error = Win32Error(1550);
    /// The specified task index is invalid.
    pub const INVALID_TASK_INDEX: Win32Error = Win32Error(1551);
    /// The specified thread is already joining a task.
    pub const THREAD_ALREADY_IN_TASK: Win32Error = Win32Error(1552);
    /// The Windows Installer Service could not be accessed.
    /// This can occur if the Windows Installer is not correctly installed. Contact your support personnel for assistance.
    pub const INSTALL_SERVICE_FAILURE: Win32Error = Win32Error(1601);
    /// User cancelled installation.
    pub const INSTALL_USEREXIT: Win32Error = Win32Error(1602);
    /// Fatal error during installation.
    pub const INSTALL_FAILURE: Win32Error = Win32Error(1603);
    /// Installation suspended, incomplete.
    pub const INSTALL_SUSPEND: Win32Error = Win32Error(1604);
    /// This action is only valid for products that are currently installed.
    pub const UNKNOWN_PRODUCT: Win32Error = Win32Error(1605);
    /// Feature ID not registered.
    pub const UNKNOWN_FEATURE: Win32Error = Win32Error(1606);
    /// Component ID not registered.
    pub const UNKNOWN_COMPONENT: Win32Error = Win32Error(1607);
    /// Unknown property.
    pub const UNKNOWN_PROPERTY: Win32Error = Win32Error(1608);
    /// Handle is in an invalid state.
    pub const INVALID_HANDLE_STATE: Win32Error = Win32Error(1609);
    /// The configuration data for this product is corrupt. Contact your support personnel.
    pub const BAD_CONFIGURATION: Win32Error = Win32Error(1610);
    /// Component qualifier not present.
    pub const INDEX_ABSENT: Win32Error = Win32Error(1611);
    /// The installation source for this product is not available.
    /// Verify that the source exists and that you can access it.
    pub const INSTALL_SOURCE_ABSENT: Win32Error = Win32Error(1612);
    /// This installation package cannot be installed by the Windows Installer service.
    /// You must install a Windows service pack that contains a newer version of the Windows Installer service.
    pub const INSTALL_PACKAGE_VERSION: Win32Error = Win32Error(1613);
    /// Product is uninstalled.
    pub const PRODUCT_UNINSTALLED: Win32Error = Win32Error(1614);
    /// SQL query syntax invalid or unsupported.
    pub const BAD_QUERY_SYNTAX: Win32Error = Win32Error(1615);
    /// Record field does not exist.
    pub const INVALID_FIELD: Win32Error = Win32Error(1616);
    /// The device has been removed.
    pub const DEVICE_REMOVED: Win32Error = Win32Error(1617);
    /// Another installation is already in progress.
    /// Complete that installation before proceeding with this install.
    pub const INSTALL_ALREADY_RUNNING: Win32Error = Win32Error(1618);
    /// This installation package could not be opened.
    /// Verify that the package exists and that you can access it, or contact the application vendor to verify that this is a valid Windows Installer package.
    pub const INSTALL_PACKAGE_OPEN_FAILED: Win32Error = Win32Error(1619);
    /// This installation package could not be opened.
    /// Contact the application vendor to verify that this is a valid Windows Installer package.
    pub const INSTALL_PACKAGE_INVALID: Win32Error = Win32Error(1620);
    /// There was an error starting the Windows Installer service user interface. Contact your support personnel.
    pub const INSTALL_UI_FAILURE: Win32Error = Win32Error(1621);
    /// Error opening installation log file.
    /// Verify that the specified log file location exists and that you can write to it.
    pub const INSTALL_LOG_FAILURE: Win32Error = Win32Error(1622);
    /// The language of this installation package is not supported by your system.
    pub const INSTALL_LANGUAGE_UNSUPPORTED: Win32Error = Win32Error(1623);
    /// Error applying transforms. Verify that the specified transform paths are valid.
    pub const INSTALL_TRANSFORM_FAILURE: Win32Error = Win32Error(1624);
    /// This installation is forbidden by system policy. Contact your system administrator.
    pub const INSTALL_PACKAGE_REJECTED: Win32Error = Win32Error(1625);
    /// Function could not be executed.
    pub const FUNCTION_NOT_CALLED: Win32Error = Win32Error(1626);
    /// Function failed during execution.
    pub const FUNCTION_FAILED: Win32Error = Win32Error(1627);
    /// Invalid or unknown table specified.
    pub const INVALID_TABLE: Win32Error = Win32Error(1628);
    /// Data supplied is of wrong type.
    pub const DATATYPE_MISMATCH: Win32Error = Win32Error(1629);
    /// Data of this type is not supported.
    pub const UNSUPPORTED_TYPE: Win32Error = Win32Error(1630);
    /// The Windows Installer service failed to start. Contact your support personnel.
    pub const CREATE_FAILED: Win32Error = Win32Error(1631);
    /// The Temp folder is on a drive that is full or is inaccessible.
    /// Free up space on the drive or verify that you have write permission on the Temp folder.
    pub const INSTALL_TEMP_UNWRITABLE: Win32Error = Win32Error(1632);
    /// This installation package is not supported by this processor type. Contact your product vendor.
    pub const INSTALL_PLATFORM_UNSUPPORTED: Win32Error = Win32Error(1633);
    /// Component not used on this computer.
    pub const INSTALL_NOTUSED: Win32Error = Win32Error(1634);
    /// This update package could not be opened.
    /// Verify that the update package exists and that you can access it, or contact the application vendor to verify that this is a valid Windows Installer update package.
    pub const PATCH_PACKAGE_OPEN_FAILED: Win32Error = Win32Error(1635);
    /// This update package could not be opened.
    /// Contact the application vendor to verify that this is a valid Windows Installer update package.
    pub const PATCH_PACKAGE_INVALID: Win32Error = Win32Error(1636);
    /// This update package cannot be processed by the Windows Installer service.
    /// You must install a Windows service pack that contains a newer version of the Windows Installer service.
    pub const PATCH_PACKAGE_UNSUPPORTED: Win32Error = Win32Error(1637);
    /// Another version of this product is already installed. Installation of this version cannot continue.
    /// To configure or remove the existing version of this product, use Add/Remove Programs on the Control Panel.
    pub const PRODUCT_VERSION: Win32Error = Win32Error(1638);
    /// Invalid command line argument. Consult the Windows Installer SDK for detailed command line help.
    pub const INVALID_COMMAND_LINE: Win32Error = Win32Error(1639);
    /// Only administrators have permission to add, remove, or configure server software during a Terminal services remote session.
    /// If you want to install or configure software on the server, contact your network administrator.
    pub const INSTALL_REMOTE_DISALLOWED: Win32Error = Win32Error(1640);
    /// The requested operation completed successfully.
    /// The system will be restarted so the changes can take effect.
    pub const SUCCESS_REBOOT_INITIATED: Win32Error = Win32Error(1641);
    /// The upgrade cannot be installed by the Windows Installer service because the program to be upgraded may be missing, or the upgrade may update a different version of the program.
    /// Verify that the program to be upgraded exists on your computer and that you have the correct upgrade.
    pub const PATCH_TARGET_NOT_FOUND: Win32Error = Win32Error(1642);
    /// The update package is not permitted by software restriction policy.
    pub const PATCH_PACKAGE_REJECTED: Win32Error = Win32Error(1643);
    /// One or more customizations are not permitted by software restriction policy.
    pub const INSTALL_TRANSFORM_REJECTED: Win32Error = Win32Error(1644);
    /// The Windows Installer does not permit installation from a Remote Desktop Connection.
    pub const INSTALL_REMOTE_PROHIBITED: Win32Error = Win32Error(1645);
    /// Uninstallation of the update package is not supported.
    pub const PATCH_REMOVAL_UNSUPPORTED: Win32Error = Win32Error(1646);
    /// The update is not applied to this product.
    pub const UNKNOWN_PATCH: Win32Error = Win32Error(1647);
    /// No valid sequence could be found for the set of updates.
    pub const PATCH_NO_SEQUENCE: Win32Error = Win32Error(1648);
    /// Update removal was disallowed by policy.
    pub const PATCH_REMOVAL_DISALLOWED: Win32Error = Win32Error(1649);
    /// The XML update data is invalid.
    pub const INVALID_PATCH_XML: Win32Error = Win32Error(1650);
    /// Windows Installer does not permit updating of managed advertised products.
    /// At least one feature of the product must be installed before applying the update.
    pub const PATCH_MANAGED_ADVERTISED_PRODUCT: Win32Error = Win32Error(1651);
    /// The Windows Installer service is not accessible in Safe Mode.
    /// Please try again when your computer is not in Safe Mode or you can use System Restore to return your machine to a previous good state.
    pub const INSTALL_SERVICE_SAFEBOOT: Win32Error = Win32Error(1652);
    /// A fail fast exception occurred.
    /// Exception handlers will not be invoked and the process will be terminated immediately.
    pub const FAIL_FAST_EXCEPTION: Win32Error = Win32Error(1653);
    /// The app that you are trying to run is not supported on this version of Windows.
    pub const INSTALL_REJECTED: Win32Error = Win32Error(1654);
    /// The string binding is invalid.
    pub const RPC_S_INVALID_STRING_BINDING: Win32Error = Win32Error(1700);
    /// The binding handle is not the correct type.
    pub const RPC_S_WRONG_KIND_OF_BINDING: Win32Error = Win32Error(1701);
    /// The binding handle is invalid.
    pub const RPC_S_INVALID_BINDING: Win32Error = Win32Error(1702);
    /// The RPC protocol sequence is not supported.
    pub const RPC_S_PROTSEQ_NOT_SUPPORTED: Win32Error = Win32Error(1703);
    /// The RPC protocol sequence is invalid.
    pub const RPC_S_INVALID_RPC_PROTSEQ: Win32Error = Win32Error(1704);
    /// The string universal unique identifier (UUID) is invalid.
    pub const RPC_S_INVALID_STRING_UUID: Win32Error = Win32Error(1705);
    /// The endpoint format is invalid.
    pub const RPC_S_INVALID_ENDPOINT_FORMAT: Win32Error = Win32Error(1706);
    /// The network address is invalid.
    pub const RPC_S_INVALID_NET_ADDR: Win32Error = Win32Error(1707);
    /// No endpoint was found.
    pub const RPC_S_NO_ENDPOINT_FOUND: Win32Error = Win32Error(1708);
    /// The timeout value is invalid.
    pub const RPC_S_INVALID_TIMEOUT: Win32Error = Win32Error(1709);
    /// The object universal unique identifier (UUID) was not found.
    pub const RPC_S_OBJECT_NOT_FOUND: Win32Error = Win32Error(1710);
    /// The object universal unique identifier (UUID) has already been registered.
    pub const RPC_S_ALREADY_REGISTERED: Win32Error = Win32Error(1711);
    /// The type universal unique identifier (UUID) has already been registered.
    pub const RPC_S_TYPE_ALREADY_REGISTERED: Win32Error = Win32Error(1712);
    /// The RPC server is already listening.
    pub const RPC_S_ALREADY_LISTENING: Win32Error = Win32Error(1713);
    /// No protocol sequences have been registered.
    pub const RPC_S_NO_PROTSEQS_REGISTERED: Win32Error = Win32Error(1714);
    /// The RPC server is not listening.
    pub const RPC_S_NOT_LISTENING: Win32Error = Win32Error(1715);
    /// The manager type is unknown.
    pub const RPC_S_UNKNOWN_MGR_TYPE: Win32Error = Win32Error(1716);
    /// The interface is unknown.
    pub const RPC_S_UNKNOWN_IF: Win32Error = Win32Error(1717);
    /// There are no bindings.
    pub const RPC_S_NO_BINDINGS: Win32Error = Win32Error(1718);
    /// There are no protocol sequences.
    pub const RPC_S_NO_PROTSEQS: Win32Error = Win32Error(1719);
    /// The endpoint cannot be created.
    pub const RPC_S_CANT_CREATE_ENDPOINT: Win32Error = Win32Error(1720);
    /// Not enough resources are available to complete this operation.
    pub const RPC_S_OUT_OF_RESOURCES: Win32Error = Win32Error(1721);
    /// The RPC server is unavailable.
    pub const RPC_S_SERVER_UNAVAILABLE: Win32Error = Win32Error(1722);
    /// The RPC server is too busy to complete this operation.
    pub const RPC_S_SERVER_TOO_BUSY: Win32Error = Win32Error(1723);
    /// The network options are invalid.
    pub const RPC_S_INVALID_NETWORK_OPTIONS: Win32Error = Win32Error(1724);
    /// There are no remote procedure calls active on this thread.
    pub const RPC_S_NO_CALL_ACTIVE: Win32Error = Win32Error(1725);
    /// The remote procedure call failed.
    pub const RPC_S_CALL_FAILED: Win32Error = Win32Error(1726);
    /// The remote procedure call failed and did not execute.
    pub const RPC_S_CALL_FAILED_DNE: Win32Error = Win32Error(1727);
    /// A remote procedure call (RPC) protocol error occurred.
    pub const RPC_S_PROTOCOL_ERROR: Win32Error = Win32Error(1728);
    /// Access to the HTTP proxy is denied.
    pub const RPC_S_PROXY_ACCESS_DENIED: Win32Error = Win32Error(1729);
    /// The transfer syntax is not supported by the RPC server.
    pub const RPC_S_UNSUPPORTED_TRANS_SYN: Win32Error = Win32Error(1730);
    /// The universal unique identifier (UUID) type is not supported.
    pub const RPC_S_UNSUPPORTED_TYPE: Win32Error = Win32Error(1732);
    /// The tag is invalid.
    pub const RPC_S_INVALID_TAG: Win32Error = Win32Error(1733);
    /// The array bounds are invalid.
    pub const RPC_S_INVALID_BOUND: Win32Error = Win32Error(1734);
    /// The binding does not contain an entry name.
    pub const RPC_S_NO_ENTRY_NAME: Win32Error = Win32Error(1735);
    /// The name syntax is invalid.
    pub const RPC_S_INVALID_NAME_SYNTAX: Win32Error = Win32Error(1736);
    /// The name syntax is not supported.
    pub const RPC_S_UNSUPPORTED_NAME_SYNTAX: Win32Error = Win32Error(1737);
    /// No network address is available to use to construct a universal unique identifier (UUID).
    pub const RPC_S_UUID_NO_ADDRESS: Win32Error = Win32Error(1739);
    /// The endpoint is a duplicate.
    pub const RPC_S_DUPLICATE_ENDPOINT: Win32Error = Win32Error(1740);
    /// The authentication type is unknown.
    pub const RPC_S_UNKNOWN_AUTHN_TYPE: Win32Error = Win32Error(1741);
    /// The maximum number of calls is too small.
    pub const RPC_S_MAX_CALLS_TOO_SMALL: Win32Error = Win32Error(1742);
    /// The string is too long.
    pub const RPC_S_STRING_TOO_LONG: Win32Error = Win32Error(1743);
    /// The RPC protocol sequence was not found.
    pub const RPC_S_PROTSEQ_NOT_FOUND: Win32Error = Win32Error(1744);
    /// The procedure number is out of range.
    pub const RPC_S_PROCNUM_OUT_OF_RANGE: Win32Error = Win32Error(1745);
    /// The binding does not contain any authentication information.
    pub const RPC_S_BINDING_HAS_NO_AUTH: Win32Error = Win32Error(1746);
    /// The authentication service is unknown.
    pub const RPC_S_UNKNOWN_AUTHN_SERVICE: Win32Error = Win32Error(1747);
    /// The authentication level is unknown.
    pub const RPC_S_UNKNOWN_AUTHN_LEVEL: Win32Error = Win32Error(1748);
    /// The security context is invalid.
    pub const RPC_S_INVALID_AUTH_IDENTITY: Win32Error = Win32Error(1749);
    /// The authorization service is unknown.
    pub const RPC_S_UNKNOWN_AUTHZ_SERVICE: Win32Error = Win32Error(1750);
    /// The entry is invalid.
    pub const EPT_S_INVALID_ENTRY: Win32Error = Win32Error(1751);
    /// The server endpoint cannot perform the operation.
    pub const EPT_S_CANT_PERFORM_OP: Win32Error = Win32Error(1752);
    /// There are no more endpoints available from the endpoint mapper.
    pub const EPT_S_NOT_REGISTERED: Win32Error = Win32Error(1753);
    /// No interfaces have been exported.
    pub const RPC_S_NOTHING_TO_EXPORT: Win32Error = Win32Error(1754);
    /// The entry name is incomplete.
    pub const RPC_S_INCOMPLETE_NAME: Win32Error = Win32Error(1755);
    /// The version option is invalid.
    pub const RPC_S_INVALID_VERS_OPTION: Win32Error = Win32Error(1756);
    /// There are no more members.
    pub const RPC_S_NO_MORE_MEMBERS: Win32Error = Win32Error(1757);
    /// There is nothing to unexport.
    pub const RPC_S_NOT_ALL_OBJS_UNEXPORTED: Win32Error = Win32Error(1758);
    /// The interface was not found.
    pub const RPC_S_INTERFACE_NOT_FOUND: Win32Error = Win32Error(1759);
    /// The entry already exists.
    pub const RPC_S_ENTRY_ALREADY_EXISTS: Win32Error = Win32Error(1760);
    /// The entry is not found.
    pub const RPC_S_ENTRY_NOT_FOUND: Win32Error = Win32Error(1761);
    /// The name service is unavailable.
    pub const RPC_S_NAME_SERVICE_UNAVAILABLE: Win32Error = Win32Error(1762);
    /// The network address family is invalid.
    pub const RPC_S_INVALID_NAF_ID: Win32Error = Win32Error(1763);
    /// The requested operation is not supported.
    pub const RPC_S_CANNOT_SUPPORT: Win32Error = Win32Error(1764);
    /// No security context is available to allow impersonation.
    pub const RPC_S_NO_CONTEXT_AVAILABLE: Win32Error = Win32Error(1765);
    /// An internal error occurred in a remote procedure call (RPC).
    pub const RPC_S_INTERNAL_ERROR: Win32Error = Win32Error(1766);
    /// The RPC server attempted an integer division by zero.
    pub const RPC_S_ZERO_DIVIDE: Win32Error = Win32Error(1767);
    /// An addressing error occurred in the RPC server.
    pub const RPC_S_ADDRESS_ERROR: Win32Error = Win32Error(1768);
    /// A floating-point operation at the RPC server caused a division by zero.
    pub const RPC_S_FP_DIV_ZERO: Win32Error = Win32Error(1769);
    /// A floating-point underflow occurred at the RPC server.
    pub const RPC_S_FP_UNDERFLOW: Win32Error = Win32Error(1770);
    /// A floating-point overflow occurred at the RPC server.
    pub const RPC_S_FP_OVERFLOW: Win32Error = Win32Error(1771);
    /// The list of RPC servers available for the binding of auto handles has been exhausted.
    pub const RPC_X_NO_MORE_ENTRIES: Win32Error = Win32Error(1772);
    /// Unable to open the character translation table file.
    pub const RPC_X_SS_CHAR_TRANS_OPEN_FAIL: Win32Error = Win32Error(1773);
    /// The file containing the character translation table has fewer than 512 bytes.
    pub const RPC_X_SS_CHAR_TRANS_SHORT_FILE: Win32Error = Win32Error(1774);
    /// A null context handle was passed from the client to the host during a remote procedure call.
    pub const RPC_X_SS_IN_NULL_CONTEXT: Win32Error = Win32Error(1775);
    /// The context handle changed during a remote procedure call.
    pub const RPC_X_SS_CONTEXT_DAMAGED: Win32Error = Win32Error(1777);
    /// The binding handles passed to a remote procedure call do not match.
    pub const RPC_X_SS_HANDLES_MISMATCH: Win32Error = Win32Error(1778);
    /// The stub is unable to get the remote procedure call handle.
    pub const RPC_X_SS_CANNOT_GET_CALL_HANDLE: Win32Error = Win32Error(1779);
    /// A null reference pointer was passed to the stub.
    pub const RPC_X_NULL_REF_POINTER: Win32Error = Win32Error(1780);
    /// The enumeration value is out of range.
    pub const RPC_X_ENUM_VALUE_OUT_OF_RANGE: Win32Error = Win32Error(1781);
    /// The byte count is too small.
    pub const RPC_X_BYTE_COUNT_TOO_SMALL: Win32Error = Win32Error(1782);
    /// The stub received bad data.
    pub const RPC_X_BAD_STUB_DATA: Win32Error = Win32Error(1783);
    /// The supplied user buffer is not valid for the requested operation.
    pub const INVALID_USER_BUFFER: Win32Error = Win32Error(1784);
    /// The disk media is not recognized. It may not be formatted.
    pub const UNRECOGNIZED_MEDIA: Win32Error = Win32Error(1785);
    /// The workstation does not have a trust secret.
    pub const NO_TRUST_LSA_SECRET: Win32Error = Win32Error(1786);
    /// The security database on the server does not have a computer account for this workstation trust relationship.
    pub const NO_TRUST_SAM_ACCOUNT: Win32Error = Win32Error(1787);
    /// The trust relationship between the primary domain and the trusted domain failed.
    pub const TRUSTED_DOMAIN_FAILURE: Win32Error = Win32Error(1788);
    /// The trust relationship between this workstation and the primary domain failed.
    pub const TRUSTED_RELATIONSHIP_FAILURE: Win32Error = Win32Error(1789);
    /// The network logon failed.
    pub const TRUST_FAILURE: Win32Error = Win32Error(1790);
    /// A remote procedure call is already in progress for this thread.
    pub const RPC_S_CALL_IN_PROGRESS: Win32Error = Win32Error(1791);
    /// An attempt was made to logon, but the network logon service was not started.
    pub const NETLOGON_NOT_STARTED: Win32Error = Win32Error(1792);
    /// The user's account has expired.
    pub const ACCOUNT_EXPIRED: Win32Error = Win32Error(1793);
    /// The redirector is in use and cannot be unloaded.
    pub const REDIRECTOR_HAS_OPEN_HANDLES: Win32Error = Win32Error(1794);
    /// The specified printer driver is already installed.
    pub const PRINTER_DRIVER_ALREADY_INSTALLED: Win32Error = Win32Error(1795);
    /// The specified port is unknown.
    pub const UNKNOWN_PORT: Win32Error = Win32Error(1796);
    /// The printer driver is unknown.
    pub const UNKNOWN_PRINTER_DRIVER: Win32Error = Win32Error(1797);
    /// The print processor is unknown.
    pub const UNKNOWN_PRINTPROCESSOR: Win32Error = Win32Error(1798);
    /// The specified separator file is invalid.
    pub const INVALID_SEPARATOR_FILE: Win32Error = Win32Error(1799);
    /// The specified priority is invalid.
    pub const INVALID_PRIORITY: Win32Error = Win32Error(1800);
    /// The printer name is invalid.
    pub const INVALID_PRINTER_NAME: Win32Error = Win32Error(1801);
    /// The printer already exists.
    pub const PRINTER_ALREADY_EXISTS: Win32Error = Win32Error(1802);
    /// The printer command is invalid.
    pub const INVALID_PRINTER_COMMAND: Win32Error = Win32Error(1803);
    /// The specified datatype is invalid.
    pub const INVALID_DATATYPE: Win32Error = Win32Error(1804);
    /// The environment specified is invalid.
    pub const INVALID_ENVIRONMENT: Win32Error = Win32Error(1805);
    /// There are no more bindings.
    pub const RPC_S_NO_MORE_BINDINGS: Win32Error = Win32Error(1806);
    /// The account used is an interdomain trust account.
    /// Use your global user account or local user account to access this server.
    pub const NOLOGON_INTERDOMAIN_TRUST_ACCOUNT: Win32Error = Win32Error(1807);
    /// The account used is a computer account.
    /// Use your global user account or local user account to access this server.
    pub const NOLOGON_WORKSTATION_TRUST_ACCOUNT: Win32Error = Win32Error(1808);
    /// The account used is a server trust account.
    /// Use your global user account or local user account to access this server.
    pub const NOLOGON_SERVER_TRUST_ACCOUNT: Win32Error = Win32Error(1809);
    /// The name or security ID (SID) of the domain specified is inconsistent with the trust information for that domain.
    pub const DOMAIN_TRUST_INCONSISTENT: Win32Error = Win32Error(1810);
    /// The server is in use and cannot be unloaded.
    pub const SERVER_HAS_OPEN_HANDLES: Win32Error = Win32Error(1811);
    /// The specified image file did not contain a resource section.
    pub const RESOURCE_DATA_NOT_FOUND: Win32Error = Win32Error(1812);
    /// The specified resource type cannot be found in the image file.
    pub const RESOURCE_TYPE_NOT_FOUND: Win32Error = Win32Error(1813);
    /// The specified resource name cannot be found in the image file.
    pub const RESOURCE_NAME_NOT_FOUND: Win32Error = Win32Error(1814);
    /// The specified resource language ID cannot be found in the image file.
    pub const RESOURCE_LANG_NOT_FOUND: Win32Error = Win32Error(1815);
    /// Not enough quota is available to process this command.
    pub const NOT_ENOUGH_QUOTA: Win32Error = Win32Error(1816);
    /// No interfaces have been registered.
    pub const RPC_S_NO_INTERFACES: Win32Error = Win32Error(1817);
    /// The remote procedure call was cancelled.
    pub const RPC_S_CALL_CANCELLED: Win32Error = Win32Error(1818);
    /// The binding handle does not contain all required information.
    pub const RPC_S_BINDING_INCOMPLETE: Win32Error = Win32Error(1819);
    /// A communications failure occurred during a remote procedure call.
    pub const RPC_S_COMM_FAILURE: Win32Error = Win32Error(1820);
    /// The requested authentication level is not supported.
    pub const RPC_S_UNSUPPORTED_AUTHN_LEVEL: Win32Error = Win32Error(1821);
    /// No principal name registered.
    pub const RPC_S_NO_PRINC_NAME: Win32Error = Win32Error(1822);
    /// The error specified is not a valid Windows RPC error code.
    pub const RPC_S_NOT_RPC_ERROR: Win32Error = Win32Error(1823);
    /// A UUID that is valid only on this computer has been allocated.
    pub const RPC_S_UUID_LOCAL_ONLY: Win32Error = Win32Error(1824);
    /// A security package specific error occurred.
    pub const RPC_S_SEC_PKG_ERROR: Win32Error = Win32Error(1825);
    /// Thread is not canceled.
    pub const RPC_S_NOT_CANCELLED: Win32Error = Win32Error(1826);
    /// Invalid operation on the encoding/decoding handle.
    pub const RPC_X_INVALID_ES_ACTION: Win32Error = Win32Error(1827);
    /// Incompatible version of the serializing package.
    pub const RPC_X_WRONG_ES_VERSION: Win32Error = Win32Error(1828);
    /// Incompatible version of the RPC stub.
    pub const RPC_X_WRONG_STUB_VERSION: Win32Error = Win32Error(1829);
    /// The RPC pipe object is invalid or corrupted.
    pub const RPC_X_INVALID_PIPE_OBJECT: Win32Error = Win32Error(1830);
    /// An invalid operation was attempted on an RPC pipe object.
    pub const RPC_X_WRONG_PIPE_ORDER: Win32Error = Win32Error(1831);
    /// Unsupported RPC pipe version.
    pub const RPC_X_WRONG_PIPE_VERSION: Win32Error = Win32Error(1832);
    /// HTTP proxy server rejected the connection because the cookie authentication failed.
    pub const RPC_S_COOKIE_AUTH_FAILED: Win32Error = Win32Error(1833);
    /// The group member was not found.
    pub const RPC_S_GROUP_MEMBER_NOT_FOUND: Win32Error = Win32Error(1898);
    /// The endpoint mapper database entry could not be created.
    pub const EPT_S_CANT_CREATE: Win32Error = Win32Error(1899);
    /// The object universal unique identifier (UUID) is the nil UUID.
    pub const RPC_S_INVALID_OBJECT: Win32Error = Win32Error(1900);
    /// The specified time is invalid.
    pub const INVALID_TIME: Win32Error = Win32Error(1901);
    /// The specified form name is invalid.
    pub const INVALID_FORM_NAME: Win32Error = Win32Error(1902);
    /// The specified form size is invalid.
    pub const INVALID_FORM_SIZE: Win32Error = Win32Error(1903);
    /// The specified printer handle is already being waited on.
    pub const ALREADY_WAITING: Win32Error = Win32Error(1904);
    /// The specified printer has been deleted.
    pub const PRINTER_DELETED: Win32Error = Win32Error(1905);
    /// The state of the printer is invalid.
    pub const INVALID_PRINTER_STATE: Win32Error = Win32Error(1906);
    /// The user's password must be changed before signing in.
    pub const PASSWORD_MUST_CHANGE: Win32Error = Win32Error(1907);
    /// Could not find the domain controller for this domain.
    pub const DOMAIN_CONTROLLER_NOT_FOUND: Win32Error = Win32Error(1908);
    /// The referenced account is currently locked out and may not be logged on to.
    pub const ACCOUNT_LOCKED_OUT: Win32Error = Win32Error(1909);
    /// The object exporter specified was not found.
    pub const OR_INVALID_OXID: Win32Error = Win32Error(1910);
    /// The object specified was not found.
    pub const OR_INVALID_OID: Win32Error = Win32Error(1911);
    /// The object resolver set specified was not found.
    pub const OR_INVALID_SET: Win32Error = Win32Error(1912);
    /// Some data remains to be sent in the request buffer.
    pub const RPC_S_SEND_INCOMPLETE: Win32Error = Win32Error(1913);
    /// Invalid asynchronous remote procedure call handle.
    pub const RPC_S_INVALID_ASYNC_HANDLE: Win32Error = Win32Error(1914);
    /// Invalid asynchronous RPC call handle for this operation.
    pub const RPC_S_INVALID_ASYNC_CALL: Win32Error = Win32Error(1915);
    /// The RPC pipe object has already been closed.
    pub const RPC_X_PIPE_CLOSED: Win32Error = Win32Error(1916);
    /// The RPC call completed before all pipes were processed.
    pub const RPC_X_PIPE_DISCIPLINE_ERROR: Win32Error = Win32Error(1917);
    /// No more data is available from the RPC pipe.
    pub const RPC_X_PIPE_EMPTY: Win32Error = Win32Error(1918);
    /// No site name is available for this machine.
    pub const NO_SITENAME: Win32Error = Win32Error(1919);
    /// The file cannot be accessed by the system.
    pub const CANT_ACCESS_FILE: Win32Error = Win32Error(1920);
    /// The name of the file cannot be resolved by the system.
    pub const CANT_RESOLVE_FILENAME: Win32Error = Win32Error(1921);
    /// The entry is not of the expected type.
    pub const RPC_S_ENTRY_TYPE_MISMATCH: Win32Error = Win32Error(1922);
    /// Not all object UUIDs could be exported to the specified entry.
    pub const RPC_S_NOT_ALL_OBJS_EXPORTED: Win32Error = Win32Error(1923);
    /// Interface could not be exported to the specified entry.
    pub const RPC_S_INTERFACE_NOT_EXPORTED: Win32Error = Win32Error(1924);
    /// The specified profile entry could not be added.
    pub const RPC_S_PROFILE_NOT_ADDED: Win32Error = Win32Error(1925);
    /// The specified profile element could not be added.
    pub const RPC_S_PRF_ELT_NOT_ADDED: Win32Error = Win32Error(1926);
    /// The specified profile element could not be removed.
    pub const RPC_S_PRF_ELT_NOT_REMOVED: Win32Error = Win32Error(1927);
    /// The group element could not be added.
    pub const RPC_S_GRP_ELT_NOT_ADDED: Win32Error = Win32Error(1928);
    /// The group element could not be removed.
    pub const RPC_S_GRP_ELT_NOT_REMOVED: Win32Error = Win32Error(1929);
    /// The printer driver is not compatible with a policy enabled on your computer that blocks NT 4.0 drivers.
    pub const KM_DRIVER_BLOCKED: Win32Error = Win32Error(1930);
    /// The context has expired and can no longer be used.
    pub const CONTEXT_EXPIRED: Win32Error = Win32Error(1931);
    /// The current user's delegated trust creation quota has been exceeded.
    pub const PER_USER_TRUST_QUOTA_EXCEEDED: Win32Error = Win32Error(1932);
    /// The total delegated trust creation quota has been exceeded.
    pub const ALL_USER_TRUST_QUOTA_EXCEEDED: Win32Error = Win32Error(1933);
    /// The current user's delegated trust deletion quota has been exceeded.
    pub const USER_DELETE_TRUST_QUOTA_EXCEEDED: Win32Error = Win32Error(1934);
    /// The computer you are signing into is protected by an authentication firewall.
    /// The specified account is not allowed to authenticate to the computer.
    pub const AUTHENTICATION_FIREWALL_FAILED: Win32Error = Win32Error(1935);
    /// Remote connections to the Print Spooler are blocked by a policy set on your machine.
    pub const REMOTE_PRINT_CONNECTIONS_BLOCKED: Win32Error = Win32Error(1936);
    /// Authentication failed because NTLM authentication has been disabled.
    pub const NTLM_BLOCKED: Win32Error = Win32Error(1937);
    /// Logon Failure: EAS policy requires that the user change their password before this operation can be performed.
    pub const PASSWORD_CHANGE_REQUIRED: Win32Error = Win32Error(1938);
    /// The pixel format is invalid.
    pub const INVALID_PIXEL_FORMAT: Win32Error = Win32Error(2000);
    /// The specified driver is invalid.
    pub const BAD_DRIVER: Win32Error = Win32Error(2001);
    /// The window style or class attribute is invalid for this operation.
    pub const INVALID_WINDOW_STYLE: Win32Error = Win32Error(2002);
    /// The requested metafile operation is not supported.
    pub const METAFILE_NOT_SUPPORTED: Win32Error = Win32Error(2003);
    /// The requested transformation operation is not supported.
    pub const TRANSFORM_NOT_SUPPORTED: Win32Error = Win32Error(2004);
    /// The requested clipping operation is not supported.
    pub const CLIPPING_NOT_SUPPORTED: Win32Error = Win32Error(2005);
    /// The specified color management module is invalid.
    pub const INVALID_CMM: Win32Error = Win32Error(2010);
    /// The specified color profile is invalid.
    pub const INVALID_PROFILE: Win32Error = Win32Error(2011);
    /// The specified tag was not found.
    pub const TAG_NOT_FOUND: Win32Error = Win32Error(2012);
    /// A required tag is not present.
    pub const TAG_NOT_PRESENT: Win32Error = Win32Error(2013);
    /// The specified tag is already present.
    pub const DUPLICATE_TAG: Win32Error = Win32Error(2014);
    /// The specified color profile is not associated with the specified device.
    pub const PROFILE_NOT_ASSOCIATED_WITH_DEVICE: Win32Error = Win32Error(2015);
    /// The specified color profile was not found.
    pub const PROFILE_NOT_FOUND: Win32Error = Win32Error(2016);
    /// The specified color space is invalid.
    pub const INVALID_COLORSPACE: Win32Error = Win32Error(2017);
    /// Image Color Management is not enabled.
    pub const ICM_NOT_ENABLED: Win32Error = Win32Error(2018);
    /// There was an error while deleting the color transform.
    pub const DELETING_ICM_XFORM: Win32Error = Win32Error(2019);
    /// The specified color transform is invalid.
    pub const INVALID_TRANSFORM: Win32Error = Win32Error(2020);
    /// The specified transform does not match the bitmap's color space.
    pub const COLORSPACE_MISMATCH: Win32Error = Win32Error(2021);
    /// The specified named color index is not present in the profile.
    pub const INVALID_COLORINDEX: Win32Error = Win32Error(2022);
    /// The specified profile is intended for a device of a different type than the specified device.
    pub const PROFILE_DOES_NOT_MATCH_DEVICE: Win32Error = Win32Error(2023);
    /// The network connection was made successfully, but the user had to be prompted for a password other than the one originally specified.
    pub const CONNECTED_OTHER_PASSWORD: Win32Error = Win32Error(2108);
    /// The network connection was made successfully using default credentials.
    pub const CONNECTED_OTHER_PASSWORD_DEFAULT: Win32Error = Win32Error(2109);
    /// The specified username is invalid.
    pub const BAD_USERNAME: Win32Error = Win32Error(2202);
    /// This network connection does not exist.
    pub const NOT_CONNECTED: Win32Error = Win32Error(2250);
    /// This network connection has files open or requests pending.
    pub const OPEN_FILES: Win32Error = Win32Error(2401);
    /// Active connections still exist.
    pub const ACTIVE_CONNECTIONS: Win32Error = Win32Error(2402);
    /// The device is in use by an active process and cannot be disconnected.
    pub const DEVICE_IN_USE: Win32Error = Win32Error(2404);
    /// The specified print monitor is unknown.
    pub const UNKNOWN_PRINT_MONITOR: Win32Error = Win32Error(3000);
    /// The specified printer driver is currently in use.
    pub const PRINTER_DRIVER_IN_USE: Win32Error = Win32Error(3001);
    /// The spool file was not found.
    pub const SPOOL_FILE_NOT_FOUND: Win32Error = Win32Error(3002);
    /// A StartDocPrinter call was not issued.
    pub const SPL_NO_STARTDOC: Win32Error = Win32Error(3003);
    /// An AddJob call was not issued.
    pub const SPL_NO_ADDJOB: Win32Error = Win32Error(3004);
    /// The specified print processor has already been installed.
    pub const PRINT_PROCESSOR_ALREADY_INSTALLED: Win32Error = Win32Error(3005);
    /// The specified print monitor has already been installed.
    pub const PRINT_MONITOR_ALREADY_INSTALLED: Win32Error = Win32Error(3006);
    /// The specified print monitor does not have the required functions.
    pub const INVALID_PRINT_MONITOR: Win32Error = Win32Error(3007);
    /// The specified print monitor is currently in use.
    pub const PRINT_MONITOR_IN_USE: Win32Error = Win32Error(3008);
    /// The requested operation is not allowed when there are jobs queued to the printer.
    pub const PRINTER_HAS_JOBS_QUEUED: Win32Error = Win32Error(3009);
    /// The requested operation is successful.
    /// Changes will not be effective until the system is rebooted.
    pub const SUCCESS_REBOOT_REQUIRED: Win32Error = Win32Error(3010);
    /// The requested operation is successful.
    /// Changes will not be effective until the service is restarted.
    pub const SUCCESS_RESTART_REQUIRED: Win32Error = Win32Error(3011);
    /// No printers were found.
    pub const PRINTER_NOT_FOUND: Win32Error = Win32Error(3012);
    /// The printer driver is known to be unreliable.
    pub const PRINTER_DRIVER_WARNED: Win32Error = Win32Error(3013);
    /// The printer driver is known to harm the system.
    pub const PRINTER_DRIVER_BLOCKED: Win32Error = Win32Error(3014);
    /// The specified printer driver package is currently in use.
    pub const PRINTER_DRIVER_PACKAGE_IN_USE: Win32Error = Win32Error(3015);
    /// Unable to find a core driver package that is required by the printer driver package.
    pub const CORE_DRIVER_PACKAGE_NOT_FOUND: Win32Error = Win32Error(3016);
    /// The requested operation failed.
    /// A system reboot is required to roll back changes made.
    pub const FAIL_REBOOT_REQUIRED: Win32Error = Win32Error(3017);
    /// The requested operation failed.
    /// A system reboot has been initiated to roll back changes made.
    pub const FAIL_REBOOT_INITIATED: Win32Error = Win32Error(3018);
    /// The specified printer driver was not found on the system and needs to be downloaded.
    pub const PRINTER_DRIVER_DOWNLOAD_NEEDED: Win32Error = Win32Error(3019);
    /// The requested print job has failed to print.
    /// A print system update requires the job to be resubmitted.
    pub const PRINT_JOB_RESTART_REQUIRED: Win32Error = Win32Error(3020);
    /// The printer driver does not contain a valid manifest, or contains too many manifests.
    pub const INVALID_PRINTER_DRIVER_MANIFEST: Win32Error = Win32Error(3021);
    /// The specified printer cannot be shared.
    pub const PRINTER_NOT_SHAREABLE: Win32Error = Win32Error(3022);
    /// The operation was paused.
    pub const REQUEST_PAUSED: Win32Error = Win32Error(3050);
    /// Reissue the given operation as a cached IO operation.
    pub const IO_REISSUE_AS_CACHED: Win32Error = Win32Error(3950);

    /// An application attempts to use an event object, but the specified handle is not valid.
    pub const WSA_INVALID_HANDLE: Win32Error = Win32Error(6);

    /// An application used a Windows Sockets function that directly maps to a Windows function. The Windows function is indicating a lack of required memory resources.
    pub const WSA_NOT_ENOUGH_MEMORY: Win32Error = Win32Error(8);

    /// An application used a Windows Sockets function which directly maps to a Windows function. The Windows function is indicating a problem with one or more parameters.
    pub const WSA_INVALID_PARAMETER: Win32Error = Win32Error(87);

    /// An overlapped operation was canceled due to the closure of the socket, or the execution of the SIO_FLUSH command in WSAIoctl.
    pub const WSA_OPERATION_ABORTED: Win32Error = Win32Error(995);

    /// The application has tried to determine the status of an overlapped operation which is not yet completed. Applications that use WSAGetOverlappedResult (with the fWait flag set to FALSE) in a polling mode to determine when an overlapped operation has completed, get this error code until the operation is complete.
    pub const WSA_IO_INCOMPLETE: Win32Error = Win32Error(996);

    /// The application has initiated an overlapped operation that cannot be completed immediately. A completion indication will be given later when the operation has been completed.
    pub const WSA_IO_PENDING: Win32Error = Win32Error(997);

    /// A blocking operation was interrupted by a call to WSACancelBlockingCall.
    pub const WSAEINTR: Win32Error = Win32Error(10004);

    /// The file handle supplied is not valid.
    pub const WSAEBADF: Win32Error = Win32Error(10009);

    /// An attempt was made to access a socket in a way forbidden by its access permissions. An example is using a broadcast address for sendto without broadcast permission being set using setsockopt(SO_BROADCAST).
    /// Another possible reason for the WSAEACCES error is that when the bind function is called (on Windows NT 4.0 with SP4 and later), another application, service, or kernel mode driver is bound to the same address with exclusive access. Such exclusive access is a new feature of Windows NT 4.0 with SP4 and later, and is implemented by using the SO_EXCLUSIVEADDRUSE option.
    pub const WSAEACCES: Win32Error = Win32Error(10013);

    /// The system detected an invalid pointer address in attempting to use a pointer argument of a call. This error occurs if an application passes an invalid pointer value, or if the length of the buffer is too small. For instance, if the length of an argument, which is a sockaddr structure, is smaller than the sizeof(sockaddr).
    pub const WSAEFAULT: Win32Error = Win32Error(10014);

    /// Some invalid argument was supplied (for example, specifying an invalid level to the setsockopt function). In some instances, it also refers to the current state of the socket—for instance, calling accept on a socket that is not listening.
    pub const WSAEINVAL: Win32Error = Win32Error(10022);

    /// Too many open sockets. Each implementation may have a maximum number of socket handles available, either globally, per process, or per thread.
    pub const WSAEMFILE: Win32Error = Win32Error(10024);

    /// This error is returned from operations on nonblocking sockets that cannot be completed immediately, for example recv when no data is queued to be read from the socket. It is a nonfatal error, and the operation should be retried later. It is normal for WSAEWOULDBLOCK to be reported as the result from calling connect on a nonblocking SOCK_STREAM socket, since some time must elapse for the connection to be established.
    pub const WSAEWOULDBLOCK: Win32Error = Win32Error(10035);

    /// A blocking operation is currently executing. Windows Sockets only allows a single blocking operation—per- task or thread—to be outstanding, and if any other function call is made (whether or not it references that or any other socket) the function fails with the WSAEINPROGRESS error.
    pub const WSAEINPROGRESS: Win32Error = Win32Error(10036);

    /// An operation was attempted on a nonblocking socket with an operation already in progress—that is, calling connect a second time on a nonblocking socket that is already connecting, or canceling an asynchronous request (WSAAsyncGetXbyY) that has already been canceled or completed.
    pub const WSAEALREADY: Win32Error = Win32Error(10037);

    /// An operation was attempted on something that is not a socket. Either the socket handle parameter did not reference a valid socket, or for select, a member of an fd_set was not valid.
    pub const WSAENOTSOCK: Win32Error = Win32Error(10038);

    /// A required address was omitted from an operation on a socket. For example, this error is returned if sendto is called with the remote address of ADDR_ANY.
    pub const WSAEDESTADDRREQ: Win32Error = Win32Error(10039);

    /// A message sent on a datagram socket was larger than the internal message buffer or some other network limit, or the buffer used to receive a datagram was smaller than the datagram itself.
    pub const WSAEMSGSIZE: Win32Error = Win32Error(10040);

    /// A protocol was specified in the socket function call that does not support the semantics of the socket type requested. For example, the ARPA Internet UDP protocol cannot be specified with a socket type of SOCK_STREAM.
    pub const WSAEPROTOTYPE: Win32Error = Win32Error(10041);

    /// An unknown, invalid or unsupported option or level was specified in a getsockopt or setsockopt call.
    pub const WSAENOPROTOOPT: Win32Error = Win32Error(10042);

    /// The requested protocol has not been configured into the system, or no implementation for it exists. For example, a socket call requests a SOCK_DGRAM socket, but specifies a stream protocol.
    pub const WSAEPROTONOSUPPORT: Win32Error = Win32Error(10043);

    /// The support for the specified socket type does not exist in this address family. For example, the optional type SOCK_RAW might be selected in a socket call, and the implementation does not support SOCK_RAW sockets at all.
    pub const WSAESOCKTNOSUPPORT: Win32Error = Win32Error(10044);

    /// The attempted operation is not supported for the type of object referenced. Usually this occurs when a socket descriptor to a socket that cannot support this operation is trying to accept a connection on a datagram socket.
    pub const WSAEOPNOTSUPP: Win32Error = Win32Error(10045);

    /// The protocol family has not been configured into the system or no implementation for it exists. This message has a slightly different meaning from WSAEAFNOSUPPORT. However, it is interchangeable in most cases, and all Windows Sockets functions that return one of these messages also specify WSAEAFNOSUPPORT.
    pub const WSAEPFNOSUPPORT: Win32Error = Win32Error(10046);

    /// An address incompatible with the requested protocol was used. All sockets are created with an associated address family (that is, AF_INET for Internet Protocols) and a generic protocol type (that is, SOCK_STREAM). This error is returned if an incorrect protocol is explicitly requested in the socket call, or if an address of the wrong family is used for a socket, for example, in sendto.
    pub const WSAEAFNOSUPPORT: Win32Error = Win32Error(10047);

    /// Typically, only one usage of each socket address (protocol/IP address/port) is permitted. This error occurs if an application attempts to bind a socket to an IP address/port that has already been used for an existing socket, or a socket that was not closed properly, or one that is still in the process of closing. For server applications that need to bind multiple sockets to the same port number, consider using setsockopt (SO_REUSEADDR). Client applications usually need not call bind at all—connect chooses an unused port automatically. When bind is called with a wildcard address (involving ADDR_ANY), a WSAEADDRINUSE error could be delayed until the specific address is committed. This could happen with a call to another function later, including connect, listen, WSAConnect, or WSAJoinLeaf.
    pub const WSAEADDRINUSE: Win32Error = Win32Error(10048);

    /// The requested address is not valid in its context. This normally results from an attempt to bind to an address that is not valid for the local computer. This can also result from connect, sendto, WSAConnect, WSAJoinLeaf, or WSASendTo when the remote address or port is not valid for a remote computer (for example, address or port 0).
    pub const WSAEADDRNOTAVAIL: Win32Error = Win32Error(10049);

    /// A socket operation encountered a dead network. This could indicate a serious failure of the network system (that is, the protocol stack that the Windows Sockets DLL runs over), the network interface, or the local network itself.
    pub const WSAENETDOWN: Win32Error = Win32Error(10050);

    /// A socket operation was attempted to an unreachable network. This usually means the local software knows no route to reach the remote host.
    pub const WSAENETUNREACH: Win32Error = Win32Error(10051);

    /// The connection has been broken due to keep-alive activity detecting a failure while the operation was in progress. It can also be returned by setsockopt if an attempt is made to set SO_KEEPALIVE on a connection that has already failed.
    pub const WSAENETRESET: Win32Error = Win32Error(10052);

    /// An established connection was aborted by the software in your host computer, possibly due to a data transmission time-out or protocol error.
    pub const WSAECONNABORTED: Win32Error = Win32Error(10053);

    /// An existing connection was forcibly closed by the remote host. This normally results if the peer application on the remote host is suddenly stopped, the host is rebooted, the host or remote network interface is disabled, or the remote host uses a hard close (see setsockopt for more information on the SO_LINGER option on the remote socket). This error may also result if a connection was broken due to keep-alive activity detecting a failure while one or more operations are in progress. Operations that were in progress fail with WSAENETRESET. Subsequent operations fail with WSAECONNRESET.
    pub const WSAECONNRESET: Win32Error = Win32Error(10054);

    /// An operation on a socket could not be performed because the system lacked sufficient buffer space or because a queue was full.
    pub const WSAENOBUFS: Win32Error = Win32Error(10055);

    /// A connect request was made on an already-connected socket. Some implementations also return this error if sendto is called on a connected SOCK_DGRAM socket (for SOCK_STREAM sockets, the to parameter in sendto is ignored) although other implementations treat this as a legal occurrence.
    pub const WSAEISCONN: Win32Error = Win32Error(10056);

    /// A request to send or receive data was disallowed because the socket is not connected and (when sending on a datagram socket using sendto) no address was supplied. Any other type of operation might also return this error—for example, setsockopt setting SO_KEEPALIVE if the connection has been reset.
    pub const WSAENOTCONN: Win32Error = Win32Error(10057);

    /// A request to send or receive data was disallowed because the socket had already been shut down in that direction with a previous shutdown call. By calling shutdown a partial close of a socket is requested, which is a signal that sending or receiving, or both have been discontinued.
    pub const WSAESHUTDOWN: Win32Error = Win32Error(10058);

    /// Too many references to some kernel object.
    pub const WSAETOOMANYREFS: Win32Error = Win32Error(10059);

    /// A connection attempt failed because the connected party did not properly respond after a period of time, or the established connection failed because the connected host has failed to respond.
    pub const WSAETIMEDOUT: Win32Error = Win32Error(10060);

    /// No connection could be made because the target computer actively refused it. This usually results from trying to connect to a service that is inactive on the foreign host—that is, one with no server application running.
    pub const WSAECONNREFUSED: Win32Error = Win32Error(10061);

    /// Cannot translate a name.
    pub const WSAELOOP: Win32Error = Win32Error(10062);

    /// A name component or a name was too long.
    pub const WSAENAMETOOLONG: Win32Error = Win32Error(10063);

    /// A socket operation failed because the destination host is down. A socket operation encountered a dead host. Networking activity on the local host has not been initiated. These conditions are more likely to be indicated by the error WSAETIMEDOUT.
    pub const WSAEHOSTDOWN: Win32Error = Win32Error(10064);

    /// A socket operation was attempted to an unreachable host. See WSAENETUNREACH.
    pub const WSAEHOSTUNREACH: Win32Error = Win32Error(10065);

    /// Cannot remove a directory that is not empty.
    pub const WSAENOTEMPTY: Win32Error = Win32Error(10066);

    /// A Windows Sockets implementation may have a limit on the number of applications that can use it simultaneously. WSAStartup may fail with this error if the limit has been reached.
    pub const WSAEPROCLIM: Win32Error = Win32Error(10067);

    /// Ran out of user quota.
    pub const WSAEUSERS: Win32Error = Win32Error(10068);

    /// Ran out of disk quota.
    pub const WSAEDQUOT: Win32Error = Win32Error(10069);

    /// The file handle reference is no longer available.
    pub const WSAESTALE: Win32Error = Win32Error(10070);

    /// The item is not available locally.
    pub const WSAEREMOTE: Win32Error = Win32Error(10071);

    /// This error is returned by WSAStartup if the Windows Sockets implementation cannot function at this time because the underlying system it uses to provide network services is currently unavailable. Users should check:
    pub const WSASYSNOTREADY: Win32Error = Win32Error(10091);

    /// The current Windows Sockets implementation does not support the Windows Sockets specification version requested by the application. Check that no old Windows Sockets DLL files are being accessed.
    pub const WSAVERNOTSUPPORTED: Win32Error = Win32Error(10092);

    /// Either the application has not called WSAStartup or WSAStartup failed. The application may be accessing a socket that the current active task does not own (that is, trying to share a socket between tasks), or WSACleanup has been called too many times.
    pub const WSANOTINITIALISED: Win32Error = Win32Error(10093);

    /// Returned by WSARecv and WSARecvFrom to indicate that the remote party has initiated a graceful shutdown sequence.
    pub const WSAEDISCON: Win32Error = Win32Error(10101);

    /// No more results can be returned by the WSALookupServiceNext function.
    pub const WSAENOMORE: Win32Error = Win32Error(10102);

    /// A call to the WSALookupServiceEnd function was made while this call was still processing. The call has been canceled.
    pub const WSAECANCELLED: Win32Error = Win32Error(10103);

    /// The service provider procedure call table is invalid. A service provider returned a bogus procedure table to Ws2_32.dll. This is usually caused by one or more of the function pointers being NULL.
    pub const WSAEINVALIDPROCTABLE: Win32Error = Win32Error(10104);

    /// The requested service provider is invalid. This error is returned by the WSCGetProviderInfo and WSCGetProviderInfo32 functions if the protocol entry specified could not be found. This error is also returned if the service provider returned a version number other than 2.0.
    pub const WSAEINVALIDPROVIDER: Win32Error = Win32Error(10105);

    /// The requested service provider could not be loaded or initialized. This error is returned if either a service provider's DLL could not be loaded (LoadLibrary failed) or the provider's WSPStartup or NSPStartup function failed.
    pub const WSAEPROVIDERFAILEDINIT: Win32Error = Win32Error(10106);

    /// A system call that should never fail has failed. This is a generic error code, returned under various conditions.
    /// Returned when a system call that should never fail does fail. For example, if a call to WaitForMultipleEvents fails or one of the registry functions fails trying to manipulate the protocol/namespace catalogs.
    /// Returned when a provider does not return SUCCESS and does not provide an extended error code. Can indicate a service provider implementation error.
    pub const WSASYSCALLFAILURE: Win32Error = Win32Error(10107);

    /// No such service is known. The service cannot be found in the specified name space.
    pub const WSASERVICE_NOT_FOUND: Win32Error = Win32Error(10108);

    /// The specified class was not found.
    pub const WSATYPE_NOT_FOUND: Win32Error = Win32Error(10109);

    /// No more results can be returned by the WSALookupServiceNext function.
    pub const WSA_E_NO_MORE: Win32Error = Win32Error(10110);

    /// A call to the WSALookupServiceEnd function was made while this call was still processing. The call has been canceled.
    pub const WSA_E_CANCELLED: Win32Error = Win32Error(10111);

    /// A database query failed because it was actively refused.
    pub const WSAEREFUSED: Win32Error = Win32Error(10112);

    /// No such host is known. The name is not an official host name or alias, or it cannot be found in the database(s) being queried. This error may also be returned for protocol and service queries, and means that the specified name could not be found in the relevant database.
    pub const WSAHOST_NOT_FOUND: Win32Error = Win32Error(11001);

    /// This is usually a temporary error during host name resolution and means that the local server did not receive a response from an authoritative server. A retry at some time later may be successful.
    pub const WSATRY_AGAIN: Win32Error = Win32Error(11002);

    /// This indicates that some sort of nonrecoverable error occurred during a database lookup. This may be because the database files (for example, BSD-compatible HOSTS, SERVICES, or PROTOCOLS files) could not be found, or a DNS request was returned by the server with a severe error.
    pub const WSANO_RECOVERY: Win32Error = Win32Error(11003);

    /// The requested name is valid and was found in the database, but it does not have the correct associated data being resolved for. The usual example for this is a host name-to-address translation attempt (using gethostbyname or WSAAsyncGetHostByName) which uses the DNS (Domain Name Server). An MX record is returned but no A record—indicating the host itself exists, but is not directly reachable.
    pub const WSANO_DATA: Win32Error = Win32Error(11004);

    /// At least one QoS reserve has arrived.
    pub const WSA_QOS_RECEIVERS: Win32Error = Win32Error(11005);

    /// At least one QoS send path has arrived.
    pub const WSA_QOS_SENDERS: Win32Error = Win32Error(11006);

    /// There are no QoS senders.
    pub const WSA_QOS_NO_SENDERS: Win32Error = Win32Error(11007);

    /// There are no QoS receivers.
    pub const WSA_QOS_NO_RECEIVERS: Win32Error = Win32Error(11008);

    /// The QoS reserve request has been confirmed.
    pub const WSA_QOS_REQUEST_CONFIRMED: Win32Error = Win32Error(11009);

    /// A QoS error occurred due to lack of resources.
    pub const WSA_QOS_ADMISSION_FAILURE: Win32Error = Win32Error(11010);

    /// The QoS request was rejected because the policy system couldn't allocate the requested resource within the existing policy.
    pub const WSA_QOS_POLICY_FAILURE: Win32Error = Win32Error(11011);

    /// An unknown or conflicting QoS style was encountered.
    pub const WSA_QOS_BAD_STYLE: Win32Error = Win32Error(11012);

    /// A problem was encountered with some part of the filterspec or the provider-specific buffer in general.
    pub const WSA_QOS_BAD_OBJECT: Win32Error = Win32Error(11013);

    /// An error with the underlying traffic control (TC) API as the generic QoS request was converted for local enforcement by the TC API. This could be due to an out of memory error or to an internal QoS provider error.
    pub const WSA_QOS_TRAFFIC_CTRL_ERROR: Win32Error = Win32Error(11014);

    /// A general QoS error.
    pub const WSA_QOS_GENERIC_ERROR: Win32Error = Win32Error(11015);

    /// An invalid or unrecognized service type was found in the QoS flowspec.
    pub const WSA_QOS_ESERVICETYPE: Win32Error = Win32Error(11016);

    /// An invalid or inconsistent flowspec was found in the QOS structure.
    pub const WSA_QOS_EFLOWSPEC: Win32Error = Win32Error(11017);

    /// An invalid QoS provider-specific buffer.
    pub const WSA_QOS_EPROVSPECBUF: Win32Error = Win32Error(11018);

    /// An invalid QoS filter style was used.
    pub const WSA_QOS_EFILTERSTYLE: Win32Error = Win32Error(11019);

    /// An invalid QoS filter type was used.
    pub const WSA_QOS_EFILTERTYPE: Win32Error = Win32Error(11020);

    /// An incorrect number of QoS FILTERSPECs were specified in the FLOWDESCRIPTOR.
    pub const WSA_QOS_EFILTERCOUNT: Win32Error = Win32Error(11021);

    /// An object with an invalid ObjectLength field was specified in the QoS provider-specific buffer.
    pub const WSA_QOS_EOBJLENGTH: Win32Error = Win32Error(11022);

    /// An incorrect number of flow descriptors was specified in the QoS structure.
    pub const WSA_QOS_EFLOWCOUNT: Win32Error = Win32Error(11023);

    /// An unrecognized object was found in the QoS provider-specific buffer.
    pub const WSA_QOS_EUNKOWNPSOBJ: Win32Error = Win32Error(11024);

    /// An invalid policy object was found in the QoS provider-specific buffer.
    pub const WSA_QOS_EPOLICYOBJ: Win32Error = Win32Error(11025);

    /// An invalid QoS flow descriptor was found in the flow descriptor list.
    pub const WSA_QOS_EFLOWDESC: Win32Error = Win32Error(11026);

    /// An invalid or inconsistent flowspec was found in the QoS provider-specific buffer.
    pub const WSA_QOS_EPSFLOWSPEC: Win32Error = Win32Error(11027);

    /// An invalid FILTERSPEC was found in the QoS provider-specific buffer.
    pub const WSA_QOS_EPSFILTERSPEC: Win32Error = Win32Error(11028);

    /// An invalid shape discard mode object was found in the QoS provider-specific buffer.
    pub const WSA_QOS_ESDMODEOBJ: Win32Error = Win32Error(11029);

    /// An invalid shaping rate object was found in the QoS provider-specific buffer.
    pub const WSA_QOS_ESHAPERATEOBJ: Win32Error = Win32Error(11030);

    /// A reserved policy element was found in the QoS provider-specific buffer.
    pub const WSA_QOS_RESERVED_PETYPE: Win32Error = Win32Error(11031);
    pub fn get() -> Win32Error {
        // SAFETY: GetLastError has no preconditions
        Win32Error(u16::try_from(unsafe { kernel32::GetLastError() }).unwrap())
    }

    pub fn int(self) -> u16 {
        self.0
    }

    pub fn unwrap(self) -> Result<(), bun_core::Error> {
        if self == Self::SUCCESS {
            return Ok(());
        }
        if let Some(err) = self.to_system_errno() {
            return Err(err.to_error());
        }
        Ok(())
    }

    pub fn to_system_errno(self) -> Option<SystemErrno> {
        SystemErrno::init(self)
    }

    pub fn from_nt_status(status: NTSTATUS) -> Win32Error {
        // SAFETY: RtlNtStatusToDosError is total over NTSTATUS
        unsafe { RtlNtStatusToDosError(status) }
    }
}

pub use bun_libuv_sys as libuv;

pub use bun_windows_sys::externs::GetProcAddress;

pub fn GetProcAddressA(ptr: Option<*mut c_void>, utf8: &bun_str::ZStr) -> Option<*mut c_void> {
    let mut wbuf: [u16; 2048] = [0; 2048];
    // SAFETY: wbuf is large enough; toWPath NUL-terminates
    let wpath = bun_str::strings::to_w_path(&mut wbuf, utf8.as_bytes());
    unsafe { GetProcAddress(ptr, wpath.as_ptr()) }
}

pub use bun_windows_sys::externs::LoadLibraryA;

// TODO(port): move to windows_sys
unsafe extern "system" {
    #[link_name = "CreateHardLinkW"]
    fn CreateHardLinkW_raw(
        newFileName: LPCWSTR,
        existingFileName: LPCWSTR,
        securityAttributes: *mut win32::SECURITY_ATTRIBUTES,
    ) -> BOOL;
}

pub fn CreateHardLinkW(
    new_file_name: LPCWSTR,
    existing_file_name: LPCWSTR,
    security_attributes: Option<&mut win32::SECURITY_ATTRIBUTES>,
) -> BOOL {
    // SAFETY: paths are NUL-terminated wide strings owned by caller
    let rc = unsafe {
        CreateHardLinkW_raw(
            new_file_name,
            existing_file_name,
            security_attributes.map_or(ptr::null_mut(), |p| p as *mut _),
        )
    };
    #[cfg(debug_assertions)]
    {
        // SAFETY: caller guarantees both LPCWSTR args are NUL-terminated wide strings
        let new_w = unsafe { bun_str::WStr::from_ptr_nul(new_file_name) };
        // SAFETY: caller guarantees both LPCWSTR args are NUL-terminated wide strings
        let existing_w = unsafe { bun_str::WStr::from_ptr_nul(existing_file_name) };
        bun_sys::syslog!(
            "CreateHardLinkW({}, {}) = {}",
            bun_core::fmt::fmt_os_path(new_w, Default::default()),
            bun_core::fmt::fmt_os_path(existing_w, Default::default()),
            if rc == 0 { Win32Error::get().0 } else { 0 },
        );
    }
    rc
}

pub use bun_windows_sys::externs::CopyFileW;

pub use bun_windows_sys::externs::SetFileInformationByHandle;

pub fn get_last_errno() -> E {
    // SAFETY: GetLastError has no preconditions
    SystemErrno::init(unsafe { kernel32::GetLastError() })
        .unwrap_or(SystemErrno::EUNKNOWN)
        .to_e()
}

pub fn get_last_error() -> bun_core::Error {
    bun_core::errno_to_zig_err(get_last_errno())
}

pub fn translate_nt_status_to_errno(err: NTSTATUS) -> E {
    use bun_windows_sys::ntstatus::*;
    match err {
        SUCCESS => E::SUCCESS,
        ACCESS_DENIED => E::PERM,
        INVALID_HANDLE => E::BADF,
        INVALID_PARAMETER => E::INVAL,
        OBJECT_NAME_COLLISION => E::EXIST,
        FILE_IS_A_DIRECTORY => E::ISDIR,
        OBJECT_PATH_NOT_FOUND => E::NOENT,
        OBJECT_NAME_NOT_FOUND => E::NOENT,
        NOT_A_DIRECTORY => E::NOTDIR,
        RETRY => E::AGAIN,
        DIRECTORY_NOT_EMPTY => E::NOTEMPTY,
        FILE_TOO_LARGE => E::TOOBIG, // Zig: .@"2BIG"
        NOT_SAME_DEVICE => E::XDEV,
        DELETE_PENDING => E::BUSY,
        SHARING_VIOLATION => {
            #[cfg(debug_assertions)]
            bun_core::Output::debug_warn("Received SHARING_VIOLATION, indicates file handle should've been opened with FILE_SHARE_DELETE", &[]);
            E::BUSY
        }
        OBJECT_NAME_INVALID => {
            #[cfg(debug_assertions)]
            {
                bun_core::Output::debug_warn("Received OBJECT_NAME_INVALID, indicates a file path conversion issue.", &[]);
                bun_crash_handler::dump_current_stack_trace(None, bun_crash_handler::DumpOptions { frame_count: 10 });
            }
            E::INVAL
        }
        t => {
            #[cfg(debug_assertions)]
            {
                bun_core::Output::warn!("Called translateNTStatusToErrno with {} which does not have a mapping to errno.", <&'static str>::from(t));
                bun_crash_handler::dump_current_stack_trace(None, bun_crash_handler::DumpOptions { frame_count: 10 });
            }
            let _ = t;
            E::UNKNOWN
        }
    }
}

pub use bun_windows_sys::externs::GetHostNameW;

/// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw
pub use bun_windows_sys::externs::GetTempPathW;

pub use bun_windows_sys::externs::CreateJobObjectA;

pub use bun_windows_sys::externs::AssignProcessToJobObject;

pub use bun_windows_sys::externs::ResumeThread;

#[repr(C)]
pub struct JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
    pub CompletionKey: *mut c_void, // PVOID
    pub CompletionPort: HANDLE,
}

#[repr(C)]
pub struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    pub BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
    /// Reserved
    pub IoInfo: IO_COUNTERS,
    pub ProcessMemoryLimit: usize,
    pub JobMemoryLimit: usize,
    pub PeakProcessMemoryUsed: usize,
    pub PeakJobMemoryUsed: usize,
}

#[repr(C)]
pub struct IO_COUNTERS {
    pub ReadOperationCount: ULONGLONG,
    pub WriteOperationCount: ULONGLONG,
    pub OtherOperationCount: ULONGLONG,
    pub ReadTransferCount: ULONGLONG,
    pub WriteTransferCount: ULONGLONG,
    pub OtherTransferCount: ULONGLONG,
}

#[repr(C)]
pub struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    pub PerProcessUserTimeLimit: LARGE_INTEGER,
    pub PerJobUserTimeLimit: LARGE_INTEGER,
    pub LimitFlags: DWORD,
    pub MinimumWorkingSetSize: usize,
    pub MaximumWorkingSetSize: usize,
    pub ActiveProcessLimit: DWORD,
    pub Affinity: *mut ULONG,
    pub PriorityClass: DWORD,
    pub SchedulingClass: DWORD,
}

pub const JobObjectAssociateCompletionPortInformation: DWORD = 7;
pub const JobObjectExtendedLimitInformation: DWORD = 9;

pub use bun_windows_sys::externs::SetInformationJobObject;

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
pub const JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO: DWORD = 4;
pub const JOB_OBJECT_MSG_EXIT_PROCESS: DWORD = 7;

pub use bun_windows_sys::externs::OpenProcess;

// https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights
pub const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;

pub fn exe_path_w() -> &'static bun_str::WStr {
    // SAFETY: PEB ImagePathName is valid for the lifetime of the process
    unsafe {
        let image_path = &(*win32::peb()).ProcessParameters.ImagePathName;
        let len = (image_path.Length as usize) / 2;
        bun_str::WStr::from_raw(image_path.Buffer, len)
    }
}

#[repr(C)]
pub union KEY_EVENT_RECORD_uChar {
    pub UnicodeChar: WCHAR,
    pub AsciiChar: CHAR,
}

#[repr(C)]
pub struct KEY_EVENT_RECORD {
    pub bKeyDown: BOOL,
    pub wRepeatCount: WORD,
    pub wVirtualKeyCode: WORD,
    pub wVirtualScanCode: WORD,
    pub uChar: KEY_EVENT_RECORD_uChar,
    pub dwControlKeyState: DWORD,
}

#[repr(C)]
pub struct MOUSE_EVENT_RECORD {
    pub dwMousePosition: COORD,
    pub dwButtonState: COORD,
    pub dwControlKeyState: DWORD,
    pub dwEventFlags: DWORD,
}

#[repr(C)]
pub struct WINDOW_BUFFER_SIZE_EVENT {
    pub dwSize: COORD,
}

#[repr(C)]
pub struct MENU_EVENT_RECORD {
    pub dwCommandId: UINT,
}

#[repr(C)]
pub struct FOCUS_EVENT_RECORD {
    pub bSetFocus: BOOL,
}

#[repr(C)]
pub union INPUT_RECORD_Event {
    pub KeyEvent: KEY_EVENT_RECORD,
    pub MouseEvent: MOUSE_EVENT_RECORD,
    pub WindowBufferSizeEvent: WINDOW_BUFFER_SIZE_EVENT,
    pub MenuEvent: MENU_EVENT_RECORD,
    pub FocusEvent: FOCUS_EVENT_RECORD,
}

#[repr(C)]
pub struct INPUT_RECORD {
    pub EventType: WORD,
    pub Event: INPUT_RECORD_Event,
}

// Bun__UVSignalHandle__{init,close}: see src/runtime/node/uv_signal_handle_windows.zig

// TODO(port): @export(&windows_process_dlopen, .{ .name = "Bun__LoadLibraryBunString" }) — see #[unsafe(no_mangle)] fn below

/// Is not the actual UID of the user, but just a hash of username.
pub fn user_unique_id() -> u32 {
    // https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tsch/165836c1-89d7-4abb-840d-80cf2510aa3e
    // UNLEN + 1
    let mut buf: [u16; 257] = [0; 257];
    let mut size: u32 = buf.len() as u32;
    // SAFETY: buf and size are valid
    if unsafe { externs::GetUserNameW(buf.as_mut_ptr(), &mut size) } == 0 {
        #[cfg(debug_assertions)]
        {
            // SAFETY: GetLastError has no preconditions
            let err = unsafe { GetLastError() };
            panic!("GetUserNameW failed: {:?}", err);
        }
        #[cfg(not(debug_assertions))]
        return 0;
    }
    let name = &buf[0..size as usize];
    bun_output::scoped_log!(windowsUserUniqueId, "username: {}", bun_core::fmt::utf16(name));
    // SAFETY: u16 slice -> byte slice
    let bytes = unsafe { core::slice::from_raw_parts(name.as_ptr() as *const u8, name.len() * 2) };
    bun_wyhash::hash32(bytes)
}

pub fn win_sock_error_to_zig_error(err: win32::ws2_32::WinsockError) -> Result<(), bun_core::Error> {
    use win32::ws2_32::WinsockError as W;
    // TODO(port): Zig used `inline else` proposal; manual mapping below.
    let tag = match err {
        W::WSA_INVALID_HANDLE => "WSA_INVALID_HANDLE",
        W::WSA_NOT_ENOUGH_MEMORY => "WSA_NOT_ENOUGH_MEMORY",
        W::WSA_INVALID_PARAMETER => "WSA_INVALID_PARAMETER",
        W::WSA_OPERATION_ABORTED => "WSA_OPERATION_ABORTED",
        W::WSA_IO_INCOMPLETE => "WSA_IO_INCOMPLETE",
        W::WSA_IO_PENDING => "WSA_IO_PENDING",
        W::WSAEINTR => "WSAEINTR",
        W::WSAEBADF => "WSAEBADF",
        W::WSAEACCES => "WSAEACCES",
        W::WSAEFAULT => "WSAEFAULT",
        W::WSAEINVAL => "WSAEINVAL",
        W::WSAEMFILE => "WSAEMFILE",
        W::WSAEWOULDBLOCK => "WSAEWOULDBLOCK",
        W::WSAEINPROGRESS => "WSAEINPROGRESS",
        W::WSAEALREADY => "WSAEALREADY",
        W::WSAENOTSOCK => "WSAENOTSOCK",
        W::WSAEDESTADDRREQ => "WSAEDESTADDRREQ",
        W::WSAEMSGSIZE => "WSAEMSGSIZE",
        W::WSAEPROTOTYPE => "WSAEPROTOTYPE",
        W::WSAENOPROTOOPT => "WSAENOPROTOOPT",
        W::WSAEPROTONOSUPPORT => "WSAEPROTONOSUPPORT",
        W::WSAESOCKTNOSUPPORT => "WSAESOCKTNOSUPPORT",
        W::WSAEOPNOTSUPP => "WSAEOPNOTSUPP",
        W::WSAEPFNOSUPPORT => "WSAEPFNOSUPPORT",
        W::WSAEAFNOSUPPORT => "WSAEAFNOSUPPORT",
        W::WSAEADDRINUSE => "WSAEADDRINUSE",
        W::WSAEADDRNOTAVAIL => "WSAEADDRNOTAVAIL",
        W::WSAENETDOWN => "WSAENETDOWN",
        W::WSAENETUNREACH => "WSAENETUNREACH",
        W::WSAENETRESET => "WSAENETRESET",
        W::WSAECONNABORTED => "WSAECONNABORTED",
        W::WSAECONNRESET => "WSAECONNRESET",
        W::WSAENOBUFS => "WSAENOBUFS",
        W::WSAEISCONN => "WSAEISCONN",
        W::WSAENOTCONN => "WSAENOTCONN",
        W::WSAESHUTDOWN => "WSAESHUTDOWN",
        W::WSAETOOMANYREFS => "WSAETOOMANYREFS",
        W::WSAETIMEDOUT => "WSAETIMEDOUT",
        W::WSAECONNREFUSED => "WSAECONNREFUSED",
        W::WSAELOOP => "WSAELOOP",
        W::WSAENAMETOOLONG => "WSAENAMETOOLONG",
        W::WSAEHOSTDOWN => "WSAEHOSTDOWN",
        W::WSAEHOSTUNREACH => "WSAEHOSTUNREACH",
        W::WSAENOTEMPTY => "WSAENOTEMPTY",
        W::WSAEPROCLIM => "WSAEPROCLIM",
        W::WSAEUSERS => "WSAEUSERS",
        W::WSAEDQUOT => "WSAEDQUOT",
        W::WSAESTALE => "WSAESTALE",
        W::WSAEREMOTE => "WSAEREMOTE",
        W::WSASYSNOTREADY => "WSASYSNOTREADY",
        W::WSAVERNOTSUPPORTED => "WSAVERNOTSUPPORTED",
        W::WSANOTINITIALISED => "WSANOTINITIALISED",
        W::WSAEDISCON => "WSAEDISCON",
        W::WSAENOMORE => "WSAENOMORE",
        W::WSAECANCELLED => "WSAECANCELLED",
        W::WSAEINVALIDPROCTABLE => "WSAEINVALIDPROCTABLE",
        W::WSAEINVALIDPROVIDER => "WSAEINVALIDPROVIDER",
        W::WSAEPROVIDERFAILEDINIT => "WSAEPROVIDERFAILEDINIT",
        W::WSASYSCALLFAILURE => "WSASYSCALLFAILURE",
        W::WSASERVICE_NOT_FOUND => "WSASERVICE_NOT_FOUND",
        W::WSATYPE_NOT_FOUND => "WSATYPE_NOT_FOUND",
        W::WSA_E_NO_MORE => "WSA_E_NO_MORE",
        W::WSA_E_CANCELLED => "WSA_E_CANCELLED",
        W::WSAEREFUSED => "WSAEREFUSED",
        W::WSAHOST_NOT_FOUND => "WSAHOST_NOT_FOUND",
        W::WSATRY_AGAIN => "WSATRY_AGAIN",
        W::WSANO_RECOVERY => "WSANO_RECOVERY",
        W::WSANO_DATA => "WSANO_DATA",
        W::WSA_QOS_RECEIVERS => "WSA_QOS_RECEIVERS",
        W::WSA_QOS_SENDERS => "WSA_QOS_SENDERS",
        W::WSA_QOS_NO_SENDERS => "WSA_QOS_NO_SENDERS",
        W::WSA_QOS_NO_RECEIVERS => "WSA_QOS_NO_RECEIVERS",
        W::WSA_QOS_REQUEST_CONFIRMED => "WSA_QOS_REQUEST_CONFIRMED",
        W::WSA_QOS_ADMISSION_FAILURE => "WSA_QOS_ADMISSION_FAILURE",
        W::WSA_QOS_POLICY_FAILURE => "WSA_QOS_POLICY_FAILURE",
        W::WSA_QOS_BAD_STYLE => "WSA_QOS_BAD_STYLE",
        W::WSA_QOS_BAD_OBJECT => "WSA_QOS_BAD_OBJECT",
        W::WSA_QOS_TRAFFIC_CTRL_ERROR => "WSA_QOS_TRAFFIC_CTRL_ERROR",
        W::WSA_QOS_GENERIC_ERROR => "WSA_QOS_GENERIC_ERROR",
        W::WSA_QOS_ESERVICETYPE => "WSA_QOS_ESERVICETYPE",
        W::WSA_QOS_EFLOWSPEC => "WSA_QOS_EFLOWSPEC",
        W::WSA_QOS_EPROVSPECBUF => "WSA_QOS_EPROVSPECBUF",
        W::WSA_QOS_EFILTERSTYLE => "WSA_QOS_EFILTERSTYLE",
        W::WSA_QOS_EFILTERTYPE => "WSA_QOS_EFILTERTYPE",
        W::WSA_QOS_EFILTERCOUNT => "WSA_QOS_EFILTERCOUNT",
        W::WSA_QOS_EOBJLENGTH => "WSA_QOS_EOBJLENGTH",
        W::WSA_QOS_EFLOWCOUNT => "WSA_QOS_EFLOWCOUNT",
        W::WSA_QOS_EUNKOWNPSOBJ => "WSA_QOS_EUNKOWNPSOBJ",
        W::WSA_QOS_EPOLICYOBJ => "WSA_QOS_EPOLICYOBJ",
        W::WSA_QOS_EFLOWDESC => "WSA_QOS_EFLOWDESC",
        W::WSA_QOS_EPSFLOWSPEC => "WSA_QOS_EPSFLOWSPEC",
        W::WSA_QOS_EPSFILTERSPEC => "WSA_QOS_EPSFILTERSPEC",
        W::WSA_QOS_ESDMODEOBJ => "WSA_QOS_ESDMODEOBJ",
        W::WSA_QOS_ESHAPERATEOBJ => "WSA_QOS_ESHAPERATEOBJ",
        W::WSA_QOS_RESERVED_PETYPE => "WSA_QOS_RESERVED_PETYPE",
        t => {
            if (t as u16) != 0 {
                #[cfg(debug_assertions)]
                bun_core::Output::debug_warn!("Unknown WinSockError: {}", t as u16);
            }
            return Ok(());
        }
    };
    Err(bun_core::Error::intern(tag))
}

pub fn WSAGetLastError() -> Option<SystemErrno> {
    // SAFETY: ws2_32 is loaded
    SystemErrno::init(u32::try_from(unsafe { win32::ws2_32::WSAGetLastError() }).unwrap())
}

// BOOL CreateDirectoryExW(
//   [in]           LPCWSTR               lpTemplateDirectory,
//   [in]           LPCWSTR               lpNewDirectory,
//   [in, optional] LPSECURITY_ATTRIBUTES lpSecurityAttributes
// );
pub use bun_windows_sys::externs::CreateDirectoryExW;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum GetFinalPathNameByHandleError {
    #[error("FileNotFound")]
    FileNotFound,
    #[error("NameTooLong")]
    NameTooLong,
}

pub fn GetFinalPathNameByHandle(
    hFile: HANDLE,
    fmt: win32::GetFinalPathNameByHandleFormat,
    out_buffer: &mut [u16],
) -> Result<&mut [u16], GetFinalPathNameByHandleError> {
    let flags = match fmt.volume_name {
        win32::VolumeName::Dos => win32::FILE_NAME_NORMALIZED | win32::VOLUME_NAME_DOS,
        win32::VolumeName::Nt => win32::FILE_NAME_NORMALIZED | win32::VOLUME_NAME_NT,
    };
    // SAFETY: out_buffer valid for out_buffer.len()
    let return_length = unsafe {
        externs::GetFinalPathNameByHandleW(hFile, out_buffer.as_mut_ptr(), out_buffer.len() as u32, flags)
    };

    if return_length == 0 {
        // SAFETY: GetLastError has no preconditions
        let err = unsafe { GetLastError() };
        bun_sys::syslog!("GetFinalPathNameByHandleW({:p}) = {:?}", hFile, err);
        return Err(GetFinalPathNameByHandleError::FileNotFound);
    }

    if (return_length as usize) >= out_buffer.len() {
        bun_sys::syslog!(
            "GetFinalPathNameByHandleW({:p}) = NAMETOOLONG (needed {}, have {})",
            hFile, return_length, out_buffer.len()
        );
        return Err(GetFinalPathNameByHandleError::NameTooLong);
    }

    let mut ret = &mut out_buffer[0..(return_length as usize)];

    bun_sys::syslog!("GetFinalPathNameByHandleW({:p}) = {}", hFile, bun_core::fmt::utf16(ret));

    if bun_str::strings::has_prefix_comptime_type_u16(ret, &LONG_PATH_PREFIX) {
        // '\\?\C:\absolute\path' -> 'C:\absolute\path'
        ret = &mut ret[4..];
        if bun_str::strings::has_prefix_comptime_utf16(ret, b"UNC\\") {
            // '\\?\UNC\absolute\path' -> '\\absolute\path'
            ret[2] = b'\\' as u16;
            ret = &mut ret[2..];
        }
    }

    Ok(ret)
}

const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS: DWORD = 0x00000004;

pub fn get_module_handle_from_address(addr: usize) -> Option<HMODULE> {
    let mut module: HMODULE = ptr::null_mut();
    // SAFETY: addr cast to LPCWSTR per Win32 docs when FROM_ADDRESS flag set
    let rc = unsafe {
        externs::GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
            addr as *const u16,
            &mut module,
        )
    };
    // If the function succeeds, the return value is nonzero.
    if rc != 0 { Some(module) } else { None }
}

pub fn get_module_name_w(module: HMODULE, buf: &mut [u16]) -> Option<&[u16]> {
    // SAFETY: buf valid for buf.len()
    let rc = unsafe { externs::GetModuleFileNameW(module, buf.as_mut_ptr(), u32::try_from(buf.len()).unwrap()) };
    if rc == 0 {
        return None;
    }
    Some(&buf[0..(rc as usize)])
}

pub use bun_windows_sys::externs::GetThreadDescription;

pub const ENABLE_ECHO_INPUT: DWORD = 0x004;
pub const ENABLE_LINE_INPUT: DWORD = 0x002;
pub const ENABLE_PROCESSED_INPUT: DWORD = 0x001;
pub const ENABLE_VIRTUAL_TERMINAL_INPUT: DWORD = 0x200;
pub const ENABLE_WRAP_AT_EOL_OUTPUT: DWORD = 0x0002;
pub const ENABLE_PROCESSED_OUTPUT: DWORD = 0x0001;

pub use bun_windows_sys::externs::SetStdHandle;
pub use bun_windows_sys::externs::GetConsoleOutputCP;
pub use bun_windows_sys::externs::GetConsoleCP;
pub use bun_windows_sys::externs::SetConsoleCP;

pub struct DeleteFileOptions {
    pub dir: Option<HANDLE>,
    pub remove_dir: bool,
}

impl Default for DeleteFileOptions {
    fn default() -> Self {
        Self { dir: None, remove_dir: false }
    }
}

const FILE_DISPOSITION_DELETE: ULONG = 0x00000001;
const FILE_DISPOSITION_POSIX_SEMANTICS: ULONG = 0x00000002;
const FILE_DISPOSITION_FORCE_IMAGE_SECTION_CHECK: ULONG = 0x00000004;
const FILE_DISPOSITION_ON_CLOSE: ULONG = 0x00000008;
const FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE: ULONG = 0x00000010;

// Copy-paste of the standard library function except without unreachable.
pub fn DeleteFileBun(sub_path_w: &[u16], options: DeleteFileOptions) -> bun_sys::Result<()> {
    let create_options_flags: ULONG = if options.remove_dir {
        FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT
    } else {
        windows::FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT // would we ever want to delete the target instead?
    };

    let path_len_bytes = u16::try_from(sub_path_w.len() * 2).unwrap();
    let mut nt_name = UNICODE_STRING {
        Length: path_len_bytes,
        MaximumLength: path_len_bytes,
        // The Windows API makes this mutable, but it will not mutate here.
        Buffer: sub_path_w.as_ptr() as *mut u16,
    };

    if sub_path_w[0] == b'.' as u16 && sub_path_w[1] == 0 {
        // Windows does not recognize this, but it does work with empty string.
        nt_name.Length = 0;
    }

    let mut attr = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: if bun_paths::is_absolute_windows_wtf16(sub_path_w) { ptr::null_mut() } else { options.dir.unwrap_or(ptr::null_mut()) },
        Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        ObjectName: &mut nt_name,
        SecurityDescriptor: ptr::null_mut(),
        SecurityQualityOfService: ptr::null_mut(),
    };
    // SAFETY: all-zero is a valid IO_STATUS_BLOCK
    let mut io: IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
    let mut tmp_handle: HANDLE = ptr::null_mut();
    // SAFETY: all out-params are valid
    let mut rc = unsafe {
        ntdll::NtCreateFile(
            &mut tmp_handle,
            windows::SYNCHRONIZE | windows::DELETE,
            &mut attr,
            &mut io,
            ptr::null_mut(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            windows::FILE_OPEN,
            create_options_flags,
            ptr::null_mut(),
            0,
        )
    };
    bun_sys::syslog!("NtCreateFile({}, DELETE) = {:?}", bun_core::fmt::fmt_path_u16(sub_path_w, Default::default()), rc);
    if let Some(err) = bun_sys::Result::<()>::errno_sys(rc, bun_sys::Tag::open) {
        return err;
    }
    // SAFETY: tmp_handle is valid; closed at scope exit
    let _close_guard = scopeguard::guard(tmp_handle, |h| unsafe { let _ = externs::CloseHandle(h); });

    // FileDispositionInformationEx (and therefore FILE_DISPOSITION_POSIX_SEMANTICS and FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE)
    // are only supported on NTFS filesystems, so the version check on its own is only a partial solution. To support non-NTFS filesystems
    // like FAT32, we need to fallback to FileDispositionInformation if the usage of FileDispositionInformationEx gives
    // us INVALID_PARAMETER.
    // The same reasoning for win10_rs5 as in os.renameatW() applies (FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE requires >= win10_rs5).
    let mut need_fallback = true;
    // Deletion with posix semantics if the filesystem supports it.
    let mut info = windows::FILE_DISPOSITION_INFORMATION_EX {
        Flags: FILE_DISPOSITION_DELETE
            | FILE_DISPOSITION_POSIX_SEMANTICS
            | FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };

    // SAFETY: tmp_handle and io are valid
    rc = unsafe {
        ntdll::NtSetInformationFile(
            tmp_handle,
            &mut io,
            (&mut info) as *mut _ as *mut c_void,
            size_of::<windows::FILE_DISPOSITION_INFORMATION_EX>() as u32,
            windows::FileInformationClass::FileDispositionInformationEx,
        )
    };
    bun_sys::syslog!("NtSetInformationFile({}, DELETE) = {:?}", bun_core::fmt::fmt_path_u16(sub_path_w, Default::default()), rc);
    match rc {
        x if x == windows::ntstatus::SUCCESS => return bun_sys::Result::success(),
        // INVALID_PARAMETER here means that the filesystem does not support FileDispositionInformationEx
        x if x == windows::ntstatus::INVALID_PARAMETER => {}
        // For all other statuses, fall down to the switch below to handle them.
        _ => need_fallback = false,
    }
    if need_fallback {
        // Deletion with file pending semantics, which requires waiting or moving
        // files to get them removed (from here).
        let mut file_dispo = windows::FILE_DISPOSITION_INFORMATION { DeleteFile: TRUE };

        // SAFETY: tmp_handle and io are valid
        rc = unsafe {
            ntdll::NtSetInformationFile(
                tmp_handle,
                &mut io,
                (&mut file_dispo) as *mut _ as *mut c_void,
                size_of::<windows::FILE_DISPOSITION_INFORMATION>() as u32,
                windows::FileInformationClass::FileDispositionInformation,
            )
        };
        bun_sys::syslog!("NtSetInformationFile({}, DELETE) = {:?}", bun_core::fmt::fmt_path_u16(sub_path_w, Default::default()), rc);
    }
    if let Some(err) = bun_sys::Result::<()>::errno_sys(rc, bun_sys::Tag::NtSetInformationFile) {
        return err;
    }

    bun_sys::Result::success()
}

pub const EXCEPTION_CONTINUE_EXECUTION: i32 = -1;
pub const MS_VC_EXCEPTION: u32 = 0x406d1388;

#[repr(C)]
pub struct STARTUPINFOEXW {
    pub StartupInfo: win32::STARTUPINFOW,
    pub lpAttributeList: *mut u8,
}

pub use bun_windows_sys::externs::InitializeProcThreadAttributeList;

pub use bun_windows_sys::externs::UpdateProcThreadAttribute;

pub use bun_windows_sys::externs::IsProcessInJob;

pub const EXTENDED_STARTUPINFO_PRESENT: DWORD = 0x80000;
pub const PROC_THREAD_ATTRIBUTE_JOB_LIST: DWORD = 0x2000D;

/// Handle to a Windows pseudoconsole (ConPTY).
pub use bun_windows_sys::externs::HPCON;

pub use bun_windows_sys::externs::CreatePseudoConsole;

pub use bun_windows_sys::externs::ResizePseudoConsole;

pub use bun_windows_sys::externs::ClosePseudoConsole;

pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x2000;
pub const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION: DWORD = 0x400;
pub const JOB_OBJECT_LIMIT_BREAKAWAY_OK: DWORD = 0x800;
pub const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK: DWORD = 0x00001000;

const PE_HEADER_OFFSET_LOCATION: i64 = 0x3C;
const SUBSYSTEM_OFFSET: i64 = 0x5C;

#[repr(u16)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Subsystem {
    WindowsGui = 2,
}

pub fn edit_win32_binary_subsystem(fd: bun_sys::File, subsystem: Subsystem) -> Result<(), bun_core::Error> {
    const _: () = assert!(cfg!(windows));
    // SAFETY: fd.handle is a valid Windows HANDLE
    if unsafe { externs::SetFilePointerEx(fd.handle.cast(), PE_HEADER_OFFSET_LOCATION, ptr::null_mut(), win32::FILE_BEGIN) } == 0 {
        return Err(bun_core::err!("Win32Error"));
    }
    // TODO(port): fd.reader().readInt(u32, .little)
    let offset: u32 = fd.reader().read_int_le::<u32>()?;
    // SAFETY: fd.handle is a valid Windows HANDLE
    if unsafe { externs::SetFilePointerEx(fd.handle.cast(), offset as i64 + SUBSYSTEM_OFFSET, ptr::null_mut(), win32::FILE_BEGIN) } == 0 {
        return Err(bun_core::err!("Win32Error"));
    }
    fd.writer().write_int_le::<u16>(subsystem as u16)?;
    Ok(())
}

pub mod rescle {
    use super::*;

    // TODO(port): move to windows_sys
    unsafe extern "C" {
        fn rescle__setIcon(exe_path: *const u16, icon_path: *const u16) -> c_int;
        fn rescle__setWindowsMetadata(
            exe_path: *const u16,      // exe_path
            icon_path: *const u16,     // icon_path (nullable)
            title: *const u16,         // title (nullable)
            publisher: *const u16,     // publisher (nullable)
            version: *const u16,       // version (nullable)
            description: *const u16,   // description (nullable)
            copyright: *const u16,     // copyright (nullable)
        ) -> c_int;
    }

    #[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
    pub enum RescleError {
        #[error("IconEditError")] IconEditError,
        #[error("InvalidVersionFormat")] InvalidVersionFormat,
        #[error("FailedToLoadExecutable")] FailedToLoadExecutable,
        #[error("FailedToSetIcon")] FailedToSetIcon,
        #[error("FailedToSetProductName")] FailedToSetProductName,
        #[error("FailedToSetCompanyName")] FailedToSetCompanyName,
        #[error("FailedToSetDescription")] FailedToSetDescription,
        #[error("FailedToSetCopyright")] FailedToSetCopyright,
        #[error("FailedToSetFileVersion")] FailedToSetFileVersion,
        #[error("FailedToSetProductVersion")] FailedToSetProductVersion,
        #[error("FailedToSetFileVersionString")] FailedToSetFileVersionString,
        #[error("FailedToSetProductVersionString")] FailedToSetProductVersionString,
        #[error("FailedToCommit")] FailedToCommit,
        #[error("WindowsMetadataEditError")] WindowsMetadataEditError,
    }

    pub fn set_icon(exe_path: *const u16, icon: *const u16) -> Result<(), RescleError> {
        const _: () = assert!(cfg!(windows));
        // SAFETY: paths are NUL-terminated
        let status = unsafe { rescle__setIcon(exe_path, icon) };
        match status {
            0 => Ok(()),
            _ => Err(RescleError::IconEditError),
        }
    }

    pub fn set_windows_metadata(
        exe_path: *const u16,
        icon: Option<&[u8]>,
        title: Option<&[u8]>,
        publisher: Option<&[u8]>,
        version: Option<&[u8]>,
        description: Option<&[u8]>,
        copyright: Option<&[u8]>,
    ) -> Result<(), bun_core::Error> {
        const _: () = assert!(cfg!(windows));

        // Validate version string format if provided
        if let Some(v) = version {
            // Empty version string is invalid
            if v.is_empty() {
                return Err(RescleError::InvalidVersionFormat.into());
            }

            // Basic validation: check format and ranges
            let mut parts_count: u32 = 0;
            for part in v.split(|b| *b == b'.').filter(|s| !s.is_empty()) {
                if parts_count >= 4 {
                    return Err(RescleError::InvalidVersionFormat.into());
                }
                // TODO(port): std.fmt.parseInt(u16, part, 10)
                let Ok(_num) = core::str::from_utf8(part).ok().and_then(|s| s.parse::<u16>().ok()).ok_or(()) else {
                    return Err(RescleError::InvalidVersionFormat.into());
                };
                // u16 already ensures value is 0-65535
                parts_count += 1;
            }
            if parts_count == 0 {
                return Err(RescleError::InvalidVersionFormat.into());
            }
        }

        // Allocate UTF-16 strings (global mimalloc; allocator param dropped)

        // Icon is a path, so use toWPathNormalized with proper buffer handling
        let mut icon_buf = bun_paths::WPathBuffer::uninit();
        let icon_w: Option<&bun_str::WStr> = if let Some(i) = icon {
            let path_w = bun_str::strings::to_w_path_normalized(&mut icon_buf, i);
            // toWPathNormalized returns a slice into icon_buf, need to null-terminate it
            let len = path_w.len();
            let buf_u16 = icon_buf.as_mut_slice();
            buf_u16[len] = 0;
            // SAFETY: buf_u16[len] == 0 written above; pointer + len form a valid NUL-terminated wide slice
            Some(unsafe { bun_str::WStr::from_raw(buf_u16.as_ptr(), len) })
        } else {
            None
        };

        // TODO(port): bun.strings.toUTF16AllocForReal returns owned [:0]u16; using Box<[u16]> here.
        let title_w = title.map(|t| bun_str::strings::to_utf16_alloc_for_real(t, false, true)).transpose()?;
        let publisher_w = publisher.map(|p| bun_str::strings::to_utf16_alloc_for_real(p, false, true)).transpose()?;
        let version_w = version.map(|v| bun_str::strings::to_utf16_alloc_for_real(v, false, true)).transpose()?;
        let description_w = description.map(|d| bun_str::strings::to_utf16_alloc_for_real(d, false, true)).transpose()?;
        let copyright_w = copyright.map(|cr| bun_str::strings::to_utf16_alloc_for_real(cr, false, true)).transpose()?;

        // SAFETY: all pointers are NUL-terminated wide strings or null
        let status = unsafe {
            rescle__setWindowsMetadata(
                exe_path,
                icon_w.map_or(ptr::null(), |iw| iw.as_ptr()),
                title_w.as_ref().map_or(ptr::null(), |tw| tw.as_ptr()),
                publisher_w.as_ref().map_or(ptr::null(), |pw| pw.as_ptr()),
                version_w.as_ref().map_or(ptr::null(), |vw| vw.as_ptr()),
                description_w.as_ref().map_or(ptr::null(), |dw| dw.as_ptr()),
                copyright_w.as_ref().map_or(ptr::null(), |cw| cw.as_ptr()),
            )
        };
        match status {
            0 => Ok(()),
            -1 => Err(RescleError::FailedToLoadExecutable.into()),
            -2 => Err(RescleError::FailedToSetIcon.into()),
            -3 => Err(RescleError::FailedToSetProductName.into()),
            -4 => Err(RescleError::FailedToSetCompanyName.into()),
            -5 => Err(RescleError::FailedToSetDescription.into()),
            -6 => Err(RescleError::FailedToSetCopyright.into()),
            -7 => Err(RescleError::FailedToSetFileVersion.into()),
            -8 => Err(RescleError::FailedToSetProductVersion.into()),
            -9 => Err(RescleError::FailedToSetFileVersionString.into()),
            -10 => Err(RescleError::FailedToSetProductVersionString.into()),
            -11 => Err(RescleError::InvalidVersionFormat.into()),
            -12 => Err(RescleError::FailedToCommit.into()),
            _ => Err(RescleError::WindowsMetadataEditError.into()),
        }
    }
}

pub use bun_windows_sys::externs::CloseHandle;
pub use bun_windows_sys::externs::GetFinalPathNameByHandleW;
pub use bun_windows_sys::externs::DeleteFileW;
pub use bun_windows_sys::externs::CreateSymbolicLinkW;
pub use bun_windows_sys::externs::GetCurrentThread;
pub use bun_windows_sys::externs::GetCommandLineW;
pub use bun_windows_sys::externs::CreateDirectoryW;
pub use bun_windows_sys::externs::SetEndOfFile;
pub use bun_windows_sys::externs::GetProcessTimes;

#[derive(Default)]
pub struct UpdateStdioModeFlagsOpts {
    pub set: DWORD,
    pub unset: DWORD,
}

/// Returns the original mode, or null on failure
pub fn update_stdio_mode_flags(i: bun_sys::Stdio, opts: UpdateStdioModeFlagsOpts) -> Result<DWORD, bun_core::Error> {
    let fd = i.fd();
    let mut original_mode: DWORD = 0;
    // SAFETY: fd is a valid console handle
    if unsafe { externs::GetConsoleMode(fd.cast(), &mut original_mode) } != 0 {
        if unsafe { externs::SetConsoleMode(fd.cast(), (original_mode | opts.set) & !opts.unset) } == 0 {
            return Err(get_last_error());
        }
    } else {
        return Err(get_last_error());
    }
    Ok(original_mode)
}

const WATCHER_CHILD_ENV: &[u16] = bun_str::w!("_BUN_WATCHER_CHILD");

// magic exit code to indicate to the watcher manager that the child process should be re-spawned
// this was randomly generated - we need to avoid using a common exit code that might be used by the script itself
pub const WATCHER_RELOAD_EXIT: DWORD = 3224497970;

pub use bun_runtime::api::bun::spawn::PosixSpawn as spawn;

pub fn is_watcher_child() -> bool {
    let mut buf: [u16; 1] = [0];
    // SAFETY: buf valid for 1 element
    unsafe { kernel32_2::GetEnvironmentVariableW(WATCHER_CHILD_ENV.as_ptr(), buf.as_mut_ptr(), 1) > 0 }
}

pub fn become_watcher_manager() -> ! {
    // this process will be the parent of the child process that actually runs the script
    // SAFETY: all-zero is a valid PROCESS_INFORMATION
    let mut procinfo: win32::PROCESS_INFORMATION = unsafe { core::mem::zeroed() };
    // SAFETY: FFI call has no input invariants; mutates process-global stdio inheritance flags
    unsafe { externs::windows_enable_stdio_inheritance() };
    // SAFETY: null args allowed
    let job = unsafe { externs::CreateJobObjectA(ptr::null_mut(), ptr::null()) };
    if job.is_null() {
        // SAFETY: GetLastError has no preconditions
        let err = unsafe { kernel32::GetLastError() };
        bun_core::Output::panic!(
            "Could not create watcher Job Object: {}",
            <&'static str>::from(err)
        );
    }
    // SAFETY: all-zero is valid for this C struct
    let mut jeli: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { core::mem::zeroed() };
    jeli.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_BREAKAWAY_OK
        | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
        | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    // SAFETY: job and jeli are valid
    if unsafe {
        externs::SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&mut jeli) as *mut _ as *mut c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        // SAFETY: GetLastError has no preconditions
        let err = unsafe { kernel32::GetLastError() };
        bun_core::Output::panic!(
            "Could not configure watcher Job Object: {}",
            <&'static str>::from(err)
        );
    }

    loop {
        if let Err(err) = spawn_watcher_child(&mut procinfo, job) {
            bun_core::handle_error_return_trace(err);
            if err == bun_core::err!("Win32Error") {
                // SAFETY: GetLastError has no preconditions
                let last = unsafe { GetLastError() };
                bun_core::Output::panic!("Failed to spawn process: {}\n", <&'static str>::from(last));
            }
            bun_core::Output::panic!("Failed to spawn process: {}\n", err.name());
        }
        // SAFETY: hProcess valid
        if let Err(err) = unsafe { win32::WaitForSingleObject(procinfo.hProcess, win32::INFINITE) } {
            bun_core::Output::panic!("Failed to wait for child process: {}\n", err.name());
        }
        let mut exit_code: DWORD = 0;
        // SAFETY: hProcess valid, exit_code is out-param
        if unsafe { externs::GetExitCodeProcess(procinfo.hProcess, &mut exit_code) } == 0 {
            // SAFETY: GetLastError has no preconditions
            let err = unsafe { GetLastError() };
            // SAFETY: hProcess owned by this fn; closing on error path
            unsafe { let _ = externs::NtClose(procinfo.hProcess); }
            bun_core::Output::panic!("Failed to get exit code of child process: {}\n", <&'static str>::from(err));
        }
        // SAFETY: hProcess owned by this fn
        unsafe { let _ = externs::NtClose(procinfo.hProcess); }

        // magic exit code to indicate that the child process should be re-spawned
        if exit_code == WATCHER_RELOAD_EXIT {
            continue;
        } else {
            bun_core::Global::exit(exit_code);
        }
    }
}

pub fn spawn_watcher_child(
    procinfo: &mut win32::PROCESS_INFORMATION,
    job: HANDLE,
) -> Result<(), bun_core::Error> {
    // https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812
    let mut attr_size: usize = 0;
    // SAFETY: query size with null buffer
    unsafe { let _ = externs::InitializeProcThreadAttributeList(ptr::null_mut(), 1, 0, &mut attr_size); }
    let mut p: Vec<u8> = vec![0u8; attr_size];
    // SAFETY: p has attr_size bytes
    if unsafe { externs::InitializeProcThreadAttributeList(p.as_mut_ptr(), 1, 0, &mut attr_size) } == 0 {
        return Err(bun_core::err!("Win32Error"));
    }
    let mut job_local = job;
    // SAFETY: p initialized above; job_local valid for sizeof(HANDLE)
    if unsafe {
        externs::UpdateProcThreadAttribute(
            p.as_mut_ptr(),
            0,
            PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
            (&mut job_local) as *mut _ as *mut c_void,
            size_of::<HANDLE>(),
            ptr::null_mut(),
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(bun_core::err!("Win32Error"));
    }

    let flags = win32::CreateProcessFlags { create_unicode_environment: true, extended_startupinfo_present: true, ..Default::default() };

    let image_path = exe_path_w();
    let mut wbuf = bun_paths::WPathBuffer::uninit();
    wbuf.as_mut_slice()[0..image_path.len()].copy_from_slice(image_path.as_slice());
    wbuf.as_mut_slice()[image_path.len()] = 0;

    // SAFETY: NUL written at [len]
    let image_path_z = unsafe { bun_str::WStr::from_raw(wbuf.as_ptr(), image_path.len()) };

    // SAFETY: returns owned env block or null
    let kernelenv = unsafe { kernel32_2::GetEnvironmentStringsW() };
    let _free_env = scopeguard::guard(kernelenv, |envptr| {
        if !envptr.is_null() {
            // SAFETY: envptr was returned from GetEnvironmentStringsW and is non-null
            unsafe { let _ = kernel32_2::FreeEnvironmentStringsW(envptr); }
        }
    });

    let mut size: usize = 0;
    if !kernelenv.is_null() {
        // SAFETY: env block is double-NUL terminated
        unsafe {
            // check that env is non-empty
            if *kernelenv.add(0) != 0 || *kernelenv.add(1) != 0 {
                // array is terminated by two nulls
                while *kernelenv.add(size) != 0 || *kernelenv.add(size + 1) != 0 {
                    size += 1;
                }
                size += 1;
            }
        }
    }
    // now pointer[size] is the first null

    let mut envbuf: Vec<u16> = vec![0u16; size + WATCHER_CHILD_ENV.len() + 4];
    if !kernelenv.is_null() {
        // SAFETY: kernelenv has at least `size` elements
        unsafe {
            ptr::copy_nonoverlapping(kernelenv, envbuf.as_mut_ptr(), size);
        }
    }
    envbuf[size..size + WATCHER_CHILD_ENV.len()].copy_from_slice(WATCHER_CHILD_ENV);
    envbuf[size + WATCHER_CHILD_ENV.len()] = b'=' as u16;
    envbuf[size + WATCHER_CHILD_ENV.len() + 1] = b'1' as u16;
    envbuf[size + WATCHER_CHILD_ENV.len() + 2] = 0;
    envbuf[size + WATCHER_CHILD_ENV.len() + 3] = 0;

    let mut startupinfo = STARTUPINFOEXW {
        StartupInfo: win32::STARTUPINFOW {
            cb: size_of::<STARTUPINFOEXW>() as u32,
            lpReserved: ptr::null_mut(),
            lpDesktop: ptr::null_mut(),
            lpTitle: ptr::null_mut(),
            dwX: 0,
            dwY: 0,
            dwXSize: 0,
            dwYSize: 0,
            dwXCountChars: 0,
            dwYCountChars: 0,
            dwFillAttribute: 0,
            dwFlags: win32::STARTF_USESTDHANDLES,
            wShowWindow: 0,
            cbReserved2: 0,
            lpReserved2: ptr::null_mut(),
            // TODO(port): std.fs.File.stdin/stdout/stderr().handle — use bun_sys stdio handles
            hStdInput: bun_sys::Fd::stdin().cast(),
            hStdOutput: bun_sys::Fd::stdout().cast(),
            hStdError: bun_sys::Fd::stderr().cast(),
        },
        lpAttributeList: p.as_mut_ptr(),
    };
    // SAFETY: procinfo is POD
    unsafe { ptr::write_bytes(procinfo as *mut _ as *mut u8, 0, size_of::<win32::PROCESS_INFORMATION>()); }
    // SAFETY: all pointers valid; envbuf double-NUL terminated
    let rc = unsafe {
        kernel32::CreateProcessW(
            image_path_z.as_ptr(),
            externs::GetCommandLineW(),
            ptr::null_mut(),
            ptr::null_mut(),
            1,
            flags,
            envbuf.as_mut_ptr() as *mut c_void,
            ptr::null(),
            (&mut startupinfo) as *mut _ as *mut win32::STARTUPINFOW,
            procinfo,
        )
    };
    if rc == 0 {
        return Err(bun_core::err!("Win32Error"));
    }
    let mut is_in_job: BOOL = 0;
    // SAFETY: procinfo.hProcess and job are valid handles; is_in_job is a valid out-param
    unsafe { let _ = externs::IsProcessInJob(procinfo.hProcess, job, &mut is_in_job); }
    debug_assert!(is_in_job != 0);
    // SAFETY: procinfo.hThread owned by this fn
    unsafe { let _ = externs::NtClose(procinfo.hThread); }
    Ok(())
}

/// Returns null on error. Use windows API to lookup the actual error.
/// The reason this function is in zig is so that we can use our own utf16-conversion functions.
///
/// Using characters16() does not seem to always have the sentinel. or something else
/// broke when I just used it. Not sure. ... but this works!
#[unsafe(no_mangle)]
pub extern "C" fn Bun__LoadLibraryBunString(str_: &bun_str::String) -> *mut c_void {
    #[cfg(not(windows))]
    { compile_error!("unreachable"); }

    let mut buf = bun_paths::WPathBuffer::uninit();
    let data: &[u16] = match str_.encoding() {
        bun_str::Encoding::Utf8 => bun_str::strings::convert_utf8_to_utf16_in_buffer(buf.as_mut_slice(), str_.utf8()),
        bun_str::Encoding::Utf16 => {
            let src = str_.utf16();
            buf.as_mut_slice()[0..src.len()].copy_from_slice(src);
            &buf.as_slice()[0..src.len()]
        }
        bun_str::Encoding::Latin1 => {
            bun_str::strings::copy_u8_into_u16(buf.as_mut_slice(), str_.latin1());
            &buf.as_slice()[0..str_.length()]
        }
    };
    let len = data.len();
    buf.as_mut_slice()[len] = 0;
    const LOAD_WITH_ALTERED_SEARCH_PATH: DWORD = 0x00000008;
    // SAFETY: buf NUL-terminated at [len]
    unsafe { kernel32::LoadLibraryExW(buf.as_ptr(), ptr::null_mut(), LOAD_WITH_ALTERED_SEARCH_PATH) }
}

pub use bun_windows_sys::externs::windows_enable_stdio_inheritance;

/// Extracted from standard library except this takes an open file descriptor
///
/// NOTE: THE FILE MUST BE OPENED WITH ACCESS_MASK "DELETE" OR THIS WILL FAIL
pub fn delete_opened_file(fd: Fd) -> bun_sys::Result<()> {
    // TODO(port): comptime bun.assert(builtin.target.os.version_range.windows.min.isAtLeast(.win10_rs5));
    let mut info = win32::FILE_DISPOSITION_INFORMATION_EX {
        Flags: FILE_DISPOSITION_DELETE
            | FILE_DISPOSITION_POSIX_SEMANTICS
            | FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };

    // SAFETY: all-zero is a valid IO_STATUS_BLOCK
    let mut io: win32::IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
    // SAFETY: fd valid; info/io valid
    let rc = unsafe {
        ntdll::NtSetInformationFile(
            fd.cast(),
            &mut io,
            (&mut info) as *mut _ as *mut c_void,
            size_of::<win32::FILE_DISPOSITION_INFORMATION_EX>() as u32,
            win32::FileInformationClass::FileDispositionInformationEx,
        )
    };

    bun_sys::syslog!("deleteOpenedFile({}) = {}", fd, <&'static str>::from(rc));

    if rc == win32::ntstatus::SUCCESS {
        bun_sys::Result::success()
    } else {
        bun_sys::Result::errno(rc, bun_sys::Tag::NtSetInformationFile)
    }
}

/// With an open file source_fd, move it into the directory new_dir_fd with the name new_path_w.
/// Does not close the file descriptor.
///
/// For this to succeed
/// - source_fd must have been opened with access_mask=w.DELETE
/// - new_path_w must be the name of a file. it cannot be a path relative to new_dir_fd. see moveOpenedFileAtLoose
pub fn move_opened_file_at(
    src_fd: Fd,
    new_dir_fd: Fd,
    new_file_name: &[u16],
    replace_if_exists: bool,
) -> bun_sys::Result<()> {
    // FILE_RENAME_INFORMATION_EX and FILE_RENAME_POSIX_SEMANTICS require >= win10_rs1,
    // but FILE_RENAME_IGNORE_READONLY_ATTRIBUTE requires >= win10_rs5. We check >= rs5 here
    // so that we only use POSIX_SEMANTICS when we know IGNORE_READONLY_ATTRIBUTE will also be
    // supported in order to avoid either (1) using a redundant call that we can know in advance will return
    // STATUS_NOT_SUPPORTED or (2) only setting IGNORE_READONLY_ATTRIBUTE when >= rs5
    // and therefore having different behavior when the Windows version is >= rs1 but < rs5.
    // TODO(port): comptime bun.assert(builtin.target.os.version_range.windows.min.isAtLeast(.win10_rs5));

    if cfg!(debug_assertions) {
        debug_assert!(!new_file_name.contains(&(b'/' as u16))); // Call moveOpenedFileAtLoose
    }

    const STRUCT_BUF_LEN: usize = size_of::<win32::FILE_RENAME_INFORMATION_EX>() + (bun_paths::MAX_PATH_BYTES - 1);
    #[repr(align(8))] // align_of FILE_RENAME_INFORMATION_EX
    struct AlignedBuf([u8; STRUCT_BUF_LEN]);
    // SAFETY: AlignedBuf is plain [u8; N] used as raw byte storage; fully written via *rename_info = ... and copy_nonoverlapping before any read
    let mut rename_info_buf: AlignedBuf = unsafe { MaybeUninit::uninit().assume_init() };

    let struct_len = size_of::<win32::FILE_RENAME_INFORMATION_EX>() - 1 + new_file_name.len() * 2;
    if struct_len > STRUCT_BUF_LEN {
        return bun_sys::Result::errno(E::NAMETOOLONG, bun_sys::Tag::NtSetInformationFile);
    }

    // SAFETY: buffer aligned for FILE_RENAME_INFORMATION_EX
    let rename_info = unsafe { &mut *(rename_info_buf.0.as_mut_ptr() as *mut win32::FILE_RENAME_INFORMATION_EX) };
    // SAFETY: all-zero is a valid IO_STATUS_BLOCK
    let mut io_status_block: win32::IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };

    let mut flags: ULONG = win32::FILE_RENAME_POSIX_SEMANTICS | win32::FILE_RENAME_IGNORE_READONLY_ATTRIBUTE;
    if replace_if_exists {
        flags |= win32::FILE_RENAME_REPLACE_IF_EXISTS;
    }
    *rename_info = win32::FILE_RENAME_INFORMATION_EX {
        Flags: flags,
        RootDirectory: if bun_paths::is_absolute_windows_wtf16(new_file_name) { ptr::null_mut() } else { new_dir_fd.cast() },
        FileNameLength: u32::try_from(new_file_name.len() * 2).unwrap(), // already checked error.NameTooLong
        FileName: [0; 1], // overwritten below
    };
    // SAFETY: rename_info_buf has space for new_file_name after the header
    unsafe {
        ptr::copy_nonoverlapping(
            new_file_name.as_ptr(),
            rename_info.FileName.as_mut_ptr(),
            new_file_name.len(),
        );
    }
    // SAFETY: src_fd valid; rename_info has struct_len bytes
    let rc = unsafe {
        ntdll::NtSetInformationFile(
            src_fd.cast(),
            &mut io_status_block,
            rename_info as *mut _ as *mut c_void,
            u32::try_from(struct_len).unwrap(), // already checked for error.NameTooLong
            win32::FileInformationClass::FileRenameInformationEx,
        )
    };
    bun_sys::syslog!(
        "moveOpenedFileAt({} ->> {} '{}', {}) = {}",
        src_fd, new_dir_fd, bun_core::fmt::utf16(new_file_name),
        if replace_if_exists { "replace_if_exists" } else { "no flag" },
        <&'static str>::from(rc)
    );

    #[cfg(debug_assertions)]
    if rc == win32::ntstatus::ACCESS_DENIED {
        bun_core::Output::debug_warn("moveOpenedFileAt was called on a file descriptor without access_mask=w.DELETE", &[]);
    }

    if rc == win32::ntstatus::SUCCESS {
        bun_sys::Result::success()
    } else {
        bun_sys::Result::errno(rc, bun_sys::Tag::NtSetInformationFile)
    }
}

/// Same as moveOpenedFileAt but allows new_path to be a path relative to new_dir_fd.
///
/// Aka: moveOpenedFileAtLoose(fd, dir, ".\\a\\relative\\not-normalized-path.txt", false);
pub fn move_opened_file_at_loose(
    src_fd: Fd,
    new_dir_fd: Fd,
    new_path: &[u16],
    replace_if_exists: bool,
) -> bun_sys::Result<()> {
    debug_assert!(!new_path.contains(&(b'/' as u16))); // Call bun.strings.toWPathNormalized first

    let without_leading_dot_slash = if new_path.len() >= 2 && new_path[0] == b'.' as u16 && new_path[1] == b'\\' as u16 {
        &new_path[2..]
    } else {
        new_path
    };

    if let Some(last_slash) = new_path.iter().rposition(|&c| c == b'\\' as u16) {
        let dirname = &new_path[0..last_slash];
        let fd = match bun_sys::open_dir_at_windows(new_dir_fd, dirname, bun_sys::OpenDirOptions { can_rename_or_delete: true, iterable: false, ..Default::default() }) {
            bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
            bun_sys::Result::Ok(fd) => fd,
        };
        // RAII close
        let _close = scopeguard::guard(fd, |f| f.close());

        let basename = &new_path[last_slash + 1..];
        return move_opened_file_at(src_fd, fd, basename, replace_if_exists);
    }

    // easy mode
    move_opened_file_at(src_fd, new_dir_fd, without_leading_dot_slash, replace_if_exists)
}

/// Derived from std.os.windows.renameAtW
/// Allows more errors
pub fn rename_at_w(
    old_dir_fd: Fd,
    old_path_w: &[u16],
    new_dir_fd: Fd,
    new_path_w: &[u16],
    replace_if_exists: bool,
) -> bun_sys::Result<()> {
    let src_fd = 'brk: {
        match bun_sys::open_file_at_windows(
            old_dir_fd,
            old_path_w,
            bun_sys::OpenFileOptions {
                access_mask: win32::SYNCHRONIZE | win32::GENERIC_WRITE | win32::DELETE | win32::FILE_TRAVERSE,
                disposition: win32::FILE_OPEN,
                options: win32::FILE_SYNCHRONOUS_IO_NONALERT | win32::FILE_OPEN_REPARSE_POINT,
            },
        ) {
            bun_sys::Result::Err(_) => {
                // retry, wtihout FILE_TRAVERSE flag
                match bun_sys::open_file_at_windows(
                    old_dir_fd,
                    old_path_w,
                    bun_sys::OpenFileOptions {
                        access_mask: win32::SYNCHRONIZE | win32::GENERIC_WRITE | win32::DELETE,
                        disposition: win32::FILE_OPEN,
                        options: win32::FILE_SYNCHRONOUS_IO_NONALERT | win32::FILE_OPEN_REPARSE_POINT,
                    },
                ) {
                    bun_sys::Result::Err(err2) => return bun_sys::Result::Err(err2),
                    bun_sys::Result::Ok(fd) => break 'brk fd,
                }
            }
            bun_sys::Result::Ok(fd) => break 'brk fd,
        }
    };
    let _close = scopeguard::guard(src_fd, |f| f.close());

    move_opened_file_at(src_fd, new_dir_fd, new_path_w, replace_if_exists)
}

mod kernel32_2 {
    use super::*;
    // TODO(port): move to windows_sys
    unsafe extern "system" {
        pub fn GetEnvironmentStringsW() -> LPWSTR;
        pub fn FreeEnvironmentStringsW(penv: LPWSTR) -> BOOL;
        pub fn GetEnvironmentVariableW(lpName: LPCWSTR, lpBuffer: *mut WCHAR, nSize: DWORD) -> DWORD;
    }
}

pub type GetEnvironmentStringsError = bun_alloc::AllocError;

pub fn GetEnvironmentStringsW() -> Result<*mut u16, GetEnvironmentStringsError> {
    // SAFETY: returns owned env block or null
    let p = unsafe { kernel32_2::GetEnvironmentStringsW() };
    if p.is_null() {
        return Err(bun_alloc::AllocError);
    }
    Ok(p)
}

pub fn FreeEnvironmentStringsW(penv: *mut u16) {
    // SAFETY: penv from GetEnvironmentStringsW
    let rc = unsafe { kernel32_2::FreeEnvironmentStringsW(penv) };
    debug_assert!(rc != 0);
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum GetEnvironmentVariableError {
    #[error("EnvironmentVariableNotFound")]
    EnvironmentVariableNotFound,
    #[error("Unexpected")]
    Unexpected,
}

pub fn GetEnvironmentVariableW(lpName: LPWSTR, lpBuffer: *mut u16, nSize: DWORD) -> Result<DWORD, GetEnvironmentVariableError> {
    // SAFETY: caller provides valid buffer
    let rc = unsafe { kernel32_2::GetEnvironmentVariableW(lpName, lpBuffer, nSize) };

    if rc == 0 {
        match Win32Error::get() {
            Win32Error::ENVVAR_NOT_FOUND => return Err(GetEnvironmentVariableError::EnvironmentVariableNotFound),
            _ => return Err(GetEnvironmentVariableError::Unexpected),
        }
    }

    Ok(rc)
}

pub mod env;

bun_output::declare_scope!(windowsUserUniqueId, visible);

// SetFilePointerEx referenced via externs above
use bun_windows_sys::externs::SetFilePointerEx;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/windows/windows.zig (4108 lines)
//   confidence: medium
//   todos:      13
//   notes:      Win32Error is a non-exhaustive enum(u16) → newtype(u16) + assoc consts; many std.os.windows.* refs mapped to bun_windows_sys (Phase B must wire that crate); winSockErrorToZigError uses bun_core::Error::intern for tag-based errors; INPUT_RECORD/KEY_EVENT_RECORD inner unions hoisted to named #[repr(C)] union types; SetFilePointerEx imported from externs.
// ──────────────────────────────────────────────────────────────────────────
