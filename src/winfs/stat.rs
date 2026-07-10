#![cfg(windows)]

//! The Windows stat engine: `stat`/`lstat` over NUL-terminated wide paths and
//! `fstat` over HANDLEs, at libuv parity (`fs__stat_path` /
//! `fs__stat_handle` / `fs__stat_directory` / `fs__fstat_handle`).
//!
//! Stat is a triple-fallback chain, not one syscall: the Win11+ by-name fast
//! API, then handle-based NT queries, then parent-directory enumeration for
//! files that cannot be opened at all — all three feeding one normalizer
//! through one carrier struct (`FILE_STAT_BASIC_INFORMATION`), so fields like
//! `st_dev` cannot drift between paths. // quirk: FSMETA-01

use core::ffi::c_void;
use core::mem::size_of;
use core::ptr;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::borrow::Cow;

use bun_windows_sys::kernel32::{GetFileType, GetModuleHandleW};
use bun_windows_sys::ntdll::{
    NtQueryDirectoryFile, NtQueryInformationFile, NtQueryVolumeInformationFile,
};
use bun_windows_sys::{
    BOOL, CloseHandle, CreateFileW, DWORD, FILE_ALL_INFORMATION, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_READONLY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_DEVICE_CONSOLE,
    FILE_DEVICE_NAMED_PIPE, FILE_DEVICE_NULL, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_FS_DEVICE_INFORMATION, FILE_FS_VOLUME_INFORMATION,
    FILE_ID_FULL_DIR_INFORMATION, FILE_INFO_BY_NAME_CLASS, FILE_INFORMATION_CLASS,
    FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, FILE_STAT_BASIC_INFORMATION, FILE_TYPE_CHAR, FILE_TYPE_DISK, FILE_TYPE_PIPE,
    FS_INFORMATION_CLASS, FileStatBasicByNameInfo, GetConsoleMode, GetProcAddress, HANDLE,
    INVALID_HANDLE_VALUE, IO_STATUS_BLOCK, LPCWSTR, NT_ERROR, NT_SUCCESS, NTSTATUS, OPEN_EXISTING,
    ULONG, UNICODE_STRING, Win32Error,
};

use crate::fslnk::ReadlinkTarget;

/// `{ sec, nsec }` pair for the four stat timestamps (uv_timespec64_t shape).
#[repr(C)]
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct Timespec {
    pub sec: i64,
    pub nsec: i32,
}

/// uv_stat_t-shaped stat result. Field semantics per the `FSMETA` ledger:
/// `st_ctim` is NTFS ChangeTime (never CreationTime — that is `st_birthtim`),
/// `st_ino` is the 64-bit FileId (128-bit ReFS ids truncate), `st_blksize` is
/// a hardcoded 4096, `st_blocks` is `AllocationSize >> 9`, and
/// `st_uid`/`st_gid`/`st_rdev`/`st_flags`/`st_gen` are hard zeros on disk
/// files. // quirk: FSMETA-19, FSMETA-22, FSMETA-23, FSMETA-24, FSMETA-25
#[repr(C)]
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct WindowsStat {
    pub st_dev: u64,
    pub st_mode: u64,
    pub st_nlink: u64,
    pub st_uid: u64,
    pub st_gid: u64,
    pub st_rdev: u64,
    pub st_ino: u64,
    pub st_size: u64,
    pub st_blksize: u64,
    pub st_blocks: u64,
    pub st_flags: u64,
    pub st_gen: u64,
    pub st_atim: Timespec,
    pub st_mtim: Timespec,
    pub st_ctim: Timespec,
    pub st_birthtim: Timespec,
}

// CRT `_S_IF*` values (ucrt `sys/stat.h:110-116`); `S_IFLNK` is libuv's
// `include/uv/win.h:62` value (the CRT has none).
pub const S_IFMT: u64 = 0xF000;
pub const S_IFDIR: u64 = 0x4000;
pub const S_IFCHR: u64 = 0x2000;
pub const S_IFIFO: u64 = 0x1000;
pub const S_IFREG: u64 = 0x8000;
pub const S_IFLNK: u64 = 0xA000;
const S_IREAD: u64 = 0x0100;
const S_IWRITE: u64 = 0x0080;

// Owner bits replicated to group/other by shifts, exactly as libuv
// fs.c:1960-1964 builds them: 0o444 and 0o666.
const MODE_R_ALL: u64 = S_IREAD | (S_IREAD >> 3) | (S_IREAD >> 6);
const MODE_RW_ALL: u64 =
    (S_IREAD | S_IWRITE) | ((S_IREAD | S_IWRITE) >> 3) | ((S_IREAD | S_IWRITE) >> 6);

/// All three share modes so files can be deleted/renamed/reopened while
/// held open — the deliberate CRT deviation matching UNIX semantics.
/// // quirk: FSIO-01
pub(crate) const SHARE_ALL: ULONG = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;

pub(crate) const BACKSLASH: u16 = b'\\' as u16;
pub(crate) const FWDSLASH: u16 = b'/' as u16;
pub(crate) const COLON: u16 = b':' as u16;
pub(crate) const DOT: u16 = b'.' as u16;

// ───────────────────────────── public API ─────────────────────────────

/// stat(2): follows symlinks. `path` is a NUL-terminated wide (WTF-16)
/// string including the terminator — the only validation done here; path
/// shape (DOS, drive-relative, `\\?\`-namespaced, UNC) passes through to
/// `CreateFileW` verbatim.
pub fn stat_path(path: &[u16], out: &mut WindowsStat) -> Result<(), Win32Error> {
    stat_or_lstat(path, false, out)
}

/// lstat(2): stats the link itself. Same path contract as [`stat_path`].
/// On a non-symlink-class reparse point (cloud placeholders, dedup, HSM)
/// this degrades to plain stat. // quirk: FSMETA-15
pub fn lstat_path(path: &[u16], out: &mut WindowsStat) -> Result<(), Win32Error> {
    stat_or_lstat(path, true, out)
}

/// fstat(2) over a raw HANDLE. Dispatches on the handle type: disk files take
/// the full NT query path; console and pipe handles get synthesized stats
/// (`S_IFCHR`/`S_IFIFO`, `st_rdev = DeviceType << 16`, `st_ino` = the kernel
/// handle value — a libuv parity quirk); unknown handle types are
/// `ERROR_INVALID_HANDLE`. Sockets report `FILE_TYPE_PIPE` and therefore
/// masquerade as FIFOs. // quirk: FSMETA-27
///
/// # Safety
/// `handle` must be a valid kernel handle (or null/INVALID, which error
/// cleanly) owned by the caller for the duration of the call.
pub unsafe fn fstat_handle(handle: HANDLE, out: &mut WindowsStat) -> Result<(), Win32Error> {
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(Win32Error::INVALID_HANDLE);
    }
    match GetFileType(handle) {
        FILE_TYPE_CHAR => {
            let mut mode: DWORD = 0;
            // SAFETY: `mode` is an owned out-param; bad/non-console handles
            // return FALSE without UB.
            if unsafe { GetConsoleMode(handle, &raw mut mode) } != 0 {
                assign_statbuf_device(out, S_IFCHR, FILE_DEVICE_CONSOLE, handle);
                Ok(())
            } else {
                // Non-console char device (NUL, COM): the disk path, whose
                // FIRST query is the device-type probe, so NUL short-circuits
                // to the synthesized stat; other char devices typically fail
                // FileAllInformation and error out, matching libuv.
                // // quirk: FSMETA-28
                stat_handle(handle, out, false)
            }
        }
        FILE_TYPE_PIPE => {
            assign_statbuf_device(out, S_IFIFO, FILE_DEVICE_NAMED_PIPE, handle);
            Ok(())
        }
        FILE_TYPE_DISK => stat_handle(handle, out, false),
        _ => Err(Win32Error::INVALID_HANDLE),
    }
}

// ───────────────────────────── entry plumbing ─────────────────────────────

fn stat_or_lstat(path: &[u16], do_lstat: bool, out: &mut WindowsStat) -> Result<(), Win32Error> {
    let Some((&0, units)) = path.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!units.contains(&0), "interior NUL in wide path");
    let prepared = prepare_path(path);
    stat_impl(&prepared, do_lstat, out)
}

/// Strips exactly one trailing slash — unless the path is one unit long or
/// the slash follows `:` (preserving `C:\`). Makes `stat("file/")` succeed,
/// a deliberate POSIX deviation Node inherits; applies inside `\\?\` paths
/// too. // quirk: FSMETA-26
fn prepare_path(path: &[u16]) -> Cow<'_, [u16]> {
    let len = path.len() - 1; // sans NUL
    if len > 1
        && path[len - 2] != COLON
        && (path[len - 1] == BACKSLASH || path[len - 1] == FWDSLASH)
    {
        let mut owned = path[..len - 1].to_vec();
        owned.push(0);
        return Cow::Owned(owned);
    }
    Cow::Borrowed(path)
}

