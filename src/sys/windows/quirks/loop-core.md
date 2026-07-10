# libuv Windows institutional knowledge — area: loop-core

Source worktree: `C:/Users/dylan/code/libuv-read` (libuv master, ~v1.51 era).
Files covered: `src/win/core.c`, `src/win/async.c`, `src/win/loop-watcher.c`,
`src/win/detect-wakeup.c`, `src/timer.c`, `src/uv-common.c`, plus the inline
headers they depend on (`src/win/req-inl.h`, `src/win/handle-inl.h`,
`src/win/handle.c`, `src/win/winapi.c`, `src/win/util.c`, `src/uv-common.h`).

---

### [LOOP-01] Dequeue IOCP completions in batches of 128 with GetQueuedCompletionStatusEx, non-alertable

- **What Windows does**: `GetQueuedCompletionStatus` returns one completion per syscall; under load that is one kernel transition per event. `GetQueuedCompletionStatusEx` (Vista+) dequeues an array in one call. The `fAlertable` parameter controls whether user APCs can interrupt the wait.
- **How libuv handles it**: `uv__poll` declares `OVERLAPPED_ENTRY overlappeds[128]` on the stack and calls `GetQueuedCompletionStatusEx(loop->iocp, overlappeds, 128, &count, timeout, FALSE)` (core.c:430, 466-471). Alertable is always FALSE — APCs are never delivered on the loop thread, so nothing can re-enter the loop mid-wait. 128 is unchanged since the API was adopted in 2011.
- **History**: fc263218 (2011, Igor Zinkovsky/Microsoft) "use GetQueuedCompletionStatusEx if the OS supports it" introduced the 128 batch.
- **Bun disposition**: must-port. Batch dequeue + non-alertable wait. Target: engine

### [LOOP-02] GQCS(Ex) can return up to ~15ms BEFORE the requested timeout — retry until target time, exponential backoff from round 3

- **What Windows does**: The IOCP wait timeout is quantized to the scheduler tick (~15.6ms default). `GetQueuedCompletionStatus(Ex)` "can occasionally return a little early" — it may time out up to one tick before the requested duration elapsed. This is not documented by Microsoft.
- **How libuv handles it**: `uv__poll` computes `timeout_time = loop->time + timeout` up front, and on a WAIT_TIMEOUT result with `timeout > 0` it calls `uv_update_time` and, if `timeout_time > loop->time`, recomputes the remaining timeout and loops. Because "the first call should return very close to the target time and the second should reach it, but this is not stated in the documentation", from the third round onward it pads the timeout exponentially: `timeout += repeat ? (1 << (repeat - 1)) : 0` so a busy loop is impossible (core.c:441, 505-524).
- **History**: 427e4c9d (2015, João Reis) "win: wait for full timeout duration", fixing joyent/node#8960 (timers firing early; node's test-timers-first-fire.js flaky). The PREVIOUS workaround was worse: ffe2ef06 (2013) added `uv__time_forward()` which _lied about loop time_ — artificially advancing `loop->time` to the timeout target so timers fired "on time" by clock fraud. 427e4c9d deleted that and retried instead. Related: 6ced8c2c (2014) switched loop time from GetTickCount to QueryPerformanceCounter, making the early return observable.
- **Bun disposition**: must-port. Without this, every `setTimeout` can fire up to 15ms early; a naive "one wait per timeout" loop reintroduces node#8960. Target: engine

### [LOOP-03] Completion packets with NULL lpOverlapped are pure wakeups — filter before container_of

- **What Windows does**: `PostQueuedCompletionStatus(iocp, 0, 0, NULL)` is legal and delivers an entry whose `lpOverlapped` is NULL. Nothing prevents third parties (or libuv itself) from posting such packets.
- **How libuv handles it**: the dequeue loop checks `if (overlappeds[i].lpOverlapped)` before doing `container_of` (core.c:490-498). NULL entries are silently dropped — their only effect is having woken the wait. libuv itself posts NULL packets from `uv__wake_all_loops` (core.c:174) on system resume.
- **History**: the filter was added in 6fa3524e (2016) together with the resume-wakeup mechanism; before that a NULL packet would have crashed the dispatch.
- **Bun disposition**: must-port. Any "wake the loop" mechanism that posts NULL packets requires this check; `container_of(NULL)` yields a garbage pointer, not NULL. Target: engine

### [LOOP-04] OVERLAPPED is embedded in the request; the kernel owns that memory until the completion is dequeued

- **What Windows does**: For every overlapped I/O the kernel writes into the caller-supplied OVERLAPPED until the operation completes AND its packet is dequeued from the IOCP. Freeing the memory earlier is silent corruption.
- **How libuv handles it**: `uv_req_t` embeds the OVERLAPPED (`req->u.io.overlapped`); the poller recovers the request with `container_of(overlapped, uv_req_t, u.io.overlapped)` (core.c:495-497) — zero allocation per event, but it means request/handle lifetime is governed by IOCP drainage. The entire deferred-close design (LOOP-25..28) and the async close race (LOOP-32) exist to honor this. Per-handle `reqs_pending` counters gate endgames (handle-inl.h:51-60).
- **History**: design present since the original `oio` code (pre-2011); never changed.
- **Bun disposition**: must-port (the invariant, not necessarily the layout). In Rust: completion state must be heap-pinned and not dropped until its packet is dequeued or the IOCP handle is closed. Target: engine

### [LOOP-05] OVERLAPPED.Internal doubles as the request's NTSTATUS — including for self-posted requests

- **What Windows does**: the kernel stores the final NTSTATUS of an overlapped operation in `OVERLAPPED.Internal` (documented as "reserved"). `GetOverlappedResult` reads it; so can you.
- **How libuv handles it**: `SET_REQ_STATUS/GET_REQ_STATUS` alias `overlapped.Internal` (req-inl.h:31-53). Errors are converted with `RtlNtStatusToDosError` (`GET_REQ_ERROR`) or a private NTSTATUS→winsock mapping (`GET_REQ_SOCK_ERROR`). libuv also writes this field itself (`SET_REQ_ERROR/SET_REQ_SUCCESS`) for requests it posts manually, so consumers cannot tell kernel completions from fake ones. `UV_REQ_INIT` open-codes `Internal = 0` (STATUS_SUCCESS) because of a header circular dependency (uv-common.h:349-357).
- **History**: original design; the winsock error mapping has its own table (`uv__ntstatus_to_winsock_error`, cross-ref WINSOCK area).
- **Bun disposition**: must-port (the convention). Reading Internal avoids a `GetOverlappedResult` syscall per completion; if Bun fakes completions it must write a coherent status the same way. Target: engine

### [LOOP-06] Create the IOCP with concurrency value 1

- **What Windows does**: `CreateIoCompletionPort`'s last argument caps the number of threads the kernel will wake concurrently; 0 means "number of CPUs".
- **How libuv handles it**: `loop->iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, NULL, 0, 1)` (core.c:236). One loop thread drains the port, so the correct concurrency hint is 1, not the default.
- **History**: 11ee00f0 (2011, pre-libuv `oio`) deliberately changed the 0 to 1; no message rationale, code-only. Has survived 14 years untouched.
- **Bun disposition**: must-port (one-line). Use 1; 0 invites the kernel to count CPUs for a single-consumer port. Target: engine

