### Problem
- `assert.deepStrictEqual(urlA, urlB)` fails with `Values have same structure but are not reference-equal:` and `URL {}`. Node and Bun 1.3.14 print the hrefs. #34660 removed the URL arm of `formatRaw` (`src/js/internal/util/inspect.js`).
- `util.inspect(url, { depth: 0 })` prints `URL [Object]`: the hook lowers the depth (`WebStreamsInspectCustom.cpp:51`, also `JSBroadcastChannel.cpp:183`).
- A failing assert whose message throws leaves `Error.stackTraceLimit` at 0 (`assertion_error.ts:279`).

### Fix
- `formatRaw` has the arm again. It tests the native class (`$inheritsDOMURL`), then reads `href`. Node reads `href` first.
- URL's hook passes its options unchanged to `inspectWithName`, split from `customInspect`. BroadcastChannel's hook lowers `options.depth`.
- The AssertionError constructor restores the limit in a `finally` (the shape of #45177). Node does not.
- Verified: 28 of 29 new tests (`custom-inspect.test.js`, `assert.test.cjs`, `console.test.ts`) fail on 1.4.3. Self-reviewed: in progress (Notes).

### Background
- `util.inspect` first calls a value's `[nodejs.util.inspect.custom]` method (the hook). With `customInspect: false`, which `node:assert` passes, `formatRaw` prints own properties. A URL has none.
- The two departures from Node need a maintainer's ack (Notes).
- Considered: Node's order (a `href` getter that throws replaces the AssertionError) and `instanceof URL` (a replaceable global).

### Downsides
- `util.inspect` of a class instance makes one host call: +282 instructions interpreted, +1 to +67 with the JIT. Bun prints where Node throws from the `href` getter of a non-URL value (75 of 330 probe rows).
- `Bun.inspect` and `console.log` print the fields of a URL or BroadcastChannel one level past the depth: the native formatter gives hooks depth 0 there (#44952).
- Blob, File, Event and others still print `X {}` in assert messages (Notes).

<details><summary>Notes</summary>

**Reach.** No issue on the tracker reports either symptom. They show on a failing `node:assert` call with a URL operand, with an explicit `depth` of 0 or 1, with `customInspect: false`, or with a `Console` that a program makes itself. The default text of `util.inspect(url)` does not change. Earlier fixes of the same commit's fallout: #38106, #40131.

**History.** Node added the arm in nodejs/node#50853 (v26.3.0: `lib/internal/util/inspect.js:206` and `:1402`), as the print twin of the URL arm in its deep equality. Bun ported it in #16425 and had it from 1.2.0 to 1.3.14. In the review of #34660 the JS `isURL` helpers became a native `inherits<JSDOMURL>()` test and URL printing moved to a native hook on the prototype. The arm in `formatRaw` went with it. Bun's deep equality kept its native URL arm, so `assert.deepStrictEqual(urlA, urlB)` failed correctly and then printed a message with no href.

**Unlike Node, on purpose. A maintainer's ack is needed for both.**

1. `formatRaw` tests the native class before it reads `href`. Node's `isURL()` is `typeof value.href === 'string' && value instanceof URL` ([inspect.js#L206](https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util/inspect.js#L206)): it reads `href` of every class instance, null-prototype object and iterable of a user class that `util.inspect` prints. The read is a filter in front of a JS `instanceof` (nodejs/node#50853: "Typeof is used for performance reasons"). Bun has a native class test, so the filter is not needed.

   | input | Node v26.3.0 | first push of this PR (Node's order) | this PR | main |
   |---|---|---|---|---|
   | `util.inspect(new Broken())`, `class Broken { get href() { throw new Error("boom") } }` | throws `Error: boom` | throws `Error: boom` | `Broken {}` | `Broken {}` |
   | `util.inspect(Object.create(URL.prototype))` | throws `TypeError` | throws `TypeError` | `URL {}` | `URL {}` |
   | `util.format("%o", class extends URL {})` | throws `TypeError` | throws `TypeError` | prints the class | prints the class |
   | `assert.deepStrictEqual({ a: new Broken() }, { a: 1 })` | throws `Error: boom` | throws `Error: boom` | the AssertionError | the AssertionError |
   | `util.inspect(new Proxy(new Proxy(url, {}), {}), { customInspect: false })` | `Proxy(Proxy(href))` | throws `TypeError` | `URL {}` | `URL {}` |
   | a URL subclass whose `href` getter throws | throws that error | throws that error | throws that error | prints `Sub [URL] {}` |

   - `href` reads by `util.inspect`, 30 value shapes that are not a URL, each with a counting `href` getter: Node reads 9, the first push 9, this PR 0, main 0.
   - A matrix of 330 rows (22 values, among them the inputs above, by 7 option sets of `util.inspect`, `util.format` with `%o`, `%O` and `%s`, `Console#dir` and 4 `node:assert` methods): rows equal to Node v26.3.0 are 104 on main, 271 on the first push and 196 with this PR. All 75 rows that this PR loses against the first push are rows where Node throws from the `href` read of a value that is not a URL, or from its hook on a Proxy. This PR prints there what main prints. Rows where the first push throws and main does not: 93. With this PR: 10, all for a URL subclass whose `href` getter throws.
   - Node's order is not Node's result inside Bun. Bun's `formatValue` unwraps one Proxy level where Node 26 unwraps all (nodejs/node#61077), so the `href` read of the inner Proxy throws a `TypeError` that neither Node nor main throws: 8 of the 15 nested Proxy rows.
   - The arm's other departures stay as they were: `{ href: "x", __proto__: URL.prototype }` prints `URL { href: 'x' }` (Node: `x { href: 'x' }`), `href` is read once for a URL (Node: twice), and `util.inspect(new Proxy(url, {}))` prints the href (Node throws a `TypeError` from its hook).

2. The AssertionError constructor restores `Error.stackTraceLimit` on every exit, and its inspect hook restores the two operands. Node sets the limit to 0, makes the message inside the `super()` arguments, and restores the limit with a plain statement ([assertion_error.js#L353](https://github.com/nodejs/node/blob/v26.3.0/lib/internal/assert/assertion_error.js#L353)). When the message throws, the limit stays 0 for the rest of the process. In Bun every later error then has no `stack` at all.

   - Inputs that leave the limit at 0, of 24 that make the constructor exit by a throw (`Symbol.toStringTag`, `name`, `stack`, `cause` and `errors` getters, Proxy traps, a message or operator whose `toString` throws, `href`): Node v26.3.0 16, Bun 1.4.3 17, the first push 22, this PR 0. A second set of 22 `node:assert` calls: 15, 4, 17 and 0.
   - The store of 0 and the restore are each in a `try` with an empty `catch`, the shape of `getCallSites` (`src/js/node/util.ts:607`). With `Object.defineProperty(Error, "stackTraceLimit", { writable: false })`, main throws a `TypeError` from `assert.strictEqual(1, 2)`. Node and this PR throw the AssertionError.
   - 9 starting states of the limit (10, 0, 77, not writable, deleted, an accessor) by a plain mismatch and by a message that throws: 3 lines differ from Node because of this PR, and all 3 are the limit after a message that throws (restored here, 0 on Node). 3 more lines differ on main already (the frames of the AssertionError when the limit is 0, deleted or an accessor).
   - The inspect hook of AssertionError shortens `actual` and `expected` to 91 characters while it prints and restores them with plain statements, on Node too. After a print that throws, a 600-character `actual` stays at 91 characters on 1.4.3. The restore is now in a `finally`.
   - What stays as on Node: a URL subclass whose `href` getter throws makes `util.inspect`, `Console#dir` and a failing assert throw that error. The error has no frames when the getter creates it while the limit is 0.
   - Credit: #45177 (`BUN_JSC_immutableGlobals`) wraps the same `super()` calls in try/finally, with a native override in place of the two stores. It rewrites `assertion_error.ts:277-372`, so the second of the two to land rebases. In #45177 that hunk then only swaps the two stores.

**What else changes, checked against Node v26.3.0.**
- `util.inspect` and `Bun.inspect` of the 23 classes with a built-in hook and a URL subclass, top level and nested, at depth -1, 0, 1 and default (576 rows, measured on the first push, and the hook files did not change since): 6 of 24 `util.inspect` rows of URL and its subclass change (3 of 24 differ from Node after, 9 before). 10 of 24 `Bun.inspect` rows of URL and its subclass change: 6 inside the depth, 4 one level past it. 4 of 24 BroadcastChannel rows change, and its `util.inspect` rows that differ from Node go from 2 of 12 to 0. The other 21 classes: 0 of 504 rows change.
- The rethrow. An error thrown while a nested value prints (a nested inspect hook, a `Symbol.toStringTag` getter, the `href` getter of a URL subclass) is no longer replaced by `AssertionError: handleMaxCallStackSize assertion failed: ...`. Node has `if (!isStackOverflowError(err)) throw err;` there since nodejs/node#55544 (`inspect.js:1455`). No existing test observed the wrapper.

**Why `$inheritsDOMURL` and not `instanceof URL`.** On today's main the native test is the only class test that survives happy-dom's `globalThis.URL` or a mock: a load-time capture is wrong when the global is replaced before `node:util` loads, and a call-time `instanceof URL` throws when the global is gone (one test covers each). #40303 and draft #44833 make bare `URL` in builtins the native class.

**Measurements.** Release builds (`--profile=release --lto=off`) of main 5f5799ed16 ("main"), of 5f5799ed16 plus the first push ("first") and of 5f5799ed16 plus this PR ("this"). `perf` and `valgrind` are not on the machine and it has no PMU, so instructions are counted by single-stepping the main thread with `ptrace` between two marker syscalls (ASLR off; the JIT rows use `BUN_JSC_useConcurrentJIT=0 BUN_JSC_useFTLJIT=0`, so the top tier is DFG).
- `Zig::jsFunctionInherits` calls, counted with a gdb breakpoint: 111 for 111 class instances and null-prototype objects (first 0, main 0). 1,000 for 1,000 URLs with `customInspect: false` (first 1,000). 0 for 11,000 plain objects and arrays, and 0 for 100 failing asserts on plain objects.
- Instructions per `util.inspect(value, { customInspect: false })`, one value shape per loop (main / first / this):

  | value | interpreter (`BUN_JSC_useJIT=0`) | JIT |
  |---|---|---|
  | plain object `{ x: 1, y: 2 }` | 51,564 / 51,640 / 51,629 (+65) | 9,367 / not run / 9,289 (-78) |
  | class instance | 57,142 / 57,579 / 57,423 (+282) | 10,714 / 10,752 / 10,715 (+1) |
  | class instance, default options | 53,773 / 54,216 / 54,074 (+301) | 10,051 / not run / 10,106 (+55) |
  | null-prototype object | 63,941 / 64,291 / 64,190 (+250) | 12,106 / 12,280 / 12,169 (+63) |
  | 24 classes and 8 dictionary-mode objects in turn | 49,126 / 49,530 / 49,343 (+217) | 9,143 / 9,255 / 9,210 (+67) |
  | URL | 26,995 / 25,648 / 25,648 (-1,347) | 3,987 / not run / 3,844 (-143) |
  | failing `assert.strictEqual(1, 2)` | 119,524 / not run / 119,355 (-169) | 39,351 / not run / 39,288 (-63) |
  | failing `assert.deepStrictEqual({ a: 1 }, { a: 2 })` | 198,337 / not run / 198,382 (+44) | 71,311 / not run / 68,677 (-2,634) |
  | passing `assert.deepStrictEqual` | 2,952 / not run / 2,952 (+0) | 1,264 / not run / 1,264 (+0) |

  The interpreter counts repeat to within 11 instructions per call. A JIT cell is the lowest of 3 runs (2 for the plain object, the URL and the asserts): a run in which a function is compiled or the heap is collected inside the window counts thousands more per call, on every build.
- So a value that reaches the arm (a class instance, a null-prototype object) pays the host call. `let href` is in the block for every value that is not an array, Set, Map, typed array or one of their iterators, so a plain object, a function or an Error pays its two bytecodes in the interpreter (+65 instructions per call for the plain object) and nothing that the JIT rows can show.
- Per constructed AssertionError (a failing assert only): the constructor goes from 526 to 539 bytecode instructions (2,291 to 2,334 bytes). The added opcodes are 3 `catch`, 3 `mov`, 2 `jmp`, 1 `jnstricteq` and 1 `throw`: no call and no allocation. Instructions per failing `assert.strictEqual(1, 2)`: 119,524 to 119,355 (-169) interpreted, 39,351 to 39,288 (-63) with the JIT. The added bytecodes are below what these rows resolve (a failing assert with a diff differs by 2,000 instructions between the two builds in the other direction). A passing assert does not construct one.
- `formatRaw`: 1,047 to 1,058 bytecode instructions (5,314 to 5,372 bytes).
- Bundled module text: `assertion_error.js` 11,794 to 12,011 bytes, `inspect.js` 75,046 to 75,154 bytes. Host functions added: 0 (`JS2NATIVE_COUNT` 238 before and after). `Zig::jsFunctionInherits` cases: 5 to 6.
- Release text (`size`): 102,659,581 to 102,659,394 bytes (187 fewer. The first push: 404 fewer).
- Measured on the first push (base 281698ac93), and the hook files did not change since: instructions per hook call with the JIT, `util.inspect(url)` 112,112 to 104,685 (the options copy is gone), `util.inspect(new ReadableStream())` 35,125 to 35,140 (inside the noise of that row, 30). Allocations per call (`heapStats` object counts): URL hook, Object 22 to 21. A URL past the depth, Object 1 to 0 and string 7 to 0. ReadableStream hook 7 to 7. BroadcastChannel hook 6 to 6. Symbols: `customInspect` 2,704 to 1,533 B, `inspectWithName` 1,382 B (new), URL hook 7,030 to 7,161 B, BroadcastChannel hook 3,327 to 2,407 B, `jsFunctionInherits` 449 to 517 B.

**Not changed, and who owns it.**
- Blob, File, Event, CustomEvent, AbortSignal, TextDecoder, PerformanceMark and PerformanceMeasure still print `X {}` with `customInspect: false`, so a failed `assert.strictEqual` on two of them still says `Values have same structure`. Node prints a diff there only because its classes keep their state in symbol-keyed own properties (`Blob { Symbol(kHandle): Blob {}, Symbol(kLength): 1, Symbol(kType): 'text/a' }`). For Headers, Request, Response, FormData and URLSearchParams Node prints `X {}` too. There is no Node text to port for native state. A second inspect pass with hooks on in `node:assert` would run user hooks inside the `AssertionError` constructor, where Node runs none.
- bun:test. `expect(urlA).toEqual(urlB)` still prints `URL {}` twice. Refs #7253. #36645 owns it.
- The native formatter (`console.log`, `Bun.inspect`, the global `console.dir`) calls a hook with depth 0 one level past the depth (`src/jsc/ConsoleObject.rs:3790`, `saturating_sub`), where Node passes -1. The hook gets the same arguments, `(0, { depth: max_depth })`, for the last level inside the depth, so it cannot tell the two apart. A hooked value one level past the depth thus prints its fields. On main that is every hook with Node's `options.depth - 1`, the URL hook included, at a depth of 1 or more (URL, ReadableStream, WritableStream and CryptoKey checked). #44952 is the user report of the URL row at the default depth. #39938 fixes its indentation. With this change, two more rows do it:
  - A URL at depth 0: `Bun.inspect({ a: url }, { depth: 0 })` prints the 12 fields (main: `URL [Object]`, Node: `URL {}`). At depth 1 the search params print in full (main: `[Object]`).
  - A BroadcastChannel at a depth of 1 or more: `console.log({ a: { b: { c: bc } } })` prints `BroadcastChannel { name: 'x', active: true }` (main: `BroadcastChannel [Object]`, Node: `BroadcastChannel`). On main the hook cut a channel inside the depth the same way, which is the defect that this change fixes.

  The fix is a signed depth from the native formatter, for every hook. It changes what user hooks get from `console.log` and `Bun.inspect`. It is a separate change and has no PR yet.
- Two more places set `Error.stackTraceLimit` and restore it with a plain statement: `src/js/node/repl.js:653` and `src/js/internal/process/pre_execution.ts:129`. #45177 rewrites both.
- A failing assert on a value whose `Symbol.toStringTag` getter throws, or with a message or operator whose `toString` throws, still throws that error where Node throws the AssertionError (`inspect.js:1296` has no guard, Node has one at `lib/internal/util/inspect.js:1219`). The limit is restored now. The thrown value is a separate change.
- A `node:vm` timeout while the message is made ends the script without the `finally`, so the limit stays 0, as on Node.
- `formatValue` unwraps one Proxy level where Node 26 unwraps all (nodejs/node#61077). #38652 owns it. Nested Proxy output keeps its shape until then.
- The global `console.dir(url)` runs hooks and prints the fields (Node: the href). `console.table` prints a hooked cell on many lines. The uncaught-error printer lists `actual:` and `expected:` as native dumps (#36595 removes the prototype members from them). `new Console(stream).table()` throws for object cells (#33452). Each is a separate change.
- The Http2Stream hook passes its options on where Node calls `format(obj)`. A separate change.
- 23 `instanceof URL` argument checks under `src/js` still read `globalThis.URL`. #41117, #40303 and draft #44833 own them.

**Other open PRs on the same lines.**
- `assertion_error.ts`: #45177 (above). #45255 edits its imports and `copyError`, not the constructor.
- `scripts/build/codegen.ts`: #38049 supersedes the hunk here. It lists `js_classes.ts`, `NativeModuleList.h` and `BunBuiltinNames.h` on the same two edges, with a test. The hunk stays so that the new `js_classes.ts` row is safe in a warm build tree without it. #38038, #38063, #43411 and draft #44833 edit the same `inputs:` lines.
- `js_classes.ts`: #33798 appends a row at the same index.
- `inspect.js`: #37043 adds a Temporal arm in the same `else if` chain. #45254 edits `formatError`.
- `custom-inspect.test.js`: #40008, #41281.
- `JSBroadcastChannel.cpp`: #32240 (the options copy loop, which this change does not touch).
- The C++ split is placed so that #40008 (options copy in `customInspect`) and draft #44833 (`JSDOMURL.cpp:753`) apply without a conflict.

**Reviews.**
- Before the first push: 21 concerns, 20 addressed (the BroadcastChannel hook, Node's rethrow, five tests, the mixed-input cost, owners and wording). Not done as asked: one concern wanted the depth half of this change to wait for the signed depth in the native formatter. Both halves stay in one change, and the rows that get longer are in Downsides.
- On the first push, two reviewers objected to the `href` read before the class test: a getter of a value that is not a URL runs, and a failing assert on such a value left `Error.stackTraceLimit` at 0. That is departure 1 and 2 above. Two more comments are the native formatter rows. Two are not applied because Node v26.3.0 prints the same text: a URL whose `href` reads as `''` prints as the empty string (a test row states it), and after a rethrow below a `getters: true` getter the value that was printing stays in `ctx.seen`.
- The self-review of the last commit is in progress.

**Suites.** Debug (ASAN) build: the three test files of this change, `util.test.js`, `node-inspect-tests/parallel/util-inspect.test.js`, and 14 vendored Node tests that use `node:test` (`test-assert*.js`, `test-url*.js`). Release builds of main and of this PR: 136 vendored Node tests under `test/js/node/test/parallel` (assert, util, console, url, whatwg-url, webstreams, broadcastchannel, performance, inspect) and 82 test files under `test/js` (node/util, node/assert, node/url, node/console, node/vm, node/dgram, node/perf_hooks, web/url, web/console, web/broadcastchannel, web/streams, web/crypto, bun/util/inspect). With this PR 217 of 218 pass. The one that fails, `web/streams/streams-leak.test.ts` (a 5 s timeout), fails on the build of main too. On main the three files with the new tests fail besides it. Of the 29 new tests, 28 fail on 1.4.3. The one that passes, `Web Streams > depth 0 cuts the fields`, is the guard for the 18 hooks that keep `depth - 1`. Each rewritten test has a row that fails on 1.4.3. The expected texts of the URL tests are what Node v26.3.0 prints, except the rows of departure 1 and 2. The `URLs` block of Node's `test/parallel/test-assert-deep.js` fails on 1.4.3 and passed with the first push. That file is not vendored because 23 of its other blocks fail on main.

</details>