/// The full chain, with the lstat→stat retry: a reparse point whose tag is
/// not symlink-class must be re-opened WITHOUT `OPEN_REPARSE_POINT` so the
/// owning filter driver materializes the real file — never report the raw
/// stub's metadata. Bounded: the retry clears `do_lstat`. // quirk: FSMETA-15
fn stat_impl(path: &[u16], do_lstat: bool, out: &mut WindowsStat) -> Result<(), Win32Error> {
    let mut do_lstat = do_lstat;
    loop {
        match stat_impl_from_path(path, do_lstat, out) {
            Err(e)
                if do_lstat
                    && (e == Win32Error::SYMLINK_NOT_SUPPORTED
                        || e == Win32Error::NOT_A_REPARSE_POINT) =>
            {
                do_lstat = false;
            }
            other => return other,
        }
    }
}

/// Fast path → handle path → directory fallback. // quirk: FSMETA-01
fn stat_impl_from_path(
    path: &[u16],
    do_lstat: bool,
    out: &mut WindowsStat,
) -> Result<(), Win32Error> {
    match stat_path_fast(path, out, do_lstat) {
        FastPath::Success => return Ok(()),
        FastPath::Error(e) => return Err(e),
        FastPath::TrySlow => {}
    }

    // Exact open triple: FILE_READ_ATTRIBUTES (not GENERIC_READ) +
    // BACKUP_SEMANTICS (directories are unopenable without it) +
    // share-everything (minimizes sharing violations against files other
    // processes hold open). lstat adds OPEN_REPARSE_POINT to address the
    // link itself. // quirk: FSMETA-09
    let mut flags = FILE_FLAG_BACKUP_SEMANTICS;
    if do_lstat {
        flags |= FILE_FLAG_OPEN_REPARSE_POINT;
    }
    // SAFETY: `path` is NUL-terminated (entry contract, preserved by
    // `prepare_path`).
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            FILE_READ_ATTRIBUTES,
            SHARE_ALL,
            ptr::null_mut(),
            OPEN_EXISTING,
            flags,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        let e = Win32Error::get();
        if e != Win32Error::ACCESS_DENIED && e != Win32Error::SHARING_VIOLATION {
            return Err(e);
        }
        // Unopenable (pagefile.sys, deny-ACL): ask the parent directory.
        // // quirk: FSMETA-10
        return stat_directory(&path[..path.len() - 1], out, do_lstat, e);
    }
    let _guard = HandleGuard(handle);
    stat_handle(handle, out, do_lstat)
}

/// Owns a successfully opened HANDLE; closes on drop. By construction never
/// holds `INVALID_HANDLE_VALUE` (closing it aborts under Wine and debug
/// layers). // quirk: FSMETA-35
pub(crate) struct HandleGuard(pub(crate) HANDLE);
impl Drop for HandleGuard {
    fn drop(&mut self) {
        // SAFETY: constructed only from a successful open; closed exactly
        // once (the guard is never cloned).
        unsafe { CloseHandle(self.0) };
    }
}

// ───────────────────────────── fast path ─────────────────────────────

/// `GetFileInformationByName(FileName, FileInformationClass, FileInfoBuffer,
/// FileInfoBufferSize)` (winnt.h / libuv winapi.h:4807-4811).
type GetFileInformationByNameFn =
    unsafe extern "system" fn(LPCWSTR, FILE_INFO_BY_NAME_CLASS, *mut c_void, ULONG) -> BOOL;

/// `L"api-ms-win-core-file-l2-1-4.dll"` — the apiset hosting the fast API.
const APISET_FILE_L2_1_4: [u16; 32] = wide_lit("api-ms-win-core-file-l2-1-4.dll");

const fn wide_lit<const N: usize>(s: &str) -> [u16; N] {
    let bytes = s.as_bytes();
    assert!(bytes.len() + 1 == N);
    let mut out = [0u16; N];
    let mut i = 0;
    while i < bytes.len() {
        assert!(bytes[i].is_ascii());
        out[i] = bytes[i] as u16;
        i += 1;
    }
    out
}

const FAST_STAT_UNPROBED: usize = usize::MAX;
static FAST_STAT_PTR: AtomicUsize = AtomicUsize::new(FAST_STAT_UNPROBED);

/// One-time runtime probe for `GetFileInformationByName` (Win11 23H2+;
/// absent on Win10 → permanent slow path). `GetModuleHandleW` on the apiset,
/// deliberately NOT `LoadLibrary` — the apiset is resolved if present, so
/// there is no DLL-planting surface. // quirk: FSMETA-02
fn fast_stat_fn() -> Option<GetFileInformationByNameFn> {
    let mut p = FAST_STAT_PTR.load(Ordering::Relaxed);
    if p == FAST_STAT_UNPROBED {
        // SAFETY: both pointers are NUL-terminated string constants.
        let module = unsafe { GetModuleHandleW(APISET_FILE_L2_1_4.as_ptr()) };
        p = 0;
        if !module.is_null() {
            // SAFETY: `module` is a live module base; the name is a &CStr.
            p = unsafe { GetProcAddress(module, c"GetFileInformationByName".as_ptr()) } as usize;
        }
        // Racing probes store the same value; last write wins harmlessly.
        FAST_STAT_PTR.store(p, Ordering::Relaxed);
    }
    if p == 0 {
        None
    } else {
        // SAFETY: `p` is the export address GetProcAddress returned for this
        // exact documented signature (winnt.h `GetFileInformationByName`).
        Some(unsafe { core::mem::transmute::<usize, GetFileInformationByNameFn>(p) })
    }
}

enum FastPath {
    Success,
    Error(Win32Error),
    TrySlow,
}

/// By-name fast path: no handle open. // quirk: FSMETA-02
fn stat_path_fast(path: &[u16], out: &mut WindowsStat, do_lstat: bool) -> FastPath {
    let Some(fast) = fast_stat_fn() else {
        return FastPath::TrySlow;
    };
    let mut info = FILE_STAT_BASIC_INFORMATION::default();
    // SAFETY: `path` is NUL-terminated; `info` is an owned out-buffer of the
    // exact class size.
    let ok = unsafe {
        fast(
            path.as_ptr(),
            FileStatBasicByNameInfo,
            (&raw mut info).cast(),
            size_of::<FILE_STAT_BASIC_INFORMATION>() as ULONG,
        )
    };
    if ok == 0 {
        // Fail-fast allowlist; every OTHER failure (ACCESS_DENIED,
        // SHARING_VIOLATION, INVALID_NAME, future codes) degrades to the
        // slower-but-stronger chain. // quirk: FSMETA-03
        return match Win32Error::get() {
            e @ (Win32Error::FILE_NOT_FOUND
            | Win32Error::PATH_NOT_FOUND
            | Win32Error::NOT_READY
            | Win32Error::BAD_NET_NAME) => FastPath::Error(e),
            _ => FastPath::TrySlow,
        };
    }
    // A file handle is needed to get st_size for links — for both stat and
    // lstat; the carried ReparseTag is deliberately unused (libuv parity).
    // // quirk: FSMETA-04
    if info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return FastPath::TrySlow;
    }
    if info.DeviceType == FILE_DEVICE_NULL {
        assign_statbuf_null(out); // quirk: FSMETA-05
        return FastPath::Success;
    }
    assign_statbuf(out, &info, do_lstat);
    FastPath::Success
}

// ───────────────────────────── handle path ─────────────────────────────

