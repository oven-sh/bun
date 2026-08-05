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

## One-command form (any app)

```sh
bun build --compile --compile-image app.ts --outfile app   # builds ./app, runs it once with BUN_IMAGE_OUT, writes ./app.img
./app                                                       # finds app.img next to itself and restores (BUN_IMAGE=0 to boot normally)
```

The app decides when it is idle: call `Bun.unsafe.snapshot(process.env.BUN_IMAGE_OUT, { cancelTimers: true })` when `BUN_IMAGE_OUT` is set, and re-arm whatever it needs in `process.on('restore')`. The image-required environment (allocator/JIT placement, JSC tier options, ASLR off) is applied by a one-time self re-exec, so nothing needs to be set by the user. See `test/js/bun/image/`.

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

For Claude Code specifically: `CLAUDE_CODE_SNAPSHOT_OUT=<cli>.img <cli>` once (writes `<cli>.img` + `<cli>.img.zst`, ~28 MB); after that plain `<cli>` restores by itself (`bun drive.ts <cli> --bare` measures that: 36.7 MB at prompt on first run incl. inflate, 36.8 MB / 0.13 s CPU on cache hit).

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

## Where the memory is after two turns (restored CC, current build)

~97–103 MB total after 2 trivial turns + full GC (+reclean → ~96). Of that: image pages dirtied **~34 MB** (cells 6 MB, malloc payload 28 MB; ~18 MB of it is "nearly identical" pages with ≤64 B changed — top remaining writers: 32-byte malloc nodes (Vector buffer regrowth / counters inside imaged objects), `Structure::m_transitionWatchpointSet` state (+104) and `m_previousOrRareData` materialization (+64), packed counters in 160/384/1024-byte payloads); the rest is fresh memory: new MarkedBlocks **12–15 MB at only ~30% occupancy** (every directory gets fresh 16 KB blocks and each keeps a few survivors — `empty=0` after GC, so nothing is releasable; not image-specific), new UnlinkedCodeBlocks ~5 MB real (instructions/ExpressionInfo are borrowed), linked CodeBlocks/metadata, and app data. Use `drive.ts --bare --stderr-file f --cmd gc,reclean,dirtymap,newcells,ucbcensus,mutated` and read `report.<pid>.txt`.

First-writer attribution of dirtied *cell* pages over one turn (`BUN_IMAGE_TRAP=cells` → `trapsym.ts`): about half is the app mutating its own boot-time objects, half is engine lazy materialization spread over ~6 sites (Structure rare data / property-replacement watchpoints, InlineWatchpointSet inflate/fire, JSScope::abstractResolve → SymbolTableEntry watchpoints, JSFunction rare data, reifyAllStaticProperties), each ≤0.5 MB. The `mutated` report names the app side: of ~1,600 imaged JS objects written during a turn, ~625 are **React fiber nodes** `{tag,key,elementType,type,stateNode,…}`, ~280 `useSyncExternalStore` instances `{value,getSnapshot}`, ~130 refs `{current}`, ~115 Ink/Yoga layout nodes, ~90 lexical/module environments (reassigned `let`s), plus boot-time Arrays/Maps/Sets being appended to. Re-rendering the root with a new key on restore does not help (unmounting writes to every old fiber); leaving the imaged tree untouched would need a fresh Ink root that abandons the old one — tried (`misctools/cc-freshroot-attempt.patch`): the old tree keeps receiving store updates unless unmounted, and two roots cost +55 MB. Snapshotting *before* the UI mounts (premount) removes the fiber dirt but the first mount after restore costs ~140 MB (121 MB at prompt vs 34) — the post-mount snapshot point is right; ~6–7 MB/session of UI-tree dirt is the price.

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
