#![cfg(windows)]

//! The Windows open/read/write engine: `open(2)`-style flag mapping over
//! NUL-terminated wide paths, positioned/sequential `read`/`write` over
//! HANDLEs, plus `ftruncate`/`fsync`/`fdatasync`/`close` — at libuv parity
//! (`fs__open` / `fs__read` / `fs__write` / `fs__ftruncate` / `fs__fsync`),
//! ported per the `fs-open-io.md` ledger area.
//!
//! Error policy: raw `Win32Error` out of every function, translated nowhere
//! in-engine. The direction-dependent remaps libuv hardcodes here
//! (`ACCESS_DENIED`→EBADF on wrong-direction file I/O, `INVALID_FUNCTION`→
//! EISDIR on directory I/O, `HANDLE_EOF`/`BROKEN_PIPE`→read()==0) already
//! live in `bun_errno::win_error::classify_file_read`/`classify_file_write`
//! and are deliberately NOT duplicated — the engine surfaces the raw code and
//! the consumer classifies exactly once. // quirk: FSIO-23, FSIO-24, FSIO-25
//!
//! One open-path remap cannot move downstream wholesale: ERROR_FILE_EXISTS
//! from a `CREAT`-without-`EXCL` open means "the path was a directory" and
//! must become EISDIR, not EEXIST. The engine returns the raw code; the
//! `bun_sys` wrapper (which also holds the flags) applies that rewrite.
//! // quirk: FSIO-06
//!
//! Positioned I/O is a SINGLE `ReadFile`/`WriteFile` carrying
//! `OVERLAPPED.Offset` — not libuv's SetFilePointerEx(save) → I/O → restore
//! triple. Consequence (kernel contract, empirically pinned by tests): on a
//! synchronous handle the I/O manager sets the shared file pointer to
//! `offset + transferred` after a positioned op, so sequential position is
//! NOT preserved across positioned ops on the same handle. Data placement is
//! race-free (the offset rides inside each syscall), which is the property
//! the save/seek/restore dance cannot give concurrent callers. Callers that
//! need POSIX pread/pwrite pointer semantics own the sequential position
//! themselves (the fd-table stage). // quirk: FSIO-21, FSIO-22
//!
//! Everything here is synchronous and loop-free: callable before any event
//! loop or threadpool exists. // quirk: FSIO-56

use core::mem::size_of;
use core::ptr;

use bun_windows_sys::kernel32::{GetOverlappedResult, FlushFileBuffers, ReadFile, WriteFile};
use bun_windows_sys::ntdll::NtSetInformationFile;
use bun_windows_sys::{
    ACCESS_MASK, CREATE_ALWAYS, CREATE_NEW, CloseHandle, CreateFileW, DELETE, DWORD,
    FILE_APPEND_DATA, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY, FILE_ATTRIBUTE_TEMPORARY,
    FILE_END_OF_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_DELETE_ON_CLOSE,
    FILE_FLAG_NO_BUFFERING, FILE_FLAG_RANDOM_ACCESS, FILE_FLAG_SEQUENTIAL_SCAN,
    FILE_FLAG_WRITE_THROUGH, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_INFORMATION_CLASS,
    FILE_WRITE_DATA, HANDLE, INVALID_HANDLE_VALUE, IO_STATUS_BLOCK, NT_SUCCESS, OPEN_ALWAYS,
    OPEN_EXISTING, OVERLAPPED, TRUNCATE_EXISTING, ULONG, Win32Error,
};

use crate::stat::SHARE_ALL;

/// Per-syscall byte cap (libuv `UV__IO_MAX_BYTES`, uv-common.h:234 — the same
/// 0x7ffff000 Linux applies per syscall). Each `ReadFile`/`WriteFile` length
/// is clamped to it; oversized buffers short-read/short-write and the caller
/// loops. // quirk: FSIO-27
pub const IO_MAX_BYTES: usize = 0x7fff_f000;

// ───────────────────────────── flags ─────────────────────────────

/// POSIX-ish open flags, bit-for-bit the UCRT `_O_*` values (`fcntl.h`) plus
/// libuv's Windows-only high bits (`uv/win.h:675-698`) — a node
/// `fs.constants` flags integer passes through unchanged. Unknown bits are
/// ignored, matching libuv (the CRT ignores bits it does not know).
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct OpenFlags(pub u32);

impl OpenFlags {
    pub const RDONLY: Self = Self(0x0000); // _O_RDONLY
    pub const WRONLY: Self = Self(0x0001); // _O_WRONLY
    pub const RDWR: Self = Self(0x0002); // _O_RDWR
    pub const APPEND: Self = Self(0x0008); // _O_APPEND
    pub const RANDOM: Self = Self(0x0010); // _O_RANDOM
    pub const SEQUENTIAL: Self = Self(0x0020); // _O_SEQUENTIAL
    pub const TEMPORARY: Self = Self(0x0040); // _O_TEMPORARY
    pub const CREAT: Self = Self(0x0100); // _O_CREAT
    pub const TRUNC: Self = Self(0x0200); // _O_TRUNC
    pub const EXCL: Self = Self(0x0400); // _O_EXCL
    pub const SHORT_LIVED: Self = Self(0x1000); // _O_SHORT_LIVED
    /// Zero on Windows (libuv `UV_FS_O_DIRECTORY`, win.h:690): directories
    /// open via the unconditional BACKUP_SEMANTICS flag; there is no
    /// ENOTDIR enforcement at open time. // quirk: FSIO-07
    pub const DIRECTORY: Self = Self(0);
    pub const DIRECT: Self = Self(0x0200_0000); // UV_FS_O_DIRECT
    pub const DSYNC: Self = Self(0x0400_0000); // UV_FS_O_DSYNC
    pub const SYNC: Self = Self(0x0800_0000); // UV_FS_O_SYNC
    /// Share mode 0 — the only mandatory-lock/raw-block-device escape hatch
    /// from the always-share default. // quirk: FSIO-02
    pub const EXLOCK: Self = Self(0x1000_0000); // UV_FS_O_EXLOCK
    /// Accepted and ignored: a perf hint whose libuv machinery exists only
    /// to emulate the normal path's semantics. // quirk: FSIO-31
    pub const FILEMAP: Self = Self(0x2000_0000); // UV_FS_O_FILEMAP

    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

impl core::ops::BitOr for OpenFlags {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl core::ops::BitOrAssign for OpenFlags {
    #[inline]
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

// ───────────────────────────── open ─────────────────────────────

/// open(2) over a NUL-terminated wide (WTF-16) path — libuv `fs__open`'s
/// flag/share/disposition matrix, minus the CRT fd minting (the fd table is a
/// separate layer). The path passes to `CreateFileW` verbatim: no `\\?\`
/// prefixing, no normalization, no pre-open probe — classification derives
/// from the open error or the opened handle. // quirk: FSIO-12, FSIO-13
///
/// `mode_readonly` is the caller's pre-computed `!((mode & ~umask) &
/// S_IWRITE)`: on `CREAT`, a newly created file gets
/// `FILE_ATTRIBUTE_READONLY`. The attribute applies only when the file is
/// actually created, and the just-opened handle keeps the write access it
/// requested, so create-write-close on a 0444 file works like POSIX.
/// // quirk: FSIO-08
///
/// Flag-combination validation errors are `ERROR_INVALID_PARAMETER` (the
/// libuv EINVAL shape): both of WRONLY|RDWR, SEQUENTIAL+RANDOM,
/// DSYNC+SYNC, or DIRECT with append-only access. `ERROR_FILE_EXISTS` from a
/// `CREAT`-without-`EXCL` open means the path was a directory (EISDIR
/// downstream, FSIO-06 — the wrapper's rewrite); with `EXCL` it is plain
/// EEXIST. The returned handle is never inheritable (null security
/// attributes). // quirk: FSIO-14
pub fn open_path(
    path_w: &[u16],
    flags: OpenFlags,
    mode_readonly: bool,
) -> Result<HANDLE, Win32Error> {
    let Some((&0, units)) = path_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!units.contains(&0), "interior NUL in wide path");

