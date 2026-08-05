# Heap-image ("snapshot") experiment — how to build, run, measure

Branch `claude/lowmem-cc` in three worktrees: `~/code/bun-lowmem` (this), `~/code/WebKit-lowmem`, and Claude Code `~/code/claude-cli-internal` branch `claude/lowmem-snapshot`. macOS arm64 only. Everything below assumes those paths.

## What it does

Run an app to its idle state once, freeze the JS heap + allocator state into an image file, and let a fresh process `mmap` that image and continue in the event loop instead of booting. Untouched image pages stay clean/file-backed (0 footprint); only what the session touches becomes dirty. Claude Code booted normally idles at ~215–230 MB; restored from an image it idles at ~40–45 MB and can run turns.

## Build

```sh
# Bun (uses the WebKit worktree; macOS system malloc routed through mimalloc so libc++/BoringSSL/ICU state is in the image)
cd ~/code/bun-lowmem
BUN_MIMALLOC_OVERRIDE_DARWIN=1 BUN_WEBKIT_PATH=~/code/WebKit-lowmem bun run build:release:local   # -> build/release-local/bun-profile

# Claude Code compiled with that bun
cd ~/code/claude-cli-internal   # branch claude/lowmem-snapshot
BUN_BUILD_BIN=~/code/bun-lowmem/build/release-local/bun-profile ./scripts/native/build-ant-native.sh --force --local --out-dir build-img
# -> build-img/@anthropic-ai/claude-cli-native-darwin-arm64/cli

```

(No launcher needed: when building or restoring an image the process re-execs itself once with ASLR disabled if dyld slid it — `reexecWithoutASLRIfSlid`.)

An image is only valid for the exact binary that produced it (`__DATA` layout). Rebuild bun => rebuild CC => rebuild the image.

## Make an image (the app snapshots itself)

```sh
cd ~/code/tmp/ccmem
./appdump.sh <cli> /tmp/cc-app.img          # runs CC with CLAUDE_CODE_SNAPSHOT_OUT; CC calls Bun.unsafe.snapshot() after the REPL settles
```

Env the scripts set for both build and restore: `MIMALLOC_DETERMINISTIC_HINT=1 BUN_IMAGE_JIT_ADDR=0x3c0000000 BUN_JSC_useConcurrentGC=0 BUN_JSC_useConcurrentJIT=0 BUN_JSC_useBaselineJIT=0 BUN_JSC_useFTLJIT=0` (generational + concurrent GC and concurrent JIT on; `GENGC=0` to disable generational). JSC options must be identical on both sides (they live in the image).

Runtime contract (`src/bun_core/image.rs`, `run_command.rs`, `BunMemDebug.cpp`):
- `Bun.unsafe.snapshot(path, { cancelTimers })` throws an uncatchable termination; the outermost `EventLoop::tick` then waits until the process is quiet (no async tasks / HTTP in flight / pool work / armed timers — refuses with a list otherwise, `BUN_SNAPSHOT_QUIET_TIMEOUT`), stops pool workers + mimalloc scavenger, drops all compiled code, freezes the heap (`Heap::freezeCurrentHeapAsImmortalImage`), writes the image, exits.
- `fetch()` to the network rejects while building (`Bun.unsafe.snapshotState().building`).
- Restore: `BUN_IMAGE_IN=<img>`; the process gets `process.on('restore')` before its first tick; `Bun.unsafe.snapshotState().epoch` > 0; `Bun.unsafe.recleanImagePages()` re-cleans transiently dirtied image pages (also runs automatically 2 s after restore).

## Run / measure a restored process

```sh
cd ~/code/tmp/ccmem
bun drive.ts <cli> --img /tmp/cc-app.img --type 'say only the word pong' --enter --wait '⏺' --secs 120   # real pty, prints footprint at prompt / after turn, exit code+signal
./abrestore.sh <cli> /tmp/cc-app.img label      # tmux: idle 15s/45s + light typing
./turnmeasure.sh <cli> /tmp/cc-app.img label    # tmux: one turn + GC + reclean
```

Attribution commands (write the word into `~/code/tmp/ccmem/cmd.<pid>`; needs `BUN_MEMDEBUG=~/code/tmp/ccmem`, and the loop must wake — send a keypress):
`dirtymap` (dirty image pages by cell class / malloc size class, + `changed-owners.<pid>.tsv` when built+run with `MIMALLOC_PROF_SAMPLE_RATE`), `reclean` (remap byte-identical dirty pages; prints nearly-identical writes by class+offset), `newcells` (cells allocated after the image, by class), `newpayload` (live sampled post-restore malloc with stacks -> `newowners.ts`), `ucbcensus` (UnlinkedCodeBlock/CodeBlock bytes by component), `trapreport` (with `BUN_IMAGE_TRAP=cells`: first writer of each image cell page -> `trapsym.ts`), `gc`, `shrink`, `dump` (mimalloc snapshot for `bin/mi-heapview`).

