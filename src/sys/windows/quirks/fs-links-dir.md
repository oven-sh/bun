# libuv Windows institutional knowledge — fs-links-dir

Scope: `src/win/fs.c` readlink/symlink/junction, unlink/rmdir, mkdir, scandir, opendir/readdir, copyfile, sendfile, mkdtemp/mkstemp. Worktree: `C:/Users/dylan/code/libuv-read` at 439a54be (post-v1.52.0). All `fs.c:` refs are into that worktree.

---

### [FSLNK-01] Read reparse data into a 16 KB stack buffer via FSCTL_GET_REPARSE_POINT

- **What Windows does**: Reparse point payloads are capped at `MAXIMUM_REPARSE_DATA_BUFFER_SIZE` (16384 bytes) by the kernel; `DeviceIoControl(FSCTL_GET_REPARSE_POINT)` fails with ERROR_INSUFFICIENT_BUFFER if the output buffer is smaller than the stored data.
- **How libuv handles it**: `fs__readlink_handle` (fs.c:186-206) allocates `char buffer[MAXIMUM_REPARSE_DATA_BUFFER_SIZE]` on the stack so a single call always succeeds, then switches on `ReparseTag`. libuv's own `REPARSE_DATA_BUFFER` definition (winapi.h:4153-4185) includes the non-SDK `LinuxSymbolicLinkReparseBuffer` and `AppExecLinkReparseBuffer` union arms.
- **History**: shape dates to 2931bdcf (2011); struct extended in e7ebae26 (2020) and 588ea9b9 (2026).
- **Bun disposition**: must-port. One full-size buffer, one ioctl, no retry loop needed — 16 KB is an OS contract. Target: engine

### [FSLNK-02] IO_REPARSE_TAG_SYMLINK: use SubstituteName and undo the NT-namespace conversion

