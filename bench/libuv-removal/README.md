# libuv-removal benchmark program (Windows)

Local, uncommitted. Companion to `LIBUV_WINDOWS_REMOVAL_PLAN.md` §7. Produced by a
10-agent measurement workflow (8 domain hunters running real measurements on this machine
with bun 1.4.0 release = the "before" build, node 25.8.1 as reference; 2 adversarial
judges), then filtered by the maintainer's rule below.

**Framing rule (maintainer decision): threadpool-shape wins are not removal evidence.**
Anything whose mechanism is "more/better threads" is mitigable by tuning libuv
(`UV_THREADPOOL_SIZE` is honored today) and invites the one-line-env-var rebuttal. The
removal's own evidence is **single-threaded per-op cost** and **IOCP-level async
architecture** (fewer syscalls/round-trips per operation, real overlapped I/O, owned
buffers/semantics). Thread-scheduling findings are kept below as engineering context and
gates, never headlines.

Measurement hygiene (learned the hard way — see script headers): this dev box has
Defender/MsMpEng episodes that inflate absolutes 2-10x for tens of seconds. Every script
uses warmups, interleaved repeats, and medians; **only within-run paired deltas and
within-binary ratios are trustworthy**; before/after comparisons must interleave runs.
Scripts are self-contained, < 30s, most run under both `bun` and `node`.

## Tier 1 — removal-attributable wins (single-threaded / IOCP)

