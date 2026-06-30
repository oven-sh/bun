#![cfg(windows)]

//! The Windows directory-enumeration engine: one open-iterate-close
//! [`DirIter`] over NUL-terminated wide (WTF-16) paths, replacing BOTH libuv
//! shapes (`fs__scandir` batch + `fs__opendir`/`fs__readdir`/`fs__closedir`
//! streaming) — Bun's consumers batch at the wrapper layer. Ported per the
//! `fs-links-dir.md` ledger area: `NtQueryDirectoryFile` over a real
//! directory handle into an 8 KB 8-aligned buffer. // quirk: FSLNK-32
//!
//! The FindFirstFileW machinery is deliberately not ported: the wildcard
//! pattern construction (FSLNK-39 skip disposition) and the `need_find_call`
//! prefetch latch (FSLNK-42 skip disposition) only exist because
//! FindFirstFileW both opens and returns entry #1. A real handle also kills
//! the FSLNK-41 lesson at the root: "open but empty" is an ordinary iterator
//! state, never an `INVALID_HANDLE_VALUE` sentinel that later layers must
//! re-validate. // quirk: FSLNK-40, FSLNK-41
//!
//! Deviation from stock libuv (which enumerates `FileDirectoryInformation`):
//! the primary info class is `FileIdFullDirectoryInformation` — already the
//! stat engine's directory-fallback class — whose records carry the 64-bit
//! FileId and, for reparse points, the reparse tag in `EaSize` (MS-FSCC
//! 2.4.18), so dirents can tell symlinks from junctions from cloud
//! placeholders without per-entry opens (the FSLNK-32 disposition's
//! "inode numbers in the same pass" option, and a fix for the FSLNK-36
//! caveat that attribute-only `DT_LINK` over-reports). Filesystems that
//! reject the Id class (npfs `\\.\pipe\`) fall back to libuv's exact class,
//! where entries report `reparse_tag = 0` / `file_id = 0`.
//!
//! Error policy: raw `Win32Error` out, translated nowhere in-engine, with one
//! libuv-parity in-engine remap: a first-query `STATUS_INVALID_PARAMETER`
//! means "not a directory" and surfaces as raw `ERROR_DIRECTORY` (267) —
//! libuv's exact sys-errno for this case. The standard table maps 267 to
//! ENOENT (FSLNK-21's frozen shape), so the `bun_sys` readdir/opendir wrapper
//! must remap raw `DIRECTORY` to ENOTDIR locally, mirroring libuv's
//! `SET_REQ_UV_ERROR(UV_ENOTDIR, ERROR_DIRECTORY)`. // quirk: FSLNK-35
//!
//! Entry order is unsorted filesystem order ($I30 collation on NTFS, slot
//! order on FAT); `.`/`..` never surface. // quirk: FSLNK-37

use core::mem::{align_of, offset_of, size_of};
use core::ptr;

use bun_windows_sys::ntdll::NtQueryDirectoryFile;
use bun_windows_sys::{
    CreateFileW, DWORD, FILE_ATTRIBUTE_DEVICE, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFORMATION, FILE_DIRECTORY_INFORMATION,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_ID_FULL_DIR_INFORMATION, FILE_INFORMATION_CLASS,
    FILE_LIST_DIRECTORY, FileBasicInfo, GetFileInformationByHandleEx, HANDLE, INVALID_HANDLE_VALUE,
    IO_REPARSE_TAG_APPEXECLINK, IO_REPARSE_TAG_LX_SYMLINK, IO_REPARSE_TAG_MOUNT_POINT,
    IO_REPARSE_TAG_SYMLINK, IO_STATUS_BLOCK, NT_SUCCESS, NTSTATUS, OPEN_EXISTING, SYNCHRONIZE,
    ULONG, Win32Error,
};

use crate::stat::{DOT, HandleGuard, SHARE_ALL};

/// libuv's buffer size (fs.c:1441): big enough for dozens of records yet
/// guaranteed to hold at least ONE maximum-length entry — a buffer that
/// cannot fit one record cannot make progress. MSDN requires 8-byte
/// alignment (LONGLONG members; misalignment faults on some FS drivers).
/// // quirk: FSLNK-32
const DIR_BUF_SIZE: usize = 8192;

/// Filenames are at most 255 WCHARs; libuv asserts headroom for 256.
const MAX_COMPONENT_UNITS: usize = 256;

#[repr(C, align(8))]
struct DirBuf([u8; DIR_BUF_SIZE]);

// Record-header offsets shared by both enumeration classes; the name offset
// differs per class. Even name offsets + 8-aligned records keep every
// `&[u16]` name view aligned. // quirk: FSLNK-32
const OFF_NEXT: usize = offset_of!(FILE_ID_FULL_DIR_INFORMATION, NextEntryOffset);
const OFF_ATTRS: usize = offset_of!(FILE_ID_FULL_DIR_INFORMATION, FileAttributes);
const OFF_NAME_LEN: usize = offset_of!(FILE_ID_FULL_DIR_INFORMATION, FileNameLength);
const OFF_EA: usize = offset_of!(FILE_ID_FULL_DIR_INFORMATION, EaSize);
const OFF_FILE_ID: usize = offset_of!(FILE_ID_FULL_DIR_INFORMATION, FileId);
const NAME_OFF_ID: usize = offset_of!(FILE_ID_FULL_DIR_INFORMATION, FileName);
const NAME_OFF_DIR: usize = offset_of!(FILE_DIRECTORY_INFORMATION, FileName);

