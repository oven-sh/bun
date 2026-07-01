# libuv Windows quirks ledger — area: misc-history

Files: `src/win/getaddrinfo.c`, `src/win/getnameinfo.c`, `src/win/thread.c`, `src/threadpool.c`,
`src/win/dl.c`, `src/win/error.c`, `src/win/snprintf.c` + git-history archaeology across all of `src/win/`.
Worktree: `C:/Users/dylan/code/libuv-read` (libuv v1.52-dev tip `439a54be`). All file:line refs are into that tree.

---

### [HIST-01] Repack GetAddrInfoW results into one allocation with explicit alignment — and the v1.49.0 regression that broke it

- **What Windows does**: `GetAddrInfoW` returns a linked list of `addrinfoW` (UTF-16 strings) allocated by winsock; it must be freed with `FreeAddrInfoW`, and the strings/sockaddrs live inside winsock's allocation. Callers expect POSIX `struct addrinfo` with UTF-8 strings and a single `freeaddrinfo()`.
- **How libuv handles it**: Two-pass conversion in `uv__getaddrinfo_done` (src/win/getaddrinfo.c:104-217): pass 1 walks the W-list summing `sizeof(struct addrinfo)` + `ai_addrlen` + UTF-8 canonname length, inserting `align_offset(off, sizeof(void*))` before every struct and sockaddr (src/win/getaddrinfo.c:74-76, 124-128); pass 2 copies structs, sockaddrs, and converts canonnames into the single `uv__malloc` block. `uv_freeaddrinfo` is then just `uv__free` (src/win/getaddrinfo.c:220-225). The original `addrinfoW` list is always `FreeAddrInfoW`'d afterwards (src/win/getaddrinfo.c:205-208).
- **History**: The unaligned-pointer writes were flagged by UBSan and reworked in `9b3b61f6` ("build: ubsan fixes", #4254) — but that rework's next-pointer logic was wrong: `addrinfo_ptr->ai_next = addrinfo_ptr` self-link meant the converted list only ever had ONE entry. Shipped in libuv v1.49.0, broke multi-A-record DNS in downstreams, fixed in `52a92433` (#4578, closes #4577) by introducing a separate `next_addrinfo_ptr` temp. Lesson: the repacking loop's tail logic is genuinely easy to get wrong; test with >1 result.
- **Bun disposition**: must-port. If Bun returns POSIX-shaped addrinfo from a Rust `GetAddrInfoW` wrapper it needs exactly this repack (alignment included — sockaddr copies must be pointer-aligned). Add a test asserting >2 entries survive conversion. Target: Phase: dns/getaddrinfo.

### [HIST-02] `addrinfo` struct layout and field types differ between Windows and POSIX

- **What Windows does**: Windows' `struct addrinfo`/`addrinfoW` field order is `flags, family, socktype, protocol, addrlen, canonname, addr, next` with `size_t ai_addrlen`; glibc/POSIX order is `flags, family, socktype, protocol, addrlen, addr, canonname, next` with `socklen_t ai_addrlen`. Same field names, different offsets and widths — code that compiles on both can still be wrong if it serializes or transmutes.
- **How libuv handles it**: It always uses the platform's own `struct addrinfo`, never a portable one, so the conversion in getaddrinfo.c only copies field-by-field (src/win/getaddrinfo.c:156-163). A hand-rolled `addrinfoW` typedef exists only for ancient MinGW (src/win/getaddrinfo.c:54-72).
- **History**: MinGW shim is code-comment only ("MinGW is missing this"); legacy MinGW support dropped in `16e6e84d` (#4645). The shim's `size_t ai_addrlen` matches MSVC's ws2tcpip.h.
- **Bun disposition**: must-port (as a design constraint). Bun's Rust DNS layer must not assume glibc field order when defining its own result struct or when interfacing with JSC/N-API consumers that expect system layout; copy field-by-field. Skip the MinGW typedef shim (Bun uses windows-sys bindings). Target: Phase: dns/getaddrinfo.

### [HIST-03] getaddrinfo errors arrive as WSA* codes, not EAI\_* — translate from the return value, with a dedicated table

- **What Windows does**: `GetAddrInfoW` returns the error directly (also retrievable via `WSAGetLastError()`), and MSDN documents the failures as WSA codes: `WSATRY_AGAIN`, `WSAEINVAL`, `WSANO_RECOVERY`, `WSAEAFNOSUPPORT`, `WSA_NOT_ENOUGH_MEMORY`, `WSAHOST_NOT_FOUND`, `WSATYPE_NOT_FOUND`, `WSAESOCKTNOSUPPORT`. The `EAI_*` macros in ws2tcpip.h are aliases of those WSA codes — but comparing against textbook POSIX EAI values is wrong.
- **How libuv handles it**: `uv__getaddrinfo_translate_error` (src/win/getaddrinfo.c:35-48) maps WSA codes → `UV_EAI_AGAIN/BADFLAGS/FAIL/FAMILY/MEMORY/NONAME/SERVICE/SOCKTYPE`, falling through to `uv_translate_sys_error` for anything else. The same function is reused by getnameinfo (src/win/getnameinfo.c:57).
- **History**: `c87c44ff` "windows: fix uv\_\_getaddrinfo_translate_error — Use Windows socket error codes, as recommended by MSDN, like we already do with GetNameInfoW". Earlier: `01f64f66` dropped a bogus `UV_EAINONAME` in favor of ENOENT-style mapping; `a098ac66` made EAI_SYSTEM-ish failures return the underlying system error rather than a generic code.
- **Bun disposition**: must-port. Node compat (`dns` module error codes like `ENOTFOUND` derive from EAI_NONAME) depends on this exact mapping; notably `WSAEINVAL → EAI_BADFLAGS` (not EINVAL) and `WSAESOCKTNOSUPPORT → EAI_SOCKTYPE`. Target: Phase: dns/getaddrinfo.

### [HIST-04] IDNA ToASCII (IDNA 2008) before the OS resolver, 256-byte hostname cap, and the truncation CVE

- **What Windows does**: System resolvers disagree on internationalized domain names — some do IDNA 2003, some 2008, some nothing. A name can resolve to _different hosts_ depending on the local resolver's IDNA flavor (spoofing vector). Windows' GetAddrInfoW does its own conversion unless you hand it punycode.
- **How libuv handles it**: `uv_getaddrinfo` converts the node name to ASCII punycode itself via `uv__idna_toascii` into a fixed `char hostname_ascii[256]` before any winsock call (src/win/getaddrinfo.c:247, 270-280), so all platforms resolve identically. Hostnames that don't fit ≤255 chars + NUL fail with the idna error rather than being passed through.
- **History**: `6dd44caa` (#2046, fixes #2028) — explicitly called a security issue in the commit. Then GHSA-f74f-cvh7-c6q6 / CVE-2024-24806 (merge `c858a147`): `uv__idna_toascii` did not always NUL-terminate its output and accepted empty input, so a >255-char attacker-controlled name could be silently _truncated_ at 256 bytes — `internal.example.com.evil.com` truncating to `internal.example.com` = SSRF. Fixes `0f2d7e78` (always zero-terminate) + `3530bcc3` (reject zero-length input).
- **Bun disposition**: must-port. Do IDNA/punycode conversion in Bun's own layer (Bun already has URL/IDNA machinery via WebKit), enforce the 255-octet DNS limit by _rejecting_, never truncating, and reject empty hostnames. Target: Phase: dns/getaddrinfo.

### [HIST-05] Marshal node/service/hints into one owned block; the cancel path that freed the wrong thing

- **What Windows does**: Nothing OS-specific — this is lifetime management: the caller's `node`, `service`, and `hints` must not need to outlive the submitting call when work runs on a pool thread.
- **How libuv handles it**: `uv_getaddrinfo` computes one combined size (UTF-16 node + UTF-16 service + `addrinfoW` hints copy, each alignment-padded), single `uv__malloc` into `req->alloc`, then converts/copies in (src/win/getaddrinfo.c:269-335). Quirk: the _hints copy_ is stored in `req->addrinfow` — the same field that later holds the _result_. The work fn snapshots and NULLs it before calling `GetAddrInfoW` (src/win/getaddrinfo.c:88-90) so the done fn can tell "result to FreeAddrInfoW" from "my own hints copy".
- **History**: `ba09b39b` "windows: fix regression when cancelling getaddrinfo — The req->addrinfow field contains the hints in that case, so we must not free it" (regression introduced by `f2bb8d39` which added sync mode). Separately `7bfb5ae7` (#1122): the validation error path jumped to a cleanup block that freed `req->alloc` before it was ever set — free() on garbage when both node and service were NULL. Current code validates and returns _before_ any allocation (src/win/getaddrinfo.c:256-259).
- **Bun disposition**: must-port (the lifetime rule and the dual-use-field trap). In Rust, model this as an owned enum (`Hints(Box) | Result(PADDRINFOW)`) so the type system prevents the ba09b39b bug. Validate-first-allocate-last. Target: Phase: dns/getaddrinfo.

### [HIST-06] WSAStartup ordering: sync (NULL-loop) DNS must self-initialize winsock

- **What Windows does**: Every winsock call including `GetAddrInfoW` fails with `WSANOTINITIALISED` unless `WSAStartup` ran in the process.
- **How libuv handles it**: Loop creation normally runs `uv__once_init()` (WSAStartup + winapi pointer init, src/win/core.c:332). When `uv_getaddrinfo` was extended to support `loop == NULL` + `cb == NULL` (pure synchronous), it had to call `uv__once_init()` explicitly (src/win/getaddrinfo.c:261). `uv_getnameinfo` does NOT call it — it still requires a loop (`uv__req_register(loop)` dereferences unconditionally, src/win/getnameinfo.c:127).
- **History**: `edfc95db` "unix,win: support NULL loop for sync uv_getaddrinfo" (2025). The asymmetry with getnameinfo is current-state, not an oversight you can rely on staying.
- **Bun disposition**: must-port. Bun's Rust winsock init must be an idempotent `Once` that every socket-API entry point (not just loop creation) can afford to call. Target: engine

### [HIST-07] uv_if_indextoname goes index→LUID→name; the Windows XP support that was added then reverted

- **What Windows does**: There is no direct `if_indextoname` for the friendly NDIS name pre-Vista API surface libuv wanted; the supported path is `ConvertInterfaceIndexToLuid` + `ConvertInterfaceLuidToNameW` (iphlpapi), names up to `NDIS_IF_MAX_STRING_SIZE` (256) WCHARs.
- **How libuv handles it**: src/win/getaddrinfo.c:354-373 does exactly that two-step, then UTF-16→UTF-8 with caller-buffer `ENOBUFS` semantics via `uv__copy_utf16_to_utf8`. `#ifndef NDIS_IF_MAX_STRING_SIZE` fallback to `IF_MAX_STRING_SIZE` for old SDKs (src/win/getaddrinfo.c:78-80, from `84fa7fc7`).
- **History**: `17eaa956` added a GetProcAddress-based fallback so this worked on XP; `e318e001` REVERTED it: "Libuv is not supported on Windows XP... It also can't possibly work because ReOpenFile() in src/win/fs.c is not weakly linked, so any executable that links libuv would simply fail to load on XP." Lesson: a per-function downlevel shim is worthless unless _every_ static import in the binary is also downlevel-clean — audit the whole import table before claiming OS support.
- **Bun disposition**: must-port the LUID two-step (used by `os.networkInterfaces` scope names / UDP multicast). The XP lesson generalizes: Bun's 1809 baseline means any "works on older Windows" claim must be verified against the full import set, not one call site. Target: Phase: net-util.

### [HIST-08] IPv6 scope IDs on Windows are numeric strings, not interface names

- **What Windows does**: On Unix, an IPv6 scope ID renders as the interface _name_ (`fe80::1%eth0`); on Windows the convention is the numeric interface index (`fe80::1%4`).
- **How libuv handles it**: `uv_if_indextoiid` on Windows just `snprintf`s the index as a decimal string (src/win/getaddrinfo.c:375-393), with ENOBUFS + required-size reporting if the buffer is small. (On Unix the same API returns the name.)
- **History**: `695afe83` "unix,win: add uv*if*{indextoname,indextoiid}" — added specifically so URL/address formatting code could be platform-correct.
- **Bun disposition**: must-port. Affects URL parsing/serialization of link-local IPv6 and Node `os`/`dgram` compat: format scope as number on Windows, name on Unix. Target: Phase: net-util.

### [HIST-09] GetNameInfoW buffer sizes are WCHAR counts, not byte counts

- **What Windows does**: `GetNameInfoW(..., pNodeBuffer, NodeBufferSize, pServiceBuffer, ServiceBufferSize, ...)` — both sizes are _characters_ (WCHARs), per MSDN, unlike many Win32 APIs that take bytes.
- **How libuv handles it**: Stack buffers `WCHAR host[NI_MAXHOST]; WCHAR service[NI_MAXSERV]` (1025/32) passed with `ARRAY_SIZE`, not `sizeof` (src/win/getnameinfo.c:43-55).
- **History**: `89fc7d80` "windows: fix buffer overflow on uv\_\_getnameinfo_work()" — the original code passed `sizeof(host)`, i.e. 2× the real capacity, an exploitable stack overflow whenever a reverse-DNS name approached 1025 chars.
- **Bun disposition**: must-port (the lesson). In Rust use `buf.len()` of a `[u16]` slice — but audit every Win32 wide API for chars-vs-bytes; this exact bug class recurs (see also HIST-32 dl.c, and `uv_exepath` off-by-one `df0ac426`). Target: Phase: dns/getnameinfo.

### [HIST-10] GetNameInfoW returns nonzero on failure; fetch the code from WSAGetLastError

- **What Windows does**: `GetNameInfoW` returns 0 on success, nonzero on failure, and the real error must be read with `WSAGetLastError()` — it is NOT returned like `GetAddrInfoW` does.
- **How libuv handles it**: src/win/getnameinfo.c:49-59: `if (GetNameInfoW(...)) { ret = WSAGetLastError(); req->retcode = uv__getaddrinfo_translate_error(ret); return; }`. The post-conversion UTF-8 copies also set `retcode` on failure (src/win/getnameinfo.c:61-72).
- **History**: `7bdcf3dc` "windows: fix GetNameInfoW error handling — GetNameInfoW return non-zero on error, and not vice versa" (the original check was inverted: success treated as failure). `76b873e8` later added error handling to the UTF conversions inside the work fn.
- **Bun disposition**: must-port. Asymmetric error conventions between the two sibling DNS calls is exactly the kind of thing a from-scratch port gets wrong. Target: Phase: dns/getnameinfo.

### [HIST-11] Copy the caller's sockaddr at submit time, sized by family, EINVAL anything non-INET

- **What Windows does**: Nothing special — lifetime + validation discipline for pool-thread work.
- **How libuv handles it**: `uv_getnameinfo` memcpy's `sockaddr_in` or `sockaddr_in6` (by `sa_family`) into `req->storage` (a `sockaddr_storage`) before queueing; any other family → `UV_EINVAL` (src/win/getnameinfo.c:114-124). The work fn then passes `sizeof(req->storage)` (the full storage) to GetNameInfoW, which Windows accepts.
- **History**: `70c42563` original implementation; unchanged shape since.
- **Bun disposition**: must-port. Same rule for Bun's reverse-DNS: copy by family size, reject AF_UNIX/unknown up front. Target: Phase: dns/getnameinfo.

### [HIST-12] Slow-I/O lane: DNS limited to (nthreads+1)/2 pool threads so it can't starve fs work

- **What Windows does**: N/A (libuv-internal design), but the motivating behavior is OS-level: getaddrinfo can block for ~seconds (DNS timeouts), while fs ops usually finish in ms.
- **How libuv handles it**: Work is submitted with a kind (`UV__WORK_CPU` vs `UV__WORK_SLOW_IO`). Slow items go to a separate `slow_io_pending_wq`; a single sentinel node `run_slow_work_message` is enqueued in the main queue to represent "there is slow work" (src/threadpool.c:143-161). Workers refuse to start slow work when `slow_io_work_running >= (nthreads+1)/2` (src/threadpool.c:45-47, 92-117), re-queueing the sentinel at the tail instead. getaddrinfo/getnameinfo submit as SLOW_IO (src/win/getaddrinfo.c:341-345, src/win/getnameinfo.c:135-139).
- **History**: `90891b42` "unix,win: limit concurrent DNS calls to nthreads/2" — fixes nodejs/node#8436 where a burst of DNS lookups occupied all 4 default threads and froze all fs I/O for the DNS timeout duration. A classic production hang.
- **Bun disposition**: must-port (the concept). Whatever pool Bun uses for blocking Windows calls, DNS (and anything with multi-second worst case) needs a concurrency cap below pool size so fs/work lanes stay live. Target: Phase: threadpool/dns.

### [HIST-13] Counters shared with the scheduler must be mutated under the scheduler's own mutex

- **What Windows does**: N/A — pure concurrency lesson.
- **How libuv handles it**: `slow_io_work_running--` happens only after re-acquiring the global pool `mutex` at loop bottom (src/threadpool.c:132-138); the comment "`slow_io_work_running` is protected by `mutex`" is load-bearing.
- **History**: `daf04e83` "unix,win: fix threadpool race condition" — the original 90891b42 decremented the counter while holding the _loop's_ `wq_mutex` instead of the pool mutex; the resulting stale reads caused a string of flaky Node.js CI failures (nodejs/node#23089, #23067, #23066, #23219; nodejs/reliability#18). Took weeks to track down because it only manifested as occasional under-scheduling.
- **Bun disposition**: must-port (lesson). In Rust, put the throttle counter inside the same `Mutex<PoolState>` as the queues — don't "optimize" it into a separate atomic; the check-then-act in the worker loop needs to be atomic with dequeue. Target: Phase: threadpool.

### [HIST-14] Condvar signaling: "only signal when queue was empty" caused massive throughput collapse

- **What Windows does**: N/A — scheduling lesson.
- **How libuv handles it**: `post()` signals the condvar whenever `idle_threads > 0` (src/threadpool.c:158-159), and the slow-work path re-signals when it re-queues the sentinel and idlers exist (src/threadpool.c:113-117).
- **History**: `0f1bdb6b` (#460) optimized to "send signal only when queue is empty" to cut syscalls; `da427802` (#493, fixes #490/#492) found it caused _thread starvation_: "work is not evenly distributed... It doesn't turn into outright deadlock because there is always at least one thread making forward progress but it does degrade throughput, sometimes massively so." Fixed by signaling whenever `idle_threads > 0` — still cheap, but correct.
- **Bun disposition**: must-port (lesson). If Bun hand-rolls a pool: signal on every enqueue while idlers exist. (If using crossbeam/parking_lot primitives, this is handled, but custom sentinel re-queues like HIST-12's still need their own wake.) Target: Phase: threadpool.

### [HIST-15] Wait for worker threads to actually start before returning from pool init (Windows exit race)

- **What Windows does**: `exit()`/`ExitProcess` terminates all other threads wherever they are. A thread still inside CRT/loader startup when the process exits can crash or deadlock the process teardown (abnormal termination), because thread init holds the loader lock.
- **How libuv handles it**: `init_threads` creates a semaphore, every worker posts it first thing (src/threadpool.c:62-63), and init waits nthreads posts before returning (src/threadpool.c:238-251). So by the time any work is submitted, all workers are past startup.
- **History**: Three-commit saga: `5486f6bd` "wait for threads to start — the process terminates abnormally when the program exits before the worker threads complete initializing" → REVERTED in `49616e4e` "for suspected regressions in the Node.js test suite on Windows" → re-landed as `647fbc02` (#1662) after the regression was traced elsewhere. The revert was a false alarm but shows how hard exit-time behavior is to bisect.
- **Bun disposition**: must-port. Any lazily-spawned Windows thread (pool, watchdog, stdio reader) should handshake startup if process exit can race it; alternatively ensure exit never runs while spawn is in flight. Target: Phase: threadpool / process-exit.

### [HIST-16] Pool threads get an explicit 8 MB stack, rounded to page size

- **What Windows does**: `_beginthreadex(stack_size=0)` inherits the EXE header's default reserve (commonly 1 MB — and whatever the embedder linked with). Stack size argument is `unsigned` (32-bit even on x64) and gets rounded by the OS.
- **How libuv handles it**: `init_threads` passes `UV_THREAD_HAS_STACK_SIZE` with `8u << 20` (src/threadpool.c:241-242); `uv_thread_create_ex` rounds the request up to `dwPageSize` and rejects sizes that don't fit in `unsigned` (src/win/thread.c:121-132).
- **History**: `73b0c1f9` (#3787, fixes #3786) "give the thread pool threads an 8 MB stack" — motivated by platforms with tiny default thread stacks (musl: 128 KB) blowing up user work callbacks; 8 MB matches typical Linux pthread default so user code behaves identically cross-platform.
- **Bun disposition**: should-port. Bun controls its own thread spawns; pick one documented stack size for blocking-work threads across platforms (Bun already does 4 MB+ in places). The page-round + u32-fit checks are must if exposing stack size to users. Target: Phase: threadpool.

### [HIST-17] UV_THREADPOOL_SIZE: default 4, clamp 1..1024, parsed with atoi — and why getenv() was the wrong way to read it

- **What Windows does**: The MSVCRT caches a copy of the environment at process start; `getenv()` does not see variables set later via `SetEnvironmentVariableW` (which is what embedders and `uv_os_setenv` use). So `getenv("UV_THREADPOOL_SIZE")` after programmatic env mutation silently returns stale/NULL.
- **How libuv handles it**: src/threadpool.c:204-217: default `ARRAY_SIZE(default_threads)` = 4; reads the env var via `uv_os_getenv` (live `GetEnvironmentVariableW`) into a 16-byte buffer; `atoi`; 0 → 1; cap `MAX_THREADPOOL_SIZE` 1024. If `uv__malloc` for the thread array fails it silently falls back to the static 4-slot array (src/threadpool.c:219-226).
- **History**: cap raised 128 → 1024 in `9a10058e` (#2314); `271d173b` (#4888, fixes #4887, 2025) switched `getenv` → `uv_os_getenv` precisely for the CRT-cache mismatch. Note `atoi` accepts garbage as 0 → clamped to 1, and there's no upper sanity warning — deliberate permissiveness.
- **Bun disposition**: must-port semantics (Node compat: users set UV_THREADPOOL_SIZE). Rust `std::env::var` reads the live env block on Windows, so the getenv trap doesn't apply — but document that Bun honors the same default/cap. Target: Phase: threadpool.

### [HIST-18] Never tear down the pool from atexit/DllMain — loader-lock deadlock

- **What Windows does**: When a DLL is unloaded, its atexit handlers/DllMain(PROCESS_DETACH) run while the loader lock is held; joining threads or taking locks there deadlocks, because exiting threads also need the loader lock (DLL_THREAD_DETACH).
- **How libuv handles it**: Threadpool cleanup is NOT registered with atexit on Windows. `uv__threadpool_cleanup` (src/threadpool.c:168-191) posts the exit message and joins workers, but it is only invoked from `uv_library_shutdown()` (an explicit API, `72fe3543`), never automatically.
- **History**: `c8abb29f` "windows: don't use atexit for cleaning up the threadpool — If libuv is loaded as a DLL and is later unloaded deadlocks can happen when running atexit handlers, so we can't use synchronization primitives or join threads there" (saghul/pyuv#171).
- **Bun disposition**: must-port (lesson). Bun.exe isn't a DLL, but the rule generalizes: never join threads from DllMain-context or late CRT atexit on Windows; Bun's exit path should either leak the pool (ExitProcess kills threads) or join _before_ entering CRT shutdown. Target: Phase: threadpool / process-exit.

### [HIST-19] uv_cancel contract: cancellable only while queued; sentinel work fn; never hold both mutexes

- **What Windows does**: N/A — pool design.
- **How libuv handles it**: `uv__work_cancel` (src/threadpool.c:292-316) succeeds only if the item is still linked in the queue AND `w->work != NULL`; the worker signals "executing" by `uv__queue_init(q)` on dequeue (src/threadpool.c:88-89) and "done" by `w->work = NULL` under the _loop's_ `wq_mutex` (src/threadpool.c:125-127). Cancelled items get `w->work = uv__cancelled` (a fn that `abort()`s if ever actually run, src/threadpool.c:49-51) and are delivered to the loop with `UV_ECANCELED` (src/threadpool.c:339). Top-of-file comment: "To avoid deadlock with uv_cancel() it's crucial that the worker never holds the global mutex and the loop-local mutex at the same time" (src/threadpool.c:54-56). Cancelled getaddrinfo maps to `UV_EAI_CANCELED` in the done fn (src/win/getaddrinfo.c:111-115).
- **History**: `52c8a861`/`92fb84b7` introduced uv_cancel; `92a19a19` "ensure done_cb gets called after uv_cancel()" — the completion callback must fire exactly once on every path including cancellation (settled-promise discipline).
- **Bun disposition**: should-port. Bun needs cancellation for `dns.cancel()`-style APIs and shutdown; the two-flag (queued-bit + work-null) state machine and the lock-ordering rule are the proven shape. Target: Phase: threadpool.

### [HIST-20] Name your pool threads

- **What Windows does**: Unnamed threads make WinDbg/ETW/Process Explorer triage of CPU burn or hangs miserable.
- **How libuv handles it**: First statement of `worker()` is `uv_thread_setname("libuv-worker")` (src/threadpool.c:62).
- **History**: `e59e2a9e` (#4664), 2025 — took 15 years to add.
- **Bun disposition**: should-port (Bun already names its threads; keep doing it on the Windows pool via `SetThreadDescription`). Target: Phase: threadpool.

### [HIST-21] uv_once: InitOnceExecuteOnce now; the hand-rolled CreateEvent CAS dance it replaced

- **What Windows does**: `INIT_ONCE` + `InitOnceExecuteOnce` (Vista+) is the OS one-time-init primitive; before libuv trusted it, the portable pattern was: CreateEvent, `InterlockedCompareExchangePointer` the event into the guard, winner runs callback + SetEvent + sets `ran`, losers CloseHandle their event and WaitForSingleObject the winner's.
- **How libuv handles it**: src/win/thread.c:35-52 — a trampoline struct passes the C callback through `InitOnceExecuteOnce`'s param. `uv_once_t` keeps a legacy `unsigned char unused` field before the `INIT_ONCE` for ABI (include/uv/win.h:282-287, `UV_ONCE_INIT {0, INIT_ONCE_STATIC_INIT}`).
- **History**: `abc97670` (2024) deleted the event-based implementation ("InitOnceExecuteOnce is available in Windows >= Vista"). The old code allocated a kernel event per losing racer and could `uv_fatal_error` on CreateEvent failure under memory pressure — the OS primitive can't fail that way.
- **Bun disposition**: skip (use Rust `std::sync::Once`/`OnceLock`, which wraps the same OS facility) — recorded because any C-side Bun glue must not resurrect the event dance, and the ABI-padding trick matters if Bun ever mirrors libuv structs. Target: engine

### [HIST-22] Thread creation: \_beginthreadex (not CreateThread), CREATE_SUSPENDED so the thread can know its own handle

- **What Windows does**: `CreateThread` in a CRT-using process historically leaked CRT per-thread state; `_beginthreadex` initializes CRT TLS properly. A thread cannot otherwise learn its own _real_ (non-pseudo) handle: `GetCurrentThread()` returns a pseudo-handle (-2) that means "current thread" to whoever uses it.
- **How libuv handles it**: `uv_thread_create_ex` (src/win/thread.c:110-171) heap-allocs a ctx, `_beginthreadex(..., CREATE_SUSPENDED, ...)`, stores the returned real handle into both `*tid` and `ctx->self`, then `ResumeThread`. The thread start stub copies the ctx to its stack, frees it, and stores `ctx.self` in the TLS slot so `uv_thread_self()` returns the same handle the parent got (src/win/thread.c:78-92). errno from \_beginthreadex is mapped EACCES/EAGAIN/EINVAL else EIO (src/win/thread.c:159-170).
- **History**: CREATE_SUSPENDED comment: "Create the thread in suspended state so we have a chance to pass its own creation handle to it". `ff031681` made create return errno-style codes.
- **Bun disposition**: skip for plain spawning (Rust std handles CRT + handles correctly), must-port the _pseudo-handle trap_ knowledge anywhere Bun passes thread HANDLEs across threads (e.g. `uv_thread_setaffinity`-style APIs, SetThreadDescription on another thread): always `DuplicateHandle` a pseudo-handle first. Target: Phase: threading.

### [HIST-23] uv_thread_self: TLS-stored handle, DuplicateHandle for threads libuv didn't create

- **What Windows does**: There's no cheap "stable id == joinable handle" for the current thread; `GetCurrentThread()` is a pseudo-handle, and `GetCurrentThreadId()` is a DWORD that can't be waited on and is recycled after thread exit.
- **How libuv handles it**: A lazily-created TLS key stores each uv-created thread's real handle (set in the start stub). For foreign threads (e.g. the main thread) `uv_thread_self` mints a real handle on first call via `DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), ...)` and caches it in TLS (src/win/thread.c:249-264); failure is fatal.
- **History**: Three generations: `0db56ea4` original; `a3102486` "store thread handle in a TLS slot — static thread local variable... causes crashes on Windows XP/2003 when libuv is loaded as a dynamic library" (implicit-TLS-in-delay-loaded-DLL bug, fixed in OS only at Vista); `a979e76e` (joyent/node#25602) main thread had no TLS entry → returned NULL; `40bf9a89` (#3357) made _all_ threads (incl. foreign) get a usable id so `uv_thread_equal`/setaffinity work on the main thread. Note: the DuplicateHandle'd main-thread handle is never closed — deliberate one-per-thread leak.
- **Bun disposition**: should-port (the trap inventory). Rust's `Thread` ids avoid all this internally, but Bun's Node-compat `worker_threads`/diagnostics code touching raw HANDLEs must remember: pseudo-handle ≠ handle, DWORD ids recycle, implicit `__declspec(thread)` was historically unsafe in dynamically loaded DLLs. Target: Phase: threading.

### [HIST-24] uv_rwlock: CRITICAL_SECTION+semaphore was ~100x slower than SRWLock; replaced with ABI-frozen padding

- **What Windows does**: `SRWLOCK` is a pointer-sized, statically-initializable, no-destroy reader-writer lock (Vista+); TryAcquire variants exist since Win7. A hand-rolled CS+semaphore rwlock serializes readers through the CS and costs kernel transitions per reader.
- **How libuv handles it**: src/win/thread.c:403-457: `uv_rwlock_t` is an SRWLOCK plus explicit padding bytes (72 on x64 / 44 on x86) to preserve the historical union size; `STATIC_ASSERT(sizeof == 80 / 48)` pins the ABI. `uv_rwlock_destroy` is a documented no-op ("SRWLock does not need explicit destruction so long as there are no waiting threads"). Mutexes remain CRITICAL_SECTION (recursive by nature — `uv_mutex_init_recursive` == `uv_mutex_init`, src/win/thread.c:376-378).
- **History**: Long evolution: `e4680ccc`/`8e4ed88b` original CS+sem; `3eb6764a` "fix unsavory rwlock fallback implementation"; `9a4fd268` redo; `98239224` stopped GetProcAddress-ing SRWLock APIs (XP-era probing); finally `a3e02e5e` (#3383, fixes #3382 — contention benchmark showed order-of-magnitude wins) swapped the impl inside the frozen ABI footprint. Earlier `13e8b15e` similarly deleted the fallback uv_cond implementation.
- **Bun disposition**: skip implementation (Rust `std::sync::RwLock`/`Mutex` already use SRWLock/futex-equivalents on modern Windows); record two lessons: (1) never GetProcAddress synchronization primitives — pick the baseline and link directly; (2) if Bun exports any C-ABI struct containing a lock, freeze its size with a static assert on day one. Target: Phase: threading.

### [HIST-25] uv_cond_timedwait: CONDITION_VARIABLE, ns→ms truncation via double division, abort on non-timeout failure

- **What Windows does**: `SleepConditionVariableCS` takes milliseconds (DWORD); failure must be disambiguated via `GetLastError() == ERROR_TIMEOUT`. Spurious wakeups occur. INFINITE = 0xFFFFFFFF is a reserved value.
- **How libuv handles it**: src/win/thread.c:529-535: `(DWORD)(timeout / 1e6)` — note `1e6` is a _double_, so the ns→ms conversion round-trips through floating point and truncates; sub-ms timeouts become 0 (immediate timeout-poll). Non-ERROR_TIMEOUT failure → `abort()`. uv_cond_destroy is a no-op.
- **History**: `976c8a43` added condvars with an NT-event fallback for XP; `13e8b15e` removed the fallback (Vista+). The double-division quirk is original and survives review because timeouts ≥1ms dominate.
- **Bun disposition**: skip (Rust Condvar). Record: any Bun code converting ns→Windows-ms must use integer math, clamp 0→1 when a zero-wait would busy-poll, and never pass 0xFFFFFFFF accidentally (it means INFINITE). Cross-ref: TIMERS area has the same ms-rounding contract on the loop. Target: engine

### [HIST-26] TLS slots: TlsGetValue returning NULL is ambiguous — check GetLastError

- **What Windows does**: `TlsGetValue` returns NULL both for "stored value was NULL" and "invalid slot"; the only disambiguation is `GetLastError() == ERROR_SUCCESS`. `TlsAlloc` returns `TLS_OUT_OF_INDEXES` on exhaustion (limit ~1088 slots/process).
- **How libuv handles it**: src/win/thread.c:538-568: `uv_key_create` maps TLS_OUT_OF_INDEXES → UV_ENOMEM; `uv_key_get` aborts if NULL+lasterror≠SUCCESS; set/delete abort on failure (these "can't fail" on valid keys).
- **History**: `5d2434bf` "unix, windows: add thread-local storage API".
- **Bun disposition**: skip (Rust `thread_local!` / `#[thread_local]`), but the NULL-ambiguity is must-know for any C/FFI glue using raw TlsGetValue (e.g. JSC integration). Target: Phase: threading.

### [HIST-27] Thread affinity: there is no GetThreadAffinityMask — get is implemented as set+restore; latent 1<<i UB

- **What Windows does**: Windows exposes `SetThreadAffinityMask` (returns the previous mask) but no getter. `GetCurrentProcessorNumber` returns the processor _within the current group_ only; DWORD_PTR masks cap at 64 CPUs (processor groups beyond that need different APIs).
- **How libuv handles it**: `uv_thread_getaffinity` (src/win/thread.c:216-243) sets the thread's mask to the _process_ mask, then immediately sets it back to the returned old mask — a race window where the thread can be scheduled anywhere. `uv_thread_setaffinity` validates the request against the process mask. BUG to not copy: both loops test bits with `(1 << i)` where `i` ranges over `uv_cpumask_size()` = `sizeof(DWORD_PTR)*8` = 64 on x64 (src/win/core.c:831-833) — `1 << i` is _int_ arithmetic, UB/wrong for i ≥ 31; should be `((DWORD_PTR)1) << i`. Works in practice only because procmask bits above 31 are rare on the machines this runs on and MSVC's codegen is forgiving.
- **History**: `e9000066` (#3774) added affinity; `64669fdd` added getcpu. The shift bug has never been reported upstream — latent.
- **Bun disposition**: should-port only if Bun exposes affinity (Node doesn't, `uv_thread_setaffinity` is libuv-only); if so, use `GetThreadGroupAffinity`/`SetThreadGroupAffinity` (group-aware, has a real getter, no set+restore race) and widen shifts. Otherwise skip (reason: no Node API surface needs it). Target: Phase: threading.

### [HIST-28] SetThreadDescription/GetThreadDescription: lazy-load from the api-ms DLL, GetModuleHandleW not A

- **What Windows does**: `SetThreadDescription` exists since Win10 1607, but on Windows Server 2016 it is NOT exported from kernel32 in a way you can import-link against safely for downlevel targets; the umbrella DLL `api-ms-win-core-processthreads-l1-1-3.dll` may or may not be present. Also the W/A variant of GetModuleHandle matters in apps that mess with ANSI codepages.
- **How libuv handles it**: One-time `GetModuleHandleW(L"api-ms-win-core-processthreads-l1-1-3.dll")` + GetProcAddress for both symbols (src/win/thread.c:284-292); ENOSYS if absent. setname truncates to `UV_PTHREAD_MAX_NAMELEN_NP` = 32767 on Windows (src/uv-common.h:449), converts WTF-8→UTF-16. getname validates the target thread is alive via `GetExitCodeThread(...) != STILL_ACTIVE` (src/win/thread.c:346-347 — note STILL*ACTIVE==259 collides with a thread that \_exited with code 259*, a documented Windows footgun), converts back with an ENOBUFS-then-heap fallback, and must `LocalFree` the OS string (src/win/thread.c:349-366).
- **History**: `61c966cf` added the APIs import-linked → broke loading on Server 2016 (#4677) → `82351168` switched to lazy-load; `264bb335` enabled on MinGW; `2545ffe7` replaced GetModuleHandleA with W.
- **Bun disposition**: should-port. Bun's baseline (Win10 1809 / Server 2019) has SetThreadDescription in kernel32, so direct linking is safe for bun.exe — but if Bun ships any DLL artifact meant to load on Server 2016, lazy-load. Always LocalFree GetThreadDescription's output. Don't trust the STILL_ACTIVE liveness probe pattern for correctness-critical paths. Target: Phase: threading.

### [HIST-29] uv_thread_join issues an explicit MemoryBarrier because MSDN doesn't promise one; sync primitives abort on misuse

- **What Windows does**: `WaitForSingleObject` on a thread handle almost certainly has acquire semantics, but it is not documented, unlike pthread_join's guarantee that the joined thread's writes are visible.
- **How libuv handles it**: join = WFSO + CloseHandle + `MemoryBarrier()` "For feature parity with pthread_join()" (src/win/thread.c:267-276). `uv_thread_detach` is just CloseHandle (src/win/thread.c:102-107, `556a0f1f`). All semaphore/cond/key failures `abort()` rather than return errors (e.g. src/win/thread.c:469-498) — misuse of invariant primitives is non-recoverable by policy. `uv_sem_init` uses CreateSemaphore with INT_MAX cap.
- **History**: `50706207` "I'm 99% sure WaitForSingleObject() already issues a memory barrier... but since I could find no mention of that on MSDN, let's play it safe". MinGW64 needed `<intrin.h>` for the MemoryBarrier macro on x86+SSE2 (`ee48e6e4`, src/win/thread.c:26-30).
- **Bun disposition**: skip (Rust join provides happens-before). Keep the _posture_: undocumented Windows memory-ordering guarantees deserve an explicit fence or an std primitive, never an assumption. Target: Phase: threading.

### [HIST-30] uv_dlopen uses LOAD_WITH_ALTERED_SEARCH_PATH so a DLL's own dependencies resolve next to it

- **What Windows does**: Plain `LoadLibrary("C:\x\foo.dll")` resolves foo's _dependent_ DLLs using the standard search order rooted at the EXE's directory — not foo's directory. `LOAD_WITH_ALTERED_SEARCH_PATH` (only meaningful with an absolute path) roots the dependency search at the loaded DLL's directory instead, matching what addon authors expect (a native module shipping its deps beside itself).
- **How libuv handles it**: `LoadLibraryExW(filename_w, NULL, LOAD_WITH_ALTERED_SEARCH_PATH)` (src/win/dl.c:42).
- **History**: `62a63a30` "Windows: make uv_dlopen() look in the DLL path to resolve recursive dependencies" (2012; motivated by node native addons with multi-DLL layouts).
- **Bun disposition**: must-port for `bun:ffi` dlopen and N-API addon loading — without it, addons that work under Node break under Bun when they ship sibling DLLs. Consider also offering `AddDllDirectory`-based flags for new code, but the default must match Node/libuv. Target: Phase: ffi/napi-loader.

### [HIST-31] dlopen error message: 4-stage FormatMessage fallback chain (English → default language → %1 substitution → "error: N")

- **What Windows does**: `FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM)` with an explicit English LANGID fails with `ERROR_MUI_FILE_NOT_FOUND` or `ERROR_RESOURCE_TYPE_NOT_FOUND` on localized Windows installs that lack the English MUI pack. The message for `ERROR_BAD_EXE_FORMAT` is the infamous "%1 is not a valid Win32 application" — it contains an unexpanded `%1` insert unless you re-format it with the filename as an argument (and on non-English systems the placeholder is still literally "%1").
- **How libuv handles it**: `uv__dlerror` (src/win/dl.c:92-135): try `MAKELANGID(LANG_ENGLISH, SUBLANG_ENGLISH_US)` with IGNORE_INSERTS; on the two MUI errors retry with langid 0 (caller's default locale); if the result still contains `"%1"` and the error is ERROR_BAD_EXE_FORMAT, re-run FormatMessage in FROM_STRING+ARGUMENT_ARRAY mode substituting the filename; if everything failed, format a literal `"error: %1!d!"` fallback (src/win/dl.c:77-88). The message is cached on `lib->errmsg`, LocalFree'd on next error or `uv_dlclose` (src/win/dl.c:51-62, 97-100); `uv_dlerror` returns "no error" if none.
- **History**: Layered over a decade: `6eb2eaa7` fallback message; `4272e0a6` default-language fallback; `1e6f1159` "Should make the dreaded '%1 is not a valid Win32 application' error message a thing of the past"; `719dfecf` extended %1 handling to non-English Windows; `ebb818bb` (#2052) "On some localized Windows 10 machines FormatMessage can fail with ERROR_RESOURCE_TYPE_NOT_FOUND".
- **Bun disposition**: must-port for `bun:ffi`/addon load errors — users hit ERROR*BAD_EXE_FORMAT constantly (x86 vs x64 addon mismatch, ARM64); the message must name the file and be in \_some* readable language. Rust note: prefer FormatMessageW + IGNORE_INSERTS then substitute yourself; never pass wire-format inserts. Target: Phase: ffi/napi-loader.

### [HIST-32] uv_dlopen path conversion: 32768-WCHAR stack buffer, WTF-8 validation, distinct error codes

- **What Windows does**: Max path for LoadLibrary with `\\?\`-style absolute paths is 32767 chars; invalid UTF-8/WTF-8 in the caller's path must not reach the loader.
- **How libuv handles it**: `WCHAR filename_w[32768]` on the stack (64 KB! src/win/dl.c:29); `uv_wtf8_length_as_utf16` < 0 → reports `ERROR_NO_UNICODE_TRANSLATION` (→ ECHARSET); length > buffer → `ERROR_INSUFFICIENT_BUFFER` (→ EINVAL) — both routed through the same uv**dlerror message machinery (src/win/dl.c:35-40). `uv_dlsym` casts GetProcAddress through `uintptr_t` to dodge the function-pointer-cast warning and reuses uv**dlerror with an empty filename (src/win/dl.c:65-69).
- **History**: `f04d5fc3` moved to native UTF conversion; `f3889085` switched to the WTF-8 utilities; `e0c5fc87` elsewhere removed `_alloca` for the same "big stack buffer" concern (#4348) but dl.c's fixed array stayed (bounded, no VLA).
- **Bun disposition**: should-port. Bun's path layer already does WTF-8→UTF-16; keep the explicit too-long check (don't let the loader truncate) and keep ECHARSET distinct from ENOENT for diagnosability. 64 KB stack use is fine on Bun's main/FFI threads but don't put it on a small-stack fiber. Target: Phase: ffi/napi-loader.

### [HIST-33] THE canonical Win32/WSA → errno table (uv_translate_sys_error) — the ecosystem contract

- **What Windows does**: Win32 has ~16000 error codes; the JS ecosystem (Node, npm packages, tests) hard-depends on the exact errno each one maps to.
- **How libuv handles it**: src/win/error.c:66-174. Complete table (grouped by result):
  - EACCES: `WSAEACCES`, `ERROR_ELEVATION_REQUIRED`, `ERROR_CANT_ACCESS_FILE`
  - EADDRINUSE: `ERROR_ADDRESS_ALREADY_ASSOCIATED`, `WSAEADDRINUSE`; EADDRNOTAVAIL: `WSAEADDRNOTAVAIL`; EAFNOSUPPORT: `WSAEAFNOSUPPORT`
  - EAGAIN: `WSAEWOULDBLOCK`, `ERROR_NO_DATA`
  - EALREADY: `WSAEALREADY`
  - EBADF: `ERROR_INVALID_FLAGS`, `ERROR_INVALID_HANDLE`
  - EBUSY: `ERROR_LOCK_VIOLATION`, `ERROR_PIPE_BUSY`, `ERROR_SHARING_VIOLATION`
  - ECANCELED: `ERROR_OPERATION_ABORTED`, `WSAEINTR`
  - ECHARSET (libuv-only errno): `ERROR_NO_UNICODE_TRANSLATION`
  - ECONNABORTED: `ERROR_CONNECTION_ABORTED`, `WSAECONNABORTED`; ECONNREFUSED: `ERROR_CONNECTION_REFUSED`, `WSAECONNREFUSED`; ECONNRESET: `ERROR_NETNAME_DELETED`, `WSAECONNRESET`
  - EEXIST: `ERROR_ALREADY_EXISTS`, `ERROR_FILE_EXISTS`
  - EFAULT: `ERROR_NOACCESS`, `WSAEFAULT`
  - EHOSTUNREACH: `ERROR_HOST_UNREACHABLE`, `WSAEHOSTUNREACH`
  - EINVAL: `ERROR_INSUFFICIENT_BUFFER`, `ERROR_INVALID_DATA`, `ERROR_INVALID_PARAMETER`, `ERROR_SYMLINK_NOT_SUPPORTED`, `WSAEINVAL`, `WSAEPFNOSUPPORT`
  - EIO: `ERROR_BEGINNING_OF_MEDIA`, `ERROR_BUS_RESET`, `ERROR_CRC`, `ERROR_DEVICE_DOOR_OPEN`, `ERROR_DEVICE_REQUIRES_CLEANING`, `ERROR_DISK_CORRUPT`, `ERROR_EOM_OVERFLOW`, `ERROR_FILEMARK_DETECTED`, `ERROR_GEN_FAILURE`, `ERROR_INVALID_BLOCK_LENGTH`, `ERROR_IO_DEVICE`, `ERROR_NO_DATA_DETECTED`, `ERROR_NO_SIGNAL_SENT`, `ERROR_OPEN_FAILED`, `ERROR_SETMARK_DETECTED`, `ERROR_SIGNAL_REFUSED`
  - EISCONN: `WSAEISCONN`; EISDIR: `ERROR_INVALID_FUNCTION` (see HIST-36)
  - ELOOP: `ERROR_CANT_RESOLVE_FILENAME`
  - EMFILE: `ERROR_TOO_MANY_OPEN_FILES`, `WSAEMFILE`; EMSGSIZE: `WSAEMSGSIZE`
  - ENAMETOOLONG: `ERROR_BUFFER_OVERFLOW`, `ERROR_FILENAME_EXCED_RANGE`
  - ENETUNREACH: `ERROR_NETWORK_UNREACHABLE`, `WSAENETUNREACH`; ENOBUFS: `WSAENOBUFS`
  - ENOENT: `ERROR_BAD_PATHNAME`, `ERROR_DIRECTORY`, `ERROR_ENVVAR_NOT_FOUND`, `ERROR_FILE_NOT_FOUND`, `ERROR_INVALID_NAME`, `ERROR_INVALID_DRIVE`, `ERROR_INVALID_REPARSE_DATA`, `ERROR_MOD_NOT_FOUND`, `ERROR_PATH_NOT_FOUND`, `WSAHOST_NOT_FOUND`, `WSANO_DATA`
  - ENOMEM: `ERROR_NOT_ENOUGH_MEMORY`, `ERROR_OUTOFMEMORY`
  - ENOSPC: `ERROR_CANNOT_MAKE`, `ERROR_DISK_FULL`, `ERROR_EA_TABLE_FULL`, `ERROR_END_OF_MEDIA`, `ERROR_HANDLE_DISK_FULL`
  - ENOTCONN: `ERROR_NOT_CONNECTED`, `WSAENOTCONN`; ENOTEMPTY: `ERROR_DIR_NOT_EMPTY`; ENOTSOCK: `WSAENOTSOCK`; ENOTSUP: `ERROR_NOT_SUPPORTED`
  - EOF (libuv-only): `ERROR_BROKEN_PIPE`
  - EPERM: `ERROR_ACCESS_DENIED` (see HIST-34), `ERROR_PRIVILEGE_NOT_HELD`
  - EPIPE: `ERROR_BAD_PIPE`, `ERROR_PIPE_NOT_CONNECTED`, `WSAESHUTDOWN`
  - EPROTONOSUPPORT: `WSAEPROTONOSUPPORT`; EROFS: `ERROR_WRITE_PROTECT`
  - ETIMEDOUT: `ERROR_SEM_TIMEOUT`, `WSAETIMEDOUT`
  - EXDEV: `ERROR_NOT_SAME_DEVICE`; E2BIG: `ERROR_META_EXPANSION_TOO_LONG`; ESOCKTNOSUPPORT: `WSAESOCKTNOSUPPORT`; EFTYPE: `ERROR_BAD_EXE_FORMAT`
  - default: `UV_UNKNOWN`.
- **History**: Accreted over 14 years, one production bug at a time (`98c79f3e` sorted it; dozens of single-mapping commits: `dfb6be0e` WSANO_DATA, `162e57ba` ERROR_DIRECTORY, `5e507159` INVALID_DRIVE, `7b9bc28e` BAD_PATHNAME, `b0fd1719` ENVVAR_NOT_FOUND, `11ce5df5` ELEVATION_REQUIRED, `431d61af` PRIVILEGE_NOT_HELD, `936795a2` WRITE_PROTECT, `32f6f6e2` NOT_SAME_DEVICE, `163d8de3` ENOSPC family, `00972806` GEN_FAILURE, `72955c29` WSAESHUTDOWN, `f2ab62ec` E2BIG, `46451737` ESOCKTNOSUPPORT, `e7ebae26` CANT_ACCESS_FILE…). `ERROR_INVALID_FLAGS → EBADF` is original (3a91232f) and surprising but unchallenged.
- **Bun disposition**: must-port verbatim as the single shared translation in `src/sys` (Bun already mirrors much of this; diff against this exact list, including the three libuv-invented errnos ECHARSET/EOF-as-error/UNKNOWN semantics). Target: engine

### [HIST-34] ERROR_ACCESS_DENIED stays EPERM (not EACCES): the correctness fix that had to be reverted

- **What Windows does**: ACL denials, read-only-directory rmdir, in-use files etc. all surface as `ERROR_ACCESS_DENIED`. POSIX-correct would usually be EACCES.
- **How libuv handles it**: Maps to `UV_EPERM` (src/win/error.c:158) — knowingly "wrong", kept for compatibility. WSAEACCES (socket-level) maps to EACCES.
- **History**: `04a35efe` (#3193) remapped ACCESS_DENIED → EACCES with a solid POSIX argument; REVERTED in `a6ba1d70` (#3565, ref nodejs/node#42340): "Although the change remapped the error code to the correct one, a lot of code already depends on the incorrect one, so it's not worth the breakage." Node's test suite and untold npm packages match `EPERM` on Windows fs denials.
- **Bun disposition**: must-port (the "wrong" mapping). Bun must emit `EPERM` here to match Node — do not "fix" it. Same meta-lesson as HIST-37/44: errno identity is API surface; changing it is a breaking change regardless of POSIX correctness. Target: engine

### [HIST-35] ERROR_NO_DATA and ERROR_BROKEN_PIPE mean different errnos on read vs write: the dedicated write-path table

- **What Windows does**: `ERROR_BROKEN_PIPE` on ReadFile = clean EOF of a pipe; on WriteFile = the peer is gone (POSIX EPIPE). `ERROR_NO_DATA` (232, "the pipe is being closed") on a _write_ means EPIPE; but generally (e.g. non-blocking named pipe in PIPE_NOWAIT, or TTY reads) it behaves like EAGAIN.
- **How libuv handles it**: General table: BROKEN_PIPE → `UV_EOF`, NO_DATA → `UV_EAGAIN` (src/win/error.c:157, 80). A second function `uv_translate_write_sys_error` overrides both to `UV_EPIPE` and is called only from write completion paths: fs write (src/win/fs.c:1129), stream try-write/write (src/win/stream.c:158, 194) (src/win/error.c:176-183).
- **History**: BROKEN_PIPE-as-EOF: `df78de04` "win,fs: consider broken pipe error a normal EOF" (#3053, reading from a pipe whose writer exited). `47c83367` (#4471) remapped NO_DATA EPIPE→EAGAIN for PIPE_WAIT pipes; that broke write-side reporting, so `473dafc5` (#4562, ref #4548) introduced the write-specific table. Earlier related revert: `103dbaed` reverted `93942168` ("correct error code in uv_fs_read/uv_fs_write") because the blanket change broke other consumers; re-landed correctly as `9604b61d` (#3303: EBADF not EPERM when fd opened with wrong access flags).
- **Bun disposition**: must-port. Bun's sys layer needs the same split: a general translate + a write-context translate (or context parameter). Read-EOF-vs-EPIPE on pipes is core to child-process stdio correctness. Target: engine

### [HIST-36] ERROR_INVALID_FUNCTION → EISDIR: reading/writing a directory handle

- **What Windows does**: `ReadFile`/`WriteFile` on a directory handle fails with the maximally-unhelpful `ERROR_INVALID_FUNCTION` (1). The same code also comes back from various device IOCTLs on objects that don't support them.
- **How libuv handles it**: Global map ERROR*INVALID_FUNCTION → `UV_EISDIR` (src/win/error.c:168) — accepting that the \_other* sources of INVALID_FUNCTION (tape partitioning, firmware vars…) are things libuv never touches.
- **History**: `b68ee404` "Map ERROR_INVALID_FUNCTION to EISDIR — This error is raised when calling read() or write() on a directory... If libuv ever needs to handle these [other] cases, the mapping could be done directly in the fs read()/write() functions" (fixes joyent/node#4951).
- **Bun disposition**: must-port, but prefer the commit's own hindsight: do the EISDIR mapping _in the fs read/write paths_ rather than globally, so future device-IO code isn't lied to. Node-visible behavior (fs.readFile on a dir → EISDIR) must match. Target: engine

### [HIST-37] 2024-25 remap wave: NOACCESS→EFAULT, BUFFER_OVERFLOW→ENAMETOOLONG, BAD_EXE_FORMAT→EFTYPE, ELEVATION_REQUIRED→EACCES, CANT_ACCESS_FILE→EACCES

- **What Windows does**: `ERROR_NOACCESS` (998) is an access _violation_ (segfault-ish, from bad pointers in syscalls); `ERROR_BUFFER_OVERFLOW` (111) literally means "file name too long"; `ERROR_BAD_EXE_FORMAT` (193) = wrong-architecture or non-PE file in CreateProcess/LoadLibrary; `ERROR_ELEVATION_REQUIRED` (740) = UAC-gated executable; `ERROR_CANT_ACCESS_FILE` (1920) shows up on APPEXECLINK reparse points (Windows Store app aliases).
- **How libuv handles it**: src/win/error.c:73-74, 98, 129, 171 — each remap chosen to make spawn/fs failures actionable: EFTYPE lets spawn callers distinguish "not an executable" from generic EINVAL; ELEVATION_REQUIRED → EACCES tells Node users "permission", not "unknown".
- **History**: `7e6590f3` (#4567) "It seemed incorrect to map a segfault to EACCES, since posix would typically map this to EFAULT. ERROR_BUFFER_OVERFLOW is literally 'the filename is too long'"; `36f0789d` (#4445, ref #2348) for CreateProcessW on non-executables; `11ce5df5` ELEVATION_REQUIRED; `e7ebae26` (#2812, nodejs/node#33024) added CANT_ACCESS_FILE alongside APPEXECLINK support — running `python.exe` installed from the Store hits these aliases.
- **Bun disposition**: must-port all five. Bun.spawn of a Store-alias python/winget shim, x86 addons, and UAC-gated exes are real-world cases Bun already gets issues about. Target: engine

### [HIST-38] Network-path errnos: NETNAME_DELETED→ECONNRESET, SEM_TIMEOUT→ETIMEDOUT, OPERATION_ABORTED/WSAEINTR→ECANCELED

- **What Windows does**: `ERROR_NETNAME_DELETED` (64) is how IOCP reports an aborted/reset TCP connection at the NT layer (also SMB share vanishing); `ERROR_SEM_TIMEOUT` (121) — despite the name — is what network-redirector I/O (SMB/WebDAV) returns on timeout; `ERROR_OPERATION_ABORTED` (995) is delivered for every overlapped op cancelled by CancelIoEx/handle close.
- **How libuv handles it**: src/win/error.c:94, 165, 87-88. ECANCELED is the uniform "your op was cancelled" signal; `3f1f11f3` notes it deliberately replaced EINTR for cancelled requests. NT-status→winsock translation for raw AFD paths lives in `uv__ntstatus_to_winsock_error` (src/win/winsock.c:139+).
- **History**: `3f1f11f3` "use UV_ECANCELED to signal canceled requests — This used to be UV_EINTR, but that's not an appropriate error code"; NETNAME_DELETED mapping is original-era; `9918a174` "win,tcp: translate system errors correctly" extended proper translation to TCP paths (#3200); `69ebb2d7` (#3584) fixed spurious ECONNRESET surfacing.
- **Bun disposition**: must-port. Every IOCP-based op in Bun will see OPERATION_ABORTED on shutdown — it must become a quiet ECANCELED, not an exception; SEM_TIMEOUT matters for files on network drives. Target: engine

### [HIST-39] Error-space discipline: `<= 0` passes through untouched; unknown codes become UV_UNKNOWN, never errno reuse

- **What Windows does**: N/A — API contract design.
- **How libuv handles it**: `uv_translate_sys_error` first line: `if (sys_errno <= 0) return sys_errno; /* If < 0 then it's already a libuv error. */` (src/win/error.c:67-69) — makes the translator idempotent and lets internal code pass already-translated codes through mixed paths. Unmatched positive codes → `UV_UNKNOWN`, with `uv_strerror` formatting "Unknown system error %d" so the raw number is never lost.
- **History**: `3ee4d3f1` "return error codes directly" (the great 2012 de-`uv_last_error_`-ification); `23796d20` "Unify OS error reporting".
- **Bun disposition**: must-port the discipline: one signed error domain, negative = translated, translator idempotent on negatives, unknowns preserve the raw Win32 code in the message. Bun's `SystemError.errno`/`code` strings depend on it. Target: engine

### [HIST-40] uv_fatal_error: FormatMessage + DebugBreak + abort, and "FormatMessage messages include a trailing newline"

- **What Windows does**: System messages from FormatMessage end with `\r\n` already; `DebugBreak()` traps into an attached debugger before abort, producing a usable stop instead of a WER dialog.
- **How libuv handles it**: src/win/error.c:35-63 — formats with LANG_NEUTRAL, prints `syscall: (code) message` without adding another newline (comment at :49-50), LocalFree, DebugBreak, abort. Used for unrecoverable init failures (WSAStartup, GetProcAddress of ntdll essentials, DuplicateHandle in thread_self).
- **History**: Original-era; the trailing-newline comment is the kind of cosmetic detail that otherwise yields double-spaced panic logs.
- **Bun disposition**: should-port the shape into Bun's Windows panic/diagnostic path (Output.panic): strip/expect CRLF from FormatMessage, include both the raw code and the message, DebugBreak under debugger. Target: engine

### [HIST-41] snprintf emulation for MSVC < 2015: \_snprintf doesn't NUL-terminate on overflow

- **What Windows does**: Pre-UCRT `_snprintf` returns -1 and does NOT NUL-terminate when output is truncated — silently yielding unterminated buffers; `vsnprintf_s(_TRUNCATE)` + `_vscprintf` emulate C99 semantics (terminate + return would-be length).
- **How libuv handles it**: src/win/snprintf.c:22-42, compiled only `#if defined(_MSC_VER) && _MSC_VER < 1900`.
- **History**: `a59085e1` "use the MSVC provided snprintf where possible" (VS2015+ has conforming snprintf); `764877fd` fixed VS<2012.
- **Bun disposition**: skip — Bun is Rust (no C printf) and its C++ toolchain baseline is far past MSVC 1900; the residual lesson is only that any vendored C code targeting old MSVC may harbor unterminated-buffer assumptions. Target: none.

### [HIST-42] REVERTED: retrying renames to dodge antivirus/indexer locks — policy doesn't belong in the runtime

- **What Windows does**: Antivirus, Windows Search indexer, and backup agents briefly open files with conflicting sharing modes; `MoveFileExW` then fails with ERROR_ACCESS_DENIED/ERROR_SHARING_VIOLATION "randomly", famously breaking npm/webpack/cargo-style rename-into-place flows.
- **How libuv handles it**: It DOESN'T anymore — errors surface directly. `e94c184c` (#1981) made `uv_fs_rename` retry up to 4 times with 250 ms sleeps; `3233ccf1` (#2122, fixes #2098) REVERTED it: "Concerns were raised about the suitability of this policy and I, for one, agree with them" — a hidden 1-second sleep inside a "non-blocking" library, masking real EACCES, unconfigurable, and still insufficient for slow scanners.
- **History**: As above. Downstreams (npm's `graceful-fs`, Rust's `fs_extra` users) implement caller-side retries with backoff instead.
- **Bun disposition**: must-port the _decision_: Bun's sys layer must NOT sleep-retry renames; if Bun wants resilience for its own installer/lockfile writes, retry at the call site (bun install already has such logic) where the policy is visible and bounded. Cross-ref: FS. Target: engine

### [HIST-43] The Wine ↔ GetQueuedCompletionStatusEx saga: fallback removed, partially restored for Wine, finally removed again

- **What Windows does**: `GetQueuedCompletionStatusEx` (Vista+) dequeues a batch of completions in one syscall; plain GQCS returns one. Wine did not implement GQCSEx until ~2019, so binaries requiring it died at startup/poll under Wine.
- **How libuv handles it**: Current code uses GQCSEx unconditionally (`6af08fb5`, 2024: "It was introduced in Vista, so we can assume it's always there now") — `uv_run` dequeues batches in core.c.
- **History**: `fc263218` (2011) probed at runtime and used GQCSEx when present; `fd8d212a` removed the single-completion GQCS poller; `153ea114` (2018) PARTIALLY REVERTED that removal explicitly "restores partial support for using libuv under Wine (which does not implement GetQueuedCompletionStatusEx)"; once Wine gained the API, `6af08fb5` deleted the fallback for good. Net lesson: Wine API coverage lags Windows by years and real users (CI farms, Proton, headless Linux running Windows node.exe) depend on it; libuv chose to carry a fallback for ~6 years for them.
- **Bun disposition**: should-port (decision, not code): Bun can require GQCSEx (modern Wine ≥ 4.x implements it; Bun baseline 1809), but when choosing _newer_ NT APIs (e.g. `NtAssociateWaitCompletionPacket`, IORING) check Wine status first and keep a documented fallback if Wine lacks it — Bun-on-Wine is a real support channel. Target: engine

### [HIST-44] SharePoint/WebDAV mapped drives return "." and ".." with embedded NUL from FindFirstFile

- **What Windows does**: The WebDAV/SharePoint redirector returns directory entries named `".\0"` and `"..\0"` — the reported filename _length includes the trailing NUL_ — so naive `strcmp(name, ".")` filters fail and phantom entries leak into readdir results.
- **How libuv handles it**: The scandir/readdir dot-filter compares in a NUL-tolerant way (matches `.`/`..` even with trailing `L'\0'` included in the counted length) — introduced for uv_fs_scandir.
- **History**: `d03abfd4` "win: work around sharepoint scandir bug — the driver returns '.\0' and '..\0' for those entries, that is, it includes the zero byte in the filename length. Rewrite the filter to catch those entries as well" (fixes nodejs/node#4002).
- **Bun disposition**: must-port. Bun's `fs.readdir` filter must treat `cFileName` as a counted string that may include a trailing NUL when comparing against `.`/`..` (and must not emit entries containing NUL to JS). Cross-ref: FS/readdir. Target: engine

### [HIST-45] sshfs-win: FindFirstFile on an empty directory fails with ERROR_FILE_NOT_FOUND

- **What Windows does**: MSDN documents that FindFirstFile _may_ fail with ERROR_FILE_NOT_FOUND meaning "no matching files" — never observed on NTFS, but sshfs-win (WinFsp) actually does it for empty directories, leaving the dir handle INVALID_HANDLE_VALUE.
- **How libuv handles it**: `uv_fs_readdir`/opendir treats initial-FindFirstFile ERROR_FILE_NOT_FOUND as a valid empty result instead of an error, and guards the INVALID_HANDLE_VALUE on close.
- **History**: `d7dda9ed` (#4953, fixes #4952, 2025): "I can't get FindFirstFile to work like that on regular file systems but it's been reported that it does under sshfs-win and the MSDN documentation clearly states it's possible."
- **Bun disposition**: must-port. Bun's readdir (and glob walker) must special-case ERROR*FILE_NOT_FOUND (and the analogous `STATUS_NO_SUCH_FILE` from NtQueryDirectoryFile) at iteration \_start* as empty-dir, not ENOENT. Cross-ref: FS/readdir. Target: engine

### [HIST-46] Wine + read-only files: FILE_WRITE_ATTRIBUTES at open breaks delete; POSIX-delete migration; the EPERM revert

- **What Windows does**: Deleting read-only files requires clearing FILE*ATTRIBUTE_READONLY or using `FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE` (Win10 RS5+ POSIX delete info class). Wine bug 50771: opening with `FILE_WRITE_ATTRIBUTES` \_fails* on read-only files. Separately, requesting extra access rights at open (`FILE_WRITE_ATTRIBUTES`) trips ACLs that plain DELETE wouldn't.
- **How libuv handles it**: unlink/rmdir use POSIX delete semantics with IGNORE_READONLY when available (`18266a69`, #4318), and `6cf854c1` (#4833, ref JuliaLang/julia#58980) removed FILE_WRITE_ATTRIBUTES from the initial CreateFile, re-opening only in the legacy fallback path — restoring Wine compatibility. Much earlier, `aa1beaa0` added FILE_WRITE_ATTRIBUTES to fs open and was REVERTED by `1954e9e3` because it "was causing EPERM errors in Node.js" (nodejs/node#20112) — extra access bits you don't strictly need WILL break someone's ACL setup.
- **History**: As above; three separate incidents over 7 years all rooted in "minimum necessary access mask".
- **Bun disposition**: must-port the principle + the POSIX-delete path: open with the minimal access mask; use FILE_DISPOSITION_POSIX_SEMANTICS|IGNORE_READONLY_ATTRIBUTE on 1809+ (Bun's baseline guarantees it!), with the attribute-clearing fallback only for exotic filesystems that reject the info class. Cross-ref: FS/delete. Target: engine

### [HIST-47] Wine doesn't implement every NtQueryVolumeInformationFile class — check io_status before trusting output

- **What Windows does**: NT info-class queries can return success-ish while writing nothing, or STATUS_NOT_IMPLEMENTED, on non-Windows kernels (Wine) and odd redirectors; `FileFsVolumeInformation` was unimplemented in Wine for years.
- **How libuv handles it**: fstat's volume-serial query checks the IO_STATUS_BLOCK / status and falls back to the legacy behavior (no volume info) instead of failing the whole stat (`2930d04e` "windows: fall back for volume info query — Wine does not currently support FileFsVolumeInformation... check io_status and fall back").
- **History**: `2930d04e` (2014); same pattern repeated for `FILE_STAT_BASIC_INFORMATION` fast-stat (`4e310d0f` keeps the classic path as fallback when `NtQueryInformationFile` lacks the new class; `65e37353` fixed the probe; `82cdfb75` fixed serial-number inconsistency between the two paths).
- **Bun disposition**: must-port. Bun's stat must (a) verify info-class support per volume/OS and fall back, (b) keep dev/ino derivation IDENTICAL between fast and slow paths or caches keyed on (dev,ino) corrupt. Cross-ref: FS/stat. Target: engine

### [HIST-48] The Win10 v1511 ANSI/VT support double-revert, and ENABLE_VIRTUAL_TERMINAL_PROCESSING probing

- **What Windows does**: Win10 v1511 added VT processing in conhost behind `ENABLE_VIRTUAL_TERMINAL_PROCESSING`; behavior differed subtly from libuv's own emulation (cursor save/restore, color reset), and SetConsoleMode with the flag fails on older builds — you must probe by attempting it.
- **How libuv handles it**: tty.c probes by trying to set the flag and remembers whether the console accepted it; libuv's emulation remains for legacy consoles.
- **History**: `889` added VT passthrough → `8cbabaa8` REVERTED ("Causes regressions on Windows 10 in applications that use ANSI codes", nodejs/node#9542 — colors broke in npm) → `445e3a1f` UN-reverted days later once the real bug was isolated. A genuine flip-flop under release pressure; the lesson is that console-mode behavior differences between conhost builds are subtle enough to ship broken twice. Related: `843b64fa` (2025) added ENABLE_VIRTUAL_TERMINAL_INPUT raw mode; `c51522c0` fixed an init race in uv\_\_init_console (#3970).
- **Bun disposition**: should-port (cross-ref: TTY). Bun's baseline 1809 always has VT, so emulation can be skipped — but still probe SetConsoleMode result (ConDrv redirectors, Wine consoles, CI pseudo-consoles can refuse) and don't assume mode bits persist across handle reopen. Target: Phase: tty.

### [HIST-49] Console resize (SIGWINCH): SetWinEventHook is a system-wide perf hazard; emulators don't own conhost

- **What Windows does**: There's no SIGWINCH. Options: poll console size, watch `WINDOW_BUFFER_SIZE_EVENT` on the _input_ queue (only fires if you're reading input), or `SetWinEventHook` on conhost's window — but an unfiltered WinEvent hook degrades the entire desktop's performance, and under ConEmu/Windows Terminal/32-on-64 the conhost PID may be undiscoverable.
- **How libuv handles it**: `7d950c0d` (#2381): hook is filtered to the conhost PID, signals a dedicated watcher thread, rate-limited to 30 checks/sec; if the conhost PID can't be determined (32-bit app on 64-bit OS, terminal emulators) it PARTIALLY REVERTS to the WINDOW_BUFFER_SIZE_EVENT path (#1408) — documented as the degraded mode for console emulators.
- **History**: `6ad1e815` → `e7f4e9ec` (get SetWinEventHook pointer at startup) → `7d950c0d`; refs microsoft/terminal#1811, #410.
- **Bun disposition**: should-port (cross-ref: TTY). For Bun: prefer reading WINDOW_BUFFER_SIZE_EVENT from its existing console-input thread; only consider WinEvent hooks with PID filter + rate limit; expect no resize events at all under some emulators and treat size as poll-on-demand. Target: Phase: tty.

### [HIST-50] Safe Mode without networking: WSAStartup fails and libuv used to abort every app at startup

- **What Windows does**: In Safe Mode (no networking), winsock service providers aren't loaded; `WSAStartup`/socket creation fail. `GetSystemMetrics(SM_CLEANBOOT)` reports boot mode (1 = safe, 2 = safe+network).
- **How libuv handles it**: `uv__winsock_init` returns early when `GetSystemMetrics(SM_CLEANBOOT) == 1`, skipping WSAStartup and the LSP probes entirely (src/win/winsock.c:95-96) — fs/pipes/process still work; sockets later fail per-call.
- **History**: `af31d014` (#2205) "uv_winsock_init calls abort() if socket operation failed, which means all libuv-based applications are not able to start in safe mode without network."
- **Bun disposition**: should-port. Bun's winsock init must be non-fatal: degrade to "network unavailable" errors per-socket instead of refusing to run `bun build` in Safe Mode/locked-down images. Target: engine

### [HIST-51] Detect non-IFS LSPs at startup with a dummy socket + SO_PROTOCOL_INFOW

- **What Windows does**: Layered Service Providers (old AV/firewall shims) can wrap sockets such that the SOCKET is not a real NT handle (no `XP1_IFS_HANDLES` in dwServiceFlags1). Non-IFS sockets break direct NtDeviceIoControlFile use, SetFileCompletionNotificationModes, and handle-duplication tricks.
- **How libuv handles it**: At init it creates throwaway IPv4/IPv6 TCP sockets, reads `SO_PROTOCOL_INFOW`, and records `uv_tcp_non_ifs_lsp_ipv4/ipv6` globals (src/win/winsock.c:103-136); TCP code consults them to disable the skip-IOCP-on-sync-success optimization (`SetFileCompletionNotificationModes`) which is unsafe through non-IFS LSPs.
- **History**: Original-era (Bert Belder); kept alive because enterprise AV LSPs persisted long past their deprecation. Microsoft deprecated LSPs in Win8 but they still load on Win10/11.
- **Bun disposition**: should-port. If Bun uses `SetFileCompletionNotificationModes` on sockets (it should, for perf), it MUST gate on the IFS probe exactly like this — the failure mode (lost completions through Kaspersky-era LSPs) is an unreproducible-in-CI production hang. Cross-ref: TCP. Target: Phase: tcp/winsock-init.

### [HIST-52] Zero OSVERSIONINFOW (and set dwOSVersionInfoSize) before RtlGetVersion — random GS-cookie crashes otherwise

- **What Windows does**: `RtlGetVersion` (ntdll, immune to manifest version-lying that breaks GetVersionExW) writes a structure whose size field the caller must initialize; passing an uninitialized struct is UB — some kernels write past what you expect based on garbage size.
- **How libuv handles it**: `uv__tcp_keepalive` and friends initialize `OSVERSIONINFOW os_info = {0}; os_info.dwOSVersionInfoSize = sizeof(...)` before `pRtlGetVersion(&os_info)`.
- **History**: `aabb7651` (#5107, fixes #5106, 2025!) — uninitialized struct caused "random crashes in the node.js test suite" manifesting as `__report_gsfailure` (stack-cookie) inside `uv__tcp_keepalive`. Deprecated `GetVersionExW` was removed in `31d91659` (#4486); XP/2k3 checks dropped in `a7b16bfb`; Win11 names added to uv_os_uname `97dcdb19`; arm64 machine type `917c1ad1`.
- **Bun disposition**: must-port. Bun's Windows version probe (it has one for 1809 gating) must use RtlGetVersion with a zeroed, size-initialized struct; never GetVersionExW (manifest-dependent lies). Target: engine

### [HIST-53] Uptime via the performance-counter registry was reverted to GetTickCount64 — fractional seconds weren't worth Wine breakage

- **What Windows does**: `GetTickCount64` (Vista+) gives ms-resolution uptime trivially; the `HKEY_PERFORMANCE_DATA` "System Up Time" counter gives higher precision but requires parsing PERF_DATA_BLOCK, can be disabled by policy, and Wine returns an empty data block.
- **How libuv handles it**: `uv_uptime` = `GetTickCount64() / 1000` after `d0e500c8` (#3470) reverted `50c1d008`/`442aa1f4` ("return fractional seconds in uv_uptime"): "It simplifies the code substantially, while returning nearly the same result... The old code also did not work on Wine-5.0 (where data_size == data_block->HeaderLength, and so no data was present)."
- **History**: As above — a precision feature traded away for robustness.
- **Bun disposition**: should-port: use GetTickCount64 for `os.uptime()`; never touch HKEY_PERFORMANCE_DATA (slow, lockful, fragile, policy-disableable). Cross-ref: UTIL/os. Target: Phase: os-info.

### [HIST-54] uv_cwd/uv_chdir: GetCurrentDirectoryW size-then-read is a TOCTOU against other threads — retry on mismatch

- **What Windows does**: The process CWD is global mutable state; `GetCurrentDirectoryW(0, NULL)` returns required size, but another thread can chdir between that call and the filling call, making the second call return a _different_ length (and undefined buffer contents on insufficient size).
- **How libuv handles it**: Retry loop: if the second call's return doesn't fit/match expectations, re-query (4db0a9a6, #3708). Related Windows-ism handled nearby: after SetCurrentDirectoryW, the per-drive hidden env vars (`=C:`) must be maintained for drive-relative path semantics.
- **History**: `4db0a9a6` "Another thread can change the working directory between calls... Retry if the reported size does not match the expected size because the buffer's contents is undefined in that case."
- **Bun disposition**: must-port. Bun calls GetCurrentDirectoryW in its path layer; use the returned length strictly, loop on growth, and never cache the first length. (Rust std's `env::current_dir` already loops — verify Bun's direct syscall path does too.) Target: engine

### [HIST-55] Available parallelism from the process affinity mask — and the 32-bit popcount bug ("ROR instead of SHR")

- **What Windows does**: Containers/job objects restrict CPU via the affinity mask while GetSystemInfo still reports all CPUs; DWORD_PTR is 32-bit on x86 so bit-count loops sized for 64 double-count when the constant is wrong. >64-CPU machines need processor groups (`GetActiveProcessorCount(ALL_PROCESSOR_GROUPS)`).
- **How libuv handles it**: `uv_available_parallelism` uses `GetProcessAffinityMask` popcount (`58dfb6c8`, #4521); `5ff1fc72` (#4525) fixed the x86 bug: "DWORD_PTR is 32 bits on x86 Windows. Use the right bit count when checking the population count. Interestingly enough, it manifested itself as double counting online processors, presumably because the compiler emits a ROR instead of SHR."
- **History**: As above; two commits four days apart.
- **Bun disposition**: must-port semantics for `os.availableParallelism()`/thread-pool sizing: respect affinity (containers!), use `usize::count_ones` in Rust (no manual shift loops), and consider processor groups for >64-core servers. Cross-ref: UTIL/os. Target: Phase: os-info.

### [HIST-56] Create every socket with WSA_FLAG_NO_HANDLE_INHERIT

- **What Windows does**: Sockets are inheritable handles by default; children spawned concurrently with socket creation inherit them (even with careful PROC*THREAD_ATTRIBUTE handle lists, \_other threads'* CreateProcess calls race), keeping ports bound after the parent closes — the classic "server can't rebind after spawning a child" bug. The flag exists since Win7 SP1.
- **How libuv handles it**: All `WSASocketW` calls pass `WSA_FLAG_NO_HANDLE_INHERIT`, including the init-time LSP probe sockets (`5f3c0d3d` #4810, completed by `d19855c7` #5097, 2025; src/win/winsock.c:105-107).
- **History**: Took until 2024-25 to cover _all_ call sites — the probe sockets and some paths were missed in the first pass. (SetHandleInformation(HANDLE_FLAG_INHERIT, 0) was the older racy mitigation.)
- **Bun disposition**: must-port. Every socket Bun creates (TCP, UDP, pipes via CreateNamedPipe get separate treatment) must be born non-inheritable; auditing "all call sites" is the part libuv got wrong twice. Cross-ref: TCP/UDP/process. Target: Phase: tcp.

### [HIST-57] libuv's own system-DLL loads use LOAD_LIBRARY_SEARCH_SYSTEM32 (CWD DLL-planting defense)

- **What Windows does**: Bare `LoadLibrary("powrprof.dll")` searches the application dir and CWD before system32 — if an attacker drops `powrprof.dll` next to a project the process loads it (worse when elevated).
- **How libuv handles it**: All internal LoadLibrary calls for optional system DLLs (`powrprof.dll`, `bcryptprimitives.dll`, api-ms umbrellas) use `LoadLibraryExA/W(..., LOAD_LIBRARY_SEARCH_SYSTEM32)` (src/win/winapi.c:136-150); core ntdll/kernel32 symbols come from `GetModuleHandle` of already-loaded modules (src/win/winapi.c:85-133, fatal if missing).
- **History**: `cf7f70c2` (#3395): "This may pose a security risk if an attacker is able to place a malicious DLL into the application working directory... especially dangerous if the application is running with elevated privileges." Contrast with user-controlled `uv_dlopen` which deliberately keeps the permissive altered-search-path semantics (HIST-30).
- **Bun disposition**: must-port. Any delay-loaded system DLL in Bun (winhttp? bcrypt? dbghelp for stack traces) must use LOAD_LIBRARY_SEARCH_SYSTEM32; keep the user-dlopen policy separate. Target: engine

### [HIST-58] Randomness: ProcessPrng (bcryptprimitives) is the final form after RtlGenRandom/BCryptGenRandom churn

- **What Windows does**: `RtlGenRandom` (SystemFunction036) is undocumented-but-stable; `BCryptGenRandom` can fail at boot/session edge cases and pulls in bcrypt.dll; `ProcessPrng` (bcryptprimitives.dll, Win8+) is the fast, fork-safe, never-fails primitive both Chromium and Rust std settled on.
- **How libuv handles it**: `uv_random` loads ProcessPrng from bcryptprimitives.dll at init (src/win/winapi.c:146-150), `7484ab25` (#4836).
- **History**: Multi-year migration: RtlGenRandom → BCryptGenRandom (#2762 discussion) → ProcessPrng, mirroring Rust std's identical journey (rust-lang/rust#121337).
- **Bun disposition**: skip implementation (Rust std / `getrandom` crate already use ProcessPrng on modern toolchains) but pin the decision: do not introduce BCryptGenRandom anywhere in Bun's Windows code. Cross-ref: crypto. Target: none.

### [HIST-59] A feature flag disabled for 11 years is dead code: the "active streams" optimization

- **What Windows does**: N/A — codebase hygiene with a Windows twist: the optimization (skip IOCP registration for streams with pending activity tracking) was disabled because of correctness hazards with LSPs/edge cases, then carried as `#if 0`-equivalent for a decade.
- **How libuv handles it**: Removed entirely in `2b4b293e` "win,tcp,udp: remove 'active streams' optimization — It has been disabled for 11 years, I guess it should remain that way."
- **History**: As above.
- **Bun disposition**: skip (no code to port) — recorded as the counterweight to HIST-51: optimizations gated off for unreproducible-environment reasons rot; either gate them on a probe (IFS check) and keep them tested, or delete. Target: none.

### [HIST-60] WTF-8, not UTF-8, is the only lossless Windows path encoding (lone surrogates exist in real filenames)

- **What Windows does**: NTFS filenames are arbitrary u16 sequences — unpaired surrogates are legal and occur in the wild; strict UTF-8 conversion either errors or replaces them, making some files unopenable/round-trip-lossy.
- **How libuv handles it**: All UTF-16↔8 conversions go through WTF-8 helpers (`uv_wtf8_to_utf16`, `uv_utf16_length_as_wtf8`, `uv__copy_utf16_to_utf8` — src/idna.c:370+), adopted tree-wide and exported publicly. getaddrinfo/getnameinfo/dl/thread-name all use them (e.g. src/win/getaddrinfo.c:131-137, src/win/dl.c:35).
- **History**: `8f32a14a` "fs: use WTF-8 on Windows" (#2970, a 3-year PR); `f3889085` exported the utilities noting "Windows is not 64-bit ready here, but this implementation is" (WideCharToMultiByte takes int lengths!); then a string of precision bugs: `d09441ca` WTF-8 decode bug (#4092), `ec0ab5d7` off-by-one utf16→wtf8 (#5050), `c6b67af3` off-by-one in uv_wtf8_to_utf16 (#4609), `73bfbb99` assert fix (#5021), `428f2c44` wrong error code. Even after the design was right, FIVE arithmetic bugs followed.
- **Bun disposition**: must-port (Bun already speaks WTF-8 — verify its converters against libuv's final semantics, especially: lengths in/out excluding vs including NUL, 64-bit length safety vs WideCharToMultiByte's int, and ENOBUFS contracts). Cross-ref: STRINGS/paths. Target: engine

### [HIST-61] Cygwin/MSYS named pipes don't speak Windows-native pipe conventions

- **What Windows does**: Cygwin/MSYS emulate POSIX FIFOs over named pipes with their own naming (`\\.\pipe\cygwin-...-fifo`), message framing, and EOF behavior; PeekNamedPipe/transmit semantics differ; ipc handle-passing can't work cross-runtime.
- **How libuv handles it**: A series of point fixes: `ebafb90a` "fix compatibility with cygwin pipes"; `6398251a` "implement support for cygwin and msys2" (uname/IPC detection); `2e197418` "recognize EOF on named pipe closure"; `317fc756` connect-to-cygwin-pipe ENOTSOCK fix; `580f0327` disabled non-functional IPC handle send under cygwin.
- **History**: As above — driven by users running node/libuv binaries inside MSYS2/Cygwin shells (very common for git-bash workflows on the exact machines Bun developers use).
- **Bun disposition**: should-port awareness (cross-ref: PIPES): Bun's pipe client should treat "pipe that EOFs instead of ERROR_BROKEN_PIPE", odd byte/message modes, and refusal of handle-passing as expected when the peer is cygwin/msys (git-bash spawning bun, bun spawning git). Test under git-bash explicitly. Target: engine

### [HIST-62] Blocking ReadFile on a pipe can deadlock with the kernel — uv_read_stop must be able to cancel it

- **What Windows does**: A synchronous ReadFile on one end of a duplex named pipe can block in the kernel such that even closing/cancelling from another thread hangs (kernel bug acknowledged in the commit), wedging getsockname-style queries and read-stop.
- **How libuv handles it**: `837c62c7` "windows: make uv_read_stop immediately stop reading — implements locking around the blocking call to ReadFile to get around a Windows kernel bug where a blocking ReadFile operation on a stream can deadlock the thread", letting uv_read_stop/uv_pipe_getsockname pause pending reads (pipe.c's read-thread + mutex design).
- **History**: Closes joyent/libuv#1313; this is why libuv's non-overlapped pipe reads happen on a dedicated thread that can be fenced, rather than blocking the loop thread.
- **Bun disposition**: must-port the design constraint (cross-ref: PIPES): never issue an uncancellable synchronous ReadFile on the event-loop thread for inherited/legacy pipes; use overlapped IO or a fenced reader thread with CancelIoEx + the lock dance. Target: engine

### [HIST-63] AF_UNIX on Windows needs the MSAFD provider GUID added to the "fast poll" whitelist

- **What Windows does**: Windows 10 1803+ supports AF_UNIX sockets via a distinct MSAFD provider; code that whitelists known-good MSAFD provider GUIDs (to use AFD fast-poll IOCTLs directly) silently falls back to slow paths for the new family.
- **How libuv handles it**: `8e67d8b3` (#3511) appended the AF_UNIX MSAFD GUID to the provider table so uv_poll's zero-syscall AFD path engages.
- **History**: As above (2022 — four years after the OS feature shipped; nobody noticed the silent slow path).
- **Bun disposition**: should-port (cross-ref: POLL/net): if Bun does direct-AFD polling, include the AF_UNIX provider GUID from day one; more generally, provider-GUID whitelists silently rot — log when a socket's provider forces the fallback. Target: Phase: poll.

### [HIST-64] uv_os_uname/ProductName: registry strings lie across architectures; Win11 still reports kernel 10.0

- **What Windows does**: Win11's `ProductName` registry value still says "Windows 10 Pro" (Microsoft never updated it); build number ≥ 22000 is the only reliable Win11 signal; WOW64 vs native registry views differ for ProductName; arm64 needs its own machine string.
- **How libuv handles it**: `97dcdb19` (#3718) derives "Windows 11" from build ≥ 22000; `66160d69` improved ProductName accuracy between arches; `917c1ad1` (#4840) added arm64 machine type to uv_os_uname.
- **History**: As above.
- **Bun disposition**: should-port for `os.version()`/`os.release()`/`navigator`-ish surfaces: derive Win11 naming from RtlGetVersion build number, not the registry; report arm64 properly (Bun ships Windows arm64 eventually). Cross-ref: UTIL/os. Target: Phase: os-info.

### [HIST-65] Spawn-adjacent env quirks the archaeology surfaced (cwd length, %PATH% unset, NoDefaultCurrentDirectoryInExePath, no-extension exes, UNC forward slashes, Store-app assert)

- **What Windows does**: CreateProcessW limits lpCurrentDirectory to MAX_PATH (long-path opt-in does NOT lift it); `%PATH%` can be entirely absent from the env block; the `NoDefaultCurrentDirectoryInExePath` env var changes exe search semantics (CVE-adjacent CWD-exe hijack defense); files without extensions are executable when explicitly requested; UNC paths arrive with forward slashes; spawning a UWP/Store app makes some process-info queries fail where classic apps don't.
- **How libuv handles it**: `23632e91` checks cwd length before spawning (clear error instead of mystery failure); `c97017dd` (#4116) tolerates unset %PATH%; `5e302730` (#4238) honors NoDefaultCurrentDirectoryInExePath; `3f7191e5` (#4292) optional no-extension execution; `7024f8b2` allows UNC with forward slash; `c03569f0` (#4152) avoids an assert after spawning a Store app.
- **History**: As above — six independent user-filed bugs.
- **Bun disposition**: must-port as a checklist (cross-ref: PROCESS): Bun.spawn must (1) pre-validate cwd ≤ MAX_PATH with a real error, (2) not crash on missing PATH, (3) respect NoDefaultCurrentDirectoryInExePath in its own exe resolution, (4) normalize UNC slashes pre-CreateProcess, (5) keep process-info queries failure-tolerant for UWP children. Target: Phase: process.

### [HIST-66] Kill/wait ESRCH semantics: pid reuse and the exit-code race

- **What Windows does**: Process handles, not pids, are the real identity; OpenProcess on a reused pid succeeds with the _wrong_ process; a terminated-but-not-reaped process still opens fine, so "does pid exist" probes need GetExitCodeProcess + STILL_ACTIVE (with the 259 collision caveat) and even then race.
- **How libuv handles it**: `129362f3` (#4301) reworked ESRCH detection for uv*kill; `ff958799` (#4341) "almost fix race detecting ESRCH in uv_kill" — the commit title admits it's only \_almost* fixable; `58418d53` (#3539) added validation around process->pid usage.
- **History**: As above — kill(pid, 0) liveness probes are fundamentally approximate on Windows.
- **Bun disposition**: should-port (cross-ref: PROCESS): hold the child HANDLE from spawn to reap (never re-open by pid); implement `process.kill(pid, 0)` as OpenProcess+GetExitCodeProcess best-effort and document the race; never treat exit code 259 as proof of life for correctness decisions. Target: Phase: process.

### [HIST-67] fd→handle hash table: static over-allocation cost 2.4 MB of BSS for 15 years

- **What Windows does**: N/A — libuv keeps a process-global hash from CRT fds to its own file state for uv_fs file ops.
- **How libuv handles it**: `12fbd344` (#4869, fixes #4823, 2025) shrank the table 16x: "The static initial table reserved space for MxN elements but only used every Nth element" — 2592 KB → 162 KB, found only when someone audited bun-adjacent memory footprints of node.exe.
- **History**: As above.
- **Bun disposition**: skip (Bun's fd model differs; Rust collections size dynamically) — recorded as a reminder to audit static per-process tables in ported designs. Target: none.

### [HIST-68] Reverted twice: uv_try_write for pipes — sync-write fast paths on Windows pipes break IPC framing

- **What Windows does**: Mixing immediate (non-overlapped or instantly-completing) writes with queued overlapped writes on the same named pipe reorders bytes relative to the IPC message stream assumptions; Node's IPC channel (which multiplexes JSON messages + handle-passing) is exquisitely sensitive to this.
- **How libuv handles it**: `244e0e20` implemented uv_try_write for pipes + `e1143f12` fixes; BOTH REVERTED (`07261493`, `03bb7037`, 2023): "For some reason this is breaking node.js IPC. I plan to investigate it but we can let this for the next release." Never re-landed — pipes still return UV_EAGAIN from uv_try_write (try-write stays TCP-only).
- **History**: As above; also `f55efb2f` (#4555) documents "ipc code does not support async read" constraints, and `7026ae0f` (#4784) fixed a uv_read_cb→uv_read_start recursion bug — the pipe state machine resists re-entrancy.
- **Bun disposition**: must-port the caution (cross-ref: PIPES): for Bun's child-IPC named pipes, keep ONE write submission path (always overlapped, always queued in order); add a sync fast path only with an IPC-framing stress test. Target: engine

### [HIST-69] uv_getnameinfo/uv_getaddrinfo register with the loop BEFORE work submission; done-callback always unregisters — even on cancel

- **What Windows does**: N/A — loop refcount discipline.
- **How libuv handles it**: Both entry points `uv__req_register(loop)` after validation but before submit (src/win/getaddrinfo.c:337-338, src/win/getnameinfo.c:127); the done fns unconditionally `uv__req_unregister` (guarded only by `loop != NULL` for the sync-getaddrinfo case, src/win/getaddrinfo.c:211-212, src/win/getnameinfo.c:85). This keeps the loop alive (uv_run won't exit) while DNS is in flight, and exactly balances on UV_ECANCELED.
- **History**: `87df1448` "unix,windows: refactor request init logic"; `9efa8b35` "rework reference counting scheme" — the unbalanced-refcount era produced loops that exited with DNS in flight or never exited.
- **Bun disposition**: must-port. Bun's event-loop keep-alive (`ref/unref`) must be incremented before the work item becomes visible to another thread and decremented exactly once on every terminal path (success, error, cancel). Target: engine

### [HIST-70] uv_translate_sys_error is also the HRESULT-code sink: callers strip HRESULT to its code first

- **What Windows does**: Newer APIs (SetThreadDescription, many shell/COM-adjacent calls) return HRESULTs, not Win32 codes; `HRESULT_CODE(hr)` recovers the embedded Win32 code only for FACILITY_WIN32 HRESULTs — for other facilities it produces a misleading small number.
- **How libuv handles it**: `uv_thread_setname/getname` do `uv_translate_sys_error(HRESULT_CODE(hr))` (src/win/thread.c:320, 353) — acceptable because SetThreadDescription only returns FACILITY_WIN32 failures in practice.
- **History**: `61c966cf`/`82351168` — code-comment-only; no recorded bug, but it's a latent sharp edge for new HRESULT-returning APIs.
- **Bun disposition**: should-port with a guard: Bun's error translation should have a dedicated `from_hresult` that checks the facility before extracting the code, instead of blind HRESULT_CODE. Target: engine

---

## Tally (70 entries)

- must-port: 41 (HIST-01..15, 17, 18, 30, 31, 33..39, 42, 44..47, 52, 54..57, 60, 62, 65, 68, 69)
- should-port: 19 (HIST-16, 19, 20, 23, 27\*, 28, 32, 40, 43, 48, 49, 50, 51, 53, 61, 63, 64, 66, 70)
- skip (with reason): 10 (HIST-21, 22†, 24, 25, 26, 29, 41, 58, 59, 67 — plus explicitly-skipped sub-items recorded inside entries: MinGW addrinfoW shim [HIST-02], XP fallbacks [HIST-07])

\* HIST-27 is should-port-only-if-affinity-is-ever-exposed (no current Bun/Node API needs it; reason recorded).
† HIST-22 is skip-for-plain-spawning (Rust std covers it) / must-know for raw HANDLE passing; counted under skip.