| # | Benchmark | Mechanism deleted | Today → expected | Status |
|---|---|---|---|---|
| 1 | `sync-fs-readsync-positioned.mjs` | libuv emulates POSIX pread as **3 syscalls** (SetFilePointerEx save → ReadFile+OVERLAPPED → restore, fs.c:880-913) + global fd-hash mutex + CRT fd→HANDLE per call; native pread on HANDLE fds is **1 syscall** (already in-tree, unreachable from JS) | positioned read 1.79µs vs sequential 1.16µs — the **+55% ops/s gap closes**; size-independent (pure syscall-pair cost); same dance on the write side and `FileHandle.read` (passes a position by default) | cleanest attribution in the set (same binary, same op); pre-registered prediction |
| 2 | `pipes-stdout-throughput.mjs` (+ `pipes-raw-readfile-control.mjs`) | the zero-read dance: 0-byte ReadFile → IOCP dequeue → second quasi-sync ReadFile (+ fork's PeekNamedPipe gate) per 64KB chunk → native posts **one real overlapped read** into a preallocated buffer, skip-on-success | 2.4-3.0 GB/s today vs **5.1 GB/s same-machine kernel floor** (ffi control); parent CPU 560 → floor 150 ms/GB; publish **after-numbers only** (+30-70% is a projection); lead with CPU-per-GB (less noisy) | hold for after-build; publish full chunk curve incl. flat 256B row (child-bound, annotated) |
| 3 | `pipes-stdin-throughput.mjs` | every chunk pays a **mandatory IOCP completion packet** even on synchronous WriteFile completion (libuv can't skip-on-success on pipes) + single in-flight write serialization | bun 7.4 GB/s vs node 12.4 on the identical kernel path — node proves the headroom | **fix first, publish the recovery after** — today's number is a "bun loses 2x" chart; attribution splits between uv deletion and FileSink rewire (both land in 3.3) |
| 4 | `fswatch-burst.mjs` | libuv hardcodes a **4KB** ReadDirectoryChangesW buffer (fs-event.c:33, kernel-pinned at first call); Bun additionally **silently drops** the overflow signal (win_watcher.rs:237-244). Native: 64KB buffer + overflow→rescan semantics (needs owning the watcher) | blocked-loop burst: **1 of 1000 events delivered today, deterministically** → ~100% + signaled overflow | the reliability anchor (correctness, not µs). Prereq: fix the NULL-drop bug **now** and re-baseline so the before isn't worse than node; buffer size alone is fork-patchable — the rescan semantics are the removal-honest part |
| 5 | `sync-fs-stat-resolver.mjs` | Bun's **own** exists/access uses GetFileAttributesW (~26-30µs under Defender's filter) while the by-name stat class costs ~4µs — Phase 2 consolidates all path metadata onto by-name NT APIs (answers plan open question 5: yes, with handle fallback) | existsSync **5-7×** on default-configured Windows (filter-dependent — show Dev Drive run alongside; durable framing is vs-node, which stays on GetFileAttributesW) | honest caveat: this is a syscall-class consolidation the removal *occasions*, not deleted libuv plumbing — consider shipping the `exists_os_path` fix early and re-baselining |
| 6 | `eventloop-setimmediate-chain.mjs` | per-tick self-wake: the uv_async **PQCS packet measured at 200-240ns** (ffi probe) + uv handle-walk/double-update_time bookkeeping (estimated 200-400ns) | 792-941ns/tick loop cost today (microtask control isolates it); target ≤600ns | Phase 1 before/after metric; publish the measured number only; track the microtask-vs-setImmediate gap (machine-speed-immune) |

## Tier 2 — real findings, thread-scheduling shaped (context + gates, not removal headlines)

- `dns-lookup-concurrency.mjs` / `dns-fs-interference.mjs`: libuv's SLOW_IO class caps DNS at
  `(4+1)/2 = 2` in-flight per process (threadpool.c:46) — measured 2.5-3.5× hermetically, and
  the cap-2 prediction matched measurements exactly. Real, but threadpool-shaped (knob-mitigable
  to cap 12) → context. The native DNS migration (Phase 1) deletes it as a side effect; assert
  post-migration that the knob is a no-op. Note: `fetch()` already bypasses this (own pool) —
  any claim must say node:dns/net/tls only.
- `asyncfs-bunfile-vs-readfile.mjs`: Bun.file reads = **4+ chained pool hops** (open→fstat→read
  loop→close, each a task + wakeup) vs readFile's single task — 1.5-1.9× at concurrency,
  knob-proven NOT pool width. The least thread-*count*-shaped of these (it's hop count), and the
  after-state is measurable today (readFile parity) — usable as a secondary number framed as
  "scheduling round-trips per read: 4→1", or as the "Bun.file reaches parity with its
  Linux/macOS architecture" story.
- `asyncfs-workers-global-pool.mjs` / `asyncfs-singlethread-knee.mjs`: the lose-lose
  UV_THREADPOOL_SIZE table (wide pool: +60% at 8 workers, **-55..63% at W≤2**) and the 745k
  single-thread knee. Gates: post-migration must hold ≥745k at N=32 with no N≤4 regression —
  the single most likely place the migration *regresses* (libuv's batched wq drain is genuinely
  good at low concurrency).

## Nulls — measured, publish as honesty (what does NOT get faster)

- **Spawn** (`spawn-sync-overhead.mjs`, `spawn-pipe-tax.mjs`, `spawn-async-throughput.mjs`):
  Bun is already within 3-5% of raw CreateProcessW in the same binary (ffi control); the
  hypothesized stdio-pipe tax measured **0 ± 0.2ms**; fan-out ceiling (~400-520 spawns/s) is
  kernel CreateProcessW serialization on both stacks. Post-migration tweet is floor-proximity
  ("within X µs of CreateProcessW"), never a speedup. Punch-list extracted for Phase 3.2:
  lpEnvironment=NULL when env unmodified, cached inheritable NUL handle, skip search_path for
  absolute paths. **Regression risk found:** libuv's 64KB pipe buffers are well chosen (a 4KB
  control was 60% *slower*) — preserve the sizing.
- **Small-file readFileSync** (`sync-fs-open-close-readfile.mjs`): Defender's filter, not
  libuv, owns the cost (5-10% expected) — this is the pre-emptive answer to "I measured
  readFileSync and it's the same".
- **Composites** (`composite-startup-resolve.mjs`, `composite-install-extract-link.mjs`,
  `composite-test-parallel.mjs`): startup/install/test-orchestration move ~0 — keep as the
  per-phase no-regression table ("600-module app start: unchanged through all 4 phases").
- **TCP loopback** (`tcp-loopback-eventing.mjs`): Phase 1 keeps the AFD mechanism; node's
  overlapped uv_tcp path is 25-50% faster on loopback today — internal baseline only; records
  the business case for a future AFD→overlapped project. Never near marketing.
- **Timers** (`eventloop-timer-precision.mjs` etc.): the 16ms/60fps story requires the
  CREATE_WAITABLE_TIMER_HIGH_RESOLUTION decision (plan ADD-02-adjacent) — "unlocked by", never
  "delivered by"; node fires *early* (a bug we won't copy) so naive comparisons favor node.
  Keep the never-fires-early assertion as the standing gate.

## Side findings (not libuv — spin off separately)

1. `exists_os_path`/access can adopt the by-name stat class **today** (vendored libuv already
   proves the 4µs floor in the same binary).
2. `win_watcher.rs:237-244` silently swallows the overflow (NULL-name) event node emits — a
   today-fixable bug.
3. **Install hardlink backend is 4-7× slower than the copyfile backend** on the link phase —
   dwarfs anything libuv-related for `bun install` on Windows; fix/default-switch before any
   Windows install benchmarks ship.
4. `bun -e 1` (45.9-48.1ms) is not faster than `node -e 1` (42.1-47.5ms) on Windows — startup
   floor investigation, unrelated to libuv.
5. worker_threads: a worker blocked in top-level await never receives
   `parentPort.postMessage` from the parent (node delivers it) — found while building
   harnesses.
6. Plan correction (already noted in plan §2.1 errata): SpawnSyncEventLoop is cached in
   RareData (`rare_data.rs:741-754`), not created per spawnSync call.