/// Stat from an open handle via NT info classes — the only Win32-reachable
/// source of ChangeTime. // quirk: FSMETA-19
fn stat_handle(handle: HANDLE, out: &mut WindowsStat, do_lstat: bool) -> Result<(), Win32Error> {
    // Device type FIRST: the NUL device answers this but errors on the file
    // queries below. // quirk: FSMETA-05, FSMETA-28
    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    let mut device_info = FILE_FS_DEVICE_INFORMATION::default();
    // SAFETY: owned out-params of the exact class size.
    let nt = unsafe {
        NtQueryVolumeInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut device_info).cast(),
            size_of::<FILE_FS_DEVICE_INFORMATION>() as ULONG,
            FS_INFORMATION_CLASS::FileFsDeviceInformation,
        )
    };
    // NT_ERROR, not !NT_SUCCESS: warning statuses (STATUS_BUFFER_OVERFLOW)
    // mean every fixed-size member is valid. // quirk: FSMETA-06
    if NT_ERROR(nt) {
        return Err(Win32Error::from_ntstatus(nt));
    }
    if device_info.DeviceType == FILE_DEVICE_NULL {
        assign_statbuf_null(out);
        return Ok(());
    }

    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    let mut file_info = FILE_ALL_INFORMATION::default();
    // SAFETY: owned out-params of the exact class size.
    let nt = unsafe {
        NtQueryInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut file_info).cast(),
            size_of::<FILE_ALL_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileAllInformation,
        )
    };
    // STATUS_BUFFER_OVERFLOW is expected: the variable-length filename never
    // fits the fixed-size buffer. // quirk: FSMETA-06
    if NT_ERROR(nt) {
        return Err(Win32Error::from_ntstatus(nt));
    }

    // io_status is zero-initialized fresh: Wine returns error-severity
    // STATUS_NOT_IMPLEMENTED for this class but fills io_status.Status; real
    // Windows may not write io_status on failure, so a reused block would
    // hold the PREVIOUS call's value. // quirk: FSMETA-07
    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    let mut volume_info = FILE_FS_VOLUME_INFORMATION::default();
    // SAFETY: owned out-params of the exact class size.
    let nt = unsafe {
        NtQueryVolumeInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut volume_info).cast(),
            size_of::<FILE_FS_VOLUME_INFORMATION>() as ULONG,
            FS_INFORMATION_CLASS::FileFsVolumeInformation,
        )
    };
    let mut carrier = FILE_STAT_BASIC_INFORMATION::default();
    if io_status.Status as u32 == NTSTATUS::NOT_IMPLEMENTED.raw() {
        carrier.VolumeSerialNumber = 0; // quirk: FSMETA-07
    } else if NT_ERROR(nt) {
        return Err(Win32Error::from_ntstatus(nt));
    } else {
        carrier.VolumeSerialNumber = i64::from(volume_info.VolumeSerialNumber);
    }

    carrier.DeviceType = device_info.DeviceType;
    carrier.FileAttributes = file_info.BasicInformation.FileAttributes;
    carrier.NumberOfLinks = file_info.StandardInformation.NumberOfLinks;
    carrier.FileId = file_info.InternalInformation.IndexNumber; // quirk: FSMETA-22
    carrier.ChangeTime = file_info.BasicInformation.ChangeTime;
    carrier.CreationTime = file_info.BasicInformation.CreationTime;
    carrier.LastAccessTime = file_info.BasicInformation.LastAccessTime;
    carrier.LastWriteTime = file_info.BasicInformation.LastWriteTime;
    carrier.AllocationSize = file_info.StandardInformation.AllocationSize;

    if do_lstat && file_info.BasicInformation.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        // lstat st_size is the WTF-8 byte length of the readlink target;
        // EndOfFile from the file query is ignored for links. A non-link tag
        // errors here and `stat_impl` retries as plain stat.
        // // quirk: FSMETA-15, FSMETA-16
        carrier.EndOfFile = readlink_target_wtf8_len(handle)? as i64;
    } else {
        carrier.EndOfFile = file_info.StandardInformation.EndOfFile;
    }

    assign_statbuf(out, &carrier, do_lstat);
    Ok(())
}

// ───────────────────────────── readlink (length only) ─────────────────────

/// WTF-8 byte length of the target `readlink` would return for this reparse
/// handle — the lstat `st_size` contract (POSIX: `lstat.st_size ==
/// strlen(readlink())`, in the same WTF-8 encoding readlink uses).
/// Tag taxonomy is the ONE shared classifier in `fslnk` (drive-pattern
/// junctions and store aliases are symlink-class, `\??\Volume{guid}` mount
/// points and unknown tags are `ERROR_SYMLINK_NOT_SUPPORTED` so such entries
/// stat as plain directories via the lstat→stat retry); WSL `LX_SYMLINK`
/// targets count their raw stored bytes, no encoding conversion.
/// // quirk: FSMETA-15, FSMETA-16, FSMETA-17
fn readlink_target_wtf8_len(handle: HANDLE) -> Result<usize, Win32Error> {
    Ok(match crate::fslnk::readlink_by_handle(handle)? {
        ReadlinkTarget::Wide(units) => utf16_length_as_wtf8(&units),
        ReadlinkTarget::Bytes(bytes) => bytes.len(),
    })
}

/// Byte length of `units` re-encoded as WTF-8 (libuv
/// `uv_utf16_length_as_wtf8`): surrogate pairs take 4 bytes, unpaired
/// surrogates 3 — real Windows paths contain them. // quirk: FSMETA-16
pub(crate) fn utf16_length_as_wtf8(units: &[u16]) -> usize {
    let mut len = 0usize;
    let mut i = 0usize;
    while i < units.len() {
        let u = units[i];
        if (0xD800..=0xDBFF).contains(&u)
            && i + 1 < units.len()
            && (0xDC00..=0xDFFF).contains(&units[i + 1])
        {
            len += 4;
            i += 2;
            continue;
        }
        len += match u {
            0..=0x7F => 1,
            0x80..=0x7FF => 2,
            _ => 3,
        };
        i += 1;
    }
    len
}

// ───────────────────────────── directory fallback ─────────────────────────

/// Stat an unopenable file (pagefile.sys, deny-ACL'd) by asking its PARENT
/// directory: a single-entry `NtQueryDirectoryFile` with an exact-name mask
/// yields attributes, all four timestamps, sizes and the 64-bit FileId.
/// `path` excludes the NUL terminator; `ret_error` is the original open
/// failure, returned whenever the fallback cannot answer.
/// // quirk: FSMETA-10
fn stat_directory(
    path: &[u16],
    out: &mut WindowsStat,
    do_lstat: bool,
    ret_error: Win32Error,
) -> Result<(), Win32Error> {
    // Split off the trailing filename component. Deliberate fix over stock
    // libuv (which nulls the last separator in place): the parent KEEPS its
    // separator, so `\\?\C:\pagefile.sys` queries `\\?\C:\` (the root
    // directory) instead of `\\?\C:` (the volume device, where
    // NtQueryDirectoryFile fails INVALID_PARAMETER); and paths with no
    // filename component (roots, `C:`, dots-only, trailing-separator) fail
    // cleanly with the original error instead of reading `path[-1]` or
    // sending an empty FileMask (which would return the first directory
    // entry's metadata — the wrong file). // quirk: FSMETA-14
    let mut split = path.len();
    let mut includes_name = false;
    while split > 0 && !matches!(path[split - 1], BACKSLASH | FWDSLASH | COLON) {
        if path[split - 1] != DOT {
            includes_name = true;
        }
        split -= 1;
    }
    if !includes_name {
        return Err(ret_error);
    }
    let name = &path[split..];

    // The NT FileMask is a PATTERN: `*` `?` plus DOS-era `>` (DOS_QM),
    // `<` (DOS_STAR), `"` (DOS_DOT) glob-match; a literal occurrence in the
    // filename must fail rather than silently return some other matching
    // file's metadata. // quirk: FSMETA-11
    const WILDCARDS: [u16; 5] = [
        b'*' as u16,
        b'?' as u16,
        b'>' as u16,
        b'<' as u16,
        b'"' as u16,
    ];
    if name.iter().any(|c| WILDCARDS.contains(c)) {
        return Err(Win32Error::INVALID_NAME);
    }
    // UNICODE_STRING length is a USHORT byte count (libuv
    // uv__RtlUnicodeStringInit caps at 0x7FFF units → STATUS_INVALID_PARAMETER).
    if name.len() > 0x7FFF {
        return Err(Win32Error::from_ntstatus(NTSTATUS::INVALID_PARAMETER));
    }

    let parent: Vec<u16> = if split == 0 {
        // Bare relative filename: the parent is the current directory.
        vec![DOT, 0]
    } else {
        let mut v = Vec::with_capacity(split + 1);
        v.extend_from_slice(&path[..split]);
        v.push(0);
        v
    };
    // SAFETY: `parent` is NUL-terminated; share-everything + BACKUP_SEMANTICS
    // per the directory-open contract. // quirk: FSMETA-09
    let handle = unsafe {
        CreateFileW(
            parent.as_ptr(),
            FILE_LIST_DIRECTORY,
            SHARE_ALL,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    let _guard = HandleGuard(handle); // quirk: FSMETA-35

    let mut mask = UNICODE_STRING {
        Length: (name.len() * 2) as u16,
        MaximumLength: (name.len() * 2) as u16,
        Buffer: name.as_ptr().cast_mut(),
    };
    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    let mut dir_info = FILE_ID_FULL_DIR_INFORMATION::default();
    // SAFETY: single-entry query into an exactly fixed-size owned buffer; the
    // kernel only reads the mask.
    let nt = unsafe {
        NtQueryDirectoryFile(
            handle,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            &raw mut io_status,
            (&raw mut dir_info).cast(),
            size_of::<FILE_ID_FULL_DIR_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileIdFullDirectoryInformation,
            1, // ReturnSingleEntry
            &raw mut mask,
            1, // RestartScan
        )
    };
    // STATUS_BUFFER_OVERFLOW actually indicates success: there is no room for
    // the FileName tail, but every fixed member is valid. STATUS_NO_MORE_FILES
    // means the mask matched nothing. // quirk: FSMETA-12
    if !NT_SUCCESS(nt) && nt != NTSTATUS::BUFFER_OVERFLOW {
        if nt == NTSTATUS::NO_MORE_FILES {
            return Err(Win32Error::PATH_NOT_FOUND);
        }
        return Err(Win32Error::from_ntstatus(nt));
    }

    let mut carrier = FILE_STAT_BASIC_INFORMATION {
        FileAttributes: dir_info.FileAttributes,
        CreationTime: dir_info.CreationTime,
        LastAccessTime: dir_info.LastAccessTime,
        LastWriteTime: dir_info.LastWriteTime,
        ..Default::default()
    };
    if carrier.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        // Reading the link target needs exactly the handle we could not get:
        // plain stat gives up with the original error; lstat proceeds with
        // st_size = 0. // quirk: FSMETA-13
        if !do_lstat {
            return Err(ret_error);
        }
        carrier.EndOfFile = 0;
        carrier.AllocationSize = 0;
    } else {
        carrier.EndOfFile = dir_info.EndOfFile;
        carrier.AllocationSize = dir_info.AllocationSize;
    }
    carrier.ChangeTime = dir_info.ChangeTime;
    carrier.FileId = dir_info.FileId;

    // Volume serial + device type from the PARENT handle — files presumably
    // must live on their directory's device. io_status zero-init per the
    // Wine contract. // quirk: FSMETA-07
    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    let mut volume_info = FILE_FS_VOLUME_INFORMATION::default();
    // SAFETY: owned out-params of the exact class size.
    let nt = unsafe {
        NtQueryVolumeInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut volume_info).cast(),
            size_of::<FILE_FS_VOLUME_INFORMATION>() as ULONG,
            FS_INFORMATION_CLASS::FileFsVolumeInformation,
        )
    };
    if io_status.Status as u32 == NTSTATUS::NOT_IMPLEMENTED.raw() {
        carrier.VolumeSerialNumber = 0;
    } else if NT_ERROR(nt) {
        return Err(Win32Error::from_ntstatus(nt));
    } else {
        carrier.VolumeSerialNumber = i64::from(volume_info.VolumeSerialNumber);
    }

    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    let mut device_info = FILE_FS_DEVICE_INFORMATION::default();
    // SAFETY: owned out-params of the exact class size.
    let nt = unsafe {
        NtQueryVolumeInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut device_info).cast(),
            size_of::<FILE_FS_DEVICE_INFORMATION>() as ULONG,
            FS_INFORMATION_CLASS::FileFsDeviceInformation,
        )
    };
    if NT_ERROR(nt) {
        return Err(Win32Error::from_ntstatus(nt));
    }

    carrier.DeviceType = device_info.DeviceType;
    carrier.NumberOfLinks = 1; // No way to recover this here. // quirk: FSMETA-13

    assign_statbuf(out, &carrier, do_lstat);
    Ok(())
}