const _: () = {
    // The libuv STATIC_ASSERT, for both classes this engine can run on.
    assert!(DIR_BUF_SIZE >= size_of::<FILE_ID_FULL_DIR_INFORMATION>() + MAX_COMPONENT_UNITS * 2);
    assert!(DIR_BUF_SIZE >= size_of::<FILE_DIRECTORY_INFORMATION>() + MAX_COMPONENT_UNITS * 2);
    assert!(align_of::<DirBuf>() >= 8);
    // The fallback class shares every fixed-header offset read here.
    assert!(OFF_NEXT == offset_of!(FILE_DIRECTORY_INFORMATION, NextEntryOffset));
    assert!(OFF_ATTRS == offset_of!(FILE_DIRECTORY_INFORMATION, FileAttributes));
    assert!(OFF_NAME_LEN == offset_of!(FILE_DIRECTORY_INFORMATION, FileNameLength));
    assert!(NAME_OFF_ID.is_multiple_of(2) && NAME_OFF_DIR.is_multiple_of(2));
};

/// Entry kind derived from `FileAttributes` + the per-record reparse tag, in
/// libuv's load-bearing order (DEVICE, then REPARSE_POINT, then DIRECTORY —
/// directory links have BOTH the directory and reparse bits, and checking
/// DIRECTORY first misreports them, libuv's 5-year sync/async-twin
/// divergence). // quirk: FSLNK-36
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum DirentKind {
    File,
    Dir,
    /// `FILE_ATTRIBUTE_DEVICE` — libuv `UV__DT_CHAR`.
    Char,
    /// Symlink-class tags per the shared fslnk taxonomy: `SYMLINK`,
    /// `LX_SYMLINK` (WSL) and `APPEXECLINK` (Store alias) — the tags lstat
    /// reports as `S_IFLNK`. // quirk: FSLNK-50
    Symlink,
    /// `IO_REPARSE_TAG_MOUNT_POINT`. Advisory: dirents cannot see the target,
    /// so `\??\Volume{guid}` mount points (which readlink/lstat reject as
    /// links per FSLNK-06) also report `Junction` here.
    Junction,
    /// Reparse point with any other tag (cloud placeholders, dedup, HSM) or
    /// with the tag unavailable (class-1 fallback). libuv maps every reparse
    /// point to `UV__DT_LINK`; a wrapper wanting byte-for-byte libuv parity
    /// maps {Symlink, Junction, ReparseOther} to DT_LINK. // quirk: FSLNK-08, FSLNK-36
    ReparseOther,
}

/// One directory entry, borrowed from the iterator's buffer — valid until the
/// next [`DirIter::next`] call (enforced by the borrow).
///
/// `name` is the RAW stored WTF-16 component: no NUL terminator, no encoding
/// conversion, unpaired surrogates preserved — the `bun_sys` wrapper performs
/// the single WTF-8 conversion, same contract as fslnk readlink `Wide`
/// targets. `.`/`..` never appear. // quirk: FSLNK-37
#[derive(Copy, Clone, Debug)]
pub struct DirEntry<'a> {
    pub name: &'a [u16],
    /// Raw `FileAttributes` (hidden/system/readonly bits included).
    pub attributes: ULONG,
    /// The reparse tag when `attributes` carries `FILE_ATTRIBUTE_REPARSE_POINT`
    /// and the Id info class is active (MS-FSCC: `EaSize` doubles as the tag);
    /// 0 otherwise.
    pub reparse_tag: ULONG,
    /// 64-bit FileId (the `st_ino` the stat engine reports, FSMETA-22's
    /// truncation rule); 0 in the class-1 fallback.
    pub file_id: i64,
}

impl DirEntry<'_> {
    /// Classify in libuv's order; reparse points refine by tag.
    /// // quirk: FSLNK-36
    pub fn kind(&self) -> DirentKind {
        if self.attributes & FILE_ATTRIBUTE_DEVICE != 0 {
            return DirentKind::Char;
        }
        if self.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return match self.reparse_tag {
                IO_REPARSE_TAG_SYMLINK | IO_REPARSE_TAG_LX_SYMLINK | IO_REPARSE_TAG_APPEXECLINK => {
                    DirentKind::Symlink
                }
                IO_REPARSE_TAG_MOUNT_POINT => DirentKind::Junction,
                _ => DirentKind::ReparseOther,
            };
        }
        if self.attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
            return DirentKind::Dir;
        }
        DirentKind::File
    }
}

/// Parsed scalar view of one record; `name_*` index into the iterator buffer
/// so the borrowed name slice can be formed after all `&mut self` work.
struct RecordMeta {
    name_off: usize,
    name_units: usize,
    attributes: ULONG,
    reparse_tag: ULONG,
    file_id: i64,
}

/// Streaming directory iterator: `open` issues the directory open AND the
/// first enumeration query (so not-a-directory fails eagerly, the libuv
/// opendir outcome without the `GetFileAttributesW` all-bits pun);
/// [`Self::next`] drains the buffer and refills; the handle closes on drop.
/// // quirk: FSLNK-32, FSLNK-38
pub struct DirIter {
    guard: HandleGuard,
    buf: Box<DirBuf>,
    /// Byte offset of the next unconsumed record; `pos >= end` means empty.
    pos: usize,
    /// Kernel-filled bytes (`iosb.Information`, clamped to capacity).
    end: usize,
    /// `STATUS_NO_MORE_FILES` seen — the iterator is exhausted (and fused).
    done: bool,
    /// Sticky per-iterator info class; downgrades once at the first query.
    class: FILE_INFORMATION_CLASS,
}

