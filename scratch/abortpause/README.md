# ABORT × AutoPause interaction round (#3661)

**Law under test:** after any abort/cancel of a `fetch()` whose response body
is AutoPause-paused (`BodyReceiveMode::Paused`), within **2 s** the pending
operation settles **and** the transport is released (origin sees TCP close,
fd returned).

**Matrix:** 29 abort/cancel paths × 4 body shapes × 3 runtimes = 348 cells.
Raw-TCP origin (`node:net`) observes backpressure (`write() → false`) and
`close`. Loopback only.

## Running

```sh
bun scratch/abortpause/run.mjs                    # full matrix
bun scratch/abortpause/run.mjs --rt=asan          # one runtime
bun scratch/abortpause/run.mjs --shape=fast-cl    # one shape
bun scratch/abortpause/run.mjs --path=gc.         # path substring filter
<rt> scratch/abortpause/cell.mjs fast-cl rs.reader-cancel   # one cell
```

Env overrides: `BUN_CANARY`, `BUN_ASAN`, `NODE_BIN`.

## Runtimes tested

| | bin | revision |
|---|---|---|
| canary | `bun` | 1.4.0-canary.1+ae4b17de6 (≥ requested 5b98630ac) |
| asan   | `build/debug/bun-debug` | 1.4.0-debug+df6c7eed6 (main, ASAN) |
| node   | `node --expose-gc` | v26.3.0 |

## Body shapes

| shape | wire | purpose |
|---|---|---|
| `fast-cl` | `Content-Length: 32M`, writes until backpressure | AutoPause under sustained backpressure |
| `slow-trickle` | chunked, one 1 KB chunk then hold | AutoPause with minimal buffered bytes |
| `chunked` | `Transfer-Encoding: chunked`, 32 M until backpressure, no terminal chunk | AutoPause on an unterminated chunked body |
| `mid-close` | `Content-Length: 32M`, 256 KB then FIN | abort racing a server-side close |

## Abort/cancel paths (29)

- **ac.\*** (14): `AbortController`/`AbortSignal` on the fetch signal: bare
  abort, with reason, while `read()` pending, `AbortSignal.timeout`,
  `AbortSignal.any`, while `.text/.arrayBuffer/.json/.blob/.bytes()` pending,
  while `Bun.write(path, res)` / `Bun.write(path, res.body)` pending, while
  `pipeTo` pending, inside `for await`.
- **rs.\*** (10): ReadableStream cancellation: `body.cancel()`,
  `reader.cancel()`, `reader.cancel(reason)`, `releaseLock` + `body.cancel()`,
  `for await { break }`, `for await { throw }`, `pipeTo({signal})` abort,
  `pipeTo` sink error, `pipeThrough` + output cancel, `tee()` + cancel both.
- **gc.\*** (3): drop the `Response` and pump GC: never-touched body, after
  one `read()`, after materializing `res.body`.
- **ns.\*** (2): `Readable.fromWeb(body).destroy()` / `.destroy(err)`.

## Results (2026-07-25, 348 cells)

| runtime | pass | faults | timeouts |
|---|---|---|---|
| canary ae4b17de6 | 106/116 | 0 | 0 |
| asan df6c7eed6 | 106/116 | 0 | 0 |
| node v26.3.0 | 104/108 | 0 | 0 |

**Zero faults** on all runtimes including ASAN.

### Grid

```
path                      cana cana cana cana asan asan asan asan node node node node
                          fast slow chun mid- fast slow chun mid- fast slow chun mid-
--------------------------------------------------------------------------------------
ac.abort                  ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-reason           ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-read-pending     ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.timeout                ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.any                    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-text             ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-arraybuffer      ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-json             ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-blob             ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-bytes            ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-bunwrite         ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ·    ·    ·    ·
ac.abort-bunwrite-body    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ·    ·    ·    ·
ac.abort-pipeto           ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ac.abort-forawait         ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.body-cancel            ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.reader-cancel          ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.reader-cancel-reason   ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.release-cancel         ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.forawait-break         ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.forawait-throw         ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.pipeto-signal          ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.pipeto-sink-error      ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.pipethrough-cancel     ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
rs.tee-cancel-both        ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
gc.drop-response          s    s    s    s    s    s    s    s    ✓    ✓    ✓    ✓
gc.drop-reader            s    s    s    s    s    s    s    s    s    s    s    s
gc.drop-body              ✓~   s    s    s~   ✓~   s    s    s~   ✓    ✓    ✓    ✓
ns.destroy                ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
ns.destroy-err            ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓
```

`✓` pass · `·` skip · `s` op settled but origin never saw close (conn leak) ·
`~` racy across runs

## Findings

### All 26 explicit abort/cancel paths pass the law on both bun builds

Every `ac.*`, `rs.*`, and `ns.*` path: pending op settles and the origin sees
close well under 2 s, on all four body shapes, on both canary and main+ASAN.
No regression between canary and main.

### `gc.drop-response`: conn leak on bun, clean on node (#2741 GC-drain face)

Dropping an unread `Response` and GC'ing it does **not** close the client
socket within 2 s on bun (all 4 shapes, both builds, `fd+4`). Node closes it
within ~35 ms. `on_response_finalize` sets `BodyReceiveMode::Ignore` and
schedules a resume, but the resumed drain only closes when the body
**completes**; for an unterminated chunked body or a Content-Length body still
behind backpressure, that never happens within the window. Node's finalizer
aborts the socket instead of draining.

### `gc.drop-body`: shape-dependent leak

Same as above when `res.body` is materialized first. Passes on `fast-cl`
roughly 4/5 (the Ignore-drain finishes the 32 MB CL body over loopback just
inside 2 s); fails on `slow-trickle`/`chunked` every time (body never
terminates). `mid-close` flips per run depending on whether the server FIN
lands before the finalizer.

### `gc.drop-reader`: leaks on bun **and** node (baseline)

After `getReader()` + one `read()`, dropping both the reader and the Response
leaves the stream locked; neither runtime closes the connection on GC. Not a
bun-specific defect.

### #3660 booking not reproduced

`ac.abort-bunwrite` / `ac.abort-bunwrite-body` pass on all shapes on both bun
builds. Separately probed: a late `controller.abort()` and
`AbortSignal.timeout` both settle `Bun.write(path, res)` with
`AbortError`/`TimeoutError` and close the origin, including when the body is
fully buffered before the abort. #3072 (the Bun.write hang **without** abort)
still reproduces on both builds.

### #2877 note confirmed

AutoPause is a 100 % first-iteration trigger: `backpressured=true` on every
`fast-cl`/`chunked` cell on bun. The paused state is deterministic, which is
what makes this matrix reliable.

## Files

- `cell.mjs`: one (shape × path) cell. Node- and Bun-compatible. JSON stdout.
- `run.mjs`: matrix driver; grid + JSONL output to `out/`.
- `out/results-*.jsonl`: per-cell raw results.
