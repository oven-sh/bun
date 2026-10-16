### Problem
- `assert.deepStrictEqual(urlA, urlB)` fails with `Values have same structure but are not reference-equal:` and `URL {}`. Node and Bun 1.3.14 print the hrefs. #34660 removed the URL arm of `formatRaw` (`src/js/internal/util/inspect.js`).
- `util.inspect(url, { depth: 0 })` prints `URL [Object]`: the hook lowers the depth (`WebStreamsInspectCustom.cpp:51`, also `JSBroadcastChannel.cpp:183`).
- A failing assert whose message throws leaves `Error.stackTraceLimit` at 0 (`assertion_error.ts:279`).

### Fix
- `formatRaw` has the arm again. It tests the native class (`$inheritsDOMURL`), then reads `href`. Node reads `href` first.
- URL's hook passes its options unchanged to `inspectWithName`, split from `customInspect`. BroadcastChannel's hook lowers `options.depth`.
- The AssertionError constructor restores the limit in a `finally` (the shape of #45177). Node does not.
- Verified: 28 of 29 new tests (`custom-inspect.test.js`, `assert.test.cjs`, `console.test.ts`) fail on 1.4.3. Self-reviewed: @@SR_SHORT@@ (Notes).

### Background
- `util.inspect` first calls a value's `[nodejs.util.inspect.custom]` method (the hook). With `customInspect: false`, which `node:assert` passes, `formatRaw` prints own properties. A URL has none.
- The two departures from Node need a maintainer's ack (Notes).
- Considered: Node's order (a `href` getter that throws replaces the AssertionError) and `instanceof URL` (a replaceable global).

### Downsides
- `util.inspect` of a class instance makes one host call: +@@LLINT_CLASS@@ instructions interpreted, @@JIT_CLASS@@ with the JIT. Bun prints where Node throws from the `href` getter of a non-URL value (75 of 330 probe rows).
- `Bun.inspect` and `console.log` print the fields of a URL or BroadcastChannel one level past the depth: the native formatter gives hooks depth 0 there (#44952).
- Blob, File, Event and others still print `X {}` in assert messages (Notes).