// ───────────────────────────── the one normalizer ─────────────────────────

/// Fully synthesized character-device stat for the NUL device (POSIX
/// programs stat /dev/null): `S_IFCHR | 0666`, `st_rdev = FILE_DEVICE_NULL
/// << 16`, blksize 4096, everything else zero. // quirk: FSMETA-05
fn assign_statbuf_null(out: &mut WindowsStat) {
    *out = WindowsStat::default();
    out.st_mode = S_IFCHR | MODE_RW_ALL;
    out.st_nlink = 1;
    out.st_blksize = 4096;
    out.st_rdev = u64::from(FILE_DEVICE_NULL) << 16;
}

/// Synthesized stat for console/pipe handles (no file queries answer for
/// them): zeroed except mode, nlink, `st_rdev = DeviceType << 16`, and
/// `st_ino` = the kernel handle value — kept for libuv/Node parity.
/// // quirk: FSMETA-27
fn assign_statbuf_device(out: &mut WindowsStat, mode: u64, device_type: DWORD, handle: HANDLE) {
    *out = WindowsStat::default();
    out.st_mode = mode;
    out.st_nlink = 1;
    out.st_rdev = u64::from(device_type) << 16;
    out.st_ino = handle as usize as u64;
}

/// The single normalizer all three stat paths feed (libuv
/// `fs__stat_assign_statbuf`).
fn assign_statbuf(out: &mut WindowsStat, carrier: &FILE_STAT_BASIC_INFORMATION, do_lstat: bool) {
    // Low 32 bits ONLY, on every path: the fast API's field is 64-bit on some
    // volumes, and mixing widths makes st_dev differ between a file statted
    // via the fast path and its symlink statted via the slow path (breaks
    // dev+ino same-file checks). // quirk: FSMETA-08
    out.st_dev = (carrier.VolumeSerialNumber as u64) & 0xFFFF_FFFF;

    out.st_mode = 0;
    // Reparse points are general-purpose; only symlink-class ones (already
    // vetted by the readlink step) reach here with do_lstat set, and report
    // S_IFLNK with st_size = target length. Otherwise reparse points stat as
    // regular files/directories.
    if do_lstat && carrier.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        out.st_mode |= S_IFLNK;
        out.st_size = carrier.EndOfFile as u64;
    }
    if out.st_mode == 0 {
        if carrier.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
            out.st_mode |= S_IFDIR;
            out.st_size = 0; // directories report size 0 // quirk: FSMETA-23
        } else {
            out.st_mode |= S_IFREG;
            out.st_size = carrier.EndOfFile as u64;
        }
    }
    // Permission bits solely from FILE_ATTRIBUTE_READONLY: 0444 / 0666,
    // never any execute bit (not even .exe or directories) — Node user code
    // string-matches these octals. // quirk: FSMETA-18
    if carrier.FileAttributes & FILE_ATTRIBUTE_READONLY != 0 {
        out.st_mode |= MODE_R_ALL;
    } else {
        out.st_mode |= MODE_RW_ALL;
    }

    // ctim ← ChangeTime (the NT-only timestamp), birthtim ← CreationTime;
    // never swap them. // quirk: FSMETA-19
    out.st_atim = filetime_to_timespec(carrier.LastAccessTime);
    out.st_ctim = filetime_to_timespec(carrier.ChangeTime);
    out.st_mtim = filetime_to_timespec(carrier.LastWriteTime);
    out.st_birthtim = filetime_to_timespec(carrier.CreationTime);

    out.st_ino = carrier.FileId as u64; // quirk: FSMETA-22
    // On-disk allocation in 512-byte units (0 for MFT-resident files).
    out.st_blocks = (carrier.AllocationSize as u64) >> 9; // quirk: FSMETA-23
    out.st_nlink = u64::from(carrier.NumberOfLinks);
    // Hardcoded Advanced-Format-safe value; querying the real one would cost
    // a syscall per stat. // quirk: FSMETA-24
    out.st_blksize = 4096;
    // Windows has nothing sensible to say about these. // quirk: FSMETA-25
    out.st_flags = 0;
    out.st_gid = 0;
    out.st_uid = 0;
    out.st_rdev = 0;
    out.st_gen = 0;
}

// ───────────────────────────── time conversion ────────────────────────────

const NSEC_PER_TICK: i64 = 100;
const TICKS_PER_SEC: i64 = 1_000_000_000 / NSEC_PER_TICK;
pub(crate) const WIN_TO_UNIX_TICK_OFFSET: i64 = 11_644_473_600 * TICKS_PER_SEC;

/// FILETIME (100ns ticks since 1601-01-01 UTC) → Unix timespec. All math in
/// signed 64-bit tick space (32-bit intermediates overflow for any modern
/// date), then a borrow normalizes the negative remainder pre-1970 values
/// produce under truncating division. // quirk: FSMETA-20, FSMETA-21
fn filetime_to_timespec(filetime: i64) -> Timespec {
    // wrapping_sub: the only overflow is a hostile filesystem reporting a
    // FILETIME below i64::MIN + offset — wrap rather than debug-panic.
    let ticks = filetime.wrapping_sub(WIN_TO_UNIX_TICK_OFFSET);
    let mut sec = ticks / TICKS_PER_SEC;
    let mut nsec = (ticks % TICKS_PER_SEC) * NSEC_PER_TICK;
    if nsec < 0 {
        sec -= 1;
        nsec += 1_000_000_000;
    }
    Timespec {
        sec,
        nsec: nsec as i32,
    }
}

