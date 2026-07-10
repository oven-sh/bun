#![cfg(windows)]

//! The Windows links/directories engine: `readlink`/`symlink` (file, dir,
//! junction), `unlink`/`rmdir`, `rename`, `link`, `mkdir` over NUL-terminated
//! wide (WTF-16) paths — at libuv parity (`fs__readlink` / `fs__symlink` /
//! `fs__create_junction` / `fs__unlink_rmdir` / `fs__link` / `fs__mkdir`),
//! ported per the `fs-links-dir.md` ledger area. This module also owns the
//! ONE reparse-tag classifier ([`readlink_by_handle`]) consumed by readlink,
//! lstat (`stat.rs`), and the delete gate, so tag support can never diverge
//! between them. // quirk: FSLNK-50
//!
//! Error policy: raw `Win32Error` out of every function, translated nowhere
//! in-engine. Context-local remaps libuv applies at its call sites belong to
//! the `bun_sys` wrapper, which also knows the operation:
//! - readlink on a non-reparse file: raw `NOT_A_REPARSE_POINT` here → EINVAL
//!   in the readlink wrapper only (a global mapping would corrupt other call
//!   sites). // quirk: FSLNK-10
//! - mkdir: raw `INVALID_NAME` / `DIRECTORY` here → EINVAL in the mkdir
//!   wrapper only (the global table maps both to ENOENT). // quirk: FSLNK-26
//! - junction with a relative target: raw `NOT_SUPPORTED` here → EINVAL in
//!   the symlink wrapper (libuv's `SET_REQ_UV_ERROR(UV_EINVAL,
//!   ERROR_NOT_SUPPORTED)` override). // quirk: FSLNK-17
//! - rmdir on a non-directory: raw `DIRECTORY` (267) here → ENOENT downstream
//!   via the standard table, libuv's frozen back-compat shape.
//!   // quirk: FSLNK-21
//! - everything else flows through the standard table: `ACCESS_DENIED`→EPERM,
//!   `NOT_SAME_DEVICE`→EXDEV, `DIR_NOT_EMPTY`→ENOTEMPTY, ... // quirk: FSLNK-46
//!
//! Rename deviates from stock libuv (`MoveFileExW`) by design: it is
//! `SetFileInformationByHandle(FileRenameInfoEx)` with
//! POSIX_SEMANTICS|REPLACE_IF_EXISTS|IGNORE_READONLY_ATTRIBUTE, falling back
//! to the classic `FileRenameInfo` on the same three not-supported errors the
//! delete fallback uses — and on raw `DIRECTORY` (267), the one cell where
//! POSIX semantics refuse what Windows/libuv/Node allow: a directory
//! replacing an existing file. Kernel-probed consequences (pinned by tests):
//! replacing read-only and open destinations succeeds, case-only renames
//! work, `dir → empty dir` succeeds (POSIX parity MoveFileExW cannot give),
//! `dir → existing file` replaces the file (libuv parity via the fallback),
//! and cross-device renames surface raw `NOT_SAME_DEVICE`. // quirk: FSLNK-23

use core::mem::size_of;
use core::ptr;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_windows_sys::kernel32::{DeviceIoControl, RemoveDirectoryW};
use bun_windows_sys::ntdll::NtSetInformationFile;
use bun_windows_sys::{
    CreateDirectoryW, CreateFileW, CreateHardLinkW, CreateSymbolicLinkW, DELETE, DWORD,
    FILE_ATTRIBUTE_ARCHIVE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_READONLY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFORMATION, FILE_DISPOSITION_DELETE,
    FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE, FILE_DISPOSITION_INFORMATION,
    FILE_DISPOSITION_INFORMATION_EX, FILE_DISPOSITION_POSIX_SEMANTICS, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_INFO_BY_HANDLE_CLASS, FILE_INFORMATION_CLASS,
    FILE_READ_ATTRIBUTES, FILE_RENAME_IGNORE_READONLY_ATTRIBUTE, FILE_RENAME_INFORMATION_EX,
    FILE_RENAME_POSIX_SEMANTICS, FILE_RENAME_REPLACE_IF_EXISTS, FILE_WRITE_ATTRIBUTES,
    FSCTL_GET_REPARSE_POINT, FSCTL_SET_REPARSE_POINT, FileBasicInfo, FileRenameInfo,
    FileRenameInfoEx, GENERIC_WRITE, GetFileInformationByHandleEx, HANDLE, INVALID_HANDLE_VALUE,
    IO_REPARSE_TAG_APPEXECLINK, IO_REPARSE_TAG_LX_SYMLINK, IO_REPARSE_TAG_MOUNT_POINT,
    IO_REPARSE_TAG_SYMLINK, IO_STATUS_BLOCK, MAXIMUM_REPARSE_DATA_BUFFER_SIZE, NT_SUCCESS,
    OPEN_EXISTING, REPARSE_DATA_BUFFER, ReOpenFile, SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE,
    SYMBOLIC_LINK_FLAG_DIRECTORY, SetFileInformationByHandle, ULONG, Win32Error,
};

use crate::stat::{BACKSLASH, COLON, FWDSLASH, HandleGuard, SHARE_ALL};

/// `REPARSE_DATA_BUFFER` fixed header: ReparseTag + ReparseDataLength +
/// Reserved. `ReparseDataLength` counts the bytes that follow this header.
const REPARSE_HEADER_BYTES: usize = 8;

/// Bytes of the `\??\` NT-namespace prefix junction SubstituteNames carry
/// (libuv `JUNCTION_PREFIX`).
const NT_PREFIX: [u16; 4] = [BACKSLASH, b'?' as u16, b'?' as u16, BACKSLASH];

// ───────────────────────────── readlink ─────────────────────────────

/// A reparse-point target as stored on disk — no encoding conversion is
/// performed in-engine (the WTF-8 conversion is the `bun_sys` wrapper's job).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadlinkTarget {
    /// Raw WTF-16 units (symlink, junction, app-exec-link targets). May
    /// contain unpaired surrogates — convert with a WTF-8 encoder, never a
    /// strict UTF-16 decoder. // quirk: FSLNK-11
    Wide(Vec<u16>),
    /// Raw stored bytes of a WSL `LX_SYMLINK` target (Linux bytes, usually
    /// UTF-8) — returned verbatim with NO UTF-16 round trip, exactly as
    /// libuv returns them. // quirk: FSLNK-05
    Bytes(Vec<u8>),
}

/// readlink(2) over a NUL-terminated wide (WTF-16) path. The path passes to
/// `CreateFileW` verbatim. Returns the RAW stored target ([`ReadlinkTarget`])
/// — WTF-8 conversion happens exactly once in the `bun_sys` wrapper.
///
/// The open uses `dwDesiredAccess = 0` + share mode 0 so files other
/// processes hold exclusively can still be readlink'd (zero-access opens
/// bypass sharing checks), plus `OPEN_REPARSE_POINT` (address the link, not
/// the target) and `BACKUP_SEMANTICS` (junctions/dir-symlinks ARE
/// directories). // quirk: FSLNK-09
///
/// A non-reparse file surfaces raw `NOT_A_REPARSE_POINT` — the wrapper maps
/// it to EINVAL for readlink ONLY (no global table entry). // quirk: FSLNK-10
pub fn readlink_path(path_w: &[u16]) -> Result<ReadlinkTarget, Win32Error> {
    let Some((&0, units)) = path_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!units.contains(&0), "interior NUL in wide path");
    // SAFETY: `path_w` is NUL-terminated (validated above).
    let handle = unsafe {
        CreateFileW(
            path_w.as_ptr(),
            0,
            0,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    let _guard = HandleGuard(handle);
    readlink_by_handle(handle)
}

/// Bounds-checked view into reparse data: `off`/`len` are u16 units relative
/// to `base`, which points inside `buf`. The slice must also lie within the
/// `ReparseDataLength` the driver declared — header-derived counts are
/// validated before use, surviving release builds. Real kernels never emit
/// out-of-bounds offsets; fail closed if a filter driver does.
/// // quirk: FSLNK-07
fn reparse_path_slice<'a>(
    buf: &'a [u8],
    data_len: usize,
    base: *const u16,
    off: usize,
    len: usize,
) -> Result<&'a [u16], Win32Error> {
    let base_off = base as usize - buf.as_ptr() as usize;
    let data_end = REPARSE_HEADER_BYTES + data_len;
    if data_end > buf.len() || base_off + (off + len) * 2 > data_end {
        return Err(Win32Error::INVALID_REPARSE_DATA);
    }
    // SAFETY: range checked against `buf` (and the declared data length)
    // just above; `base` is 2-aligned (every PathBuffer sits at an even
    // offset in the 8-aligned buffer).
    Ok(unsafe { core::slice::from_raw_parts(base.add(off), len) })
}

/// `\??\X:` or `\??\X:\...` — the NT-namespaced drive-absolute shape, the
/// only mount-point form treated as a symlink (a `\??\Volume{guid}` mount
/// point is deliberately NOT — returning an un-openable NT path confuses
/// callers, so such junctions read as `SYMLINK_NOT_SUPPORTED` and stat as
/// plain directories via the lstat→stat retry). // quirk: FSLNK-06, FSMETA-17
pub(crate) fn is_nt_drive_pattern(t: &[u16]) -> bool {
    t.len() >= 6
        && t[..4] == NT_PREFIX
        && is_ascii_letter(t[4])
        && t[5] == COLON
        && (t.len() == 6 || t[6] == BACKSLASH)
}

/// `\??\UNC\...` — the NT form CreateSymbolicLinkW stores for `\\server\...`
/// absolute targets. // quirk: FSLNK-03
fn is_nt_unc_pattern(t: &[u16]) -> bool {
    t.len() >= 8
        && t[..4] == NT_PREFIX
        && (t[4] == b'U' as u16 || t[4] == b'u' as u16)
        && (t[5] == b'N' as u16 || t[5] == b'n' as u16)
        && (t[6] == b'C' as u16 || t[6] == b'c' as u16)
        && t[7] == BACKSLASH
}

pub(crate) fn is_ascii_letter(c: u16) -> bool {
    (c >= b'A' as u16 && c <= b'Z' as u16) || (c >= b'a' as u16 && c <= b'z' as u16)
}

fn is_slash(c: u16) -> bool {
    c == BACKSLASH || c == FWDSLASH
}

