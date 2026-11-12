# The two prepared commits on #46528's head 3f5d7cd7bd (2026-11-11)

#46528 merged main twice on 2026-11-11 (961449c6f4, e7dda37d70) and is 0 commits behind main 447ff870b6.
Its merge state is BLOCKED (review), not DIRTY.

Between 54e62020ca (the old base) and 3f5d7cd7bd there is NO change in `patches/lsquic`,
`scripts/build/deps/lsquic.ts`, `packages/bun-usockets/src/quic.c`, `test/js/bun/http/serve-http3.test.ts` or
`test/js/node/quic/quic-stream.test.ts`. The Rust of node:quic changed (main's #47836, #47944), and
`src/lsquic_sys/lib.rs`, `quic.bind.ts`, `internal-for-testing.ts`.

## The commits

Both cherry-pick with no conflict (`stream.rs` auto-merges):

- A' = 86ad6d07e9 (was 9aea9bd50b) -> refs/robobun/backup/42e43abd-prep-a
- B' = 4ec3bf9b40 (was d0b69cdb97) -> refs/robobun/backup/42e43abd-prep-b

## Debug builds (official `bun bd`), all on 3f5d7cd7bd

| tree | result |
| --- | --- |
| A' + B' | `serve-http3.test.ts` 122 pass, `quic-stream.test.ts` 119 pass. The 13 rows pass. |
| A' + B' | AOT: differential test on the 4 overloads of the two new rows passes (`AOT_BUILTINS_UPDATE=1 AOT_BUILTINS_FILTER=frameHeader`), `not-checked.txt` unchanged. Trim and table tests: 234 pass in 10 files. |
| A' alone | `serve-http3.test.ts` 120 pass. The 3 rows of A pass. No `lsquicFrameHeaderWaits`. |
| A' without its `lsquic.ts` entry | the 3 rows of A fail: 15 of 40 (warm), 34 of 40 (cold), and no "headers 200" with late SETTINGS. |
| A' + B' without the 3 patches of B, with a stub for the counter | the 10 rows of B fail. Connection rows: ``Assertion `stream->conn_pub->conn_cap.cc_sent <= stream->conn_pub->conn_cap.cc_max' failed`` (2). Stream rows: ``Assertion `size <= stream_avail' failed`` (2). Stall rows: 0 of 40 (2), 2 more node:quic rows with a wrong count, Bun.serve 11 of 100, and the small-window row. |

Build times on this tree: 27 min (first), 17 min (B' -> A'), 8.5 min (lsquic only), 12 min (A' -> B' variant).

## Not done on this head

- Release builds, and the release loops of the 13 rows.
- The bytes of the two new host functions and table rows (release builds of A' and of A' + B').
- The unit cases and the cost numbers of `lsquic_stream.c`. The C code is the same as on 54e62020ca.

## Release builds on 3f5d7cd7bd (added 2026-11-12 00:30Z)

`bun run build:release`: 33 min for the first, 14 min (B' -> A'), 10 min (lsquic only), 19 min (A' -> B' variant).
PATH has `build/release` first: `bun` in the container is the last release build of the worktree, and
`/usr/local/bin/bun` is 1.4.2. The released 1.4.4 is
https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-x64.zip (1.4.4+38afee6c8).

| binary | `size` text | data | bss |
| --- | --- | --- | --- |
| base (A's tests, no A patch) | 144,159,395 | 124,208 | 1,854,344 |
| A' | 144,159,475 (+80) | 124,208 | 1,854,344 |
| A' + B' | 144,160,282 (+807) | 124,208 | 1,854,376 (+32) |

- A' + B': `serve-http3.test.ts` 120 pass + 2 skip, `quic-stream.test.ts` 119, `quic-endpoint.test.ts` 42 + 2 skip,
  `quic-sni.test.ts` 21, `fetch-http3-client.test.ts` 108, `test-quic-*.mjs` 233 of 235 (2 import `node:stream/iter`).
  The 13 rows x 30 loops: 390 pass.
- A': `serve-http3.test.ts` 118 pass + 2 skip. The 3 rows x 30 loops: 90 pass.
- base: the warm row fails 99 of 99 runs (15 of 40), the late SETTINGS row 99 of 99, the cold row 8 of 99.
  Late SETTINGS fixture alone: 17 s wall, 13 to 15 s of user CPU, `{"seen":["info 100"],"body":""}`. With A': 0.05 s.
- A' + B' without the 3 patches of B (stub counter), 10 loops: all 10 rows fail every time. 157,010 to 166,507 bytes
  into a 136,000-byte window (20 of 20), `QUIC transport error 3: flow control violation on stream 0` (20 of 20),
  0 of 40 (node:quic stall rows), 11 or 12 of 100 (Bun.serve). The small-window row of Bun.serve gets all 100
  responses there and fails only on the count of stops (`heldBack: false`).

## Stock curl (8.14.1, nghttp3 1.8.0), 40 POSTs with `Expect: 100-continue`, 3,000-byte response field

- 15 ms each way through `delay-relay.mjs`: released 1.4.4 answers 14, 10, 14, 14, 15, 15 of 40. base answers
  11, 15, 7, 10, 9, 1 of 40. A' and A' + B' answer 40 of 40 (4 runs each).
- No relay: 1.4.4, base and A' answer 40 of 40 (3 runs each).
- One POST beside one 5 MB GET: all succeed on 1.4.4, base and A', with and without the relay. The sentence about
  this case is gone from the first PR's description.

## Flaky tests of `serve-http3.test.ts` that these commits do not add (release, whole file, interleaved)

Test file at A's version (120 tests). Runs with a failure outside the rows of A:

- base: 2 of 89. A': 7 of 372. A' + B': 14 of 372 (Fisher two-sided p about 0.18).
- "server.stop(true) after server.stop() closes the H3 connections that are still draining": base 2, A' 4, A' + B' 6.
- "server.stop(true) sends CONNECTION_CLOSE on an idle H3 connection" (`HTTP3StreamReset` at the POST after the
  restart): A' 1, A' + B' 4. Lifecycle block alone, 150 runs each: A' 1, A' + B' 1. Alone, 600 runs each: 0.
- "maxRequestBodySize is enforced for H3 bodies without Content-Length" (5 s time limit): A' 1, A' + B' 3.
- once each: A' routes '/*' (2), three other lifecycle tests. A' + B' "server.stop() with live H3 connections does not UAF".
- User CPU of a whole-file run is the same for both (0.93 to 1.18 s).
- Not settled: whether the credit and flush patches raise these rates. It needs about 1,100 runs per build to tell
  3.8% from 1.9%.

### Second batch (2026-11-12 01:40Z), 247 more whole-file runs per build, interleaved

- A': 8 runs with a failure ("still draining" 4, "maxRequestBodySize" 3, "graceful stop" 1).
- A' + B': 5 runs with a failure ("still draining" 5, "h3-only server exits naturally after stop() drains" 2, and one
  run where 10 lifecycle tests reached their 5 s limit together).
- Totals: A' 15 of 619, A' + B' 19 of 619 (Fisher two-sided p about 0.6). "still draining" 8 and 11,
  "maxRequestBodySize" 4 and 3, "sends CONNECTION_CLOSE on an idle H3 connection" 1 and 4.
- Read: these are flaky tests of the tree. The runs show no effect of the credit and flush patches on their rate.
