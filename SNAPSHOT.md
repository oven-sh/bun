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

### Single-file `--compile-image` (next; design settled)

Embed the **uncompressed, page-aligned** image inside the executable's existing `__BUN,__bun` / `.bun` section payload rather than shipping `app.img.zst`: restore then `mmap`s each region straight out of the executable file (`section_fileoff + image_off + region.fileOff`) — no cache dir, no inflate, nothing to go stale, and "does the image match the binary" is moot (same file). Concretely: `Offsets` (the trailer struct found via `---- Bun! ----`) gains `image: StringPointer`; `to_bytes` takes an optional image slice appended after the modules with padding to 16 KB (the blob header is 16 KB-aligned, arm64 segments are 16 KB-aligned, so in-file page alignment holds); `--compile-image` becomes build → run (writes a temp `.img`) → **re-`inject`** the same graph + image into the output → macOS ad-hoc re-sign; `Bun__imageMaybeRestore` checks "self has an embedded image" (graph accessor exported to C++) before sibling files. Growing `__BUN` shifts only `__LINKEDIT`, so `__TEXT/__DATA` addresses the image points into don't move; the build-identity check must hash `__TEXT` (not LC_UUID/anything covering `__BUN`). Trade-off: exe grows by the raw image (~240 MB for CC) on disk; transport still compresses 8–10×; RAM cost of untouched pages is zero. Optionally embed the zstd form + keep the cache path behind a flag if on-disk size matters more than first-run cost.

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

## Numbers (Aug 5 2026, M-series, this stack, plain `cli` with `cli.img.zst` beside it, no special env)

Restored: **~34–37 MB at the prompt / idle** (image ~234–243 MB, 28 MB zst); after one turn ~92–98; after 2 turns ~102–107, **~96 after GC + reclean**; CPU for restore + 2 turns ~0.8–0.9 s; time to prompt ~100 ms (0.27 s CPU on first run incl. inflate, 0.13 s after). Booted normally: 215–230 idle (174–184 with LLInt+DFG only + borrowed bytecode), ~505 ms to prompt. Generational + concurrent GC and concurrent JIT on; LLInt+DFG tiers.

## Where the memory is after two turns (restored CC, current build)

