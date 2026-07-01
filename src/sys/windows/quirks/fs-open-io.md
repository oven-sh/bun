# libuv Windows institutional knowledge — fs-open-io

Sources: `C:/Users/dylan/code/libuv-read/src/win/fs.c` (open/close/read/write/seek, POST, fs__capture_path), `src/win/fs-fd-hash-inl.h`, `src/win/error.c` (write-path override), plus the CRT-suppression infrastructure these depend on (`src/win/core.c`, `src/win/handle-inl.h`, `src/win/internal.h`) and `src/idna.c` (WTF-8 helpers used by fs__capture_path). Line refs are into that worktree at HEAD (439a54be). Behavioral matrix cross-checked against `test/test-fs-open-flags.c`.

---

## A. open(): CreateFile flag/share/disposition mapping

### [FSIO-01] Open with all three share modes or files can't be deleted/renamed while open
- **What Windows does**: CRT `_open()` opens files with restrictive sharing, so a file held open by one process cannot be deleted, renamed, or reopened for write by anyone else — completely unlike POSIX. Sharing is decided at open time and is per-handle, not per-operation.
- **How libuv handles it**: Bypasses the CRT and calls `CreateFileW` directly with `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE` unconditionally (fs.c:499-513), with an explicit comment that this deviates from the CRT "to match UNIX semantics" so files can be deleted while open.
- **History**: e1af07e8 (2011) "Open files with sharing enabled. Fixes node's issue #1449" — the commit that replaced `_open()` with CreateFileW entirely. The original version even reached into the CRT's private `_umaskval` global.
- **Bun disposition**: must-port. Any Windows open path that forgets FILE_SHARE_DELETE breaks `rm` of open files, `tmp` cleanup, watch-mode rebuilds. Target: engine

### [FSIO-02] UV_FS_O_EXLOCK = share mode 0, kept for raw block devices
- **What Windows does**: Writing past the master boot record of a raw block device (`\\.\PhysicalDriveN`) is blocked by Windows unless the volume is opened with exclusive access (share mode 0). Share mode 0 is also the only "mandatory lock" primitive at open time.
- **How libuv handles it**: `UV_FS_O_EXLOCK` (0x10000000, win.h:692) maps to `share = 0` (fs.c:509-511). Docs note EXLOCK is only supported on macOS and Windows; on Windows it is mandatory (deny-all) rather than BSD's advisory flock.
- **History**: 1c4de191 "win: map UV_FS_O_EXLOCK to a share mode of 0", fixes libuv#1605 (Etcher/balena needed to flash raw devices through node).
- **Bun disposition**: should-port. Niche (raw devices, "open exclusively" semantics), but it is the only escape hatch from FSIO-01's always-share default, and node exposes `fs.constants.O_EXLOCK` consumers. Target: engine

### [FSIO-03] Use FILE_GENERIC_*, and O_APPEND = (access & ~FILE_WRITE_DATA) | FILE_APPEND_DATA
- **What Windows does**: Kernel-enforced atomic append exists only as an access right: a handle with `FILE_APPEND_DATA` but *without* `FILE_WRITE_DATA` appends atomically at EOF regardless of file pointer or supplied offset. `GENERIC_WRITE` cannot express this — you need the decomposed `FILE_GENERIC_WRITE` rights so individual bits can be subtracted.
- **How libuv handles it**: Access is built from `FILE_GENERIC_READ`/`FILE_GENERIC_WRITE` (not `GENERIC_*`), then O_APPEND strips `FILE_WRITE_DATA` and adds `FILE_APPEND_DATA` (fs.c:480-497). Consequence: ftruncate on an append-mode fd fails (no WRITE_DATA), matching nothing in POSIX but accepted for the atomic-append guarantee.
- **History**: fe97c4dc (2011) "windows: honor O_APPEND in uv_fs_open" — the same commit switched GENERIC_* to FILE_GENERIC_* specifically to enable the bit-subtraction.
- **Bun disposition**: must-port. Emulating append with seek+write is racy across processes; this is the only correct mapping. Target: engine