## Numbers (Aug 4–5 2026, M-series, this stack)

With LLInt+DFG only, borrowed bytecode and generational GC on (the current script defaults): restored idle at prompt **~34–36 MB** (image ~245 MB); after one turn ~100; after 4 turns ~112, ~106 after GC; CPU for restore+4 turns ~1.2 s. (Earlier all-tiers/gen-GC-off config: 40–45 idle, ~150 after 4 turns.) Booted normally: 215–230 idle (168 with LLInt+DFG only).

## Startup

Time to interactive prompt (pty, `ttfp.ts`): normal boot ~505 ms / 0.52 s CPU; restored from image **~100–110 ms / 0.10 s CPU** — including the ASLR re-exec, mapping the image, the ~16 MB data-segment copy, restore handlers and repaint.

## Image size

~243 MB file, of which roughly 100–140 MB is ever touched in a session (rest stays unmapped-clean). Compresses to **30 MB with zstd -3 (0.1 s)** / 24 MB with -19, so ship compressed and inflate once to a cache file.

## Borrowed bytecode (not image-specific)

`Options::useBorrowedBytecodeFromCache` (default on): instruction streams and `ExpressionInfo` payloads decoded from the executable's embedded bytecode cache alias the cache bytes instead of copying. Normal boot idle 184 → 174 MB in a paired run; also shrinks the image.

## Per-turn growth (not image-specific)

Restored or not, footprint grows ~10–25 MB per trivial turn over the first turns (4 "pong" turns: 122 → 152 MB). Live JS cells grow only ~1.3 MB/turn; the growth is JSC tiering artifacts in malloc (baseline JIT `JITData`/IC stubs/`JIT::link`, DFG/FTL OSR-exit vectors, MetadataTables) as each turn executes more not-yet-compiled code. Measured over restore + 4 turns: `BUN_JSC_useBaselineJIT=0 BUN_JSC_useFTLJIT=0` (LLInt → DFG only) → idle 37 vs 44 MB, after 4 turns **114 vs 150 MB**, CPU 1.67 s vs 1.94 s. FTL off alone or higher DFG thresholds don't help.

## Linux status

Builds and runs on Linux x86_64 (AL2023, `jarred-sandbox`: `~/bun-lowmem` + `~/WebKit`, `BUN_WEBKIT_PATH=/root/WebKit bun run build:release:local`). Smoke test (`/tmp/img-smoke.js`: 200K objects, snapshot at idle, restore, timers): image 33.9 MB, restore maps 30.8 MB clean + copies 3.1 MB data, `process.on('restore')` fires, ticks run. Platform seam: `/proc/self/maps` + `mincore` region scan, linker-symbol data segment bounds, `personality(ADDR_NO_RANDOMIZE)` self re-exec, epoll+eventfd loop reinit in usockets, `/proc/self/task` thread wait, `/proc/self/fd` paths. Holding that heap idle: normal boot RSS 50.4 MB / PSS 41.8 / Private_Dirty 26.2 → restored RSS 32.9 / PSS 24.4 / Private_Dirty 17.7 (image pages are Shared_Clean file pages). Not yet on Linux: CC end-to-end, the attribution tooling (Darwin-only).

## Known gotchas

- `static`/`call_once`/function-local statics and env reads cached at boot carry the *build* process's values.
- Anything holding an OS handle needs a restore path: done for TTY fds, log files (reopened O_APPEND), kqueue/mach ports, uWS loop TLS, mimalloc TLS/scavenger/profiler lock, WTF::Thread, HTTP thread + fs thread pool (epoch-aware Once), ICU break iterators (VM::imageEpoch). Not done: JSC AutomaticThreads (run with concurrent GC/JIT off), FSEvents, DNS-SD connection, sockets in general (they're refused during build instead).
- Image is per-binary and the main binary must run unslid (handled by a one-time self re-exec with the private `_POSIX_SPAWN_DISABLE_ASLR` flag); heap/JIT regions are placed by explicit address hints. Generational/concurrent GC and concurrent JIT work (AutomaticThreads are put in the timed-out state at restore and restart on demand).
- `BUN_IMAGE_IMMORTAL_MODE=7` elides ref/deref on RefCounted objects inside the image arenas (sound: refCount()/hasOneRef() report shared); measured neutral, off by default.
- The WebKit worktree may have staged-but-uncommitted changes if commit signing was unavailable.