// SAFETY: the directory HANDLE is a process-wide kernel object with no thread
// affinity, and all iterator state is reached only through `&mut self`; the
// wrapper's `fs.opendir` streams entries from changing threadpool threads.
unsafe impl Send for DirIter {}

impl DirIter {
    /// Opens `path_w` (NUL-terminated wide path, passed to `CreateFileW`
    /// verbatim) and fetches the first batch. Exact open triple:
    /// `FILE_LIST_DIRECTORY | SYNCHRONIZE` (SYNCHRONIZE feeds the implicit
    /// kernel wait on a synchronous handle), share-everything,
    /// `FILE_FLAG_BACKUP_SEMANTICS`; no `OPEN_REPARSE_POINT`, so enumerating
    /// a junction/dir-symlink lists the TARGET. // quirk: FSLNK-32
    ///
    /// Error precedence (FSLNK-38's outcome, derived honestly): a missing
    /// path fails the open with raw `FILE_NOT_FOUND`/`PATH_NOT_FOUND`; a
    /// non-directory opens fine (`FILE_LIST_DIRECTORY` is meaningless on
    /// files) and the first query's `STATUS_INVALID_PARAMETER` surfaces as
    /// raw `DIRECTORY` (267) — the wrapper's readdir-local ENOTDIR.
    /// // quirk: FSLNK-35
    pub fn open(path_w: &[u16]) -> Result<DirIter, Win32Error> {
        let Some((&0, units)) = path_w.split_last() else {
            debug_assert!(false, "wide path must include its NUL terminator");
            return Err(Win32Error::INVALID_PARAMETER);
        };
        debug_assert!(!units.contains(&0), "interior NUL in wide path");
        // SAFETY: `path_w` is NUL-terminated (validated above).
        let handle = unsafe {
            CreateFileW(
                path_w.as_ptr(),
                FILE_LIST_DIRECTORY | SYNCHRONIZE,
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
        let mut iter = DirIter {
            guard: HandleGuard(handle), // quirk: FSMETA-35
            buf: Box::new(DirBuf([0; DIR_BUF_SIZE])),
            pos: 0,
            end: 0,
            done: false,
            class: FILE_INFORMATION_CLASS::FileIdFullDirectoryInformation,
        };
        iter.first_query()?;
        Ok(iter)
    }

    /// Adopt an already-open directory handle (an opendir-style fd whose
    /// open carried `FILE_LIST_DIRECTORY`). Ownership transfers on `Ok` AND
    /// on `Err` — the handle is closed either way; callers retaining the
    /// descriptor must duplicate first.
    ///
    /// # Safety
    /// `handle` must be a valid handle owned by the caller until this call
    /// returns (null/INVALID error cleanly).
    pub unsafe fn from_handle(handle: HANDLE) -> Result<DirIter, Win32Error> {
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        let mut iter = DirIter {
            guard: HandleGuard(handle), // quirk: FSMETA-35
            buf: Box::new(DirBuf([0; DIR_BUF_SIZE])),
            pos: 0,
            end: 0,
            done: false,
            class: FILE_INFORMATION_CLASS::FileIdFullDirectoryInformation,
        };
        iter.first_query()?;
        Ok(iter)
    }

    /// Returns the next entry, refilling from the kernel as batches drain;
    /// `Ok(None)` at the end, persistently (fused). Unsorted; `.`/`..`
    /// filtered. // quirk: FSLNK-37
    pub fn next(&mut self) -> Result<Option<DirEntry<'_>>, Win32Error> {
        loop {
            if self.pos >= self.end {
                if self.done {
                    return Ok(None);
                }
                self.refill()?;
                continue;
            }
            let Some(meta) = self.consume_record() else {
                continue; // skipped (dot entry / stripped-empty) or batch ended
            };
            debug_assert!(meta.name_off.is_multiple_of(2));
            let bytes = &self.buf.0[meta.name_off..meta.name_off + meta.name_units * 2];
            // SAFETY: the range was bounds-checked against the kernel-filled
            // region by `consume_record`, and the base is 2-aligned: records
            // are kept 8-aligned and both FileName offsets are even
            // (const-asserted above). The `c_void` hop is clippy's documented
            // `cast_ptr_alignment` escape hatch for externally-guaranteed
            // alignment (`src/ast/e.rs` precedent).
            let name = unsafe {
                core::slice::from_raw_parts(
                    bytes.as_ptr().cast::<core::ffi::c_void>().cast::<u16>(),
                    meta.name_units,
                )
            };
            return Ok(Some(DirEntry {
                name,
                attributes: meta.attributes,
                reparse_tag: meta.reparse_tag,
                file_id: meta.file_id,
            }));
        }
    }

    /// Parses the record at `self.pos`, advances past it, and returns its
    /// scalar view — or `None` for entries the contract hides (`.`/`..`,
    /// names that strip to empty) and for malformed chains, which end the
    /// batch instead of walking out of bounds. All header-derived offsets and
    /// lengths are validated/clamped against the filled region before use —
    /// network redirectors are exactly the adversaries that emit odd records
    /// (FSLNK-33). // quirk: FSLNK-33
    fn consume_record(&mut self) -> Option<RecordMeta> {
        let pos = self.pos;
        let id_class = self.class == FILE_INFORMATION_CLASS::FileIdFullDirectoryInformation;
        let name_field = if id_class { NAME_OFF_ID } else { NAME_OFF_DIR };
        if pos + name_field > self.end {
            // Truncated fixed header: no well-formed kernel emits this.
            self.pos = self.end;
            return None;
        }
        let buf = &self.buf.0;
        let next = read_u32(buf, pos + OFF_NEXT) as usize;
        let attributes = read_u32(buf, pos + OFF_ATTRS);
        let declared_bytes = read_u32(buf, pos + OFF_NAME_LEN) as usize;
        let (reparse_tag, file_id) = if id_class {
            let tag = if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                // MS-FSCC 2.4.18: EaSize doubles as the reparse tag.
                read_u32(buf, pos + OFF_EA)
            } else {
                0
            };
            (tag, read_i64(buf, pos + OFF_FILE_ID))
        } else {
            (0, 0)
        };

        // Advance first so skip decisions cannot stall the chain. A chain
        // offset that leaves the filled region or breaks the 8-alignment
        // contract ends the batch.
        self.pos = if next == 0 {
            self.end
        } else {
            match pos.checked_add(next) {
                Some(n) if n.is_multiple_of(8) && n <= self.end => n,
                _ => self.end,
            }
        };

        let name_off = pos + name_field;
        let avail = self.end - name_off;
        let name_bytes = &buf[name_off..name_off + declared_bytes.min(avail) / 2 * 2];
        let units = stripped_units(name_bytes);
        if is_dot_or_empty(name_bytes, units) {
            return None; // quirk: FSLNK-33, FSLNK-37
        }
        Some(RecordMeta {
            name_off,
            name_units: units,
            attributes,
            reparse_tag,
            file_id,
        })
    }