/// The ONE reparse-tag classifier (libuv `fs__readlink_handle`): reads the
/// reparse data into a 16 KB stack buffer in a single ioctl (the kernel caps
/// payloads at `MAXIMUM_REPARSE_DATA_BUFFER_SIZE`, so no retry loop exists),
/// then switches on the tag. Consumed by [`readlink_path`], lstat
/// (`stat.rs`), and the unlink delete gate — one implementation so tag
/// support can never diverge. // quirk: FSLNK-01, FSLNK-50
///
/// Tag taxonomy:
/// - `SYMLINK`: SubstituteName (never PrintName); `\??\X:`-shaped NT
///   namespacing is undone, `\??\UNC\srv` rewrites to `\\srv`, every other
///   `\??\` form was made explicitly by the user and returns verbatim;
///   relative targets pass through untouched (`SYMLINK_FLAG_RELATIVE` is
///   never consulted). // quirk: FSLNK-02, FSLNK-03, FSLNK-04
/// - `LX_SYMLINK` (WSL): raw bytes after the 4-byte version field, no
///   encoding conversion; `ReparseDataLength < 4` is rejected before the
///   subtraction can wrap. // quirk: FSLNK-05
/// - `MOUNT_POINT`: drive-letter junctions only; volume-GUID mount points
///   are `SYMLINK_NOT_SUPPORTED`. // quirk: FSLNK-06
/// - `APPEXECLINK`: the 3rd NUL-separated string, only if `X:\`-absolute;
///   the string walk is bounded by `ReparseDataLength`. // quirk: FSLNK-07
/// - anything else is `SYMLINK_NOT_SUPPORTED`, never an error blob — cloud
///   placeholders etc. are ordinary files with reparse data.
///   // quirk: FSLNK-08
pub(crate) fn readlink_by_handle(handle: HANDLE) -> Result<ReadlinkTarget, Win32Error> {
    #[repr(C, align(8))]
    struct ReparseBuf([u8; MAXIMUM_REPARSE_DATA_BUFFER_SIZE]);
    let mut buf = ReparseBuf([0; MAXIMUM_REPARSE_DATA_BUFFER_SIZE]);
    let mut bytes: DWORD = 0;
    // SAFETY: owned, 8-aligned out-buffer of the documented maximum size;
    // null overlapped on a synchronous handle.
    let ok = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_GET_REPARSE_POINT,
            ptr::null_mut(),
            0,
            (&raw mut buf).cast(),
            MAXIMUM_REPARSE_DATA_BUFFER_SIZE as DWORD,
            &raw mut bytes,
            ptr::null_mut(),
        )
    };
    if ok == 0 {
        // Includes ERROR_NOT_A_REPARSE_POINT for plain files whose reparse
        // attribute is stale. // quirk: FSLNK-10
        return Err(Win32Error::get());
    }
    let rdb: *const REPARSE_DATA_BUFFER = (&raw const buf).cast();
    // SAFETY: the buffer is zero-initialized and at least header-sized; the
    // selected union arm's fixed fields lie within it. Reads only.
    let (tag, data_len) = unsafe { ((*rdb).ReparseTag, usize::from((*rdb).ReparseDataLength)) };

    if tag == IO_REPARSE_TAG_SYMLINK {
        // SAFETY: see above; PathBuffer's address is taken, not read.
        let (off, len, base) = unsafe {
            let s = &(*rdb).u.SymbolicLinkReparseBuffer;
            (
                usize::from(s.SubstituteNameOffset) / 2,
                usize::from(s.SubstituteNameLength) / 2,
                (&raw const s.PathBuffer).cast::<u16>(),
            )
        };
        let target = reparse_path_slice(&buf.0, data_len, base, off, len)?;
        // Undo only the implicit NT-namespacing CreateSymbolicLink performs
        // on absolute paths; other `\??\` forms were made explicitly by the
        // user and are returned verbatim. // quirk: FSLNK-02
        if is_nt_drive_pattern(target) {
            return Ok(ReadlinkTarget::Wide(target[4..].to_vec()));
        }
        if is_nt_unc_pattern(target) {
            // `\??\UNC\server\share` reads back as `\\server\share`: drop 6
            // units and the 'C' becomes '\'. // quirk: FSLNK-03
            let mut rewritten = target[6..].to_vec();
            rewritten[0] = BACKSLASH;
            return Ok(ReadlinkTarget::Wide(rewritten));
        }
        return Ok(ReadlinkTarget::Wide(target.to_vec())); // quirk: FSLNK-04
    }

    if tag == IO_REPARSE_TAG_LX_SYMLINK {
        // WSL symlink: raw stored bytes after the 4-byte version field.
        // `ReparseDataLength` is filesystem-controlled: validate it covers
        // the version field before subtracting. // quirk: FSLNK-05
        let Some(n) = data_len.checked_sub(size_of::<ULONG>()) else {
            return Err(Win32Error::INVALID_REPARSE_DATA);
        };
        // SAFETY: address-of only.
        let base =
            unsafe { (&raw const (*rdb).u.LinuxSymbolicLinkReparseBuffer.PathBuffer).cast::<u8>() };
        let base_off = base as usize - buf.0.as_ptr() as usize;
        if base_off + n > REPARSE_HEADER_BYTES + data_len
            || REPARSE_HEADER_BYTES + data_len > buf.0.len()
        {
            return Err(Win32Error::INVALID_REPARSE_DATA);
        }
        return Ok(ReadlinkTarget::Bytes(
            buf.0[base_off..base_off + n].to_vec(),
        ));
    }

    if tag == IO_REPARSE_TAG_MOUNT_POINT {
        // SAFETY: as for the symlink arm.
        let (off, len, base) = unsafe {
            let m = &(*rdb).u.MountPointReparseBuffer;
            (
                usize::from(m.SubstituteNameOffset) / 2,
                usize::from(m.SubstituteNameLength) / 2,
                (&raw const m.PathBuffer).cast::<u16>(),
            )
        };
        let target = reparse_path_slice(&buf.0, data_len, base, off, len)?;
        if !is_nt_drive_pattern(target) {
            return Err(Win32Error::SYMLINK_NOT_SUPPORTED); // quirk: FSLNK-06
        }
        return Ok(ReadlinkTarget::Wide(target[4..].to_vec()));
    }

    if tag == IO_REPARSE_TAG_APPEXECLINK {
        // Microsoft Store alias (`python.exe` etc.): the 3rd NUL-separated
        // string is the target, and only if it is an absolute `X:\` path.
        // SAFETY: as for the symlink arm.
        let (count, base) = unsafe {
            let a = &(*rdb).u.AppExecLinkReparseBuffer;
            (a.StringCount, (&raw const a.StringList).cast::<u16>())
        };
        if count < 3 {
            return Err(Win32Error::SYMLINK_NOT_SUPPORTED);
        }
        let base_off = base as usize - buf.0.as_ptr() as usize;
        let data_end = (REPARSE_HEADER_BYTES + data_len).min(buf.0.len());
        let avail = data_end.saturating_sub(base_off) / 2;
        let mut rest = reparse_path_slice(&buf.0, data_len, base, 0, avail)?;
        for _ in 0..2 {
            let Some(nul) = rest.iter().position(|&c| c == 0) else {
                return Err(Win32Error::SYMLINK_NOT_SUPPORTED);
            };
            if nul == 0 {
                return Err(Win32Error::SYMLINK_NOT_SUPPORTED);
            }
            rest = &rest[nul + 1..];
        }
        let len = rest.iter().position(|&c| c == 0).unwrap_or(rest.len());
        let target = &rest[..len];
        if !(target.len() >= 3
            && is_ascii_letter(target[0])
            && target[1] == COLON
            && target[2] == BACKSLASH)
        {
            return Err(Win32Error::SYMLINK_NOT_SUPPORTED); // quirk: FSLNK-07
        }
        return Ok(ReadlinkTarget::Wide(target.to_vec()));
    }

    // Reparse tag does not indicate a symlink. // quirk: FSLNK-08
    Err(Win32Error::SYMLINK_NOT_SUPPORTED)
}

// ───────────────────────────── symlink / junction ─────────────────────────

/// Symlink kind selectors, bit-for-bit libuv's `UV_FS_SYMLINK_*` (uv.h) — a
/// node `fs.symlink` `type` plumbs through unchanged.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct SymlinkFlags(pub u32);

impl SymlinkFlags {
    pub const NONE: Self = Self(0);
    /// `UV_FS_SYMLINK_DIR` — create a DIRECTORY symlink. Directory-ness is
    /// baked in at creation; the engine never sniffs the target.
    /// // quirk: FSLNK-14
    pub const DIR: Self = Self(0x0001);
    /// `UV_FS_SYMLINK_JUNCTION` — create an NTFS junction (mount point)
    /// instead; needs no privilege. // quirk: FSLNK-13
    pub const JUNCTION: Self = Self(0x0002);

    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

/// Process-global cache for `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE`:
/// initialized to the flag; cleared (monotonic, so the race is benign) the
/// first time the OS rejects it with `ERROR_INVALID_PARAMETER` — kept as a
/// one-branch guard for Wine/ReactOS emulation layers even though the 1809
/// baseline always accepts it. // quirk: FSLNK-12
static SYMLINK_USERMODE_FLAG: AtomicU32 =
    AtomicU32::new(SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE);

/// symlink(2)-alike over NUL-terminated wide paths: creates `link_w` pointing
/// at `target_w`. `JUNCTION` builds a mount point by hand (there is no
/// CreateJunction API); otherwise `CreateSymbolicLinkW` with
/// `SYMBOLIC_LINK_FLAG_DIRECTORY` iff `DIR` — the unprivileged-create flag is
/// applied on BOTH branches (the historical libuv bug was applying it to one).
/// // quirk: FSLNK-12, FSLNK-14
///
/// Without Developer Mode or `SeCreateSymbolicLinkPrivilege` non-junction
/// creation fails raw `PRIVILEGE_NOT_HELD` (EPERM downstream) — the engine
/// never auto-downgrades to a junction; that policy belongs to callers.
/// // quirk: FSLNK-13
pub fn symlink_path(
    target_w: &[u16],
    link_w: &[u16],
    flags: SymlinkFlags,
) -> Result<(), Win32Error> {
    let Some((&0, target_units)) = target_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    let Some((&0, link_units)) = link_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!target_units.contains(&0), "interior NUL in wide path");
    debug_assert!(!link_units.contains(&0), "interior NUL in wide path");

    if flags.contains(SymlinkFlags::JUNCTION) {
        return create_junction(target_units, link_w);
    }

    let dir_flag = if flags.contains(SymlinkFlags::DIR) {
        SYMBOLIC_LINK_FLAG_DIRECTORY
    } else {
        0
    };
    loop {
        let usermode = SYMLINK_USERMODE_FLAG.load(Ordering::Relaxed);
        // SAFETY: both paths are NUL-terminated (validated above).
        let ok =
            unsafe { CreateSymbolicLinkW(link_w.as_ptr(), target_w.as_ptr(), dir_flag | usermode) };
        if ok != 0 {
            return Ok(());
        }
        let e = Win32Error::get();
        if e == Win32Error::INVALID_PARAMETER && usermode != 0 {
            // The OS rejected the unprivileged-create flag wholesale: clear
            // the cache and retry once without it (the cleared cache makes
            // this branch unreachable on the second pass). // quirk: FSLNK-12
            SYMLINK_USERMODE_FLAG.store(0, Ordering::Relaxed);
            continue;
        }
        return Err(e);
    }
}

