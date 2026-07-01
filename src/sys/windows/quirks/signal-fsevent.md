# libuv Windows institutional knowledge — signal.c & fs-event.c

Source worktree: `C:/Users/dylan/code/libuv-read` (HEAD includes 44125af6, Mar 2026).
Files: `src/win/signal.c`, `src/win/fs-event.c`, plus load-bearing context in
`include/uv/win.h`, `src/win/req-inl.h`, `src/win/core.c`, `src/win/tty.c`, `src/win/util.c`.

---

## Signals

### [SIGEV-01] Register ONE process-wide console ctrl handler at init; never unregister it

- **What Windows does**: `SetConsoleCtrlHandler(h, FALSE)` called from inside a ctrl-handler thread deadlocks — the console host holds the handler-list lock while a handler runs. Per-watcher register/unregister is therefore unsafe whenever a signal is being delivered concurrently.
- **How libuv handles it**: One global handler registered exactly once in `uv__signals_init()` (signal.c:42-46), called from process-wide `uv__once_init()` (core.c:214). `abort()` if registration fails. Unregistration never happens; watchers come and go only in the RB-tree registry. Earlier design had a refcounted register/unregister scheme — removed wholesale.
- **History**: c66f265b "win,signal: fix potential deadlock" (libuv#1168, nodejs/node#10165). Before that, the refcount itself was buggy — forgot to increment on the already-registered path — fixed twice (0c726e76 on master, b9d5396a backport). The whole refcount mechanism (c4dbb60c, 2012) was deleted in 2016.
- **Bun disposition**: must-port (register once at process init, never unhook; treat watcher add/remove as pure registry ops). Target: engine

### [SIGEV-02] The ctrl handler runs on OS-injected threads; dispatch must be allocation-free and thread-safe

- **What Windows does**: For each console event the system injects a **new thread** into the process to run the handler. Multiple events can run handlers concurrently. The handler is fully asynchronous w.r.t. all event loops.
- **How libuv handles it**: `uv__signal_dispatch()` (signal.c:80-113) does only: take a `CRITICAL_SECTION` (signal.c:33,87), walk the RB-tree, `InterlockedExchange` a per-handle field, and `PostQueuedCompletionStatus` a **pre-allocated** req embedded in the handle (`signal_req`, win.h:656-659). No malloc, no loop-state access, no callbacks on the handler thread.
- **History**: original design c4dbb60c (2012); unchanged since — the structural constraint is the lesson.
- **Bun disposition**: must-port (handler thread may only touch a global lock + atomics + PQCS with preallocated payloads). Target: engine

### [SIGEV-03] Event mapping: CTRL_C→SIGINT, CTRL_BREAK→SIGBREAK; handler chain is LIFO

- **What Windows does**: Console delivers `CTRL_C_EVENT` and `CTRL_BREAK_EVENT`; there is no kernel SIGINT. Registered handlers are called last-registered-first; returning TRUE stops the chain.
- **How libuv handles it**: signal.c:116-144 maps CTRL_C→SIGINT, CTRL_BREAK→SIGBREAK (SIGBREAK=21 is a Windows-CRT-only signal that Node exposes). Because libuv registers at init, any handler the embedder registers _later_ runs _before_ libuv's.
- **History**: c4dbb60c; code comment only for the mapping.
- **Bun disposition**: must-port (incl. SIGBREAK for Node compat; document handler-ordering interaction if Bun ever adds its own crash handler via ctrl handler). Target: engine

### [SIGEV-04] Handler return value controls default termination — emulates POSIX "default action"

- **What Windows does**: Returning FALSE from the ctrl handler passes the event to the next/default handler, which calls `ExitProcess` (kills the process). Returning TRUE marks it handled and the process lives.
- **How libuv handles it**: `uv__signal_dispatch()` returns 1 iff ≥1 active watcher consumed the signum; the ctrl handler returns that as TRUE/FALSE (signal.c:118-122). Net effect: with no JS listener the process dies (POSIX default action); with a listener it survives. This is the exact mechanism behind Node's "process exits on Ctrl-C unless a SIGINT listener exists".
- **History**: c4dbb60c; doc comment at signal.c:75-79.
- **Bun disposition**: must-port (the dispatched-count→return-value coupling is the compat-critical part). Target: engine

### [SIGEV-05] CTRL_CLOSE→SIGHUP with the Sleep(INFINITE) grace trick

- **What Windows does**: After the handler returns for `CTRL_CLOSE_EVENT` (console window closed, tab closed, End Task), Windows terminates the process immediately. The OS grants a grace window (~5s, system-controlled) only while the handler has _not yet returned_.
- **How libuv handles it**: If SIGHUP was dispatched to a watcher, the handler thread calls `Sleep(INFINITE)` and never returns (signal.c:124-132) — deliberately wedging the injected thread so the main loop gets the grace period to run SIGHUP callbacks and exit gracefully; otherwise return FALSE for instant default termination. The `return TRUE` after the Sleep is unreachable by design.
- **History**: c4dbb60c; the comment (signal.c:126-129) is the spec.
- **Bun disposition**: must-port (without it, `process.on('SIGHUP')` never observably runs on console close). Target: engine

### [SIGEV-06] CTRL_LOGOFF / CTRL_SHUTDOWN deliberately ignored

- **What Windows does**: Logoff/shutdown notifications are delivered to console apps and (historically) services; services have SERVICE*CONTROL*\* instead, and console apps are about to be killed by the session teardown regardless.
- **How libuv handles it**: Falls through to `return FALSE` — never mapped to any signal (signal.c:135-142). Comment says "only sent to services" (slightly overstated, but the ignore is deliberate: no useful grace semantics exist for these).
- **History**: c4dbb60c; code comment only.
- **Bun disposition**: must-port (do not synthesize SIGHUP/SIGTERM for logoff/shutdown; matches Node behavior). Target: engine

### [SIGEV-07] Fake POSIX signal numbers defined in the public header; NSIG must be re-derived

- **What Windows does**: The MSVC CRT defines only SIGINT=2, SIGILL=4, SIGABRT_COMPAT=6, SIGFPE=8, SIGSEGV=11, SIGTERM=15, SIGBREAK=21, SIGABRT=22, and `NSIG=23`. No SIGHUP/SIGQUIT/SIGKILL/SIGWINCH. MinGW additionally lacks SIGABRT_COMPAT.
- **How libuv handles it**: win.h:70-102 defines SIGHUP=1, SIGQUIT=3, SIGKILL=9, SIGWINCH=28 (values chosen to match Linux/Darwin), then **redefines NSIG to SIGWINCH+1** because CRT NSIG (23) < SIGWINCH (28) — without that, `signum >= NSIG` validation rejects SIGWINCH. Defines SIGABRT_COMPAT=6 for MinGW.
- **History**: 20f23518 (libuv#2032) — before it, validation had a special `signum != SIGWINCH &&` carve-out; the NSIG redefinition replaced the carve-out.
- **Bun disposition**: must-port (Bun must pick one signal-number table for Windows; reuse libuv's Linux-compatible values and derive the validation limit from the table, not the CRT). Target: engine

### [SIGEV-08] Watchers for unraisable signals are accepted silently (POSIX deviation)

- **What Windows does**: There are no kernel-delivered SIGTERM/SIGSEGV/SIGKILL etc.; only console events exist.
- **How libuv handles it**: `uv__signal_start` validates only range `0 < signum < NSIG` (signal.c:197-199). Watching SIGTERM, SIGKILL, SIGSEGV... succeeds and simply never fires. On Unix, libuv rejects SIGKILL/SIGSTOP with EINVAL — Windows does not, so `uv_signal_start(SIGKILL)` succeeds on Windows and fails on Linux.
- **History**: older code had explicit per-signum switch returning "never raised" for SIGILL/SIGTERM/etc. and EINVAL otherwise (c4dbb60c); collapsed to a pure range check when registration became global (c66f265b).
- **Bun disposition**: must-port (Node-level semantics rely on this: `process.on('SIGTERM')` is a silent no-op on Windows, not an error; decide deliberately whether to mirror the SIGKILL-accepted asymmetry). Target: engine

### [SIGEV-09] Process-global watcher registry: RB-tree keyed (signum, loop*, handle*) under one critical section

- **What Windows does**: Nothing — there is no per-loop signal infrastructure; one console event must fan out to every loop (incl. worker threads' loops) that has a watcher.
- **How libuv handles it**: One static RB-tree (signal.c:30-33). Comparator orders by signum, then loop pointer, then handle pointer (signal.c:54-69) so `RB_NFIND` with `{signum, loop=NULL}` lands on the first watcher for that signum and iteration stops when signum changes (signal.c:92-94). Insert/remove in start/stop take the same lock the dispatch thread takes (signal.c:167-172, 217-225).
- **History**: c4dbb60c; structure unchanged 13+ years.
- **Bun disposition**: must-port (concept: one process-global, lock-protected multimap signum→watchers across all loops; exact data structure free). Target: engine

### [SIGEV-10] `pending_signum` doubles as in-flight flag: InterlockedExchange coalescing, one completion per burst

- **What Windows does**: Rapid repeated Ctrl-C spawns multiple handler threads; naive design would flood the IOCP or require allocation per signal.
- **How libuv handles it**: Dispatch does `previous = InterlockedExchange(&handle->pending_signum, signum)` and posts the embedded `signal_req` **only when previous==0** (signal.c:95-103). The loop side exchanges it back to 0 (signal.c:241-243) and asserts nonzero. Result: bursts coalesce into one callback; exactly one completion can be in flight; the req is embedded so no allocation ever happens on the handler thread.
- **History**: c4dbb60c; volatile-LONG cast added for MinGW -Wall (1ec4c234).
- **Bun disposition**: must-port (atomic swap-based coalescing + single embedded completion token per watcher). Target: engine

### [SIGEV-11] Stop/restart race: re-check signum when the completion is processed

- **What Windows does**: A posted IOCP completion cannot be revoked; it may be dequeued after the watcher was stopped, or stopped-and-restarted on a _different_ signum.
- **How libuv handles it**: `uv__process_signal_req` fires the callback only `if (dispatched_signum == handle->signum)` (signal.c:244-249) — a stale completion for the old signum is silently swallowed. Comment documents the stop/restart desync explicitly.
- **History**: c4dbb60c; code comment only.
- **Bun disposition**: must-port (any swap-and-post design needs the consume-side identity re-check). Target: engine

### [SIGEV-12] Restarting on the SAME signum short-circuits instead of stop+start

- **What Windows does**: n/a (libuv-internal race): between `uv_signal_stop` and re-insert there is a window where `handle->signum==0` and a concurrent dispatch would skip the watcher — the signal would be lost.
- **How libuv handles it**: `uv__signal_start` with `signum == handle->signum` just swaps the callback and returns (signal.c:201-208), explicitly to avoid that lost-signal window.
- **History**: c4dbb60c; code comment only ("avoids pending signals getting lost in the (small) time frame that handle->signum == 0").
- **Bun disposition**: must-port. Target: engine

### [SIGEV-13] One-shot watchers need a second flag to suppress repeat posts before processing

- **What Windows does**: n/a (semantics): a one-shot watcher must fire at most once even if the signal arrives multiple times before the loop processes the first completion.
- **How libuv handles it**: `UV_SIGNAL_ONE_SHOT_DISPATCHED` set at dispatch time under the global lock; later dispatches `continue` past the handle (signal.c:98-107). Note ordering quirk: the `InterlockedExchange` still happens _before_ the DISPATCHED check (harmless — same signum). Processing side calls `uv_signal_stop` after the callback (signal.c:251-252).
- **History**: 45616f54 (libuv#1106, issue #1104) — added for Node's `process.once` semantics and self-re-raise patterns.
- **Bun disposition**: should-port (needed only if Bun exposes one-shot semantics at the loop layer; Node-level `once` can also be done in JS — decide once signal API shape is fixed). Target: engine

### [SIGEV-14] Close protocol: defer endgame while a signal completion is in flight

- **What Windows does**: The posted completion references memory inside the handle; freeing/closing the handle before the completion is dequeued is a UAF.
- **How libuv handles it**: `uv__signal_close` stops the watcher (so no new posts) and endgames immediately **only if** `pending_signum == 0`; otherwise the in-flight completion's `uv__process_signal_req` sees `UV_HANDLE_CLOSING` and endgames (signal.c:254-258, 262-269). Endgame asserts both signum and pending_signum are 0 (signal.c:272-282).
- **History**: c4dbb60c; assert bugs in endgame fixed by 328f29b0.
- **Bun disposition**: must-port (close must rendezvous with the in-flight completion token). Target: engine

### [SIGEV-15] uv_signal_stop is infallible by design

- **What Windows does**: n/a — fallible stop existed only because per-watcher unregistration of the ctrl handler could fail.
- **How libuv handles it**: Since the global handler is never unregistered, stop is pure registry removal and cannot fail (signal.c:160-178); `uv__signal_start` asserts this when restarting (signal.c:211-215).
- **History**: 8073a263 made it infallible (2012) even before the registration scheme was deleted; c66f265b finished the job.
- **Bun disposition**: must-port (design rule: watcher teardown must be a non-failing pure data-structure op; everything fallible happens once at init). Target: engine

### [SIGEV-16] SIGWINCH is synthesized by the tty layer through the same dispatch path

- **What Windows does**: There is no SIGWINCH; console size changes are observable only by polling/console events.
- **How libuv handles it**: tty.c's console-resize monitoring calls `uv__signal_dispatch(SIGWINCH)` directly (tty.c:2443) — the signal registry doubles as an in-process event bus, and watchers can't tell synthetic from real. First-computation suppression avoids a spurious SIGWINCH at startup (564e7c76).
- **History**: 564e7c76 (2012); NSIG interplay in SIGEV-07.
- **Bun disposition**: must-port (Node emits SIGWINCH on console resize; route Bun's console-resize detection through the same dispatch entry point). Target: engine

### [SIGEV-17] Library shutdown does NOT unhook the ctrl handler (deliberate no-op cleanup)

- **What Windows does**: Unhooking is unsafe if a handler thread is currently running or parked in Sleep(INFINITE) (see SIGEV-01/05).
- **How libuv handles it**: `uv__signal_cleanup()` on Windows is an empty TODO (signal.c:49-51), called from `uv_library_shutdown` (uv-common.c:1002). The DeleteCriticalSection/unhook is intentionally skipped.
- **History**: 72fe3543 added uv_library_shutdown; the Windows TODO has survived every cleanup pass — treat that as a decision, not an omission.
- **Bun disposition**: must-port (as a rule: never tear down the signal hook at exit; leak the registration). Target: engine

### [SIGEV-18] InterlockedExchange type gymnastics (unsigned long field, volatile LONG\* cast)

- **What Windows does**: `InterlockedExchange` takes `volatile LONG*`; the field is `unsigned long pending_signum` (win.h:659), so MinGW -Wall warned about the implicit conversion.
- **How libuv handles it**: Explicit `(volatile LONG*)` casts at both exchange sites (signal.c:95-96, 241-242); consume side reads into `long` (939a8f1a, 1ec4c234).
- **History**: 1ec4c234 (MinGW -Wall -O3), 939a8f1a.
- **Bun disposition**: skip (C-ABI artifact; Rust uses `AtomicU32`/`AtomicI32` with native swap — no porting needed). Target: n/a.

### [SIGEV-19] PostQueuedCompletionStatus failure is fatal, not silent

- **What Windows does**: PQCS can fail (kernel resource exhaustion, bad IOCP handle).
- **How libuv handles it**: `POST_COMPLETION_FOR_REQ` aborts via `uv_fatal_error` on failure (req-inl.h:76-82) — a lost signal completion would otherwise wedge close protocols (SIGEV-14) and silently drop signals.
- **History**: original macro design.
- **Bun disposition**: must-port (failure to enqueue the wakeup must be loud — panic/abort, never ignored — because handle lifecycle correctness depends on the completion arriving). Target: engine

### [SIGEV-20] Historical foot-guns: switch fall-through in endgame dispatch; assignment-in-assert

- **What Windows does**: n/a.
- **How libuv handles it**: 328f29b0 fixed (a) a missing `break` after the UV_SIGNAL endgame case in the central endgame switch — signal endgames fell through into process endgames; (b) `assert(handle->signum = 0)` assignment typos that _cleared the field in debug builds and vanished in release_.
- **History**: 328f29b0 "windows: fix stupid uv_signal bugs" (2012).
- **Bun disposition**: skip (generic C hazards; Rust match exhaustiveness and `assert_eq!` eliminate the class — recorded so reviewers recognize the pattern in any C++ shims). Target: n/a.

### [SIGEV-21] Adjacent signal semantics living outside signal.c (cross-area map)

- **What Windows does**: (a) CTRL_C is only generated when console input has `ENABLE_PROCESSED_INPUT` — raw-mode stdin (Node `setRawMode(true)`) turns Ctrl-C into a key event, no SIGINT; (b) there is no kill(2): `uv_kill`/`uv_process_kill` emulate — signum 0 = liveness probe, SIGTERM/SIGKILL/SIGINT → `TerminateProcess`, and SIGQUIT triggers a WER LocalDumps minidump write if the registry key exists (process.c:1174-1210); none of these route through uv_signal watchers, and `raise()` in-process also bypasses them.
- **How libuv handles it**: division of labor — signal.c only handles console events + synthetic SIGWINCH; everything else is tty.c/process.c.
- **History**: process.c SIGQUIT/WER added 2023-era; cross-file invariant.
- **Bun disposition**: should-port (cross-ref: TTY area for raw-mode/CTRL_C interaction, PROCESS area for uv_kill emulation; signal module must document that self-raised CRT signals never reach watchers). Target: engine

---

## fs-event (ReadDirectoryChangesW watcher)

### [SIGEV-22] 4KB fixed event buffer, allocated once, reused forever, freed only at endgame

- **What Windows does**: RDCW writes change records into a caller-owned buffer asynchronously; the kernel may write into it until the (possibly canceled) operation completes. For network paths, buffers >64KB fail (documented network limit).
- **How libuv handles it**: `uv_directory_watcher_buffer_size = 4096` (fs-event.c:33); allocated lazily in start (`if (!handle->buffer)`, fs-event.c:295-300) so restart reuses it; `uv_fs_event_stop` deliberately does NOT free it (fs-event.c:374-406); only `uv__fs_event_endgame` frees after `req_pending` drains (fs-event.c:645-656). Freeing at stop would be a kernel-write-into-freed-heap UAF.
- **History**: 4096 chosen in the original watcher (1e0757ff, 2011) and never changed; small enough for the 64KB network limit, one page.
- **Bun disposition**: must-port (buffer lifetime tied to "no completion in flight", not to stop(); size: keep ≤64KB for SMB; 4KB is the battle-tested default — overflow path SIGEV-43 is the relief valve). Target: fs.watch / RDCW watcher.

### [SIGEV-23] The RDCW buffer must be DWORD-aligned

- **What Windows does**: RDCW fills the buffer with `FILE_NOTIFY_INFORMATION` records (DWORD fields); the API requires DWORD alignment of the buffer (misalignment → ERROR_NOACCESS).
- **How libuv handles it**: Original code used `_aligned_malloc(size, sizeof(DWORD))` (1e0757ff fs-event.c:204); the uv_replace_allocator work (c272f1f1 → reverted 1f711e4d → re-landed bddd6a84) switched to `uv__malloc`, relying on malloc's natural ≥8-byte alignment.
- **History**: the revert/re-land of the allocator change is why the explicit alignment vanished — the requirement didn't.
- **Bun disposition**: must-port (CRITICAL for Rust: `Vec<u8>` has alignment 1 — allocate with `align ≥ 4` (e.g. layout-aligned alloc or Vec<u32>) before passing to RDCW). Target: fs.watch / RDCW watcher.

### [SIGEV-24] Full notify filter mask — all 8 FILE*NOTIFY_CHANGE*\* bits

- **What Windows does**: The filter selects which change classes generate records; narrower masks miss event types (e.g. attribute-only changes, security descriptor edits).
- **How libuv handles it**: Both arm sites pass FILE_NAME|DIR_NAME|ATTRIBUTES|SIZE|LAST_WRITE|LAST_ACCESS|CREATION|SECURITY (fs-event.c:47-54, 309-316) — everything, trading extra wakeups for never missing a class. Identical mask in both call sites (initial arm + re-arm) must stay in sync.
- **History**: 1e0757ff; never narrowed.
- **Bun disposition**: must-port (use the full mask; share one constant between initial-arm and re-arm so they can't diverge). Target: fs.watch / RDCW watcher.

### [SIGEV-25] Native recursion via bWatchSubtree; subtree events arrive as relative paths with backslashes

- **What Windows does**: `bWatchSubtree=TRUE` makes the kernel watch the whole subtree; record names are always relative to the watched directory and contain backslashes for nested entries (`sub\file.txt`).
- **How libuv handles it**: `UV_FS_EVENT_RECURSIVE` maps straight to bWatchSubtree (fs-event.c:46, 308); names are passed through as-is (after long-name fixup), so consumers see `sub\file` style relative paths.
- **History**: 188e0e94 (libuv#421, originally joyent/libuv#1473) — Windows and macOS are the only native-recursive platforms.
- **Bun disposition**: must-port (Node's `fs.watch {recursive:true}` contract; keep relative-with-backslash names for compat). Target: fs.watch / RDCW watcher.

### [SIGEV-26] LATENT BUG: re-arm tests `handle->flags & UV_FS_EVENT_RECURSIVE` — which collides with UV_HANDLE_ACTIVE

- **What Windows does**: n/a — pure libuv bug with an archaeology twist.
- **How libuv handles it (buggy)**: The user's `flags` argument is used correctly for the FIRST arm (fs-event.c:308) but is **never stored**. Every re-arm reads `handle->flags & UV_FS_EVENT_RECURSIVE` (fs-event.c:46). `UV_FS_EVENT_RECURSIVE = 4` (uv.h:1767) and `UV_HANDLE_ACTIVE = 0x00000004` (uv-common.h:84). Since re-arm only happens while active, **every re-arm after the first event batch is recursive, even for non-recursive watches**.
- **History**: introduced by 188e0e94 (2015) when Windows `UV__HANDLE_ACTIVE` was 0x40 and bit 0x4 was unused in handle->flags — so 2015-2018 the bug had the OPPOSITE polarity: _recursive_ watches silently degraded to non-recursive after the first batch. The flags merge 619937c7 (2018, libuv#1904) moved ACTIVE onto bit 4 and flipped it to _non-recursive watches silently become recursive_. Never fixed upstream as of this tree; verified by inspection (`git show 188e0e94:src/uv-common.h`). This explains long-standing Node reports of `fs.watch` without `recursive` emitting subdirectory events on Windows.
- **Bun disposition**: must-port THE FIX, not the bug: store the recursive option in a dedicated field at start and use it for every re-arm. Never overlay user flags onto lifecycle flag words. Target: fs.watch / RDCW watcher.

### [SIGEV-27] Watching a FILE = watching its parent directory + name filtering

- **What Windows does**: RDCW only watches directories; there is no per-file watch primitive.
- **How libuv handles it**: If the path isn't a directory, split into dir+basename (fs-event.c:203-236), open and watch the parent, and filter records by name in `uv__process_fs_event_req` (fs-event.c:471-477). Events for sibling files are parsed and discarded — the comment admits "Not super efficient but c'est ça" (fs-event.c:243-246). N single-file watchers in one big directory each receive and discard the full event stream.
- **History**: 1e0757ff; structure unchanged.
- **Bun disposition**: must-port (incl. the perf caveat in docs; consider a shared-parent-watch optimization later, but ship the libuv shape first). Target: fs.watch / RDCW watcher.

### [SIGEV-28] File filter must match BOTH the long name AND the 8.3 short name, case-insensitively

- **What Windows does**: RDCW reports whichever name form the _modifying_ process used — if another program opened `LONGFI~1.TXT`, the change record says `LONGFI~1.TXT`, not `longfilename.txt`.
- **How libuv handles it**: At start, `GetShortPathNameW` on the full path, then split off the short basename into `short_filew` (fs-event.c:209-236); the event filter accepts a record if it equals `filew` OR `short_filew` (fs-event.c:471-477).
- **History**: 012fc079 "fixes #193" (2011) — one of the earliest fs-event bugs ever filed.
- **Bun disposition**: must-port (without it, file watches miss events from 8.3-using programs — installers, old tooling, cmd.exe scripts). Target: fs.watch / RDCW watcher.

### [SIGEV-29] GetShortPathNameW can fail legitimately — 8.3 names are per-volume optional

- **What Windows does**: 8.3 short-name generation is controlled by `NtfsDisable8dot3NameCreation` (default mode 2 = per-volume; non-system volumes are typically formatted with 8.3 OFF on modern Windows). Files also may simply lack a short name, and the call needs no special privilege but can fail with the file open elsewhere.
- **How libuv handles it**: Short-path conversion failure is tolerated: `short_filew` stays NULL (fs-event.c:210-226), `file_info_cmp(NULL, ...)` returns -1 = no match (fs-event.c:412-413), so only long-name matching applies. Note the regression-test blind spot: `fs_event_watch_dir_short_path` self-skips when the volume has no 8.3 names (test-fs-event.c:648-653) — i.e. CI on 8.3-less volumes does not exercise any of the short-name machinery.
- **History**: 671ad783 (libuv#1267, issue #1258): before it, GetShortPathNameW failure aborted `uv_fs_event_start` entirely — watching such files was impossible.
- **Bun disposition**: must-port (treat short-name absence as "no second alias", never an error; replicate the per-volume test skip caveat in Bun's CI awareness). Target: fs.watch / RDCW watcher.

### [SIGEV-30] FILE_NOTIFY_INFORMATION.FileName is NOT NUL-terminated and FileNameLength is in BYTES

- **What Windows does**: Records pack a counted UTF-16 string; reading past `FileNameLength` bytes walks into the next record or garbage. Length is bytes, not WCHARs.
- **How libuv handles it**: Every use divides by `sizeof(WCHAR)` (fs-event.c:490, 498, 534, 543) and all comparisons are length-bounded. `file_info_cmp` compares **lengths first** then `_wcsnicmp` (fs-event.c:409-425) — the length pre-check exists because `_wcsnicmp(str, name, len)` alone is a _prefix_ comparison: watching `file` used to match events for `file2`.
- **History**: da323447 "file_info->FileName is not null terminated" (invalid memory access fix); 77c8abae "compare entire filename" (libuv#924, refs #682) fixed the prefix-match false positives.
- **Bun disposition**: must-port (in Rust: build `&[u16]` slices from (ptr,len/2), never assume NUL; compare full lengths). Target: fs.watch / RDCW watcher.

### [SIGEV-31] Case-insensitive comparison uses CRT `_wcsnicmp`, which is NOT NTFS's case folding

- **What Windows does**: NTFS case-insensitivity uses the per-volume `$UpCase` table (full UTF-16 upcase map); CRT `_wcsnicmp` does locale-ish folding that diverges for many non-ASCII characters.
- **How libuv handles it**: Uses `_wcsnicmp` anyway (fs-event.c:424, 72) — an accepted approximation; mismatches are possible for exotic filenames (event arrives in a case variant the CRT folds differently).
- **History**: original code; never revisited upstream.
- **Bun disposition**: should-port (improvement opportunity: use `CompareStringOrdinal(..., bIgnoreCase=TRUE)`, which is documented to match kernel/NTFS semantics; at minimum document the divergence). Target: fs.watch / RDCW watcher.

### [SIGEV-32] Directory-watch names are canonicalized to long form at EVENT time — except REMOVED/RENAMED_OLD

- **What Windows does**: Records may contain 8.3 names (see SIGEV-28); converting to long form requires the file to still exist (`GetLongPathNameW` hits the filesystem).
- **How libuv handles it**: For dir watches, build `dirw + "\" + FileName`, call GetLongPathNameW, and report the path relative to the watch root via `uv__relative_path` (fs-event.c:479-535). For `FILE_ACTION_REMOVED` and `FILE_ACTION_RENAMED_OLD_NAME` the conversion is skipped (file is gone) and the raw RDCW-reported name is forwarded, which **may be an 8.3 name** (fs-event.c:536-544). If conversion fails for live files, fall back to the raw name too (fs-event.c:531-535).
- **History**: 4d1d02fd (2011) introduced long-name resolution but reported **NULL** for removed/renamed-old; e0250b7d (libuv#639, issue #634, refs #199) changed NULL → raw name because NULL forced consumers into multi-second full-subtree rescans; with the (possibly short) name they can do targeted partial rescans. Commit message is the spec for WHY.
- **Bun disposition**: must-port (exact behavior incl. the 8.3-may-leak-through caveat — Node ecosystem (chokidar etc.) compensates for it; reporting NULL again would be a regression). Target: fs.watch / RDCW watcher.

### [SIGEV-33] GetLongPathNameW two-call size semantics differ between query and fill

- **What Windows does**: With cchBuffer=0 it returns required size **including** the NUL; on success it returns chars written **excluding** the NUL. (GetShortPathNameW and GetCurrentDirectoryW share this convention.)
- **How libuv handles it**: Allocates `size` from the query call, then writes `long_filenamew[size] = 0` using the _second_ (smaller) return value (fs-event.c:504-518) — safe only because second == first - 1. Failure of the second call (race: path changed between calls) frees and falls back (fs-event.c:515-518).
- **History**: 4d1d02fd; the pattern survived every refactor — and the second-call-can-fail race is acknowledged as intrinsic in 8fc70344's commit message.
- **Bun disposition**: must-port (wrap the two-call dance in one helper with the off-by-one encoded once; handle second-call failure as fallback-not-error). Target: fs.watch / RDCW watcher; cross-ref: PATHS/UTIL area (same convention everywhere).

### [SIGEV-34] `uv__relative_path` assumes dirw is a true prefix — and the start-time long-path normalization that guaranteed it was recently REMOVED

- **What Windows does**: If the user starts a watch via an 8.3 path (`watch_~1`), GetLongPathNameW of `watch_~1\file` returns `watch_dir\file` — the stored dir is no longer a string prefix of the canonicalized event path.
- **How libuv handles it**: `uv__relative_path` asserts the prefix relation (`assert(!_wcsnicmp(filename, dir, dirlen))`, fs-event.c:72) and does raw index arithmetic after it. 7e865b68 (libuv#1769, nodejs/node#19170) fixed assert failures by converting the watched directory to long form at start. **8fc70344 (Nov 2025) deleted that normalization** during the TOCTOU refactor — and the guarding test (`fs_event_watch_dir_short_path`) self-skips on volumes without 8.3 names (SIGEV-29), so the regression risk is invisible on most modern CI. In release builds the assert vanishes and the arithmetic produces a corrupted relative path.
- **History**: 7e865b68 added; 8fc70344 silently removed — a reverted-approach loop nobody has noticed yet.
- **Bun disposition**: must-port (normalize the watch root once at start — best: `GetFinalPathNameByHandleW` on the already-opened handle, which is race-free unlike by-path GetLongPathNameW — and make relative-path extraction validate the prefix at runtime, not by assert). Target: fs.watch / RDCW watcher.

### [SIGEV-35] Keep the trailing backslash when splitting: `\\?\C:` opens the DRIVE, not the root directory

- **What Windows does**: `C:` is a drive-relative reference (current dir on C:), and `\\?\C:` opens the volume device; only `C:\` names the root directory.
- **How libuv handles it**: `uv__split_path` includes the trailing separator in the dir part (`wcsncpy(*dir, filename, i + 1)`, fs-event.c:119-126), so watching `C:\file.txt` watches `C:\`, and `uv__relative_path` strips one trailing backslash when computing offsets (fs-event.c:73-74).
- **History**: 3c59ad6d (libuv#689, nodejs/node#4643) — watching files in the drive root was broken before.
- **Bun disposition**: must-port (root-directory parent paths must keep the separator; add a `C:\file` test). Target: fs.watch / RDCW watcher.

### [SIGEV-36] Bare-filename watch resolves the parent to GetCurrentDirectoryW

- **What Windows does**: A path with no separator has an implicit CWD parent; CWD length is unbounded (long-path world).
- **How libuv handles it**: `uv__split_path` with no separator queries `GetCurrentDirectoryW(0, NULL)` for size, allocates, then fills (fs-event.c:99-117) — two-call dynamic sizing, failure → -1.
- **History**: original; MAX_PATH-fixed buffer until da7e50bb (#2331).
- **Bun disposition**: must-port (resolve relative watch paths against CWD at start time, dynamically sized). Target: fs.watch / RDCW watcher.

### [SIGEV-37] The CreateFileW recipe: every flag is load-bearing

- **What Windows does**: Directories can only be opened with `FILE_FLAG_BACKUP_SEMANTICS`; RDCW needs `FILE_LIST_DIRECTORY` access and `FILE_FLAG_OVERLAPPED` for async; omitting `FILE_SHARE_DELETE` from the share mode would block other processes from deleting/renaming the watched directory **while it's being watched** (a user-visible behavior change).
- **How libuv handles it**: `CreateFileW(path, FILE_LIST_DIRECTORY, FILE_SHARE_READ|FILE_SHARE_DELETE|FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OVERLAPPED, NULL)` — identical at both open sites (fs-event.c:184-190, 248-254).
- **History**: 1e0757ff; never changed. The DeletePending/zombie sagas (SIGEV-47/48) only exist BECAUSE the share mode permits deletion.
- **Bun disposition**: must-port (verbatim flag set; comment each flag's reason). Target: fs.watch / RDCW watcher.

### [SIGEV-38] Classify the path by HANDLE, not by path (TOCTOU), and re-verify after the parent reopen

- **What Windows does**: Between `GetFileAttributesW(path)` and `CreateFileW(path)` another process can swap the file for a directory or vice versa; metadata-by-path is inherently racy.
- **How libuv handles it**: Open first, then `GetFileInformationByHandle` to classify (fs-event.c:184-201). For the file case, after closing and reopening the _parent_, re-verify the parent is still a directory; if it was swapped for a file, fail with `ERROR_DIRECTORY` (fs-event.c:262-276). Error-mapping wart: `ERROR_DIRECTORY` translates to `UV_ENOENT` (error.c:135) because libuv has no UV_ENOTDIR — acknowledged in a TODO comment (fs-event.c:271-273).
- **History**: 8fc70344 (libuv#4948, issue #4568, Nov 2025) — the by-path classification lived for 14 years before being fixed.
- **Bun disposition**: must-port (open-then-classify; Bun CAN do better than the ENOENT wart since its error space has NOTDIR). Target: fs.watch / RDCW watcher.

### [SIGEV-39] IOCP association is irrevocable; CloseHandle is the only cancel; the canceled completion still arrives

- **What Windows does**: A handle bound to an IOCP cannot be unbound. Closing the handle cancels pending RDCW, but the cancellation is itself delivered as a queued completion (STATUS_CANCELLED/ERROR_OPERATION_ABORTED) that MUST be dequeued.
- **How libuv handles it**: `req_pending` tracks the single in-flight RDCW (fs-event.c:39, 63, 326, 439-440). `uv_fs_event_stop` closes the handle but leaves `req_pending` set (fs-event.c:374-383); `uv__fs_event_close` endgames immediately only if no req is pending, else waits for the completion to drain (fs-event.c:633-642, 645-656). The drained completion for a stopped handle fires no callbacks (`!uv__is_active` early-return, fs-event.c:446-451).
- **History**: 0fb37695 + 1795427a (2011-2012) established "never call callbacks after close"; a39009a5 (libuv#3259, issue #3258) extended it to stop-from-callback (the `else if (uv__is_active)` re-arm guard, fs-event.c:607).
- **Bun disposition**: must-port (single-token in-flight bookkeeping; close = close handle + await completion drain before freeing buffer/handle memory). Target: engine

### [SIGEV-40] Stop-then-restart OVERLAPPED reuse hazard (unfixed upstream)

- **What Windows does**: Reusing an OVERLAPPED that still has an operation pending (even a canceled one whose completion hasn't been dequeued) is undefined behavior — two completions for one structure.
- **How libuv handles it (gap)**: `uv_fs_event_start` checks only `uv__is_active` (fs-event.c:169-170), NOT `req_pending`. Sequence stop() → start() before the canceled completion drains: start re-arms RDCW on the SAME embedded `handle->req` overlapped; when the stale ERROR_OPERATION_ABORTED completion is dequeued, the (now active) handle reports a spurious `UV_ECANCELED` error callback (ERROR_OPERATION_ABORTED→UV_ECANCELED, error.c:87) and then `uv__fs_event_queue_readdirchanges` arms a SECOND RDCW on the already-pending overlapped. Verified by inspection of fs-event.c:156-179, 428-451, 628; no upstream fix found in history. Node avoids it because `fs.watch` close() destroys the handle (uv_close path is safe) rather than stop+restart.
- **History**: latent since the original design; the close path got all the attention (SIGEV-39), the restart path none.
- **Bun disposition**: must-port the LESSON: re-arm must be gated on "no completion in flight" — generation-count the request or defer start until the canceled completion drains. Target: engine

### [SIGEV-41] Re-arm failure is delivered asynchronously through the loop, not synchronously

- **What Windows does**: RDCW can fail immediately at re-arm time (e.g. watched dir deleted since last batch) with the error in GetLastError.
- **How libuv handles it**: `uv__fs_event_queue_readdirchanges` converts immediate failure into a fake pending req: `SET_REQ_ERROR(...GetLastError()); uv__insert_pending_req(...)` and still sets `req_pending = 1` (fs-event.c:58-63). The error then flows through the exact same `uv__process_fs_event_req` error branch as real async failures — one error path, and the user callback never reenters from inside another callback's stack.
- **History**: original design; this uniformity is what made the DeletePending/zombie detection (SIGEV-47/48) implementable in one place.
- **Bun disposition**: must-port (synchronous arm failures must be queued as completions, not delivered inline — preserves callback reentrancy guarantees). Target: engine

### [SIGEV-42] Errors ride OVERLAPPED.Internal as NTSTATUS; overflow status is success-class

- **What Windows does**: The kernel stores NTSTATUS in OVERLAPPED.Internal and byte count in InternalHigh. `STATUS_NOTIFY_ENUM_DIR` (0x10C) — RDCW's "too many changes, rescan" — is a SUCCESS-class NTSTATUS delivered with 0 bytes.
- **How libuv handles it**: `REQ_SUCCESS = NT_SUCCESS(Internal)`; `GET_REQ_ERROR = RtlNtStatusToDosError(Internal)`; fake errors injected via `NTSTATUS_FROM_WIN32` (req-inl.h:30-52). `RtlNtStatusToDosError` is GetProcAddress'd from ntdll (winapi.c). Because STATUS_NOTIFY_ENUM_DIR is success-class, the overflow case lands in the success branch with InternalHigh==0 — handled "for free" without ever naming ERROR_NOTIFY_ENUM_DIR (fs-event.c:455-456, 576-578).
- **History**: 5cae6e4e established the Internal-as-status convention (2011).
- **Bun disposition**: must-port (status plumbing: treat NT_SUCCESS-with-0-bytes as overflow, don't pattern-match the Win32 error; if Bun reads completions via GetQueuedCompletionStatusEx it sees the same NTSTATUS in the OVERLAPPED). Target: engine

### [SIGEV-43] InternalHigh==0 on success = buffer overflow → UV_CHANGE with NULL filename

- **What Windows does**: When the 4KB buffer (or kernel-side queue) overflows between arms, RDCW completes successfully with zero bytes — meaning "changes happened but were lost; rescan everything".
- **How libuv handles it**: `handle->cb(handle, NULL, UV_CHANGE, 0)` (fs-event.c:576-578) — a change event with NULL name is the documented "something changed, path unknown" contract consumers must handle by rescanning.
- **History**: f9ad0a7b (2011) — before it, zero-byte completions were silently ignored and changes were lost.
- **Bun disposition**: must-port (Node surfaces this as `change` with `filename === null`; watch consumers (hot reload!) must treat null filename as "rescan"). Target: fs.watch / RDCW watcher.

### [SIGEV-44] NextEntryOffset is RELATIVE to the current record; 0 terminates

- **What Windows does**: Records chain by `NextEntryOffset` measured from the current record's start, not from the buffer start; the last record has 0.
- **How libuv handles it**: `file_info = (FILE_NOTIFY_INFORMATION*)((char*)file_info + offset)` with `offset = file_info->NextEntryOffset` loop-carried, terminating on 0 (fs-event.c:453-458, 574-575).
- **History**: 019e6edf "NextEntryOffset is relative, not absolute" — the very first bug fixed in this file (2011): treating it as absolute processed only the first record correctly.
- **Bun disposition**: must-port (and bounds-check each record against the byte count before reading it — libuv trusts the kernel here; Bun's adversarial-input rules say validate anyway). Target: fs.watch / RDCW watcher.

### [SIGEV-45] Action mapping: ADDED/REMOVED/RENAMED\_\* → UV_RENAME; MODIFIED → UV_CHANGE; everything else dropped

- **What Windows does**: Five actions: ADDED(1), REMOVED(2), MODIFIED(3), RENAMED_OLD_NAME(4), RENAMED_NEW_NAME(5). A rename produces TWO records (old+new).
- **How libuv handles it**: switch at fs-event.c:554-565: rename-ish actions (incl. create/delete!) → UV_RENAME, MODIFIED → UV_CHANGE, unknown actions parsed but produce no callback. This "create = rename" mapping is the libuv/Node cross-platform contract (matches inotify IN_CREATE→rename mapping).
- **History**: 1e0757ff; semantics frozen by Node compat.
- **Bun disposition**: must-port (exact mapping is Node-API-visible: `eventType` is 'rename' for creates and deletes). Target: fs.watch / RDCW watcher.

### [SIGEV-46] A callback may stop or close the handle mid-batch — both must be safe

- **What Windows does**: n/a (reentrancy): user callbacks run per-record inside the batch loop.
- **How libuv handles it**: (a) batch loop condition `while (offset && !(handle->flags & UV_HANDLE_CLOSING))` abandons remaining records after close-from-callback (fs-event.c:575); (b) top-of-function `!uv__is_active` early-return covers completions arriving after stop (fs-event.c:446-451); (c) re-arm is gated `else if (uv__is_active(handle))` so stop-from-callback doesn't hit the `assert(handle->dir_handle != INVALID_HANDLE_VALUE)` in queue_readdirchanges (fs-event.c:38, 607).
- **History**: 1795427a/0fb37695 (close case, 2011-12); a39009a5 (stop case, libuv#3259, issue #3258 — found 9 years later via Julia).
- **Bun disposition**: must-port (re-check liveness after EVERY user callback; never re-arm a stopped watcher). Target: fs.watch / RDCW watcher.

### [SIGEV-47] Watched-directory deletion (classic semantics) = ERROR_ACCESS_DENIED + DeletePending probe

- **What Windows does**: With classic delete semantics, deleting a directory that has an open handle marks it delete-pending; the watcher's re-armed RDCW then fails with `ERROR_ACCESS_DENIED` — indistinguishable from a real permission error by code alone.
- **How libuv handles it**: On ERROR_ACCESS_DENIED for a dir watch, query `GetFileInformationByHandleEx(FileStandardInfo)` on the (still open!) handle; if `info.Directory && info.DeletePending`, report `UV_RENAME` with the directory's own (relative) name instead of an error (fs-event.c:580-599). Otherwise translate normally — note ERROR_ACCESS_DENIED→UV_EPERM (error.c:158). The deletion event also sets `dir_event_detected` to trigger the zombie probe (SIGEV-48).
- **History**: badecdca (libuv#4376, 2024) — "detect watched directory removal... broken in windows and macos". The test had to switch from CRT `remove()` to `uv_fs_rmdir` to control deletion semantics.
- **Bun disposition**: must-port (Node's `fs.watch` users expect a rename event, not EPERM, when the watched dir disappears). Target: fs.watch / RDCW watcher.

### [SIGEV-48] POSIX-delete zombie: handle silently points into `\$Extend\$Deleted` — probe with GetFinalPathNameByHandleW

- **What Windows does**: With `FILE_DISPOSITION_POSIX_SEMANTICS` deletes (default for DeleteFile on Win10 1809+ NTFS, and what Node/libuv's own unlink/rmdir use), the directory is immediately unlinked and the open watcher handle is retargeted into the hidden `\$Extend\$Deleted` namespace. RDCW does NOT fail — the watcher just never fires again (or yields a final batch containing a zero-length-name record), so SIGEV-47's ACCESS_DENIED path never triggers.
- **How libuv handles it**: Track `dir_event_detected` (any record with `FileNameLength == 0`, or the DeletePending path) (fs-event.c:463-465, 595); before re-arming, call `GetFinalPathNameByHandleW(dir_handle, ..., FILE_NAME_NORMALIZED | VOLUME_NAME_NONE)` and if the result contains `L"\\$Extend\\$Deleted\\"`, report `UV_ENOENT` and do NOT re-arm (fs-event.c:608-626). Probe is gated on dir_event_detected to avoid a syscall per batch. Limitation: the probe uses a MAX_PATH stack buffer; if the final path exceeds it (`path_len >= ARRAY_SIZE`), the check is silently skipped and the zombie lives (fs-event.c:614-620).
- **History**: 44125af6 (libuv#5013, nodejs/node#61398, Mar 2026) — the newest commit in the file; took until 2026 because POSIX-delete-by-default rolled out gradually with Windows 10 servicing.
- **Bun disposition**: must-port (Bun targets 1809+ where POSIX delete is the norm — this is the COMMON deletion path, not the edge case; fix libuv's MAX_PATH probe limitation with a dynamically sized buffer). Target: fs.watch / RDCW watcher.

### [SIGEV-49] Watched-directory RENAME is silently undetected (known gap)

- **What Windows does**: Renaming the watched directory retargets nothing — the handle follows the object, RDCW keeps reporting names relative to the (now renamed) directory, and no record is generated in the watcher's own buffer (the event goes to the PARENT's watchers).
- **How libuv handles it**: It doesn't — paths reported to the callback silently refer to a directory that no longer has the user's path. No commit has ever addressed it; inherent Win32 behavior.
- **History**: no upstream fix or issue resolution; behavior verified from API semantics (records are watch-root-relative; handle is object-bound).
- **Bun disposition**: should-port (decide & document: either accept libuv/Node behavior (stale paths) or optionally probe GetFinalPathNameByHandleW on dir events to detect renames too — same probe as SIGEV-48 minus the $Deleted match). Target: fs.watch / RDCW watcher.

### [SIGEV-50] Filenames convert UTF-16→WTF-8, not strict UTF-8

- **What Windows does**: NTFS names are arbitrary u16 sequences — unpaired surrogates are legal and occur in the wild.
- **How libuv handles it**: `uv__convert_utf16_to_utf8` is a thin wrapper over `uv_utf16_to_wtf8` (util.c:1061-1069), so event names with lone surrogates survive as WTF-8 rather than failing or being replaced. Sized via `uv_utf16_length_as_wtf8`.
- **History**: f3889085 (libuv#4021) unified all conversions onto WTF-8 ("Windows is not 64-bit ready here, but this implementation is"); earlier code used raw WideCharToMultiByte(CP_UTF8) which mangles lone surrogates.
- **Bun disposition**: must-port (use Bun's existing WTF-8 string machinery for event names; never route through strict UTF-8 validation). Target: fs.watch / RDCW watcher; cross-ref: STRINGS area.

### [SIGEV-51] File watches always report the user's basename, not what RDCW said

- **What Windows does**: The record may carry the 8.3 alias (SIGEV-28) even though the user asked to watch the long name.
- **How libuv handles it**: When a file-watch filter matches (by either alias), the callback receives `handle->filew` — the basename from the user's original path — never the record's name (fs-event.c:545-549). So `fs.watch('longname.txt')` consistently reports `longname.txt` even when the change came in as `LONGNA~1.TXT`.
- **History**: 4d1d02fd "ensure that uv_fs_event callbacks have long names" (2011).
- **Bun disposition**: must-port (name stability is API-visible; report the watched name verbatim for file watches). Target: fs.watch / RDCW watcher.

### [SIGEV-52] Start-error hygiene: stop the handle, transfer ownership LAST, free every temp on every path

- **What Windows does**: n/a (libuv resource discipline, learned through four separate leak/double-free bugs).
- **How libuv handles it**: (a) `uv__handle_start` happens early, so EVERY error path must `uv__handle_stop` (fs-event.c:365-366) or the handle is stuck active and can never be restarted (463800ff, issue #1253); (b) `handle->dirw = pathw` happens only after total success (fs-event.c:324-325) because both `uv_fs_event_stop` and the error path free those pointers — assigning early caused a double free (02dcde08, issue #1221); (c) `short_path` freed on the error path (88201044, nodejs/node#52769 — leaked on every failed watch attempt, found via Node memory growth); (d) the DeletePending success path frees `filename` (ec5a4b54, follow-up leak in the #4376 feature); (e) two-label error exit: `error:` translates a Win32 code, `error_uv:` skips translation for already-UV errors from the UTF conversion (fs-event.c:329-332) — single-label designs double-translate.
- **History**: 463800ff, 02dcde08, 88201044, ec5a4b54 — four separate PRs across 8 years for one function's error path.
- **Bun disposition**: must-port (in Rust: RAII owners for pathw/short_path/dir + explicit ownership-transfer points kill this entire bug class; keep the "stop handle on failed start" semantic). Target: fs.watch / RDCW watcher.

### [SIGEV-53] OOM in the watcher path is fatal-by-policy

- **What Windows does**: n/a.
- **How libuv handles it**: Every `uv__malloc` failure in signal/fs-event paths calls `uv_fatal_error(ERROR_OUTOFMEMORY, "uv__malloc")` (fs-event.c:77-78, 175, 299, 493-494...) — small allocations on event paths abort rather than attempt recovery.
- **History**: original convention.
- **Bun disposition**: should-port (Bun routes through `bun_core::handle_oom` instead of abort-with-Win32-code; the lesson is "don't write unwinding error paths for 50-byte allocations in event dispatch"). Target: fs.watch / RDCW watcher.

### [SIGEV-54] Buffer-size arithmetic lessons: exact-size relpath alloc, %.\*s precision is int

- **What Windows does**: UNC + recursive watches yield event-relative paths LONGER than MAX_PATH; `_snwprintf`'s `%.*s` precision argument is `int`, not size_t.
- **How libuv handles it**: b44abe20 fixed a heap buffer OVERFLOW: `uv__relative_path` allocated MAX_PATH chars but copied unbounded relative paths (recursive UNC case) — fix: allocate exactly `filenamelen - dirlen` (fs-event.c:75-80). 7b07d18a added the `(DWORD)` cast in `_snwprintf(..., L"%s\\%.*s", ..., FileNameLength/(DWORD)sizeof(WCHAR), ...)` (fs-event.c:497-499) because size_t precision args are UB/truncation on LLP64.
- **History**: b44abe20 (2016, security-grade bug), 7b07d18a.
- **Bun disposition**: should-port (safe Rust string building eliminates both classes; KEEP the regression scenario — recursive watch over long UNC paths — as a Bun test case). Target: fs.watch / RDCW watcher.

### [SIGEV-55] No MAX_PATH limits anywhere: every Win32 query uses two-call dynamic sizing

- **What Windows does**: Since Windows 10 1607 (with manifest opt-in) paths exceed MAX_PATH; fixed 260-char buffers truncate or fail.
- **How libuv handles it**: da7e50bb (libuv#2788, issue #2331) removed the last fixed buffers from fs-event: GetShortPathNameW and GetCurrentDirectoryW both query-then-allocate (fs-event.c:99-115, 209-226). Remaining exception: the zombie probe's MAX_PATH stack buffer (SIGEV-48) regressed the principle in 2026.
- **History**: da7e50bb (2020).
- **Bun disposition**: must-port (Bun's long-path-aware manifest makes this mandatory; no fixed path buffers, including in the zombie probe). Target: fs.watch / RDCW watcher; cross-ref: PATHS area.

### [SIGEV-56] UV_FS_EVENT_WATCH_ENTRY and UV_FS_EVENT_STAT are accepted and ignored

- **What Windows does**: n/a.
- **How libuv handles it**: Both flags are documented in uv.h:1743-1766 as "currently not implemented yet on any backend" — passing them is not an error, they just do nothing; only UV_FS_EVENT_RECURSIVE has meaning on Windows.
- **History**: 1997e10b added the flags API (2011); never implemented in 14 years.
- **Bun disposition**: skip (dead API surface; Bun's watcher options are its own — just don't copy these enum values expecting behavior). Target: n/a.

### [SIGEV-57] Exotic filesystems and environments: RDCW failures surface as async watcher errors, with no special-casing

- **What Windows does**: ReadDirectoryChangesW support varies: SMB caps buffers at 64KB and may drop/delay notifications; FAT/exFAT lack some change classes; sshfs-win/WinFsp/older Wine return ERROR_INVALID_FUNCTION or never complete; container-redirected filesystems behave like remote ones.
- **How libuv handles it**: No probing, no fallback-to-polling on Windows (the UV_FS_EVENT_STAT fallback was never implemented — SIGEV-56): CreateFileW or RDCW failures propagate to the user callback as translated errors via the uniform async error path (SIGEV-41). The 4KB buffer (SIGEV-22) keeps SMB viable.
- **History**: behavior by omission; no commits special-case any filesystem.
- **Bun disposition**: should-port (match libuv: deliver the error, don't hang; document that network/FUSE watchers may need a polling fallback at the Node-API layer — chokidar-style — rather than in the loop layer). Target: fs.watch / RDCW watcher.
