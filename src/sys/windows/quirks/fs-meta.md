# fs-meta — libuv Windows institutional knowledge ledger

Scope: `src/win/fs.c` stat/fstat/lstat family, utimes family, chmod/fchmod, access, statfs, realpath.
Worktree: `C:/Users/dylan/code/libuv-read` (libuv ~1.52, HEAD 439a54be). All file:line refs are into that worktree.
Empirical probes in this section were run on this machine: Windows 11 Pro 10.0.26200, Node v25.8.1 (libuv 1.51.0).

### [FSMETA-01] Stat is a triple-fallback chain, not one syscall

- **What Windows does**: There is no single Windows call that yields POSIX stat. Three mechanisms exist with different capabilities and failure modes: `GetFileInformationByName` (Win11+, no handle open, fastest), handle-based NT queries (needs an openable file), and parent-directory enumeration (works when the file itself cannot be opened at all).
- **How libuv handles it**: `fs__stat_impl_from_path` (src/win/fs.c:2201-2245) tries `fs__stat_path` (fast API, fs.c:1770) first; on `FS__STAT_PATH_TRY_SLOW` opens a handle and uses `fs__stat_handle` (fs.c:1808); if `CreateFileW` fails with `ERROR_ACCESS_DENIED` or `ERROR_SHARING_VIOLATION` falls to `fs__stat_directory` (fs.c:2025) which asks the parent directory about the child. All three feed one normalizer `fs__stat_assign_statbuf` (fs.c:1909) via a common `FILE_STAT_BASIC_INFORMATION` carrier struct.
- **History**: 20a8e58a (2013, Bert Belder) reimplemented stat with NT syscalls; 4e310d0f (2024, #4327) added the fast path; 72d9abcc (2024, #4566) added the directory fallback, fixing libuv#1980 and libuv#3267 (stat of `pagefile.sys` etc.).
- **Bun disposition**: must-port. The single-normalizer design (one carrier struct, one assign function) is the part worth copying exactly — libuv had st_dev drift between paths until it converged on this. Target: engine

### [FSMETA-02] Fast stat API must be runtime-probed via GetModuleHandleW on an apiset DLL

- **What Windows does**: `GetFileInformationByName` only exists in Windows 11 (apiset `api-ms-win-core-file-l2-1-4.dll`, hosted by KernelBase). On Win10 (incl. Bun's 1809 baseline) the export is absent. SDK headers older than NTDDI_WIN11_ZN don't even declare `FILE_STAT_BASIC_INFORMATION`/`FileStatBasicByNameInfo`.
- **How libuv handles it**: one-time probe in winapi.c:166-172: `GetModuleHandleW(L"api-ms-win-core-file-l2-1-4.dll")` (deliberately _not_ LoadLibrary — apiset is resolved if present, no DLL planting surface) then `GetProcAddress(..., "GetFileInformationByName")`; NULL pointer → permanent slow path (fs.c:1776). Struct + enum are re-declared under `#if (NTDDI_VERSION < NTDDI_WIN11_ZN)` (winapi.h:4131-4150, 4795-4805) so old SDKs build.
- **History**: 4e310d0f (#4327). Author note in commit: API "doesn't have to open the file thus greatly improving performance".
- **Bun disposition**: must-port (probe + graceful absence; Bun baseline 1809 means the slow path is the common path on Win10, the fast path on Win11). Define the struct/enum in Bun's own windows bindings since windows-sys may lag. Target: engine

### [FSMETA-03] Fast path: only four error codes are final; everything else falls through to the slow path

- **What Windows does**: `GetFileInformationByName` can fail for reasons the handle-based path would survive (e.g. `ERROR_SHARING_VIOLATION` for pagefile.sys — verified live on this machine: fails with GLE=32) and for reasons that are genuinely final.
- **How libuv handles it**: fs.c:1783-1791: `ERROR_FILE_NOT_FOUND`, `ERROR_PATH_NOT_FOUND`, `ERROR_NOT_READY` (drive with no media), `ERROR_BAD_NET_NAME` (bad UNC share) return immediately as errors — "not worth retrying with the slow path" (and for network names, retrying would mean a second slow network round-trip). Every other failure, including ACCESS_DENIED, SHARING_VIOLATION, INVALID_NAME, falls to the slow chain.
- **History**: 4e310d0f (#4327), unchanged since.
- **Bun disposition**: must-port, exactly this allowlist polarity (fail-fast list, retry-by-default) so unknown future errors degrade to the slower-but-stronger path instead of regressing user-visible behavior. Target: engine

### [FSMETA-04] Fast path bails on any reparse point

- **What Windows does**: `GetFileInformationByName` reports the reparse point itself (it does not traverse), and gives no way to read the reparse target, so neither stat (must follow the link) nor lstat (must report target length as st_size) can be answered from it for reparse points. The struct does carry `ReparseTag`.
- **How libuv handles it**: fs.c:1794-1797: if `FILE_ATTRIBUTE_REPARSE_POINT` is set → `FS__STAT_PATH_TRY_SLOW`, for both stat and lstat. The available `ReparseTag` field is ignored (a possible optimization — only name-surrogate tags need the slow path for stat — was not taken).
- **History**: 4e310d0f; comment "A file handle is needed to get st_size for links."
- **Bun disposition**: must-port. Optional refinement for Bun: use `ReparseTag`/`IsReparseTagNameSurrogate` to keep non-symlink reparse points (OneDrive placeholders, etc.) on the fast path for plain stat — but only with tests against placeholder files; libuv chose the conservative route. Target: engine

### [FSMETA-05] NUL device gets a fully synthesized character-device stat

- **What Windows does**: `stat("NUL")` must work (POSIX programs stat /dev/null). The NUL device supports `NtQueryVolumeInformationFile(FileFsDeviceInformation)` (DeviceType `FILE_DEVICE_NULL` = 0x15) but not the file queries used for regular stats.
- **How libuv handles it**: both the fast path (fs.c:1799-1802, via `stat_info.DeviceType`) and the handle path (fs.c:1829-1833, via device-info query made _first_, before FileAllInformation) detect `FILE_DEVICE_NULL` and fill `fs__stat_assign_statbuf_null` (fs.c:1899-1907): `st_mode = _S_IFCHR | 0666`, `st_nlink = 1`, `st_blksize = 4096`, `st_rdev = FILE_DEVICE_NULL << 16` (0x150000), everything else zero.
- **History**: c17bd99f (2022, #3811) added the device-type check while fixing fstat on pipes/char files; refs nodejs/node#40006.
- **Bun disposition**: must-port (Node-compat: `fs.statSync("NUL")`, `\\.\NUL`); note the ordering constraint: query device type _before_ FileAllInformation or NUL errors out. Target: engine

### [FSMETA-06] NT "warning" statuses are success: STATUS_BUFFER_OVERFLOW from FileAllInformation

- **What Windows does**: `NtQueryInformationFile(FileAllInformation)` ends with a variable-length filename; with a fixed-size buffer the call returns `STATUS_BUFFER_OVERFLOW` (0x80000005), which is _warning_ severity — all fixed-size members are valid. `NT_SUCCESS()` is false for it, `NT_ERROR()` is also false.
- **How libuv handles it**: fs.c:1835-1845 checks `NT_ERROR(nt_status)` (not `!NT_SUCCESS`) with the comment "Buffer overflow (a warning status code) is expected here." Same pattern for `FileFsVolumeInformation` (volume label overflows, fs.c:1847-1861) and in the directory fallback (fs.c:2123-2131).
- **History**: 20a8e58a (2013) established the pattern; verified still true on Win11 26200 (probe: 88-byte buffer → 0x80000005 with valid fixed fields).
- **Bun disposition**: must-port. This is the #1 thing a from-scratch NT-API port gets wrong (treating any !NT_SUCCESS as failure, or any NT_SUCCESS-only check as complete). Encode "warning = data valid" in the Rust wrapper's type. Target: engine

### [FSMETA-07] Wine doesn't implement FileFsVolumeInformation — detect via io_status, not return status

- **What Windows does**: Wine's ntdll returns `STATUS_NOT_IMPLEMENTED` for `FileFsVolumeInformation` (st_dev source). That status is error severity, so the normal NT_ERROR check would fail the whole stat.
- **How libuv handles it**: fs.c:1854-1861 and fs.c:2166-2173: `if (io_status.Status == STATUS_NOT_IMPLEMENTED) { VolumeSerialNumber = 0; } else if (NT_ERROR(nt_status)) fail; else use it`. Note it inspects `io_status.Status` (which Wine fills) rather than the returned status — on real Windows a failed call may not write io*status at all, in which case io_status holds the \_previous* call's value; the check only works because Wine writes it.
- **History**: 2930d04e (2014, Isaiah Norton), citing Wine source `dlls/ntdll/file.c` line ref and winehq.
- **Bun disposition**: should-port (Wine/Proton users run Bun; cost is 3 lines). If ported, prefer zero-initializing io_status before the call so the check is sound on both real Windows and Wine. Target: engine

### [FSMETA-08] st_dev must be the 32-bit VolumeSerialNumber.LowPart on every path

- **What Windows does**: The classic `FILE_FS_VOLUME_INFORMATION.VolumeSerialNumber` is a ULONG; the new `FILE_STAT_BASIC_INFORMATION.VolumeSerialNumber` is a LARGE_INTEGER and on some volumes carries 64 bits. Mixing widths makes st_dev differ between fast-path stat and slow-path stat of the same volume.
- **How libuv handles it**: fs\_\_stat_assign_statbuf reads `.LowPart` only (fs.c:1912); the handle path writes `.LowPart` (fs.c:1860). Consequence: a file statted via fast path and its symlink statted via slow path compare equal on st_dev. Regression test `fs_fstat_st_dev` compares file vs through-symlink st_dev.
- **History**: 82cdfb75 (2025-02, Hüseyin Açacak) "win: fix the inconsistency in volume serial number" — fast path had been reporting the full QuadPart since 4e310d0f, breaking st*dev equality. Note fs\_\_stat_directory still writes `.QuadPart` (fs.c:2172) but the reader only consumes LowPart, so it's consistent today; copy the \_reader* contract, not each writer.
- **Bun disposition**: must-port (Node exposes st_dev; copyfile same-file detection and user dev/ino caching depend on cross-path consistency). Target: engine

### [FSMETA-09] Slow-path stat open flags: FILE_READ_ATTRIBUTES + FILE_FLAG_BACKUP_SEMANTICS + share-everything

- **What Windows does**: `CreateFileW` without `FILE_FLAG_BACKUP_SEMANTICS` cannot open directories at all. A minimal access mask (`FILE_READ_ATTRIBUTES`, not GENERIC_READ) plus `FILE_SHARE_READ|WRITE|DELETE` minimizes both ACL failures and sharing-violation failures against files other processes hold open.
- **How libuv handles it**: fs.c:2219-2229. For lstat, `FILE_FLAG_OPEN_REPARSE_POINT` is OR'd in (fs.c:2220-2221) so the link itself is opened.
- **History**: stable since the 2013 rewrite; 7dfa54d6 removed dead non-BACKUP_SEMANTICS code.
- **Bun disposition**: must-port (exact triple). Deviating on any of the three is a latent bug that only shows on directories, ACL'd files, or files open elsewhere. Target: engine

### [FSMETA-10] Files that cannot be opened at all are statted via their parent directory (pagefile.sys)

- **What Windows does**: Certain files can never be opened from user mode — `pagefile.sys`, `swapfile.sys`, `hiberfil.sys` (`ERROR_SHARING_VIOLATION`), or deny-ACL'd files (`ERROR_ACCESS_DENIED`) — yet `dir` shows their metadata, because directory enumeration carries it.
- **How libuv handles it**: `fs__stat_directory` (fs.c:2025-2199): split path into parent + name, open parent with `FILE_LIST_DIRECTORY|FILE_FLAG_BACKUP_SEMANTICS`, then a single-entry `NtQueryDirectoryFile(FileIdFullDirectoryInformation, ReturnSingleEntry=TRUE, FileMask=exact name, RestartScan=TRUE)` (fs.c:2111-2121). Yields attributes, all four timestamps (incl. ChangeTime), sizes, and the 64-bit FileId — i.e. a nearly full stat. Volume serial + device type are then queried from the _parent_ handle ("files presumably must live on their device", fs.c:2157-2185). If the parent open also fails, the _original_ error (`ret_error` parameter) is returned, not the parent's.
- **History**: 72d9abcc (2024-12, Jameson Nash + Hüseyin Açacak, #4566) fixing libuv#1980 (2018!) and libuv#3267. Earlier attempt #4504 was replaced.
- **Bun disposition**: must-port — this is the difference between `fs.statSync("C:\\pagefile.sys")` working and EBUSY/EPERM; Node-compat tools (disk scanners, backup tools) hit it. But see FSMETA-14: port the idea, not the path-splitting implementation. Target: engine

### [FSMETA-11] The NT directory FileMask treats \* ? > < " as wildcards — must reject them before querying

- **What Windows does**: `NtQueryDirectoryFile`'s FileName mask is a _pattern_: `*` `?` plus the DOS-era encodings `>` (DOS*QM), `<` (DOS_STAR), `"` (DOS_DOT) glob-match. A stat fallback that passes a user path containing them would silently return metadata of \_some other file* that matches the pattern.
- **How libuv handles it**: fs.c:2078-2089 scans the filename component and fails with `ERROR_INVALID_NAME` (→ UV_ENOENT) if any of the five chars appear. Also `uv__RtlUnicodeStringInit` (fs.c:61-72) caps the mask at 0x7FFF chars (UNICODE_STRING USHORT length limit) returning STATUS_INVALID_PARAMETER beyond.
- **History**: part of 72d9abcc.
- **Bun disposition**: must-port (correctness/security of the fallback: wrong-file metadata is a confused-deputy primitive). Target: engine

### [FSMETA-12] Directory-fallback status mapping: BUFFER_OVERFLOW = success, NO_MORE_FILES = path-not-found

- **What Windows does**: With a buffer sized to the fixed struct only (`FILE_ID_FULL_DIR_INFORMATION` has trailing FileName), a successful single-entry match returns `STATUS_BUFFER_OVERFLOW` with all fixed fields valid (verified on Win11 26200: 88-byte buffer → 0x80000005, Information=0x58). A mask matching nothing returns `STATUS_NO_SUCH_FILE` on first scan / `STATUS_NO_MORE_FILES` on continuation.
- **How libuv handles it**: fs.c:2123-2131: `!NT_SUCCESS && != STATUS_BUFFER_OVERFLOW` → error; `STATUS_NO_MORE_FILES` → `ERROR_PATH_NOT_FOUND`; everything else → `RtlNtStatusToDosError`. (`STATUS_NO_SUCH_FILE` maps to `ERROR_FILE_NOT_FOUND` via RtlNtStatusToDosError, so both not-found shapes work.)
- **History**: 72d9abcc; comment "actually indicates success".
- **Bun disposition**: must-port with the directory fallback. Target: engine

### [FSMETA-13] Directory fallback can't recover everything: nlink lies, reparse handling is asymmetric

- **What Windows does**: Directory enumeration does not carry the hard-link count, and the reparse _target_ (size/contents) requires a handle which is exactly what we couldn't get.
- **How libuv handles it**: `st_nlink = 1` with comment "No way to recover this info" (fs.c:2188). If the entry is a reparse point: plain stat gives up entirely (returns the original open error — can't follow a link without a handle, fs.c:2139-2147); lstat proceeds but reports `st_size = 0` (can't read FSCTL_GET_REPARSE_POINT, fs.c:2148-2149). Comment notes they could distinguish real symlinks via `FILE_ID_EXTD_DIR_INFORMATION.ReparsePointTag` but deemed it "not essential".
- **History**: 72d9abcc.
- **Bun disposition**: must-port the asymmetry (stat→original error, lstat→size 0, nlink=1); document the lies. Bun improvement option: use FileIdExtdDirectoryInformation to also get the ReparseTag and report `st_size` only for true symlinks. Target: engine

### [FSMETA-14] LIVE UPSTREAM BUG: the fallback's path splitting breaks for root-level files, drive-relative parents, and dots-only paths

- **What Windows does**: `\\?\C:` (namespaced, no trailing slash) opens the _volume device_, not the root directory; `NtQueryDirectoryFile` on a volume handle fails `STATUS_INVALID_PARAMETER`. Unprefixed `C:` is _drive-relative_ (per-drive CWD), not the root.
- **How libuv handles it**: it doesn't — `fs__stat_directory` splits by nulling the last separator (fs.c:2061-2070), so the parent of `\\?\C:\pagefile.sys` becomes `\\?\C:`. Verified live on this machine: Node v25.8.1 (libuv 1.51, always passes `\\?\` paths) returns **EINVAL** for `fs.statSync('C:\\pagefile.sys')` — the very case #4566 was meant to fix (probe: CreateFileW("\\\\?\\C:") succeeds → volume handle; NtQueryDirectoryFile → 0xC000000D). Unprefixed paths only work when the per-drive CWD happens to be the root (otherwise the mask is searched in the wrong directory → ENOENT). Additional latent defects: dots-only relative paths ("..", ".") read `path[-1]` (OOB, fs.c:2058-2061 reached with split==0); `splitchar` is restored uninitialized when the no-filename branches taken (fs.c:2064-2065, 2072-2074 vs 2193-2195); a path with no filename component sends an _empty_ FileMask, returning the first directory entry's metadata instead of the directory's own.
- **History**: 72d9abcc (2024). The libuv test only exercises a bare relative filename (parent "."), which is why none of this was caught. Worth reporting upstream.
- **Bun disposition**: must-port the _fixed_ version: keep the separator on the parent (`C:\`, `\\?\C:\`), guard split==0, and route "no filename component" to the handle-based path or fail cleanly — never an empty mask. This is a case where copying libuv verbatim ports a bug. Target: engine

### [FSMETA-15] lstat on a non-symlink reparse point retries as plain stat — at the impl level, not inline

- **What Windows does**: `FILE_ATTRIBUTE_REPARSE_POINT` covers far more than symlinks: OneDrive/cloud placeholders, dedup, HSM, projfs, app-exec links. A handle opened with `FILE_FLAG_OPEN_REPARSE_POINT` sees the raw stub (wrong size/content); only re-opening _without_ that flag lets the owning filter driver materialize the real file.
- **How libuv handles it**: `fs__stat_handle` fails with the readlink error when the tag isn't link-like; `fs__stat_impl` (fs.c:2248-2264) catches exactly `ERROR_SYMLINK_NOT_SUPPORTED` or `ERROR_NOT_A_REPARSE_POINT` (the latter from `DeviceIoControl` when reparse data is absent) and re-runs the whole chain with do_lstat=0 — i.e. a second CreateFileW without OPEN_REPARSE_POINT. Recursion is bounded (retry passes 0).
- **History**: Three-act story. 7ae4b1ad (2016, libuv#995, nodejs/node#5160): reparse attr with _no_ data → treat as regular file inline. e5024c54 (2017, nodejs/node#12737): swallow _all_ readlink failures inline — wrong, because the OPEN*REPARSE_POINT handle's metadata is the stub's. 1d9c13f1 (2017, Wade Brainerd, #1522): moved the retry up to fs\_\_stat_impl so the file is \_re-opened* and the filesystem driver processes the reparse point; commit message explicitly preserves the ERROR_NOT_A_REPARSE_POINT case "out of caution" though the author couldn't reproduce it. 72d9abcc later removed a leftover statbuf assignment in the failure path.
- **Bun disposition**: must-port (OneDrive placeholder files are everywhere on consumer Windows; getting this wrong reports stub sizes or EINVAL). The reverted-approach history is the lesson: never report metadata from an OPEN_REPARSE_POINT handle for a non-link. Target: engine

### [FSMETA-16] lstat st_size is the WTF-8 byte length of the link target, computed from FSCTL_GET_REPARSE_POINT

- **What Windows does**: There is no filesystem-provided "symlink length". POSIX requires lstat st_size == strlen(readlink result).
- **How libuv handles it**: during lstat of a reparse point, `fs__stat_handle` calls `fs__readlink_handle(handle, NULL, &target_length)` (fs.c:1879-1893) which runs the full readlink decode and sizes the target via `uv_utf16_to_wtf8(..., NULL, &len)` without allocating (fs.c:345); `st_size = target_length`. So st*size is the \_WTF-8* (not UTF-16, not on-disk) length, consistent with what uv_fs_readlink returns. For LX symlinks the raw stored bytes are counted (fs.c:256-262). EndOfFile from the file query is ignored for links.
- **History**: behavior since the 2013 rewrite (then UTF-8); 8f32a14a (2022) switched to WTF-8.
- **Bun disposition**: must-port (Node tests check `lstat.size === readlink.length`); ensure Bun's readlink and lstat use the same encoder so the invariant holds for unpaired-surrogate targets. Target: engine

### [FSMETA-17] Which reparse tags count as symlinks (and which deliberately don't)

- **What Windows does**: Reparse tags are an open set. Symlink-ish ones: `IO_REPARSE_TAG_SYMLINK`, `IO_REPARSE_TAG_MOUNT_POINT` (junctions _and_ volume mount points), `IO_REPARSE_TAG_LX_SYMLINK` (WSL), `IO_REPARSE_TAG_APPEXECLINK` (Microsoft Store aliases like `python.exe`).
- **How libuv handles it** (`fs__readlink_handle`, fs.c:186-346): SYMLINK → use _SubstituteName_ (not PrintName), undoing the `\??\` NT prefix only for `\??\<drive>:` and rewriting `\??\UNC\` → `\\` (fs.c:222-247); other `\??\` forms are returned verbatim ("user must have explicitly made it so"). MOUNT_POINT → only treated as a symlink if the target looks like `\??\<drive>:\`; `\??\Volume{guid}` mount points get `ERROR_SYMLINK_NOT_SUPPORTED` because returning an un-openable NT path "is confusing for programs" (fs.c:284-300) — so lstat of a mounted-volume junction reports a plain directory (via the FSMETA-15 retry). LX_SYMLINK → raw bytes after the 4-byte version field, no encoding conversion (fs.c:250-274). APPEXECLINK → 3rd NUL-separated string in the buffer, and only if it's an absolute `X:\` path (fs.c:306-336); otherwise not-supported. Anything else → `ERROR_SYMLINK_NOT_SUPPORTED`.
- **History**: junction/symlink logic from pre-1.0; e5024c54/1d9c13f1 (other tags fall back to file); e7ebae26 (2020, appexeclink, nodejs/node#33024 — Store python.exe made stat fail because CreateFile can't traverse appexec links: ERROR_CANT_ACCESS_FILE→EACCES, so lstat must classify them as links for Node's realpath to work); 588ea9b9 (2026-01, LX symlinks — before this, WSL-created symlinks were un-stat-able from Windows in some cases).
- **Bun disposition**: must-port the full taxonomy including the deliberate exclusions (Volume{guid} junction = directory). Bun already ships on machines with Store aliases and WSL-created repos. Target: engine

### [FSMETA-18] st_mode permission bits are synthesized solely from FILE_ATTRIBUTE_READONLY

- **What Windows does**: Windows has no POSIX mode; the readonly attribute is a delete/write inhibitor with no security meaning (ACLs do that). Directories' readonly bit means "customized folder", not write protection.
- **How libuv handles it**: fs.c:1960-1964: READONLY → 0444, else 0666, replicated to user/group/other by bit shifts; OR'd with `_S_IFDIR`/`_S_IFREG`/`S_IFLNK`. No execute bits are ever set (not even for .exe or directories). A long "Todo" comment (fs.c:1914-1932) calls the whole readonly↔chmod situation "a clusterfuck" and muses that chmod "should probably just fail on windows or be a total no-op" — kept as institutional warning, 12+ years old.
- **History**: comment dates to the 2013 rewrite, never resolved.
- **Bun disposition**: must-port bit-for-bit (Node user code string-matches `(mode & 0o777).toString(8)`); do not "improve" by adding execute bits — that breaks compat both with Node and with libuv. Target: engine

### [FSMETA-19] st_ctim is ChangeTime (NTFS), st_birthtim is CreationTime — never swap them

- **What Windows does**: NTFS keeps four timestamps; Win32 `GetFileInformationByHandle`-era APIs expose only three (no ChangeTime), which is why naive ports map ctime=CreationTime. NT-level queries (`FileAllInformation`/`FILE_STAT_BASIC_INFORMATION`/`FileIdFullDirectoryInformation`) expose ChangeTime.
- **How libuv handles it**: fs.c:1966-1973: atim←LastAccessTime, mtim←LastWriteTime, ctim←**ChangeTime**, birthtim←CreationTime. Using NT APIs _specifically to get ChangeTime_ was a headline reason for the 2013 rewrite.
- **History**: 20a8e58a (2013): "st_ctime now contains the change time, not the creation time."
- **Bun disposition**: must-port (Node compat; build tools compare ctime). Bun's Rust layer must use NT info classes, not `BY_HANDLE_FILE_INFORMATION`, or ChangeTime is simply unavailable. Target: engine

### [FSMETA-20] FILETIME↔timespec conversion: 1601 epoch, 100ns ticks, negative-remainder borrow

- **What Windows does**: FILETIME is 100ns ticks since 1601-01-01 UTC. Unix epoch offset = 11644473600 seconds. Pre-1970 timestamps make the converted value negative, and C integer division truncates toward zero, producing negative tv_nsec.
- **How libuv handles it**: constants at fs.c:124-126 (`NSEC_PER_TICK 100`, `TICKS_PER_SEC 1e7`, `WIN_TO_UNIX_TICK_OFFSET = 11644473600 * TICKS_PER_SEC`); `uv__filetime_to_timespec` (fs.c:128-136) subtracts the offset in tick space, divides, then normalizes `tv_nsec < 0` by borrowing one second (`tv_sec -= 1; tv_nsec += 1e9`).
- **History**: 8d5af5e7 (2020, Ben Noordhuis, #2747, nodejs/node#32369): older macro soup did unsigned math — pre-1970 dates were "reinterpreted as unsigned and end up off by ... decades"; rewritten as signed function with the borrow.
- **Bun disposition**: must-port (files with pre-1970 or zero FILETIMEs exist in archives/containers; Node tests cover negative mtimes). Target: engine

### [FSMETA-21] Tick arithmetic must be 64-bit end-to-end (UBSan-caught overflow)

- **What Windows does**: n/a — pure arithmetic trap: `seconds * 10_000_000` overflows 32-bit (and `long` is 32-bit on Windows) for any modern date.
- **How libuv handles it**: after 5537d6a6 (2024, #4491), all conversion math is `int64_t` tick-space first (subtract offset, then divide); the earlier code computed `ts->tv_sec * 10 * MILLION` with `long` intermediates → "signed integer overflow: 1702781567 \* 10 cannot be represented in type 'long'".
- **History**: 5537d6a6 "win: fix fs.c ubsan failure".
- **Bun disposition**: must-port the lesson (in Rust: do tick math in i64/i128, watch `as` casts; debug builds panic on overflow which is its own DoS if reachable). Target: engine

### [FSMETA-22] st_ino is the 64-bit NTFS FileId; 128-bit ReFS ids are truncated

- **What Windows does**: NTFS exposes a 64-bit file index (`FileInternalInformation.IndexNumber` / `FILE_STAT_BASIC_INFORMATION.FileId` / `FileIdFullDirectoryInformation.FileId`); ReFS file ids are natively 128-bit (`FileId128`), and the 64-bit field holds a truncation. FAT volumes have no stable id (synthesized by the FS).
- **How libuv handles it**: `st_ino = stat_info.FileId.QuadPart` (fs.c:1975), sourced from IndexNumber on the handle path (fs.c:1866-1867) and from the directory query in the fallback (fs.c:2155). `FileId128` present in the fast-path struct is ignored. uv_stat_t st_ino is uint64 (include/uv.h:391).
- **History**: 20a8e58a (2013) "st_ino is now filled in with an fs-specific unique number."
- **Bun disposition**: must-port (Node BigInt stats expose ino; dev+ino pairs drive same-file checks). Document the ReFS truncation; do not promise uniqueness on ReFS/network FS. Target: engine

### [FSMETA-23] st_blocks synthesized from AllocationSize in 512-byte units; directories report st_size 0

- **What Windows does**: No native st_blocks; `AllocationSize` is the on-disk allocation in bytes (0 for resident/MFT-embedded files, larger than EOF for preallocated). Directories have no meaningful EOF at the Win32 level.
- **How libuv handles it**: `st_blocks = AllocationSize >> 9` (fs.c:1977-1979); directories get `st_size = 0` unconditionally in the normalizer (fs.c:1951-1953) even when the source struct carried a directory EndOfFile.
- **History**: 20a8e58a.
- **Bun disposition**: must-port (du-style tools use blocks\*512; Node tests assert dir size semantics loosely but ecosystem code assumes 0 on Windows). Target: engine

### [FSMETA-24] st_blksize is a hardcoded 4096

- **What Windows does**: The real optimum lives in `FILE_FS_SECTOR_SIZE_INFORMATION`, but querying it adds a syscall per stat for a field "nobody knows ... and even fewer people actually use" (comment fs.c:1983-1998).
- **How libuv handles it**: constant 4096 (fs.c:1999), chosen as the Advanced-Format-safe value; NUL stat uses 4096 too.
- **History**: 5a2b5e84 (2017, Joran Greef, #1563/#1566) changed 2048 → 4096 to avoid read-modify-write on AF drives.
- **Bun disposition**: must-port the constant (Node parity); do not add a per-stat volume query. Target: engine

### [FSMETA-25] st_uid/st_gid/st_rdev/st_gen/st_flags are hard zeros on disk files

- **What Windows does**: No POSIX owner ids without prohibitively expensive SID lookups; no st_gen/st_flags analog used.
- **How libuv handles it**: fs.c:2004-2012 zeroes them with the comment "Windows has nothing sensible to say about these values". st_rdev is nonzero only for synthesized device stats (NUL, fstat TTY/pipe: `DeviceType << 16`).
- **History**: 2013 rewrite.
- **Bun disposition**: must-port (Node returns 0s; anything else breaks code that gates on `uid === 0`). Target: engine

### [FSMETA-26] One trailing slash is stripped before stat — except on drive roots — making stat("file/") succeed (POSIX deviation)

- **What Windows does**: `CreateFileW("file\")` on a regular file fails `ERROR_INVALID_NAME`; POSIX says stat("file/") must fail ENOTDIR for non-directories but succeed for directories.
- **How libuv handles it**: `fs__stat_prepare_path` (fs.c:2016-2023) strips exactly one trailing `\` or `/` if `len > 1` and the char before it isn't `:` (preserving `C:\`). Applied for stat and lstat only (fs.c:2302-2310) — not utime/realpath/statfs. Consequences: `stat("file/")` _succeeds_ on Windows libuv (deviation Node inherits); only one slash is stripped so `stat("dir//")` still relies on Win32 normalization; the strip also applies inside `\\?\` paths where Win32 normalization is otherwise disabled — a "TODO: ignore namespaced paths" comment was removed in 2025 after security review concluded it's fine.
- **History**: function dates to 514265ec (2012); 8e51d38a (2025-07, Ben Noordhuis) removed the TODO citing advisory GHSA-qf6p-jg38-9f4x discussion.
- **Bun disposition**: must-port (Node-compat including the deviation; tightening to ENOTDIR would break code that stats `dir/` strings built by joins). Target: engine

### [FSMETA-27] fstat dispatches on handle type; TTY/pipe stats are synthesized; sockets masquerade as pipes

- **What Windows does**: Console handles, pipe handles, and sockets reject file information queries; `GetFileType` returns CHAR/PIPE/DISK; consoles are CHAR handles for which `GetConsoleMode` succeeds; sockets report FILE_TYPE_PIPE.
- **How libuv handles it**: `fs__fstat_handle` (fs.c:2271-2299) switches on `uv_guess_handle(fd)` (handle.c:31-58: CHAR+ConsoleMode→TTY, CHAR otherwise→FILE, PIPE→NAMED*PIPE, DISK→FILE). UV_FILE → full `fs__stat_handle`; UV_TTY/UV_NAMED_PIPE → zeroed statbuf with `st_mode = _S_IFCHR`/`_S_IFIFO`, `st_nlink = 1`, `st_rdev = (FILE_DEVICE_CONSOLE|FILE_DEVICE_NAMED_PIPE) << 16`, and `st_ino = (uintptr_t) handle` (fs.c:2284-2291) — the kernel handle value as a fake inode. Unknown → `ERROR_INVALID_HANDLE` → EBADF. Therefore fstat on a \_socket* fd reports S_IFIFO, not S_IFSOCK. All timestamps zero for TTY/pipes.
- **History**: c17bd99f (2022, #3811, nodejs/node#40006): fstat(stdin/stdout/stderr) used to hard-fail when they were consoles or pipes; dde50f0e fixed the handle cast for 32-bit.
- **Bun disposition**: must-port (Node `fs.fstatSync(0/1/2)` and `tty.isatty` paths rely on it; `process.stdout` init stats fd 1). Keep st_ino=handle quirk for parity. Target: engine

### [FSMETA-28] Non-console character devices take the disk-file path — NUL works via the device check, serial ports may error

- **What Windows does**: NUL and COM ports are FILE_TYPE_CHAR without console modes. NUL answers FileFsDeviceInformation (FILE_DEVICE_NULL); serial devices answer it too (FILE_DEVICE_SERIAL_PORT) but then fail the FileAllInformation query.
- **How libuv handles it**: uv*guess_handle classifies them UV_FILE (GetConsoleMode fails) → `fs__stat_handle`, whose \_first* query is the device-type probe; NUL short-circuits to the synthesized char stat (fs.c:1829-1833); other char devices proceed and typically fail FileAllInformation → fstat errors. No special case for COM/other devices.
- **History**: c17bd99f.
- **Bun disposition**: must-port the NUL-first ordering; accept (and document) that fstat on serial ports errors — match libuv rather than inventing synthesized serial stats. Target: engine

### [FSMETA-29] fd→HANDLE goes through the CRT with assertions suppressed

- **What Windows does**: libuv file fds are MSVCRT fds; `_get_osfhandle` on an invalid fd raises a CRT assertion dialog in debug builds before returning INVALID_HANDLE_VALUE.
- **How libuv handles it**: `VERIFY_FD` macro rejects fd==-1 with EBADF (fs.c:117-122); `uv__get_osfhandle` wraps `_get_osfhandle` in `UV_BEGIN/END_DISABLE_CRT_ASSERT` (handle-inl.h:98-110); fstat/futime also re-check the returned handle against INVALID_HANDLE_VALUE (fs.c:2320-2325, 2749-2754).
- **History**: longstanding; c619f37c (don't close fd 0-2) is adjacent lore.
- **Bun disposition**: skip the CRT mechanics (Bun's Rust fd type owns real HANDLEs, no MSVCRT fd table) — but port the _shape_: every fd-taking op validates and maps to EBADF before any syscall. Target: engine

### [FSMETA-30] utime writes timestamps via a fresh FILE_WRITE_ATTRIBUTES handle + SetFileTime

- **What Windows does**: `SetFileTime` needs a handle with FILE_WRITE_ATTRIBUTES; directories need BACKUP_SEMANTICS to open; there is no path-based set-times Win32 API.
- **How libuv handles it**: `fs__utime_impl_from_path` (fs.c:2681-2712) opens with `FILE_WRITE_ATTRIBUTES | FILE_SHARE_*all | FILE_FLAG_BACKUP_SEMANTICS` (+OPEN_REPARSE_POINT for lutime) and calls `fs__utime_handle` (fs.c:2653-2679). CreationTime pointer is always NULL (birthtime never modified).
- **History**: handle-based since early; lutime split in bd429238 (2020).
- **Bun disposition**: must-port (incl. works-on-directories via BACKUP_SEMANTICS — POSIX utimes on dirs must work). Target: engine

### [FSMETA-31] Timestamp sentinels: NaN = leave unchanged (NULL FILETIME\*), Infinity = now

- **What Windows does**: `SetFileTime` natively supports "don't change" by passing NULL for that timestamp — a perfect match for POSIX UTIME_OMIT; there's no native UTIME_NOW so the caller snapshots `GetSystemTimeAsFileTime`.
- **How libuv handles it**: fs.c:2658-2673: `isinf` → use a single `now` snapshot (taken once for both fields); `isnan` → NULL pointer; else convert. Constants `UV_FS_UTIME_NOW=(INFINITY)`, `UV_FS_UTIME_OMIT=(NAN)` (include/uv.h:1602-1603). `uv__isnan/uv__isinf` are open-coded bit-pattern tests (uv-common.h:462-478) "so downstream users don't have to link libm" — also immune to -ffast-math.
- **History**: 85b526f5 (2025-02, Ben Noordhuis, #4702, libuv#4665). Commit admits the double-encoding is "Ugly, but it avoids having to add uv_fs_utime2".
- **Bun disposition**: must-port the SetFileTime-NULL mechanism for Bun's UTIME*OMIT handling (node:fs `utimes` with `Date`/numbers, plus `fs.lutimes`); the NaN/Inf \_encoding* itself is libuv API surface Bun doesn't need (Bun should use an explicit Option type internally). Target: engine

### [FSMETA-32] Seconds-as-double → FILETIME conversion has inherent ~1.6µs precision ceiling

- **What Windows does**: n/a — math: the 1601-offset in ticks (1.16e17) exceeds double's 53-bit mantissa, so `time * 1e7 + offset` computed in double has ulp ≈ 16 ticks (1.6µs) for modern dates.
- **How libuv handles it**: `TIME_T_TO_FILETIME` (fs.c:138-143) does exactly that double math, then splits via uint64 cast. Sub-second precision works (399e2c81, 2016, #800: previously truncated to whole seconds) but not to the tick.
- **History**: 399e2c81 added sub-second support; 8d5af5e7 cleaned the rounding for negative times (deep-past dates were off by >0.5s on unix and sign-flipped on win).
- **Bun disposition**: should-port the _lesson_, not the code: Bun receives ms-since-epoch from JS — convert via integer math (i64 milliseconds → ticks) and avoid the double round-trip entirely; only fall back to double handling where the JS API hands you fractional ms. Pre-1601 inputs produce negative tick values that SetFileTime rejects — surface EINVAL. Target: engine

### [FSMETA-33] lutime: open with OPEN_REPARSE_POINT, and retry as plain utime on non-symlink reparse points

- **What Windows does**: same reparse-point ambiguity as lstat (FSMETA-15): OPEN_REPARSE_POINT on a cloud placeholder/odd tag either fails or addresses the stub.
- **How libuv handles it**: `fs__utime_impl` (fs.c:2714-2737) mirrors the stat retry verbatim: on `ERROR_SYMLINK_NOT_SUPPORTED` or `ERROR_NOT_A_REPARSE_POINT` with do_lutime, re-run without the flag. (In practice these errors can only arise from the CreateFileW step here, since no readlink happens; the symmetric shape was copied from stat by design.)
- **History**: bd429238 (2020, #2723) introduced lutime with the retry already in place, modeled on 1d9c13f1.
- **Bun disposition**: must-port (lutimes on placeholders should degrade to utimes, matching stat's philosophy). Target: engine

### [FSMETA-34] futime fails on read-only fds (no re-open dance) — POSIX deviation libuv chose to keep

- **What Windows does**: SetFileTime demands FILE*WRITE_ATTRIBUTES on the \_handle*; libuv opens UV_FS_O_RDONLY files with plain `FILE_GENERIC_READ` (fs.c:481-483) which lacks it → `ERROR_ACCESS_DENIED`. POSIX futimes works on O_RDONLY fds.
- **How libuv handles it**: `fs__futime` (fs.c:2744-2762) uses the fd's existing handle directly — unlike fchmod, it does _not_ ReOpenFile with FILE_WRITE_ATTRIBUTES. So `futimes(open(path, 'r'))` errors EPERM on Windows.
- **History**: the global fix (open everything with FILE_WRITE_ATTRIBUTES, aa1beaa0) was reverted (1954e9e3) for causing EPERM opens (see FSMETA-37); nobody extended the ReOpenFile workaround to futime.
- **Bun disposition**: should-port as a _decision point_: matching libuv/Node exactly means keeping the failure; Bun could instead borrow fchmod's `ReOpenFile(handle, FILE_WRITE_ATTRIBUTES, 0, 0)` dance to make read-only-fd futimes work (strictly more POSIX-compatible, low risk). Document whichever is chosen. Target: engine

### [FSMETA-35] Never CloseHandle(INVALID_HANDLE_VALUE) — Wine and debug layers abort

- **What Windows does**: On real Windows, closing INVALID_HANDLE_VALUE quietly "succeeds" (it's the pseudo current-process handle); under Wine and app-verifier/debug configurations it raises/aborts.
- **How libuv handles it**: 3b2c25d2 (2022, Jameson Nash) restructured `fs__stat_impl_from_path`/`fs__utime_impl_from_path` to early-return on open failure rather than flowing to a shared CloseHandle; fs\_\_stat_directory guards with `if (handle != INVALID_HANDLE_VALUE)` (fs.c:2196-2197).
- **History**: 3b2c25d2 "While usually functional, calling CloseHandle(INVALID_HANDLE_VALUE) can result in debug builds (and/or wine) being unhappy and aborting there."
- **Bun disposition**: must-port as an invariant in Bun's Rust handle wrapper (the owned-handle type should make it unrepresentable: Option<OwnedHandle>, never a sentinel that Drop closes). Target: engine

### [FSMETA-36] chmod is CRT `_wchmod` (READONLY-attribute toggle) with `_doserrno` as the error channel — and it's lchmod on symlinks

- **What Windows does**: The only chmod-able thing is FILE_ATTRIBUTE_READONLY via Get/SetFileAttributesW. Crucially, **SetFileAttributesW/GetFileAttributesW do not follow symlinks** — they act on the link itself.
- **How libuv handles it**: `fs__chmod` (fs.c:2558-2564) calls `_wchmod(path, mode)` and on failure reports `_doserrno` (the CRT's saved OS error — _not_ GetLastError; mixing them up reports stale errors). Consequences: only the user-write bit matters (mode & \_S*IWRITE); chmod on a symlink modifies the \_link's* readonly attribute (silent lchmod semantics, deviating from POSIX chmod-follows); no Archive-flag dance here (SetFileAttributes, unlike NtSetInformationFile, doesn't need it).
- **History**: ae9d5207 (2020, #2945) made the `_doserrno` access explicit after refactors confused the two error channels.
- **Bun disposition**: must-port the behavior (readonly-bit only, treat as lchmod) but implement via SetFileAttributesW directly in Rust rather than the CRT — keep the "report the OS error from the failing call, not a stale one" lesson. Target: engine

### [FSMETA-37] fchmod must ReOpenFile with FILE_WRITE_ATTRIBUTES — the global-open-rights fix was reverted for breaking opens

- **What Windows does**: Changing attributes on a handle requires FILE*WRITE_ATTRIBUTES, which read/write data opens don't include. Adding FILE_WRITE_ATTRIBUTES to \_every* uv_fs_open desired-access mask makes opens fail EPERM on files where the caller has data access but not attribute-write access.
- **How libuv handles it**: `fs__fchmod` (fs.c:2567-2581) calls `ReOpenFile(uv__get_osfhandle(fd), FILE_WRITE_ATTRIBUTES, 0, 0)` — duplicates the open with _only_ the attribute right, leaving the original handle untouched; the temp handle is closed at `fchmod_cleanup`.
- **History**: full reverted-approach arc: aa1beaa0 (2018-03, #1777) opened all files with FILE_WRITE_ATTRIBUTES → broke Node (nodejs/node#20112, EPERM regressions) → reverted in 1954e9e3 (2018-04, #1800) → replaced by the scoped ReOpenFile in b59fc583 (2018-05, #1819).
- **Bun disposition**: must-port (ReOpenFile pattern; never widen default open rights to enable a metadata op). Target: engine

### [FSMETA-38] The Archive-flag dance: NtSetInformationFile won't toggle READONLY unless ARCHIVE is set, and FileAttributes==0 means "no change"

- **What Windows does**: Two stacked quirks of `NtSetInformationFile(FileBasicInformation)`: (a) writing `FileAttributes = 0` is the documented "leave attributes unchanged" sentinel, so clearing the last attribute bit silently no-ops — on a `+R -A` file, clearing READONLY computes 0 and does nothing; (b) empirically, toggling READONLY doesn't stick on files with ARCHIVE cleared (the libuv comment: "otherwise setting or clearing the read-only flag will not work").
- **How libuv handles it**: fs.c:2594-2645: query attrs; if ARCHIVE clear → set it first (separate NtSetInformationFile), remember `clear_archive_flag`; toggle READONLY per `mode & _S_IWRITE`; then restore: clear ARCHIVE, and if the result would be 0 substitute `FILE_ATTRIBUTE_NORMAL` to dodge the sentinel. Three sequential attribute writes in the worst case.
- **History**: b59fc583 (2018, Bartosz Sosnowski, #1819, nodejs/node#12803 "fs.fchmod fails on -A files"). Sibling bug class: edf05b97 fixed unlink on `+R -A` files the same month (cross-ref: FS-DELETE area).
- **Bun disposition**: must-port verbatim (this is pure empirically-acquired knowledge a rewrite would lose; `attrib -A +R file` then fchmod is the repro). Target: engine

### [FSMETA-39] access() is GetFileAttributesW + three rules; X_OK is silently F_OK

- **What Windows does**: No cheap POSIX access check. The readonly attribute is the only write-deniability signal available without opening; directories _cannot_ be readonly-protected on Windows (the bit is repurposed); there is no executable bit.
- **How libuv handles it**: fs.c:2532-2555: any failure of GetFileAttributesW → that error. Then "Access is possible if: write access wasn't requested, or the file isn't read-only, or it's a directory" (rules credited to CPython in the commit). R_OK/X_OK/F_OK all collapse to "attributes were readable". W_OK on a READONLY non-directory → UV_EPERM.
- **History**: 7dcc3e0c (2015, Saúl Ibarra Corretgé, #316) fixed W_OK wrongly failing on directories; comment block kept "for posterity". cd937833 fixed a req leak here.
- **Bun disposition**: must-port (Node documents exactly these semantics; "directories cannot be read-only" is the non-obvious rule). Note access() does NOT consult ACLs — a deny-ACL'd file still passes R_OK if attributes are readable via the parent. Target: engine

### [FSMETA-40] access() quirk pair: EPERM is smuggled through the Win32-error macro, and symlinks are not followed

- **What Windows does**: GetFileAttributesW does not dereference symlinks — it reports the link's own attributes (and succeeds on dangling links).
- **How libuv handles it**: (a) `SET_REQ_WIN32_ERROR(req, UV_EPERM)` (fs.c:2552) abuses the macro: `uv_translate_sys_error` passes values ≤0 through unchanged (error.c:67-69), so result is correct but `sys_errno_` stores a negative bogus "win32 code". (b) Because attributes come from the link, `access(brokenLink, F_OK)` succeeds and `access(linkToReadonlyFile, W_OK)` succeeds — both deviate from POSIX (which follows).
- **History**: code comment only; the negative-passthrough contract is explicit in error.c ("If < 0 then it's already a libuv error").
- **Bun disposition**: must-port the observable behavior (Node-compat incl. the no-follow deviation — changing it breaks `fs.access` parity); skip the macro hack (Bun's error type should store the real source). Target: engine

### [FSMETA-41] realpath: open with zero access + GetFinalPathNameByHandleW called twice (size probe, then fill)

- **What Windows does**: `GetFinalPathNameByHandleW(h, NULL, 0, VOLUME_NAME_DOS)` returns the required length _including_ the terminator; the second call returns chars written _excluding_ it. Opening with dwDesiredAccess=0 requests neither read nor write, so it succeeds on files locked by other processes and needs no rights beyond traversal; FILE_FLAG_BACKUP_SEMANTICS makes it work on directories.
- **How libuv handles it**: `fs__realpath` opens `CreateFileW(path, 0, 0, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL|FILE_FLAG_BACKUP_SEMANTICS, NULL)` (fs.c:3075-3081; share mode 0 is irrelevant with access 0); `fs__realpath_handle` (fs.c:3023-3070) does the two-call dance, mallocs len+1, and converts with `uv_utf16_to_wtf8`.
- **History**: e76b8838 (2015, Yuval Brik, #531). 5dc15cc2 (2016, #733) fixed the length not being reduced after prefix stripping (over-long garbage in the converted string).
- **Bun disposition**: must-port (incl. zero-access open — using GENERIC_READ here makes realpath fail on locked files like running executables). Target: engine

### [FSMETA-42] realpath prefix rewriting: \\?\UNC\ → \\, \\?\X: → X:, anything else is a hard error

- **What Windows does**: GetFinalPathNameByHandleW(VOLUME_NAME_DOS) returns `\\?\C:\...` or `\\?\UNC\server\share\...`. Volumes without drive letters, and some third-party/filter filesystems (historically ImDisk RAM disks and similar), yield paths that match neither shape (or the call fails outright).
- **How libuv handles it**: fs.c:3048-3064: `\\?\UNC\` → advance 6 chars and overwrite position 6 with `\` producing `\\server\share\...`; `\\?\` → skip 4; **anything else → SetLastError(ERROR_INVALID_HANDLE) → UV_EBADF** — a deliberate refusal to return un-normalized NT paths. The constants live at fs.c:154-158. Note the UNC rewrite mutates the buffer in place (the 'C' of "UNC" becomes a backslash).
- **History**: e76b8838; length bug fixed in 5dc15cc2.
- **Bun disposition**: must-port the rewrites; should-port a friendlier fallback for the "neither prefix" case (Bun may choose to return the raw string rather than EBADF for exotic volumes — Node currently surfaces the EBADF, so deviating needs a compat check). Target: engine

### [FSMETA-43] realpath semantics bundle: resolves subst/junctions/symlinks, canonicalizes on-disk case, fails on appexec links; the XP fallback is gone

- **What Windows does**: GetFinalPathNameByHandle resolves SUBST drives and mapped-drive indirection (returns the underlying path), returns each component in its on-disk case, and reflects whatever the open traversed (symlinks/junctions resolved by the FS). It cannot be reached for Microsoft Store appexec links because CreateFile won't traverse them (`ERROR_CANT_ACCESS_FILE` → EACCES, error.c:74). The API didn't exist on XP.
- **How libuv handles it**: all behavior is inherited from the open + the API; no case/subst post-processing. The original implementation runtime-probed `pGetFinalPathNameByHandleW` and returned UV_ENOSYS on XP (e76b8838); the dynamic import and ENOSYS path were deleted in a7493d8a ("remove the remaining dynamic kernel32 imports") once XP support ended.
- **History**: e76b8838, a7493d8a; appexeclink consequence documented via e7ebae26 (lstat classifies them as symlinks so callers can readlink instead).
- **Bun disposition**: must-port (knowledge): Bun's realpath on Windows must accept that result ≠ input for subst'd dev setups (common!) and that case may change; node:fs realpath tests rely on both. EACCES-on-store-alias needs the lstat+readlink escape hatch (cross-ref SYMLINKS). No XP concerns at 1809 baseline — call GetFinalPathNameByHandleW statically. Target: engine

### [FSMETA-44] statfs evolved to a handle + FileFsFullSizeInformation — works on file paths and >2^32 clusters

- **What Windows does**: `GetDiskFreeSpaceW` only accepts directory (root-ish) paths — handing it a file fails `ERROR_DIRECTORY` — and its DWORD out-params overflow on huge volumes (clusters > 2^32). `NtQueryVolumeInformationFile(FileFsFullSizeInformation)` on _any_ handle on the volume returns 64-bit allocation-unit counts.
- **How libuv handles it**: current `fs__statfs` (fs.c:3115-3165) opens the path itself (`FILE_READ_ATTRIBUTES|BACKUP_SEMANTICS`, share-all — file or directory both fine) and queries FileFsFullSizeInformation.
- **History**: bf86d5fb added statfs via GetDiskFreeSpaceW; ad618647 (2020, erw7, #2695, libuv#2683) bolted on a GetFullPathNameW+strip-to-parent retry when given file paths; c68ca444 (2026-02, Santiago Gimeno, #5016) deleted all of that for the handle approach, explicitly re-verifying #2683 stays fixed; 076df64d fixed a uv_statfs_t leak on the old error path.
- **Bun disposition**: must-port the final form only (skip the GetDiskFreeSpace/GetFullPathName intermediate designs — recorded here so nobody re-walks that path). Target: engine

### [FSMETA-45] statfs field mapping: cluster-size blocks, quota-aware bavail, and hard zeros

- **What Windows does**: FILE_FS_FULL_SIZE_INFORMATION reports TotalAllocationUnits, CallerAvailableAllocationUnits (respects per-user NTFS quotas), ActualAvailableAllocationUnits (raw free), SectorsPerAllocationUnit, BytesPerSector. Windows has no fs-type magic number and no inode counts.
- **How libuv handles it**: fs.c:3153-3161: `f_bsize = SectorsPerAllocationUnit * BytesPerSector` (cluster size, computed in uint64), `f_frsize = f_bsize`, `f_blocks = Total`, `f_bfree = Actual`, `f_bavail = Caller` (mirrors POSIX root-vs-user free split), `f_type = 0`, `f_files = 0`, `f_ffree = 0`.
- **History**: 91ae02a6 (2025-12, #4984) added f_frsize cross-platform; mapping otherwise from bf86d5fb/c68ca444.
- **Bun disposition**: must-port (Node `fs.statfs` exposes exactly these; the Actual-vs-Caller distinction is the subtle one — swap them and quota'd users see wrong free space). Target: engine

### [FSMETA-46] chown/fchown/lchown are unconditional success no-ops

- **What Windows does**: No POSIX uid/gid ownership model.
- **How libuv handles it**: fs.c:3100-3112 — all three set result 0 without touching the args or the file.
- **History**: pre-1.0; lchown added as no-op in aa28f7d5.
- **Bun disposition**: must-port (must _succeed_, not ENOSYS — npm and tarball extractors call chown unconditionally and treat failure as fatal). Target: engine

### [FSMETA-47] All fs paths cross a WTF-8↔UTF-16 boundary; invalid WTF-8 is ERROR_INVALID_NAME before any syscall

- **What Windows does**: NTFS names are arbitrary 16-bit units — not necessarily valid UTF-16 (unpaired surrogates occur in the wild). Any UTF-8-strict bridge silently corrupts or rejects real files.
- **How libuv handles it**: `fs__capture_path` (fs.c:349-423) converts the incoming path with `uv_wtf8_length_as_utf16`/`uv_wtf8_to_utf16`, failing with `ERROR_INVALID_NAME` (→ENOENT) on malformed input; realpath/readlink convert outputs back with `uv_utf16_to_wtf8`. lstat's st_size counts WTF-8 bytes (FSMETA-16).
- **History**: 8f32a14a (2022, #2970, libuv#2048); d09441ca (2023, #4092, nodejs/node#48673) fixed a decoder bug (forgot to mask high bits of the first byte of 4-byte sequences — every supplementary-plane char hit the error path); f3889085 exported the helpers; 428f2c44 (2026) fixed the _error code_ of uv_wtf8_length_as_utf16.
- **Bun disposition**: must-port (Bun's strings are WTF-8-aware already; the ledger point is that fs-meta APIs must use the WTF-8 converters, not strict UTF-8, end-to-end — and tests need an unpaired-surrogate filename). Target: engine

### [FSMETA-48] The raw Windows error is preserved alongside the mapped errno; key remaps for this area

- **What Windows does**: One POSIX errno fans out from many Win32 codes; diagnosing user reports needs the original.
- **How libuv handles it**: `SET_REQ_WIN32_ERROR` stores `sys_errno_` (raw) and `result` (mapped) (fs.c:105-109); `uv_fs_get_system_error` exposes the raw value. Remaps that shape this area's behavior (src/win/error.c): `ERROR_SHARING_VIOLATION→EBUSY`, `ERROR_ACCESS_DENIED→EPERM` (not EACCES!), `ERROR_CANT_ACCESS_FILE→EACCES`, `ERROR_SYMLINK_NOT_SUPPORTED→EINVAL`, `ERROR_INVALID_NAME→ENOENT`, `ERROR_DIRECTORY→ENOENT`, `ERROR_INVALID_FUNCTION→EISDIR`, `ERROR_CANT_RESOLVE_FILENAME→ELOOP`, `ERROR_INVALID_HANDLE→EBADF`; negatives pass through untranslated (error.c:67-69).
- **History**: 45728582 (2020, #2810, libuv#2348) added the raw-error plumbing after years of "what was the real error" bugs.
- **Bun disposition**: should-port (Bun's `bun.sys.Error` already keeps windows codes; the must-copy part is the _specific mapping table_ — Node user code matches `err.code` strings, so EBUSY-for-sharing-violation and EPERM-for-access-denied must match exactly). Target: engine

### [FSMETA-49] Sync fs ops run inline with no loop; async ones are threadpool FAST_IO work items

- **What Windows does**: n/a (libuv architecture). All these "syscalls" are blocking; Windows offers no async stat/chmod/utime.
- **How libuv handles it**: the `POST` macro (fs.c:82-97): cb==NULL → run `uv__fs_work` on the calling thread and return the result (loop may be NULL — df62b54a); cb!=NULL → `uv__work_submit(..., UV__WORK_FAST_IO, ...)`. Init is lazy via `uv__once_init()` inside `uv__fs_req_init` (fs.c:426-441; 165c63b9) so fs calls work before any loop exists. Cleanup contract: `uv_fs_req_cleanup` frees the captured wide paths and the FREE_PTR results (realpath string, statfs struct) exactly once (fs.c flags 45-47).
- **History**: 9a4468f4 unified POST; df62b54a allowed NULL loop for sync; 165c63b9 added once-init.
- **Bun disposition**: should-port the shape (Bun has its own threadpool/work model, but the invariants carry: stat-family must be callable before/without an event loop; sync paths must not touch loop state; results that allocate need a single-owner free path). Target: engine

### [FSMETA-50] copyfile converts EBUSY to success when src and dst are the same file — via the stat machinery's dev+ino

- **What Windows does**: `CopyFileW(src, dst)` where both paths reach the same file fails with a sharing violation (the source is held open while the destination open collides with it).
- **How libuv handles it**: fs.c:2469-2481: only when the mapped error is UV*EBUSY, stat both paths through `fs__stat_impl_from_path` and if `st_dev` and `st_ino` both match, report success (POSIX cp semantics for same-file). This is a \_consumer* of FSMETA-08's st_dev consistency guarantee: if fast-path and slow-path stat disagreed on st_dev width, same-file detection would silently break.
- **History**: 0b29acb0 "fs: fix uv_fs_copyfile if same src and dst".
- **Bun disposition**: should-port (cross-ref: FS-COPY area owns copyfile; recorded here because the same-file check must be built on the _same_ stat normalizer Bun ships, and it constrains st_dev/st_ino stability). Target: engine
