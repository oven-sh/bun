# `noalias` Miscompile Hunt — Final Report

**Repo:** `/root/bun-5` (branch `claude/phase-a-port`)
**Precedent:** `NodeHTTPResponse::cork` (commit `b818e70e1c57`) — LLVM observed caching `ref_count: Cell<u32>` across an opaque JS call because `&mut self` carries `noalias` and no self-derived pointer reached the FFI boundary. Fixed via `black_box(ptr::from_mut(self))` launder.

---

## Executive Summary

| Stage | Count |
|---|---|
| Candidates enumerated (pattern match) | **277** |
| Survived 2-vote adversarial triage | **73** |
| ASM-verified `PROVEN_CACHED` | **23** |
| ASM-verified `NOT_CACHED` (safe in current codegen) | **46** |
| `INCONCLUSIVE` (Windows-only, no asm available) | **4** |

**23 sites** are confirmed by release-mode x86_64 disassembly to cache a `self.*` field in a callee-saved register or stack slot across an opaque re-entrant call, then reuse the stale value without reloading. Each is a latent UAF, refcount-leak, or guard-elision bug.

The 46 `NOT_CACHED` sites are still **language-level UB** (two live `&mut Self` to the same allocation) but LLVM happens not to exploit it today — typically because a self-derived pointer incidentally escapes to a nearby call, or the post-call read goes through a non-inlined callee. These are one inlining-heuristic change away from miscompiling.

---

## PROVEN_CACHED — 23 sites (asm-confirmed)

### Cluster A: `NodeHTTPResponse` ref_count fold (3 sites — same bug as `cork`)