~97–103 MB total after 2 trivial turns + full GC (+reclean → ~96). Of that: image pages dirtied **~34 MB** (cells 6 MB, malloc payload 28 MB; ~18 MB of it is "nearly identical" pages with ≤64 B changed — top remaining writers: 32-byte malloc nodes (Vector buffer regrowth / counters inside imaged objects), `Structure::m_transitionWatchpointSet` state (+104) and `m_previousOrRareData` materialization (+64), packed counters in 160/384/1024-byte payloads); the rest is fresh memory: new MarkedBlocks **12–15 MB at only ~30% occupancy** (every (IsoSubspace × size class) directory gets fresh 16 KB blocks and each keeps a few survivors — `empty=0` after GC, so nothing is releasable; not image-specific; `sizeClassProgression=2` doesn't change it since the slack is in the small fixed classes across many subspaces — would need a block-selection policy change in BlockDirectory), new UnlinkedCodeBlocks ~5 MB real (instructions/ExpressionInfo are borrowed), linked CodeBlocks/metadata, and app data. Use `drive.ts --bare --stderr-file f --cmd gc,reclean,dirtymap,newcells,ucbcensus,mutated` and read `report.<pid>.txt`.

First-writer attribution of dirtied *cell* pages over one turn (`BUN_IMAGE_TRAP=cells` → `trapsym.ts`): about half is the app mutating its own boot-time objects, half is engine lazy materialization spread over ~6 sites (Structure rare data / property-replacement watchpoints, InlineWatchpointSet inflate/fire, JSScope::abstractResolve → SymbolTableEntry watchpoints, JSFunction rare data, reifyAllStaticProperties), each ≤0.5 MB. The `mutated` report names the app side: of ~1,600 imaged JS objects written during a turn, ~625 are **React fiber nodes** `{tag,key,elementType,type,stateNode,…}`, ~280 `useSyncExternalStore` instances `{value,getSnapshot}`, ~130 refs `{current}`, ~115 Ink/Yoga layout nodes, ~90 lexical/module environments (reassigned `let`s), plus boot-time Arrays/Maps/Sets being appended to. Re-rendering the root with a new key on restore does not help (unmounting writes to every old fiber); leaving the imaged tree untouched would need a fresh Ink root that abandons the old one — tried (`misctools/cc-freshroot-attempt.patch`): the old tree keeps receiving store updates unless unmounted, and two roots cost +55 MB. Snapshotting *before* the UI mounts (premount) removes the fiber dirt but the first mount after restore costs ~140 MB (121 MB at prompt vs 34) — the post-mount snapshot point is right; ~6–7 MB/session of UI-tree dirt is the price.

## Startup

Time to interactive prompt (pty, `ttfp.ts`): normal boot ~505 ms / 0.52 s CPU; restored from image **~100–110 ms / 0.10 s CPU** — including the ASLR re-exec, mapping the image, the ~16 MB data-segment copy, restore handlers and repaint.

## Interaction latency

Keystroke → echo at the prompt (`keylat.ts`, pty): normal boot p50 ~4.6 ms; restored p50 ~3.4 ms. Only the very first keystroke after restore is slower (~14.7 vs ~8 ms: first re-link of the input path after code was dropped at snapshot); from the second key on the restored process is at or below normal.

## Image size

~243 MB file, of which roughly 100–140 MB is ever touched in a session (rest stays unmapped-clean). Compresses to **30 MB with zstd -3 (0.1 s)** / 24 MB with -19, so ship compressed and inflate once to a cache file.

## Borrowed bytecode (not image-specific)

`Options::useBorrowedBytecodeFromCache` (default on): instruction streams and `ExpressionInfo` payloads decoded from the executable's embedded bytecode cache alias the cache bytes instead of copying. Normal boot idle 184 → 174 MB in a paired run; also shrinks the image.

## Per-turn growth (not image-specific)

Restored or not, footprint grows ~10–25 MB per trivial turn over the first turns (4 "pong" turns: 122 → 152 MB). Live JS cells grow only ~1.3 MB/turn; the growth is JSC tiering artifacts in malloc (baseline JIT `JITData`/IC stubs/`JIT::link`, DFG/FTL OSR-exit vectors, MetadataTables) as each turn executes more not-yet-compiled code. Measured over restore + 4 turns: `BUN_JSC_useBaselineJIT=0 BUN_JSC_useFTLJIT=0` (LLInt → DFG only) → idle 37 vs 44 MB, after 4 turns **114 vs 150 MB**, CPU 1.67 s vs 1.94 s. FTL off alone or higher DFG thresholds don't help.

## Linux status

Builds and runs on Linux x86_64 (AL2023, `jarred-sandbox`: `~/bun-lowmem` + `~/WebKit`, `BUN_WEBKIT_PATH=/root/WebKit bun run build:release:local`). Smoke test (`/tmp/img-smoke.js`: 200K objects, snapshot at idle, restore, timers): image 33.9 MB, restore maps 30.8 MB clean + copies 3.1 MB data, `process.on('restore')` fires, ticks run. Platform seam: `/proc/self/maps` + `mincore` region scan, linker-symbol data segment bounds, `personality(ADDR_NO_RANDOMIZE)` self re-exec, epoll+eventfd loop reinit in usockets, `/proc/self/task` thread wait, `/proc/self/fd` paths. Holding that heap idle: normal boot RSS 50.4 MB / PSS 41.8 / Private_Dirty 26.2 → restored RSS 32.9 / PSS 24.4 / Private_Dirty 17.7 (image pages are Shared_Clean file pages). Not yet on Linux: CC end-to-end, the attribution tooling (Darwin-only).

## ASLR

Three different things slide: (1) our own heap/JIT regions — never depended on ASLR; they are mapped at explicit addresses and that works with ASLR on; (2) the executable — the image is full of absolute pointers into it (vtables, ClassInfo, `__DATA`), so it must load at its link address: Linux Bun is already linked `-no-pie` (never slides), macOS needs the one-time `posix_spawn(_POSIX_SPAWN_DISABLE_ASLR)` self re-exec (Apple requires PIE; this is the supported way to get slide 0 and leaves libraries/stack randomized); (3) system libraries — the image records their base; on mismatch it boots normally. On Linux an **extern-library fixup table** is implemented (dump: `dl_iterate_phdr` + scan → ~220 words on ~13 pages, mostly our GOT/stdio in the data segment plus a few heap words; restore: data segments are copied last in a libc-free loop together with the rebase). Status (`BUN_IMAGE_LIB_FIXUPS=1`, opt-in): with libc/ld sliding the restore maps everything, rebases the ~220 words, then segfaults inside the "adopt main thread" step (right after the `[image] thread: … held=1` line, before `vm.is_shutting_down`) — under gdb (which disables randomization) the identical binary/image runs to completion, so what's left is state tied to libc/ld/TLS placement that a word scan can't see. Known such state in a `-no-pie` executable: **copy-relocated libc globals living in our .bss** (`environ` — handled; likely also `__progname`, `optarg/optind`, `stdin/stdout/stderr`, `__libc_single_threaded`, `program_invocation_name`), and the main thread's `struct pthread`/static-TLS block (allocated by ld.so; imaged `pthread_t` values point at the builder's). Next step is a gdb session on the box with randomization *enabled* (`set disable-randomization off`) on `/tmp/hf-bin` with `BUN_IMAGE_REEXECED=1 BUN_IMAGE_LIB_FIXUPS=1`. Until then Linux keeps the `personality(ADDR_NO_RANDOMIZE)` re-exec, whose only remaining job is keeping libc/ld/TLS at the recorded addresses. On macOS a blind fixup table is not viable: the dyld shared cache is one ~5.6 GB VA span with ~350 images/1,750 segments mapped, so plain integers/doubles in the image alias it constantly (7.5K "hits" on 312 pages, most in libraries Bun never calls); reboot-survival there has to stay type-directed (re-create the few objects that hold foreign handles — ICU, DateCache, Thread, RunLoop are done; libc++abi/CF/Security/dispatch objects would be next) with the libsBase guard falling back to a normal boot.