    /// The first `NtQueryDirectoryFile` (RestartScan=TRUE), where three
    /// special statuses live:
    /// - `STATUS_INVALID_PARAMETER` → not a directory → raw `DIRECTORY` (267),
    ///   libuv's exact shape — unless a one-syscall probe shows the handle IS
    ///   a directory (an FSD signalling an unsupported class with the generic
    ///   code), which downgrades the class instead. // quirk: FSLNK-35
    /// - `STATUS_INVALID_INFO_CLASS`/`NOT_SUPPORTED`/`NOT_IMPLEMENTED` → the
    ///   filesystem rejects the Id class (npfs) → downgrade to libuv's
    ///   `FileDirectoryInformation` and retry.
    /// - First-call `STATUS_NO_MORE_FILES` → success with zero entries: real
    ///   local filesystems always yield `.`/`..`, but network filesystems
    ///   (sshfs-win) legally report an empty enumeration outright.
    ///   // quirk: FSLNK-40
    fn first_query(&mut self) -> Result<(), Win32Error> {
        loop {
            let status = self.query(true);
            if self.class == FILE_INFORMATION_CLASS::FileIdFullDirectoryInformation {
                match status {
                    NTSTATUS::INVALID_INFO_CLASS
                    | NTSTATUS::NOT_SUPPORTED
                    | NTSTATUS::NOT_IMPLEMENTED => {
                        self.class = FILE_INFORMATION_CLASS::FileDirectoryInformation;
                        continue;
                    }
                    NTSTATUS::INVALID_PARAMETER if handle_is_directory(self.guard.0) => {
                        self.class = FILE_INFORMATION_CLASS::FileDirectoryInformation;
                        continue;
                    }
                    _ => {}
                }
            }
            if status == NTSTATUS::INVALID_PARAMETER {
                return Err(Win32Error::DIRECTORY); // quirk: FSLNK-35
            }
            return self.accept(status, true);
        }
    }

    /// Continuation query (RestartScan=FALSE). `STATUS_SUCCESS` with zero
    /// bytes written must be treated as an error here: some filesystems
    /// return it instead of `STATUS_NO_MORE_FILES`, and looping on status
    /// alone never terminates. // quirk: FSLNK-34
    fn refill(&mut self) -> Result<(), Win32Error> {
        let status = self.query(false);
        self.accept(status, false)
    }

    /// One `NtQueryDirectoryFile` into the owned buffer; stores the filled
    /// length, returns the raw status.
    fn query(&mut self, restart: bool) -> NTSTATUS {
        let mut iosb = IO_STATUS_BLOCK {
            Status: 0,
            Information: 0,
        };
        // SAFETY: the handle is live (owned by `self.guard`); the out-buffer
        // is the owned 8-aligned DIR_BUF_SIZE allocation; `iosb` is a fresh
        // owned out-param; the (null) mask and event/APC slots are unused on
        // this synchronous handle.
        let status = unsafe {
            NtQueryDirectoryFile(
                self.guard.0,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                &raw mut iosb,
                (&raw mut self.buf.0).cast(),
                DIR_BUF_SIZE as ULONG,
                self.class,
                0, // ReturnSingleEntry
                ptr::null_mut(),
                u8::from(restart),
            )
        };
        self.pos = 0;
        // Clamp the kernel-reported length to capacity before it becomes a
        // bound for record walking.
        self.end = if NT_SUCCESS(status) {
            iosb.Information.min(DIR_BUF_SIZE)
        } else {
            0
        };
        status
    }

