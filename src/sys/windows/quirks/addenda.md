# Addenda — entries added during the post-mining audit

These amend or extend the per-area sections. ADD-IDs are first-class ledger entries; two of
them override dispositions in earlier sections (noted inline).

### [ADD-01] Console codepage: never set it, never rely on it

- **What Windows does**: The console code page (`GetConsoleCP`/`GetConsoleOutputCP`) translates only the _A_-API and raw `ReadFile`/`WriteFile` paths on console handles. It is a property of the shared console object: `SetConsoleOutputCP(65001)` leaks into the parent shell after exit (same persistence hazard as input-mode leaks). conhost has a long-standing bug where `ReadFile`/`ReadConsoleA` under CP 65001 returns 0 bytes/garbage for non-ASCII input.
- **How libuv handles it**: Sidesteps the codepage entirely by using `WriteConsoleW`/`ReadConsoleW`/`ReadConsoleInputW` everywhere (see TTY-12, TTY-35). It never calls `SetConsoleCP`/`SetConsoleOutputCP`.
- **History**: added during the post-mining audit.
- **Bun disposition**: must-port (as a _rule_): all console I/O goes through W APIs; never set the codepage; know that fs-layer `WriteFile` on a console handle IS translated through `GetConsoleOutputCP` (cross-ref FSMETA-27, PIPE-57 — handle classification decides which path a console fd takes). Target: engine

### [ADD-02] No timeBeginPeriod, ever — timer coarseness is the contract

- **What Windows does**: Wait timeouts are quantized to the ~15.6 ms scheduler tick. Since Windows 10 2004, timer resolution is per-process-coalesced — another process raising resolution no longer helps yours. `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION` (1709+) is the modern opt-in for sub-tick precision.
- **How libuv handles it**: Deliberately never calls `timeBeginPeriod` (power/battery cost); instead retries the wait until the target time is reached (LOOP-02). setTimeout granularity up to one tick is documented Node behavior users probe.
- **History**: absence-of-code decision (post-mining audit).
- **Bun disposition**: must-port (the policy): match Node = do nothing; never call `timeBeginPeriod(1)` process-wide to fix "timers fire 15 ms late" reports; record `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION` as the sanctioned future alternative. Target: engine

### [ADD-03] What IOCP does and does not guarantee about ordering

- **What Windows does**: The completion queue is FIFO in _completion_ order, not submission order — two overlapped ops on one handle can complete out of issue order. `PostQueuedCompletionStatus` packets are FIFO relative to each other but interleave arbitrarily with kernel completions. Multi-threaded dequeue destroys even dequeue order.
- **How libuv handles it**: Single-consumer dequeue with IOCP concurrency value 1 (LOOP-06) is the only ordering-preserving model; data ordering is enforced above the port — serialized non-overlapped writes (PIPE-41), try_write refusal (SOCK-38), shutdown-after-writes (SOCK-39) exist precisely because completion order cannot order data.
- **History**: added during the post-mining audit.
- **Bun disposition**: must-port (doctrine in the loop crate docs): never assume submit order == completion order; never add multi-threaded GQCS consumers; data ordering lives in per-handle write queues. Target: engine

### [ADD-04] CancelIo cancels only the calling thread's I/O

