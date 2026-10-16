<details><summary>Notes</summary>

**Reach.** No issue on the tracker reports the symptom for `node:assert`. It needs no option in a `node:worker_threads` Worker: since 1.4.0 the global console there is a `node:console` `Console` (`worker_threads.ts:358`), so a plain `console.dir(url)` prints `URL {}` (Node: the href). #39592 would give Workers the native console again. It also shows in the message of a failing `node:assert` call with a URL operand, with `util.inspect(url, { customInspect: false })`, and with a `Console` that a program makes itself. The default text of `util.inspect(url)` does not change. Earlier fixes of the same commit's fallout: #38106, #40131.

**History.** Node added the arm in nodejs/node#50853 (v26.3.0: `lib/internal/util/inspect.js:206` and `:1402`), as the print twin of the URL arm in its deep equality. Bun ported it in #16425 and had it from 1.2.0 to 1.3.14. In the review of #34660 the JS `isURL` helpers became a native `inherits<JSDOMURL>()` test and URL printing moved to a native hook on the prototype. The arm in `formatRaw` went with it. Bun's deep equality kept its native URL arm, so `assert.deepStrictEqual(urlA, urlB)` failed correctly and then printed a message with no href.

**Unlike Node, on purpose: the class test comes before the `href` read.** This is the one question for a maintainer.

Node's `isURL()` is `typeof value.href === 'string' && value instanceof URL` ([inspect.js#L206](https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util/inspect.js#L206)). It reads `href` of every class instance and null-prototype object that `util.inspect` prints. The read is a filter in front of a JS `instanceof` (the review of nodejs/node#50853: "Typeof is used for performance reasons"). Bun has a native class test, so it needs no filter. Jarred-Sumner asked for that test in the #34660 review ("expose an `isURL` function that just does in C++ `object->inherits<JSDOMURL>()`"). The first push of this PR had Node's order. Two reviewers objected to the read, and these rows are why it changed:

| input | Node v26.3.0 | Node's order in Bun (first push) | this PR | main |
|---|---|---|---|---|
| `util.inspect(new Broken())`, `class Broken { get href() { throw new Error("boom") } }` | throws `Error: boom` | throws `Error: boom` | `Broken {}` | `Broken {}` |
| `util.inspect(Object.create(URL.prototype))` | throws `TypeError` | throws `TypeError` | `URL {}` | `URL {}` |
| `util.format("%o", class extends URL {})` | throws `TypeError` | throws `TypeError` | prints the class | prints the class |
| `assert.deepStrictEqual({ a: new Broken() }, { a: 1 })` | throws `Error: boom`, and `Error.stackTraceLimit` stays 0 | the same | the AssertionError | the AssertionError |
| `util.inspect(new Proxy(new Proxy(url, {}), {}), { customInspect: false })` | `Proxy(Proxy(href))` | throws `TypeError` | `URL {}` | `URL {}` |
| a URL subclass whose `href` getter throws | throws that error | throws that error | throws that error | prints `Sub [URL] {}` |

