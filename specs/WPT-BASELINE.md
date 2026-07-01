# WPT streams baseline (pre-rewrite)

Compliance baseline of Bun's **current** Web Streams implementation against the
Web Platform Tests streams suite, captured on 2026-07-01 immediately before the
C++ rewrite. This is the number the rewrite is measured against.

- Upstream: `web-platform-tests/wpt @ 1cfa3004f4ac74aa007591529aba9e9246b1f1bf`
- Vendored suite + harness + per-subtest expectations:
  `test/js/third_party/wpt-streams/` (68 `.any.js` files; `transferable/`,
  `idlharness`, browser-only `.window.js`/`.html`, and the `.tentative`
  `type: 'owning'` proposal are excluded — see `UPSTREAM.md`)
- Re-run:

  ```sh
  bun bd test test/js/third_party/wpt-streams/wpt-streams.test.ts
  ```

  The suite is green on the current implementation: every currently-failing
  subtest is a `test.todo` keyed in `expectations.json`, so regressions in the
  969 passing subtests fail CI, and every fix shows up as a stale expectation.

## Numbers

**1174 subtests. 969 pass (82.5%). 205 do not** (193 assertion failures,
10 hangs, 2 process crashes).

| area | subtests | pass | pass % |
|---|---|---|---|
| piping | 229 | 226 | 98.7% |
| queuing-strategies | 20 | 18 | 90.0% |
| readable-streams | 348 | 283 | 81.3% |
| readable-byte-streams | 248 | 140 | **56.5%** |
| transform-streams | 133 | 119 | 89.5% |
| writable-streams | 196 | 183 | 93.4% |

## Top failure clusters (current implementation)

1. `ReadableStream.from()` missing entirely — 37 subtests.
2. `reader.releaseLock()` implements the pre-2021 spec: it refuses to release
   with pending reads and rejects `closed`/pending reads with `AbortError`
   instead of `TypeError` — ~35 subtests across default and BYOB readers.
3. BYOB request bookkeeping: `byobRequest` is `undefined` instead of `null`,
   not invalidated after `respond()`/`enqueue()`, `respondWithNewView()` does
   no validation, and `respond()` after `enqueue()` **aborts the process**
   (JSC assertion; 2 subtests) — ~30 subtests.
4. `tee()` on a byte stream produces branches that cannot serve BYOB readers —
   ~28 subtests.
5. `read(view, { min })` not implemented (silent short fills, hangs on the
   argument-validation cases) — 18 subtests.
6. Detached / transferred / non-transferable `ArrayBuffer` handling in byte
   streams (no transfer on `read(view)`, detached buffers accepted, reads that
   must reject hang) — ~12 subtests.
7. `transformer.cancel()` (2023 addition) not implemented — ~12 subtests.
8. `WritableStreamDefaultController.signal` missing — 10 subtests.
9. Not primordial-safe: `pipeTo`/`tee`/async-iteration call user-patched
   `Promise.prototype.then`, `Object.prototype` getters, patched `getReader` —
   5 subtests (also a hardening concern).
10. Constructor/argument validation: wrong error classes, non-callable
    members accepted, `new WritableStreamDefaultController()` doesn't throw,
    strategy `size` function `name`, async-iterator prototype shape —
    ~15 subtests.

The area to beat is **readable-byte-streams (56.5%)**; default readable,
writable, transform, and piping are each ≥81%.

Full per-subtest detail: `test/js/third_party/wpt-streams/RESULTS.md` and
`expectations.json`.