    // FILEMAP is a no-op perf hint here; strip before any validation so the
    // bit can never trip a combination check. // quirk: FSIO-31
    let flags = OpenFlags(flags.0 & !OpenFlags::FILEMAP.0);

    // FILE_GENERIC_* (decomposed), not GENERIC_*: O_APPEND must be able to
    // subtract FILE_WRITE_DATA so the kernel enforces atomic-append via the
    // sole FILE_APPEND_DATA right. // quirk: FSIO-03
    const RW_RDONLY: u32 = OpenFlags::RDONLY.0;
    const RW_WRONLY: u32 = OpenFlags::WRONLY.0;
    const RW_RDWR: u32 = OpenFlags::RDWR.0;
    const RW_MASK: u32 = RW_RDONLY | RW_WRONLY | RW_RDWR;
    let mut access: ACCESS_MASK = match flags.0 & RW_MASK {
        RW_RDONLY => FILE_GENERIC_READ,
        RW_WRONLY => FILE_GENERIC_WRITE,
        RW_RDWR => FILE_GENERIC_READ | FILE_GENERIC_WRITE,
        _ => return Err(Win32Error::INVALID_PARAMETER),
    };
    if flags.contains(OpenFlags::APPEND) {
        access &= !FILE_WRITE_DATA;
        access |= FILE_APPEND_DATA; // quirk: FSIO-03
    }

    let share: DWORD = if flags.contains(OpenFlags::EXLOCK) {
        0 // quirk: FSIO-02
    } else {
        SHARE_ALL // quirk: FSIO-01
    };

    // The verbatim libuv disposition table (fs.c:515-536), all 8 combos
    // pinned including the POSIX-undefined ones. TRUNCATE_EXISTING demands
    // the literal GENERIC_WRITE meta-bit, which the decomposed rights lack:
    // bare O_TRUNC fails ERROR_INVALID_PARAMETER pre-path-resolution for
    // every rw mode — stock libuv behaves identically (same call); 'w'-style
    // CREAT|TRUNC takes CREATE_ALWAYS and is unaffected. // quirk: FSIO-05
    const C: u32 = OpenFlags::CREAT.0;
    const X: u32 = OpenFlags::EXCL.0;
    const T: u32 = OpenFlags::TRUNC.0;
    const CX: u32 = C | X;
    const CT: u32 = C | T;
    const TX: u32 = T | X;
    const CTX: u32 = C | T | X;
    let disposition: DWORD = match flags.0 & CTX {
        0 | X => OPEN_EXISTING,
        C => OPEN_ALWAYS,
        CX | CTX => CREATE_NEW,
        T | TX => TRUNCATE_EXISTING,
        CT => CREATE_ALWAYS,
        _ => return Err(Win32Error::INVALID_PARAMETER),
    };

    let mut attributes: DWORD = FILE_ATTRIBUTE_NORMAL;
    if flags.contains(OpenFlags::CREAT) && mode_readonly {
        attributes |= FILE_ATTRIBUTE_READONLY; // quirk: FSIO-08
    }
    if flags.contains(OpenFlags::TEMPORARY) {
        // DELETE_ON_CLOSE fails at open unless the handle holds the DELETE
        // right. // quirk: FSIO-09
        attributes |= FILE_FLAG_DELETE_ON_CLOSE | FILE_ATTRIBUTE_TEMPORARY;
        access |= DELETE;
    }
    if flags.contains(OpenFlags::SHORT_LIVED) {
        attributes |= FILE_ATTRIBUTE_TEMPORARY; // quirk: FSIO-09
    }
    const SEQ: u32 = OpenFlags::SEQUENTIAL.0;
    const RAND: u32 = OpenFlags::RANDOM.0;
    match flags.0 & (SEQ | RAND) {
        0 => {}
        SEQ => attributes |= FILE_FLAG_SEQUENTIAL_SCAN,
        RAND => attributes |= FILE_FLAG_RANDOM_ACCESS,
        _ => return Err(Win32Error::INVALID_PARAMETER), // quirk: FSIO-09
    }
    if flags.contains(OpenFlags::DIRECT) {
        // FILE_APPEND_DATA + FILE_FLAG_NO_BUFFERING is an undocumented
        // ERROR_INVALID_PARAMETER combination: drop APPEND_DATA when
        // WRITE_DATA also covers appends, fail when append-only.
        // // quirk: FSIO-04
        if access & FILE_APPEND_DATA != 0 {
            if access & FILE_WRITE_DATA != 0 {
                access &= !FILE_APPEND_DATA;
            } else {
                return Err(Win32Error::INVALID_PARAMETER);
            }
        }
        attributes |= FILE_FLAG_NO_BUFFERING;
    }
    const DSYNC: u32 = OpenFlags::DSYNC.0;
    const SYNC: u32 = OpenFlags::SYNC.0;
    match flags.0 & (DSYNC | SYNC) {
        0 => {}
        // Either alone maps to write-through; both together is the libuv
        // EINVAL deviation from Linux (where O_SYNC contains O_DSYNC).
        DSYNC | SYNC => attributes |= FILE_FLAG_WRITE_THROUGH, // quirk: FSIO-10
        _ => return Err(Win32Error::INVALID_PARAMETER),        // quirk: FSIO-10
    }
    // Unconditionally, so directories can be opened at all; read/write on a
    // directory handle then fails ERROR_INVALID_FUNCTION (EISDIR downstream).
    // // quirk: FSIO-07
    attributes |= FILE_FLAG_BACKUP_SEMANTICS;

