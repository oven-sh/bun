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