// ───────────────────────────── tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicU32;
    use std::time::{SystemTime, UNIX_EPOCH};

    use bun_windows_sys::kernel32::{
        CreateNamedPipeW, DeviceIoControl, GetVolumeNameForVolumeMountPointW, RemoveDirectoryW,
        WriteFile,
    };
    use bun_windows_sys::{
        CREATE_ALWAYS, CreateDirectoryW, CreateSymbolicLinkW, DeleteFileW, FILE_ATTRIBUTE_NORMAL,
        FSCTL_SET_REPARSE_POINT, GENERIC_READ, GENERIC_WRITE, IO_REPARSE_TAG_APPEXECLINK,
        IO_REPARSE_TAG_LX_SYMLINK, IO_REPARSE_TAG_MOUNT_POINT, PIPE_ACCESS_DUPLEX,
        PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT,
        SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE, SetFileAttributesW,
    };

    use super::*;

    fn wide(p: &Path) -> Vec<u16> {
        p.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn wide_str(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn stat(path: &Path) -> Result<WindowsStat, Win32Error> {
        let mut st = WindowsStat::default();
        stat_path(&wide(path), &mut st).map(|()| st)
    }

    fn lstat(path: &Path) -> Result<WindowsStat, Win32Error> {
        let mut st = WindowsStat::default();
        lstat_path(&wide(path), &mut st).map(|()| st)
    }

    /// Per-test unique temp dir; entries removed in reverse creation order.
    struct Fixture {
        root: PathBuf,
        entries: Vec<(PathBuf, bool)>,
    }

    impl Fixture {
        fn new(tag: &str) -> Fixture {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let root = std::env::temp_dir().join(format!(
                "bun_winfs_{tag}_{}_{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            let w = wide(&root);
            // SAFETY: NUL-terminated path; null security attributes.
            let ok = unsafe { CreateDirectoryW(w.as_ptr(), ptr::null_mut()) };
            assert!(
                ok != 0,
                "CreateDirectoryW({root:?}): {:?}",
                Win32Error::get()
            );
            Fixture {
                root,
                entries: Vec::new(),
            }
        }

        fn file(&mut self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join(name);
            let w = wide(&path);
            // SAFETY: NUL-terminated path; create-or-truncate for writing.
            let handle = unsafe {
                CreateFileW(
                    w.as_ptr(),
                    GENERIC_WRITE,
                    0,
                    ptr::null_mut(),
                    CREATE_ALWAYS,
                    FILE_ATTRIBUTE_NORMAL,
                    ptr::null_mut(),
                )
            };
            assert!(
                handle != INVALID_HANDLE_VALUE,
                "create {path:?}: {:?}",
                Win32Error::get()
            );
            let guard = HandleGuard(handle);
            if !contents.is_empty() {
                let mut written: DWORD = 0;
                // SAFETY: buffer/len pair is the owned slice; null overlapped
                // on a synchronous handle.
                let ok = unsafe {
                    WriteFile(
                        handle,
                        contents.as_ptr(),
                        contents.len() as DWORD,
                        &raw mut written,
                        ptr::null_mut(),
                    )
                };
                assert!(ok != 0 && written as usize == contents.len());
            }
            drop(guard);
            self.entries.push((path.clone(), false));
            path
        }

        fn dir(&mut self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            let w = wide(&path);
            // SAFETY: NUL-terminated path.
            let ok = unsafe { CreateDirectoryW(w.as_ptr(), ptr::null_mut()) };
            assert!(
                ok != 0,
                "CreateDirectoryW({path:?}): {:?}",
                Win32Error::get()
            );
            self.entries.push((path.clone(), true));
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            for (path, is_dir) in self.entries.iter().rev() {
                let w = wide(path);
                // SAFETY: NUL-terminated paths; best-effort cleanup.
                unsafe {
                    // Clear READONLY so deletion cannot fail on attr fixtures.
                    SetFileAttributesW(w.as_ptr(), FILE_ATTRIBUTE_NORMAL);
                    if *is_dir {
                        RemoveDirectoryW(w.as_ptr());
                    } else {
                        DeleteFileW(w.as_ptr());
                    }
                }
            }
            let w = wide(&self.root);
            // SAFETY: NUL-terminated path; best-effort cleanup.
            unsafe { RemoveDirectoryW(w.as_ptr()) };
        }
    }

    // ── pure KATs ──

    /// // quirk: FSMETA-20, FSMETA-21
    #[test]
    fn filetime_to_timespec_kats() {
        // Unix epoch exactly.
        assert_eq!(
            filetime_to_timespec(WIN_TO_UNIX_TICK_OFFSET),
            Timespec { sec: 0, nsec: 0 }
        );
        // FILETIME zero = 1601-01-01, exactly -11644473600s.
        assert_eq!(
            filetime_to_timespec(0),
            Timespec {
                sec: -11_644_473_600,
                nsec: 0
            }
        );
        // Epoch + 1.5s.
        assert_eq!(
            filetime_to_timespec(WIN_TO_UNIX_TICK_OFFSET + 15_000_000),
            Timespec {
                sec: 1,
                nsec: 500_000_000
            }
        );
        // One tick before the epoch: borrow normalizes the negative remainder.
        assert_eq!(
            filetime_to_timespec(WIN_TO_UNIX_TICK_OFFSET - 1),
            Timespec {
                sec: -1,
                nsec: 999_999_900
            }
        );
        // Fractional ticks survive at 100ns granularity.
        assert_eq!(
            filetime_to_timespec(WIN_TO_UNIX_TICK_OFFSET + 1_234_567),
            Timespec {
                sec: 0,
                nsec: 123_456_700
            }
        );
        // A modern date in 64-bit tick space (would overflow 32-bit math).
        assert_eq!(
            filetime_to_timespec(133_500_000_000_000_000),
            Timespec {
                sec: 1_705_526_400,
                nsec: 0
            }
        );
    }

    /// // quirk: FSMETA-16
    #[test]
    fn utf16_wtf8_length_kats() {
        assert_eq!(utf16_length_as_wtf8(&[]), 0);
        assert_eq!(utf16_length_as_wtf8(&wide_str("abc")[..3]), 3);
        // 2-byte: U+00E9 é. 3-byte: U+4E2D 中.
        assert_eq!(utf16_length_as_wtf8(&[0x00E9]), 2);
        assert_eq!(utf16_length_as_wtf8(&[0x4E2D]), 3);
        // Surrogate pair U+1D11E (𝄞) → 4 bytes, consuming both units.
        assert_eq!(utf16_length_as_wtf8(&[0xD834, 0xDD1E]), 4);
        // Unpaired surrogates → 3 bytes each (WTF-8, not UTF-8).
        assert_eq!(utf16_length_as_wtf8(&[0xD800]), 3);
        assert_eq!(utf16_length_as_wtf8(&[0xDC00, 0xD800]), 6);
        // Mixed: "a" + pair + lone high surrogate + "é".
        assert_eq!(
            utf16_length_as_wtf8(&[0x61, 0xD834, 0xDD1E, 0xD800, 0x00E9]),
            10
        );
    }

    /// The normalizer's full mode/field table against crafted carriers.
    /// // quirk: FSMETA-18, FSMETA-19, FSMETA-22, FSMETA-23, FSMETA-24, FSMETA-25
    #[test]
    fn mode_synthesis_table() {
        let mut carrier = FILE_STAT_BASIC_INFORMATION::default();
        carrier.FileAttributes = 0; // regular, writable
        carrier.EndOfFile = 1234;
        carrier.AllocationSize = 4096;
        carrier.NumberOfLinks = 2;
        carrier.FileId = 0x1122_3344_5566_7788;
        carrier.VolumeSerialNumber = 0x0000_0001_2345_6789; // 64-bit serial
        carrier.LastAccessTime = WIN_TO_UNIX_TICK_OFFSET + 10_000_000;
        carrier.LastWriteTime = WIN_TO_UNIX_TICK_OFFSET + 20_000_000;
        carrier.ChangeTime = WIN_TO_UNIX_TICK_OFFSET + 30_000_000;
        carrier.CreationTime = WIN_TO_UNIX_TICK_OFFSET + 40_000_000;

        let mut st = WindowsStat::default();
        assign_statbuf(&mut st, &carrier, false);
        assert_eq!(st.st_mode, S_IFREG | 0o666);
        assert_eq!(st.st_size, 1234);
        assert_eq!(st.st_blocks, 8); // 4096 >> 9
        assert_eq!(st.st_nlink, 2);
        assert_eq!(st.st_blksize, 4096);
        assert_eq!(st.st_ino, 0x1122_3344_5566_7788);
        // st_dev reads the LOW 32 bits only.
        assert_eq!(st.st_dev, 0x2345_6789);
        // atim/mtim/ctim/birthtim: ctim is ChangeTime, birthtim CreationTime.
        assert_eq!(st.st_atim.sec, 1);
        assert_eq!(st.st_mtim.sec, 2);
        assert_eq!(st.st_ctim.sec, 3);
        assert_eq!(st.st_birthtim.sec, 4);
        assert_eq!(
            (st.st_uid, st.st_gid, st.st_rdev, st.st_flags, st.st_gen),
            (0, 0, 0, 0, 0)
        );

        // READONLY → 0444 (no execute bits, ever).
        carrier.FileAttributes = FILE_ATTRIBUTE_READONLY;
        assign_statbuf(&mut st, &carrier, false);
        assert_eq!(st.st_mode, S_IFREG | 0o444);

        // Directory: size forced to 0 even though the carrier had an EOF.
        carrier.FileAttributes = FILE_ATTRIBUTE_DIRECTORY;
        assign_statbuf(&mut st, &carrier, false);
        assert_eq!(st.st_mode, S_IFDIR | 0o666);
        assert_eq!(st.st_size, 0);

        // lstat of a symlink-class reparse point: S_IFLNK, size = target len.
        carrier.FileAttributes = FILE_ATTRIBUTE_REPARSE_POINT;
        carrier.EndOfFile = 17;
        assign_statbuf(&mut st, &carrier, true);
        assert_eq!(st.st_mode, S_IFLNK | 0o666);
        assert_eq!(st.st_size, 17);

        // Plain stat of a materialized file that kept its reparse attribute
        // (hydrated cloud placeholder): regular file, real size.
        assign_statbuf(&mut st, &carrier, false);
        assert_eq!(st.st_mode, S_IFREG | 0o666);
        assert_eq!(st.st_size, 17);
    }

    #[test]
    fn prepare_path_strips_one_trailing_slash_only() {
        // quirk: FSMETA-26
        let check = |input: &str, expect: &str| {
            let w = wide_str(input);
            let got = prepare_path(&w);
            assert_eq!(got.as_ref(), wide_str(expect).as_slice(), "input {input:?}");
        };
        check("a\\", "a");
        check("a/", "a");
        check("a\\\\", "a\\"); // exactly one strip
        check("C:\\", "C:\\"); // ':' guard keeps drive roots intact
        check("\\", "\\"); // len 1 untouched
        check("dir\\file", "dir\\file");
    }

    // ── real-filesystem fixtures ──

    #[test]
    fn regular_file_stat_matches_fstat() {
        let mut fx = Fixture::new("reg");
        let path = fx.file("plain.txt", b"hello");

        let st = stat(&path).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFREG);
        assert_eq!(st.st_size, 5);
        assert!(st.st_ino != 0, "NTFS FileId must be nonzero");
        assert_eq!(st.st_nlink, 1);
        assert_eq!(st.st_blksize, 4096);
        assert_eq!((st.st_uid, st.st_gid, st.st_rdev), (0, 0, 0));

        // mtime within sanity bounds of now (file was just written).
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(
            (now - st.st_mtim.sec).abs() < 300,
            "mtime {} vs now {now}",
            st.st_mtim.sec
        );

        // fstat of an open handle agrees on identity (dev, ino, size).
        let w = wide(&path);
        // SAFETY: NUL-terminated path, read-only share-all open.
        let handle = unsafe {
            CreateFileW(
                w.as_ptr(),
                GENERIC_READ,
                SHARE_ALL,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        assert!(handle != INVALID_HANDLE_VALUE);
        let _guard = HandleGuard(handle);
        let mut fst = WindowsStat::default();
        // SAFETY: handle is a live test fixture handle.
        unsafe { fstat_handle(handle, &mut fst) }.unwrap();
        assert_eq!(fst.st_dev, st.st_dev, "st_dev must agree between paths");
        assert_eq!(fst.st_ino, st.st_ino);
        assert_eq!(fst.st_size, st.st_size);
        assert_eq!(fst.st_mode, st.st_mode);
    }

    #[test]
    fn directory_stat_mode_and_size() {
        let mut fx = Fixture::new("dir");
        let dir = fx.dir("sub");
        let st = stat(&dir).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFDIR);
        assert_eq!(st.st_size, 0); // quirk: FSMETA-23
        // Same volume as a file beside it.
        let f = fx.file("f.txt", b"x");
        assert_eq!(stat(&f).unwrap().st_dev, st.st_dev);
    }

    #[test]
    fn readonly_attribute_synthesizes_0444() {
        let mut fx = Fixture::new("ro");
        let path = fx.file("ro.txt", b"r");
        let w = wide(&path);
        // SAFETY: NUL-terminated path.
        assert!(unsafe { SetFileAttributesW(w.as_ptr(), FILE_ATTRIBUTE_READONLY) } != 0);
        let st = stat(&path).unwrap();
        assert_eq!(st.st_mode, S_IFREG | 0o444); // quirk: FSMETA-18
    }

    #[test]
    fn trailing_slash_stripped_for_files_kept_for_drive_root() {
        let mut fx = Fixture::new("slash");
        let path = fx.file("f.txt", b"abc");
        // stat("file\") and stat("file/") succeed — the POSIX deviation.
        for sep in ["\\", "/"] {
            let mut s = path.as_os_str().to_os_string();
            s.push(sep);
            let mut st = WindowsStat::default();
            stat_path(&wide_str(s.to_str().unwrap()), &mut st)
                .unwrap_or_else(|e| panic!("stat(file{sep}) failed: {e:?}"));
            assert_eq!(st.st_size, 3);
        }
        // Drive root keeps its slash and stats as a directory (FSMETA-14:
        // must not EINVAL / ERROR_INVALID_PARAMETER).
        let mut st = WindowsStat::default();
        stat_path(&wide_str("C:\\"), &mut st).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFDIR);
    }

    #[test]
    fn nul_device_synthesized_char_stat() {
        // quirk: FSMETA-05
        for name in ["NUL", "\\\\.\\NUL"] {
            let mut st = WindowsStat::default();
            stat_path(&wide_str(name), &mut st).unwrap_or_else(|e| panic!("stat({name}): {e:?}"));
            assert_eq!(st.st_mode, S_IFCHR | 0o666, "{name}");
            assert_eq!(st.st_rdev, u64::from(FILE_DEVICE_NULL) << 16, "{name}");
            assert_eq!(st.st_blksize, 4096, "{name}");
            assert_eq!(st.st_nlink, 1, "{name}");
            assert_eq!(st.st_size, 0, "{name}");
        }
        // fstat of an open NUL handle takes the char-device-but-not-console
        // route through the device-type probe. // quirk: FSMETA-28
        let w = wide_str("NUL");
        // SAFETY: NUL-terminated path.
        let handle = unsafe {
            CreateFileW(
                w.as_ptr(),
                GENERIC_READ,
                SHARE_ALL,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        assert!(handle != INVALID_HANDLE_VALUE);
        let _guard = HandleGuard(handle);
        let mut st = WindowsStat::default();
        // SAFETY: handle is a live test fixture handle.
        unsafe { fstat_handle(handle, &mut st) }.unwrap();
        assert_eq!(st.st_mode, S_IFCHR | 0o666);
        assert_eq!(st.st_rdev, u64::from(FILE_DEVICE_NULL) << 16);
    }

    /// The headline: a file locked with share mode 0 must still stat, with
    /// the correct size. // quirk: FSMETA-10
    #[test]
    fn locked_share0_file_stats_with_correct_size() {
        let mut fx = Fixture::new("locked");
        let path = fx.file("locked.bin", b"7 bytes");
        let w = wide(&path);
        // Hold the file open with share mode 0 (deny everything).
        // SAFETY: NUL-terminated path.
        let lock = unsafe {
            CreateFileW(
                w.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        assert!(lock != INVALID_HANDLE_VALUE);
        let _guard = HandleGuard(lock);

        // Through the public chain (whichever route Windows allows).
        let st = stat(&path).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFREG);
        assert_eq!(st.st_size, 7);

        // And through the parent-directory fallback DIRECTLY — the route a
        // kernel-held file (pagefile.sys) takes; correct size, ino, dev, and
        // the documented nlink lie. // quirk: FSMETA-13
        let units = wide(&path);
        let mut fst = WindowsStat::default();
        stat_directory(
            &units[..units.len() - 1],
            &mut fst,
            false,
            Win32Error::SHARING_VIOLATION,
        )
        .unwrap();
        assert_eq!(fst.st_size, 7);
        assert_eq!(fst.st_mode & S_IFMT, S_IFREG);
        assert_eq!(fst.st_ino, st.st_ino);
        assert_eq!(fst.st_dev, st.st_dev);
        assert_eq!(fst.st_nlink, 1);
        assert!(fst.st_mtim.sec != 0);
    }

    /// Literal wildcard characters in the filename must be rejected, never
    /// pattern-matched against other files. // quirk: FSMETA-11
    #[test]
    fn directory_fallback_rejects_wildcards() {
        let mut fx = Fixture::new("wild");
        // A real file the patterns WOULD match if globbing were allowed.
        fx.file("victim.txt", b"victim!");

        for probe in ["*", "victim?txt", "v*", "<", "\"x\""] {
            let path = fx.root.join(probe);
            let units = wide(&path);
            let mut st = WindowsStat::default();
            let err = stat_directory(
                &units[..units.len() - 1],
                &mut st,
                false,
                Win32Error::ACCESS_DENIED,
            )
            .unwrap_err();
            assert_eq!(err, Win32Error::INVALID_NAME, "probe {probe:?}");
        }

        // Control: the exact literal name resolves fine.
        let path = fx.root.join("victim.txt");
        let units = wide(&path);
        let mut st = WindowsStat::default();
        stat_directory(
            &units[..units.len() - 1],
            &mut st,
            false,
            Win32Error::ACCESS_DENIED,
        )
        .unwrap();
        assert_eq!(st.st_size, 7);
    }

    /// Root-path / no-filename shapes fail cleanly with the ORIGINAL error —
    /// no `path[-1]` read, no empty mask, no wrong-file metadata, and
    /// crucially no EINVAL for root-level files. // quirk: FSMETA-14
    #[test]
    fn directory_fallback_root_and_dots_fail_cleanly() {
        let orig = Win32Error::SHARING_VIOLATION;
        for shape in ["C:\\", "\\\\?\\C:\\", "C:", "..", ".", ".\\.", "dir\\"] {
            let units = wide_str(shape);
            let mut st = WindowsStat::default();
            let err = stat_directory(&units[..units.len() - 1], &mut st, false, orig).unwrap_err();
            assert_eq!(
                err, orig,
                "shape {shape:?} must propagate the original error"
            );
        }
        // End-to-end root-path shape: stat("C:\") itself must succeed.
        let mut st = WindowsStat::default();
        stat_path(&wide_str("C:\\"), &mut st).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFDIR);

        // The genuine article, when this machine has one: a kernel-locked
        // root-level file — the exact case stock libuv returns EINVAL for.
        let pagefile = wide_str("C:\\pagefile.sys");
        let mut st = WindowsStat::default();
        match stat_path(&pagefile, &mut st) {
            Ok(()) => {
                assert_eq!(st.st_mode & S_IFMT, S_IFREG);
                assert!(st.st_size > 0, "pagefile reports a real size");
            }
            Err(Win32Error::FILE_NOT_FOUND) => {
                eprintln!("skip: no C:\\pagefile.sys on this machine");
            }
            Err(e) => panic!("stat(C:\\pagefile.sys) must not fail with {e:?}"),
        }
    }

    /// Bare relative names resolve against `.` in the fallback.
    #[test]
    fn directory_fallback_bare_relative_name() {
        let mut fx = Fixture::new("rel");
        let path = fx.file("bare_rel_probe.txt", b"abcd");
        let prev = std::env::current_dir().unwrap();
        std::env::set_current_dir(&fx.root).unwrap();
        let units = wide_str("bare_rel_probe.txt");
        let mut st = WindowsStat::default();
        let result = stat_directory(
            &units[..units.len() - 1],
            &mut st,
            false,
            Win32Error::ACCESS_DENIED,
        );
        std::env::set_current_dir(prev).unwrap();
        result.unwrap();
        assert_eq!(st.st_size, 4);
        assert_eq!(st.st_ino, stat(&path).unwrap().st_ino);
    }

    #[test]
    fn relative_dot_paths_stat_as_directories() {
        for p in [".", ".."] {
            let mut st = WindowsStat::default();
            stat_path(&wide_str(p), &mut st).unwrap_or_else(|e| panic!("stat({p}): {e:?}"));
            assert_eq!(st.st_mode & S_IFMT, S_IFDIR, "{p}");
        }
    }

    /// // quirk: FSMETA-15, FSMETA-16, FSMETA-17
    #[test]
    fn lstat_symlink_reports_link_and_target_length() {
        let mut fx = Fixture::new("sym");
        // Non-ASCII so WTF-8 length ≠ UTF-16 unit count.
        let target_name = "winfs_tärget.txt";
        let target = fx.file(target_name, b"contents8");
        let link = fx.root.join("link.txt");
        let wl = wide(&link);
        let wt = wide_str(target_name); // relative target, stored verbatim
        // SAFETY: NUL-terminated paths.
        let ok = unsafe {
            CreateSymbolicLinkW(
                wl.as_ptr(),
                wt.as_ptr(),
                SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE,
            )
        };
        if ok == 0 {
            let e = Win32Error::get();
            if e == Win32Error::PRIVILEGE_NOT_HELD || e == Win32Error::INVALID_PARAMETER {
                eprintln!("skip: CreateSymbolicLinkW unavailable ({e:?}) — enable Developer Mode");
                return;
            }
            panic!("CreateSymbolicLinkW: {e:?}");
        }
        fx.entries.push((link.clone(), false));

        let lst = lstat(&link).unwrap();
        assert_eq!(lst.st_mode & S_IFMT, S_IFLNK);
        // st_size == WTF-8 byte length of the target: 16 UTF-16 units, 17
        // bytes ('ä' is 2). POSIX: lstat.size == readlink().len().
        assert_eq!(lst.st_size, 17);

        // stat() follows to the file.
        let st = stat(&link).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFREG);
        assert_eq!(st.st_size, 9);
        assert_eq!(st.st_ino, stat(&target).unwrap().st_ino);
        assert!(st.st_ino != lst.st_ino, "link has its own FileId");
        assert_eq!(
            st.st_dev, lst.st_dev,
            "st_dev consistent across fast/slow paths"
        );

        // Absolute symlink: stored as \??\C:\... — lstat strips the NT prefix
        // for the length, matching what readlink returns.
        let abs_link = fx.root.join("abs_link.txt");
        let wal = wide(&abs_link);
        let wabs = wide(&target);
        // SAFETY: NUL-terminated paths.
        let ok = unsafe {
            CreateSymbolicLinkW(
                wal.as_ptr(),
                wabs.as_ptr(),
                SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE,
            )
        };
        assert!(ok != 0, "abs CreateSymbolicLinkW: {:?}", Win32Error::get());
        fx.entries.push((abs_link.clone(), false));
        let lst = lstat(&abs_link).unwrap();
        assert_eq!(lst.st_mode & S_IFMT, S_IFLNK);
        let expect = utf16_length_as_wtf8(&wabs[..wabs.len() - 1]);
        assert_eq!(lst.st_size as usize, expect);
    }

    /// Builds a mount-point (junction) reparse buffer: header + substitute +
    /// print names. Junctions need no privilege, so this arm always runs.
    fn set_junction(dir: &Path, substitute: &[u16], print: &[u16]) -> Result<(), Win32Error> {
        let w = wide(dir);
        // SAFETY: NUL-terminated path; opening the junction stub itself.
        let handle = unsafe {
            CreateFileW(
                w.as_ptr(),
                GENERIC_WRITE,
                SHARE_ALL,
                ptr::null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::get());
        }
        let _guard = HandleGuard(handle);

        let sub_bytes = substitute.len() * 2;
        let print_bytes = print.len() * 2;
        // MOUNT_POINT payload: 4 u16 offsets/lengths + both names, each
        // NUL-terminated inside PathBuffer.
        let data_len = 8 + sub_bytes + 2 + print_bytes + 2;
        let mut blob: Vec<u16> = Vec::new();
        blob.push(IO_REPARSE_TAG_MOUNT_POINT as u16);
        blob.push((IO_REPARSE_TAG_MOUNT_POINT >> 16) as u16);
        blob.push(data_len as u16); // ReparseDataLength
        blob.push(0); // Reserved
        blob.push(0); // SubstituteNameOffset
        blob.push(sub_bytes as u16); // SubstituteNameLength
        blob.push((sub_bytes + 2) as u16); // PrintNameOffset
        blob.push(print_bytes as u16); // PrintNameLength
        blob.extend_from_slice(substitute);
        blob.push(0);
        blob.extend_from_slice(print);
        blob.push(0);

        let mut bytes: DWORD = 0;
        // SAFETY: in-buffer is the owned blob; ioctl writes nothing back.
        let ok = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_SET_REPARSE_POINT,
                blob.as_mut_ptr().cast(),
                (blob.len() * 2) as DWORD,
                ptr::null_mut(),
                0,
                &raw mut bytes,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    }

    /// Drive-pattern junction: symlink-class, so lstat reports S_IFLNK with
    /// the target length and stat follows it. // quirk: FSMETA-17
    #[test]
    fn lstat_junction_drive_pattern_is_symlink() {
        let mut fx = Fixture::new("junc");
        let target_dir = fx.dir("target_dir");
        fx.file("target_dir\\inside.txt", b"in");
        let junction = fx.dir("junction");

        let target_abs: Vec<u16> = target_dir.as_os_str().encode_wide().collect();
        let mut substitute = wide_str("\\??\\");
        substitute.pop(); // drop NUL
        substitute.extend_from_slice(&target_abs);
        if let Err(e) = set_junction(&junction, &substitute, &target_abs) {
            eprintln!("skip: FSCTL_SET_REPARSE_POINT failed ({e:?}) on this filesystem");
            return;
        }

        let lst = lstat(&junction).unwrap();
        assert_eq!(lst.st_mode & S_IFMT, S_IFLNK);
        // Target length: the \??\ prefix is stripped (drive pattern).
        assert_eq!(lst.st_size as usize, utf16_length_as_wtf8(&target_abs));

        let st = stat(&junction).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFDIR);
        assert_eq!(st.st_ino, stat(&target_dir).unwrap().st_ino);
    }

    /// Volume-GUID junction: NOT symlink-class; lstat must degrade to plain
    /// stat via the impl-level retry and report a directory.
    /// // quirk: FSMETA-15, FSMETA-17
    #[test]
    fn lstat_volume_guid_junction_retries_as_stat() {
        let mut fx = Fixture::new("volj");
        let junction = fx.dir("voljunction");

        let mut volume = [0u16; 64];
        let root = wide_str("C:\\");
        // SAFETY: NUL-terminated mount point; owned out-buffer.
        let ok =
            unsafe { GetVolumeNameForVolumeMountPointW(root.as_ptr(), volume.as_mut_ptr(), 64) };
        if ok == 0 {
            eprintln!(
                "skip: GetVolumeNameForVolumeMountPointW failed: {:?}",
                Win32Error::get()
            );
            return;
        }
        // "\\?\Volume{guid}\" → "\??\Volume{guid}\".
        let len = volume.iter().position(|&c| c == 0).unwrap();
        let mut substitute = volume[..len].to_vec();
        substitute[1] = b'?' as u16;

        if let Err(e) = set_junction(&junction, &substitute, &[]) {
            eprintln!("skip: FSCTL_SET_REPARSE_POINT failed ({e:?}) on this filesystem");
            return;
        }

        // lstat: readlink rejects the Volume{guid} target
        // (ERROR_SYMLINK_NOT_SUPPORTED) → retried as stat → the junction
        // traverses to the volume root directory.
        let lst = lstat(&junction).unwrap();
        assert_eq!(
            lst.st_mode & S_IFMT,
            S_IFDIR,
            "volume junction lstats as a plain directory"
        );
        let root_st = stat(Path::new("C:\\")).unwrap();
        assert_eq!(lst.st_ino, root_st.st_ino);
    }

    /// // quirk: FSMETA-27
    #[test]
    fn fstat_named_pipe_synthesizes_fifo() {
        let name = format!("\\\\.\\pipe\\bun_winfs_{}", std::process::id());
        let w = wide_str(&name);
        // SAFETY: NUL-terminated pipe name; null security attributes.
        let handle = unsafe {
            CreateNamedPipeW(
                w.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1,
                4096,
                4096,
                0,
                ptr::null_mut(),
            )
        };
        assert!(handle != INVALID_HANDLE_VALUE);
        let _guard = HandleGuard(handle);

        let mut st = WindowsStat::default();
        // SAFETY: handle is a live test fixture handle.
        unsafe { fstat_handle(handle, &mut st) }.unwrap();
        assert_eq!(st.st_mode, S_IFIFO); // no permission bits synthesized
        assert_eq!(st.st_nlink, 1);
        assert_eq!(st.st_rdev, u64::from(FILE_DEVICE_NAMED_PIPE) << 16);
        // The libuv parity quirk: st_ino is the kernel handle value.
        assert_eq!(st.st_ino, handle as usize as u64);
        assert_eq!(st.st_size, 0);
        assert_eq!(st.st_atim, Timespec::default());
    }

    #[test]
    fn fstat_invalid_handle_errors() {
        let mut st = WindowsStat::default();
        assert_eq!(
            // SAFETY: INVALID_HANDLE_VALUE errors cleanly per the contract.
            unsafe { fstat_handle(INVALID_HANDLE_VALUE, &mut st) }.unwrap_err(),
            Win32Error::INVALID_HANDLE
        );
        assert_eq!(
            // SAFETY: null errors cleanly per the contract.
            unsafe { fstat_handle(ptr::null_mut(), &mut st) }.unwrap_err(),
            Win32Error::INVALID_HANDLE
        );
    }

    #[test]
    fn nonexistent_path_is_final_error() {
        // quirk: FSMETA-03 — not-found is on the fail-fast list.
        let mut st = WindowsStat::default();
        let err = stat_path(
            &wide_str("C:\\bun_winfs_does_not_exist_413a\\nope.txt"),
            &mut st,
        )
        .unwrap_err();
        assert!(
            err == Win32Error::FILE_NOT_FOUND || err == Win32Error::PATH_NOT_FOUND,
            "{err:?}"
        );
    }

    /// Fast path vs handle path of the same file: every identity field must
    /// agree, the cross-path consistency contract `copyfile`'s same-file
    /// check depends on. Skips on Win10 (no fast API).
    /// // quirk: FSMETA-02, FSMETA-08
    #[test]
    fn fast_path_agrees_with_handle_path() {
        if fast_stat_fn().is_none() {
            eprintln!("skip: GetFileInformationByName absent (pre-Win11-23H2)");
            return;
        }
        let mut fx = Fixture::new("fastcmp");
        let path = fx.file("cmp.bin", b"0123456789");
        let units = wide(&path);

        let mut fast = WindowsStat::default();
        match stat_path_fast(&units, &mut fast, false) {
            FastPath::Success => {}
            FastPath::Error(e) => panic!("fast path errored: {e:?}"),
            FastPath::TrySlow => panic!("fast path must answer for a plain file"),
        }

        // SAFETY: NUL-terminated path; attribute-only share-all open.
        let handle = unsafe {
            CreateFileW(
                units.as_ptr(),
                FILE_READ_ATTRIBUTES,
                SHARE_ALL,
                ptr::null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                ptr::null_mut(),
            )
        };
        assert!(handle != INVALID_HANDLE_VALUE);
        let _guard = HandleGuard(handle);
        let mut slow = WindowsStat::default();
        stat_handle(handle, &mut slow, false).unwrap();

        assert_eq!(fast.st_dev, slow.st_dev);
        assert_eq!(fast.st_ino, slow.st_ino);
        assert_eq!(fast.st_size, slow.st_size);
        assert_eq!(fast.st_mode, slow.st_mode);
        assert_eq!(fast.st_nlink, slow.st_nlink);
        assert_eq!(fast.st_mtim, slow.st_mtim);
        assert_eq!(fast.st_ctim, slow.st_ctim);
        assert_eq!(fast.st_birthtim, slow.st_birthtim);
    }

    /// Applies raw reparse data (header + payload bytes) to an existing FILE.
    fn set_file_reparse(path: &Path, tag: u32, payload: &[u8]) -> Result<(), Win32Error> {
        let w = wide(path);
        // SAFETY: NUL-terminated path; opening the stub itself for writing.
        let handle = unsafe {
            CreateFileW(
                w.as_ptr(),
                GENERIC_WRITE,
                SHARE_ALL,
                ptr::null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT,
                ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::get());
        }
        let _guard = HandleGuard(handle);
        let mut blob: Vec<u8> = Vec::with_capacity(8 + payload.len());
        blob.extend_from_slice(&tag.to_le_bytes());
        blob.extend_from_slice(&(payload.len() as u16).to_le_bytes());
        blob.extend_from_slice(&0u16.to_le_bytes()); // Reserved
        blob.extend_from_slice(payload);
        let mut bytes: DWORD = 0;
        // SAFETY: in-buffer is the owned blob; ioctl writes nothing back.
        let ok = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_SET_REPARSE_POINT,
                blob.as_mut_ptr().cast(),
                blob.len() as DWORD,
                ptr::null_mut(),
                0,
                &raw mut bytes,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    }

    /// WSL symlink: lstat st_size counts the RAW stored bytes after the
    /// 4-byte version field — no encoding conversion.
    /// // quirk: FSMETA-16, FSMETA-17
    #[test]
    fn lstat_lx_symlink_counts_raw_bytes() {
        let mut fx = Fixture::new("lx");
        let stub = fx.file("lx_link", b"");
        // Version 2 + UTF-8 target "tärget" (7 bytes: 't','ä'(2),'r','g','e','t').
        let target_utf8 = "t\u{00E4}rget".as_bytes();
        let mut payload = Vec::new();
        payload.extend_from_slice(&2u32.to_le_bytes());
        payload.extend_from_slice(target_utf8);
        if let Err(e) = set_file_reparse(&stub, IO_REPARSE_TAG_LX_SYMLINK, &payload) {
            eprintln!("skip: cannot set LX_SYMLINK reparse data ({e:?})");
            return;
        }
        let lst = lstat(&stub).unwrap();
        assert_eq!(lst.st_mode & S_IFMT, S_IFLNK);
        assert_eq!(lst.st_size as usize, target_utf8.len());
    }

    /// Microsoft Store app-exec alias: the 3rd NUL-separated string is the
    /// target, accepted only when it is an absolute `X:\` path.
    /// // quirk: FSMETA-17
    #[test]
    fn lstat_appexeclink_uses_third_string() {
        let mut fx = Fixture::new("appexec");
        let target = "C:\\Windows\\System32\\cmd.exe";

        let build = |strings: &[&str]| {
            let mut payload = Vec::new();
            payload.extend_from_slice(&(strings.len() as u32).to_le_bytes());
            for s in strings {
                for unit in s.encode_utf16() {
                    payload.extend_from_slice(&unit.to_le_bytes());
                }
                payload.extend_from_slice(&0u16.to_le_bytes());
            }
            payload
        };

        let stub = fx.file("appexec_link", b"");
        if let Err(e) = set_file_reparse(
            &stub,
            IO_REPARSE_TAG_APPEXECLINK,
            &build(&["pkg.id", "Pkg!App", target, "0"]),
        ) {
            eprintln!("skip: cannot set APPEXECLINK reparse data ({e:?})");
            return;
        }
        let lst = lstat(&stub).unwrap();
        assert_eq!(lst.st_mode & S_IFMT, S_IFLNK);
        assert_eq!(lst.st_size as usize, target.len());

        // A relative 3rd string is not symlink-class → the lstat→stat retry
        // re-opens WITHOUT the reparse flag; app-exec links cannot be
        // traversed by CreateFileW, so the retry surfaces an open error
        // (never the stub's metadata). // quirk: FSMETA-15
        let bad = fx.file("appexec_bad", b"");
        if set_file_reparse(
            &bad,
            IO_REPARSE_TAG_APPEXECLINK,
            &build(&["pkg.id", "Pkg!App", "relative.exe", "0"]),
        )
        .is_err()
        {
            return;
        }
        let err = lstat(&bad).unwrap_err();
        assert_ne!(
            err,
            Win32Error::SYMLINK_NOT_SUPPORTED,
            "retry must have consumed it"
        );
    }
}