    // SAFETY: `path_w` is NUL-terminated (validated above); null security
    // attributes (non-inheritable handle) and null template have no pointer
    // preconditions.
    let handle = unsafe {
        CreateFileW(
            path_w.as_ptr(),
            access,
            share,
            ptr::null_mut(),
            disposition,
            attributes,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    Ok(handle)
}

// ───────────────────────────── read / write ─────────────────────────────

/// Computes the per-iteration OVERLAPPED pointer: positioned ops re-arm
/// `Offset` to `base + transferred` before every buffer — the kernel never
/// auto-advances between calls. // quirk: FSIO-22
#[inline]
fn arm_overlapped(
    overlapped: &mut OVERLAPPED,
    offset: Option<u64>,
    transferred: usize,
) -> *mut core::ffi::c_void {
    match offset {
        Some(base) => {
            // Hostile offsets near u64::MAX wrap rather than panic; the
            // kernel rejects them downstream. // quirk: FSIO-30
            let pos = base.wrapping_add(transferred as u64);
            overlapped.Offset = pos as DWORD;
            overlapped.OffsetHigh = (pos >> 32) as DWORD;
            ptr::from_mut(overlapped).cast()
        }
        // offset=None ⇒ sequential: null OVERLAPPED, the kernel uses and
        // advances the handle's file pointer. // quirk: FSIO-30
        None => ptr::null_mut(),
    }
}

/// read(2)/pread(2): fills `bufs` in order from `offset` (or the handle's
/// file pointer when `None`), one clamped `ReadFile` per buffer — there is no
/// scatter API for buffered handles. // quirk: FSIO-22, FSIO-27
///
/// Returns `Ok(total)` whenever any bytes transferred, even if a later
/// buffer failed (POSIX readv short-count semantics) — a short read does not
/// stop the loop; the next call reports EOF. A zero-byte failure returns the
/// raw error, including `ERROR_HANDLE_EOF`/`ERROR_BROKEN_PIPE` (both mean
/// read()==0) and `ERROR_ACCESS_DENIED` (wrong-direction handle):
/// `bun_errno::win_error::classify_file_read` owns those meanings.
/// `Ok(0)` is returned for empty/zero-length `bufs` without a syscall —
/// the EINVAL-on-no-buffers guard is the wrapper's. // quirk: FSIO-23,
/// FSIO-24, FSIO-26, FSIO-47
///
/// Positioned reads move the kernel file pointer to `offset + total` (see
/// module docs). On non-seekable handles (pipes) the kernel ignores the
/// offset and reads sequentially, libuv's exact outcome. // quirk: FSIO-21,
/// FSIO-29
///
/// # Safety
/// `handle` must be a live handle owned by the caller for the duration of
/// the call, opened WITHOUT `FILE_FLAG_OVERLAPPED` (this engine issues only
/// synchronous I/O).
pub unsafe fn read_at(
    handle: HANDLE,
    bufs: &mut [&mut [u8]],
    offset: Option<u64>,
) -> Result<usize, Win32Error> {
    let mut overlapped = OVERLAPPED {
        Internal: 0,
        InternalHigh: 0,
        Offset: 0,
        OffsetHigh: 0,
        hEvent: ptr::null_mut(),
    };
    let mut total: usize = 0;
    for buf in bufs.iter_mut() {
        let to_read = buf.len().min(IO_MAX_BYTES) as DWORD; // quirk: FSIO-27
        let overlapped_ptr = arm_overlapped(&mut overlapped, offset, total);
        let mut incremental: DWORD = 0;
        // SAFETY: `handle` validity is the caller's contract; `buf` is a live
        // mutable slice valid for `to_read` ≤ its length; `incremental` is an
        // owned out-param; `overlapped`, when non-null, outlives this
        // synchronous call.
        let ok = unsafe {
            ReadFile(
                handle,
                buf.as_mut_ptr(),
                to_read,
                &raw mut incremental,
                overlapped_ptr,
            )
        };
        total += incremental as usize;
        if ok == 0 {
            let err = Win32Error::get();
            if err == Win32Error::IO_PENDING {
                // Overlapped-opened handle (table fds can be): the kernel now
                // owns `overlapped` — returning would dangle it. Wait it out;
                // sync semantics either way. // quirk: FSIO-21
                incremental = 0;
                // SAFETY: same liveness as the ReadFile above; bWait blocks
                // until the kernel releases `overlapped`.
                let ok2 = unsafe {
                    GetOverlappedResult(handle, &raw mut overlapped, &raw mut incremental, 1)
                };
                total += incremental as usize;
                if ok2 == 0 {
                    let err2 = Win32Error::get();
                    if total > 0 {
                        return Ok(total); // quirk: FSIO-26
                    }
                    return Err(err2); // quirk: FSIO-23
                }
                continue;
            }
            if total > 0 {
                return Ok(total); // partial success wins // quirk: FSIO-26
            }
            return Err(err); // raw — EOF codes included // quirk: FSIO-23
        }
    }
    Ok(total)
}

/// write(2)/pwrite(2): writes `bufs` in order at `offset` (or the file
/// pointer when `None`), one clamped `WriteFile` per buffer with the
/// explicit per-iteration offset advance. // quirk: FSIO-22, FSIO-27
///
/// Same result shape as [`read_at`]: `Ok(total)` if anything transferred,
/// raw error otherwise (`ERROR_ACCESS_DENIED` = wrong direction,
/// `ERROR_BROKEN_PIPE`/`ERROR_NO_DATA` = reader gone —
/// `bun_errno::win_error::classify_file_write` owns the meanings).
/// // quirk: FSIO-24, FSIO-25, FSIO-26
///
/// On an `O_APPEND` handle (sole `FILE_APPEND_DATA` right) the kernel
/// ignores explicit offsets and appends atomically at EOF — deliberately not
/// "fixed", matching Linux pwrite-on-O_APPEND. // quirk: FSIO-28
///
/// # Safety
/// Same contract as [`read_at`].
pub unsafe fn write_at(
    handle: HANDLE,
    bufs: &[&[u8]],
    offset: Option<u64>,
) -> Result<usize, Win32Error> {
    let mut overlapped = OVERLAPPED {
        Internal: 0,
        InternalHigh: 0,
        Offset: 0,
        OffsetHigh: 0,
        hEvent: ptr::null_mut(),
    };
    let mut total: usize = 0;
    for buf in bufs {
        let to_write = buf.len().min(IO_MAX_BYTES) as DWORD; // quirk: FSIO-27
        let overlapped_ptr = arm_overlapped(&mut overlapped, offset, total);
        let mut incremental: DWORD = 0;
        // SAFETY: `handle` validity is the caller's contract; `buf` is a live
        // slice valid for `to_write` ≤ its length; `incremental` is an owned
        // out-param; `overlapped`, when non-null, outlives this synchronous
        // call.
        let ok = unsafe {
            WriteFile(
                handle,
                buf.as_ptr(),
                to_write,
                &raw mut incremental,
                overlapped_ptr,
            )
        };
        total += incremental as usize;
        if ok == 0 {
            let err = Win32Error::get();
            if err == Win32Error::IO_PENDING {
                // Same as read_at: never abandon a kernel-armed stack
                // OVERLAPPED. // quirk: FSIO-21
                incremental = 0;
                // SAFETY: same liveness as the WriteFile above.
                let ok2 = unsafe {
                    GetOverlappedResult(handle, &raw mut overlapped, &raw mut incremental, 1)
                };
                total += incremental as usize;
                if ok2 == 0 {
                    let err2 = Win32Error::get();
                    if total > 0 {
                        return Ok(total); // quirk: FSIO-26
                    }
                    return Err(err2);
                }
                continue;
            }
            if total > 0 {
                return Ok(total); // partial success wins // quirk: FSIO-26
            }
            return Err(err);
        }
    }
    Ok(total)
}

// ───────────────────── ftruncate / fsync / close ─────────────────────

/// ftruncate(2): sets EOF in one atomic
/// `NtSetInformationFile(FileEndOfFileInformation)` — never the racy
/// SetFilePointer+SetEndOfFile two-step; the file pointer is untouched.
/// Failures surface as the DOS translation of the NTSTATUS (negative `len`
/// is `ERROR_INVALID_PARAMETER`; an append-only or read-only handle lacks
/// `FILE_WRITE_DATA` and fails `ERROR_ACCESS_DENIED`). // quirk: FSIO-39,
/// FSIO-03
///
/// # Safety
/// `handle` must be a live handle owned by the caller for the duration of
/// the call.
pub unsafe fn ftruncate(handle: HANDLE, len: i64) -> Result<(), Win32Error> {
    let mut eof_info = FILE_END_OF_FILE_INFORMATION { EndOfFile: len };
    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    // SAFETY: owned out/in-params of exactly the class size; the kernel only
    // reads `eof_info` and writes `io_status`.
    let status = unsafe {
        NtSetInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut eof_info).cast(),
            size_of::<FILE_END_OF_FILE_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileEndOfFileInformation,
        )
    };
    if NT_SUCCESS(status) {
        Ok(())
    } else {
        Err(Win32Error::from_ntstatus(status))
    }
}

/// fsync(2): `FlushFileBuffers` — data and metadata both. Fails
/// `ERROR_ACCESS_DENIED` on read-only handles (the long-standing
/// node-on-Windows EPERM shape).
///
/// # Safety
/// `handle` must be a live handle owned by the caller for the duration of
/// the call.
pub unsafe fn fsync(handle: HANDLE) -> Result<(), Win32Error> {
    // SAFETY: FFI on a caller-guaranteed live handle; no pointer params.
    if unsafe { FlushFileBuffers(handle) } == 0 {
        Err(Win32Error::get())
    } else {
        Ok(())
    }
}

/// fdatasync(2): Windows has a single durability primitive, so this is
/// `fsync` — libuv routes both through one `fs__sync_impl` and the ledger
/// records no distinction to preserve.
///
/// # Safety
/// Same contract as [`fsync`].
pub unsafe fn fdatasync(handle: HANDLE) -> Result<(), Win32Error> {
    // SAFETY: forwarded caller contract.
    unsafe { fsync(handle) }
}

/// close(2): thin `CloseHandle`. The invalid/null sentinels are rejected
/// without reaching the kernel — `CloseHandle(INVALID_HANDLE_VALUE)` aborts
/// under Wine and handle-checking debug layers. Stdio-fd protection (never
/// close fd 0-2) is fd-table policy, not handle policy, and lives in that
/// layer. // quirk: FSIO-50, FSIO-16
///
/// # Safety
/// `handle` must be owned by the caller, not used again after this call, and
/// not concurrently closed elsewhere.
pub unsafe fn close(handle: HANDLE) -> Result<(), Win32Error> {
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(Win32Error::INVALID_HANDLE);
    }
    // SAFETY: sentinel-checked above; ownership/single-close is the caller's
    // contract.
    if unsafe { CloseHandle(handle) } == 0 {
        Err(Win32Error::get())
    } else {
        Ok(())
    }
}

// ───────────────────────────── tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    use bun_windows_sys::kernel32::{GetFileSizeEx, RemoveDirectoryW};
    use bun_windows_sys::ntdll::NtQueryInformationFile;
    use bun_windows_sys::{
        BY_HANDLE_FILE_INFORMATION, CreateDirectoryW, DeleteFileW, FILE_CURRENT,
        FILE_MODE_INFORMATION, FILE_WRITE_THROUGH, FILETIME, GENERIC_READ, GetFileAttributesW,
        GetFileInformationByHandle, LARGE_INTEGER, SetFileAttributesW, SetFilePointerEx,
    };