## Linux: current regression (Aug 6, 03:00) — allocator state after the overlay

The Linux image tests went from 3/3 to 0/3 during the "no env / placement" work. Precise state: restore maps, rebases and adopts fine, then the first Rust allocation aborts with `memory allocation of 128 bytes failed`. What is known: (1) at *startup* (before any `[image]` line) the restoring process makes a 1 GiB **committed** OS allocation that bypasses the hint path (mimalloc warns `unable to allocate aligned OS memory directly … address 0x7f…`), so this process's early heap lives kernel-placed regardless of `MIMALLOC_HINT_FLOOR`; (2) the `__DATA` overlay then replaces the allocator's global state (arena table, page map, `aligned_base`, thread-heap defaults) with the builder's — any arena/heap this process created before restore is orphaned; (3) the explicit fresh arena is created (`arena reserved=1`) but the probe allocation comes from `0x2e01…` (general OS path), i.e. `mi_heap_new_in_arena` isn't binding allocations to it in this state. macOS doesn't hit this because its early allocations are inside the image window and the default theap swap covers them. Next step (quiet box + gdb): break on the Rust OOM handler, identify the heap/arena the failing `mi_malloc_auto_align` used, and either re-create Bun's early heaps after the overlay or keep this process's arena entries alive across it (merge instead of overwrite for `mi_subproc_main()->arenas`). Until then Linux should be considered red on the tip; last green Linux commit for the default path was `80f2aee` ("cache key excludes the system-library base").

## Known gotchas

- `static`/`call_once`/function-local statics and env reads cached at boot carry the *build* process's values.
- Anything holding an OS handle needs a restore path: done for TTY fds, log files (reopened O_APPEND), kqueue/mach ports, uWS loop TLS, mimalloc TLS/scavenger/profiler lock, WTF::Thread, HTTP thread + fs thread pool (epoch-aware Once), ICU break iterators (VM::imageEpoch). Not done: JSC AutomaticThreads (run with concurrent GC/JIT off), FSEvents, DNS-SD connection, sockets in general (they're refused during build instead).
- Image is per-binary and the main binary must run unslid (handled by a one-time self re-exec with the private `_POSIX_SPAWN_DISABLE_ASLR` flag); heap/JIT regions are placed by explicit address hints. Generational/concurrent GC and concurrent JIT work (AutomaticThreads are put in the timed-out state at restore and restart on demand).
- `BUN_IMAGE_IMMORTAL_MODE=7` elides ref/deref on RefCounted objects inside the image arenas (sound: refCount()/hasOneRef() report shared); measured neutral, off by default.
- The WebKit worktree may have staged-but-uncommitted changes if commit signing was unavailable.
