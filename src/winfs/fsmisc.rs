#![cfg(windows)]

//! The Windows misc-metadata engine: `utimes`/`lutimes`/`futimes`,
//! `chmod`/`fchmod`, the `chown` family of documented no-ops, `access`,
//! `realpath`, `statfs`, `copyfile`, and `mkdtemp`/`mkstemp` over
//! NUL-terminated wide (WTF-16) paths and HANDLEs — at libuv parity
//! (`fs__utime*` / `fs__chmod` / `fs__fchmod` / `fs__chown` / `fs__access` /
//! `fs__realpath` / `fs__statfs` / `fs__copyfile` / `fs__mktemp`), ported per
//! the `fs-meta.md` and `fs-links-dir.md` ledger areas.
//!
//! Error policy: raw `Win32Error` out of every function, translated nowhere
//! in-engine. Context-local remaps belong to the `bun_sys` wrapper:
//! - copyfile `FICLONE_FORCE`: raw `NOT_SUPPORTED` here → ENOSYS in the
//!   copyfile wrapper only (the global table maps NOT_SUPPORTED elsewhere).
//! - access W_OK-on-readonly: raw `ACCESS_DENIED` here → EPERM via the
//!   standard table — the same observable errno libuv smuggles through its
//!   negative-passthrough macro hack, without the hack. // quirk: FSMETA-40
//!
//! realpath's tier-0 split: this crate cannot reach `bun_core`/`bun_paths`,
//! so [`realpath_path`] returns the RAW final path with its `\\?\` / UNC
//! prefix UNTOUCHED; the `bun_sys` wrapper applies the canonical
//! `rewrite_final_path_prefix` (FSMETA-42, already implemented in
//! `bun_paths`) exactly once downstream.
//!
//! The trailing-slash strip (FSMETA-26) applies to stat/lstat ONLY — every
//! path here passes to the kernel verbatim, matching libuv.

use core::ffi::c_void;
use core::mem::size_of;
use core::ptr;

use bun_windows_sys::ntdll::{
    NtQueryInformationFile, NtQueryVolumeInformationFile, NtSetInformationFile,
};
use bun_windows_sys::{
    BOOL, CopyFileW, CreateFileW, DWORD, FILE_ATTRIBUTE_ARCHIVE, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY, FILE_BASIC_INFORMATION,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_FS_FULL_SIZE_INFORMATION,
    FILE_INFORMATION_CLASS, FILE_READ_ATTRIBUTES, FILE_WRITE_ATTRIBUTES, FILETIME,
    FS_INFORMATION_CLASS, GetFileAttributesW, GetFinalPathNameByHandleW, GetSystemTimeAsFileTime,
    HANDLE, INVALID_FILE_ATTRIBUTES, INVALID_HANDLE_VALUE, IO_STATUS_BLOCK, NT_ERROR, NT_SUCCESS,
    OPEN_EXISTING, ReOpenFile, RtlGenRandom, SetFileAttributesW, SetFileTime, ULONG,
    VOLUME_NAME_DOS, Win32Error,
};

use crate::stat::{HandleGuard, SHARE_ALL, WIN_TO_UNIX_TICK_OFFSET, WindowsStat, stat_path};

/// Validates the NUL-terminated wide-path entry contract shared by every
/// path-taking engine function; yields the units sans terminator.
fn checked_units(path_w: &[u16]) -> Result<&[u16], Win32Error> {
    let Some((&0, units)) = path_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!units.contains(&0), "interior NUL in wide path");
    Ok(units)
}

// ───────────────────────────── utimes family ─────────────────────────────

/// One timestamp slot for the utimes family — the explicit Option-style type
/// the ledger prescribes instead of libuv's NaN/Infinity double encoding.
/// // quirk: FSMETA-31
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum FileTimeSpec {
    /// Set to the current system time (`UTIME_NOW`). When both slots are
    /// `Now`, a single `GetSystemTimeAsFileTime` snapshot feeds both.
    Now,
    /// Leave unchanged (`UTIME_OMIT`) — a NULL `FILETIME*` to `SetFileTime`,
    /// the native "don't change" encoding.
    Omit,
    /// 100 ns ticks since the Unix epoch (negative = pre-1970) — FILETIME's
    /// own granularity, so no caller-side precision loss (sub-millisecond
    /// utimes round-trip; issue #28017). Values before 1601-01-01 are
    /// `ERROR_INVALID_PARAMETER`. // quirk: FSMETA-32
    UnixTicks(i64),
}

/// Unix-epoch 100 ns ticks → FILETIME, checked i64 math — never the double
/// round-trip. Overflow and pre-1601 results (negative ticks, which
/// FILETIME's unsigned layout cannot represent) are
/// `ERROR_INVALID_PARAMETER`. // quirk: FSMETA-32
fn unix_ticks_to_filetime(ticks: i64) -> Result<FILETIME, Win32Error> {
    let ticks = ticks
        .checked_add(WIN_TO_UNIX_TICK_OFFSET)
        .ok_or(Win32Error::INVALID_PARAMETER)?;
    if ticks < 0 {
        return Err(Win32Error::INVALID_PARAMETER);
    }
    Ok(FILETIME {
        dwLowDateTime: ticks as u64 as DWORD,
        dwHighDateTime: ((ticks as u64) >> 32) as DWORD,
    })
}

/// The SetFileTime core both path and handle entries share (libuv
/// `fs__utime_handle`): `Now` slots share one snapshot, `Omit` slots pass
/// NULL, and the CreationTime pointer is ALWAYS NULL — birthtime is never
/// modified. // quirk: FSMETA-30, FSMETA-31
fn set_file_times(
    handle: HANDLE,
    atime: FileTimeSpec,
    mtime: FileTimeSpec,
) -> Result<(), Win32Error> {
    let mut now = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    if atime == FileTimeSpec::Now || mtime == FileTimeSpec::Now {
        // SAFETY: `now` is an owned out-param; the call cannot fail.
        unsafe { GetSystemTimeAsFileTime(&raw mut now) };
    }
    let resolve = |spec: FileTimeSpec| -> Result<Option<FILETIME>, Win32Error> {
        Ok(match spec {
            FileTimeSpec::Now => Some(now),
            FileTimeSpec::Omit => None,
            FileTimeSpec::UnixTicks(t) => Some(unix_ticks_to_filetime(t)?),
        })
    };
    let filetime_a = resolve(atime)?;
    let filetime_m = resolve(mtime)?;
    let ptr_of = |slot: &Option<FILETIME>| slot.as_ref().map_or(ptr::null(), ptr::from_ref);
    // SAFETY: `handle` is live (callers' contract); the FILETIME locals
    // outlive this synchronous call; null pointers mean "leave unchanged".
    let ok = unsafe {
        SetFileTime(
            handle,
            ptr::null(),
            ptr_of(&filetime_a),
            ptr_of(&filetime_m),
        )
    };
    if ok == 0 {
        return Err(Win32Error::get());
    }
    Ok(())
}