### [FSIO-04] O_DIRECT (FILE_FLAG_NO_BUFFERING) is incompatible with FILE_APPEND_DATA
- **What Windows does**: `FILE_FLAG_NO_BUFFERING` + `FILE_APPEND_DATA` in DesiredAccess makes CreateFile fail with ERROR_INVALID_PARAMETER (87). Not documented for CreateFile — only indirectly under NtCreateFile's `FILE_NO_INTERMEDIATE_BUFFERING`. Since FILE_GENERIC_WRITE *contains* FILE_APPEND_DATA, naive O_DIRECT|O_WRONLY breaks.
- **How libuv handles it**: With O_DIRECT: if access has FILE_APPEND_DATA and also FILE_WRITE_DATA, drop FILE_APPEND_DATA (appends still permitted via WRITE_DATA, just not atomic); if FILE_APPEND_DATA is the *sole* write right (O_APPEND|O_DIRECT), fail EINVAL (fs.c:567-596, long comment block).
- **History**: 7a2c889f "win: fs: fix FILE_FLAG_NO_BUFFERING for writes" (PR #2102) — commit message documents the undocumented incompatibility with the NtCreateFile citation.
- **Bun disposition**: must-port. O_DIRECT writes simply fail to open without this. Note Bun must also decide: O_DIRECT|O_APPEND = EINVAL (libuv's choice) vs silently dropping append atomicity. Target: engine

### [FSIO-05] Disposition table covers all 8 CREAT/EXCL/TRUNC combos, including POSIX-undefined ones
- **What Windows does**: CreateFile has five dispositions that do not line up 1:1 with POSIX flag combos; some POSIX combinations (O_EXCL without O_CREAT, O_TRUNC|O_EXCL) are "undefined" in POSIX and must be pinned to something.
- **How libuv handles it**: Explicit switch (fs.c:515-536): `0`/`EXCL`→OPEN_EXISTING, `CREAT`→OPEN_ALWAYS, `CREAT|EXCL` and `CREAT|TRUNC|EXCL`→CREATE_NEW, `TRUNC` and `TRUNC|EXCL`→TRUNCATE_EXISTING, `CREAT|TRUNC`→CREATE_ALWAYS, default→EINVAL. Note TRUNCATE_EXISTING requires write access. ERRATUM (probed at implementation, Win11 26200): kernelbase validates TRUNCATE_EXISTING against the literal GENERIC_WRITE meta-bit pre-path-resolution, and libuv passes decomposed FILE_GENERIC_WRITE — so bare O_TRUNC (any rw mode, file existing or not) fails ERROR_INVALID_PARAMETER (87), not the ACCESS_DENIED this entry originally claimed. Identical call → identical 87 in stock libuv (latent upstream wart; node fs `w`-family uses CREAT|TRUNC→CREATE_ALWAYS and is unaffected); engine keeps exact parity (never-widen, FSIO-11), pinned by the open_flags_matrix bare-TRUNC cells.
- **History**: e1af07e8 introduced the table; unchanged since 2011 apart from style.
- **Bun disposition**: must-port (verbatim table). Target: engine

### [FSIO-06] ERROR_FILE_EXISTS after O_CREAT means "it was a directory" → rewrite to EISDIR
- **What Windows does**: Undocumented: `CreateFileW(dir, ..., CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL|...)` on an existing *directory* fails with ERROR_FILE_EXISTS (not ERROR_ACCESS_DENIED). The generic mapping of ERROR_FILE_EXISTS is EEXIST, which is wrong for POSIX `open(dir, O_CREAT|O_TRUNC)` = EISDIR.
- **How libuv handles it**: After CreateFileW failure: if error==ERROR_FILE_EXISTS && (flags & O_CREAT) && !(flags & O_EXCL), report UV_EISDIR with the raw error preserved in sys_errno (fs.c:619-630). With O_EXCL the rewrite is skipped so `wx` on a directory correctly yields EEXIST (CREATE_NEW path).
- **History**: 6c80bf34 (2012) "Clean up error handling in win/fs.c". Verified by test-fs-open-flags.c:324,343 (`w`,`w+` on dir → EISDIR) vs :333,352 (`wx` → EEXIST).
- **Bun disposition**: must-port. node's `fs.open(dir, "w")` EISDIR depends on it. Target: engine

### [FSIO-07] FILE_FLAG_BACKUP_SEMANTICS unconditionally, so directories can be opened; the resulting semantics matrix
- **What Windows does**: CreateFileW refuses to open directories unless FILE_FLAG_BACKUP_SEMANTICS is passed. With it: OPEN_EXISTING/OPEN_ALWAYS on a directory *succeed* (even with FILE_GENERIC_WRITE — write access on a dir means add-file/add-subdir); ReadFile/WriteFile on a directory handle then fail ERROR_INVALID_FUNCTION. Side effect: if the process holds SeBackupPrivilege, BACKUP_SEMANTICS bypasses ACL checks.
- **How libuv handles it**: `attributes |= FILE_FLAG_BACKUP_SEMANTICS` always (fs.c:609-610). Resulting matrix (test-fs-open-flags.c:276-416, run with and without FILEMAP): open dir `r`/`r+`/`a`/`a+` succeeds; read/write on dir fd → EISDIR via ERROR_INVALID_FUNCTION→UV_EISDIR (error.c:168); wrong-direction op on dir → EBADF (access check fires first, FSIO-24); `w`/`w+` → EISDIR at open (FSIO-06); `*x` → EEXIST.
- **History**: 2216d38c "windows: enable uv_fs_open to open directories"; 109e176a "only allow opening directories for reading... closer to the Posix model" (the write-mode restriction later became moot because the kernel itself rejects the I/O); b68ee404 mapped ERROR_INVALID_FUNCTION→EISDIR (joyent/node#4951) noting the same code appears in unrelated APIs (tape, firmware) libuv doesn't care about.
- **Bun disposition**: must-port (the flag and the EISDIR-on-I/O mapping). Note the SeBackupPrivilege ACL-bypass interaction for AppContainer/least-privilege scenarios. Target: engine

### [FSIO-08] mode & ~umask without write bit → FILE_ATTRIBUTE_READONLY; the _umask(0) read dance is racy
- **What Windows does**: Windows has no mode bits; the only analogue is the READONLY attribute. The CRT umask is process-global and there is no read-only getter — you must `_umask(0)` then `_umask(old)` to read it, which momentarily zeroes it for all threads.
- **How libuv handles it**: On O_CREAT, if `(mode & ~current_umask) & _S_IWRITE` is clear, sets FILE_ATTRIBUTE_READONLY on the new file (fs.c:474-477, 538-543). The attribute only applies when a file is actually created; the just-opened handle still has write access, so write-then-close on a 0444 creat works like POSIX. The umask read trick is a benign-but-real race (two concurrent opens can observe umask 0).
- **History**: e1af07e8 originally used the CRT-internal `extern int _umaskval`; later replaced with the portable `_umask(0)` dance (8a499e13 "stop using deprecated names" finished the cleanup).
- **Bun disposition**: must-port the mode→READONLY rule (node tests rely on `fs.openSync(p, "w", 0o444)` producing a read-only file). For umask, Bun should read its own cached process umask instead of the racy CRT dance. Target: engine

### [FSIO-09] O_TEMPORARY needs the DELETE access right; O_SHORT_LIVED/SEQUENTIAL/RANDOM are cache hints
- **What Windows does**: FILE_FLAG_DELETE_ON_CLOSE fails at CreateFile time unless the handle is opened with DELETE access. FILE_ATTRIBUTE_TEMPORARY keeps pages in cache; FILE_FLAG_SEQUENTIAL_SCAN / FILE_FLAG_RANDOM_ACCESS tune the cache manager and are mutually exclusive in spirit.
- **How libuv handles it**: `O_TEMPORARY` → `FILE_FLAG_DELETE_ON_CLOSE | FILE_ATTRIBUTE_TEMPORARY` **plus** `access |= DELETE` (fs.c:545-548). `O_SHORT_LIVED` → FILE_ATTRIBUTE_TEMPORARY (550-552). SEQUENTIAL and RANDOM both set → EINVAL (554-565).
- **History**: present since e1af07e8; the flags are CRT `_O_*` values re-exported (win.h:675-685), so node's `fs.constants` exposes them on Windows.
- **Bun disposition**: should-port. These are Windows-only CRT extensions node exposes; cheap to map, and forgetting `access |= DELETE` makes O_TEMPORARY fail with EACCES. Target: engine

### [FSIO-10] O_DSYNC/O_SYNC → FILE_FLAG_WRITE_THROUGH; setting both is EINVAL
- **What Windows does**: There is one write-through knob, no dsync/sync distinction. FILE_FLAG_WRITE_THROUGH ≠ fsync-per-write (it skips the cache for data but metadata durability is weaker than FlushFileBuffers).
- **How libuv handles it**: Either flag → FILE_FLAG_WRITE_THROUGH; the switch on `flags & (DSYNC|SYNC)` has no `DSYNC|SYNC` case so both together → EINVAL (fs.c:598-607). This deviates from Linux where O_SYNC literally contains the O_DSYNC bits.
- **History**: 4b666bd2 "unix,win: add fs open flags, map O_DIRECT|O_DSYNC".
- **Bun disposition**: must-port the mapping; consider *allowing* both bits (treat as O_SYNC) instead of EINVAL — libuv's strictness has caused node user confusion, but matching libuv is the compatible choice. Target: engine

### [FSIO-11] Request minimal access rights at open; widen later via ReOpenFile (FILE_WRITE_ATTRIBUTES revert)
- **What Windows does**: Every access right requested at open is ACL-checked at open time. Asking for "harmless extra" rights (e.g. FILE_WRITE_ATTRIBUTES so a later fchmod works) makes opens fail with ACCESS_DENIED on files where the user has R/W data rights but not attribute rights — common with inherited ACLs, network shares, and other-owner files.
- **How libuv handles it**: fs__open requests only what the POSIX flags imply. The fchmod path instead re-derives a fresh handle with `ReOpenFile(handle, FILE_WRITE_ATTRIBUTES, ...)` at the moment it needs it (fs.c:2577). The unlink path does the same for stripping READONLY, with an added twist: it re-opens rather than requesting the right up front partly because *Wine* fails NtSetInformationFile on handles lacking the right (fs.c:1216-1239 comment citing https://bugs.winehq.org/show_bug.cgi?id=50771).
- **History**: aa1beaa0 added FILE_WRITE_ATTRIBUTES to every open (for node#12803, fchmod on Archive-cleared files) → caused EPERM storms in node (node#20112) → fully reverted in 1954e9e3. The lesson became "never widen open-time access".
- **Bun disposition**: must-port (as a design rule, not code): open with minimal rights; use ReOpenFile/re-open for metadata ops. cross-ref: fs-metadata (fchmod), fs-delete (unlink). Target: engine

### [FSIO-12] No pre-open GetFileAttributes probe
- **What Windows does**: A stat-before-open is a TOCTOU hole and a wasted syscall; early libuv did it to emulate something and it "wasn't working" anyway.
- **How libuv handles it**: fs__open goes straight to CreateFileW; all classification (directory? exists?) is derived from the open error or from the opened handle (FSIO-06, FILEMAP's GetFileInformationByHandleEx).
- **History**: 43658969 "Windows: skip GetFileAttributes call when opening a file. It wasn't working, and everything seemed to work fine nonetheless."
- **Bun disposition**: must-port (principle: classify via handle/error, never pre-stat). Target: engine

### [FSIO-13] No automatic \\?\ long-path prefixing — relies on the host app's manifest
- **What Windows does**: Without the `longPathAware` manifest element + registry opt-in (Win10 1607+), Win32 path APIs are limited to MAX_PATH unless the caller passes an explicit `\\?\` prefix. `\\?\` also disables normalization (trailing dots/spaces, `/`→`\`, relative segments).
- **How libuv handles it**: fs__capture_path converts WTF-8→UTF-16 and passes the path to CreateFileW verbatim (fs.c:349-423) — no prefixing, no normalization. Node ships a longPathAware manifest, so long paths work in node but not in arbitrary libuv embedders. (Other subsystems — junction creation, process spawn — do build `\??\`/`\\?\` forms themselves; const prefixes at fs.c:151-158.)
- **History**: code comment only; repeated wontfix discussions upstream — prefixing breaks relative paths and normalization expectations.
- **Bun disposition**: must-port the *decision*: Bun.exe already embeds longPathAware; keep relying on it for fs paths and reserve explicit `\\?\` for the places Bun already uses it (path.toNamespacedPath, watcher). Do not blanket-prefix in the sys layer. Target: engine

### [FSIO-14] uv fs handles are not inheritable (deviation from POSIX fd inheritance)
- **What Windows does**: CreateFileW with NULL SECURITY_ATTRIBUTES yields a non-inheritable handle. CRT `_open`, by contrast, creates inheritable handles unless _O_NOINHERIT. POSIX fds are inherited across fork/exec by default.
- **How libuv handles it**: NULL security attributes everywhere (fs.c:612-618), so no uv fs fd ever leaks into child processes by OS inheritance; stdio passing is done explicitly by the process-spawn code (its own CRT-compatible lpReserved2 block).
- **History**: implicit since e1af07e8; never changed.
- **Bun disposition**: must-port (and it is the safe default — equivalent to O_CLOEXEC-always). Anyone porting node's `spawn` fd-passing must know fs fds are NOT inheritable on Windows. cross-ref: process-spawn. Target: engine

## B. The CRT fd layer

### [FSIO-15] _open_osfhandle failure: EMFILE arrives via errno with GetLastError()==0
- **What Windows does**: The CRT fd table holds 2048 fds by default (raisable to 8192 via _setmaxstdio). When it is full, `_open_osfhandle` returns -1 with errno=EMFILE but GetLastError()=0 — it is a CRT failure, not a Win32 failure, so checking _doserrno/GetLastError yields garbage/UNKNOWN.
- **How libuv handles it**: After `_open_osfhandle((intptr_t)file, flags)` fails: if errno==EMFILE → UV_EMFILE with synthetic sys_errno ERROR_TOO_MANY_OPEN_FILES; else if GetLastError()!=0 → translate that; else UV_UNKNOWN. Always `CloseHandle(file)` since the CRT did not take ownership (fs.c:632-646; same pattern in fs__mkstemp_func 1395-1409).
- **History**: 20e774c6 + faf2c593 "windows/fs: handle _open_osfhandle() failure correctly"; 489fb4c9 fixed the adjacent bug of reporting stale GetLastError() for EINVAL flag combos.
- **Bun disposition**: must-port if Bun keeps CRT fds for node:fs integer-fd compat; if Bun runs its own fd table, port the *shape*: distinguish table-full (EMFILE) from OS errors, and never leak the HANDLE when fd minting fails. Target: engine

### [FSIO-16] Never close fds 0-2; report success without doing anything
- **What Windows does**: Closing CRT fd 0/1/2 closes the underlying console/pipe handle; the fd slot and even the handle value get recycled by the next open, after which "stdout" writes land in a random file. Many node programs call `fs.close()` on stdio fds (POSIX habit).
- **How libuv handles it**: `fs__close`: `if (fd > 2) result = _close(fd); else result = 0;` — silent no-op success for 0-2 (fs.c:712-715). The fd-hash entry is still removed first (706-710) so a FILEMAP stdio fd cannot leave a stale mapping entry.
- **History**: c619f37c "win,fs: don't close fd 0-2" (PR #396, 2015).
- **Bun disposition**: must-port. Bun already learned this lesson in its libuv-backed close path; carry it into the Rust layer verbatim (and keep it fd-number-based, not handle-based). Target: engine

### [FSIO-17] _close() reports failure only via errno=EBADF (never _doserrno)
- **What Windows does**: CRT `_close` on an invalid fd sets errno=EBADF and does not touch _doserrno or last-error; in debug CRTs it would also assert (see FSIO-19).
- **How libuv handles it**: On `_close` failure: `assert(errno == EBADF)` then report UV_EBADF with synthetic ERROR_INVALID_HANDLE (fs.c:717-725, comment documents the CRT contract).
- **History**: 77eda8d9 "win: properly return UV_EBADF when _close() fails"; ae9d5207 "win,fs: avoid implicit access to _doserrno" cleaned up remaining _doserrno reads elsewhere.
- **Bun disposition**: skip if Bun's layer closes raw HANDLEs (NtClose/CloseHandle status is authoritative); must-port only while CRT fds remain in the path. Either way: double-close must surface EBADF, not crash. Target: engine

### [FSIO-18] Suppressing the debug CRT: _set_invalid_parameter_handler + _CrtSetReportHook + per-thread assert disable around _get_osfhandle
- **What Windows does**: Passing an invalid fd to CRT functions invokes the "invalid parameter handler", which by default *terminates the process* (release) or pops an assert dialog (debug). `_get_osfhandle(bad_fd)` asserts in debug builds even though it would correctly return INVALID_HANDLE_VALUE if allowed to continue.
- **How libuv handles it**: Library init installs a no-op `_set_invalid_parameter_handler` ("invalid FDs will trigger this behavior", core.c:184-189) and, in _DEBUG builds, a `_CrtSetReportHook` that swallows _CRT_ASSERT reports when a UV_THREAD_LOCAL flag is set, breaking into the debugger if one is attached (core.c:43-67, 191-197). Every fd→HANDLE conversion goes through `uv__get_osfhandle()`, which brackets `_get_osfhandle` with `UV_BEGIN/END_DISABLE_CRT_ASSERT()` (handle-inl.h:98-110; internal.h:43-57). The report hook returns TRUE so _CrtDbgReport is never called.
- **History**: c0716b3d "windows: improved handling of invalid FDs" — fixed node's test-fs-read-stream.js and test-listen-fd-ebadf.js; also documents that _get_osfhandle's error goes to errno, not _doserrno.
- **Bun disposition**: must-port while any CRT fd API (`_get_osfhandle`, `_close`, `_open_osfhandle`, `_lseeki64`) is reachable from user input — without the handler, `fs.fstatSync(999)` can kill a release process built against a strict CRT. If Bun fully exits the CRT fd world, downgrade to skip (reason: no CRT calls left). Note the handler is process-global: installing it changes behavior for embedders' own CRT misuse too. Target: engine

### [FSIO-19] VERIFY_FD only rejects fd==-1; all other bad fds funnel through the CRT
- **What Windows does**: n/a (validation-layer choice). The CRT validates fd range/liveness itself and returns INVALID_HANDLE_VALUE (given FSIO-18's suppression).
- **How libuv handles it**: `VERIFY_FD` macro fails fast with UV_EBADF/ERROR_INVALID_HANDLE only for the -1 sentinel (fs.c:117-122); negative-but-not--1 and out-of-range fds reach `uv__get_osfhandle` and become EBADF via the INVALID_HANDLE_VALUE check (fs.c:870-875, 1075-1079).
- **History**: 72fb469a (2011) "windows: check for fd==-1 in uv_fs functions".
- **Bun disposition**: must-port the invariant (every fd-taking op returns EBADF for any invalid fd, never traps), regardless of which table implements it. Target: engine

### [FSIO-20] Text/binary mode: don't touch global _fmode; UCRT _open_osfhandle defaults to binary; CRT append flag piggybacks on passed flags
- **What Windows does**: Old MSVCRT consulted the global `_fmode` (default TEXT — CRLF translation + Ctrl-Z EOF!) for fds created without explicit _O_TEXT/_O_BINARY. UCRT's `_open_osfhandle` only honors flags actually passed (_O_APPEND/_O_TEXT/_O_NOINHERIT), defaulting to binary. The CRT fd remembers _O_APPEND and seeks to EOF in CRT `_write`.
- **How libuv handles it**: Historically set `_fmode = _O_BINARY` at init; removed by c905e0be "win,fs: don't modify global file translation mode" because uv does its own ReadFile/WriteFile so translation never applies — and clobbering a process-global behind the embedder's back is rude. fs__open passes the (FILEMAP-adjusted) uv flags straight to `_open_osfhandle` (fs.c:632), so the CRT fd inherits _O_APPEND; unknown bits like 0x20000000 are ignored by the CRT. The only CRT-level I/O left is fs__sendfile's `_read`/`_write` (fs.c:2506-2516) — safe on UCRT because fds are binary by default.
- **History**: c905e0be (2019); original `_fmode` hack from e1af07e8 era.
- **Bun disposition**: must-port the rule (never mutate _fmode or other CRT globals; never rely on CRT translation being off unless you pass _O_BINARY explicitly when minting CRT fds for third parties). Target: engine

## C. read / write / seek

### [FSIO-21] Positional read/write must save and restore the file pointer on sync handles
- **What Windows does**: On a synchronous (non-OVERLAPPED-mode) handle, ReadFile/WriteFile with an OVERLAPPED offset *still advances the shared file pointer*. POSIX pread/pwrite must not move the fd's offset. Because the CRT fd and the OS handle share one file pointer, a uv positional read would otherwise corrupt subsequent sequential reads (including the CRT's own).
- **How libuv handles it**: When offset != -1: `SetFilePointerEx(handle, 0, &original_position, FILE_CURRENT)` before the I/O loop, and `SetFilePointerEx(handle, original_position, NULL, FILE_BEGIN)` after it, error paths included (fs.c:877-886, 912-913; write: 1086-1095, 1117-1118). If the initial SetFilePointerEx fails (non-seekable device), restore is skipped rather than failing the I/O.
- **History**: 0bd8f5bf "win: restore file pos after positional read/write" (PR #1357), fixing nodejs/node#9671 — `fs.read` with position was visibly moving the fd offset on Windows only. Note the save/restore is inherently racy vs concurrent I/O on the same fd from other threads — accepted, since POSIX pread on the same fd concurrently is fine but Windows cannot do better on sync handles.
- **Bun disposition**: must-port (Bun's Rust pread/pwrite on sync handles need the identical dance; alternative is NtReadFile with explicit ByteOffset which *also* updates CurrentByteOffset on sync handles — no escape). Target: engine

### [FSIO-22] Advance the OVERLAPPED offset manually between vectored buffers — WriteFile does not auto-advance
- **What Windows does**: Issuing multiple sequential WriteFile calls with the same OVERLAPPED offset writes every buffer at the same position; ReadFile behaves equivalently. There is no scatter/gather API for arbitrary buffers (ReadFileScatter needs page-aligned, NO_BUFFERING handles).
- **How libuv handles it**: readv/writev are loops over ReadFile/WriteFile; each iteration recomputes `offset_.QuadPart = offset + bytes` into the OVERLAPPED (fs.c:894-898 read, 1102-1106 write). The loop continues `while (result && index < nbufs)` — a short read does not stop the loop (next ReadFile returns EOF/0).
- **History**: 6760d51b "windows: fix fs_write with nbufs > 1 and offset" then 5ac921bb "fix fs_read with nbufs > 1 and offset" — the pair of 2014 commits even contradict each other about whether ReadFile auto-advances; the durable lesson is "never rely on auto-advance, always set the offset explicitly per call".
- **Bun disposition**: must-port (emulated readv/writev with explicit per-iteration offsets). Target: engine

### [FSIO-23] EOF is an *error code* on Windows: ERROR_HANDLE_EOF and ERROR_BROKEN_PIPE both mean "read 0"
- **What Windows does**: ReadFile at EOF on some handle types (sync files past EOF, pipes) returns FALSE with ERROR_HANDLE_EOF; reading from a pipe whose write end closed returns FALSE with ERROR_BROKEN_PIPE. Neither is an error in POSIX terms — both are read()==0.
- **How libuv handles it**: In fs__read's failure branch: `if (error == ERROR_HANDLE_EOF || error == ERROR_BROKEN_PIPE) SET_REQ_RESULT(req, bytes)` — success with the bytes accumulated so far, normally 0 (fs.c:923-927). The general error table *also* maps ERROR_BROKEN_PIPE→UV_EOF (error.c:157) as a backstop for paths that translate it.
- **History**: fca18c33 (2012) "win: fs: handle EOF in read" — a refactor dropped EOF handling and broke luvit's readSync; df78de04 (#3053, 2022) added BROKEN_PIPE after fs.read on a closed pipe fd produced "EPIPE" garbage errors in node.
- **Bun disposition**: must-port both codes (reading stdin-as-pipe hits BROKEN_PIPE constantly). Target: engine

### [FSIO-24] Wrong-direction I/O: ERROR_ACCESS_DENIED rewritten to EBADF — ordered *before* the EOF check
- **What Windows does**: ReadFile on a write-only handle / WriteFile on a read-only handle fail with ERROR_ACCESS_DENIED. The global table maps ACCESS_DENIED→EPERM (FSIO-48), but POSIX says read(2)/write(2) on a wrongly-opened fd is EBADF.
- **How libuv handles it**: fs__read/fs__write rewrite `ERROR_ACCESS_DENIED → ERROR_INVALID_FLAGS` (an arbitrary sentinel that the table maps to UV_EBADF, error.c:82) before any further classification (fs.c:919-921, 1125-1127). The FILEMAP emulation paths return the same sentinel for direction violations (fs.c:760-763, 946-949) so both paths produce identical errno. Side effect: a *genuine* permission failure during read/write (e.g. region locked by another process maps differently, but ACL revocation mid-handle does not happen) is indistinguishable and also becomes EBADF — accepted.
- **History**: Three-act story: 93942168 changed only the FILEMAP paths but updated the whole test matrix → non-FILEMAP cases still returned EPERM → reverted (103dbaed, refs PR #3205). Reapplied completely as 9604b61d (#3303) covering all four paths. Lesson: the remap must be in every sibling path or the test matrix splits.
- **Bun disposition**: must-port (node's `fs.writeSync` on an O_RDONLY fd must be EBADF; node tests assert it). Target: engine

### [FSIO-25] Write errors go through a write-specific translator: BROKEN_PIPE and NO_DATA → EPIPE
- **What Windows does**: Writing to a pipe with no readers fails ERROR_BROKEN_PIPE or ERROR_NO_DATA (232, "pipe is being closed"). But ERROR_NO_DATA is *also* what a PIPE_NOWAIT (legacy non-blocking) pipe returns for a would-block write, and ERROR_BROKEN_PIPE on a *read* means EOF — one Win32 code, three POSIX meanings depending on direction.
- **How libuv handles it**: `uv_translate_write_sys_error` (error.c:176-183): BROKEN_PIPE→UV_EPIPE, NO_DATA→UV_EPIPE, everything else falls to the general table (where BROKEN_PIPE→UV_EOF and NO_DATA→UV_EAGAIN, error.c:80,157). fs__write reports `SET_REQ_UV_ERROR(req, uv_translate_write_sys_error(error), error)` (fs.c:1129); win/stream.c uses the same translator for socket/pipe writes.
- **History**: Originally NO_DATA→EPIPE globally; 47c83367 (#4471) remapped it to EAGAIN for PIPE_NOWAIT correctness; that broke EPIPE detection on writes (#4548) → 473dafc5 (#4562) introduced the write-path override table. A textbook "context-dependent errno" arc.
- **Bun disposition**: must-port the two-table design (direction-aware errno translation). Bun's error mapping in the Rust sys layer should take an "operation kind" hint rather than hardcoding one global table. Target: engine

### [FSIO-26] Partial success wins: if any bytes transferred, report the byte count and swallow the error
- **What Windows does**: In a multi-buffer loop, buffer N can fail after buffers 0..N-1 transferred; POSIX readv/writev semantics require returning the short count, not the error.
- **How libuv handles it**: `if (result || bytes > 0) SET_REQ_RESULT(req, bytes)` — only an error on the *first* buffer surfaces as an error (fs.c:915-916, 1120-1121). `bytes` accumulates `incremental_bytes` across iterations.
- **History**: shape present since the vectored-IO API (13dd3502, itself reverted once as a03ea239 then relanded — vectored fs I/O had a false start).
- **Bun disposition**: must-port (standard POSIX shape, easy to forget on Windows where the error code is loud). Target: engine

### [FSIO-27] 32-bit truncation guards: reads clamp per-buffer, writes reject totals > 0x7ffff000
- **What Windows does**: ReadFile/WriteFile take DWORD lengths; uv_buf_t.len is size_t; uv results are int. A 4GB buffer silently truncates to a DWORD; a >2GB total can't be represented in the int result.
- **How libuv handles it**: `UV__IO_MAX_BYTES = 0x7ffff000` (uv-common.h:234, same constant Linux uses per-syscall). fs__read clamps each buffer's `to_read` to it (fs.c:900-902); uv_fs_write rejects the whole call with EINVAL if `uv__count_bufs > UV__IO_MAX_BYTES` (fs.c:3336-3339); uv_fs_sendfile rejects length > it. Note the read/write asymmetry: oversized reads short-read; oversized writes EINVAL.
- **History**: fa0ac9ec "io: make libuv 64-bit safe (#5076)" — landed March 2026 after *a decade* of open PRs; commit message: ">2GB usually failed in bizarre ways already; node is 32-bit [in lengths] and Julia patched this downstream more than a decade ago".
- **Bun disposition**: must-port the DWORD-clamp on every ReadFile/WriteFile call; Bun's Rust API returns 64-bit counts so it can loop instead of erroring, but per-call clamping is non-negotiable. Target: engine

### [FSIO-28] Append-mode handles ignore explicit offsets — positional writes still append
- **What Windows does**: On a handle whose only write right is FILE_APPEND_DATA (FSIO-03), the kernel ignores the OVERLAPPED offset and appends atomically at EOF. (Coincidentally matches Linux's pwrite-on-O_APPEND bug, so platforms agree.)
- **How libuv handles it**: No special code in fs__write — kernel behavior is accepted. The FILEMAP emulation *deliberately replicates it*: `force_append` (saved original O_APPEND) takes priority over both current_pos and an explicit offset (fs.c:965-971).
- **History**: code comment only (the filemap branch ordering); behavior matrix in test-fs-open-flags.c `a`/`a+` cases.
- **Bun disposition**: must-port the *knowledge* (document that pwrite-with-offset on append fds appends; do not "fix" it — node relies on Linux-compatible behavior). Target: engine

### [FSIO-29] Positional I/O on pipes: SetFilePointerEx fails, offsets are ignored, no error raised
- **What Windows does**: Pipes are not seekable; SetFilePointerEx fails on them; ReadFile/WriteFile on byte-mode pipes ignore OVERLAPPED offsets on sync handles.
- **How libuv handles it**: `restore_position` stays 0 when the save fails (fs.c:880-883) and the I/O proceeds with the offset silently ignored — a positional read on a pipe behaves as a sequential read instead of failing ESPIPE as POSIX would. libuv chose permissiveness; node guards some cases at the JS layer.
- **History**: implicit consequence of 0bd8f5bf's "if SetFilePointerEx succeeds" guard.
- **Bun disposition**: should-port with a decision: either replicate (silent sequential) for bug-compat, or detect FILE_TYPE_PIPE and return ESPIPE like POSIX. node:fs compat argues for replicate. Target: engine

### [FSIO-30] offset == -1 is the "use current position" sentinel; CRT and OS share one file pointer
- **What Windows does**: The CRT fd's notion of position *is* the OS handle's file pointer (the CRT caches nothing for binary fds), so `_lseeki64`, ReadFile-sequential, and uv positional restores all act on the same state.
- **How libuv handles it**: int64 offset, `-1` = sequential (OVERLAPPED ptr NULL → kernel uses/advances the file pointer; fs.c:884-886). There is no `uv_fs_lseek`; seeking is expressed via positional reads/writes or CRT `_lseeki64` (used internally by sendfile, fs.c:2498-2500). No validation that offset < -1 is rejected — negative offsets other than -1 go into OVERLAPPED as huge unsigned values and fail downstream.
- **History**: d5acfd0c "64bit offsets for fs operations" (2012) established the int64/-1 convention.
- **Bun disposition**: must-port the sentinel semantics for node:fs (`position: null` → -1). Consider explicitly rejecting offset < -1 with EINVAL instead of inheriting accidental kernel behavior. Target: engine

## D. UV_FS_O_FILEMAP and the fd hash

### [FSIO-31] O_FILEMAP rewrites the open flags: WRONLY→RDWR, APPEND stripped — original flags stashed for emulation
- **What Windows does**: CreateFileMapping requires read access even for write-only mappings; mapped writes cannot express atomic append at all.
- **How libuv handles it**: When UV_FS_O_FILEMAP (0x20000000, win.h:678) is set, fs__open saves the *original* flags into `fd_info.flags`, then mutates the working flags: sole-WRONLY becomes RDWR; O_APPEND is cleared and forced RDWR (fs.c:454-472). Later reads/writes consult the saved originals to enforce user-visible direction/append semantics (FSIO-24, FSIO-28) even though the handle is more capable. Directory fds get `is_directory=TRUE, mapping=INVALID` (fs.c:658-662).
- **History**: 2c279504 "win: add UV_FS_O_FILEMAP" (PR #2295) — perf feature; node exposes `fs.constants.UV_FS_O_FILEMAP` since v12.16 so user code *can* pass it.
- **Bun disposition**: should-port as accept-and-ignore: treat the 0x20000000 bit as a no-op perf hint in the Rust layer (strip it before flag validation, take the normal ReadFile/WriteFile path). Semantics are identical by design (the entire filemap machinery exists to *emulate* the normal path), so ignoring it is compatible; rejecting it as EINVAL would break any npm package passing node's constant. Target: engine

### [FSIO-32] Zero-length files cannot be mapped: INVALID_HANDLE_VALUE sentinel; mapping recreated on growth
- **What Windows does**: CreateFileMapping on a zero-byte file fails (ERROR_FILE_INVALID). A mapping object's size is fixed at creation; growing the file requires a new mapping object.
- **How libuv handles it**: Empty file → `mapping = INVALID_HANDLE_VALUE` recorded in the hash with size 0 (fs.c:670-671; header comment fs-fd-hash-inl.h:32-35). Writes that extend past `size` close the old mapping and CreateFileMapping at the new end (FSIO-36); reads at/past cached EOF return 0 without touching the mapping (fs.c:775-779).
- **History**: 2c279504.
- **Bun disposition**: skip the mechanism (no filemap port per FSIO-31), but must-carry the lesson into Bun's own mmap-backed reads (`Bun.mmap`, mmap fast paths): zero-size map fails, growth requires remap, reads past cached size need explicit EOF handling. Target: Bun.mmap / file-blob fast paths.

### [FSIO-33] The fd→mapping hash: 256 buckets, modulo hash, global mutex probed on EVERY read/write/close
- **What Windows does**: n/a (libuv-internal design). CRT fds are small sequential ints; uv must find "is this fd a filemap fd" on every I/O.
- **How libuv handles it**: Static 256-bucket table keyed `fd % 256`, each bucket a linked list of 16-entry groups with the first group statically allocated; one global `uv_mutex_t` serializes get/add/remove; removal swap-fills from the bucket's first slot (fs-fd-hash-inl.h:42-193). `fs__read`/`fs__write`/`fs__close` call `uv__fd_hash_get`/`remove` unconditionally — so every uv file read on Windows takes a process-global mutex even when FILEMAP has never been used. OOM growing a bucket → `uv_fatal_error` (abort, fs-fd-hash-inl.h:149-151).
- **History**: 2c279504 introduced it; 12fbd344 (#4869, 2025) shrank the static table 16x (2592KB→162KB) — the initial layout reserved MxN entries but used every Nth ("Fixes #4823", someone noticed the .bss bloat). 3d12a590 de-inlined it.
- **Bun disposition**: skip (no filemap), and treat as an anti-lesson: never put a global mutex probe on the per-I/O hot path for a feature almost nobody enables; if Bun ever needs per-fd sidecar state, key it off a flag bit in the fd representation first. Target: engine

### [FSIO-34] Mapped-I/O faults arrive as SEH EXCEPTION_IN_PAGE_ERROR, not error codes; MinGW builds just crash
- **What Windows does**: I/O errors on a mapped view (network share dropped, file truncated underneath, disk error) are delivered as a structured exception (EXCEPTION_IN_PAGE_ERROR) at the faulting memcpy, carrying the underlying NTSTATUS in ExceptionInformation[3].
- **How libuv handles it**: Every memcpy to/from a view is wrapped in `__try/__except(fs__filemap_ex_filter(...))` which accepts only EXCEPTION_IN_PAGE_ERROR, extracts ExceptionInformation[3] when NumberParameters >= 3, converts via `pRtlNtStatusToDosError`, and falls back to UV_UNKNOWN (fs.c:729-746, 812-827, 1015-1030). The wrappers are `#ifdef _MSC_VER` only — GCC/Clang builds have no SEH here, and docs/src/fs.rst:244-263 carries an explicit warning that FILEMAP I/O may fatally crash under non-MSVC builds.
- **History**: 2c279504 added the SEH; 813264ad "win: remove try-except outside MSVC" (#2407) — MinGW couldn't compile __try, so they removed it and documented the crash instead of emulating (VEH was rejected as too invasive).
- **Bun disposition**: must-port the *lesson* for Bun's own mmap paths: any memcpy from a MapViewOfFile region of a file you don't fully control must be SEH-guarded (Rust: `IsBadReadPtr`-free; use a small C/asm SEH shim or Win32 `__try` via `microseh`-style crate) or restricted to local, size-pinned files. EXCEPTION_IN_PAGE_ERROR's ExceptionInformation[3] → RtlNtStatusToDosError is the only way to recover the real errno. cross-ref: Bun.mmap, file-blob reads. Target: Bun.mmap hardening.

### [FSIO-35] Mapped writes don't update the file's mtime or visible metadata — explicitly SetFileTime after each write, and FlushViewOfFile
- **What Windows does**: Writing through a mapping does not update the last-write timestamp until the mapping is flushed/closed (and even then, timestamp updates are lazy); other processes stat'ing the file see stale mtime. Dirty mapped pages also linger in memory until flushed.
- **How libuv handles it**: After each successful fs__write_filemap: `FlushViewOfFile(view, 0)` (treat flush failure as write failure, fs.c:1035-1039) then `GetSystemTimeAsFileTime(&ft); SetFileTime(file, NULL, NULL, &ft)` to force mtime forward (fs.c:1050-1051). This keeps `fs.watchFile`/build tools that poll mtime working when a writer uses FILEMAP.
- **History**: 2c279504, code comment only.
- **Bun disposition**: must-carry as a lesson for any Bun mmap-based *write* path (Bun.write with mmap, future fast paths): mapped writes need explicit SetFileTime or downstream mtime-based invalidation breaks. Target: Bun.mmap / Bun.write fast paths.

### [FSIO-36] Growing a filemapped file pre-extends it via CreateFileMapping(end_pos); the failure path closes the user's HANDLE (wart — do not copy)
- **What Windows does**: CreateFileMapping with a size larger than the file extends the file immediately (SetEndOfFile effect) — before any data is written. If the process dies mid-write the file keeps the zero-filled tail.
- **How libuv handles it**: Write past cached size → CloseHandle(old mapping), CreateFileMapping(file, ..., end_pos) → update fd_info.size in the hash (fs.c:975-999). On CreateFileMapping failure it calls `CloseHandle(file)` — *the OS handle still owned by the CRT fd* — then records a poisoned (mapping=INVALid, size 0) entry and returns the error (fs.c:987-995). Same pattern in fs__ftruncate's filemap branch (fs.c:2408-2415, 2432-2440). The CRT fd is left pointing at a closed handle; the next operation gets EBADF-ish behavior. This is an accepted-by-default wart, not a design.
- **History**: 2c279504, never revisited.
- **Bun disposition**: skip the mechanism; record as anti-lesson: never close a handle you don't own on an error path — poisoning a user's fd converts one failed write into mysterious EBADFs later. Target: design note.

### [FSIO-37] The filemap emulation mirrors kernel error codes exactly so both paths are indistinguishable
- **What Windows does**: n/a — consistency requirement.
- **How libuv handles it**: read-on-WRONLY / write-on-RDONLY → ERROR_INVALID_FLAGS (→EBADF), exactly what the ACCESS_DENIED remap produces on the real path; read/write on directory → ERROR_INVALID_FUNCTION (→EISDIR), exactly what ReadFile on a directory handle returns (fs.c:760-767, 946-953). The shared test matrix runs every case twice — `fs_open_flags(0)` and `fs_open_flags(UV_FS_O_FILEMAP)` (test-fs-open-flags.c:418-423).
- **History**: 9604b61d aligned the codes (after the 93942168/103dbaed revert taught them the two paths must move together).
- **Bun disposition**: must-port the principle: if Bun ever adds a fast path that bypasses the kernel (mmap reads for Bun.file), its error surface must be byte-identical to the slow path, enforced by running the same test matrix over both. Target: test strategy for fs fast paths.

### [FSIO-38] Filemap append/current_pos live in the hash, not the OS file pointer — and append uses the *cached* size
- **What Windows does**: Mapped I/O never moves the OS file pointer, and there is no kernel-arbitrated EOF for mapped appends.
- **How libuv handles it**: `fd_info.current_pos` tracks the sequential position for offset==-1 ops; updated in the hash after each op (fs.c:769-773, 837-840, 1045-1048). Append writes position at `fd_info.size` — the *cached* size, so appends are not atomic against other processes (or even other fds in the same process) growing the file; mixing CRT `_read`/`_lseeki64` with filemap I/O on the same fd silently diverges (sendfile does exactly that, FSIO-53).
- **History**: 2c279504; divergence never fixed, just tolerated because FILEMAP is opt-in.
- **Bun disposition**: skip (no filemap). Lesson for any user-space position emulation: a cached EOF is not an append guarantee. Target: design note.

### [FSIO-39] ftruncate interacts with the mapping: close mapping → NtSetInformationFile(FileEndOfFileInformation) → recreate
- **What Windows does**: You cannot shrink a file with an active mapping (ERROR_USER_MAPPED_FILE); SetEndOfFile requires moving the file pointer first (SetFilePointer+SetEndOfFile is a racy two-step), while NtSetInformationFile sets EOF directly from a parameter.
- **How libuv handles it**: fs__ftruncate closes the mapping handle before truncation when the fd is filemapped (directories rejected with ACCESS_DENIED), truncates via `pNtSetInformationFile(FileEndOfFileInformation)` — one atomic call, no pointer dance — then recreates the mapping at the new size with PAGE_READONLY/READWRITE per saved flags (fs.c:2372-2445). Failure paths again poison the fd via CloseHandle (FSIO-36).
- **History**: NtSetInformationFile-for-EOF predates FILEMAP; filemap branch added in 2c279504.
- **Bun disposition**: must-port the NtSetInformationFile(FileEndOfFileInformation) approach for ftruncate (avoids the file-pointer race; Bun's Rust layer should already prefer the Nt call). Filemap choreography itself: skip. cross-ref: fs-metadata. Target: engine

## E. Path capture and WTF-8

### [FSIO-40] All fs paths are WTF-8 ↔ UTF-16, because real Windows filenames contain unpaired surrogates
- **What Windows does**: NTFS filenames are arbitrary 16-bit unit sequences — not necessarily valid UTF-16. Files with lone surrogates exist in the wild; strict UTF-8 conversion either errors on them or corrupts them (U+FFFD), making such files unopenable/unlistable.
- **How libuv handles it**: Since 8f32a14a (#2970, fixes #2048), every path crossing the boundary uses WTF-8: `uv_wtf8_length_as_utf16` + `uv_wtf8_to_utf16` inbound (fs.c:363-380, 397-411), `uv_utf16_to_wtf8` outbound (readlink/realpath/readdir). Helpers were exported as public API in f3889085 (#4021) precisely so embedders (node) can round-trip.
- **History**: 8f32a14a (2023, replaced an earlier stalled PR #2192); d09441ca (#4092) fixed a decoder bug — forgot to mask high bits of the first byte so *every* 4-byte (supplementary-plane) character failed → node#48673 "can't read files with emoji in name"; 428f2c44 (2026) changed the invalid-input return from -1 to UV_EINVAL.
- **Bun disposition**: must-port (Bun already has WTF-8 infrastructure in bun_core strings; the lesson is to use it on *every* fs path conversion, including error paths and outputs, and to test with lone-surrogate filenames — Windows CI should create one). Target: engine

### [FSIO-41] fs__capture_path: one allocation for both UTF-16 paths + optional UTF-8 copy; sync borrows, async copies
- **What Windows does**: n/a (lifetime design).
- **How libuv handles it**: Single malloc sized for pathw + new_pathw + (optionally) a byte copy of the original UTF-8 path; pointers carved out of it; `req->flags |= UV_FS_FREE_PATHS` frees the one block in cleanup (fs.c:349-423, 3240-3241). `copy_path` is literally `cb != NULL` (fs.c:3270): async requests copy the caller's path string (caller may free it before the threadpool runs); sync requests *borrow* the caller's pointer for req->path. The UTF-16 lengths include the NUL terminator (uv_wtf8_length_as_utf16 counts it, idna.c:369-383), so pathw is always NUL-terminated for CreateFileW.
- **History**: shape dates to 72b5976e "windows: support utf8 in uv_fs functions fixes #201" (2011); WTF-8 swapped in by 8f32a14a.
- **Bun disposition**: should-port the single-allocation pattern (Bun's Rust layer converts paths per-call into a stack-first WTF-16 buffer — keep that; the sync-borrow/async-copy distinction maps to Rust lifetimes naturally). The durable rule: convert once at the boundary, thread the converted form everywhere. Target: engine

### [FSIO-42] Invalid WTF-8 in a path → ERROR_INVALID_NAME → ENOENT; the decoder is deliberately lenient
- **What Windows does**: n/a (libuv policy). POSIX would pass any byte soup to the kernel; Windows needs a UTF-16 conversion that can fail.
- **How libuv handles it**: fs__capture_path returns ERROR_INVALID_NAME when conversion fails (fs.c:364-366, 376-378), which the table maps to UV_ENOENT (error.c:138) — so malformed paths "don't exist" rather than EINVAL. The decoder (idna.c:28-69) rejects continuation-byte starts (<0xC2), bad continuations, and >U+10FFFF, but accepts lone surrogates (WTF-8's purpose) and — because it masks rather than range-checks — some 3/4-byte overlong encodings.
- **History**: ERROR_INVALID_NAME choice from 72b5976e era; ERROR_INVALID_NAME→ENOENT mapping deliberate (matches what CreateFileW itself returns for syntactically invalid names like `foo<bar`, keeping libuv-level and kernel-level invalid names indistinguishable).
- **Bun disposition**: must-port the policy decision (invalid-encoding path = ENOENT, same as kernel-invalid name; node tests depend on ENOENT for garbage paths). Leniency details: match Bun's existing WTF-8 validator; do not import the overlong-acceptance bug. Target: engine

## F. Request dispatch (INIT/POST) and lifecycle

### [FSIO-43] POST: sync requests run inline on the caller's thread — the loop may be NULL; async goes to the threadpool as FAST_IO
- **What Windows does**: n/a (architecture). There is no usable async file I/O for buffered files without IOCP-overlapped handles, which break sync semantics — so libuv (both platforms) fakes async fs with a threadpool.
- **How libuv handles it**: `POST` macro (fs.c:82-97): cb!=NULL → `uv__req_register(loop)` + `uv__work_submit(loop, ..., UV__WORK_FAST_IO, uv__fs_work, uv__fs_done)`; cb==NULL → call `uv__fs_work` directly and return req->result. Consequence: *sync uv_fs_* never touch the loop* — node/libuv tests pass `NULL` as the loop for sync calls. Work-kind partitioning (uv-common.h:214-218): fs is FAST_IO; SLOW_IO (DNS) is capped at nthreads/2 so DNS storms can't starve file I/O (90891b42, nodejs/node#8436).
- **History**: 8d11aacb unified the threadpool across platforms (2014); FAST_IO/SLOW_IO split 2018.
- **Bun disposition**: must-port the contract for Bun's work pool: fs ops on the pool, sync ops never touching loop state, and a starvation policy separating slow classes (DNS) from fs. cross-ref: threadpool/loop area. Target: engine

### [FSIO-44] Any first uv_fs call lazily initializes the whole library (uv__once_init in INIT)
- **What Windows does**: n/a. SetErrorMode, winsock, winapi pointer loading, CRT handler installation all must happen before any syscall path runs.
- **How libuv handles it**: `INIT` → `uv__fs_req_init` → `uv__once_init()` (fs.c:74-80, 426-441) → uv_once'd `uv__init` (core.c:179-225): SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX|SEM_NOOPENFILEERRORBOX), CRT handlers (FSIO-18), winapi GetProcAddress table, winsock, `uv__fs_init()` (which caches `GetSystemInfo().dwAllocationGranularity` for view alignment and inits the fd hash, fs.c:176-183).
- **History**: long-standing; SetErrorMode is the reason uv processes never show "No disk in drive" / WER dialogs when touching removable media or crashing.
- **Bun disposition**: must-port SetErrorMode-at-startup (Bun already does this in its Windows main; verify all three flags) and the once-guard pattern for the Rust sys layer's lazy globals. Target: engine

### [FSIO-45] req->result is overloaded (fd, byte count, 0) and asserts result != -1; the raw Win32 error is preserved alongside
- **What Windows does**: n/a (API design).
- **How libuv handles it**: `SET_REQ_RESULT` asserts the value isn't -1 — catching accidental passthrough of raw CRT -1 returns in debug builds (fs.c:99-103). Errors are negative uv codes in result with the original Win32 code kept in `req->sys_errno_` (`SET_REQ_WIN32_ERROR`/`SET_REQ_UV_ERROR`, fs.c:105-115), exposed via `uv_fs_get_system_error()`.
- **History**: 3ee4d3f1 "return error codes directly" (the great errno rework); 45728582 (#2810) added uv_fs_get_system_error because translated errno loses information ("EPERM" hides whether it was ACCESS_DENIED vs PRIVILEGE_NOT_HELD).
- **Bun disposition**: must-port the dual-error design: Bun's Rust error type should carry the raw NTSTATUS/Win32 code next to the POSIX mapping; node's `err.errno`/`err.syscall` and useful messages depend on not discarding it. Target: src/sys/Error.rs.

### [FSIO-46] Cancellation: uv_cancel'd fs requests complete with ECANCELED via uv__fs_done
- **What Windows does**: n/a (threadpool design) — you cannot cancel a syscall in flight; only queued work is cancelable.
- **How libuv handles it**: `uv__fs_done` (fs.c:3218-3230): on status==UV_ECANCELED, asserts result==0 (work never ran) and sets UV_ECANCELED. The callback always runs exactly once; req unregistered from loop first.
- **History**: 3f1f11f3 "windows: use UV_ECANCELED to signal canceled requests".
- **Bun disposition**: should-port (Bun's async fs ops should support cancel-before-run with a defined error; node's fs doesn't expose uv_cancel but AbortSignal paths map onto it). Target: engine

### [FSIO-47] Buffer array copying: ≤4 bufs inline (bufsml), more heap-copied; cleanup is idempotent
- **What Windows does**: n/a (lifetime design).
- **How libuv handles it**: uv_fs_read/write copy the caller's uv_buf_t array (NOT the data) into `req->fs.info.bufsml[4]` or a heap copy (fs.c:3298-3315, 3331-3353; win.h:633), so the caller's *array* can be stack-temporary even for async calls while buffer *memory* must outlive the op. `uv_fs_req_cleanup` frees paths/ptr/bufs guarded by UV_FS_CLEANEDUP for idempotence (fs.c:3233-3262). NULL/0 bufs → EINVAL up front (939ea06f).
- **History**: 13dd3502 vectored IO (after one revert); bufsml sizing matches the unix side.
- **Bun disposition**: should-port the shape (Rust: SmallVec<[IoSlice;4]>-style). The idempotent-cleanup flag is a C-ism Rust ownership replaces — skip that part. Target: engine

## G. error.c translation tables

### [FSIO-48] The master Win32→errno table is accumulated case law; ERROR_ACCESS_DENIED→EPERM is load-bearing and un-fixable
- **What Windows does**: Hundreds of Win32 codes fan into ~40 POSIX errnos with no official mapping; several mappings are counterintuitive but ecosystem-frozen.
- **How libuv handles it**: One switch (error.c:66-174), negative codes passed through as already-translated (error.c:67-68). fs-relevant non-obvious entries, each a fossilized fix: ACCESS_DENIED→**EPERM** (not EACCES!); ELEVATION_REQUIRED→EACCES (11ce5df5); SHARING_VIOLATION/LOCK_VIOLATION→EBUSY; INVALID_FUNCTION→EISDIR (b68ee404); INVALID_NAME/BAD_PATHNAME/DIRECTORY/INVALID_DRIVE/INVALID_REPARSE_DATA→ENOENT (7b9bc28e, 5e507159, 162e57ba…); BUFFER_OVERFLOW/FILENAME_EXCED_RANGE→ENAMETOOLONG (7e6590f3 remapped BUFFER_OVERFLOW from E2BIG-ish history); CANT_RESOLVE_FILENAME→ELOOP; NOT_SAME_DEVICE→EXDEV; CANNOT_MAKE/EA_TABLE_FULL/END_OF_MEDIA/HANDLE_DISK_FULL→ENOSPC; WRITE_PROTECT→EROFS; SEM_TIMEOUT→ETIMEDOUT; NOACCESS→EFAULT; BAD_EXE_FORMAT→EFTYPE (36f0789d); ~14 tape/SCSI codes→EIO; INVALID_FLAGS/INVALID_HANDLE→EBADF (the FSIO-24 sentinel).
- **History**: The defining story: 04a35efe remapped ACCESS_DENIED→EACCES (technically correct per CRT) → broke the ecosystem → reverted in a6ba1d70 (#3565, nodejs/node#42340): "Although the change remapped the error code to the correct one, a lot of code already depends on the incorrect one, so it's not worth the breakage." Windows EPERM-where-Unix-says-EACCES is permanent node behavior.
- **Bun disposition**: must-port the table essentially verbatim into Bun's Rust error mapping (Bun already mirrors much of it for libuv parity); specifically keep ACCESS_DENIED→EPERM and INVALID_FUNCTION→EISDIR even though both look wrong. Every deviation is a node-compat bug. Target: src/sys/Error.rs.

### [FSIO-49] A second, write-only table exists because errno depends on operation direction
- **What Windows does**: See FSIO-25 — ERROR_BROKEN_PIPE and ERROR_NO_DATA mean different POSIX errnos for read vs write.
- **How libuv handles it**: `uv_translate_write_sys_error` (error.c:176-183) overrides exactly two codes then delegates. Only fs__write and stream-write paths call it; everything else uses the general table.
- **History**: 473dafc5 (2024) — notable as the *first* admission in 13 years that one global table can't work; kept minimal deliberately.
- **Bun disposition**: must-port (see FSIO-25); design Bun's translator with an op-kind parameter from day one instead of bolting on a second table. Target: src/sys/Error.rs.

## H. Environment and misc

### [FSIO-50] Wine: CloseHandle(INVALID_HANDLE_VALUE) aborts; Wine rejects NtSetInformationFile without explicit rights
- **What Windows does**: Real Windows tolerates CloseHandle(INVALID_HANDLE_VALUE) (returns FALSE); Wine (and Windows debug heaps/handle-checking modes) abort. Wine also fails attribute-setting calls on handles lacking FILE_WRITE_ATTRIBUTES where Windows is lenient (Wine bug 50771).
- **How libuv handles it**: 3b2c25d2 (#3473) restructured stat/utime helpers to early-return rather than ever reaching CloseHandle with INVALID_HANDLE_VALUE ("debug builds and/or wine being unhappy and aborting"); 6cf854c1 + the fs.c:1220-1239 ReOpenFile dance work around 50771 in unlink.
- **History**: as cited; Wine is an explicitly supported tier for libuv because CI farms and game-adjacent users run it.
- **Bun disposition**: should-port (Bun runs under Wine in some CI/user setups): never call CloseHandle on the invalid sentinel (Rust newtype for "valid handle" makes this free), and prefer re-open-with-rights over assuming leniency. Target: engine

### [FSIO-51] MapViewOfFile offsets must align to the allocation granularity (64KB), not the page size
- **What Windows does**: View base offsets must be multiples of `SYSTEM_INFO.dwAllocationGranularity` (64KB on all shipping Windows), a different and larger quantum than the 4KB page size; misaligned MapViewOfFile fails ERROR_MAPPED_ALIGNMENT.
- **How libuv handles it**: Granularity captured once at init (fs.c:176-181); filemap read/write compute `view_offset = pos % granularity; view_base = pos - view_offset` and map `view_offset + io_size` bytes (fs.c:794-800, 1001-1007).
- **History**: 2c279504.
- **Bun disposition**: must-carry for Bun.mmap / any Windows mapping code (offset parameter of Bun.mmap must round down to 64KB, not 4KB). Target: Bun.mmap.

### [FSIO-52] sendfile is a userland _read/_write loop over CRT fds — 64KB chunks, CRT seek, not filemap-aware
- **What Windows does**: TransmitFile exists only for sockets; there is no file-to-file splice.
- **How libuv handles it**: fs__sendfile (fs.c:2485-2529): malloc'd 64KB bounce buffer (`uv_fatal_error` on OOM!), `_lseeki64(fd_in, offset)` when offset != -1 (moves the real file pointer, no restore — deliberate POSIX-sendfile-ish semantics), CRT `_read`/`_write` loop. Bypasses the fd hash entirely, so FILEMAP fds silently use kernel position not fd_info.current_pos. Length capped at UV__IO_MAX_BYTES (fa0ac9ec).
- **History**: shape ancient; only the 2026 cap is new.
- **Bun disposition**: skip the implementation (Bun copies via its own CopyFile/clone-aware paths and node:fs has no sendfile-to-file); keep the lesson that fd-position-mutating helpers must be audited against any per-fd sidecar state. cross-ref: fs-copy area. Target: n/a.

### [FSIO-53] mkstemp: CREATE_NEW + ProcessPrng retry loop, TMP_MAX attempts, EEXIST-driven
- **What Windows does**: No O_TMPFILE; the only race-free unique-create primitive is CREATE_NEW (fails ERROR_FILE_EXISTS atomically).
- **How libuv handles it**: OpenBSD-derived fs__mktemp loop (fs.c:1297-1345): validates trailing `XXXXXX`, fills from `uv__random_winrandom` (ProcessPrng since 7484ab25 — bcryptprimitives.dll, no fallback needed on 1809+), calls CreateFileW(GENERIC_READ|GENERIC_WRITE, full sharing, CREATE_NEW); ERROR_FILE_EXISTS → retry, else fail (fs.c:1369-1414). On final success the *narrow* req->path is patched in place via wcstombs (template chars are ASCII so this is safe); on failure `path[0] = '\0'` is clobbered so callers can't use a half-written name (e208100f).
- **History**: a669f21b adopted the OpenBSD algorithm; 5500253c added mkstemp; e208100f the clobber-on-error.
- **Bun disposition**: should-port (Bun's tmp-file creation in src/sys/tmp.rs should use CREATE_NEW + OS CSPRNG retry exactly like this; the clobber-on-error contract is a nice touch worth keeping). cross-ref: fs-mkdir/temp area. Target: engine

### [FSIO-54] uv_fatal_error: FormatMessage + stderr + DebugBreak + abort for unrecoverable init/OOM
- **What Windows does**: n/a (policy).
- **How libuv handles it**: error.c:35-63: formats the Win32 message (notes FormatMessage strings already end in a newline — don't add another), prints `syscall: (code) message`, DebugBreak(), abort(). Used for: fd-hash mutex init failure, fd-hash group OOM, sendfile bounce-buffer OOM, missing ntdll exports.
- **History**: ancient. The DebugBreak-before-abort makes attached debuggers stop with context instead of after stack unwind.
- **Bun disposition**: should-port the shape into bun_core panic paths on Windows (include the Win32 message text and code; DebugBreak under debugger). Allocation failures: Bun routes through handle_oom instead of abort-in-syscall-wrapper — keep Bun's convention. Target: engine

### [FSIO-55] UNICODE_STRING lengths are USHORT bytes: anything building one must cap at 0x7FFF WCHARs
- **What Windows does**: UNICODE_STRING.Length/MaximumLength are USHORT *byte* counts, silently truncating longer paths if you cast; NT-level APIs (NtQueryDirectoryFile masks, NtCreateFile relative opens) consume them.
- **How libuv handles it**: `uv__RtlUnicodeStringInit` rejects > 0x7FFF WCHARs with STATUS_INVALID_PARAMETER before populating (fs.c:61-72); used by fs__opendir's filename mask.
- **History**: added with the readdir NT-path work (99440bb6 era).
- **Bun disposition**: must-port wherever Bun's Rust layer builds UNICODE_STRINGs (NtCreateFile-based opens in src/sys take this path today): validate length before the USHORT narrowing, error ENAMETOOLONG. cross-ref: fs-readdir. Target: engine

### [FSIO-56] Synchronous uv_fs_* with cb==NULL still requires uv_fs_req_cleanup, and the request carries no loop dependency
- **What Windows does**: n/a (API contract).
- **How libuv handles it**: The sync POST path returns req->result directly; paths/bufs allocated by capture_path/read/write still hang off the req until uv_fs_req_cleanup (fs.c:3233-3262). Tests routinely call `uv_fs_open(NULL, &req, ...)` — sync fs is loop-free by contract, which is why node can implement `fs.*Sync` without an event loop running.
- **History**: stable contract since the 2012 rework (d5acfd0c).
- **Bun disposition**: must-port the property: Bun's sync fs in the Rust layer must be callable with zero event-loop/threadpool state initialized (Bun's CLI cold paths — config loading, lockfile reads — depend on fs before the loop exists). Target: engine

---

## Tally (by each entry's primary disposition)

- Total quirks: 56
- must-port: 40 — FSIO-01, 03, 04, 05, 06, 07, 08, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 34, 35, 37, 39, 40, 42, 43, 44, 45, 48, 49, 51, 55, 56
- should-port: 10 — FSIO-02, 09, 29, 31, 41, 46, 47, 50, 53, 54
- skip: 6 — FSIO-17 (no CRT close in Rust layer), 32, 33, 36, 38 (FILEMAP mechanisms not ported; lessons retained for Bun.mmap), 52 (no file-to-file sendfile surface)

Entries with split dispositions (e.g. FSIO-39 "port the Nt truncate, skip the filemap choreography") are counted by their primary line; the skipped halves are recorded inline, never silently dropped.
