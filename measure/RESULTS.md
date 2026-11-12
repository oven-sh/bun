# Measurements (release builds, Linux x64): merge base 447ff870b60 (/tmp/rel/bun-base) vs PR head 8ad649dafc8 (/tmp/rel/bun-arm)
Tools: /tmp/m/icount (perf_event_open, instructions:u, parent + descendants), /tmp/m/sysc (ptrace syscall counter, parent only), bun:jsc heapStats with BUN_JSC_useGC=0.
Fixtures: /tmp/m/{counts-reader.js,counts-writer.js,paced.cjs,gapless.cjs,spawns.cjs,filestream.mjs,spawntext.mjs,spawnfromweb.mjs}

## per 'data' chunk of child.stdout, paced (each chunk comes to a waiting stream)
- GC cells (N=100 vs 400, /300): 13.0 -> 5.0. Promise 2 -> 0, FullPromiseReaction 1 -> 0, Function 2 -> 0, JSLexicalEnvironment 3 -> 1, Uint8Array 2 -> 1. (The fixture's own setImmediate + stdin write is part of both.)
- process.nextTick per 'data': 0.98 (stdout) / 1.00 (stderr) -> 1.00. Promise.prototype.then: 0.98 / 1.00 -> 0.
- Buffer views (subarray/slice) per chunk: 2 -> 0. Chunks that share an ArrayBuffer: 63 of 64 -> 0 of 64.
- syscalls per chunk (N=200 vs 400): recvfrom 3.0 -> 2.0; epoll_ctl 3.0 -> 3.0; epoll_pwait2 1.3 -> 1.2. Same for a for await consumer (recvfrom 3.0 -> 2.0).
- JS->native host calls per 'data' (BUN_DEBUG_FileReader=1, debug): setFlowing 0, onPull 0 (main: 1 + 1). One native->JS call per chunk.
- instructions per chunk (N=200 vs 1000, median of 3, parent + bun writer child): 'data' 55.9 K -> 47.3 K (-15%); for await 76.1 K -> 65.9 K (-13%).
  raw: data base 83.87/82.46/83.20 M (N=200), 128.56/127.95/126.41 M (N=1000); arm 79.43/79.73/80.42, 117.20/117.58/118.77.
  raw: forawait base 105.60/104.51/103.88, 165.42/165.85/164.43; arm 102.36/102.92/102.64, 154.53/155.34/155.34.

## writer that never pauses
- 256 MiB (bun writer): ticks per chunk 0.94 -> 1.00, then() 0.89 -> 0, Buffer.alloc 0.041 -> 0, views 0.086 -> 0, shared-buffer chunks 138 of 3419 -> 0 of 2947 (stderr: 131 of 3573 -> 0 of 2326).
- 1 GiB (head -c): instructions 762/710/642 M -> 607/575/608 M (median 710 -> 607, -15%). Chunks for 64 MiB: 1865 -> 985.

## other FileReader consumers (pull path), 1 GiB, instructions, 3 runs
- Bun.file().stream(): base 84.0/82.7/83.1 M; PR 79.9/85.1/85.2 M.
- Bun.spawn().stdout.text(): base 939/817/793 M; PR 831/827/834 M.
- Readable.fromWeb(Bun.spawn().stdout): base 713/783/792 M; PR 744/780/733 M.
No change beyond run-to-run spread.

## per spawn of `true` with default stdio (N=50 vs 250)
- syscalls per spawn: recvfrom 2 -> 2, epoll_ctl 4 -> 4, epoll_pwait2 1 -> 1 (nothing reads / 'data' on stdout / on both).
- instructions per spawn incl. child: nothing reads 0.866 M -> 0.812 M; stdout listener 0.850 M -> 0.855 M; both 0.878 M -> 0.838 M.

## process lifetime, unref'd `sleep 2` child (life.cjs): node / main / PR
plain 2 s / 0 s / 0 s; touch 2 / 0 / 0; data 2 / 2 / 2; readable 2 / 2 / 2; pause 2 / 2 / 2; unref of all pipes 0 / 0 / 0.

## binary
- text (size): 144,201,948 -> 144,214,106 (+12,158 bytes). File: 144,390,416 -> 144,402,704 (+12,288).
- +1 host function (setReadCallback), +1 internal field on FileInternalReadableStreamSource's wrapper, +1 task tag, 4 one-byte flags on FileReader.

## known residual (unchanged from main)
- A listener attached in the child's 'exit' gets pre-read chunks from flow() in a tick. A fatal throw there is followed by 'end' and 'close' (main: same; Node: process ends). Ticks run on after a fatal report process-wide.