    use super::*;

    fn wide(p: &Path) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        p.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn open(path: &Path, flags: OpenFlags) -> Result<HANDLE, Win32Error> {
        open_path(&wide(path), flags, false)
    }

    fn rd(h: HANDLE, buf: &mut [u8], off: Option<u64>) -> Result<usize, Win32Error> {
        // SAFETY: test handles are live, synchronous, and owned by the test.
        unsafe { read_at(h, &mut [buf], off) }
    }

    fn wr(h: HANDLE, data: &[u8], off: Option<u64>) -> Result<usize, Win32Error> {
        // SAFETY: test handles are live, synchronous, and owned by the test.
        unsafe { write_at(h, &[data], off) }
    }

    /// Closes on drop; constructed only from successful opens.
    struct Guard(HANDLE);
    impl Drop for Guard {
        fn drop(&mut self) {
            // SAFETY: successful open, closed exactly once (never cloned).
            let _ = unsafe { close(self.0) };
        }
    }

    fn seq_pos(h: HANDLE) -> i64 {
        let mut p: LARGE_INTEGER = 0;
        // SAFETY: live test handle; `p` is an owned out-param.
        let ok = unsafe { SetFilePointerEx(h, 0, &raw mut p, FILE_CURRENT) };
        assert!(ok != 0, "SetFilePointerEx: {:?}", Win32Error::get());
        p
    }

    fn file_size(h: HANDLE) -> i64 {
        let mut sz: LARGE_INTEGER = 0;
        // SAFETY: live test handle; `sz` is an owned out-param.
        let ok = unsafe { GetFileSizeEx(h, &raw mut sz) };
        assert!(ok != 0, "GetFileSizeEx: {:?}", Win32Error::get());
        sz
    }