/// Builds the `IO_REPARSE_TAG_MOUNT_POINT` blob for `target` (sans NUL) as
/// the u16 sequence `FSCTL_SET_REPARSE_POINT` consumes: header, the four
/// name offset/length fields, then SubstituteName (`\??\`-prefixed) and
/// PrintName, each NUL-terminated (lengths exclude the terminators).
///
/// Target rules: absolute only (`X:\...` or `\\?\`-prefixed, which is
/// stripped before re-prefixing with `\??\`) — relative targets are raw
/// `NOT_SUPPORTED` (the wrapper's symlink-context EINVAL). Slashes normalize
/// to `\` and runs collapse; a trailing slash is kept iff the caller's path
/// ended with one (drive-root junctions NEED it; other tools choke on
/// spurious ones); PrintName additionally gains `\` for a bare `C:` drive.
/// // quirk: FSLNK-17
fn build_mount_point_blob(target: &[u16]) -> Result<Vec<u16>, Win32Error> {
    let is_long_path =
        target.len() >= 4 && target[..4] == [BACKSLASH, BACKSLASH, b'?' as u16, BACKSLASH];
    let is_absolute = is_long_path
        || (target.len() >= 3
            && is_ascii_letter(target[0])
            && target[1] == COLON
            && is_slash(target[2]));
    if !is_absolute {
        return Err(Win32Error::NOT_SUPPORTED); // quirk: FSLNK-17
    }
    let content = if is_long_path { &target[4..] } else { target };

    // Header (4 u16) + name fields (4 u16) + worst case both names with
    // prefix, trailing slash and NULs.
    let mut blob: Vec<u16> = Vec::with_capacity(8 + 2 * (content.len() + NT_PREFIX.len() + 2));
    blob.extend_from_slice(&[0; 8]); // header + name fields, patched below

    // SubstituteName: `\??\` + normalized target.
    let sub_start = blob.len();
    blob.extend_from_slice(&NT_PREFIX);
    let mut add_slash = false;
    for &c in content {
        if is_slash(c) {
            add_slash = true;
            continue;
        }
        if add_slash {
            blob.push(BACKSLASH);
            add_slash = false;
        }
        blob.push(c);
    }
    if add_slash {
        // The caller's path ended with a separator: keep exactly one.
        blob.push(BACKSLASH);
    }
    let sub_len = blob.len() - sub_start;
    blob.push(0);

    // PrintName: normalized target, no NT prefix.
    let print_start = blob.len();
    add_slash = false;
    for &c in content {
        if is_slash(c) {
            add_slash = true;
            continue;
        }
        if add_slash {
            blob.push(BACKSLASH);
            add_slash = false;
        }
        blob.push(c);
    }
    let mut print_len = blob.len() - print_start;
    if print_len == 2 || add_slash {
        // Trailing separator as above, plus the bare-`C:` special case.
        // // quirk: FSLNK-17
        blob.push(BACKSLASH);
        print_len += 1;
    }
    blob.push(0);

    // ReparseDataLength covers the four name fields + both path buffers.
    let data_len = (blob.len() - 4) * 2;
    if REPARSE_HEADER_BYTES + data_len > MAXIMUM_REPARSE_DATA_BUFFER_SIZE {
        // Would truncate the u16 length field / exceed the kernel cap.
        return Err(Win32Error::INVALID_PARAMETER);
    }
    blob[0] = IO_REPARSE_TAG_MOUNT_POINT as u16;
    blob[1] = (IO_REPARSE_TAG_MOUNT_POINT >> 16) as u16;
    blob[2] = data_len as u16;
    blob[3] = 0; // Reserved
    blob[4] = 0; // SubstituteNameOffset
    blob[5] = (sub_len * 2) as u16;
    blob[6] = ((sub_len + 1) * 2) as u16; // PrintNameOffset (past sub + NUL)
    blob[7] = (print_len * 2) as u16;
    Ok(blob)
}

/// Junction creation is a hand-built reparse buffer: validate + build the
/// blob first (no side effects on bad targets), `CreateDirectoryW`, open the
/// new directory `GENERIC_WRITE` (never GENERIC_ALL — extra rights fail under
/// restrictive ACLs), `FSCTL_SET_REPARSE_POINT`, and on any later failure
/// roll the directory back — closing the handle FIRST, since the share-0
/// open would block its own `RemoveDirectoryW`. // quirk: FSLNK-15, FSLNK-16
fn create_junction(target: &[u16], link_w: &[u16]) -> Result<(), Win32Error> {
    let mut blob = build_mount_point_blob(target)?;

    // SAFETY: `link_w` is NUL-terminated (caller validated).
    if unsafe { CreateDirectoryW(link_w.as_ptr(), ptr::null_mut()) } == 0 {
        return Err(Win32Error::get());
    }

    let result = (|| {
        // SAFETY: `link_w` is NUL-terminated.
        let handle = unsafe {
            CreateFileW(
                link_w.as_ptr(),
                GENERIC_WRITE, // quirk: FSLNK-16
                0,
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
            Err(Win32Error::get())
        } else {
            Ok(())
        }
        // `_guard` drops here — the handle is closed BEFORE any rollback.
        // // quirk: FSLNK-15
    })();

    if result.is_err() {
        // Roll back only the directory THIS call created.
        // SAFETY: `link_w` is NUL-terminated; best-effort, the original
        // error is what surfaces.
        unsafe { RemoveDirectoryW(link_w.as_ptr()) };
    }
    result
}

// ───────────────────────────── unlink / rmdir ─────────────────────────────

/// unlink(2): POSIX-semantics delete of a file or symlink-class link object.
/// Plain directories are refused with raw `ACCESS_DENIED` (EPERM downstream,
/// as POSIX.1 mandates); directory reparse points are deleted only when the
/// shared classifier vouches the tag is symlink-class — so junctions,
/// dir-symlinks and WSL links unlink (the LINK, never the target), while
/// mounted-volume and unknown-tag reparse directories are refused.
/// // quirk: FSLNK-20, FSLNK-49, FSLNK-50
pub fn unlink_path(path_w: &[u16]) -> Result<(), Win32Error> {
    unlink_rmdir(path_w, false)
}

/// rmdir(2): same disposition machinery, directories only. A non-directory
/// is raw `ERROR_DIRECTORY` (267 — ENOENT downstream, libuv's frozen
/// back-compat shape, NOT ENOTDIR). `rmdir(junction)` removes the junction,
/// never the target (`rmdir(dir-symlink)` likewise — a deliberate deviation
/// from POSIX, where rmdir(symlink) is ENOTDIR, because these link objects
/// genuinely are directories). // quirk: FSLNK-21, FSLNK-49
pub fn rmdir_path(path_w: &[u16]) -> Result<(), Win32Error> {
    unlink_rmdir(path_w, true)
}

/// Shared delete chain (libuv `fs__unlink_rmdir`): one minimal-rights open —
/// `DELETE | FILE_READ_ATTRIBUTES`, share-everything, `OPEN_REPARSE_POINT |
/// BACKUP_SEMANTICS`, deliberately NOT `FILE_WRITE_ATTRIBUTES` (Wine fails
/// such opens on read-only files) — then `FileDispositionInformationEx` with
/// `DELETE | POSIX_SEMANTICS | IGNORE_READONLY_ATTRIBUTE` in one shot; the
/// name disappears immediately even while other handles hold the file.
/// // quirk: FSLNK-19, FSLNK-22
///
/// Exactly three errors route to the legacy fallback (`NOT_SUPPORTED`,
/// `INVALID_PARAMETER`, `INVALID_FUNCTION` — FAT/exFAT/SMB/FUSE return these
/// on modern Windows too): clear READONLY via a `ReOpenFile`d
/// write-attributes handle, OR-ing in `ARCHIVE` because attributes==0 means
/// "don't change", then classic `FileDispositionInformation`. A surviving
/// `STATUS_CANNOT_DELETE` from the POSIX path uniquely means a mapped view
/// exists (EACCES downstream). // quirk: FSLNK-23, FSLNK-24
fn unlink_rmdir(path_w: &[u16], is_rmdir: bool) -> Result<(), Win32Error> {
    let Some((&0, units)) = path_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!units.contains(&0), "interior NUL in wide path");

    // SAFETY: `path_w` is NUL-terminated (validated above).
    let handle = unsafe {
        CreateFileW(
            path_w.as_ptr(),
            DELETE | FILE_READ_ATTRIBUTES, // quirk: FSLNK-19
            SHARE_ALL,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, // quirk: FSLNK-49
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    let _guard = HandleGuard(handle);

    // FileBasicInfo via the Ex API: one syscall — the legacy
    // GetFileInformationByHandle also queries volume info. // quirk: FSLNK-25
    let mut info = FILE_BASIC_INFORMATION::default();
    // SAFETY: owned out-param; the winbase FILE_BASIC_INFO payload is
    // layout-identical to FILE_BASIC_INFORMATION.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileBasicInfo,
            (&raw mut info).cast(),
            size_of::<FILE_BASIC_INFORMATION>() as DWORD,
        )
    };
    if ok == 0 {
        return Err(Win32Error::get());
    }
    let attrs = info.FileAttributes;

    if is_rmdir && attrs & FILE_ATTRIBUTE_DIRECTORY == 0 {
        // rmdir on a non-directory: ERROR_DIRECTORY (ENOENT downstream).
        // // quirk: FSLNK-21
        return Err(Win32Error::DIRECTORY);
    }
    if !is_rmdir && attrs & FILE_ATTRIBUTE_DIRECTORY != 0 {
        if attrs & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
            // POSIX.1: unlink of a directory is EPERM. // quirk: FSLNK-20
            return Err(Win32Error::ACCESS_DENIED);
        }
        // The shared classifier double-duties as the delete gate: only
        // symlink-class tags may be unlinked. // quirk: FSLNK-20, FSLNK-50
        if let Err(e) = readlink_by_handle(handle) {
            return Err(if e == Win32Error::SYMLINK_NOT_SUPPORTED {
                Win32Error::ACCESS_DENIED
            } else {
                e
            });
        }
    }

    // POSIX delete first. // quirk: FSLNK-22
    let mut disposition_ex = FILE_DISPOSITION_INFORMATION_EX {
        Flags: FILE_DISPOSITION_DELETE
            | FILE_DISPOSITION_POSIX_SEMANTICS
            | FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };
    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    // SAFETY: owned in/out params of exactly the class size.
    let status = unsafe {
        NtSetInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut disposition_ex).cast(),
            size_of::<FILE_DISPOSITION_INFORMATION_EX>() as ULONG,
            FILE_INFORMATION_CLASS::FileDispositionInformationEx,
        )
    };
    if NT_SUCCESS(status) {
        return Ok(());
    }
    let error = Win32Error::from_ntstatus(status);
    if error != Win32Error::NOT_SUPPORTED
        && error != Win32Error::INVALID_PARAMETER
        && error != Win32Error::INVALID_FUNCTION
    {
        // Not a "posix delete unsupported" shape — report directly (this is
        // also where STATUS_CANNOT_DELETE = mapped-view lands).
        // // quirk: FSLNK-22, FSLNK-23
        return Err(error);
    }

    // Legacy fallback for filesystems without FileDispositionInformationEx.
    // // quirk: FSLNK-23
    if attrs & FILE_ATTRIBUTE_READONLY != 0 {
        // attributes==0 is the "leave unchanged" sentinel: OR in ARCHIVE so a
        // READONLY-only file still gets a nonzero write. // quirk: FSLNK-24
        let mut basic = FILE_BASIC_INFORMATION {
            FileAttributes: (attrs & !FILE_ATTRIBUTE_READONLY) | FILE_ATTRIBUTE_ARCHIVE,
            ..Default::default()
        };
        // The delete open deliberately lacks FILE_WRITE_ATTRIBUTES (Wine bug
        // 50771): acquire it on demand via ReOpenFile and drop it right
        // after. // quirk: FSLNK-19
        // SAFETY: `handle` is live (guarded above); flags mirror the open.
        let write_handle = unsafe {
            ReOpenFile(
                handle,
                FILE_WRITE_ATTRIBUTES,
                SHARE_ALL,
                FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            )
        };
        if write_handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::get());
        }
        let write_guard = HandleGuard(write_handle);
        let mut io_status = IO_STATUS_BLOCK {
            Status: 0,
            Information: 0,
        };
        // SAFETY: owned in/out params of exactly the class size.
        let status = unsafe {
            NtSetInformationFile(
                write_handle,
                &raw mut io_status,
                (&raw mut basic).cast(),
                size_of::<FILE_BASIC_INFORMATION>() as ULONG,
                FILE_INFORMATION_CLASS::FileBasicInformation,
            )
        };
        drop(write_guard);
        if !NT_SUCCESS(status) {
            return Err(Win32Error::from_ntstatus(status));
        }
    }

    let mut disposition = FILE_DISPOSITION_INFORMATION { DeleteFile: 1 };
    let mut io_status = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    // SAFETY: owned in/out params of exactly the class size.
    let status = unsafe {
        NtSetInformationFile(
            handle,
            &raw mut io_status,
            (&raw mut disposition).cast(),
            size_of::<FILE_DISPOSITION_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileDispositionInformation,
        )
    };
    if NT_SUCCESS(status) {
        Ok(())
    } else {
        Err(Win32Error::from_ntstatus(status))
    }
}

