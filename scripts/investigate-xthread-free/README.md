# xthread_free corruption investigation

Investigating segfaults in `mi_page_thread_collect_to_local` (mimalloc v3/dev3)
walking the cross-thread free list. Crash addresses like `0xFFFFFFFFFFFFFFFF`,
`0x33280070020`. Feature fingerprint: `spawn`, `standalone_executable`,
`yaml_parse`, `fetch`, `abort_signal`, `Bun.stdin/stdout/stderr`, `jsc`,
sometimes `process_dlopen`. Platforms: macOS aarch64, Windows x86_64. Bun
1.3.13. Related: #29336.

## What the crash means

`page->xthread_free` is a lock-free stack of blocks freed by *other* threads
than the page owner. The collector walks it via `block->next`. If a block in
the list has a garbage `next`, the walk segfaults. Since in release builds
(`MI_ENCODE_FREELIST=0`) `block->next` is just the first 8 bytes of the freed
block, any write to offset 0 of a cross-thread-freed block corrupts the list.
Common causes: double-free, use-after-cross-thread-free.

mimalloc's push (`mi_free_block_mt`) and collect
(`mi_page_thread_free_collect`) are both acq-rel and byte-identical to
upstream dev3 — the corruption is from Bun or an addon, not the allocator.

## Instrumentation

`free.c.instrumented` / `page.c.instrumented` drop-in replace
`vendor/mimalloc/src/{free,page}.c`. Guarded by `BUN_MI_INSTRUMENT_XTHREAD`
(default on). Adds:

- 16K-entry ring buffer recording every `mi_free_block_mt` push:
  `{block, page, bsize, frames[8]}` where `frames` is a manual frame-pointer
  walk (no libc `backtrace()` — that re-enters malloc).
- Before each cross-thread push: scan existing `xthread_free` for the same
  block → abort with FP backtrace + ring dump on duplicate.
- In `mi_free_block_local`: if the page has a non-empty `xthread_free`, scan
  it for the incoming block → abort on "local free of block already in
  xthread_free" (catches owner-thread double-free of a block another thread
  already freed).
- In `mi_page_thread_collect_to_local`: validate each `next` is in-page
  before following it; abort with ring dump for that page + bad block's
  first 8 words on failure. Also aborts on `count > cap` (cycle).

To apply:
```sh
cp scripts/investigate-xthread-free/free.c.instrumented vendor/mimalloc/src/free.c
cp scripts/investigate-xthread-free/page.c.instrumented vendor/mimalloc/src/page.c
rm -rf build/release/deps/mimalloc
bun run build:release
```

When it fires, the frame addresses can be resolved against `bun-profile`:
```sh
llvm-addr2line -e build/release/bun-profile -f -C -i 0x<addr> 0x<addr> ...
```

## Stress results (Linux x64 release, 30min total, ~110k iters)

All clean — no double-free, no local-free-of-xtf, no bad `next`, no cycle.

| test | iters |
|---|---|
| `stress-full.js` (fetch+timeout, any, spawn, pbkdf2, yaml, gc/3) | 29,372 |
| `stress-sse.js` (streaming POST + abort mid-stream) | 60,122 |
| `stress-idle.js` (burst → 11s idle → gc; hits ThreadPool `mi_collect`) | 109 cycles |
| `stress-h2.js` (node:http2 + AbortSignal.timeout) | 15,032 |
| `stress-cp.js` (node:child_process spawn/exec + signal + fetch) | 6,685 |

## Unreproduced — likely reasons

- **Platform**: Linux has `MI_OVERRIDE=ON` (system malloc = mimalloc); macOS
  and Windows don't. An allocator mismatch (addon allocates with system
  malloc, Bun frees with `mi_free`, or vice versa) wouldn't corrupt on Linux
  but would on macOS/Windows. `process_dlopen` is in #29336's feature list.
- **Runtime**: field crashes took ~1h at ~1 fetch/min. May need much longer.

## Side findings (not the crash)

1. **`fetch({signal: AbortSignal.timeout(N)})` leak** —
   `FetchTasklet.clearAbortSignal` calls `cleanNativeBindings` (→
   `eventListenersDidChange`) *before* `pendingActivityUnref`, so the
   early-cancel path in `eventListenersDidChange` always sees
   `hasPendingActivity()=true` and never fires. The timer + extra ref survive
   until the timeout expires. Observed as steady RSS growth in `stress-sse`.
   Fix: swap the order, or have `decrementPendingActivityCount` also call
   `eventListenersDidChange` when it reaches zero.

2. **`bun test --isolate` double-deref** — `AbortSignal.zig:206-209`
   (`Timeout.run()` generation-mismatch branch) calls `this.signal.unref()`
   but leaves `m_timeout` set. If `signalAbort()` or
   `eventListenersDidChange()` later runs on that signal, `hadTimeout` /
   `m_timeout != nullptr` is still true → second `deref()`. Only reachable
   under `--isolate`.