    fn zero_filetime() -> FILETIME {
        FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        }
    }

    fn handle_attrs(h: HANDLE) -> DWORD {
        let mut info = BY_HANDLE_FILE_INFORMATION {
            dwFileAttributes: 0,
            ftCreationTime: zero_filetime(),
            ftLastAccessTime: zero_filetime(),
            ftLastWriteTime: zero_filetime(),
            dwVolumeSerialNumber: 0,
            nFileSizeHigh: 0,
            nFileSizeLow: 0,
            nNumberOfLinks: 0,
            nFileIndexHigh: 0,
            nFileIndexLow: 0,
        };
        // SAFETY: live test handle; `info` is an owned out-param.
        let ok = unsafe { GetFileInformationByHandle(h, &raw mut info) };
        assert!(
            ok != 0,
            "GetFileInformationByHandle: {:?}",
            Win32Error::get()
        );
        info.dwFileAttributes
    }

    fn handle_mode(h: HANDLE) -> ULONG {
        let mut io_status = IO_STATUS_BLOCK {
            Status: 0,
            Information: 0,
        };
        let mut mode = FILE_MODE_INFORMATION::default();
        // SAFETY: owned out-params of exactly the class size.
        let nt = unsafe {
            NtQueryInformationFile(
                h,
                &raw mut io_status,
                (&raw mut mode).cast(),
                size_of::<FILE_MODE_INFORMATION>() as ULONG,
                FILE_INFORMATION_CLASS::FileModeInformation,
            )
        };
        assert!(NT_SUCCESS(nt), "FileModeInformation failed");
        mode.Mode
    }

    fn file_attrs(path: &Path) -> DWORD {
        let w = wide(path);
        // SAFETY: NUL-terminated path.
        let attrs = unsafe { GetFileAttributesW(w.as_ptr()) };
        assert!(
            attrs != DWORD::MAX,
            "GetFileAttributesW: {:?}",
            Win32Error::get()
        );
        attrs
    }

    fn read_contents(path: &Path) -> Result<Vec<u8>, Win32Error> {
        let h = open(path, OpenFlags::RDONLY)?;
        let _g = Guard(h);
        let mut out = Vec::new();
        let mut buf = [0u8; 512];
        loop {
            match rd(h, &mut buf, None) {
                Ok(0) => return Ok(out),
                Ok(n) => out.extend_from_slice(&buf[..n]),
                Err(e) if e == Win32Error::HANDLE_EOF => return Ok(out),
                Err(e) => return Err(e),
            }
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
                "bun_winfs_io_{tag}_{}_{}",
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

        fn track_file(&mut self, path: &Path) {
            self.entries.push((path.to_path_buf(), false));
        }

        fn dir(&mut self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            let w = wide(&path);
            // SAFETY: NUL-terminated path; null security attributes.
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

    /// Creates a file through the engine itself and registers it for cleanup.
    fn create_file(fx: &mut Fixture, name: &str, contents: &[u8]) -> PathBuf {
        let path = fx.root.join(name);
        let h = open(
            &path,
            OpenFlags::WRONLY | OpenFlags::CREAT | OpenFlags::TRUNC,
        )
        .unwrap_or_else(|e| panic!("create {path:?}: {e:?}"));
        {
            let _g = Guard(h);
            if !contents.is_empty() {
                assert_eq!(wr(h, contents, None), Ok(contents.len()));
            }
        }
        fx.track_file(&path);
        path
    }

    // ── pure KATs ──

    /// Transcription guard: the flag values ARE node `fs.constants` on
    /// Windows (UCRT fcntl.h + libuv uv/win.h) and the composite rights are
    /// winnt.h's FILE_GENERIC_*. // quirk: FSIO-03
    #[test]
    fn flag_and_rights_transcription_kats() {
        assert_eq!(
            [
                OpenFlags::RDONLY.0,
                OpenFlags::WRONLY.0,
                OpenFlags::RDWR.0,
                OpenFlags::APPEND.0
            ],
            [0x0, 0x1, 0x2, 0x8]
        );
        assert_eq!(
            [OpenFlags::CREAT.0, OpenFlags::TRUNC.0, OpenFlags::EXCL.0],
            [0x100, 0x200, 0x400]
        );
        assert_eq!(
            [
                OpenFlags::RANDOM.0,
                OpenFlags::SEQUENTIAL.0,
                OpenFlags::TEMPORARY.0,
                OpenFlags::SHORT_LIVED.0
            ],
            [0x10, 0x20, 0x40, 0x1000]
        );
        assert_eq!(
            [
                OpenFlags::DIRECT.0,
                OpenFlags::DSYNC.0,
                OpenFlags::SYNC.0,
                OpenFlags::EXLOCK.0,
                OpenFlags::FILEMAP.0,
                OpenFlags::DIRECTORY.0
            ],
            [
                0x0200_0000,
                0x0400_0000,
                0x0800_0000,
                0x1000_0000,
                0x2000_0000,
                0
            ]
        );
        assert_eq!(FILE_GENERIC_READ, 0x0012_0089);
        assert_eq!(FILE_GENERIC_WRITE, 0x0012_0116);
        assert_eq!(IO_MAX_BYTES, 0x7fff_f000);
    }

    // ── flags matrix ──

    /// Every rw-mode × disposition combo against existing and missing files:
    /// exact success/raw-error shape AND post-state (content read back).
    /// // quirk: FSIO-05
    #[test]
    fn open_flags_matrix() {
        let mut fx = Fixture::new("matrix");
        let rw_modes = [
            ("rdonly", OpenFlags::RDONLY),
            ("wronly", OpenFlags::WRONLY),
            ("rdwr", OpenFlags::RDWR),
        ];
        let dispositions = [
            ("plain", OpenFlags(0)),
            ("creat", OpenFlags::CREAT),
            (
                "creat_excl",
                OpenFlags(OpenFlags::CREAT.0 | OpenFlags::EXCL.0),
            ),
            (
                "creat_trunc",
                OpenFlags(OpenFlags::CREAT.0 | OpenFlags::TRUNC.0),
            ),
            ("trunc", OpenFlags::TRUNC),
        ];
        for (rw_name, rw) in rw_modes {
            for (disp_name, disp) in dispositions {
                for existing in [false, true] {
                    let ctx = format!("{rw_name}|{disp_name} existing={existing}");
                    let name = format!("{rw_name}_{disp_name}_{existing}.bin");
                    let path = fx.root.join(&name);
                    if existing {
                        create_file(&mut fx, &name, b"ORIG");
                    } else {
                        fx.track_file(&path);
                    }

                    let expected: Result<&[u8], Win32Error> = if disp == OpenFlags::TRUNC {
                        // Bare O_TRUNC: TRUNCATE_EXISTING demands the literal
                        // GENERIC_WRITE meta-bit, which libuv's decomposed
                        // FILE_GENERIC_WRITE lacks — CreateFileW fails 87
                        // pre-path-resolution for EVERY rw mode, existing or
                        // missing, file untouched (empirical; identical to
                        // stock libuv's call). // quirk: FSIO-05
                        Err(Win32Error::INVALID_PARAMETER)
                    } else if existing {
                        if disp.contains(OpenFlags::EXCL) {
                            // CREATE_NEW refuses atomically. // quirk: FSIO-05
                            Err(Win32Error::FILE_EXISTS)
                        } else if disp.contains(OpenFlags::TRUNC) {
                            Ok(b"")
                        } else {
                            Ok(b"ORIG")
                        }
                    } else if disp.contains(OpenFlags::CREAT) {
                        Ok(b"")
                    } else {
                        Err(Win32Error::FILE_NOT_FOUND)
                    };

                    match (open(&path, rw | disp), expected) {
                        (Ok(h), Ok(want)) => {
                            drop(Guard(h));
                            assert_eq!(read_contents(&path).unwrap(), want, "{ctx}: post-state");
                        }
                        (Ok(h), Err(want)) => {
                            drop(Guard(h));
                            panic!("{ctx}: expected {want:?}, but open succeeded");
                        }
                        (Err(e), Err(want)) => {
                            assert_eq!(e, want, "{ctx}: error shape");
                            // Negative contract: a failed open must not
                            // create, truncate, or otherwise touch the file.
                            if existing {
                                assert_eq!(
                                    read_contents(&path).unwrap(),
                                    b"ORIG",
                                    "{ctx}: failed open must preserve content"
                                );
                            } else {
                                assert_eq!(
                                    read_contents(&path).unwrap_err(),
                                    Win32Error::FILE_NOT_FOUND,
                                    "{ctx}: failed open must not create"
                                );
                            }
                        }
                        (Err(e), Ok(_)) => panic!("{ctx}: expected success, got {e:?}"),
                    }
                }
            }
        }
    }

    // ── positioned I/O ──

    /// Positioned ops are ONE syscall with the offset inside the OVERLAPPED —
    /// and on a synchronous handle the kernel then sets the shared file
    /// pointer to offset+transferred (empirical contract; nodejs/node#9671's
    /// root cause; what libuv's save/seek/restore dance papers over). The
    /// fd-table layer owns POSIX pread pointer semantics. // quirk: FSIO-21
    #[test]
    fn positioned_io_moves_kernel_pointer_by_contract() {
        let mut fx = Fixture::new("pos");
        let path = create_file(&mut fx, "pos.bin", b"0123456789ABCDEF");
        let h = open(&path, OpenFlags::RDWR).unwrap();
        let _g = Guard(h);

        let mut two = [0u8; 2];
        assert_eq!(rd(h, &mut two, None), Ok(2));
        assert_eq!(&two, b"01");
        assert_eq!(seq_pos(h), 2);

        let mut three = [0u8; 3];
        assert_eq!(rd(h, &mut three, Some(5)), Ok(3));
        assert_eq!(&three, b"567");
        // The pinned deviation from POSIX pread: pointer = offset + bytes.
        assert_eq!(seq_pos(h), 8);
        assert_eq!(rd(h, &mut two, None), Ok(2));
        assert_eq!(&two, b"89");

        assert_eq!(wr(h, b"zz", Some(0)), Ok(2));
        assert_eq!(seq_pos(h), 2, "positioned write also moves the pointer");
        assert_eq!(read_contents(&path).unwrap(), b"zz23456789ABCDEF");

        // Positioned read at and past EOF: the raw EOF error shape, not a
        // translated success — classification is the consumer's.
        // // quirk: FSIO-23
        assert_eq!(rd(h, &mut two, Some(16)), Err(Win32Error::HANDLE_EOF));
        assert_eq!(rd(h, &mut two, Some(100)), Err(Win32Error::HANDLE_EOF));
    }

    /// Two threads issuing positioned reads on the SAME handle at different
    /// offsets each get their own bytes — the offset rides inside each
    /// syscall, so there is no save/seek/restore window to race.
    /// // quirk: FSIO-21
    #[test]
    fn concurrent_positioned_reads_share_one_handle() {
        let mut fx = Fixture::new("race");
        let path = create_file(&mut fx, "race.bin", b"0123456789ABCDEF");
        let h = open(&path, OpenFlags::RDONLY).unwrap();
        let _g = Guard(h);
        let addr = h as usize;
        std::thread::scope(|s| {
            for (off, want) in [(0u64, *b"0123"), (8u64, *b"89AB")] {
                s.spawn(move || {
                    let h = addr as HANDLE;
                    let mut buf = [0u8; 4];
                    for _ in 0..500 {
                        assert_eq!(rd(h, &mut buf, Some(off)), Ok(4));
                        assert_eq!(buf, want, "offset {off} read someone else's bytes");
                    }
                });
            }
        });
    }

    // ── append semantics ──

    /// Append-only handles (FILE_APPEND_DATA without FILE_WRITE_DATA) append
    /// atomically at EOF and IGNORE explicit offsets; ftruncate on them fails
    /// for lack of WRITE_DATA. // quirk: FSIO-03, FSIO-28
    #[test]
    fn append_handle_appends_despite_offsets() {
        let mut fx = Fixture::new("append");
        let path = create_file(&mut fx, "log.bin", b"BASE");
        let h = open(&path, OpenFlags::WRONLY | OpenFlags::APPEND).unwrap();
        {
            let _g = Guard(h);
            assert_eq!(wr(h, b"11", None), Ok(2));
            assert_eq!(wr(h, b"22", Some(0)), Ok(2), "offset must be ignored");
            // SAFETY: live test handle.
            let truncated = unsafe { ftruncate(h, 0) };
            assert_eq!(
                truncated,
                Err(Win32Error::ACCESS_DENIED),
                "append-mode handle lacks FILE_WRITE_DATA"
            );
        }
        assert_eq!(read_contents(&path).unwrap(), b"BASE1122");
    }

    // ── O_TEMPORARY / share-delete lifetimes ──

    /// DELETE_ON_CLOSE + the DELETE access right: the file is usable while
    /// open and gone after the last close. // quirk: FSIO-09
    #[test]
    fn o_temporary_deletes_on_close() {
        let fx = Fixture::new("tmp");
        let path = fx.root.join("temp.bin");
        let h = open(
            &path,
            OpenFlags(OpenFlags::RDWR.0 | OpenFlags::CREAT.0 | OpenFlags::TEMPORARY.0),
        )
        .unwrap();
        {
            let _g = Guard(h);
            assert_eq!(wr(h, b"scratch", None), Ok(7));
            let mut buf = [0u8; 7];
            assert_eq!(rd(h, &mut buf, Some(0)), Ok(7));
            assert_eq!(&buf, b"scratch");
            assert!(
                handle_attrs(h) & FILE_ATTRIBUTE_TEMPORARY != 0,
                "O_TEMPORARY marks the file TEMPORARY"
            );
        }
        assert_eq!(
            open(&path, OpenFlags::RDONLY).unwrap_err(),
            Win32Error::FILE_NOT_FOUND,
            "DELETE_ON_CLOSE must remove the file"
        );
        drop(fx);
    }

    /// FILE_SHARE_DELETE buys the Unix-ish lifetime: unlink while open
    /// succeeds, the open handle still reads, the name is gone after close.
    /// // quirk: FSIO-01
    #[test]
    fn share_delete_unlink_while_open() {
        let mut fx = Fixture::new("shdel");
        let path = create_file(&mut fx, "shared.bin", b"SHARED");
        let h = open(&path, OpenFlags::RDONLY).unwrap();
        let g = Guard(h);
        let w = wide(&path);
        // SAFETY: NUL-terminated path.
        let ok = unsafe { DeleteFileW(w.as_ptr()) };
        assert!(
            ok != 0,
            "unlink of an open file must succeed: {:?}",
            Win32Error::get()
        );
        let mut buf = [0u8; 6];
        assert_eq!(rd(h, &mut buf, Some(0)), Ok(6));
        assert_eq!(&buf, b"SHARED");
        // POSIX-semantics unlink (Win10 1809+ NTFS) removes the NAME
        // immediately → FILE_NOT_FOUND; legacy delete-pending kernels and
        // non-NTFS report ACCESS_DENIED. Either way: no new opens.
        let err = open(&path, OpenFlags::RDONLY).unwrap_err();
        assert!(
            err == Win32Error::FILE_NOT_FOUND || err == Win32Error::ACCESS_DENIED,
            "reopen of an unlinked-but-open file: {err:?}"
        );
        drop(g);
        assert_eq!(
            open(&path, OpenFlags::RDONLY).unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );
    }

    /// O_EXLOCK opens with share mode 0: every other open — even read-only —
    /// is refused while the handle lives. // quirk: FSIO-02
    #[test]
    fn exlock_denies_all_sharing() {
        let mut fx = Fixture::new("exlock");
        let path = create_file(&mut fx, "locked.bin", b"L");
        let h = open(&path, OpenFlags::RDWR | OpenFlags::EXLOCK).unwrap();
        {
            let _g = Guard(h);
            assert_eq!(
                open(&path, OpenFlags::RDONLY).unwrap_err(),
                Win32Error::SHARING_VIOLATION
            );
        }
        // The lock dies with the handle.
        let h = open(&path, OpenFlags::RDONLY).unwrap();
        drop(Guard(h));
    }

    // ── directories ──

    /// The FSIO-07 matrix: r/r+/a open directories (BACKUP_SEMANTICS is
    /// unconditional), I/O on them fails INVALID_FUNCTION (EISDIR
    /// downstream), wrong-direction fails ACCESS_DENIED first, w/w+/wx fail
    /// at open with raw FILE_EXISTS. // quirk: FSIO-06, FSIO-07, FSIO-24
    #[test]
    fn directory_open_and_io_error_shapes() {
        let mut fx = Fixture::new("dirio");
        let dir = fx.dir("sub");
        let mut buf = [0u8; 8];

        let h = open(&dir, OpenFlags::RDONLY).unwrap();
        {
            let _g = Guard(h);
            assert_eq!(rd(h, &mut buf, None), Err(Win32Error::INVALID_FUNCTION));
            assert_eq!(rd(h, &mut buf, Some(0)), Err(Win32Error::INVALID_FUNCTION));
            // Wrong-direction beats the directory check: raw ACCESS_DENIED
            // (EBADF downstream), not INVALID_FUNCTION.
            assert_eq!(wr(h, b"x", None), Err(Win32Error::ACCESS_DENIED));
        }
        let h = open(&dir, OpenFlags::RDWR).unwrap();
        {
            let _g = Guard(h);
            assert_eq!(wr(h, b"x", None), Err(Win32Error::INVALID_FUNCTION));
            assert_eq!(wr(h, b"x", Some(0)), Err(Win32Error::INVALID_FUNCTION));
        }
        // a / a+ also open fine; writes report the directory.
        let h = open(&dir, OpenFlags::WRONLY | OpenFlags::APPEND).unwrap();
        {
            let _g = Guard(h);
            assert_eq!(wr(h, b"x", None), Err(Win32Error::INVALID_FUNCTION));
        }

        // w / w+ on a directory: CREATE_ALWAYS fails with the undocumented
        // raw FILE_EXISTS — the wrapper's EISDIR rewrite (CREAT && !EXCL).
        for fl in [OpenFlags::WRONLY, OpenFlags::RDWR] {
            assert_eq!(
                open(
                    &dir,
                    OpenFlags(fl.0 | OpenFlags::CREAT.0 | OpenFlags::TRUNC.0)
                )
                .unwrap_err(),
                Win32Error::FILE_EXISTS,
                "w-mode on a directory"
            );
        }
        // wx: identical raw code; EXCL routes the wrapper to EEXIST instead.
        assert_eq!(
            open(
                &dir,
                OpenFlags(OpenFlags::WRONLY.0 | OpenFlags::CREAT.0 | OpenFlags::EXCL.0)
            )
            .unwrap_err(),
            Win32Error::FILE_EXISTS
        );
        // Bare CREAT (OPEN_ALWAYS) on a directory simply opens it.
        let h = open(&dir, OpenFlags::RDONLY | OpenFlags::CREAT).unwrap();
        drop(Guard(h));

        // Without BACKUP_SEMANTICS the kernel refuses directories outright —
        // why the engine sets the flag unconditionally. // quirk: FSIO-07
        let w = wide(&dir);
        // SAFETY: NUL-terminated path; null security attributes/template.
        let raw = unsafe {
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
        assert_eq!(raw, INVALID_HANDLE_VALUE);
        assert_eq!(Win32Error::get(), Win32Error::ACCESS_DENIED);
    }

    // ── readonly create + attribute/mode observability ──

    /// `mode_readonly` sets FILE_ATTRIBUTE_READONLY only when a file is
    /// actually created, and the creating handle keeps its write access.
    /// // quirk: FSIO-08, FSIO-09
    #[test]
    fn readonly_mode_sets_attribute_only_on_create() {
        let mut fx = Fixture::new("ro");
        let path = fx.root.join("ro.bin");
        fx.track_file(&path);
        let h = open_path(&wide(&path), OpenFlags::WRONLY | OpenFlags::CREAT, true).unwrap();
        {
            let _g = Guard(h);
            assert_eq!(wr(h, b"ro", None), Ok(2), "creating handle stays writable");
            assert!(handle_attrs(h) & FILE_ATTRIBUTE_READONLY != 0);
        }
        assert_eq!(read_contents(&path).unwrap(), b"ro");
        assert_eq!(
            open(&path, OpenFlags::WRONLY).unwrap_err(),
            Win32Error::ACCESS_DENIED,
            "READONLY attribute must block later write-opens"
        );

        // OPEN_ALWAYS on an existing file must not retro-apply the attribute.
        let path2 = create_file(&mut fx, "rw.bin", b"x");
        let h = open_path(&wide(&path2), OpenFlags::WRONLY | OpenFlags::CREAT, true).unwrap();
        drop(Guard(h));
        assert_eq!(file_attrs(&path2) & FILE_ATTRIBUTE_READONLY, 0);

        // O_SHORT_LIVED marks the file TEMPORARY (no delete-on-close).
        let path3 = fx.root.join("sl.bin");
        fx.track_file(&path3);
        let h = open(
            &path3,
            OpenFlags(OpenFlags::RDWR.0 | OpenFlags::CREAT.0 | OpenFlags::SHORT_LIVED.0),
        )
        .unwrap();
        {
            let _g = Guard(h);
            assert!(handle_attrs(h) & FILE_ATTRIBUTE_TEMPORARY != 0);
        }
        let h = open(&path3, OpenFlags::RDONLY).expect("SHORT_LIVED must not delete on close");
        drop(Guard(h));
    }

    /// O_DSYNC/O_SYNC are observable as FILE_WRITE_THROUGH in the handle's
    /// FileModeInformation; invalid flag combinations are the raw
    /// INVALID_PARAMETER (EINVAL) shape. // quirk: FSIO-04, FSIO-09, FSIO-10
    #[test]
    fn write_through_observable_and_flag_conflicts() {
        let mut fx = Fixture::new("wt");
        let path = create_file(&mut fx, "wt.bin", b"x");

        let h = open(&path, OpenFlags::RDWR).unwrap();
        {
            let _g = Guard(h);
            assert_eq!(handle_mode(h) & FILE_WRITE_THROUGH, 0);
        }
        for fl in [OpenFlags::DSYNC, OpenFlags::SYNC] {
            let h = open(&path, OpenFlags::RDWR | fl).unwrap();
            let _g = Guard(h);
            assert!(
                handle_mode(h) & FILE_WRITE_THROUGH != 0,
                "{fl:?} must open write-through"
            );
        }

        let invalid = [
            OpenFlags(OpenFlags::RDWR.0 | OpenFlags::DSYNC.0 | OpenFlags::SYNC.0),
            OpenFlags(OpenFlags::RDWR.0 | OpenFlags::SEQUENTIAL.0 | OpenFlags::RANDOM.0),
            OpenFlags::WRONLY | OpenFlags::RDWR,
            // O_APPEND strips FILE_WRITE_DATA before the O_DIRECT check, so
            // APPEND|DIRECT is EINVAL for EVERY rw mode (libuv's exact
            // control flow). // quirk: FSIO-04
            OpenFlags(OpenFlags::WRONLY.0 | OpenFlags::APPEND.0 | OpenFlags::DIRECT.0),
            OpenFlags(OpenFlags::RDWR.0 | OpenFlags::APPEND.0 | OpenFlags::DIRECT.0),
        ];
        for fl in invalid {
            assert_eq!(
                open(&path, fl).unwrap_err(),
                Win32Error::INVALID_PARAMETER,
                "flags {fl:?} must be the EINVAL shape"
            );
        }
        // Without O_APPEND, FILE_GENERIC_WRITE's embedded APPEND_DATA bit is
        // dropped for O_DIRECT instead of failing (appends stay permitted
        // via WRITE_DATA, just not atomic). // quirk: FSIO-04
        for fl in [OpenFlags::WRONLY, OpenFlags::RDWR] {
            let h = open(&path, fl | OpenFlags::DIRECT)
                .unwrap_or_else(|e| panic!("{fl:?}|DIRECT: {e:?}"));
            drop(Guard(h));
        }
        // Scan hints are accepted alone.
        for fl in [OpenFlags::SEQUENTIAL, OpenFlags::RANDOM] {
            let h = open(&path, OpenFlags::RDONLY | fl).unwrap();
            drop(Guard(h));
        }
        // FILEMAP is accepted and ignored. // quirk: FSIO-31
        let h = open(&path, OpenFlags::RDWR | OpenFlags::FILEMAP).unwrap();
        drop(Guard(h));
    }

    // ── ftruncate / fsync ──

    /// Shrink and grow via the single-call NT EOF set, with read-back; the
    /// raw error shapes for negative lengths and read-only handles.
    /// // quirk: FSIO-39
    #[test]
    fn ftruncate_grow_shrink_fsync() {
        let mut fx = Fixture::new("trunc");
        let path = create_file(&mut fx, "t.bin", b"0123456789");
        let h = open(&path, OpenFlags::RDWR).unwrap();
        let _g = Guard(h);

        // SAFETY: live test handle.
        unsafe { ftruncate(h, 4) }.unwrap();
        assert_eq!(file_size(h), 4);
        let mut buf = [0u8; 8];
        assert_eq!(rd(h, &mut buf, Some(0)), Ok(4));
        assert_eq!(&buf[..4], b"0123");

        // SAFETY: live test handle.
        unsafe { ftruncate(h, 16) }.unwrap();
        assert_eq!(file_size(h), 16);
        let mut big = [0xAAu8; 16];
        assert_eq!(rd(h, &mut big, Some(0)), Ok(16));
        assert_eq!(&big[..4], b"0123");
        assert_eq!(&big[4..], &[0u8; 12], "growth must zero-fill");

        // SAFETY: live test handle.
        let negative = unsafe { ftruncate(h, -1) };
        assert_eq!(
            negative,
            Err(Win32Error::INVALID_PARAMETER),
            "negative EOF is the raw EINVAL shape"
        );

        // SAFETY: live test handle.
        unsafe { fsync(h) }.unwrap();
        // SAFETY: live test handle.
        unsafe { fdatasync(h) }.unwrap();

        let ro = open(&path, OpenFlags::RDONLY).unwrap();
        let _g2 = Guard(ro);
        // SAFETY: live test handle.
        assert_eq!(unsafe { ftruncate(ro, 1) }, Err(Win32Error::ACCESS_DENIED));
        // FlushFileBuffers needs write access — the node-on-Windows
        // fsync-on-O_RDONLY EPERM shape, kept raw here.
        // SAFETY: live test handle.
        assert_eq!(unsafe { fsync(ro) }, Err(Win32Error::ACCESS_DENIED));
    }

    // ── vectored I/O ──

    /// Multi-buffer ops advance the OVERLAPPED offset per iteration (no
    /// kernel auto-advance) and report the short count when a later buffer
    /// hits EOF. // quirk: FSIO-22, FSIO-26
    #[test]
    fn vectored_io_offsets_and_partial_success() {
        let mut fx = Fixture::new("vec");
        let path = create_file(&mut fx, "v.bin", b"ABCDEF");

        let h = open(&path, OpenFlags::RDONLY).unwrap();
        {
            let _g = Guard(h);
            let (mut b1, mut b2) = ([0u8; 2], [0u8; 3]);
            // SAFETY: live test handle.
            let n = unsafe { read_at(h, &mut [&mut b1, &mut b2], Some(1)) };
            assert_eq!(n, Ok(5));
            assert_eq!((&b1[..], &b2[..]), (&b"BC"[..], &b"DEF"[..]));

            // First buffer drains the file; the second hits EOF: partial
            // success wins over the error.
            let (mut b1, mut b2) = ([0u8; 4], [0u8; 4]);
            // SAFETY: live test handle.
            let n = unsafe { read_at(h, &mut [&mut b1, &mut b2], Some(2)) };
            assert_eq!(n, Ok(4));
            assert_eq!(&b1, b"CDEF");

            // Empty buffer lists do no syscalls and return 0 (the EINVAL
            // guard for no-buffers is the wrapper's). // quirk: FSIO-47
            // SAFETY: live test handle.
            assert_eq!(unsafe { read_at(h, &mut [], Some(0)) }, Ok(0));
            // SAFETY: live test handle.
            assert_eq!(unsafe { read_at(h, &mut [], None) }, Ok(0));
        }

        // Positioned vectored write: buffer N lands at offset + prior bytes.
        let path2 = fx.root.join("w.bin");
        fx.track_file(&path2);
        let h = open(&path2, OpenFlags::WRONLY | OpenFlags::CREAT).unwrap();
        {
            let _g = Guard(h);
            // SAFETY: live test handle.
            assert_eq!(unsafe { write_at(h, &[b"xx", b"yy"], Some(2)) }, Ok(4));
        }
        assert_eq!(
            read_contents(&path2).unwrap(),
            &[0, 0, b'x', b'x', b'y', b'y'][..],
            "writing past EOF zero-fills the gap; buffers must not overlap"
        );

        // Sequential vectored write goes through the file pointer in order.
        let h = open(&path2, OpenFlags::WRONLY).unwrap();
        {
            let _g = Guard(h);
            // SAFETY: live test handle.
            assert_eq!(unsafe { write_at(h, &[b"AB", b"C"], None) }, Ok(3));
        }
        assert_eq!(read_contents(&path2).unwrap(), b"ABCxyy");
    }

    // ── wrong-direction raw codes ──

    /// The engine must NOT pre-translate wrong-direction ACCESS_DENIED — the
    /// EBADF meaning belongs to classify_file_read/write downstream.
    /// // quirk: FSIO-24
    #[test]
    fn wrong_direction_io_keeps_raw_access_denied() {
        let mut fx = Fixture::new("wrongdir");
        let path = create_file(&mut fx, "f.bin", b"data");
        let h = open(&path, OpenFlags::WRONLY).unwrap();
        {
            let _g = Guard(h);
            let mut buf = [0u8; 4];
            assert_eq!(rd(h, &mut buf, None), Err(Win32Error::ACCESS_DENIED));
            assert_eq!(rd(h, &mut buf, Some(0)), Err(Win32Error::ACCESS_DENIED));
        }
        let h = open(&path, OpenFlags::RDONLY).unwrap();
        {
            let _g = Guard(h);
            assert_eq!(wr(h, b"x", None), Err(Win32Error::ACCESS_DENIED));
            assert_eq!(wr(h, b"x", Some(0)), Err(Win32Error::ACCESS_DENIED));
        }
    }

    // ── close ──

    /// The sentinels never reach CloseHandle (Wine/debug layers abort on
    /// INVALID_HANDLE_VALUE); a real handle closes once. // quirk: FSIO-50
    #[test]
    fn close_rejects_sentinels_without_kernel_calls() {
        // SAFETY: sentinel values are rejected before any kernel call.
        let invalid = unsafe { close(INVALID_HANDLE_VALUE) };
        assert_eq!(invalid, Err(Win32Error::INVALID_HANDLE));
        // SAFETY: as above.
        let null = unsafe { close(ptr::null_mut()) };
        assert_eq!(null, Err(Win32Error::INVALID_HANDLE));

        let mut fx = Fixture::new("close");
        let path = create_file(&mut fx, "c.bin", b"");
        let h = open(&path, OpenFlags::RDONLY).unwrap();
        // SAFETY: freshly opened handle, single owner, closed exactly once.
        assert_eq!(unsafe { close(h) }, Ok(()));
    }
}
