### Problem
- `assert.deepStrictEqual(urlA, urlB)` fails with `Values have same structure but are not reference-equal:` and `URL {}`. Node and Bun 1.3.14 print the two hrefs. `console.dir(url)` in a Worker prints `URL {}` too (Node: the href).
- #34660 removed the URL arm of `formatRaw` (`src/js/internal/util/inspect.js`) and added a URL hook. Node has both.

### Fix
- `formatRaw` has the arm again. It tests the native class (`$inheritsDOMURL`), then reads `href`. Node reads `href` first.
- Its catch rethrows what a nested value throws, as Node's, and the `getters` catch accepts a thrown `null` (as in #45355).
- `js_classes.ts` becomes a codegen input (a subset of #38049).
- Verified: @@NEW_TESTS@@ new tests (`custom-inspect.test.js`, `assert.test.cjs`, `console.test.ts`) fail on 1.4.3. Self-reviewed: @@SR_SHORT@@ (Notes).

### Background
- `util.inspect` first calls a value's `[nodejs.util.inspect.custom]` method (the hook). With `customInspect: false`, which `node:assert` and `Console#dir` pass, `formatRaw` prints own properties. A URL has none.
- One departure from Node needs a maintainer's ack: the class test comes before the `href` read (Notes).
- Considered: Node's order (a `href` getter that throws replaces the AssertionError) and `instanceof URL` (a replaceable global).

### Downsides
- `util.inspect` of a class instance makes one host call: +@@LLINT_CLASS@@ instructions interpreted, @@JIT_CLASS@@ with the JIT. Bun prints where Node throws from the `href` getter of a non-URL value (75 of 330 probe rows).
- A failing assert on a URL subclass whose `href` getter throws leaves `Error.stackTraceLimit` at 0, as on Node (#45177 restores it).
- URLSearchParams, Headers, Blob and others still print `X {}` in assert messages (Notes).