/// One fresh-handle attempt: `FILE_WRITE_ATTRIBUTES` + share-everything +
/// `BACKUP_SEMANTICS` (so directories work, as POSIX utimes requires), plus
/// `OPEN_REPARSE_POINT` for lutimes. There is no path-based set-times Win32
/// API. // quirk: FSMETA-30
fn utime_impl_from_path(
    path_w: &[u16],
    atime: FileTimeSpec,
    mtime: FileTimeSpec,
    do_lutime: bool,
) -> Result<(), Win32Error> {
    let mut flags = FILE_FLAG_BACKUP_SEMANTICS;
    if do_lutime {
        flags |= FILE_FLAG_OPEN_REPARSE_POINT;
    }
    // SAFETY: `path_w` is NUL-terminated (entry contract, validated by the
    // public callers).
    let handle = unsafe {
        CreateFileW(
            path_w.as_ptr(),
            FILE_WRITE_ATTRIBUTES,
            SHARE_ALL,
            ptr::null_mut(),
            OPEN_EXISTING,
            flags,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    let _guard = HandleGuard(handle); // quirk: FSMETA-35
    set_file_times(handle, atime, mtime)
}

/// utime(2)-alike over a NUL-terminated wide (WTF-16) path; follows
/// symlinks. The path passes to `CreateFileW` verbatim. Birthtime is never
/// touched. Conversion happens after the open, so a missing file reports
/// not-found before a pre-1601 time reports `INVALID_PARAMETER` (libuv
/// ordering).
pub fn utimes_path(
    path_w: &[u16],
    atime: FileTimeSpec,
    mtime: FileTimeSpec,
) -> Result<(), Win32Error> {
    checked_units(path_w)?;
    utime_impl(path_w, atime, mtime, false)
}

/// lutimes: addresses the link itself via `OPEN_REPARSE_POINT`. On a
/// non-symlink-class reparse point this degrades to plain utimes — the same
/// retry philosophy as lstat. // quirk: FSMETA-33
pub fn lutimes_path(
    path_w: &[u16],
    atime: FileTimeSpec,
    mtime: FileTimeSpec,
) -> Result<(), Win32Error> {
    checked_units(path_w)?;
    utime_impl(path_w, atime, mtime, true)
}

/// The lutime→utime retry: `SYMLINK_NOT_SUPPORTED` / `NOT_A_REPARSE_POINT`
/// under `do_lutime` re-runs without the reparse flag (in practice these can
/// only arise from the CreateFileW step — the shape mirrors stat's by
/// design). Bounded: the retry clears `do_lutime`. // quirk: FSMETA-33
fn utime_impl(
    path_w: &[u16],
    atime: FileTimeSpec,
    mtime: FileTimeSpec,
    do_lutime: bool,
) -> Result<(), Win32Error> {
    let mut do_lutime = do_lutime;
    loop {
        match utime_impl_from_path(path_w, atime, mtime, do_lutime) {
            Err(e)
                if do_lutime
                    && (e == Win32Error::SYMLINK_NOT_SUPPORTED
                        || e == Win32Error::NOT_A_REPARSE_POINT) =>
            {
                do_lutime = false;
            }
            other => return other,
        }
    }
}

/// futimes over a raw HANDLE — used directly, with NO `ReOpenFile` dance: a
/// handle opened read-only lacks `FILE_WRITE_ATTRIBUTES` and fails
/// `ACCESS_DENIED` (EPERM downstream). This is the deliberate libuv/Node
/// POSIX deviation, kept for parity over the more-POSIX alternative of
/// reopening with the attribute right. // quirk: FSMETA-34
///
/// # Safety
/// `handle` must be a valid kernel handle (or null/INVALID, which error
/// cleanly) owned by the caller for the duration of the call.
pub unsafe fn futimes_handle(
    handle: HANDLE,
    atime: FileTimeSpec,
    mtime: FileTimeSpec,
) -> Result<(), Win32Error> {
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(Win32Error::INVALID_HANDLE);
    }
    set_file_times(handle, atime, mtime)
}

// ───────────────────────────── chmod / fchmod ─────────────────────────────

/// chmod(2)-alike: the only chmod-able thing on Windows is
/// `FILE_ATTRIBUTE_READONLY`, toggled per the caller's pre-computed
/// `readonly = !(mode & S_IWRITE)` — the same one-bit semantics as the CRT's
/// `_wchmod`, implemented via Get/SetFileAttributesW directly. Each failing
/// call reports ITS OWN error immediately (the `_doserrno` stale-error
/// lesson). Get/SetFileAttributesW do not follow symlinks, so this is
/// silently lchmod on links — the libuv/Node deviation, kept.
/// No Archive-flag dance: SetFileAttributesW, unlike NtSetInformationFile,
/// does not need it. // quirk: FSMETA-36
pub fn chmod_path(path_w: &[u16], readonly: bool) -> Result<(), Win32Error> {
    checked_units(path_w)?;
    // SAFETY: `path_w` is NUL-terminated (validated above).
    let attrs = unsafe { GetFileAttributesW(path_w.as_ptr()) };
    if attrs == INVALID_FILE_ATTRIBUTES {
        return Err(Win32Error::get());
    }
    let new_attrs = if readonly {
        attrs | FILE_ATTRIBUTE_READONLY
    } else {
        attrs & !FILE_ATTRIBUTE_READONLY
    };
    // SAFETY: `path_w` is NUL-terminated.
    if unsafe { SetFileAttributesW(path_w.as_ptr(), new_attrs) } == 0 {
        return Err(Win32Error::get());
    }
    Ok(())
}

/// Issues one `NtSetInformationFile(FileBasicInformation)` write of `info`.
fn set_basic_info(handle: HANDLE, info: &mut FILE_BASIC_INFORMATION) -> Result<(), Win32Error> {
    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    // SAFETY: owned in/out params of exactly the class size; the kernel only
    // reads `info` and writes `io_status`.
    let status = unsafe {
        NtSetInformationFile(
            handle,
            &raw mut io_status,
            ptr::from_mut(info).cast(),
            size_of::<FILE_BASIC_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileBasicInformation,
        )
    };
    if NT_SUCCESS(status) {
        Ok(())
    } else {
        Err(Win32Error::from_ntstatus(status))
    }
}

/// fchmod over a raw HANDLE. The handle is `ReOpenFile`d with ONLY
/// `FILE_WRITE_ATTRIBUTES` (share 0, flags 0 — attribute-only access is
/// exempt from sharing checks): never widen default open rights to enable a
/// metadata op; the global-rights fix was shipped and reverted upstream.
/// // quirk: FSMETA-37
///
/// The Archive-flag dance, ported verbatim: `NtSetInformationFile` will not
/// toggle READONLY while ARCHIVE is clear, so ARCHIVE is set first (separate
/// write) and cleared after; and because `FileAttributes == 0` is the
/// documented "leave unchanged" sentinel, a result of zero substitutes
/// `FILE_ATTRIBUTE_NORMAL`. Three sequential writes in the worst case
/// (`attrib -A +R file` is the repro). // quirk: FSMETA-38
///
/// # Safety
/// `handle` must be a valid kernel handle (or null/INVALID, which error
/// cleanly) owned by the caller for the duration of the call.
pub unsafe fn fchmod_handle(handle: HANDLE, readonly: bool) -> Result<(), Win32Error> {
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(Win32Error::INVALID_HANDLE);
    }
    // SAFETY: `handle` is live (caller contract); the reopen duplicates the
    // file object with only the attribute right, leaving `handle` untouched.
    let write_handle = unsafe { ReOpenFile(handle, FILE_WRITE_ATTRIBUTES, 0, 0) };
    if write_handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    let _guard = HandleGuard(write_handle); // quirk: FSMETA-35

    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    let mut info = FILE_BASIC_INFORMATION::default();
    // SAFETY: owned out-params of exactly the class size.
    let status = unsafe {
        NtQueryInformationFile(
            write_handle,
            &raw mut io_status,
            (&raw mut info).cast(),
            size_of::<FILE_BASIC_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileBasicInformation,
        )
    };
    if !NT_SUCCESS(status) {
        return Err(Win32Error::from_ntstatus(status));
    }

    let clear_archive = info.FileAttributes & FILE_ATTRIBUTE_ARCHIVE == 0;
    if clear_archive {
        // Set ARCHIVE first, otherwise the READONLY toggle will not stick.
        // // quirk: FSMETA-38
        info.FileAttributes |= FILE_ATTRIBUTE_ARCHIVE;
        set_basic_info(write_handle, &mut info)?;
    }

    if readonly {
        info.FileAttributes |= FILE_ATTRIBUTE_READONLY;
    } else {
        info.FileAttributes &= !FILE_ATTRIBUTE_READONLY;
    }
    set_basic_info(write_handle, &mut info)?;

    if clear_archive {
        info.FileAttributes &= !FILE_ATTRIBUTE_ARCHIVE;
        if info.FileAttributes == 0 {
            // Zero is the "leave attributes unchanged" sentinel — dodge it.
            // // quirk: FSMETA-38
            info.FileAttributes = FILE_ATTRIBUTE_NORMAL;
        }
        set_basic_info(write_handle, &mut info)?;
    }
    Ok(())
}

// ───────────────────────────── chown family ─────────────────────────────

/// chown(2): unconditional success no-op — Windows has no POSIX uid/gid
/// model, and it must SUCCEED (not ENOSYS): npm and tarball extractors call
/// chown unconditionally and treat failure as fatal. The args are never
/// read, exactly the libuv shape (even a nonexistent path succeeds).
/// // quirk: FSMETA-46
pub fn chown_path(_path_w: &[u16], _uid: u32, _gid: u32) -> Result<(), Win32Error> {
    Ok(())
}

/// lchown(2): same unconditional no-op as [`chown_path`]. // quirk: FSMETA-46
pub fn lchown_path(_path_w: &[u16], _uid: u32, _gid: u32) -> Result<(), Win32Error> {
    Ok(())
}

/// fchown(2): same unconditional no-op — libuv does not even validate the
/// fd, so neither does this (safe fn: the handle is never dereferenced).
/// // quirk: FSMETA-46
pub fn fchown_handle(_handle: HANDLE, _uid: u32, _gid: u32) -> Result<(), Win32Error> {
    Ok(())
}

// ───────────────────────────── access ─────────────────────────────

/// access(2) mode selector, bit-for-bit the UCRT/libuv values: a node
/// `fs.constants.*_OK` integer plumbs through unchanged.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct AccessMode(pub u32);