    /// Shared post-query disposition for both the first and continuation
    /// calls (the special-cased statuses were consumed by the caller).
    fn accept(&mut self, status: NTSTATUS, first: bool) -> Result<(), Win32Error> {
        if status == NTSTATUS::NO_MORE_FILES {
            self.done = true; // quirk: FSLNK-40, FSLNK-41
            return Ok(());
        }
        if !NT_SUCCESS(status) {
            return Err(Win32Error::from_ntstatus(status));
        }
        if !first && status == NTSTATUS::SUCCESS && self.end == 0 {
            // Infinite-loop guard, libuv's exact substitution. // quirk: FSLNK-34
            return Err(Win32Error::from_ntstatus(NTSTATUS::BUFFER_OVERFLOW));
        }
        Ok(())
    }
}

/// One-syscall directory-ness probe (`FileBasicInfo` — the FSLNK-25 API
/// choice) disambiguating a first-query `STATUS_INVALID_PARAMETER`: the
/// documented not-a-directory meaning vs an FSD that signals an unsupported
/// info class with the generic code. Probe failure counts as not-a-directory,
/// failing toward the libuv shape. // quirk: FSLNK-35, FSLNK-38
fn handle_is_directory(handle: HANDLE) -> bool {
    let mut info = FILE_BASIC_INFORMATION::default();
    // SAFETY: owned out-param; the winbase FILE_BASIC_INFO payload is
    // layout-identical to FILE_BASIC_INFORMATION (fslnk precedent).
    let ok = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileBasicInfo,
            (&raw mut info).cast(),
            size_of::<FILE_BASIC_INFORMATION>() as DWORD,
        )
    };
    ok != 0 && info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0
}

#[inline]
fn read_u32(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
}

#[inline]
fn read_i64(buf: &[u8], off: usize) -> i64 {
    i64::from_le_bytes(buf[off..off + 8].try_into().unwrap())
}

#[inline]
fn name_unit(name_bytes: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([name_bytes[2 * i], name_bytes[2 * i + 1]])
}

/// Visible length of a record's name in u16 units after stripping ALL
/// trailing NULs — a `while`, not an `if`: the SharePoint/WebDAV redirector
/// reports `".\0"` and `"..\0"` with the terminator counted in
/// `FileNameLength`, and naive length checks then leak literal dot entries.
/// // quirk: FSLNK-33
fn stripped_units(name_bytes: &[u8]) -> usize {
    let mut units = name_bytes.len() / 2;
    while units > 0 && name_unit(name_bytes, units - 1) == 0 {
        units -= 1;
    }
    units
}

/// `.`/`..`/empty after stripping — the entries every enumeration hides.
/// // quirk: FSLNK-33, FSLNK-37
fn is_dot_or_empty(name_bytes: &[u8], units: usize) -> bool {
    match units {
        0 => true,
        1 => name_unit(name_bytes, 0) == DOT,
        2 => name_unit(name_bytes, 0) == DOT && name_unit(name_bytes, 1) == DOT,
        _ => false,
    }
}