- **What Windows does**: `CreateSymbolicLinkW` with an absolute target silently stores the NT form `\??\C:\foo` in the SubstituteName; PrintName is cosmetic and may be empty or lie. Reading the raw buffer back gives you an NT path users can't consume.
- **How libuv handles it**: Reads SubstituteName (never PrintName) at fs.c:208-215, then strips `\??\` ONLY when the remainder looks like `<letter>:` followed by end-or-backslash (fs.c:222-235). Anything else starting with `\??\` is returned verbatim — "if the path is win32-namespaced then the user must have explicitly made it so" (comment fs.c:217-221).
- **History**: 2931bdcf (2011) stripped `\??\` unconditionally; 4a88b3b4 (Bert Belder, 2012) made it shape-conditional and fixed st_size of symlinks at the same time.
- **Bun disposition**: must-port. Node's `fs.readlink` output contract depends on this exact stripping. Target: engine

### [FSLNK-03] Symlink UNC targets: rewrite `\??\UNC\server\share` to `\\server\share` in place

- **What Windows does**: Absolute UNC symlink targets are stored as `\??\UNC\server\share`. Returning that verbatim breaks every consumer expecting `\\server\share`.
- **How libuv handles it**: fs.c:237-247: case-insensitive match on `UNC\` after `\??\`, then `w_target += 6; w_target[0] = L'\\'` — overwrites the `C` of `UNC` with a backslash inside the local buffer to synthesize `\\server\...` without a second allocation.
- **History**: 4a88b3b4 (2012), code comment documents the target shape.
- **Bun disposition**: must-port. Target: engine

### [FSLNK-04] Relative symlinks pass through untouched; SYMLINK_FLAG_RELATIVE is never consulted

- **What Windows does**: Relative symlinks store the relative target directly in SubstituteName (no `\??\`), and set `SymbolicLinkReparseBuffer.Flags & SYMLINK_FLAG_RELATIVE`.
- **How libuv handles it**: The `\??\` prefix checks simply don't match, so the target falls through to WTF-8 conversion unchanged (fs.c:222-248 → 345). The Flags field is ignored entirely.
- **History**: code comment only ("Real symlinks can contain pretty much everything").
- **Bun disposition**: must-port (the pass-through). should-port: also reading the RELATIVE flag is useful if Bun ever needs to resolve targets itself (realpath emulation). Target: engine

### [FSLNK-05] IO_REPARSE_TAG_LX_SYMLINK (WSL symlinks): payload is raw UTF-8 bytes after a 4-byte version field

- **What Windows does**: WSL creates symlinks with tag 0xA000001D whose reparse payload is `ULONG Version` followed by an unterminated UTF-8 (Linux bytes) path — not UTF-16. These appear on any NTFS volume touched from WSL and DrvFs.
- **How libuv handles it**: fs.c:250-274: `target_len = ReparseDataLength - sizeof(ULONG)`, then memcpy + NUL-terminate, returned as-is with NO UTF-16 round trip (fs.c:266-272). Note returns directly, skipping the common `uv_utf16_to_wtf8` tail.
- **History**: 588ea9b9 (#4994, Jan 2026) — added 6 years after AppExecLink; before this, `lstat`/`readlink`/`unlink` of WSL symlinks failed with EINVAL on Windows. Hazard found while porting: `ReparseDataLength` is attacker/filesystem-controlled; `< 4` underflows the subtraction to a huge size_t (malloc then fails → ENOMEM, not exploitable but ugly). Validate `ReparseDataLength >= sizeof(ULONG)` explicitly.
- **Bun disposition**: must-port (WSL interop is common in dev environments; Bun's baseline includes WSL-created checkouts). Also feeds unlink: without this tag recognized, deleting a WSL dir-symlink via unlink errors. Target: engine

### [FSLNK-06] IO_REPARSE_TAG_MOUNT_POINT: accept drive-letter junctions, reject volume-GUID mount points

- **What Windows does**: Junctions and mounted volumes share one tag. A mounted-volume target looks like `\??\Volume{gui-d}\`, which is meaningless to programs if returned from readlink.
- **How libuv handles it**: fs.c:276-304: only `\??\<letter>:` (end or `\` after) is treated as a symlink; everything else sets ERROR_SYMLINK_NOT_SUPPORTED and fails (→ UV_EINVAL via the error table). Comment notes UNC junction targets are impossible. Accepted targets get `\??\` stripped (fs.c:302-304).
- **History**: 4a88b3b4 (2012); comment documents the rationale ("confusing for programs").
- **Bun disposition**: must-port. This rejection is also what makes `lstat` report volume mount points as plain directories rather than symlinks (cross-ref: STAT area uses the same helper). Target: engine

### [FSLNK-07] IO_REPARSE_TAG_APPEXECLINK: extract the 3rd NUL-separated string as the target

- **What Windows does**: Microsoft Store "app execution aliases" (python.exe, wsl.exe in `%LOCALAPPDATA%\Microsoft\WindowsApps`) are zero-byte files with tag 0x8000001B. Payload: `ULONG StringCount` + NUL-separated UTF-16 strings (package id, entry point, executable path, app type). They cannot be opened FILE_FLAG_OPEN_REPARSE_POINT-less by CreateProcess-naive code; spawning machinery needs the real exe path.
- **How libuv handles it**: fs.c:306-336: require `StringCount >= 3`, walk two `wcslen` hops, take string #3, require it to match `<letter>:\` absolute form; any violation → ERROR_SYMLINK_NOT_SUPPORTED. Result: `lstat`/`readlink` report these as symlinks to the real exe.
- **History**: e7ebae26 (#2812, 2020), motivated by nodejs/node#33024 (spawning `python` installed from the Store). Hardening note: the `wcslen` walk trusts NUL termination inside the 16 KB buffer and never checks against `ReparseDataLength`; a corrupt buffer could read uninitialized stack. Bun should bound the scan by `ReparseDataLength`.
- **Bun disposition**: must-port — required for `node:child_process` spawn paths and `which`-style resolution to work with Store-installed runtimes, not just readlink. Target: engine

### [FSLNK-08] Unknown reparse tags are "not a symlink", not an error blob

- **What Windows does**: The tag space is huge (OneDrive/Cloud Files 0x9000601A, Projected FS, dedup, HSM...). Files with these tags are ordinary files that happen to have reparse data.
- **How libuv handles it**: fs.c:338-342 sets ERROR_SYMLINK_NOT_SUPPORTED → UV_EINVAL for readlink; in unlink it's remapped to ERROR_ACCESS_DENIED (FSLNK-17); in stat the failure makes lstat fall back to treating the file as a regular file (cross-ref STAT, commits e5024c54 + 1d9c13f1).
- **History**: e5024c54 (#1419, 2017, "support unusual reparse points", nodejs/node#12737 — OneDrive placeholder files broke fs.stat); 1d9c13f1 (#1522) refined the stat fallback. The lesson: NEVER assume FILE_ATTRIBUTE_REPARSE_POINT == symlink.
- **Bun disposition**: must-port. OneDrive-synced folders are everywhere on consumer Windows; misclassifying cloud placeholders as symlinks breaks recursive copy/glob/watch. Target: engine

### [FSLNK-09] fs\_\_readlink opens with dwDesiredAccess=0 so locked files can still be readlink'd

- **What Windows does**: A zero-access open ("query metadata only") bypasses sharing-mode checks — it succeeds even when another process holds the file exclusively. FSCTL_GET_REPARSE_POINT works on such handles.
- **How libuv handles it**: `fs__readlink` (fs.c:2993-2999): `CreateFileW(path, 0, 0, ..., FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, ...)`. BACKUP_SEMANTICS is mandatory to open directories (junctions/dir-symlinks ARE directories); OPEN_REPARSE_POINT to not follow the link.
- **History**: stable since 2011-era; same pattern used by `fs__realpath` (fs.c:3075-3081).
- **Bun disposition**: must-port, exact flag triple. Target: engine

### [FSLNK-10] readlink on a non-reparse file: remap ERROR_NOT_A_REPARSE_POINT → EINVAL locally, not globally

- **What Windows does**: FSCTL_GET_REPARSE_POINT on a plain file fails with ERROR_NOT_A_REPARSE_POINT (0x1126), which has no obvious POSIX errno.
- **How libuv handles it**: The global error table deliberately does NOT map it (would conflict with other call sites — e.g. in `link` context it should be EPERM-ish); `fs__readlink` remaps it to UV_EINVAL at the call site (fs.c:3007-3011).
- **History**: 7fd7e826 (#3719, 2022) — before this, Node's `fs.readlink` on a regular file threw `UNKNOWN` instead of `EINVAL` on Windows. Commit message explicitly explains why the remap is local.
- **Bun disposition**: must-port. Bun's error mapping should produce EINVAL for readlink-on-non-link to match Node/POSIX. Target: engine

### [FSLNK-11] Reparse targets are WTF-8, not UTF-8, and the helper's error conventions are a trap

- **What Windows does**: NTFS filenames/symlink targets are arbitrary u16 sequences, including unpaired surrogates; real-world Windows paths contain them.
- **How libuv handles it**: All link targets and dirent names go through `uv_utf16_to_wtf8` (fs.c:345; idna.c:460) which encodes lone surrogates instead of erroring. Trap found here: `fs__readlink_handle` historically mixed conventions — most branches "SetLastError + return -1", but the WTF-8 tail returned a UV errno directly while callers report `GetLastError()`, so an allocation failure surfaced as a stale random Win32 error.
- **History**: 8f32a14a (#2970, WTF-8 switch, fixing #2048); d09441ca (#4092) fixed a WTF-8 decode bug (high-bits mask) that broke Node fs on some names (nodejs/node#48673); the convention mix is still present at upstream v1.52 and fixed only by local commit 2baf2df4 (this machine, June 2026).
- **Bun disposition**: must-port (WTF-8 everywhere; Bun already has WTF-8 string machinery). The meta-lesson is the bigger port: pick ONE error channel per helper. Target: engine

### [FSLNK-12] CreateSymbolicLinkW: always try SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE, retry without it on ERROR_INVALID_PARAMETER, cache the answer globally

- **What Windows does**: Win10 1703+ with Developer Mode enabled allows unelevated symlink creation IF flag 0x2 is passed; older Windows rejects the unknown flag with ERROR_INVALID_PARAMETER (not ERROR_INVALID_FLAGS).
- **How libuv handles it**: `static int uv__file_symlink_usermode_flag` initialized to the flag (fs.c:160); `fs__symlink` ORs it in (fs.c:963-966), and on ERROR_INVALID_PARAMETER clears the global and recurses once (fs.c:976-986). The cache is a plain non-atomic int written from threadpool threads — benign because it's monotonic (only ever cleared).
- **History**: 89d31932 (#1466, 2017, fixing #1157).
- **Bun disposition**: must-port the flag; the retry/cache leg is skip-eligible (reason: 1809 baseline always accepts the flag) BUT keep it anyway as a one-branch guard for Wine/ReactOS emulation layers that may reject it — should-port. Target: engine

### [FSLNK-13] Without Developer Mode, symlink creation fails ERROR_PRIVILEGE_NOT_HELD → EPERM; junctions are the privilege-free fallback

- **What Windows does**: SeCreateSymbolicLinkPrivilege is required unless Developer Mode is on. ERROR_PRIVILEGE_NOT_HELD (1314) is the typical failure for normal users. Junction creation needs no privilege at all.
- **How libuv handles it**: No fallback in libuv itself — error surfaces as UV_EPERM (error.c:159). Callers (Node's `fs.symlink` with `type:'junction'`, npm) choose junctions explicitly via `UV_FS_SYMLINK_JUNCTION`.
- **History**: code comment + error table; the ecosystem contract is documented in Node.
- **Bun disposition**: must-port the clean EPERM; Bun's package manager already prefers junctions on Windows — keep that policy at the caller layer, never auto-downgrade inside the syscall wrapper. Target: engine

### [FSLNK-14] Directory-ness of a symlink is baked in at creation; libuv does not autodetect

- **What Windows does**: File symlinks and directory symlinks are distinct (SYMBOLIC_LINK_FLAG_DIRECTORY). A file-symlink pointing at a directory does not traverse correctly in many APIs, and vice versa.
- **How libuv handles it**: `UV_FS_SYMLINK_DIR` → `SYMBOLIC_LINK_FLAG_DIRECTORY` (fs.c:2963-2964); no target sniffing. Historical bug: the original user-symlink commit applied the unprivileged flag only to the FILE branch, so unelevated dir-symlink creation kept failing until dcd9b3cb (#1706, Jan 2018) made both branches use `... | uv__file_symlink_usermode_flag`.
- **History**: 2df83172 (2012) introduced flags; 89d31932 + dcd9b3cb story above.
- **Bun disposition**: must-port (flag plumbed from `fs.symlink` `type`); apply unprivileged flag on BOTH branches. Target: engine

### [FSLNK-15] Junction creation is a hand-built REPARSE_DATA_BUFFER: mkdir, open GENERIC_WRITE, FSCTL_SET_REPARSE_POINT, rollback

- **What Windows does**: There is no CreateJunction API. You must create a directory, open it with write access + OPEN_REPARSE_POINT + BACKUP_SEMANTICS, and issue FSCTL_SET_REPARSE_POINT with a correctly sized IO_REPARSE_TAG_MOUNT_POINT buffer (SubstituteName + PrintName, two NULs, byte lengths excluding terminators, `ReparseDataLength = used - offsetof(MountPointReparseBuffer)`).
- **How libuv handles it**: `fs__create_junction` (fs.c:2778-2946). Buffer size computed pessimistically as `FIELD_OFFSET(...PathBuffer) + 4*sizeof(WCHAR) + 2*(target_len+2)*sizeof(WCHAR)` (fs.c:2808-2811). Rollback on any later failure: `RemoveDirectoryW(new_path)` only if `created` (fs.c:2943-2945), and crucially `CloseHandle` runs BEFORE RemoveDirectoryW (fs.c:2939-2941) — the dir was opened with share mode 0, so deleting while the handle is open would fail.
- **History**: 60af28ab (2012, based on piscisaureus's implementation).
- **Bun disposition**: must-port, including the ordering constraint and rollback. Target: engine

### [FSLNK-16] Junction handle must be GENERIC_WRITE, not GENERIC_ALL

- **What Windows does**: GENERIC_ALL requests rights (WRITE_DAC, WRITE_OWNER, DELETE...) that fail under restrictive ACLs / non-admin contexts even though FSCTL_SET_REPARSE_POINT only needs write access.
- **How libuv handles it**: fs.c:2903-2910 opens with GENERIC_WRITE.
- **History**: 3d73d556 (2014, fixes joyent/libuv#1385), commit cites ReactOS's mklink implementation and a Stack Overflow answer.
- **Bun disposition**: must-port (request minimum rights — same principle Bun should apply everywhere; AppContainer work on this machine hits exactly this class of failure). Target: engine

### [FSLNK-17] Junction targets: absolute only, slashes normalized, `\\?\` accepted, trailing-slash presence mirrors user input, bare drive gets `:\` in PrintName

- **What Windows does**: Mount-point SubstituteNames must be NT-absolute (`\??\C:\x`). Tools disagree about trailing backslashes: some (WSL, Go) choke on `\??\C:\x\`, but a drive-root junction MUST keep the slash (`\??\C:\`) or it doesn't resolve.
- **How libuv handles it**: fs.c:2791-2805 rejects relative targets (UV_EINVAL/ERROR_NOT_SUPPORTED) and detects `\\?\` (skipped before re-prefixing with `\??\`). The copy loops (fs.c:2831-2875) convert `/`→`\` and collapse runs via the `add_slash` deferred-emit trick; final `add_slash` state appends a trailing `\` to SubstituteName only if the user's path ended with one; PrintName additionally gets `\` when `len == 2` (bare `C:`).
- **History**: three-act story: original code ALWAYS appended `\` to SubstituteName; fbe2d85b (Oct 2024, #3329) removed it unconditionally because readlink round-trips grew slashes that other tools rejected; 8 days later 058c49b7 (#4590, refs #4582, Jameson Nash/Julia) re-added it conditionally because drive-root junctions broke. Match-user-input is the surviving compromise.
- **Bun disposition**: must-port exactly (including the `len == 2` print-name special case). Easy to get wrong; round-trip tests (`symlink('c:\\x\\', junction); readlink == input`) required. Target: engine

### [FSLNK-18] Hard links: CreateHardLinkW argument order is (new, existing)

- **What Windows does**: `CreateHardLinkW(lpFileName, lpExistingFileName)` — destination first, opposite of `link(2)`'s (existing, new) mental model.
- **How libuv handles it**: fs.c:2769-2775. ERROR_NOT_SAME_DEVICE → UV_EXDEV (error.c:167).
- **History**: 7edc29a4 (2012) — "Old and new path were accidentally reversed", a shipped regression.
- **Bun disposition**: must-port (with a test that the LINK and not the TARGET is created at newpath — the historical bug is exactly the test). Target: engine

### [FSLNK-19] unlink/rmdir open: DELETE | FILE_READ_ATTRIBUTES, share-everything, OPEN_REPARSE_POINT | BACKUP_SEMANTICS — and deliberately NOT FILE_WRITE_ATTRIBUTES

- **What Windows does**: Deletion via NtSetInformationFile requires only DELETE access. Requesting FILE_WRITE_ATTRIBUTES up front is harmless on real Windows but Wine (bug 50771) fails CreateFile outright on read-only files when WRITE_ATTRIBUTES is requested.
- **How libuv handles it**: fs.c:1144-1150 opens with the minimal mask. When the legacy fallback DOES need to clear the read-only attribute, it acquires write-attributes via `ReOpenFile(handle, FILE_WRITE_ATTRIBUTES, share-all, OPEN_REPARSE_POINT|BACKUP_SEMANTICS)` on demand and closes it immediately (fs.c:1225-1246).
- **History**: aa1beaa0 (2018) added FILE_WRITE_ATTRIBUTES to opens → reverted by 1954e9e3 after causing EPERM in Node (nodejs/node#20112); 6cf854c1 (#4833, Jul 2025, Keno Fischer/Julia) removed it again from the delete path and introduced the ReOpenFile dance for Wine. The same Wine problem still exists in fs\_\_fchmod (acknowledged in commit message).
- **Bun disposition**: must-port the minimal-rights open; should-port the ReOpenFile leg (Wine/Proton users run Bun; cost is one extra call on an already-slow fallback path). Target: engine

### [FSLNK-20] unlink of a directory: EPERM unless it's a _valid symlink-shaped_ reparse point

- **What Windows does**: NT can delete directories through the same disposition API as files, so a POSIX-correct unlink must refuse directories itself. Directory symlinks/junctions, however, are POSIX-unlinkable link objects.
- **How libuv handles it**: fs.c:1171-1193: if !isrmdir and FILE*ATTRIBUTE_DIRECTORY: no reparse bit → ERROR_ACCESS_DENIED (→EPERM, "as mandated by POSIX.1"); reparse bit → run `fs__readlink_handle(handle, NULL, NULL)` as a \_validator* and remap its ERROR_SYMLINK_NOT_SUPPORTED to ERROR_ACCESS_DENIED. So unlink deletes junctions/dir-symlinks/WSL-links but refuses mounted-volume reparse dirs and unknown-tag dirs.
- **History**: 7f6b86c6 (2012, "no longer allows deletion of non-symlink directory reparse points"); the validator inherits every tag rule from FSLNK-05..08 — adding LX_SYMLINK in 2026 silently fixed `unlink(wsl-symlink)` too.
- **Bun disposition**: must-port, including reusing one readlink validator so tag support can never diverge between readlink and unlink. Target: engine

### [FSLNK-21] rmdir on a non-directory returns ENOENT (sys errno ERROR_DIRECTORY), not ENOTDIR — frozen by back-compat

- **What Windows does**: n/a — this is libuv API surface.
- **How libuv handles it**: fs.c:1163-1169 with comment "TODO: change it to UV_NOTDIR in v2".
- **History**: pre-2024 `_wrmdir` returned ENOENT; 18266a69 (#4318) switched to ENOTDIR (POSIX-correct); 88b874e6 (#4563, two months later) reverted to ENOENT because the change broke Node tests — classified as a breaking change.
- **Bun disposition**: must-port the ENOENT behavior for `node:fs` compat (Node inherits libuv's quirk); document it. If Bun-native APIs want ENOTDIR, do it above the compat layer. Target: engine

### [FSLNK-22] Delete uses POSIX semantics first: FileDispositionInformationEx + DELETE | POSIX_SEMANTICS | IGNORE_READONLY_ATTRIBUTE

- **What Windows does**: Classic delete-on-close keeps the name visible in the directory until the last handle closes — so deleting a file someone has open, then rmdir'ing its parent, fails ENOTEMPTY (the rimraf race). NTFS on Win10 1607+ supports POSIX_SEMANTICS (name disappears immediately); IGNORE_READONLY_ATTRIBUTE (1809+/RS5) deletes read-only files without a separate attribute write.
- **How libuv handles it**: fs.c:1195-1203 issues `NtSetInformationFile(FileDispositionInformationEx)` with all three flags in one shot. Required info-class value (64) comes from libuv's own fully-enumerated FILE_INFORMATION_CLASS (winapi.h:4195-4261) because old SDKs lack it.
- **History**: 18266a69 (#4318, 2024, fixes #3839). Comment at fs.c:1207-1210 explains STATUS_CANNOT_DELETE now uniquely means "mapped view exists" (→EACCES) since readonly is already ignored.
- **Bun disposition**: must-port — this is the single biggest Windows-delete reliability lesson (Bun already does this in `bun.sys`; verify flag parity + the STATUS_CANNOT_DELETE interpretation). Target: engine

### [FSLNK-23] POSIX-delete fallback triggers on exactly three errors: ERROR_NOT_SUPPORTED, ERROR_INVALID_PARAMETER, ERROR_INVALID_FUNCTION

- **What Windows does**: Filesystems that don't implement FileDispositionInformationEx fail with different codes by era/FS: FAT32/exFAT/SMB → ERROR_NOT_SUPPORTED or ERROR_INVALID_PARAMETER; pre-1607 → ERROR_INVALID_FUNCTION; pre-Win10 → ERROR_INVALID_PARAMETER.
- **How libuv handles it**: fs.c:1211-1214 routes those three to the legacy path (manual readonly-clear + FileDispositionInformation); anything else is reported directly. Note ERROR_INVALID_FUNCTION must NOT leak to the user: the global table maps it to UV_EISDIR (error.c:168), which would be nonsense here.
- **History**: 18266a69; inline comments name each code's origin.
- **Bun disposition**: must-port all three triggers. ERROR_INVALID_FUNCTION/PARAMETER look "pre-Win10 only" but network filesystems and FUSE-likes (sshfs-win, Dokan) return the same codes on modern Windows — do not prune. Target: engine

### [FSLNK-24] Legacy readonly clear must OR in FILE_ATTRIBUTE_ARCHIVE because attributes==0 means "don't change"

- **What Windows does**: In FILE_BASIC_INFORMATION, a FileAttributes value of 0 is the "leave unchanged" sentinel. A file with ONLY the READONLY bit set, after clearing it, would produce 0 — i.e. a no-op — and the subsequent delete still fails.
- **How libuv handles it**: fs.c:1227-1228: `(attrs & ~READONLY) | FILE_ATTRIBUTE_ARCHIVE` guarantees non-zero. Side effect (accepted): on failure after this point the file is left readonly-cleared/archive-set; nothing restores attributes.
- **History**: 0db81a98 (2015, unlink readonly files, joyent/node#3006) introduced the clear; edf05b97 (#1774, 2018, "+R -A files") added the ARCHIVE trick after real-world files with archive cleared resurfaced the bug.
- **Bun disposition**: must-port (fallback path still reachable via FSLNK-23 FS list). The `|ARCHIVE` line is the kind of thing a rewrite silently drops. Target: engine

### [FSLNK-25] Delete stats the handle with GetFileInformationByHandleEx(FileBasicInfo), not GetFileInformationByHandle

- **What Windows does**: Legacy GetFileInformationByHandle issues two syscalls (it also queries volume info for the serial number); GetFileInformationByHandleEx(FileBasicInfo) is one syscall and returns exactly the attributes needed.
- **How libuv handles it**: fs.c:1157 (`FILE_BASIC_INFO`). Delete only needs FileAttributes.
- **History**: ada51318 (Dec 2025, "Optimize file/directory delete"), citing a blog measurement of the hidden second syscall.
- **Bun disposition**: must-port (free perf; Bun deletes a LOT in `bun install`). Target: engine

### [FSLNK-26] mkdir: CreateDirectoryW, mode ignored, ERROR_INVALID_NAME and ERROR_DIRECTORY remapped to EINVAL

- **What Windows does**: CreateDirectoryW("foo?<>") fails ERROR_INVALID_NAME; some malformed paths (trailing-dot variants, empty components) fail ERROR_DIRECTORY ("The directory name is invalid"). libuv's default table maps both to ENOENT, which misleads callers into mkdir -p recursion.
- **How libuv handles it**: fs.c:1285-1295: success → 0; else remap those two sys errnos to UV*EINVAL while preserving `sys_errno*`. POSIX mode is ignored entirely (TODO comment).
- **History**: ecff2785 (#2375, nodejs/node#28599) added INVALID*NAME; dd8662b6 (#2601, nodejs/node#31177, "really return UV_EINVAL") added ERROR_DIRECTORY; 509214d6 switched \_wmkdir→CreateDirectoryW. Note the asymmetry: ill-formed WTF-8 in the \_path conversion* still returns ENOENT (fs\_\_capture_path → ERROR_INVALID_NAME through the table, fs.c:364-366) — only mkdir's own failure is remapped.
- **Bun disposition**: must-port the remap (Node's `fs.mkdir` EINVAL behavior on bad names; recursive mkdir must distinguish "missing parent" from "name can never exist"). Target: engine

### [FSLNK-27] mkdtemp/mkstemp: OpenBSD algorithm — 6 X's, 62-char alphabet, CSPRNG per attempt, TMP_MAX retries

- **What Windows does**: No native mkdtemp/mkstemp; naive impls use rand() and are predictable/collide under concurrency.
- **How libuv handles it**: `fs__mktemp` (fs.c:1300-1345, "OpenBSD original" comment): validate template ends in `XXXXXX` else UV_EINVAL; per attempt draw a uint64 from `uv__random_winrandom`, fill 6 chars via repeated `% 62`; loop `tries = TMP_MAX` (INT_MAX on MSVC ucrt) while the create function reports "exists".
- **History**: a669f21b (2014) replaced `_wmktemp_s` with the OpenBSD port; 9b2c9b6c simplified.
- **Bun disposition**: must-port semantics (Node contract); Bun's `sys/tmp.rs` should mirror: template validation → EINVAL, CSPRNG, bounded retry. Target: engine

### [FSLNK-28] Entropy source: ProcessPrng from bcryptprimitives.dll, falling back to RtlGenRandom (SystemFunction036)

- **What Windows does**: ProcessPrng (documented-ish, used by Chromium/Rust std) is the cheapest CSPRNG; bcryptprimitives.dll may be absent in exotic environments. RtlGenRandom is the advapi32 legacy alias SystemFunction036.
- **How libuv handles it**: winapi.c:143-151 `LoadLibraryExA("bcryptprimitives.dll", NULL, LOAD_LIBRARY_SEARCH_SYSTEM32)` + GetProcAddress at init; util.c:1741-1752 tries pProcessPrng then SystemFunction036; failure → UV_EIO (surfaced by mktemp as EIO, fs.c:1321-1323).
- **History**: 7484ab25 (#4836, Jul 2025) — followed Rust std's migration rationale (linked in commit).
- **Bun disposition**: should-port (Bun likely already has a CSPRNG; ensure it's ProcessPrng-or-RtlGenRandom with LOAD_LIBRARY_SEARCH_SYSTEM32 — never a plain LoadLibrary, that's a planting vector). Target: engine

### [FSLNK-29] mktemp writes the winning name back into the narrow path via wcstombs and clobbers path[0] on failure

- **What Windows does**: n/a — API contract.
- **How libuv handles it**: The template is converted to UTF-16 for syscalls; on success the 6 generated chars (ASCII by construction) are back-patched into the user-visible narrow `req->path` (fs.c:1332-1336). On ANY failure `path[0] = '\0'` (fs.c:1343-1344). mkdtemp/mkstemp always pass copy_path=TRUE (fs.c:3398, 3415) so the narrow buffer is libuv-owned even in sync mode.
- **History**: e208100f (#2938) — AIX `mkstemp` clobbers the template on EINVAL; libuv standardized "empty string on all errors" across platforms to kill the portability hazard (refs nodejs/node#33549).
- **Bun disposition**: must-port the contract (empty/zeroed result on failure, never half-generated garbage); the wcstombs trick is implementation detail — Bun should regenerate from the wide name. Target: engine

### [FSLNK-30] mkdtemp retries only on ERROR_ALREADY_EXISTS; mkstemp only on ERROR_FILE_EXISTS; everything else aborts the loop

- **What Windows does**: CreateDirectoryW signals collision as ERROR_ALREADY_EXISTS; CreateFileW(CREATE_NEW) as ERROR_FILE_EXISTS. Retrying on other errors (EACCES on a bad parent) would spin TMP_MAX times.
- **How libuv handles it**: fs**mkdtemp_func fs.c:1348-1361; fs**mkstemp_func fs.c:1369-1414. Func returns 1 to stop (success or hard error), 0 to retry.
- **History**: 5500253c (#2557) for mkstemp.
- **Bun disposition**: must-port (retry-on-exact-collision-error-only). Target: engine

### [FSLNK-31] mkstemp: CREATE_NEW + share-all, then \_open_osfhandle whose EMFILE failure leaves GetLastError()==0

- **What Windows does**: CREATE_NEW is the atomic O_CREAT|O_EXCL. The CRT's `_open_osfhandle` can fail when the CRT fd table is full; it sets errno=EMFILE but does NOT set a Win32 last error.
- **How libuv handles it**: fs.c:1373-1409: GENERIC_READ|WRITE, FILE_SHARE_READ|WRITE|DELETE, CREATE_NEW; on `_open_osfhandle` < 0, check `errno == EMFILE` first, then GetLastError(), else UV_UNKNOWN; CloseHandle on every failure leg. Flags arg 0 → CRT fd is binary-mode (CRT only sets FTEXT if \_O_TEXT explicitly passed to \_open_osfhandle).
- **History**: 20e774c6/faf2c593 (2012, "\_open_osfhandle() failure correctly"); 12c93608 (handle leak on EMFILE).
- **Bun disposition**: skip the CRT-fd parts (Bun's fd model is HANDLE-based, not CRT) but must-port CREATE_NEW + share-all semantics and the leak-free error legs. Target: engine

### [FSLNK-32] scandir uses NtQueryDirectoryFile with an 8 KB 8-byte-aligned stack buffer sized for at least one max-length entry

- **What Windows does**: NtQueryDirectoryFile writes FILE_DIRECTORY_INFORMATION records with LONGLONG members — MSDN requires 8-byte buffer alignment (misalignment faults on some FS drivers); a buffer too small for ONE entry can't make progress; names are ≤255 chars.
- **How libuv handles it**: fs.c:1434-1447: `__declspec(align(8))`/`__attribute__((aligned(8))) char buffer[8192]` + `STATIC_ASSERT(sizeof buffer >= sizeof(FILE_DIRECTORY_INFORMATION) + 256*sizeof(WCHAR))`. Handle opened FILE_LIST_DIRECTORY|SYNCHRONIZE (SYNCHRONIZE needed for the implicit kernel wait on a sync handle) + BACKUP_SEMANTICS (fs.c:1450-1457). First call RestartScan=TRUE, subsequent FALSE (fs.c:1462-1472, 1561-1571).
- **History**: 0729ce8b (#105, 2015) — the rewrite away from FindFirstFile for performance; 70bbfa0e (#398) fixed the align(8) attribute spelling for MinGW (#190).
- **Bun disposition**: must-port (Bun's readdir should already be NtQueryDirectoryFile-based; verify alignment + min-size assert + SYNCHRONIZE). Consider FileIdBothDirectoryInformation if Bun wants inode numbers in the same pass. Target: engine

### [FSLNK-33] SharePoint/WebDAV drives report "." and ".." with trailing NUL included in FileNameLength

- **What Windows does**: The SharePoint redirector returns `".\0"` and `"..\0"` — FileNameLength counts the terminator, so naive `len==1 && name[0]=='.'` checks miss them and callers see literal dot entries.
- **How libuv handles it**: fs.c:1502-1515: strip ALL trailing L'\0' first (`while` loop, not `if`), then skip empty / "." / ".." by length+content.
- **History**: d03abfd4 (#636, 2015, fixes nodejs/node#4002).
- **Bun disposition**: must-port (strip-then-compare; cheap, and network redirectors are a long tail Bun cannot test exhaustively). Target: engine

### [FSLNK-34] After the first batch, STATUS_SUCCESS with iosb.Information == 0 must be treated as an error (infinite-loop guard)

- **What Windows does**: Some filesystems return STATUS_SUCCESS from a continuation NtQueryDirectoryFile call even when zero bytes were written (instead of STATUS_BUFFER_OVERFLOW/STATUS_NO_MORE_FILES) — looping on status alone never terminates.
- **How libuv handles it**: fs.c:1573-1578: `if (status == STATUS_SUCCESS && iosb.Information == 0) status = STATUS_BUFFER_OVERFLOW;` then the loop exits and reports via `pRtlNtStatusToDosError`.
- **History**: present since 0729ce8b (2015); comment-only documentation.
- **Bun disposition**: must-port (the kind of guard nobody rediscovers until a hang in production on some NAS). Target: engine

### [FSLNK-35] scandir on a file: CreateFileW succeeds, NtQueryDirectoryFile fails STATUS_INVALID_PARAMETER → UV_ENOTDIR

- **What Windows does**: Opening a regular file with FILE_LIST_DIRECTORY succeeds (the right is meaningless there); the directory query then fails with the generic STATUS_INVALID_PARAMETER, which maps to EINVAL by default — wrong errno for POSIX scandir.
- **How libuv handles it**: fs.c:1474-1478: first-call STATUS_INVALID_PARAMETER is special-cased to UV_ENOTDIR (sys errno ERROR_DIRECTORY). Only the FIRST call — later INVALID_PARAMETER would be a different bug and goes to nt_error.
- **History**: 0729ce8b.
- **Bun disposition**: must-port (Node expects ENOTDIR from `fs.readdir(file)`). Target: engine

### [FSLNK-36] dirent d_type derivation: check DEVICE, then REPARSE_POINT, then DIRECTORY — order is load-bearing

- **What Windows does**: A directory symlink/junction has BOTH FILE_ATTRIBUTE_DIRECTORY and FILE_ATTRIBUTE_REPARSE_POINT set. Checking DIRECTORY first misreports links as directories, breaking recursive walkers (they descend into / delete through links).
- **How libuv handles it**: scandir fs.c:1549-1557 and readdir fs.c:1736-1743, both: DEVICE→UV**DT_CHAR, REPARSE_POINT→UV**DT*LINK, DIRECTORY→UV**DT_DIR, else UV**DT_FILE. Caveat inherited from FSLNK-08: REPARSE_POINT here includes OneDrive placeholders etc., so DT_LINK from dirents is \_unreliable* — confirm with lstat before acting on it.
- **History**: pre-2015 scandir had DIRECTORY first (wrong); 0729ce8b fixed scandir; fs\_\_readdir (added 99440bb6, 2019) re-introduced the wrong order and was only fixed Oct 2024 (1cbffcbd) — a 5-year sync/async-twin divergence.
- **Bun disposition**: must-port with ONE shared classifier for every directory-iteration path (the twin-divergence is the lesson). Document the DT_LINK-overreports-cloud-placeholders caveat. Target: engine

### [FSLNK-37] scandir results are unsorted filesystem order and "." / ".." are filtered; the flags argument is dead

- **What Windows does**: NTFS enumerates in $I30 B-tree order (upcase-table-sorted), FAT in directory-slot order — neither is POSIX `alphasort`.
- **How libuv handles it**: No sort; dot entries skipped (fs.c:1511-1515); the public `flags` parameter is stored and never read (fs.c:3450). Dirents are heap-allocated flexible-array structs filled with WTF-8 (fs.c:1534-1547), array grows by doubling from 32 (fs.c:1521-1532), consumed via `uv_fs_scandir_next` with deferred per-entry free (uv-common.c).
- **History**: 03e53f1c renamed readdir→scandir (2014); Node documents order as platform-dependent.
- **Bun disposition**: must-port the unsorted+filtered contract (Node never sorts on Windows); skip the flags param (dead in libuv too). Target: engine

### [FSLNK-38] fs\_\_opendir pre-checks GetFileAttributesW for ENOTDIR, and INVALID_FILE_ATTRIBUTES sneaks past by design

- **What Windows does**: `GetFileAttributesW` returns INVALID_FILE_ATTRIBUTES (0xFFFFFFFF — all bits set, including FILE_ATTRIBUTE_DIRECTORY) on failure.
- **How libuv handles it**: fs.c:1635-1638: `if (!(GetFileAttributesW(pathw) & FILE_ATTRIBUTE_DIRECTORY)) → UV_ENOTDIR`. A nonexistent path passes this check (all-bits value has the dir bit) and the real ENOENT/EPATHNOTFOUND surfaces from FindFirstFileW instead — accidental-looking but correct error precedence: files get ENOTDIR, missing paths get ENOENT.
- **History**: 99440bb6 (#2057, 2019).
- **Bun disposition**: should-port the error-precedence outcome (ENOTDIR for files, ENOENT for missing) but implement it honestly — branch on INVALID_FILE_ATTRIBUTES explicitly rather than relying on the all-bits pun. Target: engine

### [FSLNK-39] opendir wildcard construction: "" → "./_", trailing slash → append "_", else append "\*"

- **What Windows does**: FindFirstFileW takes a _pattern_, not a directory; you must append the wildcard yourself, and double separators or missing separators both break matching.
- **How libuv handles it**: fs.c:1646-1661: three-way format choice on emptiness/trailing-IS_SLASH (either separator), `_snwprintf` into a len+4 buffer.
- **History**: c6ecf97a (use \_snwprintf, 2012-era); pattern logic stable since.
- **Bun disposition**: skip if Bun's opendir uses NtQueryDirectoryFile on a real handle (recommended — avoids the entire pattern-escaping class, matches FSLNK-32); must-port only if FindFirstFile is retained anywhere. Target: engine

### [FSLNK-40] sshfs-win: FindFirstFileW on an EMPTY directory fails ERROR_FILE_NOT_FOUND — that's success-with-zero-entries

- **What Windows does**: Real local filesystems always yield "." and ".." so FindFirstFileW on a directory never returns FILE_NOT_FOUND, but MSDN permits it and sshfs-win (WinFsp) actually does it for empty dirs.
- **How libuv handles it**: fs**opendir tolerates it: only errors if `GetLastError() != ERROR_FILE_NOT_FOUND`, leaving `dir->dir_handle = INVALID_HANDLE_VALUE` (fs.c:1665-1669). fs**readdir returns 0 entries for that state (fs.c:1696-1708). fs\_\_closedir calls FindClose on the invalid handle and ignores the result (fs.c:1761-1768).
- **History**: d7dda9ed (#4953, Dec 2025, fixes #4952; Ben Noordhuis: "I can't get FindFirstFile to work like that on regular file systems but ... MSDN clearly states it's possible").
- **Bun disposition**: should-port (network-FS edge; Bun users mount sshfs/WinFsp drives). See FSLNK-41 for the upstream landmine. Target: engine

### [FSLNK-41] UPSTREAM BUG: the sshfs-win fix is unreachable — uv_fs_readdir's entry guard still EINVALs on INVALID_HANDLE_VALUE

- **What Windows does**: n/a — libuv-internal inconsistency.
- **How libuv handles it**: `uv_fs_readdir` (fs.c:3475-3480) rejects `dir->dir_handle == INVALID_HANDLE_VALUE` with UV*EINVAL \_before* posting the work item, so the empty-result path added in fs**readdir (FSLNK-40) can never run through the public API. Verified present at upstream v1.x tip (June 2026): the guard predates the fix (99440bb6) and d7dda9ed only touched fs**readdir (15 insertions, single hunk).
- **History**: discovered during this audit by diffing d7dda9ed against the public entry point; #4952 is therefore only half-fixed upstream.
- **Bun disposition**: must-port the _lesson_, not the bug: Bun's opendir must represent "open but empty" as a first-class state validated consistently at every layer (or avoid the sentinel entirely by using a real directory handle per FSLNK-32/39). Also: candidate upstream patch. Target: engine

### [FSLNK-42] FindFirstFileW pre-fetches the first entry: the need_find_call latch

- **What Windows does**: FindFirstFileW both opens the iterator AND returns entry #1; FindNextFileW returns subsequent entries; end is ERROR_NO_MORE_FILES.
- **How libuv handles it**: `dir->need_find_call = FALSE` at opendir (fs.c:1671); fs\_\_readdir consumes the buffered `find_data` first, sets need_find_call=TRUE after each consumed entry including skipped dot entries (fs.c:1713-1748); ERROR_NO_MORE_FILES breaks cleanly, other FindNextFileW failures error out with per-entry name cleanup (fs.c:1753-1759).
- **History**: 99440bb6.
- **Bun disposition**: skip if NtQueryDirectoryFile path chosen (no prefetch asymmetry there); otherwise must-port the latch — off-by-one entry loss/duplication is the classic FindFirstFile porting bug. Target: engine

### [FSLNK-43] copyfile: UV_FS_COPYFILE_EXCL maps to CopyFileW bFailIfExists; FICLONE is silently ignored; FICLONE_FORCE is ENOSYS up front

- **What Windows does**: CopyFileW's third arg is "fail if exists" (matches EXCL directly). Windows has no generic CoW clone via CopyFileW; ReFS/Dev Drive support block cloning only via FSCTL_DUPLICATE_EXTENTS_TO_FILE, which libuv never wired up.
- **How libuv handles it**: fs.c:2448-2466: FICLONE_FORCE → UV_ENOSYS/ERROR_NOT_SUPPORTED before any I/O; plain FICLONE proceeds as a normal copy (documented contract: "if not supported, fall back"); invalid flag bits rejected UV_EINVAL at the public entry (fs.c:3686-3691).
- **History**: 766d7e9c (2017 basic impl); db918361 + 3ae88200 (FICLONE/FORCE, 2018); 8a95c6b5 (flag validation).
- **Bun disposition**: must-port the flag semantics for `fs.copyFile` compat. Improvement opportunity beyond libuv: Bun could attempt FSCTL_DUPLICATE_EXTENTS_TO_FILE on Dev Drive/ReFS before CopyFileW (Dev Drives are increasingly standard dev setups). Target: engine

### [FSLNK-44] copyfile EBUSY softening: ERROR_SHARING_VIOLATION + same st_dev/st_ino ⇒ success no-op

- **What Windows does**: CopyFileW(src, src) (or hardlinked aliases of the same file) fails ERROR_SHARING_VIOLATION because the source is open for reading while the destination open is attempted.
- **How libuv handles it**: fs.c:2468-2481: only when the translated error is UV_EBUSY, stat BOTH paths (follow links, `fs__stat_impl_from_path(path, 0, ...)`); if dev+ino match, overwrite result with success. Stat failures leave the original EBUSY in place.
- **History**: 0b29acb0 (#2298, 2019, partial fix for #2237; unix got the same-file check the same day for a sendfile infinite loop, nodejs/node#27746). Cross-ref STAT: 82cdfb75 (2025) fixed st_dev to consistently use the 32-bit LowPart of the volume serial — before that, fast-path vs slow-path stat could disagree on st_dev and break exactly this comparison.
- **Bun disposition**: must-port (Node's `fs.copyFile(a, a)` succeeds; also prevents user-visible EBUSY when copying through different path spellings of one file). Use file IDs from one consistent source. Target: engine

### [FSLNK-45] sendfile is a CRT \_read/\_write loop with a 64 KB buffer — and an explicit seek that moves the source fd

- **What Windows does**: No sendfile syscall for file→file; TransmitFile is socket-only.
- **How libuv handles it**: fs.c:2485-2529: malloc(min(length, 65536)) — malloc failure is uv_fatal_error (process abort!); `offset != -1` → `_lseeki64(fd_in, offset, SEEK_SET)` which PERMANENTLY moves fd_in's position (Linux sendfile with an offset pointer does not); loop `_read`→`_write`, `n==0` is EOF break, result accumulates bytes written. CRT translation-mode hazard: fds from uv_fs_open/\_open_osfhandle are binary, but an app-supplied \_O_TEXT fd would CRLF-translate and corrupt.
- **History**: 7570a35b (2013, buffer leak fix); fca18c33 (EOF handling); fa0ac9ec (#5076, Mar 2026) capped `length` at UV\_\_IO_MAX_BYTES = 0x7ffff000 at the public entry (fs.c:3710-3711) because the int accumulator silently broke >2 GB transfers — Julia hit this in production; PR sat for a decade.
- **Bun disposition**: skip the CRT loop (Bun has native copy paths and doesn't expose uv sendfile); must-port the two lessons wherever Bun loops read/write: cap per-op sizes below i32 wraparound (0x7ffff000 mirrors Linux MAX_RW_COUNT) and never abort on allocation failure in a syscall shim. Target: engine

### [FSLNK-46] Win32→errno table choices this area depends on: ACCESS_DENIED→EPERM, SHARING_VIOLATION→EBUSY, SYMLINK_NOT_SUPPORTED→EINVAL, DIRECTORY/INVALID_NAME→ENOENT, NOT_SAME_DEVICE→EXDEV, CANT_RESOLVE_FILENAME→ELOOP

- **What Windows does**: Win32 errors don't partition like errno; several POSIX-visible behaviors in this file are produced by the table, not the code.
- **How libuv handles it**: error.c:86-168. Notable: ERROR_ACCESS_DENIED → UV_EPERM (NOT EACCES — Node tests depend on EPERM from unlink-a-directory); ERROR_DIRECTORY → ENOENT (feeds FSLNK-21); ERROR_INVALID_NAME → ENOENT (so invalid chars in most ops are ENOENT, except mkdir's local EINVAL remap, FSLNK-26); ERROR_CANT_RESOLVE_FILENAME → ELOOP (symlink cycles from CreateFileW); ERROR_INVALID_FUNCTION → EISDIR (surprising; why FSLNK-23 must intercept it).
- **History**: 6c80bf34 (2011) onward; each entry added when a caller hit it.
- **Bun disposition**: must-port the exact mappings used by this area (Bun's `uv_translate_sys_error` equivalent must match Node-observable errnos byte-for-byte). Target: engine

### [FSLNK-47] All paths cross the API boundary as WTF-8 and are converted once up front; conversion failure is ERROR_INVALID_NAME

- **What Windows does**: n/a — libuv architecture, but it's what makes lone-surrogate filenames survive scandir→open→unlink round trips.
- **How libuv handles it**: `fs__capture_path` (fs.c:349-423): one allocation holds UTF-16 path + UTF-16 new_path + optional narrow copy; `uv_wtf8_length_as_utf16` < 0 → ERROR_INVALID_NAME (→ENOENT). copy_path=TRUE only for async (cb!=NULL) — except mktemp family which always copies (FSLNK-29). No `\\?\` auto-prefixing: long-path support comes from the embedder's `longPathAware` manifest (uv_win_longpath.manifest ships in-repo).
- **History**: 8f32a14a (#2970).
- **Bun disposition**: must-port conceptually: Bun = WTF-8 strings + manifest-based long paths (Bun already embeds a longPathAware manifest; verify) + reject ill-formed input early with a deterministic errno. Cross-ref: STRINGS/PATHS area. Target: engine

### [FSLNK-48] Dynamic NT API resolution: ntdll functions fetched once at init, fatal if missing; optional APIs null-checked per call

- **What Windows does**: NtQueryDirectoryFile/NtSetInformationFile/RtlNtStatusToDosError aren't in import libs historically; GetFileInformationByName (fast stat) only exists in api-ms-win-core-file-l2-1-4.dll on Win11+; ProcessPrng only in bcryptprimitives.dll.
- **How libuv handles it**: winapi.c uv**winapi_init: GetModuleHandleW("ntdll.dll") + GetProcAddress, `uv_fatal_error` if core ones missing; optional ones (pGetFileInformationByName, pProcessPrng) stay NULL and callers branch (e.g. fs**stat_path returns TRY_SLOW). This area consumes pNtQueryDirectoryFile (scandir), pNtSetInformationFile (delete), pRtlNtStatusToDosError (every NTSTATUS), pProcessPrng (mktemp).
- **History**: a7493d8a (2017) removed the last _kernel32_ dynamic imports — ntdll ones remain by design.
- **Bun disposition**: must-port pattern: direct ntdll linking is fine for Bun (windows-sys crates declare them), but optional-API probing (GetFileInformationByName, ProcessPrng) must remain runtime GetProcAddress with NULL fallbacks on 1809 baseline. Target: engine

### [FSLNK-49] rmdir/unlink of a junction or dir-symlink removes the link object, never the target

- **What Windows does**: With FILE_FLAG_OPEN_REPARSE_POINT the handle refers to the reparse point itself; setting the delete disposition removes the link directory. Without the flag you'd open (and potentially delete inside) the target.
- **How libuv handles it**: The single open in fs\_\_unlink_rmdir always passes OPEN_REPARSE_POINT (fs.c:1149), so `rmdir(junction)` deletes the junction (matching RemoveDirectoryW semantics and npm/rimraf expectations) and `unlink(dir-symlink)` deletes the link (after FSLNK-20 validation). Note asymmetry vs POSIX: on Linux `rmdir(symlink-to-dir)` fails ENOTDIR; on Windows-libuv it succeeds because junctions/dir-symlinks genuinely are directories.
- **History**: behavior locked in by 7f6b86c6 + 18266a69; Node's `fs.rmdir` on junctions relies on it.
- **Bun disposition**: must-port (bun install's linker cleanup depends on delete-the-link-not-the-target; a miss here deletes user node_modules contents through links). Add the negative test: target contents intact after deleting the link. Target: engine

### [FSLNK-50] The reparse-tag validator double-duties as the delete gate — error-channel discipline matters

- **What Windows does**: n/a — design coupling worth recording.
- **How libuv handles it**: `fs__readlink_handle(handle, NULL, NULL)` is called with null out-params purely for its yes/no verdict in fs**unlink_rmdir (fs.c:1185) and in stat (fs**stat_handle, cross-ref). Its contract — "sets Win32 last error, returns -1" — is what lets unlink remap ERROR_SYMLINK_NOT_SUPPORTED→ERROR_ACCESS_DENIED (fs.c:1186-1188). When the LX_SYMLINK branch broke that contract (returned UV_ENOMEM directly), the bug surfaced in THREE callers at once.
- **History**: see FSLNK-11; validator usage since 7f6b86c6.
- **Bun disposition**: must-port the design: one tag-classifier used by readlink, lstat, and delete, returning a typed enum (Symlink/Junction/AppExecLink/LxSymlink/NotALink/UnknownTag) instead of an error-channel pun. Target: engine