- `href` reads by `util.inspect`, 30 value shapes that are not a URL, each with a counting `href` getter: Node reads 9, the first push 9, this PR 0, main 0.
- A matrix of 330 rows (22 values, among them the inputs above, by 7 option sets of `util.inspect`, `util.format` with `%o`, `%O` and `%s`, `Console#dir` and 4 `node:assert` methods): rows equal to Node v26.3.0 are 104 on main, 271 on the first push and 193 with this PR. Of the 78 rows that this PR has less than the first push, 75 are rows where Node throws from the `href` read of a value that is not a URL, or from its hook on a Proxy, and this PR prints what main prints. The other 3 are the URL hook at depth 0, which left this PR (below).
- Rows that throw where main does not: 93 on the first push, 10 with this PR. The 10 are a URL subclass whose `href` getter throws, as on Node. Rows that throw where Node does not: 8 on the first push (nested Proxies: Bun's `formatValue` unwraps one Proxy level, Node 26 unwraps all, so the `href` read of the inner Proxy throws), 0 with this PR.
- The arm's other departures are as on the first push: `{ href: "x", __proto__: URL.prototype }` prints `URL { href: 'x' }` (Node: `x { href: 'x' }`), `href` is read once for a URL (Node: twice), and `util.inspect(new Proxy(url, {}))` prints the href (Node throws a `TypeError` from its hook).

**The rethrow.** An error thrown while a nested value prints (a nested inspect hook, a `Symbol.toStringTag` getter, the `href` getter of a URL subclass) is no longer replaced by `AssertionError: handleMaxCallStackSize assertion failed: ...`. Node has `if (!isStackOverflowError(err)) throw err;` there since nodejs/node#55544 (`inspect.js:1455`). The arm needs it: a nested URL subclass whose `href` getter throws must give that error. The catch of the `getters` option reads `err.message`, and with the rethrow the thrown value can be `null`, so it now prints `<Inspection threw (null)>` as Node does (main printed the wrapper's text there, and threw for a getter that throws `null` itself). Both hunks are the same bytes as in #45355, so the two merge in either order.

**Why `$inheritsDOMURL` and not `instanceof URL`.** On today's main the native test is the only class test that survives happy-dom's `globalThis.URL` or a mock: a load-time capture is wrong when the global is replaced before `node:util` loads, and a call-time `instanceof URL` throws when the global is gone (one test covers each). #40303 and draft #44833 make bare `URL` in builtins the native class.

**Measurements.** Release builds (`--profile=release --lto=off`) of main 5f5799ed16 ("main"), of 5f5799ed16 plus the first push ("first") and of 5f5799ed16 plus this PR ("this"). `perf` and `valgrind` are not on the machine and it has no PMU, so instructions are counted by single-stepping the main thread with `ptrace` between two marker syscalls (ASLR off; the JIT rows use `BUN_JSC_useConcurrentJIT=0 BUN_JSC_useFTLJIT=0`, so the top tier is DFG).
- `Zig::jsFunctionInherits` calls, counted with a gdb breakpoint: 111 for 111 class instances and null-prototype objects (first 0, main 0). 1,000 for 1,000 URLs with `customInspect: false` (first 1,000). 0 for 11,000 plain objects and arrays, and 0 for 100 failing asserts on plain objects.
- Instructions per `util.inspect(value, { customInspect: false })`, one value shape per loop (main / first / this):

@@INSTR_TABLE@@

  The interpreter counts repeat to within 11 instructions per call. A JIT cell is the lowest of its runs (main 2 or 3, this PR 1 or 2, the first push 1): a run in which a function is compiled or the heap is collected inside the window counts thousands more per call, on every build. Runs of one JIT cell differ by about 100 instructions per call, so the JIT column shows no cost above that.
- So a value that reaches the arm (a class instance, a null-prototype object) pays the host call. `let href` is in the block for every value that is not an array, Set, Map, typed array or one of their iterators, so a plain object, a function or an Error pays its two bytecodes in the interpreter (+@@LLINT_PLAIN@@ instructions per call for the plain object) and nothing that the JIT rows can show.
- Bytecode: `formatRaw` 1,047 to 1,058 instructions (5,314 to 5,372 bytes), `formatProperty` 305 to 308 (1,300 to 1,308 bytes).
- Bundled `inspect.js`: 75,046 to 75,174 bytes. Host functions added: 0 (`JS2NATIVE_COUNT` 238 before and after). `Zig::jsFunctionInherits` cases: 5 to 6.
- Release text (`size`): 102,659,581 to 102,659,965 bytes (+384).
- `Error.stackTraceLimit`: of 24 inputs that make the AssertionError constructor exit by a throw, 17 leave the limit at 0 on main, 18 with this PR (the one more is the URL subclass whose `href` getter throws), 16 on Node v26.3.0, and 22 on the first push.

**Not in this PR, and who owns it.**
- The depth of the URL and BroadcastChannel hooks (`util.inspect(url, { depth: 0 })` prints `URL [Object]`). It was in the first push. With Node's rule in the hook, `Bun.inspect({ a: url }, { depth: 0 })` and `console.log` of a nested BroadcastChannel print the fields one level past the depth, because the native formatter gives hooks depth 0 there where Node gives -1 (`src/jsc/ConsoleObject.rs:3790`). The hook change is to land with a signed depth from the native formatter, as one separate change. The MessagePort and Http2Stream hooks differ from Node's depth rule too and belong to it. #44952 is the user report of the URL row at the default depth, and #39938 fixes its indentation.
- `Error.stackTraceLimit` after a failing assert whose message throws. The constructor sets the limit to 0 and restores it with a plain statement (`assertion_error.ts:279` and `:372`), as Node's does. #45177 wraps that block in try/finally. A small `node:assert` change with the same try/finally and tests is separate from this PR.
- 10 more classes have the same defect: Bun's deep equality compares them by native state and `formatRaw` prints `X {}`, so a failing `assert.deepStrictEqual` on two of them says `Values have same structure`. They are URLSearchParams, Headers and the 8 Temporal classes. Node passes those asserts. #37043 has an arm for Temporal. URLSearchParams and Headers have no PR. URL is the only one that regressed and the only one with a Node text to port.
- Blob, File, Event, CustomEvent, AbortSignal, TextDecoder, PerformanceMark and PerformanceMeasure print `X {}` with `customInspect: false`, so a failed `assert.strictEqual` on two of them says `Values have same structure`. Node prints a diff there only because its classes keep their state in symbol-keyed own properties. #45355 gives Blob, File, Event, AbortSignal and TextDecoder an inspect hook, which `node:assert` does not call.
- bun:test. `expect(urlA).toEqual(urlB)` still prints `URL {}` twice. #7253 is the user report, open since 2023. It is a different printer (Rust, Jest's format). #36645 changes it and has conflicts, and #44268 rewrites that printer.
- A failing assert on a value whose `Symbol.toStringTag` getter throws still throws the getter's error where Node throws the AssertionError (`inspect.js:1298` has no guard).
- The global `console.dir(url)` runs hooks and prints the fields (Node: the href). `console.table` prints a hooked cell on many lines. `new Console(stream).table()` throws for object cells (#33452). Each is a separate change.
- 23 `instanceof URL` argument checks under `src/js` still read `globalThis.URL`. #41117, #40303 and draft #44833 own them.

**Other open PRs on the same lines.**
- `inspect.js`: #45355 has the same `throw err` and the same guard in the `getters` catch (identical hunks). #37043 adds a Temporal arm in the same `else if` chain. #45254 edits `formatError`. #38652 changes how a Proxy prints, and the nested Proxy rows of the new tests only assert that nothing throws.
- `scripts/build/codegen.ts`: #38049 supersedes the hunk here. It lists `js_classes.ts`, `NativeModuleList.h` and `BunBuiltinNames.h` on the same two edges, with a test. The hunk stays so that the new `js_classes.ts` row is safe in a warm build tree without it. #38038, #38063, #43411 and draft #44833 edit the same `inputs:` lines.
- `js_classes.ts`: #33798 appends a row at the same index.
- `custom-inspect.test.js`: #40008, #41281, #45355.

**Reviews.**
- The first push had five changes: the arm in Node's order, the rethrow, and Node's depth in the URL and BroadcastChannel hooks. Two reviewers objected to the `href` read before the class test, and two review comments showed the native formatter rows that the hook change makes longer.
- A second design pass chose the class test first, and a restore of `Error.stackTraceLimit` in the AssertionError constructor. The self-review of that state raised 22 concerns. Its main one: one regression fix with four other changes in one squash. So this PR now has the arm, the rethrow it needs and the build hunk, and the two other changes left it (above). @@SELF_REVIEW@@
- Not applied, because Node v26.3.0 prints the same text: a URL whose `href` reads as `''` prints as the empty string (a test row states it), and after a rethrow below a `getters: true` getter the value that was printing stays in `ctx.seen`.

**Suites.** Debug (ASAN) build: the three test files of this change, `util.test.js` and `node-inspect-tests/parallel/util-inspect.test.js`. @@SUITES@@ All @@NEW_TESTS_N@@ new tests fail on 1.4.3. The expected texts are what Node v26.3.0 prints, except the rows of the departure above. The `URLs` block of Node's `test/parallel/test-assert-deep.js` fails on 1.4.3 and passed with the first push. That file is not vendored because 23 of its other blocks fail on main.

</details>