| # | File:Line | Method | Cached | Mechanism |
|---|---|---|---|---|
| 1 | `src/runtime/server/NodeHTTPResponse.rs:779` | `handle_abort_or_timeout::<Timeout>` | `ref_count` → `r12d` | `ref_()`/`deref()` folded to load-once/store-back across `run_callback` |
| 2 | `src/runtime/server/NodeHTTPResponse.rs:848` | `on_timeout` (inlines #1) | `ref_count` → `r12d` | same asm as #1 |
| 3 | `src/runtime/server/NodeHTTPResponse.rs:1178` | `on_drain_corked` | `ref_count` → `r14`/`[rbp-56]` | `ref_()`/`deref()` folded across `run_callback` |

**ASM (on_timeout, `bun_runtime-884b14434a6252c7.s:2113262`):**
```asm
mov  r12d, dword ptr [rdi + 136]   ; CACHE ref_count
lea  ecx, [r12 + 1]
mov  dword ptr [rdi + 136], ecx    ; ref_()
...
call ..EventLoop12run_callback     ; JS RE-ENTRY
mov  dword ptr [rbx + 136], r12d   ; deref(): STALE store, no reload
test r12d, r12d
je   -> deinit
```
**Fix:** apply the `cork()` mitigation (`let _ = black_box(ptr::from_mut(self));` before `run_callback`), or convert receiver to `*mut Self`.

---

### Cluster B: `EventLoop` entered_event_loop_count fold (3 sites)

| # | File:Line | Method | Cached | Mechanism |
|---|---|---|---|---|
| 4 | `src/jsc/event_loop.rs:425` | `run_callback` | `entered_event_loop_count` → `r15` | `enter()`/`exit()` folded across `Bun__JSValue__call` |
| 5 | `src/jsc/event_loop.rs:443` | `run_callback_with_result` | `entered_event_loop_count` → `r15` | same |
| 6 | `src/jsc/event_loop.rs:710` | `tick_immediate_tasks` | `next_immediate_tasks.cap` const-prop'd to 0 | `cold_merge` recursion-guard **dead-coded** on hot path |

**ASM (run_callback, `bun_jsc-893d7c5f60b678e8.s`):**
```asm
mov  r15, qword ptr [rdi + 232]    ; CACHE count
lea  rax, [r15 + 1]
mov  qword ptr [rdi + 232], rax    ; enter()
call Bun__JSValue__call            ; JS
mov  qword ptr [rbx + 232], r15    ; exit(): STALE store, no reload
```
**ASM (tick_immediate_tasks):** `if next_immediate_tasks.capacity() > 0 { cold_merge }` is **entirely eliminated** on the `exception_thrown==false` path — recursive `setImmediate` tasks silently dropped.

**Fix:** `run_callback*` should use the existing `enter_scope(*mut EventLoop)` RAII pattern. `tick_immediate_tasks` needs a `black_box` launder or `*mut Self` receiver.

---

### Cluster C: `SSLWrapper<T>` flags byte cached across handler fn-ptrs (4 sites)

| # | File:Line | Method | Cached | Consequence |
|---|---|---|---|---|
| 7 | `src/uws/lib.rs:826` | `handle_reading` | `flags` → `r14b` | `closed_notified()` re-check at :880/:902/:914 **elided**; stale RMW clobbers re-entrant flags |
| 8 | `src/uws/lib.rs:921` | `handle_writing` | `ssl`/`flags`/`handlers.{write,ctx}` → `r15`/`r14`/stack | loop-head `let Some(ssl)=self.ssl` **hoisted out of loop** → UAF on freed `SSL*` after re-entrant `deinit()` |
| 9 | `src/uws/lib.rs:739` | `update_handshake_state` | `flags` → `r15`/`r12` | `fatal_error()`/`closed_notified()` checks after `on_handshake` use stale reg; stale RMW clobbers |
| 10 | `src/uws/lib.rs:497` | `shutdown` | `flags` → `r14`/`bl` | post-`on_handshake` `closed_notified()` uses stale → double-fire `on_close` |

**ASM (handle_writing, `bun_http-91d539bf293ea392.s:91733`):**
```asm
mov  r15, qword ptr [rdi + 48]   ; self.ssl — ONLY load
test r15, r15
je   .LBB505_16                  ; null check HOISTED OUT OF LOOP
...
.LBB505_4:                       ; loop body
call qword ptr [rbp - 64]        ; (handlers.write)(ctx, data) — re-entrant
mov  rdi, r15                    ; STALE ssl, no reload
call SSL_get_wbio
```
**Fix:** convert `handle_reading`/`handle_writing`/`update_handshake_state`/`shutdown` to take `this: *mut Self`. The defensive "callback may have closed the connection" comments at :879/:900/:912 are precisely the checks LLVM deletes.

---

### Cluster D: `WindowsNamedPipe` flags byte cached across SSLWrapper callbacks (2 sites)

| # | File:Line | Method | Cached | Consequence |
|---|---|---|---|---|
| 11 | `src/runtime/socket/WindowsNamedPipe.rs:1144` | `close` | `flags` → `r15b` | `flags.remove(WRAPPER_BUSY)` stores stale `r15`, clobbering `IS_CLOSED` set by re-entrant `ssl_on_close`; `is_closed()` reads stale → `wrapper=None` deferred-drop never runs |
| 12 | `src/runtime/socket/WindowsNamedPipe.rs:1171` | `shutdown` | `flags` → `r12b` | identical |

**ASM (close, `bun_runtime-884b14434a6252c7.s:2542695`):**
```asm
movzx r15d, byte ptr [rdi + 364]   ; ONE load
...
call  qword ptr [r13 + 280]        ; ssl_on_close re-enters, sets IS_CLOSED
mov   byte ptr [rdi + 364], r15b   ; STALE store clobbers IS_CLOSED
test  r15b, 2                      ; is_closed() reads STALE
```
**Fix:** convert receiver to `*mut Self` (the `WRAPPER_BUSY` dance only protects the wrapper bytes, not the outer `noalias` on `flags`).

---

### Cluster E: `PipeWriter` parent/handle cached across Parent callbacks (3 sites)

| # | File:Line | Method | Cached | Consequence |
|---|---|---|---|---|
| 13 | `src/io/PipeWriter.rs:1448` | `WindowsBufferedWriter::on_write_complete` | `is_done`/`parent` → `rbx` | second `if self.is_done` check (comment: "is_done can be changed inside on_write") **fully eliminated** |
| 14 | `src/io/PipeWriter.rs:399` | `PosixBufferedWriter::_on_write` (IOWriter mono) | `self.handle` tag/fd/poll → stack spill | `close()` after `Parent::on_write` operates on **stale handle** — UAF if re-entrant close |
| 15 | `src/io/PipeWriter.rs:754` | `PosixStreamingWriter::register_poll` (FileSink mono) | `handle.poll` → `r15`, `parent` → `rbx` | after `on_error` re-entry, `deinit_force_unregister` runs on **freed FilePoll** |

**ASM (on_write_complete, repro `-Zmutable-noalias=no` control confirms causation):**
```asm
cmp  byte ptr [rsi+24], 0  ; is_done — ONLY load in fn
je   .LBB0_3
call opaque_on_write       ; can flip is_done
call ...close              ; NO reload — line :1468 check ELIMINATED
```
**Fix:** change receivers to `this: *mut Self` (matches the trait-callback convention already used elsewhere in this file).

---

### Cluster F: SQL connection request-queue cached across JS reject (1 site)

| # | File:Line | Method | Cached | Consequence |
|---|---|---|---|---|
| 16 | `src/sql_jsc/postgres/PostgresSQLConnection.rs:1459` | `clean_up_requests` | `requests.{buf_ptr,cap,head,count}` + `vm`/`global` + finish counters → callee-saved/stack | re-entrant enqueue reallocs deque → cached `buf_ptr` **dangles**; `discard(1)` writes back stale `head`/`count` |

**Fix:** `black_box(ptr::from_mut(self))` before `on_js_error`, or convert to `*mut Self` loop.

---

### Cluster G: streams `self.wrote` cached across `JSPromise::resolve` (1 site, +1 adjacent)

| # | File:Line | Method | Cached | Consequence |
|---|---|---|---|---|
| 17 | `src/runtime/webcore/streams.rs:1980` | `HTTPServerWritable::flush_promise` | `self.wrote` → `r13` | PORT NOTE says "re-read `wrote` after resolve which may reenter" — **defeated**; `wrote_at_start_of_flush` gets pre-reentry value |

Also confirmed in inlined `flush_promise` inside `abort()` (`r12`). **Fix:** `black_box` launder.

---

### Cluster H: misc (6 sites)

| # | File:Line | Method | Cached | Consequence |
|---|---|---|---|---|
| 18 | `src/runtime/api/bun/h2_frame_parser.rs:1675` | `Stream::queue_frame` | `&last_frame.callback` (Vec backing) → `r14` | re-entrant `enqueue()` reallocs Vec → `deinit`/store hit **freed memory** |
| 19 | `src/jsc/ipc.rs:143` | `InternalMsgHolder::dispatch_unsafe` | `self.worker` (StrongRef*) → `rbx` | second `.get()` derefs stale `rbx` after JS getter → **UAF** if re-entrant code replaced `worker` |
| 20 | `src/jsc/rare_data.rs:745` | `close_all_watchers_for_isolation` | Vec `len`/`buf` → `r14`/`r15` | re-entrant `remove_fs_watcher` (proven reachable via `FSWatcher::detach`) sees stale len |
| 21 | `src/jsc/VirtualMachine.rs:3377` | `wait_for` | `*cond` hoisted; loop becomes `jmp .LBB1720_2` **unconditional** | **infinite loop** — `*cond` never re-read after entry |
| 22 | `src/runtime/socket/socket_body.rs:2282` | `NewSocket::internal_flush` (SSL=true) | `flags` → `r12`, `buffered_data.len` → `r15` | stale flags written back after `us_socket_t::write`/`flush`; `can_end_after_flush` uses pre-write flags |
| 23 | `src/runtime/dns_jsc/dns.rs:4163` | `Resolver::on_dns_poll` | `ref_count` → `r15d` | `ref_scope`/`deref` folded across `ares_process_fd` → re-entrant `IntrusiveRc::Drop` decrement **clobbered** |

**ASM (wait_for — most dramatic):**
```asm
cmp  byte ptr [rsi], 0   ; *cond checked ONCE
je   .LBB1720_1
ret
.LBB1720_2:              ; LOOP HEAD — no *cond reload
call EventLoop::tick
call auto_tick
jmp  .LBB1720_2          ; UNCONDITIONAL — infinite loop
```
**Fix:** change `cond: &mut bool` → `cond: &Cell<bool>` or `*const bool`.

---

## SUSPECT but NOT_CACHED in current codegen (46 sites)

These survived adversarial triage (all 5 noalias-hazard signals present) but release asm shows fields **are** reloaded — usually because:
- a self-derived sub-field pointer happens to reach an opaque call (e.g. `&mut self.handlers`, `self.writer()` = `ptr::from_mut(self)`), or
- the post-call read lives in a non-inlined callee.

**Still UB.** Flag for the systemic fix; do not rely on current codegen.

Notable members (full list in triage JSON):
- `NodeHTTPResponse::{on_data_or_aborted, on_abort}` — `inc/dec [mem]` direct, saved by intervening `&mut self` calls
- `RequestContext::run_error_handler_with_status_code_dont_check_responded`
- `CompressionStream::{run_from_js_thread, emit_error, write_sync}` — `[rbx+N]` reloaded
- `H2FrameParser::{_write, flush, flush_queue, send_data, handle_data_frame, send_go_away}` — self passed to dispatch
- `Subprocess::on_process_exit`, `Terminal::{on_reader_done, on_reader_error}`
- `HTMLRewriterLoader::end` (SinkHandler) — `done()` not inlined
- `SendQueue::{_on_write_complete, close_socket}`
- `EventLoop::{exit, exit_maybe_drain_microtasks}` — `drain_microtasks_with_global(&mut self)` forces reload
- `VirtualMachine::{uncaught_exception, reload_entry_point}`
- `PosixStreamingWriter::_on_error`, `PipeReader::{_on_read_chunk, read_with_fn, read_blocking_pipe}`
- `WindowsNamedPipe::{encode_and_write, call_write_or_end, on_close}`
- All `PostgresSQLQuery`/`JSMySQLQuery`/`JSMySQLConnection` resolve/reject paths — `inc/dec [mem]` or outlined ScopedRef drop
- `Resolver::check_timeouts`, `MiniEventLoop::{tick, tick_once}`

---

## INCONCLUSIVE (4 — Windows-only, no asm)

| File:Line | Method | Reason |
|---|---|---|
| `src/io/PipeWriter.rs:1892` | `WindowsStreamingWriter::on_write_complete` | `#[cfg(windows)]`; no x86_64-pc-windows-msvc build available |
| `src/runtime/socket/WindowsNamedPipe.rs:555` | `on_internal_receive_data` | dead code (private, zero callers) |
| `src/runtime/socket/WindowsNamedPipe.rs:653` | `on_connect` | `#[cfg(windows)]` |
| `src/runtime/socket/WindowsNamedPipe.rs:338` | `on_read_error` | `#[cfg(windows)]` straddle block |

**Action:** generate `x86_64-pc-windows-msvc` release asm and re-run verifier on these 4.

---

## Recommended Fixes (per-site)

| Pattern | Fix | Applies to |
|---|---|---|
| `ref_()`/`deref()` straddle | `let _ = core::hint::black_box(ptr::from_mut(self));` before opaque call | A1-3, F16, H23 |
| `enter()`/`exit()` straddle | use existing `enter_scope(*mut EventLoop)` RAII | B4-5 |
| flags-byte RMW straddle | convert receiver `&mut self` → `this: *mut Self` | C7-10, D11-12, E13-15, H22 |
| Vec/queue ptr cached across JS | `black_box` launder, or move-out-then-move-back (`mem::take`) | F16, H18, H20 |
| spin-on-`&mut bool` | `&Cell<bool>` / `*const bool` | H21 |
| `Vec::take` const-prop | `black_box(&mut self.next_immediate_tasks)` after take | B6 |
| post-resolve re-read | `black_box(ptr::from_mut(self))` before resolve | G17 |
| StrongRef ptr cached | reload via `(*ptr::from_mut(self)).worker` after JS | H19 |

---

## Systemic Recommendation

This is **PORT_NOTES_PLAN R-2** territory. Spot-fixing 23 sites with `black_box` is a stopgap; 46 more are one inlining decision away from joining them.

**Root cause:** `.classes.ts` codegen + uws/libuv/c-ares callback shims materialize a fresh `&mut Self` from `m_ctx`/userdata while an outer `&mut self` is live across JS. Every such method's `&mut self` is a lie to LLVM.

**Proposed systemic fix (pick one or layer):**

1. **`.classes.ts` codegen → `&self` + interior mutability.** Change `host_fn(method)` to derive `&Self` (no `noalias` when `Self: !Freeze`). Convert hot mutable fields to `Cell`/`JsCell`. `Subprocess` already does this (and is `NOT_CACHED` for that reason).

2. **Always escape `self` before JS.** Add a `#[reentrant]` attr (or default-on for `host_fn`) that emits `let _escape = black_box(ptr::from_mut(self));` at the top of every generated wrapper. Cheap, mechanical, asm-verifiable.

3. **`*mut Self` receivers for callback-straddling methods.** What `enter_scope`, `do_run`, and the Windows `on_dns_poll_uv` already do correctly. Enforce via clippy lint: ban `&mut self` on any fn that calls `run_callback`/`JSValue::call`/`JSPromise::resolve`/uws-dispatch without a `#[reentrancy_safe]` opt-out.

4. **Crate-level `-Zmutable-noalias=no`** on `bun_runtime`/`bun_jsc`/`bun_uws`/`bun_http`/`bun_sql_jsc` as a temporary safety net while (1)/(2)/(3) land. Perf cost TBD (likely <1% — most hot loops don't straddle JS).

---

## Artifacts

- Triage JSON: `/root/bun-5/build/noalias-asm/triage.json`
- ASM dumps: `/root/bun-5/build/noalias-asm/rust-target/x86_64-unknown-linux-gnu/release/deps/*.s`
- Precedent: `NodeHTTPResponse::cork` PORT NOTE at `src/runtime/server/NodeHTTPResponse.rs:1703-1720`