impl AccessMode {
    pub const F_OK: Self = Self(0);
    pub const X_OK: Self = Self(1);
    pub const W_OK: Self = Self(2);
    pub const R_OK: Self = Self(4);

    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

impl core::ops::BitOr for AccessMode {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

/// access(2): one `GetFileAttributesW` plus three rules (credited upstream
/// to CPython) — access is possible if write access wasn't requested, or the
/// file isn't read-only, or it's a directory (directories cannot be
/// read-only on Windows; the bit means "customized folder"). `R_OK`/`X_OK`/
/// `F_OK` all collapse to "attributes were readable" — there is no execute
/// bit and ACLs are never consulted. // quirk: FSMETA-39
///
/// `W_OK` on a READONLY non-directory returns raw `ACCESS_DENIED`, which the
/// standard table maps to EPERM — the same observable errno as libuv's
/// smuggled `UV_EPERM`, without the negative-code macro hack. Symlinks are
/// NOT followed (GetFileAttributesW reports the link's own attributes, and
/// succeeds on dangling links) — the pinned POSIX deviation.
/// // quirk: FSMETA-40
pub fn access_path(path_w: &[u16], mode: AccessMode) -> Result<(), Win32Error> {
    checked_units(path_w)?;
    // SAFETY: `path_w` is NUL-terminated (validated above).
    let attrs = unsafe { GetFileAttributesW(path_w.as_ptr()) };
    if attrs == INVALID_FILE_ATTRIBUTES {
        return Err(Win32Error::get());
    }
    if !mode.contains(AccessMode::W_OK)
        || attrs & FILE_ATTRIBUTE_READONLY == 0
        || attrs & FILE_ATTRIBUTE_DIRECTORY != 0
    {
        Ok(())
    } else {
        Err(Win32Error::ACCESS_DENIED)
    }
}

// ───────────────────────────── realpath ─────────────────────────────

/// realpath(3): opens with ZERO desired access (succeeds on files other
/// processes hold locked — GENERIC_READ here would fail on running
/// executables) + `BACKUP_SEMANTICS` for directories, then the two-call
/// `GetFinalPathNameByHandleW(VOLUME_NAME_DOS)` dance: a size probe (returns
/// the required length INCLUDING the terminator), then the fill (returns
/// units written EXCLUDING it). // quirk: FSMETA-41
///
/// Returns the RAW final path, prefix UNTOUCHED (`\\?\C:\...` or
/// `\\?\UNC\server\share\...`), without a NUL terminator. This crate is
/// tier-0 and cannot reach bun_core's rewrite helpers: the canonical
/// `\\?\`-prefix rewrite — and the EBADF policy for exotic non-DOS volumes —
/// is `bun_sys`'s `rewrite_final_path_prefix` step (FSMETA-42, owned by
/// `bun_paths`), applied exactly once downstream.
///
/// Inherited semantics, pinned by tests: resolves symlinks/junctions (and
/// SUBST/mapped-drive indirection) via the open itself, returns each
/// component in its on-disk case, and cannot be reached for Microsoft Store
/// app-exec links (`CreateFileW` refuses to traverse them:
/// `CANT_ACCESS_FILE` → EACCES downstream). // quirk: FSMETA-43
pub fn realpath_path(path_w: &[u16]) -> Result<Vec<u16>, Win32Error> {
    checked_units(path_w)?;
    // SAFETY: `path_w` is NUL-terminated (validated above).
    let handle = unsafe {
        CreateFileW(
            path_w.as_ptr(),
            0,
            0,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    let _guard = HandleGuard(handle); // quirk: FSMETA-35
    realpath_by_handle(handle)
}

/// The two-call size-probe/fill dance. // quirk: FSMETA-41
fn realpath_by_handle(handle: HANDLE) -> Result<Vec<u16>, Win32Error> {
    // SAFETY: `handle` is live (caller guards it); a null buffer with zero
    // capacity is the documented size-probe form.
    let mut needed =
        unsafe { GetFinalPathNameByHandleW(handle, ptr::null_mut(), 0, VOLUME_NAME_DOS) };
    if needed == 0 {
        return Err(Win32Error::get());
    }
    // One fill normally suffices; re-probe a few times if a concurrent
    // ancestor rename grew the path between the calls. The unreachable
    // exhaustion shape reports INVALID_HANDLE, this function's established
    // weird-result sentinel upstream (also used when the fill call fails).
    for _ in 0..4 {
        let mut buf = vec![0u16; needed as usize];
        // SAFETY: `buf` is an owned buffer of exactly `needed` units.
        let written =
            unsafe { GetFinalPathNameByHandleW(handle, buf.as_mut_ptr(), needed, VOLUME_NAME_DOS) };
        if written == 0 {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if (written as usize) < buf.len() {
            buf.truncate(written as usize);
            return Ok(buf);
        }
        needed = written; // too small: the return is the new required size
    }
    Err(Win32Error::INVALID_HANDLE)
}

// ───────────────────────────── statfs ─────────────────────────────

/// uv_statfs_t-shaped statfs result. Windows has no fs-type magic number and
/// no inode counts: `f_type`, `f_files`, `f_ffree` are hard zeros.
/// `f_bfree` is the RAW free count (`ActualAvailableAllocationUnits`) while
/// `f_bavail` is the quota-aware caller-visible count
/// (`CallerAvailableAllocationUnits`) — the POSIX root-vs-user split; swap
/// them and quota'd users see wrong free space. `f_frsize == f_bsize`.
/// // quirk: FSMETA-45
#[repr(C)]
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct WindowsStatFs {
    pub f_type: u64,
    pub f_bsize: u64,
    pub f_blocks: u64,
    pub f_bfree: u64,
    pub f_bavail: u64,
    pub f_files: u64,
    pub f_ffree: u64,
    pub f_frsize: u64,
}

/// statfs(2)-alike: opens the path itself — file or directory both work —
/// with the attribute-only/share-everything/BACKUP_SEMANTICS triple, then
/// one `NtQueryVolumeInformationFile(FileFsFullSizeInformation)`: 64-bit
/// allocation-unit counts, so >2^32-cluster volumes report correctly. This
/// is libuv's final form; the GetDiskFreeSpaceW/GetFullPathNameW
/// intermediate designs are deliberately not retraced. // quirk: FSMETA-44
pub fn statfs_path(path_w: &[u16], out: &mut WindowsStatFs) -> Result<(), Win32Error> {
    checked_units(path_w)?;
    // SAFETY: `path_w` is NUL-terminated (validated above). // quirk: FSMETA-09
    let handle = unsafe {
        CreateFileW(
            path_w.as_ptr(),
            FILE_READ_ATTRIBUTES,
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

    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    let mut info = FILE_FS_FULL_SIZE_INFORMATION::default();
    // SAFETY: owned out-params of exactly the class size.
    let nt = unsafe {
        NtQueryVolumeInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut info).cast(),
            size_of::<FILE_FS_FULL_SIZE_INFORMATION>() as ULONG,
            FS_INFORMATION_CLASS::FileFsFullSizeInformation,
        )
    };
    // NT_ERROR, not !NT_SUCCESS: warning statuses carry valid fixed members.
    // // quirk: FSMETA-06
    if NT_ERROR(nt) {
        return Err(Win32Error::from_ntstatus(nt));
    }

    // Cluster size computed in u64 — the DWORD product overflows for large
    // sector*cluster combinations. // quirk: FSMETA-45
    let bsize = u64::from(info.SectorsPerAllocationUnit) * u64::from(info.BytesPerSector);
    *out = WindowsStatFs {
        f_type: 0,
        f_bsize: bsize,
        f_blocks: info.TotalAllocationUnits as u64,
        f_bfree: info.ActualAvailableAllocationUnits as u64,
        f_bavail: info.CallerAvailableAllocationUnits as u64,
        f_files: 0,
        f_ffree: 0,
        f_frsize: bsize,
    };
    Ok(())
}

// ───────────────────────────── copyfile ─────────────────────────────

/// copyfile flag selectors, bit-for-bit libuv's `UV_FS_COPYFILE_*` (uv.h).
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct CopyFileFlags(pub u32);

impl CopyFileFlags {
    pub const NONE: Self = Self(0);
    /// Fail if the destination exists (`bFailIfExists`).
    pub const EXCL: Self = Self(0x0001);
    /// Best-effort clone request: accepted and IGNORED — Windows CopyFileW
    /// has no reflink, so this proceeds as a normal copy (libuv parity).
    pub const FICLONE: Self = Self(0x0002);
    /// Mandatory clone: unsupported on Windows — raw `NOT_SUPPORTED` before
    /// any side effect (ENOSYS in the copyfile wrapper).
    pub const FICLONE_FORCE: Self = Self(0x0004);

    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

/// copyfile(3)-alike: `CopyFileW` with `bFailIfExists = EXCL`. A read-only
/// destination fails raw `ACCESS_DENIED` (EPERM downstream) — no special
/// handling, the libuv shape.
///
/// The same-file conversion: when src and dst reach the same file,
/// `CopyFileW` fails with a sharing violation (the source is held open while
/// the destination open collides with it). Exactly the raw codes the
/// standard table maps to EBUSY (`SHARING_VIOLATION`, `LOCK_VIOLATION`,
/// `PIPE_BUSY` — mirroring libuv's `result == UV_EBUSY` gate) trigger a
/// dev+ino comparison through the stat engine, and a match reports success
/// (POSIX cp same-file semantics). This consumes FSMETA-08's st_dev
/// cross-path consistency guarantee. // quirk: FSMETA-50
pub fn copyfile_path(from_w: &[u16], to_w: &[u16], flags: CopyFileFlags) -> Result<(), Win32Error> {
    checked_units(from_w)?;
    checked_units(to_w)?;
    if flags.contains(CopyFileFlags::FICLONE_FORCE) {
        return Err(Win32Error::NOT_SUPPORTED);
    }
    let fail_if_exists: BOOL = BOOL::from(flags.contains(CopyFileFlags::EXCL));
    // SAFETY: both paths are NUL-terminated (validated above).
    if unsafe { CopyFileW(from_w.as_ptr(), to_w.as_ptr(), fail_if_exists) } != 0 {
        return Ok(());
    }
    let error = Win32Error::get();
    if error == Win32Error::SHARING_VIOLATION
        || error == Win32Error::LOCK_VIOLATION
        || error == Win32Error::PIPE_BUSY
    {
        // quirk: FSMETA-50
        let mut from_stat = WindowsStat::default();
        let mut to_stat = WindowsStat::default();
        if stat_path(from_w, &mut from_stat).is_ok()
            && stat_path(to_w, &mut to_stat).is_ok()
            && from_stat.st_dev == to_stat.st_dev
            && from_stat.st_ino == to_stat.st_ino
        {
            return Ok(());
        }
    }
    Err(error)
}

// ───────────────────────────── mkdtemp / mkstemp ─────────────────────────

/// The OpenBSD mktemp alphabet, in libuv's exact order.
const TEMPCHARS: [u16; 62] = {
    let mut chars = [0u16; 62];
    let mut i = 0;
    while i < 26 {
        chars[i] = b'a' as u16 + i as u16;
        chars[26 + i] = b'A' as u16 + i as u16;
        i += 1;
    }
    let mut d = 0;
    while d < 10 {
        chars[52 + d] = b'0' as u16 + d as u16;
        d += 1;
    }
    chars
};

const NUM_X: usize = 6;
const X: u16 = b'X' as u16;

/// MSVC ucrt `TMP_MAX` (stdio.h): INT_MAX. Only exact-collision errors
/// consume tries; everything else aborts the loop immediately.
const TMP_MAX: u32 = 0x7FFF_FFFF;

/// One create attempt's verdict, libuv's `uv__fs_mktemp_func` 0/1 protocol
/// made explicit.
enum MktempOutcome<T> {
    /// Created — stop with the result.
    Done(T),
    /// The candidate name already exists — draw a new name and retry.
    /// Carries the exact collision code so loop exhaustion reports it.
    Collision(Win32Error),
    /// Any other failure — abort the loop immediately. // quirk: FSLNK-30
    Fail(Win32Error),
}

/// The OpenBSD algorithm (libuv `fs__mktemp`): the template must end in
/// exactly `XXXXXX` (else `INVALID_PARAMETER` → EINVAL); each attempt draws
/// a fresh u64 from the CSPRNG and fills the six slots via repeated `% 62`;
/// up to `TMP_MAX` retries, but ONLY on the create fn's exact collision
/// error. On success returns the winning name (sans NUL) — on ANY failure
/// no name escapes, the half-generated-garbage contract made structural by
/// `Result`. // quirk: FSLNK-27, FSLNK-29, FSLNK-30
///
/// Entropy is `RtlGenRandom` (advapi32 `SystemFunction036`), statically
/// linked — the bun_iocp precedent; no dynamic library loading, so no
/// planting surface. CSPRNG failure is `IO_DEVICE` (EIO downstream).
/// // quirk: FSLNK-28
fn mktemp_impl<T>(
    template_w: &[u16],
    mut create: impl FnMut(&[u16]) -> MktempOutcome<T>,
) -> Result<(Vec<u16>, T), Win32Error> {
    let units = checked_units(template_w)?;
    if units.len() < NUM_X || units[units.len() - NUM_X..] != [X; NUM_X] {
        return Err(Win32Error::INVALID_PARAMETER); // quirk: FSLNK-27
    }
    let base = units.len() - NUM_X;
    let mut candidate = template_w.to_vec();
    let mut last_collision = Win32Error::ALREADY_EXISTS;
    for _ in 0..TMP_MAX {
        let mut v: u64 = 0;
        // SAFETY: `v` is an owned 8-byte out-buffer.
        if unsafe { RtlGenRandom((&raw mut v).cast::<c_void>(), 8) } == 0 {
            return Err(Win32Error::IO_DEVICE); // quirk: FSLNK-28
        }
        for slot in &mut candidate[base..base + NUM_X] {
            *slot = TEMPCHARS[(v % 62) as usize];
            v /= 62;
        }
        match create(&candidate) {
            MktempOutcome::Done(result) => {
                candidate.pop(); // drop the NUL: outputs are unterminated
                return Ok((candidate, result));
            }
            MktempOutcome::Fail(e) => return Err(e),
            MktempOutcome::Collision(e) => last_collision = e,
        }
    }
    Err(last_collision)
}

/// mkdtemp(3): creates a uniquely named directory from a NUL-terminated wide
/// template ending in `XXXXXX`; returns the winning path sans NUL. Retries
/// ONLY on `ERROR_ALREADY_EXISTS` — `CreateDirectoryW`'s exact collision
/// code; any other error (missing parent, access denied) aborts immediately
/// instead of spinning TMP_MAX times. // quirk: FSLNK-27, FSLNK-30
pub fn mkdtemp_path(template_w: &[u16]) -> Result<Vec<u16>, Win32Error> {
    mktemp_impl(template_w, |candidate| {
        match crate::fslnk::mkdir_path(candidate) {
            Ok(()) => MktempOutcome::Done(()),
            Err(e) if e == Win32Error::ALREADY_EXISTS => MktempOutcome::Collision(e),
            Err(e) => MktempOutcome::Fail(e),
        }
    })
    .map(|(name, ())| name)
}

/// mkstemp(3): creates and opens a uniquely named file — read/write access,
/// CREATE_NEW (the atomic O_CREAT|O_EXCL) and share-everything, via the
/// fsio open engine (`RDWR|CREAT|EXCL`). Retries ONLY on the atomic-create
/// collision code `ERROR_FILE_EXISTS`. Returns the winning path (sans NUL)
/// and the open HANDLE, which the caller owns; the error legs leak nothing
/// (the handle exists only on the success leg). The CRT-fd minting half of
/// libuv's implementation is the fd-table layer's job, not this crate's.
/// // quirk: FSLNK-27, FSLNK-30, FSLNK-31
pub fn mkstemp_path(template_w: &[u16]) -> Result<(Vec<u16>, HANDLE), Win32Error> {
    mktemp_impl(template_w, |candidate| {
        match crate::fsio::open_path(
            candidate,
            crate::fsio::OpenFlags::RDWR
                | crate::fsio::OpenFlags::CREAT
                | crate::fsio::OpenFlags::EXCL,
            false,
        ) {
            Ok(handle) => MktempOutcome::Done(handle),
            Err(e) if e == Win32Error::FILE_EXISTS => MktempOutcome::Collision(e),
            Err(e) => MktempOutcome::Fail(e),
        }
    })
}

// ───────────────────────────── tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use bun_windows_sys::kernel32::RemoveDirectoryW;
    use bun_windows_sys::{
        CreateSymbolicLinkW, DeleteFileW, GENERIC_READ, GENERIC_WRITE, GetDiskFreeSpaceExW,
        SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE,
    };

    use super::*;
    use crate::fsio::OpenFlags;
    use crate::fslnk::SymlinkFlags;
    use crate::stat::{S_IFDIR, S_IFMT, S_IFREG, Timespec, lstat_path};

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

    fn file_attrs(path: &Path) -> DWORD {
        let w = wide(path);
        // SAFETY: NUL-terminated path.
        let attrs = unsafe { GetFileAttributesW(w.as_ptr()) };
        assert!(
            attrs != INVALID_FILE_ATTRIBUTES,
            "GetFileAttributesW({path:?}): {:?}",
            Win32Error::get()
        );
        attrs
    }

    /// Expected stat timespec for a `Millis` input (floor division for
    /// pre-1970 values).
    fn ts(ms: i64) -> Timespec {
        Timespec {
            sec: ms.div_euclid(1000),
            nsec: (ms.rem_euclid(1000) * 1_000_000) as i32,
        }
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
                "bun_winfs_misc_{tag}_{}_{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            crate::fslnk::mkdir_path(&wide(&root))
                .unwrap_or_else(|e| panic!("mkdir_path({root:?}): {e:?}"));
            Fixture {
                root,
                entries: Vec::new(),
            }
        }

        fn track(&mut self, path: &Path, is_dir: bool) {
            self.entries.push((path.to_path_buf(), is_dir));
        }

        /// Creates a file through the fsio engine and registers cleanup.
        fn file(&mut self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join(name);
            let h = crate::fsio::open_path(
                &wide(&path),
                OpenFlags::WRONLY | OpenFlags::CREAT | OpenFlags::TRUNC,
                false,
            )
            .unwrap_or_else(|e| panic!("create {path:?}: {e:?}"));
            let _g = HandleGuard(h);
            if !contents.is_empty() {
                // SAFETY: live test handle owned by the guard.
                let n = unsafe { crate::fsio::write_at(h, &[contents], None) };
                assert_eq!(n, Ok(contents.len()));
            }
            self.track(&path, false);
            path
        }

        /// Creates a directory through the engine and registers cleanup.
        fn dir(&mut self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            crate::fslnk::mkdir_path(&wide(&path))
                .unwrap_or_else(|e| panic!("mkdir_path({path:?}): {e:?}"));
            self.track(&path, true);
            path
        }

        /// Creates a junction at `name` pointing at the absolute `target`.
        fn junction(&mut self, name: &str, target: &Path) -> PathBuf {
            let path = self.root.join(name);
            crate::fslnk::symlink_path(&wide(target), &wide(&path), SymlinkFlags::JUNCTION)
                .unwrap_or_else(|e| panic!("junction {path:?} -> {target:?}: {e:?}"));
            self.track(&path, true);
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            for (path, is_dir) in self.entries.iter().rev() {
                let w = wide(path);
                // SAFETY: NUL-terminated paths; best-effort cleanup (clear
                // READONLY first so attribute fixtures delete).
                unsafe {
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

    fn read_small(path: &Path) -> Result<Vec<u8>, Win32Error> {
        let h = crate::fsio::open_path(&wide(path), OpenFlags::RDONLY, false)?;
        let _g = HandleGuard(h);
        let mut out = Vec::new();
        let mut buf = [0u8; 512];
        loop {
            // SAFETY: live test handle owned by the guard.
            match unsafe { crate::fsio::read_at(h, &mut [&mut buf], None) } {
                Ok(0) => return Ok(out),
                Ok(n) => out.extend_from_slice(&buf[..n]),
                Err(e) if e == Win32Error::HANDLE_EOF => return Ok(out),
                Err(e) => return Err(e),
            }
        }
    }

    // ── pure KATs ──

    /// // quirk: FSMETA-32
    #[test]
    fn unix_ticks_to_filetime_kats() {
        let ft = |ticks: i64| {
            let f = unix_ticks_to_filetime(ticks).unwrap();
            (u64::from(f.dwHighDateTime) << 32) | u64::from(f.dwLowDateTime)
        };
        // Unix epoch lands exactly on the 1601 offset.
        assert_eq!(ft(0), WIN_TO_UNIX_TICK_OFFSET as u64);
        // Sub-millisecond survives: 0.5 ms = 5_000 ticks (issue #28017).
        assert_eq!(ft(5_000), WIN_TO_UNIX_TICK_OFFSET as u64 + 5_000);
        assert_eq!(ft(15_000_000), WIN_TO_UNIX_TICK_OFFSET as u64 + 15_000_000);
        // Pre-1970 but post-1601: representable.
        assert_eq!(ft(-10_000_000), WIN_TO_UNIX_TICK_OFFSET as u64 - 10_000_000);
        // Exactly 1601-01-01 is tick zero — the first valid instant.
        assert_eq!(ft(-WIN_TO_UNIX_TICK_OFFSET), 0);
        // One tick before 1601 → negative → EINVAL shape; i64 overflow in
        // tick space likewise (never a wrap).
        let ft_err = |t: i64| unix_ticks_to_filetime(t).map(|_| ()).unwrap_err();
        assert_eq!(
            ft_err(-WIN_TO_UNIX_TICK_OFFSET - 1),
            Win32Error::INVALID_PARAMETER
        );
        assert_eq!(ft_err(i64::MAX), Win32Error::INVALID_PARAMETER);
        assert_eq!(ft_err(i64::MIN), Win32Error::INVALID_PARAMETER);
    }

    // ── utimes family ──

    /// Set/read-back through the stat engine, including sub-second
    /// precision and pre-1970 values. // quirk: FSMETA-30, FSMETA-32
    #[test]
    fn utimes_set_and_read_back_via_stat() {
        let mut fx = Fixture::new("utimes");
        let path = fx.file("t.bin", b"x");

        // 2020-09-13T12:26:40.123Z and a distinct atime.
        let mtime_ms = 1_600_000_000_123i64;
        let atime_ms = 1_500_000_000_456i64;
        utimes_path(
            &wide(&path),
            FileTimeSpec::UnixTicks(atime_ms * 10_000),
            FileTimeSpec::UnixTicks(mtime_ms * 10_000),
        )
        .unwrap();
        let st = stat(&path).unwrap();
        assert_eq!(st.st_atim, ts(atime_ms));
        assert_eq!(st.st_mtim, ts(mtime_ms));

        // Pre-1970 (negative, post-1601): -1.5s → sec -2, nsec 5e8.
        utimes_path(
            &wide(&path),
            FileTimeSpec::UnixTicks(-1500 * 10_000),
            FileTimeSpec::UnixTicks(-1500 * 10_000),
        )
        .unwrap();
        let st = stat(&path).unwrap();
        assert_eq!(st.st_atim, ts(-1500));
        assert_eq!(st.st_mtim, ts(-1500));
        assert_eq!(
            st.st_atim,
            Timespec {
                sec: -2,
                nsec: 500_000_000
            }
        );

        // Missing file: the open fails before any time conversion, so even a
        // pre-1601 value reports not-found (libuv ordering).
        let missing = fx.root.join("missing.bin");
        assert_eq!(
            utimes_path(
                &wide(&missing),
                FileTimeSpec::UnixTicks(i64::MIN),
                FileTimeSpec::UnixTicks(i64::MIN),
            )
            .unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );
    }

    /// The sentinel pair: `Omit` leaves a field untouched, `Now` snapshots
    /// the system clock (once, shared by both fields). // quirk: FSMETA-31
    #[test]
    fn utimes_now_and_omit_sentinels() {
        let mut fx = Fixture::new("sentinels");
        let path = fx.file("s.bin", b"x");
        let atime_ms = 1_400_000_000_000i64;
        let mtime_ms = 1_400_000_111_000i64;
        utimes_path(
            &wide(&path),
            FileTimeSpec::UnixTicks((atime_ms) * 10_000),
            FileTimeSpec::UnixTicks((mtime_ms) * 10_000),
        )
        .unwrap();

        // Omit both: a successful no-op call (SetFileTime with two NULLs).
        utimes_path(&wide(&path), FileTimeSpec::Omit, FileTimeSpec::Omit).unwrap();
        let st = stat(&path).unwrap();
        assert_eq!(st.st_atim, ts(atime_ms));
        assert_eq!(st.st_mtim, ts(mtime_ms));

        // Omit atime + Now mtime: atime EXACTLY unchanged, mtime current.
        utimes_path(&wide(&path), FileTimeSpec::Omit, FileTimeSpec::Now).unwrap();
        let st = stat(&path).unwrap();
        assert_eq!(st.st_atim, ts(atime_ms), "Omit must leave atime untouched");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(
            (now - st.st_mtim.sec).abs() < 300,
            "Now mtime {} vs wall clock {now}",
            st.st_mtim.sec
        );

        // Pre-1601 on an existing file: EINVAL shape, times untouched.
        assert_eq!(
            utimes_path(
                &wide(&path),
                FileTimeSpec::UnixTicks((-11_644_473_600_001) * 10_000),
                FileTimeSpec::Omit,
            )
            .unwrap_err(),
            Win32Error::INVALID_PARAMETER
        );
        assert_eq!(stat(&path).unwrap().st_atim, ts(atime_ms));
    }

    /// POSIX utimes works on directories — the BACKUP_SEMANTICS open.
    /// // quirk: FSMETA-30
    #[test]
    fn utimes_directory_works() {
        let mut fx = Fixture::new("utimedir");
        let dir = fx.dir("sub");
        let when = 1_234_567_890_000i64;
        utimes_path(
            &wide(&dir),
            FileTimeSpec::UnixTicks((when) * 10_000),
            FileTimeSpec::UnixTicks((when) * 10_000),
        )
        .unwrap();
        let st = stat(&dir).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFDIR);
        assert_eq!(st.st_mtim, ts(when));
        assert_eq!(st.st_atim, ts(when));
    }

    /// futimes uses the handle directly; a read-only handle lacks
    /// FILE_WRITE_ATTRIBUTES and fails ACCESS_DENIED — the pinned libuv/Node
    /// POSIX deviation (no ReOpenFile dance). // quirk: FSMETA-34
    #[test]
    fn futimes_handle_and_readonly_fd_deviation() {
        let mut fx = Fixture::new("futimes");
        let path = fx.file("f.bin", b"x");
        let when = 1_555_555_555_500i64;

        let h = crate::fsio::open_path(&wide(&path), OpenFlags::RDWR, false).unwrap();
        {
            let _g = HandleGuard(h);
            // SAFETY: live test handle.
            unsafe {
                futimes_handle(
                    h,
                    FileTimeSpec::UnixTicks((when) * 10_000),
                    FileTimeSpec::UnixTicks((when) * 10_000),
                )
            }
            .unwrap();
        }
        let st = stat(&path).unwrap();
        assert_eq!(st.st_mtim, ts(when));
        assert_eq!(st.st_atim, ts(when));

        let ro = crate::fsio::open_path(&wide(&path), OpenFlags::RDONLY, false).unwrap();
        {
            let _g = HandleGuard(ro);
            // SAFETY: live test handle.
            let result = unsafe { futimes_handle(ro, FileTimeSpec::Now, FileTimeSpec::Now) };
            assert_eq!(result, Err(Win32Error::ACCESS_DENIED));
        }
        assert_eq!(
            stat(&path).unwrap().st_mtim,
            ts(when),
            "failed futimes must not write"
        );

        // Sentinel handles error cleanly before any kernel call.
        // SAFETY: sentinels are rejected per the contract.
        let invalid =
            unsafe { futimes_handle(INVALID_HANDLE_VALUE, FileTimeSpec::Now, FileTimeSpec::Now) };
        assert_eq!(invalid, Err(Win32Error::INVALID_HANDLE));
        // SAFETY: as above.
        let null = unsafe { futimes_handle(ptr::null_mut(), FileTimeSpec::Now, FileTimeSpec::Now) };
        assert_eq!(null, Err(Win32Error::INVALID_HANDLE));
    }

    /// lutimes addresses the LINK; utimes follows to the target.
    /// // quirk: FSMETA-33
    #[test]
    fn lutimes_junction_sets_link_not_target() {
        let mut fx = Fixture::new("lutimes");
        let target = fx.dir("target");
        let junction = fx.junction("junc", &target);

        let target_before = stat(&target).unwrap();
        let link_ms = 1_600_000_000_000i64;
        lutimes_path(
            &wide(&junction),
            FileTimeSpec::UnixTicks((link_ms) * 10_000),
            FileTimeSpec::UnixTicks((link_ms) * 10_000),
        )
        .unwrap();
        assert_eq!(lstat(&junction).unwrap().st_mtim, ts(link_ms));
        assert_eq!(
            stat(&target).unwrap().st_mtim,
            target_before.st_mtim,
            "lutimes must not touch the target"
        );

        // utimes (follow) through the junction reaches the target dir.
        let target_ms = 1_500_000_000_000i64;
        utimes_path(
            &wide(&junction),
            FileTimeSpec::UnixTicks((target_ms) * 10_000),
            FileTimeSpec::UnixTicks((target_ms) * 10_000),
        )
        .unwrap();
        assert_eq!(stat(&target).unwrap().st_mtim, ts(target_ms));
        assert_eq!(
            lstat(&junction).unwrap().st_mtim,
            ts(link_ms),
            "follow-utimes must not touch the link"
        );
    }

    // ── chmod / fchmod ──

    /// chmod toggles exactly the READONLY attribute and never follows links
    /// (silent lchmod, the libuv `_wchmod` semantics). // quirk: FSMETA-36
    #[test]
    fn chmod_toggles_readonly_and_does_not_follow_links() {
        let mut fx = Fixture::new("chmod");
        let path = fx.file("c.bin", b"x");

        chmod_path(&wide(&path), true).unwrap();
        assert!(file_attrs(&path) & FILE_ATTRIBUTE_READONLY != 0);
        assert_eq!(stat(&path).unwrap().st_mode, S_IFREG | 0o444);

        chmod_path(&wide(&path), false).unwrap();
        assert_eq!(file_attrs(&path) & FILE_ATTRIBUTE_READONLY, 0);
        assert_eq!(stat(&path).unwrap().st_mode, S_IFREG | 0o666);

        assert_eq!(
            chmod_path(&wide(&fx.root.join("nope.bin")), true).unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );

        // lchmod semantics: chmod of a junction marks the LINK readonly; the
        // target keeps its attributes.
        let target = fx.dir("chmod_target");
        let junction = fx.junction("chmod_junc", &target);
        chmod_path(&wide(&junction), true).unwrap();
        assert!(
            file_attrs(&junction) & FILE_ATTRIBUTE_READONLY != 0,
            "junction itself must take the bit"
        );
        assert_eq!(
            file_attrs(&target) & FILE_ATTRIBUTE_READONLY,
            0,
            "target must be untouched"
        );
        chmod_path(&wide(&junction), false).unwrap();
        assert_eq!(file_attrs(&junction) & FILE_ATTRIBUTE_READONLY, 0);
    }

    /// The fchmod ReOpenFile + Archive-flag dance: clearing READONLY on a
    /// `+R -A` file must actually stick (the FileAttributes==0 sentinel is
    /// dodged with FILE_ATTRIBUTE_NORMAL). // quirk: FSMETA-37, FSMETA-38
    #[test]
    fn fchmod_archive_dance_on_plus_r_minus_a_file() {
        let mut fx = Fixture::new("fchmod");
        let path = fx.file("a.bin", b"x");
        let w = wide(&path);

        // The repro: READONLY set, ARCHIVE clear (`attrib -A +R file`).
        // SAFETY: NUL-terminated path.
        assert!(unsafe { SetFileAttributesW(w.as_ptr(), FILE_ATTRIBUTE_READONLY) } != 0);
        assert_eq!(file_attrs(&path), FILE_ATTRIBUTE_READONLY);

        // A read-only data handle suffices: ReOpenFile acquires the
        // attribute right on demand (attribute access is exempt from
        // sharing checks). // quirk: FSMETA-37
        let h = crate::fsio::open_path(&w, OpenFlags::RDONLY, false).unwrap();
        {
            let _g = HandleGuard(h);
            // SAFETY: live test handle.
            unsafe { fchmod_handle(h, false) }.unwrap();
        }
        // READONLY cleared; the all-bits-clear result was substituted with
        // NORMAL so the write was not silently ignored.
        assert_eq!(file_attrs(&path), FILE_ATTRIBUTE_NORMAL);

        // Round trip back to readonly via a fresh handle: ARCHIVE (set
        // during the dance) is cleared again, READONLY persists.
        let h = crate::fsio::open_path(&w, OpenFlags::RDONLY, false).unwrap();
        {
            let _g = HandleGuard(h);
            // SAFETY: live test handle.
            unsafe { fchmod_handle(h, true) }.unwrap();
        }
        let attrs = file_attrs(&path);
        assert!(attrs & FILE_ATTRIBUTE_READONLY != 0);
        assert_eq!(
            attrs & FILE_ATTRIBUTE_ARCHIVE,
            0,
            "dance must restore ARCHIVE clear"
        );
        assert_eq!(stat(&path).unwrap().st_mode, S_IFREG | 0o444);

        // Sentinel handles error cleanly.
        // SAFETY: sentinels are rejected per the contract.
        let invalid = unsafe { fchmod_handle(INVALID_HANDLE_VALUE, false) };
        assert_eq!(invalid, Err(Win32Error::INVALID_HANDLE));
    }

    // ── chown family ──

    /// All three are unconditional success no-ops — they must succeed even
    /// for nonexistent paths and sentinel handles (the exact libuv shape:
    /// the args are never read). // quirk: FSMETA-46
    #[test]
    fn chown_family_unconditional_noop_success() {
        let missing = wide_str("C:\\bun_winfs_does_not_exist_9c1\\nope");
        assert_eq!(chown_path(&missing, 1000, 1000), Ok(()));
        assert_eq!(lchown_path(&missing, 0, 0), Ok(()));
        assert_eq!(fchown_handle(INVALID_HANDLE_VALUE, 42, 42), Ok(()));
        assert_eq!(fchown_handle(ptr::null_mut(), u32::MAX, u32::MAX), Ok(()));
    }

    // ── access ──

    /// The full matrix: W_OK is the only consulted bit, readonly directories
    /// still grant write, links are not followed. // quirk: FSMETA-39, FSMETA-40
    #[test]
    fn access_matrix() {
        let mut fx = Fixture::new("access");
        let file = fx.file("plain.bin", b"x");
        let wf = wide(&file);

        for mode in [
            AccessMode::F_OK,
            AccessMode::R_OK,
            AccessMode::W_OK,
            AccessMode::X_OK,
            AccessMode::R_OK | AccessMode::W_OK | AccessMode::X_OK,
        ] {
            assert_eq!(
                access_path(&wf, mode),
                Ok(()),
                "writable file, mode {mode:?}"
            );
        }

        chmod_path(&wf, true).unwrap();
        // R_OK / X_OK / F_OK collapse to "attributes readable" — X_OK is
        // silently F_OK even on a readonly file. // quirk: FSMETA-39
        for mode in [AccessMode::F_OK, AccessMode::R_OK, AccessMode::X_OK] {
            assert_eq!(
                access_path(&wf, mode),
                Ok(()),
                "readonly file, mode {mode:?}"
            );
        }
        // W_OK on a readonly file: raw ACCESS_DENIED (EPERM downstream).
        assert_eq!(
            access_path(&wf, AccessMode::W_OK).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );
        assert_eq!(
            access_path(&wf, AccessMode::R_OK | AccessMode::W_OK).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );
        chmod_path(&wf, false).unwrap();

        // Directories cannot be read-only on Windows: W_OK succeeds even
        // with the bit set. // quirk: FSMETA-39
        let dir = fx.dir("rodir");
        let wd = wide(&dir);
        chmod_path(&wd, true).unwrap();
        assert_eq!(access_path(&wd, AccessMode::W_OK), Ok(()));
        chmod_path(&wd, false).unwrap();

        // Missing path: the GetFileAttributesW error verbatim.
        assert_eq!(
            access_path(&wide(&fx.root.join("missing")), AccessMode::F_OK).unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );

        // No-follow: a dangling junction still answers F_OK and W_OK from
        // the link's own attributes. // quirk: FSMETA-40
        let target = fx.dir("gone");
        let junction = fx.junction("dangling", &target);
        crate::fslnk::rmdir_path(&wide(&target)).unwrap();
        let wj = wide(&junction);
        assert!(stat(&junction).is_err(), "junction must be dangling");
        assert_eq!(access_path(&wj, AccessMode::F_OK), Ok(()));
        assert_eq!(access_path(&wj, AccessMode::W_OK), Ok(()));
    }

    // ── realpath ──

    /// THE raw-prefix contract: the engine returns the final path with the
    /// `\\?\` prefix UNTOUCHED (the wrapper's rewrite_final_path_prefix is
    /// the only rewriter) — pinned against std::fs::canonicalize, which uses
    /// the same kernel API. Also: relative→absolute resolution.
    /// // quirk: FSMETA-41
    #[test]
    fn realpath_raw_prefix_and_relative_resolution() {
        let mut fx = Fixture::new("rp");
        let path = fx.file("rp_probe.bin", b"x");

        let resolved = realpath_path(&wide(&path)).unwrap();
        assert!(
            resolved.starts_with(&wide_str("\\\\?\\")[..4]),
            "raw final path must keep the \\\\?\\ prefix: {:?}",
            String::from_utf16_lossy(&resolved)
        );
        assert!(!resolved.contains(&0), "output carries no NUL terminator");
        let oracle: Vec<u16> = std::fs::canonicalize(&path)
            .unwrap()
            .as_os_str()
            .encode_wide()
            .collect();
        assert_eq!(
            resolved, oracle,
            "must match the canonicalize oracle verbatim"
        );

        // Relative path resolves against the CWD to the same raw path.
        let prev = std::env::current_dir().unwrap();
        std::env::set_current_dir(&fx.root).unwrap();
        let via_relative = realpath_path(&wide_str("rp_probe.bin"));
        std::env::set_current_dir(prev).unwrap();
        assert_eq!(via_relative.unwrap(), resolved);

        // Missing file: the open error verbatim.
        assert_eq!(
            realpath_path(&wide(&fx.root.join("missing.bin"))).unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );
    }

    /// realpath resolves junctions (and symlinks where creatable) to the
    /// target, canonicalizes on-disk case, and succeeds on exclusively
    /// locked files thanks to the zero-access open.
    /// // quirk: FSMETA-41, FSMETA-43
    #[test]
    fn realpath_resolves_links_case_and_locked_files() {
        let mut fx = Fixture::new("rplinks");
        let target = fx.dir("RealTarget");
        fx.file("RealTarget\\inside.bin", b"x");
        let junction = fx.junction("via_junc", &target);

        let direct = realpath_path(&wide(&target.join("inside.bin"))).unwrap();
        let through = realpath_path(&wide(&junction.join("inside.bin"))).unwrap();
        assert_eq!(through, direct, "junction must resolve to the target path");

        // On-disk case wins over the caller's spelling. // quirk: FSMETA-43
        let miscased = fx.root.join("realtarget").join("INSIDE.BIN");
        assert_eq!(realpath_path(&wide(&miscased)).unwrap(), direct);

        // A file locked with share mode 0 still realpaths (access 0 open).
        // // quirk: FSMETA-41
        let locked = fx.file("locked.bin", b"L");
        let wl = wide(&locked);
        // SAFETY: NUL-terminated path; deny-all lock held by the guard.
        let lock = unsafe {
            CreateFileW(
                wl.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        assert!(lock != INVALID_HANDLE_VALUE);
        let _g = HandleGuard(lock);
        let resolved = realpath_path(&wl).unwrap();
        assert!(resolved.ends_with(&wide_str("locked.bin")[..10]));

        // Symlink resolution when the privilege is available.
        let link = fx.root.join("sym.bin");
        let wlink = wide(&link);
        let wtarget = wide(&locked);
        // SAFETY: NUL-terminated paths.
        let ok = unsafe {
            CreateSymbolicLinkW(
                wlink.as_ptr(),
                wtarget.as_ptr(),
                SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE,
            )
        };
        if ok == 0 {
            let e = Win32Error::get();
            assert!(
                e == Win32Error::PRIVILEGE_NOT_HELD || e == Win32Error::INVALID_PARAMETER,
                "CreateSymbolicLinkW: {e:?}"
            );
            eprintln!("skip: symlink arm needs Developer Mode ({e:?})");
            return;
        }
        fx.track(&link, false);
        assert_eq!(realpath_path(&wlink).unwrap(), resolved);
    }

    /// WTF-16 pass-through: a lone surrogate in a component survives
    /// realpath byte-for-byte (real Windows paths contain them).
    #[test]
    fn realpath_lone_surrogate_component() {
        let mut fx = Fixture::new("rpwtf");
        let mut name: Vec<u16> = OsStr::new("lone_").encode_wide().collect();
        name.push(0xD800); // unpaired high surrogate
        name.extend(OsStr::new(".bin").encode_wide());
        let path = fx.root.join(OsString::from_wide(&name));
        let h = crate::fsio::open_path(
            &wide(&path),
            OpenFlags::WRONLY | OpenFlags::CREAT | OpenFlags::TRUNC,
            false,
        )
        .unwrap_or_else(|e| panic!("create lone-surrogate file: {e:?}"));
        // SAFETY: freshly opened handle, closed exactly once.
        unsafe { crate::fsio::close(h) }.unwrap();
        fx.track(&path, false);

        let resolved = realpath_path(&wide(&path)).unwrap();
        assert!(
            resolved.windows(name.len()).any(|w| w == &name[..]),
            "lone surrogate must survive: {resolved:?}"
        );
    }

    // ── statfs ──

    /// Sane fields + the exact mapping against the byte-granular
    /// GetDiskFreeSpaceExW oracle; file paths work (the handle approach).
    /// // quirk: FSMETA-44, FSMETA-45
    #[test]
    fn statfs_fields_and_disk_free_space_oracle() {
        let mut fx = Fixture::new("statfs");
        let file = fx.file("probe.bin", b"x");

        let mut sf = WindowsStatFs::default();
        statfs_path(&wide(&fx.root), &mut sf).unwrap();

        assert!(sf.f_bsize > 0, "cluster size must be nonzero");
        assert_eq!(sf.f_bsize % 512, 0, "cluster size is a sector multiple");
        assert_eq!(sf.f_frsize, sf.f_bsize);
        assert_eq!((sf.f_type, sf.f_files, sf.f_ffree), (0, 0, 0));
        assert!(sf.f_blocks > 0);
        assert!(sf.f_bfree <= sf.f_blocks, "free <= total");
        assert!(sf.f_bavail <= sf.f_bfree, "caller-available <= raw free");

        // statfs of a FILE path answers for its volume — the c68ca444 form.
        // // quirk: FSMETA-44
        let mut sf_file = WindowsStatFs::default();
        statfs_path(&wide(&file), &mut sf_file).unwrap();
        assert_eq!(sf_file.f_bsize, sf.f_bsize);
        assert_eq!(sf_file.f_blocks, sf.f_blocks);

        // Oracle: TotalNumberOfBytes is stable, so the blocks×bsize product
        // must match EXACTLY; the free counts move with concurrent disk
        // activity, so they get a generous tolerance.
        let root_w = wide(&fx.root);
        let (mut caller, mut total, mut free) = (0u64, 0u64, 0u64);
        // SAFETY: NUL-terminated path; owned u64 out-params.
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                root_w.as_ptr(),
                &raw mut caller,
                &raw mut total,
                &raw mut free,
            )
        };
        assert!(ok != 0, "GetDiskFreeSpaceExW: {:?}", Win32Error::get());
        assert_eq!(
            sf.f_blocks * sf.f_bsize,
            total,
            "TotalAllocationUnits × cluster size must equal the byte total"
        );
        const SLACK: u64 = 1 << 30; // disk churn tolerance
        assert!(
            (sf.f_bfree * sf.f_bsize).abs_diff(free) < SLACK,
            "Actual free {} vs oracle {free}",
            sf.f_bfree * sf.f_bsize
        );
        assert!(
            (sf.f_bavail * sf.f_bsize).abs_diff(caller) < SLACK,
            "Caller free {} vs oracle {caller}",
            sf.f_bavail * sf.f_bsize
        );

        assert_eq!(
            statfs_path(&wide(&fx.root.join("missing")), &mut sf).unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );
    }

    // ── copyfile ──

    /// Basic copy, EXCL refusal (destination preserved), overwrite, and the
    /// FICLONE pair: best-effort is ignored, FORCE is refused with no side
    /// effects. // quirk: FSMETA-50
    #[test]
    fn copyfile_basic_excl_and_ficlone_flags() {
        let mut fx = Fixture::new("copy");
        let src = fx.file("src.bin", b"PAYLOAD");
        let dst = fx.root.join("dst.bin");
        fx.track(&dst, false);

        copyfile_path(&wide(&src), &wide(&dst), CopyFileFlags::NONE).unwrap();
        assert_eq!(read_small(&dst).unwrap(), b"PAYLOAD");

        // EXCL on an existing destination: raw FILE_EXISTS, dest untouched.
        let other = fx.file("other.bin", b"KEEP");
        assert_eq!(
            copyfile_path(&wide(&src), &wide(&other), CopyFileFlags::EXCL).unwrap_err(),
            Win32Error::FILE_EXISTS
        );
        assert_eq!(read_small(&other).unwrap(), b"KEEP");

        // Without EXCL the destination is replaced.
        copyfile_path(&wide(&src), &wide(&other), CopyFileFlags::NONE).unwrap();
        assert_eq!(read_small(&other).unwrap(), b"PAYLOAD");

        // FICLONE: accepted and ignored — a normal copy happens.
        let cloned = fx.root.join("cloned.bin");
        fx.track(&cloned, false);
        copyfile_path(&wide(&src), &wide(&cloned), CopyFileFlags::FICLONE).unwrap();
        assert_eq!(read_small(&cloned).unwrap(), b"PAYLOAD");

        // FICLONE_FORCE: refused BEFORE any side effect.
        let never = fx.root.join("never.bin");
        assert_eq!(
            copyfile_path(&wide(&src), &wide(&never), CopyFileFlags::FICLONE_FORCE).unwrap_err(),
            Win32Error::NOT_SUPPORTED
        );
        assert!(
            stat(&never).is_err(),
            "FICLONE_FORCE must not create the destination"
        );
    }

    /// A read-only destination fails raw ACCESS_DENIED with content intact —
    /// no special handling, the libuv shape.
    #[test]
    fn copyfile_readonly_destination_access_denied() {
        let mut fx = Fixture::new("copyro");
        let src = fx.file("src.bin", b"NEW");
        let dst = fx.file("dst.bin", b"OLD");
        chmod_path(&wide(&dst), true).unwrap();
        assert_eq!(
            copyfile_path(&wide(&src), &wide(&dst), CopyFileFlags::NONE).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );
        chmod_path(&wide(&dst), false).unwrap();
        assert_eq!(read_small(&dst).unwrap(), b"OLD");
    }

    /// The EBUSY→same-file conversion via the stat engine's dev+ino: the
    /// same path, a case-different spelling, and a hard link all report
    /// success with content intact; a genuinely different locked
    /// destination keeps the raw sharing violation. // quirk: FSMETA-50
    #[test]
    fn copyfile_same_file_converts_via_dev_ino() {
        let mut fx = Fixture::new("copysame");
        let src = fx.file("same.bin", b"CONTENT");
        let w = wide(&src);

        // Identical path: CopyFileW collides with itself.
        copyfile_path(&w, &w, CopyFileFlags::NONE).unwrap();
        assert_eq!(read_small(&src).unwrap(), b"CONTENT");

        // Case-different spelling of the same file.
        let spelled = fx.root.join("SAME.BIN");
        copyfile_path(&w, &wide(&spelled), CopyFileFlags::NONE).unwrap();
        assert_eq!(read_small(&src).unwrap(), b"CONTENT");

        // Hard link: distinct name, same dev+ino.
        let linked = fx.root.join("hard.bin");
        crate::fslnk::link_path(&w, &wide(&linked)).unwrap();
        fx.track(&linked, false);
        copyfile_path(&w, &wide(&linked), CopyFileFlags::NONE).unwrap();
        assert_eq!(read_small(&src).unwrap(), b"CONTENT");

        // Different file held with share mode 0: the sharing violation is
        // NOT converted (dev+ino differ).
        let other = fx.file("other.bin", b"OTHER");
        let wo = wide(&other);
        // SAFETY: NUL-terminated path; deny-all lock held by the guard.
        let lock = unsafe {
            CreateFileW(
                wo.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        assert!(lock != INVALID_HANDLE_VALUE);
        let _g = HandleGuard(lock);
        assert_eq!(
            copyfile_path(&w, &wo, CopyFileFlags::NONE).unwrap_err(),
            Win32Error::SHARING_VIOLATION
        );
    }

    // ── mkdtemp / mkstemp ──

    /// The mktemp core loop: template validation, the retry-only-on-
    /// collision polarity, and candidate shape. // quirk: FSLNK-27, FSLNK-30
    #[test]
    fn mktemp_core_validation_and_retry_polarity() {
        // Bad templates fail EINVAL-shaped BEFORE the create fn ever runs.
        for bad in ["", "abc", "abcXXXXX", "XXXXXXa", "XXXXX", "Xxxxxxx"] {
            let mut calls = 0;
            let result = mktemp_impl(&wide_str(bad), |_| {
                calls += 1;
                MktempOutcome::Done(())
            });
            assert_eq!(
                result.map(|(name, ())| name).unwrap_err(),
                Win32Error::INVALID_PARAMETER,
                "template {bad:?}"
            );
            assert_eq!(calls, 0, "template {bad:?} must not reach the create fn");
        }

        // A collision retries with a FRESH name; the prefix and the
        // NUL terminator survive every attempt.
        let template = wide_str("prefix_XXXXXX");
        let mut seen: Vec<Vec<u16>> = Vec::new();
        let (name, ()) = mktemp_impl(&template, |candidate| {
            assert_eq!(candidate.len(), template.len());
            assert_eq!(candidate.last(), Some(&0), "candidate stays NUL-terminated");
            assert_eq!(&candidate[..7], &template[..7], "prefix preserved");
            assert!(
                candidate[7..13].iter().all(|c| TEMPCHARS.contains(c)),
                "suffix drawn from the 62-char alphabet"
            );
            seen.push(candidate.to_vec());
            if seen.len() == 1 {
                MktempOutcome::Collision(Win32Error::ALREADY_EXISTS)
            } else {
                MktempOutcome::Done(())
            }
        })
        .unwrap();
        assert_eq!(seen.len(), 2, "exactly one retry after the collision");
        assert_ne!(seen[0], seen[1], "the retry must draw a fresh name");
        assert_eq!(name, seen[1][..seen[1].len() - 1], "winning name sans NUL");

        // Any non-collision error aborts immediately — never TMP_MAX spins.
        // // quirk: FSLNK-30
        let mut calls = 0;
        let result = mktemp_impl(&template, |_| -> MktempOutcome<()> {
            calls += 1;
            assert!(calls <= 1, "hard errors must not retry");
            MktempOutcome::Fail(Win32Error::ACCESS_DENIED)
        });
        assert_eq!(
            result.map(|(name, ())| name).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );
        assert_eq!(calls, 1);

        // "XXXXXX" alone is a valid template (len == NUM_X).
        let (bare, ()) = mktemp_impl(&wide_str("XXXXXX"), |_| MktempOutcome::Done(())).unwrap();
        assert_eq!(bare.len(), 6);
    }

    /// mkdtemp end-to-end: real directories, unique names, EINVAL templates,
    /// and the missing-parent abort. // quirk: FSLNK-27, FSLNK-29, FSLNK-30
    #[test]
    fn mkdtemp_creates_unique_directories() {
        let mut fx = Fixture::new("mkdtemp");
        let template = wide(&fx.root.join("mkd_XXXXXX"));

        let mut names = HashSet::new();
        for _ in 0..8 {
            let name = mkdtemp_path(&template).unwrap();
            let path = PathBuf::from(OsString::from_wide(&name));
            fx.track(&path, true);
            let st = stat(&path).unwrap_or_else(|e| panic!("created dir must stat: {e:?}"));
            assert_eq!(st.st_mode & S_IFMT, S_IFDIR);
            assert_eq!(
                name[..name.len() - NUM_X],
                template[..template.len() - 1 - NUM_X]
            );
            assert!(names.insert(name), "names must be unique");
        }

        assert_eq!(
            mkdtemp_path(&wide(&fx.root.join("no_exes.txt"))).unwrap_err(),
            Win32Error::INVALID_PARAMETER
        );
        // Missing parent: PATH_NOT_FOUND aborts the loop on attempt one
        // (the FSLNK-30 polarity, observable end-to-end).
        assert_eq!(
            mkdtemp_path(&wide(&fx.root.join("missing\\mkd_XXXXXX"))).unwrap_err(),
            Win32Error::PATH_NOT_FOUND
        );
    }

    /// mkstemp end-to-end: atomic CREATE_NEW files with share-all handles,
    /// usable for I/O, unique names. // quirk: FSLNK-27, FSLNK-31
    #[test]
    fn mkstemp_creates_and_opens_unique_files() {
        let mut fx = Fixture::new("mkstemp");
        let template = wide(&fx.root.join("mks_XXXXXX"));

        let (name_a, handle_a) = mkstemp_path(&template).unwrap();
        let path_a = PathBuf::from(OsString::from_wide(&name_a));
        fx.track(&path_a, false);
        {
            let _g = HandleGuard(handle_a);
            // The returned handle is read/write.
            // SAFETY: live test handle owned by the guard.
            let n = unsafe { crate::fsio::write_at(handle_a, &[b"TMP"], None) };
            assert_eq!(n, Ok(3));
            let mut buf = [0u8; 3];
            // SAFETY: live test handle owned by the guard.
            let n = unsafe { crate::fsio::read_at(handle_a, &mut [&mut buf], Some(0)) };
            assert_eq!(n, Ok(3));
            assert_eq!(&buf, b"TMP");
            // Share-everything: a second reader opens while we hold it.
            // // quirk: FSLNK-31
            let reader = crate::fsio::open_path(&wide(&path_a), OpenFlags::RDONLY, false).unwrap();
            drop(HandleGuard(reader));
        }
        assert_eq!(stat(&path_a).unwrap().st_mode & S_IFMT, S_IFREG);

        let (name_b, handle_b) = mkstemp_path(&template).unwrap();
        let path_b = PathBuf::from(OsString::from_wide(&name_b));
        fx.track(&path_b, false);
        drop(HandleGuard(handle_b));
        assert_ne!(name_a, name_b, "consecutive mkstemp names must differ");

        assert_eq!(
            mkstemp_path(&wide(&fx.root.join("badtemplate"))).unwrap_err(),
            Win32Error::INVALID_PARAMETER
        );
    }
}