- **What Windows does**: `CancelIo` (no Ex) cancels only operations issued by the _calling thread_. `CancelIoEx` cancels per-handle (optionally per-OVERLAPPED) regardless of thread. `NtCancelIoFileEx` is the per-IRP precision tool wepoll/mio use.
- **How libuv handles it**: Gets away with `CancelIo(socket)` in `uv__tcp_try_cancel_reqs` (SOCK-40) solely because every overlapped op is submitted from the loop thread — an invariant nowhere written down.
- **History**: added during the post-mining audit.
- **Bun disposition**: must-port (rule): any design that submits I/O from non-loop threads (Bun's fs threadpool does) must use `CancelIoEx`/`NtCancelIoFileEx`; a copied `CancelIo` silently cancels nothing. Cross-ref POLL-32, PIPE-35. Target: engine

### [ADD-05] CRT invalid-parameter-handler: one decision, six entries (resolves conflict)

- **What Windows does**: CRT fd APIs (`_get_osfhandle`, `_close`, …) on invalid fds invoke the invalid-parameter handler (process death in release; assert dialog in debug CRT).
- **How libuv handles it**: Installs a no-op `_set_invalid_parameter_handler` + `_CrtSetReportHook` at init (LOOP-41/42) so probing bad fds returns EBADF instead of terminating.
- **History**: FSIO-18, TTY-04, LOOP-41, LOOP-42, PIPE-56, PROC-31, POLL-14 gave conflicting dispositions.
- **Bun disposition**: **must-port while any CRT fd API is reachable from user input** (node:fs integer fds, N-API `uv_open_osfhandle`-created fds during transition, the Phase 0 `_get_osfhandle` stdio repair). Becomes deletable only when decision #3's fd collapse completes AND the Phase 4 stub flip removes addon CRT-fd interop — re-evaluate then, do not delete piecemeal. All six area entries are normalized to this disposition. Target: engine

### [ADD-06] Empty-directory ERROR_FILE_NOT_FOUND is must-port (raises FSLNK-40)

- **What Windows does**: Some filesystems (sshfs-win/WinFsp and other userland FS) fail `FindFirstFileW` on an _empty_ directory with ERROR_FILE_NOT_FOUND instead of returning the dot entries; the NtQueryDirectoryFile equivalent surfaces as STATUS_NO_SUCH_FILE.
- **How libuv handles it**: Treats ERROR_FILE_NOT_FOUND from FindFirstFileW as success-with-zero-entries (FSLNK-40/41; HIST-45).
- **History**: HIST-45 dispositioned must-port; FSLNK-40 said should-port — conflict resolved in favor of must-port.
- **Bun disposition**: must-port: Bun's readdir and glob walker (which use NtQueryDirectoryFile per FSLNK-32) must treat STATUS_NO_SUCH_FILE / ERROR_FILE_NOT_FOUND on an opened directory as empty-dir, not ENOENT. Target: engine

### [ADD-07] Case sensitivity is per-directory on modern NTFS

- **What Windows does**: Since Win10 1803, directories can be case-sensitive (`FILE_CASE_SENSITIVE_INFO`, set by WSL by default for WSL-created dirs or via `fsutil file setCaseSensitiveInfo`). `foo.js` and `Foo.js` can coexist; `CreateFileW("FOO.JS")` then fails.
- **How libuv handles it**: It doesn't — and that absence is the lesson: libuv never canonicalizes by case-folding; identity comparisons use dev+ino (FSMETA-08/22) or final paths.
- **History**: added during the post-mining audit.
- **Bun disposition**: must-port (doctrine): path-string case comparison is never an identity test in the resolver, watcher filters, install linker, or caches; use dev+ino or `GetFinalPathNameByHandleW`. Cross-ref SIGEV-31 (the watcher filter's `_wcsnicmp` vs NTFS $UpCase divergence — already imperfect upstream). Target: engine

### [ADD-08] CreateProcessW length limits: command line 32767 WCHARs; application path is not longPathAware

- **What Windows does**: `lpCommandLine` is hard-capped at 32767 WCHARs. `lpApplicationName`/`lpCurrentDirectory` do NOT get longPathAware-manifest relief (PROC-24 covers cwd) — long exe paths need `\\?\` or short names.
- **How libuv handles it**: Only the cwd MAX_PATH cap is handled (GetShortPathNameW). Oversized command lines surface as whatever CreateProcessW returns.
- **History**: added during the post-mining audit.
- **Bun disposition**: must-port: Bun.spawn pre-validates — oversized command line → E2BIG with a real message; over-long exe path → ENAMETOOLONG or `\\?\`-prefixed retry. Do NOT over-generalize FSIO-13's rely-on-the-manifest guidance to CreateProcess parameters. Target: engine