// ───────────────────────────── rename ─────────────────────────────

const RENAME_EX_FLAGS: ULONG = FILE_RENAME_REPLACE_IF_EXISTS
    | FILE_RENAME_POSIX_SEMANTICS
    | FILE_RENAME_IGNORE_READONLY_ATTRIBUTE;

/// rename(2): opens `from_w` with the minimal `DELETE` right
/// (`OPEN_REPARSE_POINT` so a symlink moves the LINK, never the target;
/// share-everything so open files rename), then
/// `SetFileInformationByHandle(FileRenameInfoEx)` with `REPLACE_IF_EXISTS |
/// POSIX_SEMANTICS | IGNORE_READONLY_ATTRIBUTE`. The same three
/// not-supported errors as the delete chain fall back to the classic
/// `FileRenameInfo` (`ReplaceIfExists = TRUE`). // quirk: FSLNK-23
///
/// `to_w` is handed to kernelbase verbatim, which performs the full Win32
/// path conversion (kernel-probed: absolute DOS paths, CWD-relative paths
/// and forward slashes all work). Pinned semantics: replaces read-only and
/// open (share-delete) destination files, case-only renames apply, `dir →
/// existing empty dir` succeeds and `dir → non-empty dir` is raw
/// `DIR_NOT_EMPTY` (POSIX parity `MoveFileExW` cannot give), `file →
/// existing dir` is raw `ACCESS_DENIED`, `dir → existing file` REPLACES the
/// file (libuv/Node parity, via the classic-class fallback below — POSIX
/// would refuse with ENOTDIR), and cross-device renames surface raw
/// `NOT_SAME_DEVICE` (EXDEV downstream). // quirk: FSLNK-46
pub fn rename_path(from_w: &[u16], to_w: &[u16]) -> Result<(), Win32Error> {
    let Some((&0, from_units)) = from_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    let Some((&0, to_units)) = to_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!from_units.contains(&0), "interior NUL in wide path");
    debug_assert!(!to_units.contains(&0), "interior NUL in wide path");

    // SAFETY: `from_w` is NUL-terminated (validated above).
    let handle = unsafe {
        CreateFileW(
            from_w.as_ptr(),
            DELETE,
            SHARE_ALL,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    let _guard = HandleGuard(handle);

    match set_rename_info(handle, to_units, RENAME_EX_FLAGS, FileRenameInfoEx) {
        Err(e)
            if e == Win32Error::NOT_SUPPORTED
                || e == Win32Error::INVALID_PARAMETER
                || e == Win32Error::INVALID_FUNCTION =>
        {
            // Filesystem without FileRenameInformationEx: classic rename.
            // Flags = 1 sets the union's first byte, the BOOLEAN
            // ReplaceIfExists = TRUE of the non-Ex layout. // quirk: FSLNK-23
            set_rename_info(handle, to_units, 1, FileRenameInfo)
        }
        Err(e) if e == Win32Error::DIRECTORY => {
            // dir → existing file: POSIX_SEMANTICS enforces POSIX's
            // rename(dir, file) == ENOTDIR rule (raw 267), but Windows-native
            // rename — and therefore libuv/Node via MoveFileExW — lets a
            // directory REPLACE a file. Kernel-probed: the Ex call yields 267
            // for exactly this cell (path-through-file destinations are
            // PATH_NOT_FOUND on every variant), and the classic class
            // performs the replace with edge shapes identical to MoveFileExW
            // (read-only / open destinations fail ACCESS_DENIED in both —
            // the same atomic kernel rename-replace underneath).
            set_rename_info(handle, to_units, 1, FileRenameInfo)
        }
        result => result,
    }
}

/// Issues one `SetFileInformationByHandle` rename with the given class. The
/// variable-length info struct is assembled in a u64-backed heap buffer so
/// the `FILE_RENAME_INFORMATION_EX` header (align 8) is properly aligned.
fn set_rename_info(
    handle: HANDLE,
    to_units: &[u16],
    flags: ULONG,
    class: FILE_INFO_BY_HANDLE_CLASS,
) -> Result<(), Win32Error> {
    let name_bytes = to_units.len() * 2;
    let Ok(name_bytes_u32) = ULONG::try_from(name_bytes) else {
        return Err(Win32Error::INVALID_PARAMETER);
    };
    // The header's trailing `FileName: [u16; 1]` slot doubles as the NUL the
    // kernel does not require; total stays >= header for empty names.
    let total = size_of::<FILE_RENAME_INFORMATION_EX>() + name_bytes;
    let mut raw: Vec<u64> = vec![0; total.div_ceil(size_of::<u64>())];
    let info: *mut FILE_RENAME_INFORMATION_EX = raw.as_mut_ptr().cast();
    // SAFETY: `info` is 8-aligned (u64 backing) and `raw` spans `total`
    // bytes; raw-pointer field writes keep whole-allocation provenance so
    // the FileName tail past the nominal struct size stays in-bounds.
    unsafe {
        (*info).Flags = flags;
        (*info).RootDirectory = ptr::null_mut();
        (*info).FileNameLength = name_bytes_u32;
        ptr::copy_nonoverlapping(
            to_units.as_ptr(),
            (&raw mut (*info).FileName).cast::<u16>(),
            to_units.len(),
        );
    }
    // SAFETY: `handle` is live (caller guards it); buffer described above.
    let ok = unsafe {
        SetFileInformationByHandle(handle, class, raw.as_mut_ptr().cast(), total as DWORD)
    };
    if ok == 0 {
        Err(Win32Error::get())
    } else {
        Ok(())
    }
}

// ───────────────────────────── link / mkdir ─────────────────────────────

/// link(2): `CreateHardLinkW(new, existing)` — destination FIRST, the
/// reverse of POSIX argument order (a shipped libuv regression got this
/// backwards). Cross-volume links surface raw `NOT_SAME_DEVICE` (EXDEV
/// downstream); an existing destination is raw `ALREADY_EXISTS`.
/// // quirk: FSLNK-18
pub fn link_path(existing_w: &[u16], new_w: &[u16]) -> Result<(), Win32Error> {
    let Some((&0, existing_units)) = existing_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    let Some((&0, new_units)) = new_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!existing_units.contains(&0), "interior NUL in wide path");
    debug_assert!(!new_units.contains(&0), "interior NUL in wide path");
    // SAFETY: both paths are NUL-terminated (validated above).
    if unsafe { CreateHardLinkW(new_w.as_ptr(), existing_w.as_ptr(), ptr::null_mut()) } == 0 {
        Err(Win32Error::get())
    } else {
        Ok(())
    }
}

/// mkdir(2): `CreateDirectoryW`, POSIX mode deliberately ignored (libuv
/// parity — Windows directories carry no mode; the READONLY attribute on
/// directories does not mean what 0444 means). No recursion: a missing
/// parent is raw `PATH_NOT_FOUND`. Raw `INVALID_NAME` (bad characters) and
/// `DIRECTORY` (malformed path) come back as-is — the wrapper's mkdir-local
/// EINVAL remap distinguishes "can never exist" from "missing parent" for
/// recursive mkdir. // quirk: FSLNK-26
pub fn mkdir_path(path_w: &[u16]) -> Result<(), Win32Error> {
    let Some((&0, units)) = path_w.split_last() else {
        debug_assert!(false, "wide path must include its NUL terminator");
        return Err(Win32Error::INVALID_PARAMETER);
    };
    debug_assert!(!units.contains(&0), "interior NUL in wide path");
    // SAFETY: `path_w` is NUL-terminated (validated above).
    if unsafe { CreateDirectoryW(path_w.as_ptr(), ptr::null_mut()) } == 0 {
        Err(Win32Error::get())
    } else {
        Ok(())
    }
}

