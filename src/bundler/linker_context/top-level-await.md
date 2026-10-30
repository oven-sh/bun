# Top-level await in a bundle

Research notes, a design, and the state of the proof of concept on this branch.

The question: `bun build` prints many ES modules into one file. With top-level await (TLA) the order in which the
modules of a graph run is no longer a list, it is a schedule that the module loader works out while promises settle. Can
one file reproduce that schedule exactly as ECMA-262 defines it, what do other bundlers do, and what is impossible?

## Summary

1. **Every scope-hoisting bundler gets this wrong in the same way.** `bun build`, esbuild, Rollup and Rolldown print the
   modules one after the other, so an `await` in one module holds back every module printed after it. On random graphs
   with TLA and no `import()` the four differ on no graph: about half run in the wrong order, 59–77 % differ at the level of
   promise jobs, and about one graph in ten that terminates natively hangs once bundled if modules wait for each other's
   side effects ([Evidence](#evidence)). webpack and Rspack emulate the loader at run time with a function around every
   module and are exact on 87–97 %. Nobody is exact. esbuild's issue about it has been open since 2020, and its author calls
   the current behaviour "obviously incorrect".
2. **Inside the bundle, exact is possible.** Order, promise-job interleaving, import cycles (`[[CycleRoot]]`), errors and
   `import()` can all be reproduced. The scheme below matched V8, JavaScriptCore and a step-by-step transcription of the
   specification, promise job by promise job, on every static graph tried: 6,000 for the final Rust build, and
   those plus about 12,000 more for the prototype while it was developed.
3. **The idea:** `InnerModuleEvaluation`, the depth-first walk that decides which modules are asynchronous, in which
   order they are numbered, who waits for whom and what the cycle roots are, runs to completion before any promise job.
   For the first evaluation of a graph its result depends on the graph alone. So **the linker runs the walk at build
   time** and prints its result. Only `AsyncModuleExecutionFulfilled` / `Rejected` are left for run time, about 0.9 KB
   minified.
   - A module that reaches no TLA through `import` statements is never touched: it stays flat and scope-hoisted, printed
     where the walk leaves it.
   - A module that has or reaches a TLA prints in place as `var init_x = __tlaNode(body, hasTLA, [what it waits for])`.
   - A module that an `import()` inside the bundle can reach may be evaluated later, from an unknown state, so it takes
     the walk at run time (`__tlaModule`, 0.4 KB more).
4. **What exactness costs:** one function per module that reaches a TLA (measured: about 36 bytes minified and 16 µs
   each). Two things make that inherent. A module that waits for some but not all of the running bodies becomes ready at
   a time that is only known at run time. And after a module throws, the specification keeps running the modules that do
   not depend on it, so each needs its own failure domain. A **fail-fast variant** that gives up the second (nothing runs
   after a throw) is exact on every run in which no module throws, and with a single TLA module in the graph it needs
   exactly one wrapper.
5. **What is impossible** for any single-file bundle ([Limits](#limits-what-no-bundle-can-do)): whoever imports the bundle
   sees it settle one promise job late when the entry point itself has no `await` but a dependency has; a throw during the
   walk is reported one job late; external imports are hoisted out of their place; and what the host decides (how long
   `import()` takes) or what user code can patch (`Promise.prototype.then`) cannot be matched. None of it changes the
   order in which the bundled modules run.
6. **On this branch:** the scheme of point 3 in the Rust linker for `--format=esm` without `--splitting`, with tests; a
   fuzzer; and a JavaScript prototype of the parts that are not in Rust yet (flat chains, fail-fast, code
   splitting). See [State of this branch](#state-of-this-branch).

## What the specification does

[Cyclic Module Records](https://tc39.es/ecma262/#sec-cyclic-module-records) evaluate in two stages.

**Stage 1, the walk.** `Evaluate()` calls `InnerModuleEvaluation`, a depth-first walk along `import` statements in source
order, with Tarjan's algorithm woven in to find import cycles. Where the walk _leaves_ a module (all its requested modules
were visited) it does one of three things:

| the module                                       | what happens where the walk leaves it                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| has no `await` and waits for nothing             | it **runs**, synchronously                                                                                           |
| has an `await` (`[[HasTLA]]`), waits for nothing | it **starts**: `ExecuteAsyncModule` runs it up to its first `await`                                                  |
| waits for an asynchronous module                 | it is **parked**: `[[PendingAsyncDependencies]]` > 0, listed in `[[AsyncParentModules]]` of each module it waits for |

The last two kinds get the next `[[AsyncEvaluationOrder]]` number. A module waits for a requested module if that one has
such a number, with two twists for cycles: a requested module that the walk is still inside of is not waited for, and a
requested module in a cycle that the walk has left stands for the whole cycle, so its `[[CycleRoot]]` is waited for
instead.

**Stage 2, the scheduler.** When the body of a started module ends, a promise job runs
`AsyncModuleExecutionFulfilled`. It collects every parked module that now waits for nothing, goes on through the ones
without `await` to _their_ parents (`GatherAvailableAncestors`), sorts the list by `[[AsyncEvaluationOrder]]`, and in that
one job runs the ones without `await` and starts the others. `AsyncModuleExecutionRejected` marks all ancestors as failed
with the same error. Modules that do not depend on the failed one carry on.

`import()` queues a job (after the host has loaded what is missing) that calls `Evaluate()` on the target. That walk meets
modules in every possible state: running, parked, finished, failed.

Consequences that a bundle has to reproduce:

- Siblings overlap. While `a.js` is suspended, the walk goes on to `b.js`.
- `[[HasTLA]]` is syntactic. A module with `if (false) await 0` is asynchronous, and so are all its importers, so they run
  in a later job than a sibling without `await`.
- There is exactly one promise job between the end of a module with `await` and its importers, and none between importers
  that become ready together, however long the chain of them.
- Ready importers run in the order of the walk, not in the order in which they subscribed or their dependencies settled.
- A failure does not stop the rest of the graph.

## What goes wrong today

`bun build` has two shapes for a module, both inherited from esbuild.

_Flat_ (the default): the statements of all modules are concatenated in the order in which the walk leaves them. An `await`
stays an `await` of the one chunk-level async context.

_Wrapped_ (`__esm`, for what `require()` or an `import()` without `--splitting` reaches): `var init_x = __esm(async () => {
await init_dep(); ... })`, with `Promise.all` over several asynchronous dependencies since
[#22704](https://github.com/oven-sh/bun/pull/22704).

| #   | deviation                                                                                                                               | test in `bundler_tla.test.ts`                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Flat: an `await` holds back every later module, related or not.                                                                         | `SyncSiblingRunsWhileAwaiting`                                                                                                 |
| 2   | Flat: a program hangs if a module awaits something that a later sibling provides.                                                       | `LaterSiblingSettlesTheAwait`                                                                                                  |
| 3   | Wrapped: promises are not the scheduler. Each `await init_dep()` costs jobs, and readiness order follows subscription order.            | `ReadyImportersRunInImportOrder`, `ImportersRunInOneJob`                                                                       |
| 4   | Cycles: no `[[CycleRoot]]`. An importer of a cycle member runs before the cycle is done, or waits for a module it is itself holding up. | `ImporterOfCycleMemberWaitsForTheCycle`, `CycleMemberDoesNotWaitForAModuleThatIsBeingEntered`                                  |
| 5   | A module whose `await` is not reached is treated as synchronous.                                                                        | `AwaitThatIsNotReachedStillMakesTheModuleAsync`                                                                                |
| 6   | Errors: everything after the throw is dropped, including modules that had already started.                                              | `IndependentImporterRunsAfterASiblingThrows`, `ThrowDuringTheWalkLeavesStartedModulesRunning`, `RejectionReachesEveryImporter` |
| 7   | `import()` of a bundled module with TLA starts it synchronously, inside the expression.                                                 | `ImportCallStartsAfterTheCallersCode`                                                                                          |

The running example of this document:

```js
// entry.js                       // left.js                      // right.js
import { left } from "./left.js";
import { t } from "./t.js";
import { t } from "./t.js";
import { plain } from "./plain.js";
export const left = "left-" + t;
import { u } from "./u.js";
import { right } from "./right.js";
console.log(left);
export const right = "right-" + t + u;
console.log("entry", left, plain, right);
console.log(right);

// t.js                           // u.js                         // plain.js
console.log("t1");
console.log("u1");
export const plain = "plain";
export const t = await "T";
export const u = await "U";
console.log(plain);
console.log("t2");
console.log("u2");
```

```
unbundled   t1 plain u1 t2 u2 left-T right-TU entry
bun 1.4.4   t1 t2 left-T plain u1 u2 right-TU entry
```

## What the ecosystem does

| tool                                                                     | approach                                                                                                            | what its authors say                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| esbuild                                                                  | flat concatenation; `__esm(async …)` with sequential `await init()` when wrapped                                    | [#253](https://github.com/evanw/esbuild/issues/253), open since 2020: "What esbuild currently does (linearizing all TLA modules) is obviously incorrect." The goal: "an appropriately maximally flattened bundle while still preserving correct TLA semantics."                     |
| Rollup                                                                   | flat concatenation                                                                                                  | [#3356](https://github.com/rollup/rollup/issues/3356), [#5098](https://github.com/rollup/rollup/issues/5098) open. Chunking deadlocks ([#4708](https://github.com/rollup/rollup/issues/4708)) are patched with heuristics ([#6121](https://github.com/rollup/rollup/pull/6121)).    |
| Rolldown                                                                 | flat concatenation                                                                                                  | [docs](https://rolldown.rs/in-depth/tla-in-rolldown): "we will make it work after bundling without preserving 100% semantic as the original code." [#5023](https://github.com/rolldown/rolldown/issues/5023), [#9548](https://github.com/rolldown/rolldown/issues/9548) open.       |
| webpack                                                                  | every module is a function; `__webpack_require__.a` gives a module with TLA a queue that its importers subscribe to | [#12529](https://github.com/webpack/webpack/pull/12529): "No micro-ticks are inserted between parents of async modules when they don't contain an await". Module concatenation bails out: "Module is async". No `[[CycleRoot]]`.                                                    |
| Rspack, Turbopack                                                        | ports of webpack's run-time                                                                                         |                                                                                                                                                                                                                                                                                     |
| Parcel                                                                   | unsupported                                                                                                         | [#4028](https://github.com/parcel-bundler/parcel/issues/4028)                                                                                                                                                                                                                       |
| SystemJS                                                                 | `Promise.all` over dependencies                                                                                     | [#2295](https://github.com/systemjs/systemjs/issues/2295)                                                                                                                                                                                                                           |
| vite-plugin-top-level-await                                              | per chunk `__tla = Promise.all([...]).then(async () => { ... })`                                                    | a compatibility shim, not about order                                                                                                                                                                                                                                               |
| [tla-fuzzer](https://github.com/evanw/tla-fuzzer) `strategy.registry.js` | esbuild's author's experiment: a module registry with counters and callbacks                                        | "The only strategy that I've gotten to work is manually creating a module registry […] But that's too much generated code size and run-time performance overhead for what I'm going for." "joining together modules using promises causes things to evaluate in an incorrect order" |

On the standards side: Module Declarations (which would let a bundle contain real modules) has been at stage 2 without
movement since 2022. `import defer` is at stage 3 and helps with one of the limits below. The algorithm itself is still
being corrected: [ecma262#3357](https://github.com/tc39/ecma262/pull/3357) (hangs),
[#3583](https://github.com/tc39/ecma262/pull/3583) (failed modules have no cycle root),
[#3695](https://github.com/tc39/ecma262/pull/3695) (order of rejections), and
[#3769](https://github.com/tc39/ecma262/pull/3769), still open. WebKit rewrote its loader from the specification text in 2026.

### Why joining promises does not work

The obvious encoding, `await Promise.all(deps.map(init))` at the top of each wrapper, is wrong in four independent ways:

1. **Jobs.** Each `await` and each `Promise.all` costs promise jobs per edge of the graph. The specification goes through
   any number of importers without `await` inside a single job.
2. **Order.** Reactions fire in subscription order, per promise. The specification sorts everything that became ready by
   the order of the walk.
3. **Cycles.** A promise per module has nothing to say about "wait for the cycle, unless you are in it".
4. **Errors.** `Promise.all` rejects early and forgets. The specification marks ancestors synchronously, keeps unrelated
   modules going, and gives later `import()`s the same error object.

## Observations

**1. The first walk is static.** `InnerModuleEvaluation` is synchronous. User code runs during it (whole bodies, or bodies
up to the first `await`), but the fields that steer it (`[[Status]]`, `[[CycleRoot]]`, `[[AsyncEvaluationOrder]]`,
`[[EvaluationError]]`) are only written by the walk itself and by promise jobs, and no promise job runs until it returns.
`import()` in user code only queues. So on a fresh graph the walk is a function of the `import` edges and of which files
contain an `await`. The only thing user code can do to it is throw, which cuts it short. Everything it computes is known to
the linker: the order, who is asynchronous, the numbering, who waits for whom, the cycle roots.

**2. Synchronous modules need no identity.** A module that the first walk runs is finished when the walk leaves it, and
stage 2 never looks at it. Printing its statements at that position _is_ the specified behaviour, including when it throws:
the exception ends the chunk's top level, which is the walk being cut short, and what was started or parked before
carries on.

**3. An async arrow function is `ExecuteAsyncModule`.** `body().then(fulfilled, rejected)` queues exactly the jobs that
the specification's capability, `PerformPromiseThen` and `AsyncBlockStart` queue, at the same positions in the queue, also when the
body ends without suspending.

**4. "Reaches a TLA" is all-or-nothing in a cycle,** so the two kinds of modules never share one, and the files that need
a wrapper are exactly the ancestors of the files with an `await`.

## Design

### Nodes: the walk at build time

The linker marks every file that has or statically reaches a TLA (`mark_tla_nodes`). Once the order of the files in the
chunk is known, which is the order in which the walk leaves them, it computes for each marked file what it waits for
(`compute_tla_plan`):

- requested file in another cycle (or in none): wait for the file of that cycle that the walk leaves last, its root;
- requested file in the same cycle: wait for it if the walk has left it already, else not at all;
- in both cases only if that file is asynchronous.

The running example becomes:

<!-- prettier-ignore -->
```js
// t.js
var t;
var init_t = __tlaNode(async () => {
  console.log("t1");
  t = await "T";
  console.log("t2");
  __tlaDone(init_t);
}, 1, []);

// left.js
var left;
var init_left = __tlaNode(() => {
  left = "left-" + t;
  console.log(left);
}, 0, [init_t]);

// plain.js
var plain = "plain";
console.log(plain);

// u.js
var u;
var init_u = __tlaNode(async () => {
  console.log("u1");
  u = await "U";
  console.log("u2");
  __tlaDone(init_u);
}, 1, []);

// right.js
var right;
var init_right = __tlaNode(() => {
  right = "right-" + t + u;
  console.log(right);
}, 0, [init_t, init_u]);

// entry.js
await __tlaMain([init_left, init_right]);
__tlaResume();
console.log("entry", left, plain, right);
```

The chunk's top level _is_ the walk. `__tlaNode` does what the walk does where it leaves a module: take the next number,
subscribe to what it waits for, and start the body if that is nothing. `plain.js` is untouched. Declarations are hoisted out
of the wrappers the way `__esm` already does it, so bindings between modules stay plain variables.

In a cycle, `__tlaNode(body, hasTLA, deps, 1)` leaves `[[CycleRoot]]` empty, and the root's call passes the members it
closes: `__tlaNode(body, hasTLA, deps, 0, [init_a, init_b])`.

What an `import` statement does besides ordering (run a CommonJS module, call the `__esm` wrapper of a synchronous module,
visit a `__tlaModule`) happens during the walk, not when the importer's body finally runs. So those calls stay flat, at the
position of the `import` statement in the walk, ahead of the importer's `__tlaNode` call.

### Modules that nobody sees run

A wrapper is there so that a module's code runs at the right moment. If nobody can tell when it runs, the module needs none.
It prints as it always did, where the walk leaves it, and each of its importers waits for what it would have waited for.
That changes nothing observable:

- the importer becomes ready in the same promise job, because the specification goes through a ready module without `await`
  to its parents inside one job;
- the order of the other modules among themselves stays, because leaving a number out does not reorder the rest;
- the module cannot throw, and a rejection passes through it synchronously.

The linker has what it takes to find such modules (`RunsUnnoticed` in `tlaPlan.rs`). Every statement of the file has to be
one of these:

1. **A declaration that evaluates nothing:** functions, classes without `extends` or static initializers, arrow functions and
   literals in a `const`, re-exports. This is what the linker hoists out of a wrapper anyway, and it already classifies parts
   this way to order the files of a cycle (`LoadEffect`).
2. **A statement without side effects** (the parser's `can_be_removed_if_unused`, which tree shaking relies on) **that reads,
   where it stands, only bindings that have their final value by then:** `class A extends B {}`, `const table = { a, b }`,
   `const alias = f`. What a function or a method in it reads does not count, because that runs later. A binding has its final
   value if nothing assigns to it after its declaration and, following the import to the file that declares it, that file reaches
   no top-level await, or is itself such a module, or hoists the declaration out of its wrapper.

The second kind is narrower than what the parser calls free of side effects, because "can be removed" is not "can be moved":

- `class A extends B` throws unless `B` is a constructor, and it reads `B.prototype`, which any module can replace at any time
  unless `B` is a class. So `B` has to be declared as a class, ahead of `A`.
- Calls, `new`, property reads, spreads, computed keys and globals are not accepted.

A module in an import cycle keeps its node, because the file that the walk leaves last stands for the whole cycle and the files of
a cycle do not run in the order of their imports.

**Lists.** What a node waits for is printed without what another entry of the list waits for already: `[init_repo]`, not
`[init_db, init_repo]`. Handing on what a module would have waited for copies that list into each importer that prints one. With a
barrel of _k_ modules and _m_ importers that is _k_ × _m_ names. So a module whose list has more than two names, and that more than
one list would get, prints a wrapper with nothing in it behind its statements, and its importers name that:
`var init_barrel = __tlaNode(() => {}, 0, [init_a, init_b, init_c]);`. That keeps the output linear in the number of `import`
statements (1,000 × 1,000: 0.3 MB instead of 11 MB).

**Variables of a file in a cycle.** The other files of a cycle can look at a file's variables before it has run, and a `var` is
`undefined` then. So for a node or a record in a cycle, `var f = function () {}` keeps its value inside the wrapper, where `__esm` hoists
it. The fuzzer found that one once its modules had values to look at. A `const` would throw (limit E), so it is hoisted as before.

### The run-time: stage 2 only

`src/runtime.tla.js`. A record per asynchronous module with the fields of the specification under one-letter names,
and `__tlaExecute`, `__tlaGather`, `__tlaFulfilled`, `__tlaRejected`, each a few lines that follow the specification step
by step. There is no registry, no lookup by name, no graph traversal other than along `[[AsyncParentModules]]`.

### Module records: the walk at run time

A file that an `import()` inside the bundle reaches (without `--splitting` the target is in the same file) can be evaluated
at any time, several times, while parts of its graph are running or have failed. Nothing about that walk is static. Those
files, and what they import, already get wrappers today. The ones that reach a TLA become

```js
var init_x = __tlaModule(
  async () => {
    /* body */
  },
  1,
  () => {
    __tlaVisit(init_dep); // an import of another record
    init_sync(); // an import of a synchronous __esm wrapper
    require_cjs();
  },
);
```

and `__tlaInner` is `InnerModuleEvaluation` over such records, sharing stage 2 with the nodes. `import("./x.js")` prints as
`__tlaImport(init_x, init_referrer, () => exports_x)`, which is `ContinueDynamicImport` for a host that has nothing to
load: one job, then `Evaluate`. An `import` statement in flat code or in a node that names a record prints as
`__tlaTop(init_x)` at its place in the walk, and the node lists the record among what it waits for. Whether it really has
to wait is decided at run time from the record's state.

### Entry points

An entry point that has a TLA, waits for nothing and is imported by nothing is the chunk's own top level, as today. This is
by far the most common use of TLA and its output does not change.

Any other entry point waits, directly or not, for every asynchronous module of its chunk. So it always runs last, in the job
in which the last body ends. That makes it possible to leave it unwrapped on the chunk's top level ("the main thread") without
losing a single job:

- Every body with `await` ends with `__tlaDone(init_x)`, which counts down the bodies that have not ended.
- The main thread parks on `await __tlaMain([what the entry point waits for])`, a promise that the last `__tlaDone` resolves.
  That queues the main thread's continuation immediately _before_ the job that the end of that body queues for
  `AsyncModuleExecutionFulfilled`, with nothing in between.
- The continuation calls `__tlaResume()`, which makes the call to `__tlaFulfilled(last)` itself. That runs every node that
  became ready. Then control falls through into the code of the entry point. The job that was overtaken finds the module
  done and returns.

So the continuation takes the queue position of the job it replaces. (Resolving the promise from _inside_ that job is one job
late. That was the first attempt, and the fuzzer caught it.)

There are three conditions, all found by fuzzing. Nothing imports the entry point. No file of the graph is a record (above),
because a record can get importers later that are numbered after the entry point. And some body is certain to suspend: if every
body could end during the walk, the last `__tlaDone` would come before the main thread has parked, and the continuation would
be queued behind jobs that synchronous modules queued in between. The linker takes as proof an `await` in a top-level
statement that is evaluated whatever happens: not in a branch, on the right of `&&`, in an optional call or in a `try`. Otherwise the entry point is a node or a record like any other module, and the
chunk ends with `await __tlaWait(init_entry)` or `await __tlaEvaluate(init_entry)`. Either way its exports are the hoisted
variables.

### Flat chains (prototype only)

A chain `… → c → b → entry` in which each module waits for the previous one, for nothing that the previous one does not
also wait for, with no synchronous module left to run after the head, can stay on the main thread too. A body with `await` that
is inlined this way is followed by `await 0`, the job that the specification puts between it and its importer. When the whole
asynchronous part of a graph is such a chain (`entry → config-with-await`, say) the output is today's flat output plus that
`await 0`, with no run-time at all. The exact conditions are in `test/bundler/tla-fuzz/plan-linker.mjs`.

### Fail-fast (prototype only, not exact)

Wrappers around modules _without_ `await` exist for two reasons: the module may become ready before all bodies have ended,
or a module before it in the same job may throw, after which it still has to run. For a module that waits for _all_
bodies with `await`, and whose importers do too, only the second reason applies. Giving it up ("after a throw, nothing else runs")
lets those modules stay flat on the main thread, with `__upto(node)` calls in between to run the nodes whose number lies
between two flat modules.

- No module throws: exact, promise job by promise job.
- A module throws: the trace is a subsequence of the native one, and the bundle rejects with the same error.

With one TLA module in the graph this needs one wrapper. With several that overlap, the modules that wait for only some
of them still need theirs ([Cost](#cost)).

### Code splitting (prototype only)

With `--splitting` the engine's loader orders the _chunks_, but a chunk is a set of modules that share entry points, not
a unit of evaluation. A chunk with an `await` at its top level holds back every chunk that imports it. The same records work
across files under two rules (the fuzzer found the second):

1. **A chunk only defines.** Records, hoisted declarations, no `await` and no evaluation of a record at the top level.
   Loading a chunk then never blocks and never fails.
2. **The file that awaits is imported by nothing.** Each entry point is a facade that ends with
   `await __tlaEvaluate(init_entry)`. If another chunk needs a binding of the entry module, the module lives in a chunk of its
   own. Otherwise an `import()` of a chunk that imports the facade waits for, or fails with, the entry point, which is how
   splitting turns into deadlocks today ([#31769](https://github.com/oven-sh/bun/issues/31769), Rollup #4708).

`import("./x.js")` becomes `import("./chunk.js").then(c => __tlaEvaluate(c.init_x)).then(() => c.exports_x)`. The prototype
cuts its single-file output into the chunks that splitting would make (one entry point plus the `import()` targets), and
stays at 100 % on the graphs whose outcome does not depend on how long the host takes to load a file
([Evidence](#evidence)).

Not tried: several entry points in one realm. By construction, files that only one entry point reaches can still be nodes,
because they are fresh when that entry point's walk starts, and what they import from shared chunks is checked at run time
like any record. What stays is the known, TLA-independent problem that
_synchronous_ modules in a shared chunk run when the chunk loads, ahead of their place
([#44495](https://github.com/oven-sh/bun/pull/44495), [#44028](https://github.com/oven-sh/bun/pull/44028)). A synchronous module that a record imports needs an `__esm`
wrapper, as without splitting.

### Alternatives that were considered

- **Promises between wrappers.** See [above](#why-joining-promises-does-not-work).
- **The whole loader at run time:** every module a function, `Evaluate` and all in the bundle (`spec-model.mjs` is exactly
  that, and webpack approximates it). Exact, but it gives up scope hoisting for the entire bundle, including the usual case
  in which most modules reach no TLA, and it does at run time what is known at build time.
- **Real modules from one file:** `import "data:text/javascript,…"` or `blob:` URLs. The engine's own loader would do the
  work, but a `data:` URL contains the URLs of what it imports, so cycles cannot be written and the size grows
  exponentially with the depth of the graph. `blob:` URLs have the same problem with cycles and exist only in browsers. Neither can be scope-hoisted.
- **Start each body with `await` as an async function and `await` its promise later, with no run-time:**
  `var p = (async () => { … })(); …; await p;`. This is the special case of nodes with one TLA module. It is exact if that
  body is certain to suspend and nothing throws. With two or more bodies it is a promise join again.
- **Module Declarations / Module Expressions** would make the problem go away. They are not moving.

## Limits: what no bundle can do

"Exact" above means: every observable step of every bundled module happens in the same promise job, in the same order, as
unbundled. The following cannot be had by any scheme that produces one ES module.

**A. An entry point without `await` that waits for a dependency settles one job late for its importer.** Unbundled, the
job that finishes the last dependency runs the entry point _and_ goes on to the importer of the entry point (or resolves the
promise of the `import()`) in the same job. The bundle has to suspend to wait, so it is a module with `[[HasTLA]]`, and the
specification puts a job between the end of such a module's body and its parents. A job that the entry point's last statement
queues therefore overtakes the importer. Measured: +1 job with a flat entry point, 0 when the entry point has an `await` of
its own, +2 when it has to be a node.

**B. A throw during the walk is reported one job late** if the bundle contains an `await`, for the same reason: unbundled,
`Evaluate()` rejects its promise synchronously.

**C. External imports leave their place.** `import "pkg"` in a bundled module has to become an `import` statement of
the bundle, which evaluates before all bundled code, and if `pkg` is asynchronous the whole bundle waits for it rather than the
modules that import it. `await import("pkg")` inside a node is not a substitute: it makes a synchronous importer
asynchronous and moves load errors from link time to run time. `import defer` would fix the position for synchronous
externals (touch the namespace where the walk reaches it), but the proposal evaluates asynchronous dependencies eagerly.

**D. A flat module cannot outlive a throw.** The reason for the wrappers, see [Fail-fast](#fail-fast-prototype-only-not-exact).
A `try` block per module instead of a function would do for modules on the main thread, but it needs the same hoisting of
declarations and saves nothing in size.

**E. What the host or user code controls.** How many jobs `import()` takes (Node and Bun differ by one). Temporal dead zones of
hoisted `let`/`const`/`class`, as in every scope-hoisted bundle. Patched `Promise.prototype.then` or `Promise[Symbol.species]`, which the loader never
consults and a run-time in JavaScript does.

**F. Where the host deviates from the specification on purpose.** Bun's loader does not let the graph of an `import()` wait
for the module that contains the `import()` expression, nor for a module whose pending promise chain leads to it
([#41029](https://github.com/oven-sh/bun/issues/41029)). Node deadlocks on such programs, as specified. The run-time mirrors the first, lexical
rule (`__tlaReferrerOrder`), because an existing test expects a bundle to behave like `bun run` there. The second walks
promise reactions inside the engine and cannot be written in JavaScript.

## Evidence

### Method

`test/bundler/tla-fuzz/`. A seeded generator makes graphs of 2–9 modules in which 15–70 % of the modules have a TLA, far
denser than real code: the percentages below say how much of the semantics a tool implements, not how many real
programs break. Each module logs every step together with the values it sees in its imports. A ticker logs every
promise job, and modules queue probes that log from later jobs, so two traces are equal only if every step happened in the same
job. Sleeps use a virtual clock that fires one timer per macrotask. Every variant runs in a fresh process under Node 24, the reference is the
unbundled graph.

The reference itself is checked three ways: V8 (Node 24.20), JavaScriptCore (Bun 1.4.4) and `spec-model.mjs`, a
transcription of the specification's algorithms, agree on all static graphs except for one bug in Bun's loader
([Side findings](#side-findings)).

Columns: _order_ = the steps are in the same order and the program settles the same way; _exact_ = also in the same promise
jobs; _hangs_ = the bundle never settles although the program does.

### Static graphs

1,000 graphs per profile, _order_ / _exact_ in percent. The profiles are described in `test/bundler/tla-fuzz/README.md`.

|                                                               | `dag`       | `cyc`       | `err`                  | `err2`                 | `time`                 | `sig`                 |
| ------------------------------------------------------------- | ----------- | ----------- | ---------------------- | ---------------------- | ---------------------- | --------------------- |
| Bun 1.4.4, esbuild 0.28.2, Rollup 4.64.6, Rolldown 1.2.14 (1) | 49.9 / 22.8 | 52.2 / 23.7 | 56.0 / 35.0            | 49.9 / 34.2            | 51.2 / 36.8            | 52.5 / 41.2, 94 hangs |
| webpack 5.111.1, Rspack 2.2.9 (1)                             | 98.6 / 97.4 | 98.8 / 96.7 | 91.1 / 89.6            | 88.3 / 87.2            | 95.9 / 94.9            | 95.6 / 94.5, 23 hangs |
| tla-fuzzer's registry                                         | 99.5 / 99.5 | 99.0 / 98.9 | 74.3 / 74.3, 246 hangs | 44.3 / 44.3, 550 hangs | 81.0 / 81.0, 183 hangs | 95.3 / 95.3, 43 hangs |
| **this branch**                                               | 100 / 100   | 100 / 100   | 100 / 100              | 100 / 100              | 100 / 100              | 100 / 100             |
| prototype, exact                                              | 100 / 100   | 100 / 100   | 100 / 100              | 100 / 100              | 100 / 100              | 100 / 100             |
| prototype, fail-fast                                          | 100 / 100   | 100 / 100   | 98.6 / 98.6            | 99.5 / 99.5            | 98.6 / 98.6            | 99.7 / 99.7           |
| `spec-model.mjs`                                              | 100 / 100   | 100 / 100   | 100 / 100              | 100 / 100              | 100 / 100              | 100 / 100             |
| Bun 1.4.4, unbundled (2)                                      | 100 / 100   | 100 / 100   | 99.8 / 99.8            | 99.7 / 99.7            | 99.7 / 99.7            | 99.9 / 99.9           |

(1) The tools in one row differ on no graph. (2) [Side findings](#side-findings), 1.

Two more profiles came with the [modules that nobody sees run](#modules-that-nobody-sees-run), 2,000 graphs each. In `inert`
almost half of the modules only declare things. In `pure` modules also make objects and classes out of what they import, and their
importers log what those hold, which shows a statement that ran too early. The other bundlers were not measured on these.

|                  | `inert`     | `pure`      |
| ---------------- | ----------- | ----------- |
| Bun 1.4.4        | 75.3 / 49.8 | 72.3 / 46.5 |
| **this branch**  | 100 / 100   | 100 / 100   |
| prototype, exact | 100 / 100   | 100 / 100   |

A build that prints the wrapper with nothing in it for every such module is also at 100 / 100 on 1,500 graphs of each.

Every graph on which fail-fast differs is one in which a module throws. Checked on 10,000 graphs during development: the
trace was always a subsequence of the native one, with the same error.

**test262**, `language/module-code/top-level-await` (the 31 tests that are modules and not negative, `test262.mjs`): bundles
of Bun 1.4.4 pass 29, bundles of this branch 30. The remaining one expects a `ReferenceError` from a binding in its temporal
dead zone (limit E). Node 24.20 passes 30 unbundled: it fails `rejection-order.js`, which tests ecma262#3695.

### `import()`

1,000 graphs of the profile `dyn`. How long `import()` takes differs between hosts, and on a quarter of the graphs that
changes the outcome. The table is over the 754 on which Node, Bun and the model agree: percent of graphs with the same steps,
seeing the same values, in the same order.

| one file                                 |      |          | with code splitting                         |      |         |
| ---------------------------------------- | ---- | -------- | ------------------------------------------- | ---- | ------- |
| Bun 1.4.4                                | 58.0 |          | Bun (`--splitting`, unchanged by this work) | 54.5 | 3 hangs |
| esbuild                                  | 56.8 | 11 hangs | esbuild                                     | 50.4 | 3 hangs |
| Rollup (`inlineDynamicImports`)          | 39.6 |          | Rollup                                      | 58.5 | 3 hangs |
| Rolldown                                 | 56.6 | 11 hangs |                                             |      |         |
| webpack                                  | 91.1 | 4 hangs  |                                             |      |         |
| Rspack                                   | 92.3 | 4 hangs  |                                             |      |         |
| **this branch**                          | 98.8 |          |                                             |      |         |
| prototype                                | 99.9 |          | prototype                                   | 99.3 |         |
| prototype, every wrapped module a record | 100  |          | prototype, every wrapped module a record    | 100  |         |

This branch differs on nine graphs. In eight, an `import()` of a module that reaches no TLA settles a job early. In one (147), a
cycle of such modules throws. Both are in the list of [known gaps](#state-of-this-branch).

`puredyn` is `pure` with `import()`: 99.0 % of the 837 comparable graphs of 1,000 (Bun 1.4.4: 64.4 %, the prototype with records for
every wrapped module: 100 %). The misses are the same two gaps, and one graph (480) in which a file of a cycle of `__esm` wrappers
sees a value that `__esm` hoisted.

### When the importer sees the bundle settle

How many promise jobs later than unbundled the file that `import()`s the program sees it settle (limit A). Runs that
fulfill, number of graphs.

| the entry point                 | this branch, `dag` | this branch, `cyc` | prototype, `dag` | webpack, `dag` |
| ------------------------------- | ------------------ | ------------------ | ---------------- | -------------- |
| reaches no TLA                  | 0: 164             | 0: 159             | 0: 164           | 0: 164         |
| has the only TLA it reaches     | 0: 64              | 0: 63, +2: 15      | 0: 64            | +1: 64         |
| has a TLA and waits for others  | 0: 335, +2: 6      | 0: 267, +2: 74     | 0: 340, +2: 1    | 0: 9, +1: 332  |
| has no TLA and waits for others | +1: 426, +2: 5     | +1: 341, +2: 81    | +1: 429, +2: 2   | +1: 8, +2: 423 |

0 and +1 are the minimum. +2 is an entry point that had to be wrapped: no body is certain to suspend, or, in `cyc`, something
imports the entry point. With flat concatenation the number is anywhere from −3 to +16, because the order is different.

## Cost

**Run-time** (minified / gzip): 0.9 KB / 0.55 KB when there are only nodes, 1.2 KB / 0.65 KB with records. Nothing when
no file but the entry point has a TLA.

**Per wrapper.** 2000 modules of about 140 bytes each, all of which reach one `await` in the last one:

|                  | Bun 1.4.4 (flat) | this branch (1,999 wrappers) | per module |
| ---------------- | ---------------- | ---------------------------- | ---------- |
| minified         | 276 KB           | 349 KB                       | 36 B       |
| minified + gzip  | 49 KB            | 75 KB                        | 13 B       |
| evaluation, Node | 71 ms            | 102 ms                       | 15 µs      |
| evaluation, Bun  | 67 ms            | 102 ms                       | 18 µs      |
| unbundled, Bun   | 201 ms           |                              |            |

The cost is linear in the number of modules (measured at 1,000, 2,000 and 4,000). My reading is that most of the time is the
engines compiling that many functions lazily instead of one top level eagerly, but I did not profile it. (This graph happens to
be a chain, so with the flat chains of the prototype it would need no wrapper at all.)

**How many wrappers.** Layered random graphs of 300 modules, average of 40:

| modules with TLA, and where | reach a TLA | wrappers, exact | wrappers, fail-fast |
| --------------------------- | ----------- | --------------- | ------------------- |
| 1, near the entry point     | 5.5         | 4.4             | 1.0                 |
| 1, anywhere                 | 88.8        | 87.8            | 1.0                 |
| 1, deep                     | 193.5       | 192.4           | 1.0                 |
| 2, anywhere                 | 125.7       | 124.7           | 81.9                |
| 2, deep                     | 213.4       | 212.4           | 47.9                |
| 4, anywhere                 | 173.9       | 172.9           | 152.0               |
| 4, deep                     | 236.4       | 235.4           | 90.9                |

The random graphs above have no module that nobody sees run. Real code has many. rxjs 7.8.1 (`dist/esm`, everything exported,
`"sideEffects"` switched off), with an `await` added to `internal/util/isFunction.js`, which 190 of the 228 files reach:

|                                                      | wrappers | bytes   | minified |
| ---------------------------------------------------- | -------- | ------- | -------- |
| Bun 1.4.4 (flat)                                     | 0        | 167,225 | 64,839   |
| a node for every file that reaches the `await`       | 189      | 192,858 |          |
| none for files that only declare                     | 34       | 175,462 | 67,043   |
| none for files whose statements have no side effects | 21       | 173,348 |          |
| and short lists                                      | 21       | 173,020 | 66,529   |

The run-time is about 900 of the 1,690 bytes that are left. Of the 20 wrappers without an `await`, 15 have a statement that
really runs code (`new AsapScheduler(…)`, an enum, `Observable.create = …`) and 5 only hold a class whose base class is declared in
one of those 15 files. [Decisions and next steps](#decisions-and-next-steps) has what it would take to drop the 5.

## State of this branch

**In the Rust linker** (`tlaPlan.rs` and the places it hooks into, `src/runtime.tla.js`, `src/js_printer/lib.rs`): nodes,
none for modules that nobody sees run, records, `import()`, flat entry points, CommonJS and `export *` interplay, minification, for `--format=esm` without
`--splitting`.

**What counts as a TLA.** `[[HasTLA]]` is about the source text, but a bundle is made from what `--define` and dead code
elimination leave. `if (process.env.NODE_ENV === "development") await …` in a production build must not turn the bundle
asynchronous, so the parser now reports a TLA to the bundler only if the visit pass met an `await`, `for await` or
`await using` outside of functions and of dead code.

**Falls back to the old output:**

- `--splitting`, the dev server, and formats other than ESM (where TLA is an error anyway);
- a graph in which a file that reaches a TLA is bundled as CommonJS. The old output for that is not valid JavaScript either
  (`await` in a `__commonJS` function, see [#46749](https://github.com/oven-sh/bun/pull/46749)). As far as I can tell this is now
  the only way to reach `__esm(async …)` and `__promiseAll`, so they can go once that case is an error.

**Known gaps:**

- No flat chains: `entry → dependency-with-await` pays for a wrapper and the run-time although plain flat output with one
  `await 0` would do.
- The marking runs before tree shaking. If a file with a TLA is dropped as unused (`"sideEffects": false`), it is neither
  printed nor run, but its importers keep their wrappers. They run synchronously in place, so the order is right, but the
  output is larger than it has to be and the chunk has an `await` that it does not need. The proof that some body suspends
  can also rest on such a file, and then the flat entry point can run behind promise jobs that it should run ahead of.
- The shape of a file (node, record, flat entry point) is decided once per build. Without splitting a file can be printed into
  the chunks of several entry points, and then one entry point's needs leak into the others as dead weight: `__tlaDone`
  calls in a chunk whose entry point is wrapped, an entry point that is wrapped in its own chunk because another entry point
  imports it, no flat entry point anywhere once some file is a record.
- `import()` of a wrapped module that reaches _no_ TLA still prints as before (`Promise.resolve().then(() => init_x())`),
  which settles a job earlier than any host could, and synchronous `__esm` wrappers in a cycle do not mark the members that have
  already run as failed when a later one throws. In such a cycle a file can also see `var f = function () {}` of a file that has not
  run. All three predate this work and account for all remaining differences in the `import()` tables.
- With `--target=bun`, `using` is not lowered and stays inside the wrapper, so a `using` binding that is itself exported is not
  visible to importers. `__esm` has the same limitation, but more files get a wrapper now.
- `await using` is lowered to helpers that take a different number of jobs than the native statement. Unrelated, but
  visible in traces.
- The shape (`TlaShape`) sits next to `wrap`. Variants of `WrapKind` would make every `match` on it decide what to do with
  them. Two of the bugs that review found were places that only looked at `wrap`.
- A record (`__tlaModule`) that nobody sees run still prints.
- Short lists and the count of lists that would get a copy use bit sets that take the square of the number of files that reach a
  TLA. A chunk with more than 4,096 of them goes without: longer lists, more wrappers with nothing in them, same behavior
  (checked by hand on 5,002 files, no test).

**Fixed on the way,** because more files get a wrapper now: a lowered top-level `using` left the file's exports as `var`s inside
the wrapper function (`ReferenceError` in importers, also with `__esm` in 1.4.4), and `export * from "external"` in a wrapped
entry point was printed inside the wrapper function.

**Tests:** `test/bundler/bundler_tla.test.ts` (each program bundled as it is, and again behind an `import()` so that every
module is a record; expectations are what Node prints unbundled) plus a few fuzzer seeds. Of its 56 tests, 43 fail with
Bun 1.4.4. Existing tests that changed:

- `default/TopLevelAwaitAllowedImportWithoutSplitting` expected `0 1`. Node and Bun print `1 0` for the unbundled files, and
  so does the bundle now.
- Two tests in `bundler_promiseall_deadcode.test.ts` and `regression/issue/cyclic-imports-async-bundler.test.js` pinned
  `__esm(async …)` and `__promiseAll` in the output. They pin the records now. What the programs print is unchanged.
- `dynamic_import_dce/ElideTopLevelAwaitInImportee` and `edgecase/UsingWithHoistableInitializerKeepsWrapper` matched the text of
  the `import()` lowering.

The rest of `test/bundler` passes, apart from tests that cannot run on the machine this was developed on (packages missing from
its registry mirror, a C compiler that links against another libc, time limits with a debug build).

## Side findings

1. **Bun's loader drops the continuation of a running module when the walk is cut short inside its cycle.** A module with a
   TLA is in a cycle with the entry point, it has started, and then a sibling throws synchronously. `Evaluate()` marks
   everything on the stack as failed, the running module included. Node and the specification still let its body run to
   the end. In Bun's JavaScriptCore a record that gets an error gives up its executable, and `JSModuleRecord::evaluate` throws the
   stored error instead of resuming, so the rest of the body never runs.
   `node fuzz.mjs --profile=err2 --from=116 --count=1 --variants=node,bun,spec --keep` (also `time` 303, `sig` 303, `err2`
   620 and 888).
2. **Bun evaluates a CommonJS module that an ES module imports earlier than Node does** (at link time rather than in the
   walk). Seen in `tla/CommonJSImportsKeepTheirPlace`, whose expectation is Node's.
3. webpack and Rspack: a module whose `await` is not reached counts as synchronous; a rejection can reach the entry point
   late (up to 24 jobs in `err2`); importers of a cycle member do not wait for the cycle (`cyc` 258, `time` 371).
4. The registry of tla-fuzzer has no error path at all (a rejected body leaves the graph pending) and hangs on about a quarter of the
   graphs with errors.
5. The specification does not say what `GatherAvailableAncestors` does with a parent whose `[[CycleRoot]]` is empty
   (ecma262#3769). V8 and JavaScriptCore skip it, and so does the run-time.

## Decisions and next steps

1. **Exact or fail-fast by default?** Exact is what the user sees unbundled, at one function per module that reaches a
   TLA. Fail-fast differs only in what a failing program does after the failure, and keeps the output close to
   today's when one module has a TLA. A process whose entry point rejects exits anyway; a browser page does not. Exact by default, fail-fast as an
   optimization to opt into, is the conservative order.
2. **Hoist statement by statement.** `RunsUnnoticed` decides for whole files. A file with one statement that has to wait
   (`Observable.create = …`) keeps all its statements in the wrapper, so `class Subject extends Observable` in another file
   has to wait as well. Hoisting the statements that nobody sees run out of a wrapper that stays, in source order, would leave
   only code that does something inside wrappers. In the rxjs bundle that is 16 wrappers instead of 21.
3. **Port the flat chains** (the chain rule in `plan-linker.mjs`). It removes the run-time from the simplest graphs, and modules that nobody sees run do not break a chain. The
   decision has to be made in `mark_tla_nodes`, before wrappers and tree shaking, so it needs the order of the walk there.
4. **Mark after a liveness pass**, so that a TLA that tree shaking removes leaves no trace.
5. **Code splitting** with the two rules above. It replaces the chunk-level `await`s that cause the splitting
   deadlocks.
6. **Records for all wrapped ES modules** in a bundle that has any, to close the two `__esm` gaps above (the prototype's
   `planall` is 100 % on the `import()` graphs).
7. With nodes, the only `await` outside a function is the one that waits for the entry point. `--format=cjs` and `iife` could
   therefore support TLA in dependencies by exporting or ignoring that promise.
8. Bun's loader bug above.

## References

- ECMA-262, [Cyclic Module Records](https://tc39.es/ecma262/#sec-cyclic-module-records),
  [`ContinueDynamicImport`](https://tc39.es/ecma262/#sec-ContinueDynamicImport)
- [proposal-top-level-await](https://github.com/tc39/proposal-top-level-await), in particular #64 (scope hoisting), #158, #159, #161
- esbuild [#253](https://github.com/evanw/esbuild/issues/253), [tla-fuzzer](https://github.com/evanw/tla-fuzzer)
- webpack `lib/runtime/AsyncModuleRuntimeModule.js`, [#12529](https://github.com/webpack/webpack/pull/12529)
- Rolldown, [TLA in Rolldown](https://rolldown.rs/in-depth/tla-in-rolldown), [#9575](https://github.com/rolldown/rolldown/pull/9575)
- Bun: [#22704](https://github.com/oven-sh/bun/pull/22704), [#33337](https://github.com/oven-sh/bun/pull/33337),
  [#41601](https://github.com/oven-sh/bun/pull/41601), [#45949](https://github.com/oven-sh/bun/pull/45949),
  [#42046](https://github.com/oven-sh/bun/pull/42046), [#42105](https://github.com/oven-sh/bun/pull/42105),
  [#41029](https://github.com/oven-sh/bun/issues/41029), [#45262](https://github.com/oven-sh/bun/issues/45262)