// ───────────────────────────── tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use core::sync::atomic::{AtomicU32, Ordering};
    use std::collections::BTreeSet;
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};

    use bun_windows_sys::kernel32::{DeviceIoControl, RemoveDirectoryW};
    use bun_windows_sys::{
        DeleteFileW, FILE_ATTRIBUTE_ARCHIVE, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY,
        FILE_FLAG_OPEN_REPARSE_POINT, FSCTL_SET_REPARSE_POINT, GENERIC_WRITE, SetFileAttributesW,
    };

    use super::*;
    use crate::fsio::OpenFlags;
    use crate::fslnk::{SymlinkFlags, mkdir_path, symlink_path};
    use crate::stat::BACKSLASH;

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

    /// Per-test unique temp dir; entries removed in reverse creation order.
    struct Fixture {
        root: PathBuf,
        entries: Vec<(PathBuf, bool)>,
    }

    impl Fixture {
        fn new(tag: &str) -> Fixture {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let root = std::env::temp_dir().join(format!(
                "bun_winfs_rd_{tag}_{}_{}",
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

        /// Creates an empty file through the fsio engine and registers cleanup.
        fn file(&mut self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            let h = crate::fsio::open_path(
                &wide(&path),
                OpenFlags::WRONLY | OpenFlags::CREAT | OpenFlags::TRUNC,
                false,
            )
            .unwrap_or_else(|e| panic!("create {path:?}: {e:?}"));
            drop(HandleGuard(h));
            self.track(&path, false);
            path
        }

        /// Creates a file whose name is raw WTF-16 units (lone surrogates
        /// allowed — `&str` cannot spell them).
        fn wide_file(&mut self, name_units: &[u16]) {
            let root_w = wide(&self.root);
            let mut full: Vec<u16> = root_w[..root_w.len() - 1].to_vec();
            full.push(BACKSLASH);
            full.extend_from_slice(name_units);
            full.push(0);
            let h = crate::fsio::open_path(
                &full,
                OpenFlags::WRONLY | OpenFlags::CREAT | OpenFlags::TRUNC,
                false,
            )
            .unwrap_or_else(|e| panic!("create wide file: {e:?}"));
            drop(HandleGuard(h));
            // OsString is WTF-8: unpaired surrogates survive the PathBuf
            // round trip, so Drop's DeleteFileW sees the same name.
            let os = OsString::from_wide(&full[..full.len() - 1]);
            self.track(Path::new(&os), false);
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

    /// Applies raw reparse data (header + payload bytes) to an existing file.
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

    /// Drains an iterator, asserting per-entry contracts (no empty names, no
    /// interior NULs) and the fused end state.
    fn collect_w(path_w: &[u16]) -> Result<Vec<(Vec<u16>, DirentKind, i64)>, Win32Error> {
        let mut it = DirIter::open(path_w)?;
        let mut out = Vec::new();
        while let Some(e) = it.next()? {
            assert!(!e.name.is_empty(), "engine must never yield an empty name");
            assert!(!e.name.contains(&0), "names are raw, never NUL-terminated");
            out.push((e.name.to_vec(), e.kind(), e.file_id));
            // No fixture has this many entries: a restarted/looping scan must
            // fail loudly instead of wedging the suite.
            assert!(out.len() <= 4096, "runaway enumeration");
        }
        // Fused: an exhausted iterator stays exhausted. // quirk: FSLNK-41
        assert!(it.next().unwrap().is_none());
        assert!(it.next().unwrap().is_none());
        Ok(out)
    }

    fn collect(path: &Path) -> Result<Vec<(Vec<u16>, DirentKind, i64)>, Win32Error> {
        collect_w(&wide(path))
    }

    fn open_err(path: &Path) -> Win32Error {
        match DirIter::open(&wide(path)) {
            Ok(_) => panic!("DirIter::open({path:?}) unexpectedly succeeded"),
            Err(e) => e,
        }
    }

    /// The engine's own open recipe, exposed for `from_handle` tests.
    fn raw_open_dir(path_w: &[u16]) -> Result<HANDLE, Win32Error> {
        // SAFETY: `wide` produces a NUL-terminated path.
        let h = unsafe {
            CreateFileW(
                path_w.as_ptr(),
                FILE_LIST_DIRECTORY | SYNCHRONIZE,
                SHARE_ALL,
                ptr::null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                ptr::null_mut(),
            )
        };
        if h == INVALID_HANDLE_VALUE {
            return Err(Win32Error::get());
        }
        Ok(h)
    }

    // ── pure KATs ──

    /// Strip-then-classify against the SharePoint shapes — ALL trailing NULs
    /// strip (`while`, not `if`), then `.`/`..`/empty hide.
    /// // quirk: FSLNK-33
    #[test]
    fn trailing_nul_strip_and_dot_skip_kats() {
        let check = |units: &[u16]| {
            let bytes: Vec<u8> = units.iter().flat_map(|u| u.to_le_bytes()).collect();
            let n = stripped_units(&bytes);
            (n, is_dot_or_empty(&bytes, n))
        };
        let a = b'a' as u16;
        assert_eq!(check(&[]), (0, true));
        assert_eq!(check(&[DOT]), (1, true));
        assert_eq!(check(&[DOT, DOT]), (2, true));
        // SharePoint reports ".\0" / "..\0" with the NUL counted.
        assert_eq!(check(&[DOT, 0]), (1, true));
        assert_eq!(check(&[DOT, DOT, 0]), (2, true));
        // A single strip would leave ".\0" and leak a literal dot entry.
        assert_eq!(check(&[DOT, 0, 0]), (1, true));
        assert_eq!(check(&[0, 0]), (0, true));
        // Real names survive: dotfiles, triple dots, NUL-padded names.
        assert_eq!(check(&[DOT, DOT, DOT]), (3, false));
        assert_eq!(check(&[DOT, a]), (2, false));
        assert_eq!(check(&[a]), (1, false));
        assert_eq!(check(&[a, 0, 0]), (1, false));
    }

    /// The classifier's full table: DEVICE before REPARSE_POINT before
    /// DIRECTORY (the misorder is libuv's 5-year twin divergence), tags
    /// refining reparse points per the shared fslnk taxonomy.
    /// // quirk: FSLNK-36
    #[test]
    fn dirent_kind_classification_kats() {
        let k = |attributes: ULONG, reparse_tag: ULONG| {
            DirEntry {
                name: &[],
                attributes,
                reparse_tag,
                file_id: 0,
            }
            .kind()
        };
        assert_eq!(k(0, 0), DirentKind::File);
        assert_eq!(
            k(FILE_ATTRIBUTE_ARCHIVE | FILE_ATTRIBUTE_READONLY, 0),
            DirentKind::File
        );
        assert_eq!(k(FILE_ATTRIBUTE_DIRECTORY, 0), DirentKind::Dir);
        // DEVICE wins over everything.
        assert_eq!(
            k(
                FILE_ATTRIBUTE_DEVICE | FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY,
                IO_REPARSE_TAG_SYMLINK
            ),
            DirentKind::Char
        );
        // REPARSE_POINT wins over DIRECTORY: links never classify as Dir.
        assert_eq!(
            k(
                FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT,
                IO_REPARSE_TAG_MOUNT_POINT
            ),
            DirentKind::Junction
        );
        assert_eq!(
            k(
                FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT,
                IO_REPARSE_TAG_SYMLINK
            ),
            DirentKind::Symlink
        );
        // Symlink-class tags per the fslnk taxonomy. // quirk: FSLNK-50
        assert_eq!(
            k(FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_SYMLINK),
            DirentKind::Symlink
        );
        assert_eq!(
            k(FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_LX_SYMLINK),
            DirentKind::Symlink
        );
        assert_eq!(
            k(FILE_ATTRIBUTE_REPARSE_POINT, IO_REPARSE_TAG_APPEXECLINK),
            DirentKind::Symlink
        );
        // OneDrive cloud-file tag (the FSLNK-08 over-report case) and the
        // class-1 fallback's tag 0 both land in ReparseOther.
        assert_eq!(
            k(FILE_ATTRIBUTE_REPARSE_POINT, 0x9000_601A),
            DirentKind::ReparseOther
        );
        assert_eq!(k(FILE_ATTRIBUTE_REPARSE_POINT, 0), DirentKind::ReparseOther);
    }

    // ── real-filesystem fixtures ──

    /// A real empty directory still yields "." and ".." from the kernel; the
    /// engine filters them and the exhausted iterator stays exhausted.
    /// // quirk: FSLNK-33, FSLNK-37, FSLNK-40, FSLNK-41
    #[test]
    fn empty_directory_yields_no_entries_and_is_fused() {
        let mut fx = Fixture::new("empty");
        let d = fx.dir("hollow");
        assert!(collect(&d).unwrap().is_empty());
    }

    /// // quirk: FSLNK-36, FSLNK-37
    #[test]
    fn classification_matrix_with_junction_and_unknown_tag() {
        let mut fx = Fixture::new("kinds");
        fx.file("plain.txt");
        fx.dir("subdir");
        let jt = fx.dir("junction_target");
        let junction = fx.root.join("junction_link");
        symlink_path(&wide(&jt), &wide(&junction), SymlinkFlags::JUNCTION)
            .unwrap_or_else(|e| panic!("junction: {e:?}"));
        fx.track(&junction, true);
        let stub = fx.file("cloud_stub.bin");
        set_reparse_raw(&stub, 0xA000_0FFF, &[1, 2, 3, 4]).unwrap();

        let mut expected = vec![
            ("cloud_stub.bin".to_string(), DirentKind::ReparseOther),
            ("junction_link".to_string(), DirentKind::Junction),
            ("junction_target".to_string(), DirentKind::Dir),
            ("plain.txt".to_string(), DirentKind::File),
            ("subdir".to_string(), DirentKind::Dir),
        ];
        let sym = fx.root.join("sym_link.txt");
        if symlink_or_skip(&wide_str("plain.txt"), &wide(&sym), SymlinkFlags::NONE) {
            fx.track(&sym, false);
            expected.push(("sym_link.txt".to_string(), DirentKind::Symlink));
        }

        let entries = collect(&fx.root).unwrap();
        let mut got: Vec<(String, DirentKind)> = entries
            .iter()
            .map(|(n, k, _)| (String::from_utf16(n).unwrap(), *k))
            .collect();
        got.sort_by(|a, b| a.0.cmp(&b.0));
        expected.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(got, expected);
        assert!(got.iter().all(|(n, _)| n != "." && n != ".."));
        // The Id class is live on NTFS: every entry carries a nonzero FileId.
        for (n, _, id) in &entries {
            assert!(*id != 0, "FileId for {:?}", String::from_utf16_lossy(n));
        }
    }

    /// Raw WTF-16 names round trip bit-exact — unpaired surrogates included;
    /// the engine never decodes (the WTF-8 conversion is the wrapper's, same
    /// contract as readlink targets).
    #[test]
    fn lone_surrogate_and_non_ascii_names_round_trip_raw() {
        let mut fx = Fixture::new("wtf16");
        // p<lone D800>q<lone DC42> — unpaired high AND unpaired low.
        let lone: Vec<u16> = vec![b'p' as u16, 0xD800, b'q' as u16, 0xDC42];
        fx.wide_file(&lone);
        // BMP non-ASCII plus a real surrogate PAIR (U+1D11E).
        let fancy = "t\u{00EB}st_\u{4E2D}\u{6587}_\u{1D11E}.txt";
        fx.file(fancy);
        let fancy_units: Vec<u16> = OsStr::new(fancy).encode_wide().collect();

        let entries = collect(&fx.root).unwrap();
        let names: Vec<&[u16]> = entries.iter().map(|(n, _, _)| n.as_slice()).collect();
        assert_eq!(names.len(), 2);
        assert!(
            names.contains(&lone.as_slice()),
            "lone-surrogate name must round trip bit-exact"
        );
        assert!(names.contains(&fancy_units.as_slice()));
    }

    /// 88-byte fixed part + 116-byte names ≈ 208 bytes/record → ~39 records
    /// per 8 KB batch, so 200 entries force at least six
    /// `NtQueryDirectoryFile` fills: exact count, no dupes, no misses.
    /// // quirk: FSLNK-32, FSLNK-37
    #[test]
    fn large_directory_multi_batch_exact_set() {
        let mut fx = Fixture::new("big");
        let pad = "x".repeat(48);
        let expected: Vec<String> = (0..200).map(|i| format!("entry_{i:03}_{pad}")).collect();
        for name in &expected {
            fx.file(name);
        }

        let entries = collect(&fx.root).unwrap();
        let mut got: Vec<String> = entries
            .iter()
            .map(|(n, _, _)| String::from_utf16(n).unwrap())
            .collect();
        assert_eq!(got.len(), 200, "no batch may drop entries");
        let unique: BTreeSet<&String> = got.iter().collect();
        assert_eq!(
            unique.len(),
            200,
            "continuation batches must not repeat entries"
        );
        got.sort();
        let mut want = expected.clone();
        want.sort();
        assert_eq!(got, want);
        assert!(entries.iter().all(|(_, k, _)| *k == DirentKind::File));
    }

    /// Deletions mid-enumeration: NTFS resumes by name, so entries deleted
    /// after being returned cannot disturb the continuation, and an entry
    /// deleted before its batch is fetched never appears. (96-byte records →
    /// ~85 per batch: two kernel batches for 151 entries.)
    /// // quirk: FSLNK-32
    #[test]
    fn entry_deleted_between_batches_resumes_cleanly() {
        let mut fx = Fixture::new("del");
        let all: Vec<String> = (0..150).map(|i| format!("e{i:03}")).collect();
        for name in &all {
            fx.file(name);
        }
        let tail = "zz_tail"; // collates after every e*** name on NTFS
        fx.file(tail);

        let mut it = DirIter::open(&wide(&fx.root)).unwrap();
        let mut got: Vec<String> = Vec::new();
        for _ in 0..10 {
            let e = it.next().unwrap().expect("at least 10 entries");
            got.push(String::from_utf16(e.name).unwrap());
        }
        assert!(
            !got.iter().any(|n| n == tail),
            "tail must not be in the first ten entries"
        );

        // Two already-returned entries (before the kernel's name cursor) and
        // the unfetched tail (gone before batch 2 is read).
        let del_a = got[3].clone();
        let del_b = got[9].clone();
        for name in [del_a.as_str(), del_b.as_str(), tail] {
            let w = wide(&fx.root.join(name));
            // SAFETY: NUL-terminated path.
            assert!(unsafe { DeleteFileW(w.as_ptr()) } != 0, "delete {name}");
        }

        while let Some(e) = it.next().unwrap() {
            got.push(String::from_utf16(e.name).unwrap());
            assert!(got.len() <= 200, "runaway enumeration");
        }
        assert!(it.next().unwrap().is_none(), "fused after deletions");

        let unique: BTreeSet<&String> = got.iter().collect();
        assert_eq!(unique.len(), got.len(), "no duplicates across deletions");
        assert!(
            !got.iter().any(|n| n == tail),
            "deleted-before-fetch entry must not appear"
        );
        // Everything else — including the already-returned deleted names —
        // appears exactly once.
        got.sort();
        let mut want = all.clone();
        want.sort();
        assert_eq!(got, want);
    }

    /// `from_handle` adoption matches `open` on the same directory (same
    /// entry set), errors with the FSLNK-38 shape on a file handle (handle
    /// consumed either way), and rejects sentinels without kernel calls.
    #[test]
    fn from_handle_adoption_matches_open() {
        let mut fx = Fixture::new("adopt");
        fx.file("a.txt");
        fx.dir("b");
        let via_open = collect(&fx.root).unwrap();

        let handle = raw_open_dir(&wide(&fx.root)).unwrap();
        // SAFETY: freshly opened live handle; ownership transfers.
        let mut it = unsafe { DirIter::from_handle(handle) }.unwrap();
        let mut via_adopt = Vec::new();
        while let Some(e) = it.next().unwrap() {
            via_adopt.push((e.name.to_vec(), e.kind(), e.file_id));
        }
        let key = |v: &mut Vec<(Vec<u16>, DirentKind, i64)>| {
            v.sort_by(|x, y| x.0.cmp(&y.0));
        };
        let (mut a, mut b) = (via_open, via_adopt);
        key(&mut a);
        key(&mut b);
        assert_eq!(a, b);

        // File handle → the same raw ENOTDIR shape as open-on-file.
        let f = fx.file("plain.bin");
        let fh = raw_open_dir(&wide(&f)).unwrap();
        // SAFETY: live handle; consumed by the call even on Err.
        let Err(err) = (unsafe { DirIter::from_handle(fh) }) else {
            panic!("from_handle on a file unexpectedly succeeded");
        };
        assert_eq!(err, Win32Error::DIRECTORY);

        // SAFETY: sentinel inputs error cleanly per the contract.
        let Err(err) = (unsafe { DirIter::from_handle(INVALID_HANDLE_VALUE) }) else {
            panic!("from_handle on a sentinel unexpectedly succeeded");
        };
        assert_eq!(err, Win32Error::INVALID_HANDLE);
    }

    /// Error shapes and link traversal: open-on-file → raw `DIRECTORY` (267,
    /// libuv's UV_ENOTDIR sys-errno; the wrapper's readdir-local ENOTDIR),
    /// missing leaf/parent → the raw open codes; junctions and dir-symlinks
    /// enumerate their TARGET (no OPEN_REPARSE_POINT in the open).
    /// // quirk: FSLNK-35, FSLNK-38
    #[test]
    fn open_error_shapes_and_link_following() {
        let mut fx = Fixture::new("err");
        let f = fx.file("regular.bin");
        assert_eq!(open_err(&f), Win32Error::DIRECTORY);
        assert_eq!(
            open_err(&fx.root.join("missing")),
            Win32Error::FILE_NOT_FOUND
        );
        assert_eq!(
            open_err(&fx.root.join("missing\\sub")),
            Win32Error::PATH_NOT_FOUND
        );

        let target = fx.dir("jt");
        fx.file("jt\\inner.txt");
        let junction = fx.root.join("jlink");
        symlink_path(&wide(&target), &wide(&junction), SymlinkFlags::JUNCTION).unwrap();
        fx.track(&junction, true);
        let through = collect(&junction).unwrap();
        assert_eq!(through.len(), 1);
        assert_eq!(String::from_utf16(&through[0].0).unwrap(), "inner.txt");
        assert_eq!(through[0].1, DirentKind::File);

        // A symlink to a FILE follows to the file → the same ENOTDIR shape.
        let fsym = fx.root.join("file_sym");
        if symlink_or_skip(&wide(&f), &wide(&fsym), SymlinkFlags::NONE) {
            fx.track(&fsym, false);
            assert_eq!(open_err(&fsym), Win32Error::DIRECTORY);
        }
    }
}