// ───────────────────────────── tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};

    use bun_windows_sys::kernel32::GetVolumeNameForVolumeMountPointW;
    use bun_windows_sys::{DeleteFileW, GENERIC_READ, NTSTATUS, SetFileAttributesW};

    use super::*;
    use crate::fsio::OpenFlags;
    use crate::stat::{
        S_IFDIR, S_IFLNK, S_IFMT, S_IFREG, WindowsStat, lstat_path, stat_path, utf16_length_as_wtf8,
    };

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
                "bun_winfs_lnk_{tag}_{}_{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            mkdir_path(&wide(&root)).unwrap_or_else(|e| panic!("mkdir_path({root:?}): {e:?}"));
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
            mkdir_path(&wide(&path)).unwrap_or_else(|e| panic!("mkdir_path({path:?}): {e:?}"));
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
                    SetFileAttributesW(w.as_ptr(), bun_windows_sys::FILE_ATTRIBUTE_NORMAL);
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

    /// Applies raw reparse data (header + payload bytes) to an existing file
    /// or directory.
    fn set_reparse_raw(path: &Path, tag: u32, payload: &[u8]) -> Result<(), Win32Error> {
        let w = wide(path);
        // SAFETY: NUL-terminated path; opening the stub itself for writing.
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

    /// MOUNT_POINT payload: the four u16 name fields + SubstituteName +
    /// PrintName, each NUL-terminated.
    fn mount_point_payload(substitute: &[u16], print: &[u16]) -> Vec<u8> {
        let sub_bytes = substitute.len() * 2;
        let print_bytes = print.len() * 2;
        let mut payload = Vec::new();
        payload.extend_from_slice(&0u16.to_le_bytes()); // SubstituteNameOffset
        payload.extend_from_slice(&(sub_bytes as u16).to_le_bytes());
        payload.extend_from_slice(&((sub_bytes + 2) as u16).to_le_bytes()); // PrintNameOffset
        payload.extend_from_slice(&(print_bytes as u16).to_le_bytes());
        for &u in substitute {
            payload.extend_from_slice(&u.to_le_bytes());
        }
        payload.extend_from_slice(&0u16.to_le_bytes());
        for &u in print {
            payload.extend_from_slice(&u.to_le_bytes());
        }
        payload.extend_from_slice(&0u16.to_le_bytes());
        payload
    }

    fn readlink_wide(path: &Path) -> Vec<u16> {
        match readlink_path(&wide(path)) {
            Ok(ReadlinkTarget::Wide(units)) => units,
            other => panic!("expected Wide target for {path:?}, got {other:?}"),
        }
    }

    /// Attempts engine symlink creation. The ONLY tolerated failure is the
    /// documented `PRIVILEGE_NOT_HELD` shape (Developer Mode off, not
    /// elevated) — anything else fails the test. // quirk: FSLNK-13
    fn symlink_or_skip(target_w: &[u16], link_w: &[u16], flags: SymlinkFlags) -> bool {
        match symlink_path(target_w, link_w, flags) {
            Ok(()) => true,
            Err(e) => {
                assert_eq!(
                    e,
                    Win32Error::PRIVILEGE_NOT_HELD,
                    "symlink creation may only fail with the documented privilege error"
                );
                eprintln!(
                    "skip: symlink creation unavailable (PRIVILEGE_NOT_HELD — enable Developer Mode)"
                );
                false
            }
        }
    }

    // ── pure KATs ──

    /// The raw NTSTATUS→Win32 shapes this area's error contract depends on,
    /// probed against the real `RtlNtStatusToDosError`: cross-device rename/
    /// link (EXDEV downstream), non-empty dir (ENOTEMPTY), mapped-view
    /// delete (EACCES), and the two fallback triggers.
    /// // quirk: FSLNK-22, FSLNK-23, FSLNK-46
    #[test]
    fn ntstatus_dos_mapping_kats() {
        assert_eq!(
            Win32Error::from_ntstatus(NTSTATUS::NOT_SAME_DEVICE),
            Win32Error::NOT_SAME_DEVICE
        );
        assert_eq!(
            Win32Error::from_ntstatus(NTSTATUS::DIRECTORY_NOT_EMPTY),
            Win32Error::DIR_NOT_EMPTY
        );
        assert_eq!(
            Win32Error::from_ntstatus(NTSTATUS::CANNOT_DELETE),
            Win32Error::ACCESS_DENIED
        );
        assert_eq!(
            Win32Error::from_ntstatus(NTSTATUS::NOT_SUPPORTED),
            Win32Error::NOT_SUPPORTED
        );
        assert_eq!(
            Win32Error::from_ntstatus(NTSTATUS::INVALID_PARAMETER),
            Win32Error::INVALID_PARAMETER
        );
    }

    /// The junction blob builder against crafted targets — offsets, lengths,
    /// slash normalization and the trailing-slash compromise, without
    /// touching the filesystem. // quirk: FSLNK-17
    #[test]
    fn mount_point_blob_kats() {
        let blob = build_mount_point_blob(&wide_str("C:\\x")[..4]).unwrap();
        // Header: tag, data_len, reserved.
        assert_eq!(blob[0], IO_REPARSE_TAG_MOUNT_POINT as u16);
        assert_eq!(blob[1], (IO_REPARSE_TAG_MOUNT_POINT >> 16) as u16);
        let sub: Vec<u16> = wide_str("\\??\\C:\\x")[..8].to_vec();
        let print: Vec<u16> = wide_str("C:\\x")[..4].to_vec();
        assert_eq!(blob[4], 0, "SubstituteNameOffset");
        assert_eq!(blob[5] as usize, sub.len() * 2, "SubstituteNameLength");
        assert_eq!(blob[6] as usize, (sub.len() + 1) * 2, "PrintNameOffset");
        assert_eq!(blob[7] as usize, print.len() * 2, "PrintNameLength");
        assert_eq!(&blob[8..8 + sub.len()], &sub[..]);
        assert_eq!(blob[8 + sub.len()], 0);
        let p0 = 8 + sub.len() + 1;
        assert_eq!(&blob[p0..p0 + print.len()], &print[..]);
        assert_eq!(blob[p0 + print.len()], 0);
        assert_eq!(blob[2] as usize, (blob.len() - 4) * 2, "ReparseDataLength");

        // Forward slashes normalize, runs collapse, trailing slash mirrors
        // the input. // quirk: FSLNK-17
        let norm = |s: &str| {
            let w = wide_str(s);
            let blob = build_mount_point_blob(&w[..w.len() - 1]).unwrap();
            let sub_len = blob[5] as usize / 2;
            blob[8..8 + sub_len].to_vec()
        };
        assert_eq!(norm("C:/a//b"), wide_str("\\??\\C:\\a\\b")[..10].to_vec());
        assert_eq!(norm("C:\\a\\"), wide_str("\\??\\C:\\a\\")[..9].to_vec());
        assert_eq!(norm("C:\\a"), wide_str("\\??\\C:\\a")[..8].to_vec());
        // `\\?\` prefix is stripped before re-prefixing with `\??\`.
        assert_eq!(norm("\\\\?\\C:\\a"), wide_str("\\??\\C:\\a")[..8].to_vec());

        // Drive root: substitute keeps the slash (input had it), print gets
        // the bare-`C:` special case slash.
        let w = wide_str("C:\\");
        let blob = build_mount_point_blob(&w[..w.len() - 1]).unwrap();
        let sub_len = blob[5] as usize / 2;
        assert_eq!(&blob[8..8 + sub_len], &wide_str("\\??\\C:\\")[..7]);
        let print_off = 8 + blob[6] as usize / 2;
        let print_len = blob[7] as usize / 2;
        assert_eq!(
            &blob[print_off..print_off + print_len],
            &wide_str("C:\\")[..3]
        );

        // Relative targets are refused before any side effect.
        for bad in ["rel\\x", "C:", "x", ""] {
            let w = wide_str(bad);
            assert_eq!(
                build_mount_point_blob(&w[..w.len() - 1]).unwrap_err(),
                Win32Error::NOT_SUPPORTED,
                "target {bad:?}"
            );
        }
    }

    // ── symlinks ──

    /// File symlinks: relative targets pass through untouched, absolute
    /// targets get the NT-namespace conversion undone, lstat/stat agree with
    /// readlink. // quirk: FSLNK-02, FSLNK-04, FSLNK-12
    #[test]
    fn symlink_file_roundtrip_and_stat_agreement() {
        let mut fx = Fixture::new("symfile");
        let target_name = "t\u{00E4}rget_lnk.txt"; // non-ASCII: WTF-8 len ≠ unit count
        let target = fx.file(target_name, b"contents9");

        // Relative target: stored and read back verbatim.
        let link = fx.root.join("rel_link.txt");
        let wt = wide_str(target_name);
        if !symlink_or_skip(&wt, &wide(&link), SymlinkFlags::NONE) {
            return;
        }
        fx.track(&link, false);
        let raw = readlink_wide(&link);
        assert_eq!(raw, wt[..wt.len() - 1].to_vec(), "relative target verbatim");

        let lst = lstat(&link).unwrap();
        assert_eq!(lst.st_mode & S_IFMT, S_IFLNK);
        assert_eq!(lst.st_size as usize, utf16_length_as_wtf8(&raw));
        let st = stat(&link).unwrap();
        assert_eq!(st.st_mode & S_IFMT, S_IFREG);
        assert_eq!(st.st_size, 9);
        assert_eq!(st.st_ino, stat(&target).unwrap().st_ino);

        // Absolute target: stored as \??\C:\... — readlink undoes it.
        let abs_link = fx.root.join("abs_link.txt");
        let wabs = wide(&target);
        assert!(symlink_or_skip(&wabs, &wide(&abs_link), SymlinkFlags::NONE));
        fx.track(&abs_link, false);
        let raw = readlink_wide(&abs_link);
        assert_eq!(raw, wabs[..wabs.len() - 1].to_vec(), "NT prefix undone");

        // unlink removes the LINK; the target file survives with content.
        unlink_path(&wide(&abs_link)).unwrap();
        assert_eq!(stat(&abs_link).unwrap_err(), Win32Error::FILE_NOT_FOUND);
        assert_eq!(read_small(&target).unwrap(), b"contents9");
    }

    /// Lone surrogates in targets round-trip as raw WTF-16 — no conversion
    /// happens in-engine. // quirk: FSLNK-11
    #[test]
    fn symlink_lone_surrogate_target_roundtrip() {
        let mut fx = Fixture::new("symsurr");
        let link = fx.root.join("surr_link.txt");
        // "lone_<U+D800 unpaired>.txt" — a legal NTFS name/target.
        let mut target_units = wide_str("lone_")[..5].to_vec();
        target_units.push(0xD800);
        target_units.extend_from_slice(&wide_str(".txt")[..4]);
        let mut target_w = target_units.clone();
        target_w.push(0);
        if !symlink_or_skip(&target_w, &wide(&link), SymlinkFlags::NONE) {
            return;
        }
        fx.track(&link, false);
        assert_eq!(readlink_wide(&link), target_units, "raw WTF-16 round trip");
        // lstat size counts the unpaired surrogate as 3 WTF-8 bytes.
        let lst = lstat(&link).unwrap();
        assert_eq!(lst.st_size as usize, utf16_length_as_wtf8(&target_units));
    }

    /// UNC absolute targets: `\??\UNC\server\share` reads back as
    /// `\\server\share`. // quirk: FSLNK-03
    #[test]
    fn symlink_unc_target_rewrite() {
        let mut fx = Fixture::new("symunc");
        let link = fx.root.join("unc_link.txt");
        let target = "\\\\bun-fslnk-srv\\share\\f.txt";
        let wt = wide_str(target);
        if !symlink_or_skip(&wt, &wide(&link), SymlinkFlags::NONE) {
            return;
        }
        fx.track(&link, false);
        assert_eq!(
            readlink_wide(&link),
            wt[..wt.len() - 1].to_vec(),
            "\\??\\UNC\\srv rewritten to \\\\srv"
        );
        let lst = lstat(&link).unwrap();
        assert_eq!(lst.st_mode & S_IFMT, S_IFLNK);
        assert_eq!(
            lst.st_size as usize,
            utf16_length_as_wtf8(&wt[..wt.len() - 1])
        );
    }

    /// Directory symlinks: the DIR flag is baked in at creation, traversal
    /// works, and unlink removes the link object, never the target tree.
    /// // quirk: FSLNK-14, FSLNK-20, FSLNK-49
    #[test]
    fn symlink_dir_flag_traverses_and_unlinks_as_link() {
        let mut fx = Fixture::new("symdir");
        let target_dir = fx.dir("real_dir");
        fx.file("real_dir\\inner.txt", b"inner!");
        let link = fx.root.join("dir_link");
        let wt = wide(&target_dir);
        if !symlink_or_skip(&wt, &wide(&link), SymlinkFlags::DIR) {
            return;
        }
        fx.track(&link, true);

        assert_eq!(lstat(&link).unwrap().st_mode & S_IFMT, S_IFLNK);
        assert_eq!(stat(&link).unwrap().st_mode & S_IFMT, S_IFDIR);
        // Traversal through the directory symlink reaches the inner file.
        assert_eq!(read_small(&link.join("inner.txt")).unwrap(), b"inner!");

        // unlink deletes the link; target dir and contents are intact.
        unlink_path(&wide(&link)).unwrap();
        assert_eq!(stat(&link).unwrap_err(), Win32Error::FILE_NOT_FOUND);
        assert_eq!(stat(&target_dir).unwrap().st_mode & S_IFMT, S_IFDIR);
        assert_eq!(
            read_small(&target_dir.join("inner.txt")).unwrap(),
            b"inner!"
        );
    }

    /// The privilege contract: symlink creation either works (Developer
    /// Mode / elevation) or fails with exactly PRIVILEGE_NOT_HELD — and the
    /// junction path needs no privilege either way. // quirk: FSLNK-12, FSLNK-13
    #[test]
    fn symlink_privilege_contract_and_junction_fallback() {
        let mut fx = Fixture::new("sympriv");
        let target = fx.file("priv_target.txt", b"p");
        let link = fx.root.join("priv_link.txt");
        match symlink_path(&wide(&target), &wide(&link), SymlinkFlags::NONE) {
            Ok(()) => {
                fx.track(&link, false);
                assert_eq!(lstat(&link).unwrap().st_mode & S_IFMT, S_IFLNK);
            }
            Err(e) => {
                // The engine retried without the unprivileged flag already,
                // so INVALID_PARAMETER never escapes; the documented failure
                // is the privilege error. // quirk: FSLNK-12, FSLNK-13
                assert_eq!(e, Win32Error::PRIVILEGE_NOT_HELD);
                assert_eq!(
                    stat(&link).unwrap_err(),
                    Win32Error::FILE_NOT_FOUND,
                    "failed symlink must not create anything"
                );
            }
        }
        // Junctions are the privilege-free fallback: always assert them.
        let jt = fx.dir("priv_jt");
        let junction = fx.root.join("priv_junction");
        symlink_path(&wide(&jt), &wide(&junction), SymlinkFlags::JUNCTION).unwrap();
        fx.track(&junction, true);
        assert_eq!(stat(&junction).unwrap().st_mode & S_IFMT, S_IFDIR);
        assert_eq!(lstat(&junction).unwrap().st_mode & S_IFMT, S_IFLNK);
    }

    // ── junctions ──

    /// Junction round trips: `readlink(symlink(t, JUNCTION)) == t` with the
    /// trailing-slash presence mirroring the input, slashes normalized, the
    /// `\\?\` prefix stripped, and stat/lstat agreement.
    /// // quirk: FSLNK-15, FSLNK-17
    #[test]
    fn junction_roundtrip_and_trailing_slash_rules() {
        let mut fx = Fixture::new("junc");
        let target = fx.dir("jt_dir");
        fx.file("jt_dir\\inner.txt", b"deep");
        let target_units = wide(&target)[..wide(&target).len() - 1].to_vec();

        // Plain absolute target: read back exactly, no trailing slash grown.
        let j1 = fx.root.join("j1");
        symlink_path(&wide(&target), &wide(&j1), SymlinkFlags::JUNCTION).unwrap();
        fx.track(&j1, true);
        assert_eq!(
            readlink_wide(&j1),
            target_units,
            "no spurious trailing slash"
        );
        let lst = lstat(&j1).unwrap();
        assert_eq!(lst.st_mode & S_IFMT, S_IFLNK);
        assert_eq!(lst.st_size as usize, utf16_length_as_wtf8(&target_units));
        assert_eq!(stat(&j1).unwrap().st_ino, stat(&target).unwrap().st_ino);
        assert_eq!(read_small(&j1.join("inner.txt")).unwrap(), b"deep");

        // Trailing slash in: trailing slash out.
        let j2 = fx.root.join("j2");
        let mut slashed = target_units.clone();
        slashed.push(BACKSLASH);
        let mut slashed_w = slashed.clone();
        slashed_w.push(0);
        symlink_path(&slashed_w, &wide(&j2), SymlinkFlags::JUNCTION).unwrap();
        fx.track(&j2, true);
        assert_eq!(readlink_wide(&j2), slashed, "user's trailing slash kept");

        // Forward slashes + runs normalize to single backslashes.
        let j3 = fx.root.join("j3");
        let fwd: String = format!("{}//inner_dir", target.to_str().unwrap().replace('\\', "/"));
        let inner_dir = fx.dir("jt_dir\\inner_dir");
        symlink_path(&wide_str(&fwd), &wide(&j3), SymlinkFlags::JUNCTION).unwrap();
        fx.track(&j3, true);
        let expect = wide(&inner_dir)[..wide(&inner_dir).len() - 1].to_vec();
        assert_eq!(readlink_wide(&j3), expect, "slashes normalized");

        // `\\?\`-prefixed target: prefix stripped before `\??\` re-prefixing.
        let j4 = fx.root.join("j4");
        let mut long = wide_str("\\\\?\\")[..4].to_vec();
        long.extend_from_slice(&target_units);
        let mut long_w = long.clone();
        long_w.push(0);
        symlink_path(&long_w, &wide(&j4), SymlinkFlags::JUNCTION).unwrap();
        fx.track(&j4, true);
        assert_eq!(readlink_wide(&j4), target_units, "\\\\?\\ prefix stripped");

        // Drive-root junction: the slash survives (it must, or it doesn't
        // resolve) and the junction traverses to the root.
        let j5 = fx.root.join("j5");
        symlink_path(&wide_str("C:\\"), &wide(&j5), SymlinkFlags::JUNCTION).unwrap();
        fx.track(&j5, true);
        assert_eq!(readlink_wide(&j5), wide_str("C:\\")[..3].to_vec());
        assert_eq!(
            stat(&j5).unwrap().st_ino,
            stat(Path::new("C:\\")).unwrap().st_ino
        );

        // Relative target: refused with the raw NOT_SUPPORTED shape and no
        // directory left behind.
        let j6 = fx.root.join("j6");
        assert_eq!(
            symlink_path(&wide_str("relative\\x"), &wide(&j6), SymlinkFlags::JUNCTION).unwrap_err(),
            Win32Error::NOT_SUPPORTED
        );
        assert_eq!(stat(&j6).unwrap_err(), Win32Error::FILE_NOT_FOUND);

        // Existing directory: raw ALREADY_EXISTS, and the existing dir (not
        // created by us) is neither reparse-tagged nor rolled back.
        // // quirk: FSLNK-15
        let existing = fx.dir("existing_dir");
        fx.file("existing_dir\\keep.txt", b"keep");
        assert_eq!(
            symlink_path(&wide(&target), &wide(&existing), SymlinkFlags::JUNCTION).unwrap_err(),
            Win32Error::ALREADY_EXISTS
        );
        assert_eq!(stat(&existing).unwrap().st_mode & S_IFMT, S_IFDIR);
        assert_eq!(read_small(&existing.join("keep.txt")).unwrap(), b"keep");
        assert_eq!(
            readlink_path(&wide(&existing)).unwrap_err(),
            Win32Error::NOT_A_REPARSE_POINT,
            "existing dir must not have been turned into a junction"
        );
    }

    // ── readlink error shapes ──

    /// // quirk: FSLNK-06, FSLNK-08, FSLNK-09, FSLNK-10
    #[test]
    fn readlink_error_shapes_and_locked_link() {
        let mut fx = Fixture::new("rlerr");

        // Plain file and directory: raw NOT_A_REPARSE_POINT (the wrapper's
        // readlink-local EINVAL). // quirk: FSLNK-10
        let plain = fx.file("plain.txt", b"x");
        assert_eq!(
            readlink_path(&wide(&plain)).unwrap_err(),
            Win32Error::NOT_A_REPARSE_POINT
        );
        let dir = fx.dir("plain_dir");
        assert_eq!(
            readlink_path(&wide(&dir)).unwrap_err(),
            Win32Error::NOT_A_REPARSE_POINT
        );
        assert_eq!(
            readlink_path(&wide(&fx.root.join("missing"))).unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );

        // Unknown Microsoft tag: not a symlink, never an error blob.
        // // quirk: FSLNK-08
        let unknown = fx.file("unknown_tag", b"");
        set_reparse_raw(&unknown, 0xA000_0FFF, &[1, 2, 3, 4]).unwrap();
        assert_eq!(
            readlink_path(&wide(&unknown)).unwrap_err(),
            Win32Error::SYMLINK_NOT_SUPPORTED
        );

        // A link held open with share mode 0 still readlinks: the engine's
        // zero-access open bypasses sharing checks. // quirk: FSLNK-09
        let jt = fx.dir("locked_target");
        let junction = fx.root.join("locked_junction");
        symlink_path(&wide(&jt), &wide(&junction), SymlinkFlags::JUNCTION).unwrap();
        fx.track(&junction, true);
        let wj = wide(&junction);
        // SAFETY: NUL-terminated path; deny-all share on the link itself.
        let lock = unsafe {
            CreateFileW(
                wj.as_ptr(),
                GENERIC_READ,
                0,
                ptr::null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                ptr::null_mut(),
            )
        };
        assert!(lock != INVALID_HANDLE_VALUE);
        let _lock_guard = HandleGuard(lock);
        let jt_units = wide(&jt)[..wide(&jt).len() - 1].to_vec();
        assert_eq!(
            readlink_wide(&junction),
            jt_units,
            "readlink through a share-0 lock"
        );
    }

    /// Volume-GUID mount points are deliberately not symlinks: readlink is
    /// SYMLINK_NOT_SUPPORTED and unlink refuses with ACCESS_DENIED.
    /// // quirk: FSLNK-06, FSLNK-20
    #[test]
    fn volume_guid_junction_readlink_and_unlink_refused() {
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
        set_reparse_raw(
            &junction,
            IO_REPARSE_TAG_MOUNT_POINT,
            &mount_point_payload(&substitute, &[]),
        )
        .unwrap();

        assert_eq!(
            readlink_path(&wide(&junction)).unwrap_err(),
            Win32Error::SYMLINK_NOT_SUPPORTED
        );
        // unlink: the classifier verdict remaps to ACCESS_DENIED (EPERM).
        assert_eq!(
            unlink_path(&wide(&junction)).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );
        // Still present (and still a directory).
        assert_eq!(lstat(&junction).unwrap().st_mode & S_IFMT, S_IFDIR);
    }

    /// App-exec-link and WSL LX payload parsing through the public readlink.
    /// // quirk: FSLNK-05, FSLNK-07
    #[test]
    fn readlink_appexeclink_and_lx_payloads() {
        let mut fx = Fixture::new("payload");
        let target = "C:\\Windows\\System32\\cmd.exe";

        let build_appexec = |strings: &[&str]| {
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

        // Valid alias: 3rd string, X:\-absolute.
        let alias = fx.file("alias", b"");
        set_reparse_raw(
            &alias,
            IO_REPARSE_TAG_APPEXECLINK,
            &build_appexec(&["pkg.id", "Pkg!App", target, "0"]),
        )
        .unwrap();
        let expect: Vec<u16> = target.encode_utf16().collect();
        assert_eq!(readlink_wide(&alias), expect);

        // Relative 3rd string / too few strings: not symlink-class.
        let bad_rel = fx.file("alias_rel", b"");
        set_reparse_raw(
            &bad_rel,
            IO_REPARSE_TAG_APPEXECLINK,
            &build_appexec(&["pkg.id", "Pkg!App", "relative.exe", "0"]),
        )
        .unwrap();
        assert_eq!(
            readlink_path(&wide(&bad_rel)).unwrap_err(),
            Win32Error::SYMLINK_NOT_SUPPORTED
        );
        let bad_count = fx.file("alias_two", b"");
        set_reparse_raw(
            &bad_count,
            IO_REPARSE_TAG_APPEXECLINK,
            &build_appexec(&["pkg.id", "Pkg!App"]),
        )
        .unwrap();
        assert_eq!(
            readlink_path(&wide(&bad_count)).unwrap_err(),
            Win32Error::SYMLINK_NOT_SUPPORTED
        );

        // WSL LX symlink: raw bytes after the version field, returned
        // verbatim — including bytes that are NOT valid UTF-8.
        let lx = fx.file("lx_link", b"");
        let mut lx_target = b"t\xC3\xA4rget/".to_vec();
        lx_target.push(0xFF); // invalid UTF-8: must survive untouched
        let mut payload = 2u32.to_le_bytes().to_vec();
        payload.extend_from_slice(&lx_target);
        set_reparse_raw(&lx, IO_REPARSE_TAG_LX_SYMLINK, &payload).unwrap();
        assert_eq!(
            readlink_path(&wide(&lx)).unwrap(),
            ReadlinkTarget::Bytes(lx_target)
        );

        // Version-only payload: empty target, not an error.
        let lx_empty = fx.file("lx_empty", b"");
        set_reparse_raw(&lx_empty, IO_REPARSE_TAG_LX_SYMLINK, &2u32.to_le_bytes()).unwrap();
        assert_eq!(
            readlink_path(&wide(&lx_empty)).unwrap(),
            ReadlinkTarget::Bytes(Vec::new())
        );

        // ReparseDataLength smaller than the version field: the subtraction
        // must not wrap — fail closed. // quirk: FSLNK-05
        let lx_short = fx.file("lx_short", b"");
        set_reparse_raw(&lx_short, IO_REPARSE_TAG_LX_SYMLINK, &[0u8, 0]).unwrap();
        assert_eq!(
            readlink_path(&wide(&lx_short)).unwrap_err(),
            Win32Error::INVALID_REPARSE_DATA
        );
    }

    // ── unlink / rmdir ──

    /// // quirk: FSLNK-19, FSLNK-22
    #[test]
    fn unlink_file_readonly_and_open_holder() {
        let mut fx = Fixture::new("unlink");

        // Plain file.
        let plain = fx.file("plain.bin", b"p");
        unlink_path(&wide(&plain)).unwrap();
        assert_eq!(stat(&plain).unwrap_err(), Win32Error::FILE_NOT_FOUND);

        // READONLY file: IGNORE_READONLY_ATTRIBUTE deletes it in one shot.
        let ro = fx.file("ro.bin", b"r");
        let w = wide(&ro);
        // SAFETY: NUL-terminated path.
        assert!(unsafe { SetFileAttributesW(w.as_ptr(), FILE_ATTRIBUTE_READONLY) } != 0);
        unlink_path(&w).unwrap();
        assert_eq!(stat(&ro).unwrap_err(), Win32Error::FILE_NOT_FOUND);

        // Missing file.
        assert_eq!(
            unlink_path(&wide(&fx.root.join("missing.bin"))).unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );

        // POSIX semantics: the NAME disappears even while a share-delete
        // handle holds the file; the holder keeps reading.
        let held = fx.file("held.bin", b"HELDDATA");
        let h = crate::fsio::open_path(&wide(&held), OpenFlags::RDONLY, false).unwrap();
        let guard = HandleGuard(h);
        unlink_path(&wide(&held)).unwrap();
        // POSIX delete (NTFS) removes the name immediately → FILE_NOT_FOUND;
        // legacy delete-pending kernels and non-NTFS report ACCESS_DENIED.
        let e = stat(&held).unwrap_err();
        assert!(
            e == Win32Error::FILE_NOT_FOUND || e == Win32Error::ACCESS_DENIED,
            "stat after unlink-while-open: {e:?}"
        );
        let e = unlink_path(&wide(&held)).unwrap_err();
        assert!(
            e == Win32Error::FILE_NOT_FOUND || e == Win32Error::ACCESS_DENIED,
            "second unlink: {e:?}"
        );
        let mut buf = [0u8; 8];
        // SAFETY: live test handle owned by the guard.
        let n = unsafe { crate::fsio::read_at(h, &mut [&mut buf], Some(0)) };
        assert_eq!(n, Ok(8));
        assert_eq!(&buf, b"HELDDATA");
        drop(guard);
        assert_eq!(stat(&held).unwrap_err(), Win32Error::FILE_NOT_FOUND);
    }

    /// unlink refuses plain directories (POSIX EPERM shape) but deletes
    /// symlink-class directory reparse points — the link object, never the
    /// target. // quirk: FSLNK-05, FSLNK-08, FSLNK-20, FSLNK-49, FSLNK-50
    #[test]
    fn unlink_directory_shapes() {
        let mut fx = Fixture::new("unlinkdir");

        // Plain directory: ACCESS_DENIED, still present.
        let dir = fx.dir("plain_dir");
        assert_eq!(
            unlink_path(&wide(&dir)).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );
        assert_eq!(stat(&dir).unwrap().st_mode & S_IFMT, S_IFDIR);

        // Junction: unlink removes the junction, target contents intact.
        let jt = fx.dir("junction_target");
        fx.file("junction_target\\keep.txt", b"keep!");
        let junction = fx.root.join("junction_link");
        symlink_path(&wide(&jt), &wide(&junction), SymlinkFlags::JUNCTION).unwrap();
        unlink_path(&wide(&junction)).unwrap();
        assert_eq!(stat(&junction).unwrap_err(), Win32Error::FILE_NOT_FOUND);
        assert_eq!(read_small(&jt.join("keep.txt")).unwrap(), b"keep!");

        // Unknown-tag reparse directory: refused (EPERM shape), intact.
        // // quirk: FSLNK-08
        let unknown = fx.dir("unknown_tag_dir");
        set_reparse_raw(&unknown, 0xA000_0FFF, &[9, 9, 9, 9]).unwrap();
        assert_eq!(
            unlink_path(&wide(&unknown)).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );

        // WSL LX_SYMLINK directory stub: symlink-class, unlink succeeds —
        // the 2026 tag addition silently fixed this path too.
        // // quirk: FSLNK-05
        let lx_dir = fx.dir("lx_dir");
        let mut payload = 2u32.to_le_bytes().to_vec();
        payload.extend_from_slice(b"/mnt/c/x");
        set_reparse_raw(&lx_dir, IO_REPARSE_TAG_LX_SYMLINK, &payload).unwrap();
        unlink_path(&wide(&lx_dir)).unwrap();
        assert_eq!(stat(&lx_dir).unwrap_err(), Win32Error::FILE_NOT_FOUND);
    }

    /// // quirk: FSLNK-21, FSLNK-49
    #[test]
    fn rmdir_shapes_and_junctions() {
        let mut fx = Fixture::new("rmdir");

        // Empty directory.
        let empty = fx.dir("empty");
        rmdir_path(&wide(&empty)).unwrap();
        assert_eq!(stat(&empty).unwrap_err(), Win32Error::FILE_NOT_FOUND);

        // Non-empty: exact raw DIR_NOT_EMPTY, contents untouched.
        let full = fx.dir("full");
        fx.file("full\\inner.txt", b"i");
        assert_eq!(
            rmdir_path(&wide(&full)).unwrap_err(),
            Win32Error::DIR_NOT_EMPTY
        );
        assert_eq!(read_small(&full.join("inner.txt")).unwrap(), b"i");

        // Non-directory: raw ERROR_DIRECTORY — ENOENT downstream, the frozen
        // libuv back-compat shape (NOT ENOTDIR). // quirk: FSLNK-21
        let file = fx.file("file.txt", b"f");
        assert_eq!(rmdir_path(&wide(&file)).unwrap_err(), Win32Error::DIRECTORY);

        // Missing.
        assert_eq!(
            rmdir_path(&wide(&fx.root.join("missing_dir"))).unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );

        // rmdir(junction) removes the junction, never the target.
        // // quirk: FSLNK-49
        let jt = fx.dir("rm_target");
        fx.file("rm_target\\keep.txt", b"safe");
        let junction = fx.root.join("rm_junction");
        symlink_path(&wide(&jt), &wide(&junction), SymlinkFlags::JUNCTION).unwrap();
        rmdir_path(&wide(&junction)).unwrap();
        assert_eq!(stat(&junction).unwrap_err(), Win32Error::FILE_NOT_FOUND);
        assert_eq!(read_small(&jt.join("keep.txt")).unwrap(), b"safe");
    }

    // ── rename ──

    /// The POSIX-rename matrix, every cell's exact raw shape kernel-probed.
    /// // quirk: FSLNK-23
    #[test]
    fn rename_matrix() {
        let mut fx = Fixture::new("rename");

        // Plain move.
        let a = fx.file("a.txt", b"AAA");
        let b = fx.root.join("b.txt");
        fx.track(&b, false);
        rename_path(&wide(&a), &wide(&b)).unwrap();
        assert_eq!(stat(&a).unwrap_err(), Win32Error::FILE_NOT_FOUND);
        assert_eq!(read_small(&b).unwrap(), b"AAA");

        // Replace an existing file.
        let src = fx.file("src.txt", b"SRC");
        let dst = fx.file("dst.txt", b"OLD");
        rename_path(&wide(&src), &wide(&dst)).unwrap();
        assert_eq!(read_small(&dst).unwrap(), b"SRC");
        assert_eq!(stat(&src).unwrap_err(), Win32Error::FILE_NOT_FOUND);

        // Case-only rename on the same directory must apply the new case.
        let lower = fx.file("case_name.txt", b"c");
        let upper = fx.root.join("CASE_NAME.TXT");
        rename_path(&wide(&lower), &wide(&upper)).unwrap();
        let on_disk: Vec<String> = std::fs::read_dir(&fx.root)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .filter(|n| n.eq_ignore_ascii_case("case_name.txt"))
            .collect();
        assert_eq!(
            on_disk,
            vec!["CASE_NAME.TXT".to_string()],
            "case must change on disk"
        );

        // READONLY destination: replaced (IGNORE_READONLY_ATTRIBUTE).
        let src = fx.file("ro_src.txt", b"NEW");
        let ro_dst = fx.file("ro_dst.txt", b"OLD");
        let w = wide(&ro_dst);
        // SAFETY: NUL-terminated path.
        assert!(unsafe { SetFileAttributesW(w.as_ptr(), FILE_ATTRIBUTE_READONLY) } != 0);
        rename_path(&wide(&src), &w).unwrap();
        assert_eq!(read_small(&ro_dst).unwrap(), b"NEW");

        // OPEN (share-delete) destination: POSIX semantics replaces it while
        // the old file is still held.
        let src = fx.file("open_src.txt", b"FRESH");
        let open_dst = fx.file("open_dst.txt", b"STALE");
        let hold = crate::fsio::open_path(&wide(&open_dst), OpenFlags::RDONLY, false).unwrap();
        let hold_guard = HandleGuard(hold);
        rename_path(&wide(&src), &wide(&open_dst)).unwrap();
        assert_eq!(read_small(&open_dst).unwrap(), b"FRESH");
        // The holder still reads the OLD bytes — its file became nameless.
        let mut buf = [0u8; 5];
        // SAFETY: live test handle owned by the guard.
        let n = unsafe { crate::fsio::read_at(hold, &mut [&mut buf], Some(0)) };
        assert_eq!(n, Ok(5));
        assert_eq!(&buf, b"STALE");
        drop(hold_guard);

        // OPEN (share-delete) source renames fine.
        let held_src = fx.file("held_src.txt", b"HELD");
        let held_dst = fx.root.join("held_dst.txt");
        fx.track(&held_dst, false);
        let hold = crate::fsio::open_path(&wide(&held_src), OpenFlags::RDONLY, false).unwrap();
        let hold_guard = HandleGuard(hold);
        rename_path(&wide(&held_src), &wide(&held_dst)).unwrap();
        drop(hold_guard);
        assert_eq!(read_small(&held_dst).unwrap(), b"HELD");

        // file → existing EMPTY dir: raw ACCESS_DENIED (EPERM downstream).
        let f = fx.file("f_to_dir.txt", b"x");
        let d = fx.dir("dir_dest");
        assert_eq!(
            rename_path(&wide(&f), &wide(&d)).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );
        // dir → existing file: POSIX semantics would refuse (ENOTDIR), but
        // Windows-native rename — and therefore libuv/Node — REPLACES the
        // file with the directory; the engine's classic-class fallback
        // restores that parity. Identity is checked through the stat engine:
        // the destination IS the source directory (same FileId), contents
        // reachable, the old file gone.
        let d2 = fx.dir("dir_src");
        fx.file("dir_src\\inside.txt", b"DIRDATA");
        let f2 = fx.file("file_dest.txt", b"x");
        let d2_id = stat(&d2).unwrap();
        rename_path(&wide(&d2), &wide(&f2)).unwrap();
        fx.track(&f2, true);
        fx.track(&f2.join("inside.txt"), false);
        let replaced = stat(&f2).unwrap();
        assert_eq!(replaced.st_mode & S_IFMT, S_IFDIR, "file replaced by dir");
        assert_eq!(replaced.st_ino, d2_id.st_ino, "dest IS the source dir");
        assert_eq!(replaced.st_dev, d2_id.st_dev);
        assert_eq!(stat(&d2).unwrap_err(), Win32Error::FILE_NOT_FOUND);
        assert_eq!(read_small(&f2.join("inside.txt")).unwrap(), b"DIRDATA");

        // The fallback must not widen: dir → READONLY file keeps the libuv
        // shape (classic rename cannot ignore the attribute → ACCESS_DENIED,
        // exactly what MoveFileExW reports), and the destination survives.
        let d3 = fx.dir("dir_src_ro");
        let ro_file = fx.file("ro_block.txt", b"keep");
        let w_ro = wide(&ro_file);
        // SAFETY: NUL-terminated path.
        assert!(unsafe { SetFileAttributesW(w_ro.as_ptr(), FILE_ATTRIBUTE_READONLY) } != 0);
        assert_eq!(
            rename_path(&wide(&d3), &w_ro).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );
        // SAFETY: NUL-terminated path (clear for fixture cleanup + read).
        unsafe { SetFileAttributesW(w_ro.as_ptr(), bun_windows_sys::FILE_ATTRIBUTE_NORMAL) };
        assert_eq!(read_small(&ro_file).unwrap(), b"keep");
        assert_eq!(
            stat(&d3).unwrap().st_mode & S_IFMT,
            S_IFDIR,
            "source dir intact"
        );

        // dir → existing EMPTY dir succeeds (POSIX parity MoveFileExW cannot
        // give); dir → NON-empty dir is raw DIR_NOT_EMPTY (ENOTEMPTY).
        let dsrc = fx.dir("dmove_src");
        fx.file("dmove_src\\payload.txt", b"P");
        let dempty = fx.dir("dmove_empty");
        rename_path(&wide(&dsrc), &wide(&dempty)).unwrap();
        assert_eq!(stat(&dsrc).unwrap_err(), Win32Error::FILE_NOT_FOUND);
        assert_eq!(read_small(&dempty.join("payload.txt")).unwrap(), b"P");
        let dsrc2 = fx.dir("dmove_src2");
        assert_eq!(
            rename_path(&wide(&dsrc2), &wide(&dempty)).unwrap_err(),
            Win32Error::DIR_NOT_EMPTY
        );

        // Missing source / missing destination parent.
        assert_eq!(
            rename_path(
                &wide(&fx.root.join("nope.txt")),
                &wide(&fx.root.join("x.txt"))
            )
            .unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );
        // A destination routed THROUGH an existing file is PATH_NOT_FOUND
        // (never 267, kernel-probed for file and dir sources alike), so the
        // dir-replaces-file fallback cannot trigger for this shape.
        let through = fx.file("through_src.txt", b"x");
        let blocker = fx.file("blocker.txt", b"b");
        assert_eq!(
            rename_path(&wide(&through), &wide(&blocker.join("x.txt"))).unwrap_err(),
            Win32Error::PATH_NOT_FOUND
        );
        let f3 = fx.file("orphan.txt", b"x");
        assert_eq!(
            rename_path(&wide(&f3), &wide(&fx.root.join("no_dir\\x.txt"))).unwrap_err(),
            Win32Error::PATH_NOT_FOUND
        );
    }

    /// Renaming a symlink moves the LINK (the source opens with
    /// OPEN_REPARSE_POINT), never the target. // quirk: FSLNK-49
    #[test]
    fn rename_symlink_moves_link_not_target() {
        let mut fx = Fixture::new("renlnk");
        let target = fx.file("ren_target.txt", b"T");
        let link = fx.root.join("ren_link.txt");
        if !symlink_or_skip(&wide(&target), &wide(&link), SymlinkFlags::NONE) {
            return;
        }
        fx.track(&link, false);
        let moved = fx.root.join("ren_link_moved.txt");
        fx.track(&moved, false);
        rename_path(&wide(&link), &wide(&moved)).unwrap();
        assert_eq!(lstat(&link).unwrap_err(), Win32Error::FILE_NOT_FOUND);
        // The moved entry is still a symlink to the same target.
        let target_units = wide(&target)[..wide(&target).len() - 1].to_vec();
        assert_eq!(readlink_wide(&moved), target_units);
        assert_eq!(lstat(&moved).unwrap().st_mode & S_IFMT, S_IFLNK);
        // Target untouched.
        assert_eq!(read_small(&target).unwrap(), b"T");
    }

    // ── hard links ──

    /// CreateHardLinkW argument order is (new, existing) — the LINK appears
    /// at the new path, both names alias one inode, and st_nlink is visible
    /// through the full stat engine (the directory-fallback nlink=1 lie is
    /// per THAT path only). // quirk: FSLNK-18
    #[test]
    fn hard_link_two_names_one_inode() {
        let mut fx = Fixture::new("hlink");
        let existing = fx.file("orig.bin", b"LINKDATA");
        let new = fx.root.join("alias.bin");
        fx.track(&new, false);
        link_path(&wide(&existing), &wide(&new)).unwrap();

        // The historical libuv regression test: the NEW name carries the
        // data and the EXISTING file is untouched.
        assert_eq!(read_small(&new).unwrap(), b"LINKDATA");
        assert_eq!(read_small(&existing).unwrap(), b"LINKDATA");
        let st_existing = stat(&existing).unwrap();
        let st_new = stat(&new).unwrap();
        assert_eq!(st_existing.st_ino, st_new.st_ino, "one inode");
        assert_eq!(st_existing.st_dev, st_new.st_dev);
        assert_eq!(st_existing.st_nlink, 2);
        assert_eq!(st_new.st_nlink, 2);

        // Existing destination: raw ALREADY_EXISTS.
        assert_eq!(
            link_path(&wide(&existing), &wide(&new)).unwrap_err(),
            Win32Error::ALREADY_EXISTS
        );
        // Missing source.
        assert_eq!(
            link_path(
                &wide(&fx.root.join("gone.bin")),
                &wide(&fx.root.join("l.bin"))
            )
            .unwrap_err(),
            Win32Error::FILE_NOT_FOUND
        );
        // Directories cannot be hard-linked.
        let dir = fx.dir("hl_dir");
        assert_eq!(
            link_path(&wide(&dir), &wide(&fx.root.join("hl_dir2"))).unwrap_err(),
            Win32Error::ACCESS_DENIED
        );

        // Unlinking one name leaves the other intact with nlink back to 1.
        unlink_path(&wide(&existing)).unwrap();
        assert_eq!(read_small(&new).unwrap(), b"LINKDATA");
        assert_eq!(stat(&new).unwrap().st_nlink, 1);
    }

    // ── mkdir ──

    /// // quirk: FSLNK-26
    #[test]
    fn mkdir_shapes() {
        let mut fx = Fixture::new("mkdir");

        let plain = fx.root.join("made");
        fx.track(&plain, true);
        mkdir_path(&wide(&plain)).unwrap();
        assert_eq!(stat(&plain).unwrap().st_mode & S_IFMT, S_IFDIR);

        // Trailing separators (either kind) are fine, consistent with the
        // stat engine's trailing-slash tolerance.
        for (name, sep) in [("made_bs", "\\"), ("made_fs", "/")] {
            let path = fx.root.join(name);
            fx.track(&path, true);
            let mut s = path.as_os_str().to_os_string();
            s.push(sep);
            mkdir_path(&wide_str(s.to_str().unwrap())).unwrap();
            assert_eq!(stat(&path).unwrap().st_mode & S_IFMT, S_IFDIR, "{name}");
        }

        // Existing directory and existing FILE both report ALREADY_EXISTS.
        assert_eq!(
            mkdir_path(&wide(&plain)).unwrap_err(),
            Win32Error::ALREADY_EXISTS
        );
        let file = fx.file("taken.txt", b"x");
        assert_eq!(
            mkdir_path(&wide(&file)).unwrap_err(),
            Win32Error::ALREADY_EXISTS
        );

        // Missing parent: raw PATH_NOT_FOUND — the engine never recurses.
        assert_eq!(
            mkdir_path(&wide(&fx.root.join("no\\such\\parent"))).unwrap_err(),
            Win32Error::PATH_NOT_FOUND
        );

        // Invalid characters: raw INVALID_NAME (the wrapper's mkdir-local
        // EINVAL, distinguishing "can never exist" from "missing parent").
        // // quirk: FSLNK-26
        assert_eq!(
            mkdir_path(&wide(&fx.root.join("bad<name"))).unwrap_err(),
            Win32Error::INVALID_NAME
        );
    }
}