### [LOOP-07] A non-timeout GQCSEx failure is fatal, not recoverable

- **What Windows does**: `GetQueuedCompletionStatusEx` fails with e.g. ERROR_INVALID_HANDLE or ERROR_ABANDONED_WAIT_0 if the port is closed or the handle is bad — conditions that mean the loop's core invariant is gone.
- **How libuv handles it**: anything other than WAIT_TIMEOUT calls `uv_fatal_error(GetLastError(), "GetQueuedCompletionStatusEx")` (core.c:505-507), which FormatMessage's the error to stderr and aborts (error.c:35-63). Same policy for `PostQueuedCompletionStatus` failure (req-inl.h:76-82).
- **History**: original design.
- **Bun disposition**: must-port (the policy decision). These failures indicate corrupted process state; panicking loudly with the syscall name beats limping. Route through Bun's crash reporting rather than fprintf. Target: engine

### [LOOP-08] Update loop time immediately after the poll returns, in every arm

- **What Windows does**: time passes while blocked in the kernel; any timer math using the pre-poll cached time is stale by up to the full timeout.
- **How libuv handles it**: `uv_update_time(loop)` runs right after a successful dequeue (core.c:504) and inside the early-return retry arm (core.c:512); `uv_run` additionally updates time right before running timers each iteration (core.c:749-750).
- **History**: 02094664 (2022) "win,loop: add missing uv_update_time — Time of loop should be updated after the IOCP wait" fixed a path where the success arm updated but a later refactor had lost coverage; ffe2ef06 (2013) is the original "GetTickCount might lag" time-accounting fix.
- **Bun disposition**: must-port. Cache loop time per iteration (one QPC read per wakeup), but refresh at every poll exit before timer processing. Target: engine

### [LOOP-09] uv_backend_timeout returns int -1 for "infinite"; the DWORD conversion to INFINITE is implicit and load-bearing

- **What Windows does**: `INFINITE` is `(DWORD)0xFFFFFFFF`.
- **How libuv handles it**: `uv__next_timeout` returns `-1` to "block indefinitely" (timer.c:150); `uv_run` passes the int through `DWORD timeout` (core.c:702, 726-732), so -1 wraps to exactly INFINITE. No explicit mapping anywhere — it works only because INFINITE == (DWORD)-1.
- **History**: code comment only ("block indefinitely").
- **Bun disposition**: must-port, but make it explicit. In Rust, map `Option<u64>`/`-1` to INFINITE deliberately; a u32::try_from would panic or saturate wrongly. Target: engine

### [LOOP-10] The GetQueuedCompletionStatus single-event fallback poller existed solely for Wine — added, removed, restored, removed again

- **What Windows does**: nothing — Wine (pre-2018) did not implement `GetQueuedCompletionStatusEx`, and ReactOS/XP lacked it too.
- **How libuv handles it**: today it doesn't: GQCSEx is called directly (core.c:466). Historically there was a parallel `uv__poll_wine` using GQCS one event at a time.
- **History**: a full saga. fc263218 (2011) added GQCSEx via GetProcAddress with GQCS fallback; fd8d212a (2018) deleted the fallback ("all supported Windows have it"); 153ea114 (2018, Jameson Nash) **partially reverted** it to restore Wine support; aa93eb25 (2020, ReactOS dev) re-did the GetProcAddress lookup so the import table had no hard dependency (XP + DllCompat shims); 6af08fb5 (2022) finally removed everything — Vista+ assumed, Wine had implemented GQCSEx by then.
- **Bun disposition**: skip. Reason: Bun's baseline is Windows 10 1809+, and current Wine implements GQCSEx (libuv itself dropped the fallback in 2022 with no complaints since). Record so nobody re-adds a GQCS path "for compatibility". Target: n/a.

### [LOOP-11] UV_METRICS_IDLE_TIME forces a zero-timeout probe poll first, then restores the real timeout

- **What Windows does**: nothing — this is pure bookkeeping, but it interacts with the early-return retry loop in a non-obvious way.
- **How libuv handles it**: when idle-time metrics are on, `uv__poll` saves `user_timeout = timeout`, sets `timeout = 0`, and after the first GQCSEx call restores it (core.c:443-449, 473-476). Effect: round 0 is a free probe that classifies already-queued events as `events_waiting` (counted when `actual_timeout == 0`, core.c:491-493); if nothing was queued the retry loop blocks with the original target time. `provider_entry_time` is only set when `timeout != 0` so the probe never counts as idle (core.c:454-458); `lfields->current_timeout` is published so `uv__work_done` can classify threadpool completions (core.c:460-464, story in e02642cf). `uv__metrics_update_idle_time` is called once per poll round and once more after the 8-round drain in uv_run (core.c:483, 739-744).
- **History**: e8effd45 (2020) added the idle-time API; e02642cf (2023) fixed events/events_waiting counting and added `current_timeout`.
- **Bun disposition**: should-port. Node exposes this as `performance.eventLoopUtilization()`; Bun needs equivalent counters for compat, but can compute them with simpler bookkeeping if it owns the loop. Target: engine

### [LOOP-12] Pending requests form a circular singly-linked list through a tail pointer; snapshot-and-null before dispatch

- **What Windows does**: n/a — internal data structure, but the re-entrancy contract is the point.
- **How libuv handles it**: `loop->pending_reqs_tail` points at the TAIL; `tail->next_req` is the head (core.c:858-879). `uv__process_reqs` captures `first = tail->next_req`, NULLs `pending_reqs_tail`, then walks until it wraps (core.c:557-571). Because the live list is detached first, requests inserted _by the callbacks being dispatched_ accumulate on a fresh list and are not processed in this pass — preventing unbounded recursion within one pass and making the 8-round cap (LOOP-13) meaningful. O(1) insert, zero allocation, no head pointer field.
- **History**: structure dates to the 2011 split (3a91232f); the snapshot semantics were always there.
- **Bun disposition**: must-port (the detach-before-dispatch semantics; the exact list shape is free). Target: engine

### [LOOP-13] Drain pending requests at most 8 rounds after poll to avoid loop starvation; leftovers force a zero-timeout next poll

