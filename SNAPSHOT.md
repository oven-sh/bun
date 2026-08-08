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

### Single-file executables (done, macOS)

`bun build --compile --compile-image app.ts --outfile app` now yields **one file**: pass 1 builds and runs the app (it snapshots itself), pass 2 re-emits the executable with the raw page-aligned image appended inside the `__BUN,__bun` section payload (`Offsets.image`; the pass-1 graph bytes are reused verbatim since the image points into them). At startup the executable finds the image in itself (`Bun__standaloneEmbeddedImage` → in-memory section pointer → file offset) and maps regions straight out of its own file — no cache, no sidecar, no env. For pipelines that compile through `Bun.build({ compile })` (Claude Code's), `Bun.unsafe.embedImage(exePath, imgPath, outPath?)` performs pass 2 on an existing compiled executable. Debugging keeps working: `BUN_IMAGE_IN=<file>[@offset]` and a sibling `<exe>.img[.zst]` take precedence over the embedded image (`BUN_IMAGE_KEEP_SIDECAR=1` keeps the `.img` at build time); `BUN_IMAGE=0` boots normally.

Claude Code as a single file: `cli` 359 MB → 601 MB with the image embedded (gzip transport ~184 MB); bare run **34.4 MB at the prompt, 0.16 s CPU**, turns work. (Two bugs on the way, both "our own state is in `__DATA` and the overlay rewrites it": the embedded-source base offset, like `environ` before.) Alternative when on-disk size matters: embed the zstd form (CC: +28.6 MB instead of +238 MB) and inflate once to the cache (~0.2 s, then a 238 MB cache file) — same plumbing behind a flag; `mach_vm_remap` from one mapping instead of N `mmap`s (Jarred's suggestion) as a restore-time optimization.

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

All JIT tiers on (LLInt/Baseline/DFG/FTL — an earlier LLInt+DFG-only experiment is *not* a default; its numbers are kept below only as a measurement), generational + concurrent GC, concurrent JIT. Restored: **~34–40 MB at the prompt / idle**; per-turn growth is larger with all tiers (see 'Per-turn growth'); re-baselining with all tiers is pending. Booted normally: 215–230 idle, ~505 ms to prompt.

## Where the memory is after two turns (restored CC, current build)

~97–103 MB total after 2 trivial turns + full GC (+reclean → ~96). Of that: image pages dirtied **~34 MB** (cells 6 MB, malloc payload 28 MB; ~18 MB of it is "nearly identical" pages with ≤64 B changed — top remaining writers: 32-byte malloc nodes (Vector buffer regrowth / counters inside imaged objects), `Structure::m_transitionWatchpointSet` state (+104) and `m_previousOrRareData` materialization (+64), packed counters in 160/384/1024-byte payloads); the rest is fresh memory: new MarkedBlocks **12–15 MB at only ~30% occupancy** (every (IsoSubspace × size class) directory gets fresh 16 KB blocks and each keeps a few survivors — `empty=0` after GC, so nothing is releasable; not image-specific; `sizeClassProgression=2` doesn't change it since the slack is in the small fixed classes across many subspaces — would need a block-selection policy change in BlockDirectory), new UnlinkedCodeBlocks ~5 MB real (instructions/ExpressionInfo are borrowed), linked CodeBlocks/metadata, and app data. Use `drive.ts --bare --stderr-file f --cmd gc,reclean,dirtymap,newcells,ucbcensus,mutated` and read `report.<pid>.txt`.

First-writer attribution of dirtied *cell* pages over one turn (`BUN_IMAGE_TRAP=cells` → `trapsym.ts`): about half is the app mutating its own boot-time objects, half is engine lazy materialization spread over ~6 sites (Structure rare data / property-replacement watchpoints, InlineWatchpointSet inflate/fire, JSScope::abstractResolve → SymbolTableEntry watchpoints, JSFunction rare data, reifyAllStaticProperties), each ≤0.5 MB. The `mutated` report names the app side: of ~1,600 imaged JS objects written during a turn, ~625 are **React fiber nodes** `{tag,key,elementType,type,stateNode,…}`, ~280 `useSyncExternalStore` instances `{value,getSnapshot}`, ~130 refs `{current}`, ~115 Ink/Yoga layout nodes, ~90 lexical/module environments (reassigned `let`s), plus boot-time Arrays/Maps/Sets being appended to. Re-rendering the root with a new key on restore does not help (unmounting writes to every old fiber); leaving the imaged tree untouched would need a fresh Ink root that abandons the old one — tried (`misctools/cc-freshroot-attempt.patch`): the old tree keeps receiving store updates unless unmounted, and two roots cost +55 MB. Snapshotting *before* the UI mounts (premount) removes the fiber dirt but the first mount after restore costs ~140 MB (121 MB at prompt vs 34) — the post-mount snapshot point is right; ~6–7 MB/session of UI-tree dirt is the price.

## Startup

Time to interactive prompt (pty): normal boot ~505 ms / 0.52 s CPU. Restored from the sidecar/cache image ~100–110 ms; restored from the **single-file executable ~45 ms** warm (`tstamp.ts`: `[image] restored` line at ~36 ms incl. the ASLR re-exec and ~370 region `mmap`s; ~720 ms on a cold file cache). The mapping loop is not worth replacing with `mach_vm_remap` at these numbers.

First-ever launch of a new/updated binary on macOS pays a one-time signature assessment roughly proportional to file size (~2.3 ms/MB measured: a fresh copy of the 600 MB single-file `cli` reaches the prompt in ~1.4 s the first time, ~45 ms every time after; `codesign --verify` on it takes 3.9 s). A plain 359 MB `cli` pays ~0.8 s of that anyway, so the raw-embedded image adds ~0.55 s once per install/update and saves ~460 ms on every later launch; the zstd-embedded variant (+28 MB, one 0.2 s inflate) avoids most of the one-time cost if that matters for distribution.

## Interaction latency

Keystroke → echo at the prompt (`keylat.ts`, pty): normal boot p50 ~4.6 ms; restored p50 ~3.4 ms. Only the very first keystroke after restore is slower (~14.7 vs ~8 ms: first re-link of the input path after code was dropped at snapshot); from the second key on the restored process is at or below normal.

## Image size

~243 MB file, of which roughly 100–140 MB is ever touched in a session (rest stays unmapped-clean). Compresses to **30 MB with zstd -3 (0.1 s)** / 24 MB with -19, so ship compressed and inflate once to a cache file.

## Borrowed bytecode (not image-specific)

`Options::useBorrowedBytecodeFromCache` (default on): instruction streams and `ExpressionInfo` payloads decoded from the executable's embedded bytecode cache alias the cache bytes instead of copying. Normal boot idle 184 → 174 MB in a paired run; also shrinks the image.

## Per-turn growth (not image-specific)

Restored or not, footprint grows ~10–25 MB per trivial turn over the first turns (4 "pong" turns: 122 → 152 MB). Live JS cells grow only ~1.3 MB/turn; the growth is JSC tiering artifacts in malloc (baseline JIT `JITData`/IC stubs/`JIT::link`, DFG/FTL OSR-exit vectors, MetadataTables) as each turn executes more not-yet-compiled code. Measured over restore + 4 turns: LLInt → DFG only gave 114 vs 150 MB and less CPU — recorded as attribution of where the bytes go, **not** as a configuration to ship (Jarred: tiers stay on). The item is to reduce JIT-tier malloc footprint by real means: GC-driven discard of baseline code/JITData when idle, IC stub sharing, and checking why `JIT::link`/`OSR-exit` metadata is retained past usefulness.

## Linux status

Builds and runs on Linux x86_64 (AL2023, `jarred-sandbox`: `~/bun-lowmem` + `~/WebKit`, `BUN_WEBKIT_PATH=/root/WebKit bun run build:release:local`). Smoke test (`/tmp/img-smoke.js`: 200K objects, snapshot at idle, restore, timers): image 33.9 MB, restore maps 30.8 MB clean + copies 3.1 MB data, `process.on('restore')` fires, ticks run. Platform seam: `/proc/self/maps` + `mincore` region scan, linker-symbol data segment bounds, `personality(ADDR_NO_RANDOMIZE)` self re-exec, epoll+eventfd loop reinit in usockets, `/proc/self/task` thread wait, `/proc/self/fd` paths. Holding that heap idle: normal boot RSS 50.4 MB / PSS 41.8 / Private_Dirty 26.2 → restored RSS 32.9 / PSS 24.4 / Private_Dirty 17.7 (image pages are Shared_Clean file pages). Not yet on Linux: CC end-to-end, the attribution tooling (Darwin-only).

## ASLR

Three different things slide: (1) our own heap/JIT regions — never depended on ASLR; they are mapped at explicit addresses and that works with ASLR on; (2) the executable — the image is full of absolute pointers into it (vtables, ClassInfo, `__DATA`), so it must load at its link address: Linux Bun is already linked `-no-pie` (never slides), macOS needs the one-time `posix_spawn(_POSIX_SPAWN_DISABLE_ASLR)` self re-exec (Apple requires PIE; this is the supported way to get slide 0 and leaves libraries/stack randomized); (3) system libraries — the image records their base; on mismatch it boots normally. On Linux an **extern-library fixup table** is implemented (dump: `dl_iterate_phdr` + scan → ~220 words on ~13 pages, mostly our GOT/stdio in the data segment plus a few heap words; restore: data segments are copied last in a libc-free loop together with the rebase). Status (`BUN_IMAGE_LIB_FIXUPS=1`, opt-in): with libc/ld sliding the restore maps everything, rebases the ~220 words, then segfaults inside the "adopt main thread" step (right after the `[image] thread: … held=1` line, before `vm.is_shutting_down`) — under gdb (which disables randomization) the identical binary/image runs to completion, so what's left is state tied to libc/ld/TLS placement that a word scan can't see. Known such state in a `-no-pie` executable: **copy-relocated libc globals living in our .bss** (`environ` — handled; likely also `__progname`, `optarg/optind`, `stdin/stdout/stderr`, `__libc_single_threaded`, `program_invocation_name`), and the main thread's `struct pthread`/static-TLS block (allocated by ld.so; imaged `pthread_t` values point at the builder's). Next step is a gdb session on the box with randomization *enabled* (`set disable-randomization off`) on `/tmp/hf-bin` with `BUN_IMAGE_REEXECED=1 BUN_IMAGE_LIB_FIXUPS=1`. Until then Linux keeps the `personality(ADDR_NO_RANDOMIZE)` re-exec, whose only remaining job is keeping libc/ld/TLS at the recorded addresses. On macOS a blind fixup table is not viable: the dyld shared cache is one ~5.6 GB VA span with ~350 images/1,750 segments mapped, so plain integers/doubles in the image alias it constantly (7.5K "hits" on 312 pages, most in libraries Bun never calls); reboot-survival there has to stay type-directed (re-create the few objects that hold foreign handles — ICU, DateCache, Thread, RunLoop are done; libc++abi/CF/Security/dispatch objects would be next) with the libsBase guard falling back to a normal boot.

## Linux status (Aug 6, evening)

`test/js/bun/image/image.test.ts` is 3/3 on x86-64 Linux (AL2023, `bun-fuzz`, full ASLR) and on macOS arm64 from the same commit: both round-trips and the single-file `bun build --compile --compile-image` executable (finds the image in its own `.bun` payload via `PT_LOAD` → file offset, maps regions from its own file, rebases sliding system libraries through the fixup table, no environment, no re-exec). Iterate on `bun-fuzz` (idle, 64 cores; `~/src/{bun-lowmem,WebKit}`; `/tmp/fuzz-build.sh`; static ICU 75 in `/usr/local`, symlinked into `/usr/lib64`; after every fetch run `git checkout -- vendor/mimalloc` because the dep step re-syncs upstream mimalloc over the fork).

The bugs behind the earlier Linux failures, all "restore-time code touched state that belongs to the other process": (1) the deferred (fixup-path) data-segment overlay ran after the fresh heap was created and wiped the allocator state it lived in → now runs right after the region loop; (2) mimalloc's inherited hint pointer could be invalid/inside WTF's OSAllocator window → persistent `hint_floor`, floor re-applied after the overlay, scan limited to mimalloc's range; (3) `VM::lastStackTop` was the builder's stack → refreshed inside adopt before anything allocates JS; (4) the ELF section reader used the image-offset `pread` wrapper on `/proc/self/exe` → no linker-owned ranges → GOT overwritten (embedded path only); (5) build identity on ELF = the `NT_GNU_BUILD_ID` note (headers change when the payload is appended).




## Resolved by rebase (Aug 7): restored CC segfault in fetch-abort during SIGTERM shutdown

Repro: pre-dispatch CC image, restore interactively from a trusted cwd, send SIGTERM at idle (~13 s; `drive.ts` does this when no `--type`). Plain boot of the same binary survives the same SIGTERM. Decoded stack (`~/code/tmp/ccmem/decode-bunreport.py <bun.report url> <cli>` — decodes the VLQ trace and symbolizes with atos): JS `AbortController.abort()` → `AbortSignal::runAbortSteps` → `'abort'` event → JS listener → `AbortController.abort()` → `runAbortSteps` → `webcore::response::BodyAbortListener::on_abort` → `webcore::readable_stream::ReadableStream::done` → SIGSEGV at varying small/garbage addresses (0x1, 0x709…). Fixtures with 20–30 in-flight fetches (127.0.0.1 and real HTTPS hosts, mixed body states, aborted from a SIGTERM handler after restore, stream/abort machinery warmed in the builder) do **not** reproduce. Hypothesis: a `Response` + `BodyAbortListener` pair that exists *in the image* (constructed during module init by CC's warm-up — e.g. a `new Response()`/`ReadableStream` feature probe) whose wrapper dies post-restore: finalize → `unref` → free of an image-arena block (sealed) while the imaged `AbortSignal` still holds the listener ctx, or the block is handed out again; abort then walks freed memory. Second decoded variant: `AbortSignal.timeout` timer → `on_abort` → `ReadableStream::done` on a freed native source (the JS stream's `m_nativePtr` still tagged a finalized `Source`). Fixed upstream by `aaf5e8af11b` (Body.Locked.readable held as a real `JSC::Weak`); after rebasing onto main (Aug 7) the SIGTERM-at-idle run exits cleanly. Also fixed here: `ByteStream::on_data` took the pending read action *after* `signal_drained()` (re-entrant) → unwrap panic; now taken before (`75f4f1b7`).

Rebase notes: bun-lowmem = 150 commits on `origin/main` f8b634223aa (early GC-controller WIP dropped for main's #35356); WebKit-lowmem = 29 commits on pin `ddea71318fec`; main also bumped the mimalloc pin (`.ref a0e4999…`) — fork files re-applied and compile, audit against the new upstream pending.


## Restore fix: stale ParkingLot entries (Aug 7)

Symptom: the first full GC after restore that needed the collector thread took exactly 10 s (then 3–8 ms forever after); in CC the post-mount `Bun.gc(true)` took 10.4 s and idle sat ~60 MB higher because garbage piled up meanwhile. Trace (`AutomaticThreadCondition::notifyOne` → `notify()` → `Condition::notifyOne` reported *unparked=1*, yet the collector woke by *timeout*): WTF's process-global `ParkingLot` hashtable was imaged with the **builder's** parked threads queued on the same condition addresses, so the first unpark dequeued a dead entry. Fix: `ParkingLot::forgetAllForImageRestore()` (unparkAll every queued address) as the first step of `VM::didRestoreFromImage` (WebKit `0d05907ecce0`); test `image.test.ts` "full GC right after restore…". Same class as everything else: process state captured from the builder — now handled once at the WTF layer for every Lock/Condition user.

CC pre-dispatch image after this + rebase (all tiers): 46 MB at resume → 203 MB first frame → 265 MB idle after GC (≈ normal boot idle). Startup and correctness win; idle memory needs the boot *work* above the cut (next).


## CC: where to cut (Aug 7) — measured both ends on the same binary/runtime

| same `cli`, same runtime (all tiers, rebased) | at prompt | idle @14 s | CPU to idle |
|---|---|---|---|
| plain boot | 313 MB | 262 MB | 2.30 s |
| pre-dispatch image (`snapshotBeforeDispatch` + `warmEverything`; argv/env/cwd correct) | 252 | 265 | ~2.1 s |
| late cut, hermetic (`CLAUDE_CODE_SNAPSHOT_AT=repl`: REPL idle in a seeded temp HOME; 208 MB image) | 52 | **47.7** | 0.22 s |
| late cut + hydrate v0 (`snapshotHydrate.ts`: config/settings/trust/cwd re-read, settings change fanned into the mounted AppState; 12 ms) | 60 | **55.9** | 0.26 s |
| late cut + hydrate v1 (+ cwd/keychain/credential memos; MCP + git context come up for the real cwd) — **runs a real turn** (`⏺ pong`, subscriber auth) | 75 | **76** | 0.45 s |


`misctools/cc-image-demo.sh <cli> [cwd]` runs the comparison end-to-end (same binary, plain vs image, real turn each). Current output on this machine:

```
plain    | to prompt: 1.0s footprint=275.9M | idle footprint=275.7M cpu=0:02.18 | first turn done at: 21.6s
image    | to prompt: 1.0s footprint=78.4M  | idle footprint=169.6M cpu=0:01.25 | first turn done at: 18.6s
image #2 | to prompt: 1.0s footprint=77.6M  | idle footprint=162.2M cpu=0:01.08 | first turn done at: 18.8s
```
The 76 MB idle above holds while the REPL is untouched; once post-mount managers run for the real machine (MCP connect, plugins, GrowthBook, file index) the restored process settles ~165 MB — the same +90 MB those managers cost in a plain boot. They are machine-specific (not imageable) and are the next diet target. Non-default argv (`--version`, `--help`, `-p`, subcommands) is gated by the runtime's argv key and plain-boots at normal speed (0.11 s / 0.19 s). Binary is 570 MB (360 exe + 210 raw image): store the image compressed and inflate to a cache file on first run.

Runtime bugs the late cut surfaced (fixed, tested in `image.test.ts`): `keepTimers` (armed timers survive, re-based on the new monotonic clock — a mounted app owns timers); the isolated `spawnSync` event loop wrapped the builder's kqueue fd (every `spawnSync` after restore returned status 1 with empty output — this is what made CC "Not logged in": the keychain is read via `security` exec); JSLock now held through the `restore` emit. Ecosystem gotcha handled app-side: graceful-fs replaces `process.cwd` with a caching closure → `process.chdir('.')` first thing after restore.

Phase-by-phase (`hydrateMark` at every `profileCheckpoint`, plain vs restored) the boot phases cost the same whether modules are warm or not (prepareSession head ~+42 incl. ~24 MB of fire-and-forget I/O completions, plugins +14–19, telemetry +13–15, hooks +10, first render +16–18, post-mount +40–50 before GC): the bytes are the subsystems' object graphs, not code loading. Checkpoint attribution bills async work to the next `await` (the "UDS listen +30 MB" was queued work landing on the first loop turn; `hydrateDrain` shows it).
So: the memory win comes from boot's *results* living in clean image pages, which only a late cut captures. To ship the late cut correctly CC needs (1) an argv gate — non-default invocations plain-boot (or restore the pre-dispatch base image), and (2) incremental hydrate: each subsystem re-reads its machine inputs (config, settings, auth, cwd/trust/git, MCP, plugins, GrowthBook, terminal) into the graph that is already mounted, instead of re-running boot.

## Perf when the feature is compiled in but unused (merge bar: zero cost)

Harness: `misctools/run-jetstream.js` (JetStream2 shell-runner shim for bun) + `/tmp/ab-jetstream.sh` on `bun-fuzz` — paired rounds alternating arms, per-benchmark medians, geomean. Two comparisons: (a) stock bun+WebKit vs lowmem everything: geomean **1.029** but with ±10–20 % swings both ways that come from the mimalloc fork / bun side, not JSC (needs its own A/B with deterministic hints off); (b) stock bun linked against the *lowmem WebKit* (isolates the JSC patches): initially **0.984** — a uniform 1–3 % tax — traced to checks on the hottest paths: `RefCounted::ref/deref/hasOneRef/refCount` testing the image-immortal range on every refcount op (with the mode off — pure tax; reverted to stock), `getenv("JSC_IMM_LOG")` in `linkFor` on every call link (debug leftover; deleted), and the `m_isImmortal` branches in `MarkedBlock::aboutToMark/isMarked/testAndSetMarked`. With all three out: **0.9996** (17 benchmarks × 6 rounds) — parity. The mark-fast-path branches had to go back in for now (removing them lets `testAndSetMarked` mark+visit *dead* image cells → junk traversal → SIGILL in CC): with them in and the other two fixes kept the isolate reads **0.983** — i.e. those three branches alone cost ~1.5 %, the single biggest remaining item. Why they are needed today: cells that died in the freeze GC still have referrers that JSC only clears lazily (weak references, IC stubs, watchpoints — cleared in finalizers/sweep, which immortal blocks skip); the branch makes such a referent read as marked-and-never-visited. Setting all bits at freeze is not viable (the builder's and the tooling's `forEachLiveCell` walks then touch zapped slots). Zero-cost plan: before `makeImmortal`, run the freeze GC to completion *including* `finalizeUnconditionally`/weak clearing/IC unlinking and an eager sweep of every block, so no live referrer points at a dead cell; then `m_marks` = liveness, dead slots are zapped and unreferenced, and the three fast paths can be stock (a dead image address is then unreachable by precise marking, and conservative roots already filter through `Handle::isLive` → frozen bit). Still to measure: `StringImpl::ref/deref` static-string check (un-guarded from `TSAN_ENABLED` so image strings stay clean), the `m_link` extra load in virtual-call thunks, the borrowed-`InstructionStream` `View` branch per bytecode read, and Bun-side/mimalloc effects; plus memory/CPU-at-idle/stability with the feature compiled in and no image.

Ship order (Jarred): validate impact in CC → meet the merge bar (no perf/memory/stability/CPU% hit, enabled or not) → ship mimalloc, then Bun, then the WebKit fork → then CC.

## Statics, once-tokens and CPU dispatch across a restore

One process-wide restore epoch: the exported, unmangled `bun_image_epoch` (`u32`, defined in `bun_core::image`, bumped by the C++ restore sequence before any handler runs; `bun_core::image::epoch()` / `ImageOnce` on the Rust side, `VM::imageEpoch()` in JSC, plain `extern uint32_t bun_image_epoch` from vendored C). Rule for any lazily-initialised static that caches *process, OS or CPU* state (fds, ports, thread handles, env snapshots, page size/CPU count probes, SIMD dispatch): key the once-token on the epoch — `if (token != bun_image_epoch + 1) { init(); token = bun_image_epoch + 1; }` — instead of a bool. Statics that cache pure computation need nothing.

CPU features: the image header records the build machine's feature word (x86: SSE3…AVX-512 subset bits from cpuid 1/7; arm64: `hw.optional.arm.FEAT_*` / `AT_HWCAP`); a restoring CPU must be a superset or the executable boots normally — so implementation choices latched in the image (Highway `ChosenTarget`, simdutf's active implementation, `OPENSSL_ia32cap_P`, zlib-ng's functable, libdeflate/zstd cpu flags) are always *valid*. At restore `imageReprobeCPUDispatch()` additionally re-detects Highway, simdutf and BoringSSL so a more capable CPU gets its best paths; zlib-ng/libdeflate/zstd keep the (valid) build-machine choice.

## Known gotchas

- `static`/`call_once`/function-local statics and env reads cached at boot carry the *build* process's values.
- Anything holding an OS handle needs a restore path: done for TTY fds, log files (reopened O_APPEND), kqueue/mach ports, uWS loop TLS, mimalloc TLS/scavenger/profiler lock, WTF::Thread, HTTP thread + fs thread pool (epoch-aware Once), ICU break iterators (VM::imageEpoch). Not done: JSC AutomaticThreads (run with concurrent GC/JIT off), FSEvents, DNS-SD connection, sockets in general (they're refused during build instead).
- Image is per-binary and the main binary must run unslid (handled by a one-time self re-exec with the private `_POSIX_SPAWN_DISABLE_ASLR` flag); heap/JIT regions are placed by explicit address hints. Generational/concurrent GC and concurrent JIT work (AutomaticThreads are put in the timed-out state at restore and restart on demand).
- `BUN_IMAGE_IMMORTAL_MODE=7` elides ref/deref on RefCounted objects inside the image arenas (sound: refCount()/hasOneRef() report shared); measured neutral, off by default.
- The WebKit worktree may have staged-but-uncommitted changes if commit signing was unavailable.