- **What Windows does**: completion callbacks (e.g. a `write_cb`) often synchronously start new I/O that completes instantly (pipes to fast peers), re-filling the pending list during dispatch.
- **How libuv handles it**: after `uv__poll`, `uv_run` does `for (r = 0; r < 8 && loop->pending_reqs_tail != NULL; r++) uv__process_reqs(loop);` (core.c:734-737). If the list is still non-empty after 8 rounds, `uv_backend_timeout` returns 0 (`pending_reqs_tail == NULL` condition, core.c:418) so the next iteration polls without sleeping and continues draining — bounded latency for IOCP events, no lost work.
- **History**: two-act story. Act 1: fce90652 (2011) "avoid the loop starvation bug, GH-154" — the original code flushed pending reqs+endgames in an _unbounded_ `while` before polling, which starved I/O entirely; the fix processed each once per iteration. Act 2: ee3718dd (2022, #3598) added the 8-round post-poll drain so write callbacks run promptly in the same iteration as their completion (matching Unix order-of-events expectations surfaced by nodejs/node#42340 and libuv discussion #3550). 8 is an arbitrary fairness constant, also used on Unix.
- **Bun disposition**: must-port, constant and all. Target: engine

### [LOOP-14] Debug-only scan asserting a request is not already in the pending list (double-completion corruption)

- **What Windows does**: some APIs complete to the IOCP even when they also succeed synchronously — e.g. `WriteFile` on a port-associated handle posts a packet even if you already handled the result. Posting the same request again (e.g. `POST_COMPLETION_FOR_REQ` on a req the kernel will also complete) corrupts the circular list into an infinite or crossed loop.
- **How libuv handles it**: `uv__insert_pending_req` walks the whole circular list under `#ifdef _DEBUG` asserting `req != current` (core.c:861-870).
- **History**: c7ebe68f (2015) "win: fix pipe blocking writes" — blocking pipe writes called POST*COMPLETION_FOR_REQ while WriteFile \_also* posted a packet, so GQCSEx returned the same req twice; the assert was added with the fix to catch the class. (Cross-ref: PIPES, and `SetFileCompletionNotificationModes`/UV_HANDLE_SYNC_BYPASS_IOCP in 2b4b293e which removed the skip-IOCP optimization for streams.)
- **Bun disposition**: should-port as a debug assertion. The bug class (one completion source, two enqueues) is easy to recreate in Rust. Target: engine

### [LOOP-15] Request dispatch is a type switch; the back-pointer to the handle lives in different fields per req type

- **What Windows does**: n/a — internal convention with a trap.
- **How libuv handles it**: `uv__process_reqs` switches on `req->type` (core.c:573-626). UV_READ/UV_ACCEPT/UV_UDP_RECV/UV_WAKEUP/UV_SIGNAL_REQ/UV_POLL_REQ/UV_PROCESS_EXIT/UV_FS_EVENT_REQ recover the handle from `req->data`; UV_WRITE/UV_CONNECT/UV_SHUTDOWN/UV_UDP_SEND use a typed `req->handle` field. The `DELEGATE_STREAM_REQ` macro takes a `handle_at` parameter to paper over this (core.c:530-554), then sub-switches on handle type (TCP/PIPE/TTY).
- **History**: accumulated since 2011; 88c2af0e (2018) revised req handling; the asymmetry was never unified.
- **Bun disposition**: should-port the dispatch idea, skip the asymmetry: in Rust use one enum/trait with a uniform handle reference. Recorded so the porter doesn't copy the dual convention. Target: engine

### [LOOP-16] uv_run phase order is exact and load-bearing

- **What Windows does**: n/a — contract.
- **How libuv handles it**: per iteration (core.c:719-755): capture `can_sleep` → `uv__process_reqs` → `uv__idle_invoke` → `uv__prepare_invoke` → compute timeout → `uv__metrics_inc_loop_count` → `uv__poll` → ≤8× `uv__process_reqs` → `uv__metrics_update_idle_time` → `uv__check_invoke` → `uv__process_endgames` → `uv_update_time` + `uv__run_timers` → recompute alive → break for ONCE/NOWAIT. Before the while loop, DEFAULT mode runs timers once for backward compatibility (LOOP-17). Identical to Unix since 2022-2023 (src/unix/core.c:427-492).
- **History**: converged over a decade: 79880121 (2013) first alignment with Unix; 2b9c374c (2013) endgames moved after poll; bc56a4e0 (2013) idle every iteration; e58dc269/e37a2a0d (2014) ONCE semantics; 1fe609ea, ee3718dd (2022); 66009549 (2023, #3927) moved timers to end-of-iteration.
- **Bun disposition**: must-port exactly if Bun exposes uv-compatible run semantics (uv_run is part of Bun's public N-API surface via uv compat). Deviations surface as Node addon bugs (nodejs/node#42340 class). Target: engine

### [LOOP-17] DEFAULT mode runs timers once BEFORE the loop, but only if alive and not stopped

- **What Windows does**: n/a — API compatibility quirk.
- **How libuv handles it**: `if (mode == UV_RUN_DEFAULT && r != 0 && loop->stop_flag == 0) { uv_update_time(loop); uv__run_timers(loop); }` (core.c:710-717). Rationale in comment: timers conceptually run after polling, but a pre-loop pass preserves historical behavior where a due timer fires before the first poll; for ONCE/NOWAIT timers must run at most once per uv_run call, so no pre-pass.
- **History**: 66009549 (2023, #3927, fixes #3686) restructured timer execution; 24d1d080 (2023, #4048) added the `r != 0 && stop_flag == 0` gate — timers must NOT fire when uv_stop() preceded uv_run(), and (because unref'd handles don't count toward `r`) must not fire when every timer is unref'd, "for backwards compatibility".
- **Bun disposition**: must-port (incl. the unref subtlety — Node relies on unref'd timers not keeping/driving the loop). Target: engine

### [LOOP-18] can_sleep is captured BEFORE processing callbacks, not after

- **What Windows does**: n/a.
- **How libuv handles it**: `can_sleep = loop->pending_reqs_tail == NULL && loop->idle_handles == NULL;` is sampled at the top of the iteration, before reqs/idle/prepare run; UV_RUN_ONCE only computes a real timeout if `can_sleep` (core.c:720-728). If this iteration had immediate work, ONCE polls with timeout 0 — "ONCE implies forward progress" without risking a sleep after having made progress.
- **History**: e58dc269 (2014) introduced `ran_pending`-style logic; 1fe609ea (2022, #3590) replaced it with the pre-sampled `can_sleep` because "wrong accounting of idle handles made it sleep when there was nothing left to do" — an idle handle stopped during its own callback left stale accounting and hung UV_RUN_ONCE.
- **Bun disposition**: must-port. Sampling after processing reintroduces #3590. Target: engine

### [LOOP-19] uv_backend_timeout returns 0 under five conditions; "loop alive" is deliberately NOT one of them

- **What Windows does**: n/a.
- **How libuv handles it**: returns `uv__next_timeout` only when `stop_flag == 0` AND (active handles OR active reqs) AND no pending reqs AND no idle handles AND no endgame handles; else 0 (core.c:414-423). The commented-out `/* uv__loop_alive(loop) && */` marks that using the full alive predicate (which includes pending/endgame) would be circular — those conditions force 0, not sleep-forever.
- **History**: 2e9d86e1 (2013) added the API; a3530830 (2016) "simplified" it to use `uv_loop_alive` and was **reverted** ten days later by b2e13b9f after "unforeseen regressions" (#1096/#1102) — the simplification conflated "nothing keeps the loop alive → return 0" with "work is imminent → return 0". 939a0563 (2022) consolidated into the current single expression with the tombstone comment.
- **Bun disposition**: must-port, including treating idle handles and queued-but-unprocessed work as zero-timeout conditions. Keep the tombstone as a comment. Target: engine

### [LOOP-20] Loop-alive includes pending requests and endgame handles, not just active handles/reqs

- **What Windows does**: n/a.
- **How libuv handles it**: `uv__loop_alive = active handles || active reqs || pending_reqs_tail || endgame_handles` (core.c:401-406). Without the last two, a callback that queues follow-up work right before the alive check could see uv_run exit with work still queued.
- **History**: 939a0563 (2022, #3466): "we might have gotten somewhat stuck if the user caused an event to be added in idle or prepare callbacks, or was embedding libuv". Endgames were part of alive since 79880121 (2013); pending reqs were the 2022 addition.
- **Bun disposition**: must-port. Bun embeds the loop under JSC microtask draining — exactly the embedder scenario #3466 covers. Target: engine

### [LOOP-21] stop_flag: works in every run mode, reset on uv_run exit with a conditional store, and must be explicitly initialized

- **What Windows does**: n/a.
- **How libuv handles it**: `uv_stop` sets `loop->stop_flag = 1` (uv-common.c:656-658); checked in the while condition and the pre-loop timer gate; cleared at uv_run exit with `if (loop->stop_flag != 0) loop->stop_flag = 0;` — the if exists so the compiler emits a conditional store and doesn't dirty a cache line every call (core.c:757-762).
- **History**: bb3d1e24 (2012) added uv_stop; 4b957482 (2013) fixed it being ignored in ONCE/NOWAIT modes; ae2b30a4 (2013) "initialize stop_flag explicitly" — default loop lived in BSS (zeroed) but `uv_loop_new` heap loops had garbage, an archetypal "works for the default loop only" bug.
- **Bun disposition**: must-port (semantics + zero-init of all loop state on heap-allocated loops). The cache-line micro-opt is optional but free. Target: engine

### [LOOP-22] ONCE/NOWAIT still run the full post-poll tail (incl. timers) and return loop-aliveness

- **What Windows does**: n/a.
- **How libuv handles it**: the `break` for ONCE/NOWAIT happens after endgames + timers + alive recompute (core.c:752-754), so one full iteration always completes; the return value `r` is the alive result so embedders can loop `while (uv_run(loop, UV_RUN_NOWAIT))`. NOWAIT never computes a timeout (stays 0); ONCE computes one only if can_sleep (LOOP-18).
- **History**: f6d8ba3c (2012) "run expired timers in run-once mode"; e37a2a0d (2014) stopped treating uv_run_mode as a bitmask (modes were once OR-able and tested with `&`).
- **Bun disposition**: must-port. Bun's event loop integration (and N-API addons calling uv_run) depend on these exact semantics. Mode is an enum, never a bitmask. Target: engine

### [LOOP-23] Active idle handles force a zero-timeout poll every iteration (idle ≠ "when idle")

- **What Windows does**: n/a.
- **How libuv handles it**: `idle_handles != NULL` is one of the zero conditions in uv_backend_timeout (core.c:419) and part of can_sleep; `uv__idle_invoke` runs every iteration before prepare (core.c:723). Despite the name, an active idle handle turns the loop into a non-blocking spin — this is the documented libuv semantic Node's `setImmediate` is built on (via check handles + idle trickery in node).
- **History**: bc56a4e0 (2013) "call idle handles on every loop iteration — the name uv_idle is now a bit of a misnomer", aligning with Unix.
- **Bun disposition**: must-port. Idle/prepare/check are exposed through uv compat to N-API addons (and Bun's own internals may use them). Target: engine

### [LOOP-24] uv_run on a dead loop still updates loop time

- **What Windows does**: n/a.
- **How libuv handles it**: `r = uv__loop_alive(loop); if (!r) uv_update_time(loop);` (core.c:706-708) — even a no-op uv_run advances `uv_now()`, so callers polling `uv_now` between empty runs see time move.
- **History**: 15af49a7 (2012) "always update loop time".
- **Bun disposition**: should-port. Cheap and matches documented uv_now behavior. Target: engine

### [LOOP-25] Close is ALWAYS asynchronous: CLOSING flag now, endgame later, close_cb from the loop — gated on reqs_pending == 0

- **What Windows does**: outstanding OVERLAPPED operations reference handle-owned memory until their packets drain (LOOP-04); `CloseHandle`/`closesocket` forces them to complete with STATUS*CANCELLED \_eventually*, not synchronously.
- **How libuv handles it**: `uv_close` only sets `UV_HANDLE_CLOSING` and performs type-specific shutdown (handle.c:67-148). The handle joins the endgame queue (`uv__want_endgame`, handle-inl.h:88-95) either immediately (timer/prepare/check/idle: handle.c:99-121) or when its last in-flight request drains (`DECREASE_PENDING_REQ_COUNT` → want_endgame when CLOSING && reqs_pending == 0, handle-inl.h:51-60). Per-type endgame functions (core.c:632-698) free OS resources and finally `uv__handle_close` runs the user's close_cb. Calling uv_close twice asserts (handle.c:70-73).
- **History**: design predates libuv proper; the per-type endgame switch has been stable since 3a91232f (2011).
- **Bun disposition**: must-port (the two-phase protocol and the reqs_pending gate). This is the central memory-safety invariant of a Windows loop; Rust ownership makes violations compile-visible only if the design encodes "kernel borrows until drained". Target: engine

### [LOOP-26] Endgame queue is a LIFO intrusive stack, drained to exhaustion in one phase (close_cb cascades run same-iteration)

- **What Windows does**: n/a.
- **How libuv handles it**: `uv__want_endgame` prepends (`handle->endgame_next = loop->endgame_handles; loop->endgame_handles = handle;`) guarded by `UV_HANDLE_ENDGAME_QUEUED` to prevent double-queue (handle-inl.h:88-95, flag cleared at core.c:639). `uv__process_endgames` is `while (loop->endgame_handles)` (core.c:632-637) — if a close_cb closes more handles whose endgames become ready synchronously, they are processed in the same phase, so close cascades don't take one loop iteration each. LIFO means close_cb order is reverse of endgame-ready order — unspecified, and users must not rely on it.
- **History**: stable since 2011; the unbounded drain here is safe (unlike pending reqs, LOOP-13) because endgames don't poll and each handle endgames at most once.
- **Bun disposition**: must-port (queue + queued-flag + drain-to-exhaustion). Target: engine

### [LOOP-27] A closing handle counts as an active handle so the loop stays alive to deliver its close_cb — even if unref'd

- **What Windows does**: n/a.
- **How libuv handles it**: Windows' `uv__handle_closing` (handle-inl.h:63-73) adds the handle to the loop's active count unless it was already counted (active AND ref'd), and clears ACTIVE. Net effect: every closing handle contributes exactly one to `active_handles` until `uv__handle_close` removes it — including handles that were unref'd or never started. Without this, `uv_run` could exit between uv_close() and the close_cb, leaking the handle forever. (Unix achieves the same with a separate `closing_handles` list checked in its loop-alive; Windows folds it into the counter and adds `endgame_handles` to uv\_\_loop_alive.)
- **History**: 637be161 / 9efa8b35 (2012) "make active and closing handle state independent" / "rework reference counting scheme" — the great refcount rework.
- **Bun disposition**: must-port (either mechanism; the invariant is "closing handles keep the loop alive until their close callback has run, regardless of ref state"). Target: engine

### [LOOP-28] Endgames run AFTER poll and check, near the end of the iteration — never before poll

- **What Windows does**: n/a.
- **How libuv handles it**: `uv__process_endgames` sits after `uv__check_invoke` (core.c:746-747). A handle closed during the reqs/idle/prepare phases is not freed until after the same iteration's poll — its in-flight completions get dequeued first (and discarded by handle state checks), upholding LOOP-04.
- **History**: 2b9c374c (2013) "run close callbacks after polling for i/o — makes uv-win compatible with uv-unix" (fixes joyent/libuv#796). Before, endgames ran before poll, so close callbacks observed stale I/O state and ordering differed from Unix.
- **Bun disposition**: must-port. Target: engine

### [LOOP-29] uv_async_send: cross-thread wakeup is an atomic 0→1 test-and-set; only the winning thread posts

- **What Windows does**: there is no InterlockedExchange8; interlocked ops on wider targets require alignment.
- **How libuv handles it**: `uv__atomic_exchange_set` is `_InterlockedOr8(target, 1)` on MSVC (with a comment explaining the missing-Exchange8/alignment tradeoff) or `__sync_fetch_and_or(target, 1)` on GCC/clang (async.c:29-47). `uv_async_send` posts a completion only when the previous value was 0 (async.c:96-98) — N sends coalesce into one packet, the documented uv_async coalescing semantic.
- **History**: 7fb43d3c (2012) moved it to atomicops-inl.h; dc117c7d (2025) moved it back ("nothing else ever used it", refs libuv#4819 about async atomics); 45463740 (2025) replaced leftover inline x86 asm with the intrinsic.
- **Bun disposition**: must-port (in Rust: `AtomicU8::swap/fetch_or` with SeqCst; coalescing is part of the contract Node code expects). Target: engine

### [LOOP-30] The async wakeup posts the handle's own embedded request — NOT a NULL packet — so it dispatches through the normal req path

- **What Windows does**: n/a.
- **How libuv handles it**: each `uv_async_t` embeds `async_req` (type UV_WAKEUP, `req->data = handle`, async.c:65-67); `POST_COMPLETION_FOR_REQ` posts `&req->u.io.overlapped` (req-inl.h:76-82). The poller therefore treats it like any I/O completion and `uv__process_reqs` routes UV_WAKEUP to `uv__process_async_wakeup_req` (core.c:604-606). Contrast with `uv__wake_all_loops`, which posts NULL packets because it must not touch per-handle state (LOOP-03). PostQueuedCompletionStatus failure is fatal.
- **History**: original multiplicity design (78debf9f, 2011).
- **Bun disposition**: must-port (a uniform "wakeup is a completion" model keeps the poll loop branch-free; reserve NULL packets for stateless wakes). Target: engine

### [LOOP-31] async_sent is cleared on the loop thread BEFORE the callback runs — sends during the callback re-arm correctly

- **What Windows does**: n/a — lost-wakeup race.
- **How libuv handles it**: `uv__process_async_wakeup_req` does `handle->async_sent = 0;` first, then dispatches (async.c:109-115). A producer calling uv_async_send while the callback executes sees 0 and posts a fresh packet; clearing after the callback would lose those signals. Note the clear is a plain store paired with the interlocked RMW on producers — x86-safe, flagged in libuv#4819 as needing proper atomics on weaker memory models.
- **History**: code structure since 2011; #4819 (2025) is the open atomics-hygiene issue.
- **Bun disposition**: must-port; in Rust make both sides atomic ops on the same `AtomicU8` (store(0, SeqCst) before callback), closing the #4819 gap by construction. Target: engine

### [LOOP-32] Async close race: if a wakeup packet is in flight, the endgame must wait for it to drain

- **What Windows does**: the posted packet references `handle->async_req.u.io.overlapped` — memory inside the handle. Freeing the handle before the packet is dequeued is UAF; dequeuing it after close_cb ran would dispatch on a dead handle.
- **How libuv handles it**: `uv__async_close` queues the endgame immediately ONLY if `!async_sent`; otherwise it just sets CLOSING (async.c:75-81). When the in-flight packet arrives, `uv__process_async_wakeup_req` sees CLOSING and queues the endgame instead of calling the callback (async.c:111-113). `uv__async_endgame` asserts CLOSING && !async_sent (async.c:49-55). A closing async never invokes its callback.
- **History**: 13b8ebd7 (2012) "a closing async watcher should not call it's callback" — before, the callback fired during close.
- **Bun disposition**: must-port. This is the canonical "kernel still borrows my memory" dance for self-posted packets; any Rust async-handle close path needs the same two-step. Target: engine

### [LOOP-33] uv_async_send error handling: type check returns bare -1 (errno isn't thread-safe), closing check is debug-only

- **What Windows does**: n/a.
- **How libuv handles it**: `if (handle->type != UV_ASYNC) return -1;` with comment "Can't set errno because that's not thread-safe" (async.c:87-90); sending to a closing handle is documented user error enforced only by `assert(!(flags & UV_HANDLE_CLOSING))` (async.c:92-94) — in release builds it's a silent race the user owns.
- **History**: code comment only.
- **Bun disposition**: should-port the contract: uv_async_send must be callable from any thread with zero shared mutable state besides the handle; keep "send after close begins" as a debug assertion, not a runtime branch. Target: engine

### [LOOP-34] Every loop owns an internal unref'd async (wq_async) for threadpool completion; loop_close force-discards its possibly-in-flight packet

- **What Windows does**: n/a.
- **How libuv handles it**: `uv_loop_init` creates `loop->wq_async` (callback `uv__work_done`), immediately unrefs it and marks `UV_HANDLE_INTERNAL` (core.c:292-297) so it neither keeps the loop alive nor appears in `uv_walk` (uv-common.c:585 skips INTERNAL). `uv__loop_close` cannot run a loop iteration to close it normally, so it cheats: `wq_async.async_sent = 0; wq_async.close_cb = NULL;` then closing+close inline (core.c:343-351) — safe only because the IOCP is destroyed moments later, so the stale packet can never be dequeued. Asserts then verify the work queue really was empty (core.c:360-363).
- **History**: 8d11aacb (2012) unified threadpool; beb54fe7 (2014) "destroy work queue elements when closing a loop"; 623aa05a (2020, #2610) replaced `assert(!async_sent)` with the force-clear — `uv__work_done` drains the queue but a stale wakeup packet can legitimately still be queued, a benign race the assert misdiagnosed.
- **Bun disposition**: must-port (cross-ref: THREADPOOL). Bun's loop will have an equivalent "work done" wakeup; its close path must tolerate a stale in-flight wakeup. Target: engine

### [LOOP-35] Loop-watcher lists keep a per-loop next\_\* iterator pointer so any handle can be stopped from inside any callback

- **What Windows does**: n/a — iterator invalidation.
- **How libuv handles it**: prepare/check/idle handles form intrusive doubly-linked lists. `uv__X_invoke` walks via `loop->next_X_handle`, advancing it BEFORE the callback (loop-watcher.c:107-118). `uv_X_stop` patches both the list head and, crucially, `loop->next_X_handle` if the stopped handle is the upcoming one (loop-watcher.c:84-99). Result: a callback may stop itself, the next handle, or any other without corrupting the in-progress walk. Loop init NULLs all three next pointers (core.c:279-281).
- **History**: structure dates to 3a91232f/78debf9f (2011); survived the 2012-2013 reworks unchanged.
- **Bun disposition**: must-port (the safety property; Unix's queue-rotation is an equally valid implementation — see LOOP-36). Target: engine

### [LOOP-36] Windows runs loop-watchers in REVERSE registration order; Unix rotates the queue — observable platform divergence

- **What Windows does**: n/a.
- **How libuv handles it**: Windows `uv_X_start` pushes at the list head (loop-watcher.c:58-67) and invoke walks head→tail, so callbacks fire newest-first, in fixed order every iteration. Unix moves the queue aside and re-inserts each handle at the tail after invoking (src/unix/loop-watcher.c) — registration order, and handles started during invocation never run that round on either platform (Windows: inserted at head, before the already-advanced iterator... they run NEXT iteration because next pointer was already taken from old head; Unix: inserted into the live list, not the moved one).
- **History**: never reconciled; code-only.
- **Bun disposition**: should-port deliberately: pick ONE order (registration order recommended) and document it; do not copy the divergence. No known Node-visible dependency on watcher order, but addons could observe it. Target: engine

### [LOOP-37] Global registry of all loops: mutex-protected dynamic array with chunked growth and lazy shrink

- **What Windows does**: n/a — exists solely so a system event can reach every loop (LOOP-38).
- **How libuv handles it**: `uv__loops` array, `UV__LOOPS_CHUNK_SIZE 8`, guarded by `uv__loops_lock` (core.c:81-163). Add appends (grow by chunk, NULL-fill new slots); remove swaps-with-last; missing loop is ignored ("if loop was not found, ignore"); array is freed entirely when the last loop closes; shrink only when capacity ≥ 4 chunks and usage < half. Registration is the LAST step of uv_loop_init (core.c:299-301) so registered loops always have a valid IOCP; removal is the FIRST step of uv\_\_loop_close (core.c:341) so the waker can't post to a dying port (it also checks `iocp != INVALID_HANDLE_VALUE` as belt-and-braces, core.c:173).
- **History**: 6fa3524e (2016) introduced it; e7a7ffb1 (2017, #1125/#1252) fixed the "allocated in uv\_\_init, never freed" leak that Valgrind-style leak checkers flagged in embedders that init/close loops repeatedly.
- **Bun disposition**: must-port (a `Mutex<Vec<LoopHandle>>` or registered-weak-list; ordering of register/unregister vs IOCP lifetime is the part that matters). Target: engine

### [LOOP-38] System resume must wake ALL loops with a NULL packet, because IOCP timeouts don't account for sleep time

- **What Windows does**: a thread blocked in `GetQueuedCompletionStatus(Ex)` with a finite timeout does NOT get credit for time the machine spent suspended (S3/S4, modern standby): after resume, the wait continues for the full remaining duration. A 30-minute timer can fire 30 minutes _after resume_, hours late on the wall clock (nodejs/node#6763).
- **How libuv handles it**: `uv__init_detect_system_wakeup` registers `PowerRegisterSuspendResumeNotification(DEVICE_NOTIFY_CALLBACK, ...)` (detect-wakeup.c:28-56), loaded by GetProcAddress from powrprof.dll (winapi.c:136-145) since it's Win8+. The callback fires on a system thread for `PBT_APMRESUMESUSPEND` (user-initiated resume) OR `PBT_APMRESUMEAUTOMATIC` (any resume — the reliable one; SUSPEND only follows if there's user input) and calls `uv__wake_all_loops`, posting `PostQueuedCompletionStatus(iocp, 0, 0, NULL)` to every registered loop under the registry lock (core.c:165-177). Each loop wakes, sees a NULL packet (LOOP-03), falls out of poll, updates time, and runs due timers. The `_HPOWERNOTIFY` registration handle is a discarded local — deliberately never unregistered (process lifetime). The original commit comments call this "the cleanest method, but Win8+ only" — the contemplated Win7 fallback (hidden window + WM_POWERBROADCAST) was never added.
- **History**: 6fa3524e (2016, fixes nodejs/node#6763); typedefs hand-declared in winapi.h:4756 because old SDKs lacked them.
- **Bun disposition**: must-port. Bun's baseline (Win10 1809+) always has the API, so link it directly — no GetProcAddress needed, but keep the "wake everything on resume" semantics or timers drift after laptop sleep. Cross-ref: TIMERS. Target: engine

### [LOOP-39] uv_loop_init: IOCP first, registry last, time zeroed before first read, full unwind chain on failure

- **What Windows does**: n/a — init ordering.
- **How libuv handles it**: order (core.c:227-322): `uv__once_init()` (process-wide init, LOOP-40..42) → CreateIoCompletionPort → internal_fields calloc → metrics mutex → `loop->time = 0` then `uv_update_time` ("to prevent uninitialized memory access... must be initialized to zero before calling uv_update_time for the first time" — because update_time asserts `new_time >= loop->time`) → queues/counters → `pending_reqs_tail = NULL`, `endgame_handles = NULL` → timer heap malloc'd → watcher lists + next pointers NULLed → poll_peer_sockets zeroed (cross-ref: POLL) → `timer_counter = 0`, `stop_flag = 0` → wq mutex → wq_async init → `uv__loops_add` LAST. Failure unwinds in exact reverse via labeled gotos (core.c:305-321), and sets `loop->iocp = INVALID_HANDLE_VALUE` after CloseHandle on the failure path so later code can recognize a dead loop.
- **History**: 787f5fff (2013) introduced uv_loop_init/close; 7284adfa (2018) made it return UV_ENOMEM properly; 942e1418 (2025) further OOM-hardening.
- **Bun disposition**: must-port (in Rust the unwind chain is Drop-ordering; replicate "register globally only when fully constructed" and "time starts valid"). Target: engine

### [LOOP-40] Process-wide SetErrorMode at first loop init: no Windows Error Reporting dialogs, ever

- **What Windows does**: by default, hard errors (critical-error, GP fault, open-file-not-found on removable media) pop modal dialog boxes and freeze the process until a human clicks — fatal for servers and CI.
- **How libuv handles it**: `uv__init` (run once via uv_once, core.c:179-182, 332-334) calls `SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX)` — "Tell Windows that we will handle critical errors." Note it does NOT set SEM_NOALIGNMENTFAULTEXCEPT, and the setting is process-global (last writer wins; embedders that call SetErrorMode later clobber it).
- **History**: present since the earliest node-era code.
- **Bun disposition**: must-port at process init (Bun is always the process owner, unlike libuv-the-library, so set it unconditionally and early). Target: engine

### [LOOP-41] CRT invalid-parameter handler replaced with a no-op so bad FDs return errors instead of killing the process

- **What Windows does**: MSVCRT functions given an invalid fd (e.g. `_get_osfhandle(9999)`) invoke the "invalid parameter handler", which by default terminates the process (or in debug pops a dialog) — instead of returning an error.
- **How libuv handles it**: `_set_invalid_parameter_handler(uv__crt_invalid_parameter_handler)` where the handler is an empty function (core.c:73-79, 184-189); CRT calls then fail with EBADF-style errors. Gated `#if !defined(__MINGW32__) || __MSVCRT_VERSION__ >= 0x800` because old mingw32 msvcrt lacks the API.
- **History**: c0716b3d (2013) "improved handling of invalid FDs" (fixed node test-fs-read-stream / test-listen-fd-ebadf); 5676924c (2013, #774) the mingw-w64 gate. This is also a process-wide hijack — embedders' own handlers are silently replaced; never fixed, known embedding wart.
- **Bun disposition**: should-port. Bun's Rust layer should avoid CRT fd APIs entirely, but Bun _does_ expose CRT fds via `uv_open_osfhandle`/N-API and links the CRT; installing the no-op handler at process init prevents addon-triggered process death. Decide once, document the process-wide effect. Target: engine

### [LOOP-42] Debug-build CRT assert suppression: thread-local enable flag + \_CrtSetReportHook, used as a scoped guard around \_get_osfhandle

- **What Windows does**: in \_DEBUG CRT builds, `_get_osfhandle` on an invalid fd raises a \_CRT_ASSERT report (dialog/breakpoint) even though it would return INVALID_HANDLE_VALUE correctly in release.
- **How libuv handles it**: `uv__crt_dbg_report_handler` registered via `_CrtSetReportHook` (core.c:43-67, 195-197) swallows \_CRT_ASSERT reports only when the thread-local `uv__crt_assert_enabled` is FALSE; `UV_BEGIN/END_DISABLE_CRT_ASSERT()` (internal.h:43-57) brackets exactly one call site: `uv__get_osfhandle` (handle-inl.h:98-110). If a debugger is attached the handler still triggers a breakpoint. MinGW32 (not -w64) lacks crtdbg.h so it's compiled out there.
- **History**: c0716b3d (2013) introduced; fe8322d2 (2014) `__declspec(thread)`→UV_THREAD_LOCAL for GCC; 636b108d (2014) MinGW32 exclusion.
- **Bun disposition**: skip, with reason: Bun's native layer should never call CRT fd functions (`bun.sys` wraps Win32 handles directly), and Bun debug builds are clang, not MSVC \_DEBUG CRT. Revisit only if a debug-CRT code path calling `_get_osfhandle` appears (e.g. vendored libuv compat shim already handles itself). Target: n/a.

### [LOOP-43] Timer heap ties are broken by a monotonically increasing start_id so equal deadlines fire FIFO

- **What Windows does**: n/a — heaps are not stable; two timers due at the same ms would otherwise fire in arbitrary (heap-shape-dependent) order.
- **How libuv handles it**: `timer_less_than` compares `timeout` then `start_id` (timer.c:37-54); `start_id = loop->timer_counter++` is allocated on every `uv_timer_start` (timer.c:85-86), including the implicit restart in `uv_timer_again` — so repeating timers also rotate fairly among themselves. `timer_counter` is u64, initialized at loop init (core.c:285).
- **History**: fadfeaf6 (2013, Shigeki Ohtsu) "fix timer order in case of same timeout" — Node setTimeout ordering guarantees depend on it.
- **Bun disposition**: must-port. Bun's JS timers already need insertion-order FIFO for equal deadlines (Node compat); the native heap must encode it, not rely on heap stability. Target: engine

### [LOOP-44] Run due timers in two phases — collect into a ready queue, then dispatch — or a zero-timeout timer restarted from its own callback busy-loops the process

- **What Windows does**: n/a.
- **How libuv handles it**: `uv__run_timers` (timer.c:164-194) first pops every due timer off the heap (`uv_timer_stop` + insert into a local `ready_queue`), THEN runs callbacks from the queue (`uv_timer_again` re-arm BEFORE the callback, so the callback sees the rearmed state and can cancel it). A callback calling `uv_timer_start(h, cb, 0, 0)` reinserts into the _heap_, which is only consulted next iteration — forward progress guaranteed. Supporting detail: `uv_timer_t.node` is a union of heap node and queue node; `uv_timer_init` and `uv_timer_stop` must `uv__queue_init(&handle->node.queue)` so stopping a timer that sits in another timer's ready_queue safely unlinks it (timer.c:62, 97-108) — `uv_timer_stop` on a not-heap-active handle does `uv__queue_remove` precisely for the "stopped from a sibling callback while in ready_queue" case.
- **History**: 51a22f60 (2023, #4245/#4250) the busy-loop fix; bb6fbcf6 (2024, #4248/#4304) "reset the timer queue on stop — there were instances where this didn't happen and could cause memory corruption". The corruption: a ready_queue entry stopped-and-restarted left a dangling queue link.
- **Bun disposition**: must-port (both the two-phase run AND the stop-unlinks-from-ready-queue rule; in Rust, an enum state {InHeap, InReadyQueue, Idle} makes the corruption unrepresentable). Target: engine

### [LOOP-45] uv_timer_start: absolute deadline with overflow clamp to u64::MAX; EINVAL on closing handle or NULL cb; again() requires repeat

- **What Windows does**: n/a.
- **How libuv handles it**: `clamped_timeout = loop->time + timeout; if (clamped_timeout < timeout) clamped_timeout = (uint64_t)-1;` (timer.c:78-80) — a u64 ms overflow check (wrap detection), so `uv_timer_start(h, cb, UINT64_MAX, 0)` parks forever instead of firing immediately. Starting a closing timer or NULL cb returns UV_EINVAL (timer.c:73-74); start implicitly stops first (restart semantics); `uv_timer_again` is EINVAL without a cb and a no-op without repeat (timer.c:112-122); `uv_timer_get_due_in` clamps to 0 (timer.c:135-140); `timeout` field is zero-initialized at init for valgrind-cleanliness (fc2c1a23).
- **History**: 2ee2d462 (2019, #2416) the closing-handle EINVAL; fc2c1a23 (2020, #3020).
- **Bun disposition**: must-port (Node's timers wrap these exact semantics; the overflow clamp matters for `setTimeout(cb, 2**63)` style abuse). Target: engine

### [LOOP-46] uv\_\_next_timeout clamps to INT_MAX ms and uses -1 as the infinite sentinel, 0 when already due

- **What Windows does**: the IOCP timeout parameter is a DWORD of milliseconds; values ≥ INFINITE-1 behave as INFINITE.
- **How libuv handles it**: returns -1 if the heap is empty ("block indefinitely"), 0 if `min.timeout <= loop->time`, else `diff` clamped to INT_MAX (timer.c:143-161). The int return + INT_MAX clamp keeps the value representable and avoids accidentally producing 0xFFFFFFFF (=INFINITE) from a large-but-finite diff.
- **History**: code comment only.
- **Bun disposition**: must-port (clamp before narrowing; never let a finite timeout numerically equal INFINITE). Target: engine

### [LOOP-47] On Windows the timer heap is a separately-allocated struct behind a void\*, not embedded in uv_loop_t

- **What Windows does**: n/a — ABI artifact.
- **How libuv handles it**: `timer_heap(loop)` returns `loop->timer_heap` (pointer) on \_WIN32 vs `&loop->timer_heap` (embedded) elsewhere (timer.c:28-34); core.c mallocs/frees it (core.c:267-273, 366-367). Reason: `uv_loop_t` is public ABI defined in include/uv/win.h, which can't include the private heap-inl.h, so the field is `void*` and heap-allocated.
- **History**: 95c5bf8d (2018) "merge timers implementation" — replaced Windows' legacy red-black/binary _tree_ timers with the shared binary heap, noting "generally better performance".
- **Bun disposition**: skip the indirection (embed the heap in Bun's loop struct — no public C ABI constraint); must keep the heap-not-tree choice. Target: engine

### [LOOP-48] Loop time is QueryPerformanceCounter scaled to milliseconds via double math, asserted monotonic

- **What Windows does**: GetTickCount has ~15.6ms resolution and lags after wake (ffe2ef06 story); QPC is high-resolution and monotonic but its frequency is arbitrary, so integer scaling can overflow.
- **How libuv handles it**: `uv_update_time` = `uv__hrtime(1000)` (core.c:325-329) with `assert(new_time >= loop->time)`; `uv__hrtime` divides QPC by `frequency/scale` in doubles "because we have no guarantee about the order of magnitude of the performance counter interval, integer math could cause this computation to overflow" (win/util.c:464-483); QPC failure or zero counter is fatal. Loop time is cached: all timer math uses `loop->time`, refreshed only at defined points (LOOP-08), so one iteration sees one consistent now.
- **History**: 6ced8c2c (2014) GetTickCount→QPC "improve timer precision", part of fixing node's test-timers-first-fire.js; ffe2ef06 (2013) documents the GetTickCount lag that motivated it.
- **Bun disposition**: must-port (QPC via `std::time::Instant` is equivalent; keep ms-granularity cached loop time + monotonic debug assert; beware double rounding if frequencies are huge — Rust can use u128 instead). Target: engine

### [LOOP-49] uv_loop_close: EBUSY unless only internal handles remain; debug poison-fill preserving loop->data; never wrap the close in assert()

- **What Windows does**: n/a.
- **How libuv handles it**: `uv_loop_close` (uv-common.c:899-926) returns UV_EBUSY if any active reqs or any non-INTERNAL handle is still registered (the internal wq_async is exempt — LOOP-34); on success, `#ifndef NDEBUG` memsets the whole loop to 0xFF while saving/restoring `loop->data` (embedder field survives poisoning); clears default_loop_ptr if applicable. `uv__loop_close` asserts under wq_mutex that the threadpool queue is empty (core.c:360-363).
- **History**: 787f5fff (2013); 2cd91f97 (2014, #1387) fixed `assert(uv_loop_close(loop) == 0)` in uv*loop_delete — under NDEBUG the assert disappeared \_and the close with it*; 0e5004ba (2014, #393) made the default loop actually closeable/IOCP handle closed.
- **Bun disposition**: should-port (EBUSY contract + poison-on-close in debug; the assert-with-side-effects lesson is general). Target: engine

### [LOOP-50] No backend fd, no fork: uv_backend_fd() = -1, uv_loop_fork() = ENOSYS, loop_configure only knows UV_METRICS_IDLE_TIME

- **What Windows does**: IOCP handles aren't fds and don't survive anything fork-like; there is no fork.
- **How libuv handles it**: `uv_backend_fd` returns -1 unconditionally (core.c:391-393); `uv_loop_fork` returns UV_ENOSYS (core.c:396-398); `uv__loop_configure` accepts only UV_METRICS_IDLE_TIME, ENOSYS otherwise — UV_LOOP_BLOCK_SIGNAL is Unix-only (core.c:378-388).
- **History**: 3a302586, fd7ce57f (fork support is Unix-only by design), 9da5fd44 (loop_configure).
- **Bun disposition**: should-port (API surface honesty for uv compat: return the same sentinels so addons that probe behave identically). Target: engine

### [LOOP-51] No automatic library teardown on Windows: threads are already terminated when destructors run

- **What Windows does**: during process exit / DLL_PROCESS_DETACH, the OS has already forcibly terminated all threads except the caller; joining or cleaning them up deadlocks or corrupts.
- **How libuv handles it**: `uv_library_shutdown` is marked `__attribute__((destructor))` ONLY for `__GNUC__ && !_WIN32` — the comment: "Disabled on Windows because threads have already been forcibly terminated by the operating system by the time destructors run, ergo, it's not safe to try to clean them up" (uv-common.c:988-1009). On Windows it runs only if the embedder calls it explicitly; it's idempotent via a relaxed exchange.
- **History**: code comment (introduced with uv_library_shutdown, 2020 era).
- **Bun disposition**: must-port the lesson: never put threadpool/loop teardown in atexit/DllMain/static destructors on Windows; tie it to explicit shutdown or leak-on-exit deliberately. Target: engine

### [LOOP-52] poll_peer_sockets live on the loop and are closed at loop close (cross-ref: POLL)

- **What Windows does**: uv_poll's WSAPoll-emulation needs hidden helper sockets, one per address family, created lazily.
- **How libuv handles it**: `memset(&loop->poll_peer_sockets, 0, ...)` in init (core.c:283); `uv__loop_close` walks the fixed-size array and `closesocket`s entries that are neither 0 nor INVALID_SOCKET (core.c:354-358) — note BOTH sentinels are checked because lazily-created slots are 0 and failed creations may store INVALID_SOCKET.
- **History**: part of the uv_poll fast-poll implementation (cross-ref POLL area for the full story).
- **Bun disposition**: should-port only if Bun implements uv_poll-style readiness polling; record here because loop init/close owns the lifetime. Cross-ref: POLL. Target: engine

---

## Tally

- must-port: 39 — LOOP-01..09, 12, 13, 16..23, 25..32, 34, 35, 37..40, 43..46, 48, 51
- should-port: 10 — LOOP-11, 14, 15, 24, 33, 36, 41, 49, 50, 52
- skip: 3 — LOOP-10 (Wine/XP GQCS fallback; modern Wine has GQCSEx, baseline is Win10 1809+), LOOP-42 (debug-CRT assert hook; Bun avoids CRT fd APIs and MSVC \_DEBUG CRT), LOOP-47 (void\* heap indirection; no public C ABI constraint — embed the heap, keep the heap-not-tree lesson)
