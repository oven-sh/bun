# Working on `bun build --compile --aot`

This is the guide for people (and agents) who change the ahead-of-time compiler. It says how to build, test, measure and compare, which design rules are settled, and what has already been tried.
How the compiler works is explained in [`docs/bundler/aot-internals.mdx`](../../docs/bundler/aot-internals.mdx). Read that first.

## Where things are

The compiler lives in two repositories, and they are one product: change whichever side is the right place for the change.

| Part                                                                      | Where                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Front end: resolve, parse, check types, lower to IR, link                 | `src/aot`, `src/sema` (the type checker), `src/bundler/aot`                                            |
| What an executable holds, trimming                                        | `src/exe_format`, `src/standalone_graph`, `src/trim`, `scripts/build/trim`                             |
| Bun's own modules, which are compiled too                                 | `src/js`, `src/builtin_sources`                                                                        |
| The host's side of compiled programs                                      | `src/jsc/bindings/BunCompiled*`, `src/resolver/compiled_program.rs`                                    |
| Engine: IR, flow analysis, passes, code generation, stubs, image, runtime | `Source/JavaScriptCore/aot` in oven-sh/WebKit (`vendor/WebKit`, or `$BUN_WEBKIT_PATH`)                 |
| B3 and Air, the back end                                                  | `Source/JavaScriptCore/b3` in oven-sh/WebKit                                                           |
| Tests                                                                     | `test/aot` here ([`README.md`](../../test/aot/README.md)), `aot/tests` in the engine (its `README.md`) |

The IR's schema (`aot/ir/schema/*.def` in the engine) is the contract between the two halves. Both sides generate their readers and writers from it. Nothing that is generated is checked in.

## Build

```sh
bun bd                                                  # debug build of Bun with the prebuilt engine
bun run build:release                                   # release build
BUN_WEBKIT_PATH=<WebKit> bun scripts/build.ts --profile=release-local                    # Bun with your engine
BUN_WEBKIT_PATH=<WebKit> bun scripts/build.ts --profile=release-local --target=testaot   # the engine's test program alone
BUN_WEBKIT_PATH=<WebKit> bun scripts/build.ts --profile=release-local --target=jsc       # the shell
```

An engine change reaches Bun's CI through a prebuilt engine: push the WebKit branch, wait for its preview release, then point `scripts/build/deps/webkit.ts` at it.

## The fast loop

Pick the smallest loop that can show your change.

| You changed                                                | Loop                                                                                                                                                                                                                                           | Time                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| A pass, an analysis, code generation                       | build `testaot`, then `testaot <folder or file of aot/tests>`                                                                                                                                                                                  | seconds after the build |
| Lowering in `src/aot`                                      | `cargo test -p bun_aot --test ir_tests` (`test/aot/ir`)                                                                                                                                                                                        | a minute                |
| Anything, and you want whole programs without building Bun | `JSC=.. FRONT_END=.. TESTAOT=.. PLAIN=.. test/aot/shell/quick.py <programs>`                                                                                                                                                                   | seconds a program       |
| Anything                                                   | `bun bd test test/aot/<file>`, `AOT_PROGRAMS=<name> bun bd test test/aot/<folder file>`                                                                                                                                                        |                         |
| Text only (names, lists, switch statements)                | `bun test test/aot/plain-english.test.ts test/aot/test-files-self-skip.test.ts test/aot/a-switch-of-the-compiler-names-every-enumerator.test.ts` with any Bun; `AOT_ENGINE_DIRECTORY=<WebKit>/Source/JavaScriptCore/aot` for the engine's text | ten seconds             |

Look at what the compiler did:

```sh
bun build --compile --aot app.ts --explain                       # what costs time in this program, and why
bun build --compile --aot app.ts --aot-out=app.ir                # the IR as the front end hands it over
testaot print app.ir --until=<pass> --function=f12               # the IR behind a pass (testaot list passes)
BUN_JSC_aotMapFilePath=app.map bun build --compile --aot app.ts  # every function and stub, with offsets
bun test/aot/tools/bisect.ts app.ts                              # which optimization makes a wrong answer
```

Before you push: `bun fmt --plugin=prettier-plugin-organize-imports` with a canary Bun (what CI's Format job runs; another Prettier formats a few things differently), `cargo fmt --all`, `bun run fmt:cpp`, and `bun test test/internal/source-lints`. The lints read only files that git tracks, so `git add` new files first.

## Test

[`test/aot/README.md`](../../test/aot/README.md) lists every group of tests, what CI runs, and where a new test goes. The short form:

- **A fix brings its test.** The smallest program that showed the problem goes to `test/aot/programs/<topic>/`, with a line in `test/aot/programs-in-every-run.txt`. Without that line one commit in ten runs it.
- **The oracle is plain Bun.** A program must print under `--aot` what `bun run` prints, with its types and with its types erased.
- **A test is worth what it does without the fix.** Run it on the old binary once.
- **One case per program** where a case can change what the compiler knows: one line that gives a type up turns every other case in the file green.
- A test says what the program does. It does not tell the story of how somebody found it.
- The checking builds find what answers do not show: `--aot-validate`, `--aot-check=ClaimsToBackEnd`, `test/aot/shell/collector-stress.py`, `heat.py`, an ASAN build. A change to code generation or to what the collector sees wants all of them.
- The fuzzers are in `test/aot/fuzz` (`farm.py` runs them without end). A seed that found something goes to `fuzzer-seeds-that-found-faults.test.ts`.

## Measure

[`test/aot/perf/README.md`](../../test/aot/perf/README.md): one command compares two builds by instruction counts, and the page lists the traps.

```sh
bun test/aot/perf/compare-builds.ts --before <bun> --after <bun>
```

The bars, in this order:

1. Nothing gets slower or larger. Instruction counts may not rise, and a row over +2% needs a fix or a revert.
2. Compiled code beats the same binary's JIT, on everything. A row that loses is a bug with a name (`test/aot/perf/behind-the-jit.*.json`).
3. Then Go and Rust: `test/aot/servers/go`, `test/aot/servers/rust` are the same servers.
4. Plain Bun pays nothing for any of this: not in speed, not in memory, not in behavior (`test/aot/perf/plain-bun-costs.test.ts`).

Judge by real programs of several kinds (a command-line application that starts often, servers, a long computation), and by the worst of them.

## Compare output

A refactoring of the compiler must not change what it generates:

```sh
bun test/aot/tools/same-output.ts --before <bun> --after <bun> [<program or folder>..]
```

It builds each program with both Buns and compares the IR that the front end hands over and the machine code of every function. It prints `IDENTICAL`, or the programs and functions that differ. Without
programs it takes the 260 small benchmarks, in a minute. Give it large programs too: a server with its packages, the type checker of the `typescript` package.

Identical output shows that nothing moved **on those programs**. It is no evidence that a change is sound: deleting the "I don't know" arm of an analysis that no test program reaches leaves all output identical, and
miscompiles the next user's program.

## Design rules

These are settled. Each was argued, and most were learned by building the opposite first.

**What users are promised**

- **Normal TypeScript works.** A program that runs under plain Bun runs the same under `--aot`. Types make it faster; a value that does not fit its type never throws at run time. New errors appear only at compile time.
  The one exception is the locked built-ins (`docs/bundler/aot-compatibility.mdx`).
- **ECMAScript-exact.** An inference never decides what a program means. It only decides how fast the program gets there.
- **The fallback is per value, not per program.** One `any` slows down the code that touches it, and nothing else. A line that undoes a whole benchmark is a cliff, and cliffs are bugs.
- **The interpreter is never a fallback** for code that was there at build time. If reachable code is not compiled, that is a bug. Only code that the program builds from strings while it runs (`eval`, `new Function`) is interpreted, and there is no JIT in an executable, not even for that.
- **`--aot` works on every platform.**
- **Untyped JavaScript has to be fast too.** Most of `node_modules` is untyped.

**How the compiler is built**

- **One producer of types: the checker.** Two engines that answer the same question about the same value will disagree, and a disagreement is a slow program or a wrong one.
- **Types are facts about what the program makes, and predictions about what it receives.** A prediction is tested; a fact is not.
- **Decide by binding, never by an identifier's text.** No `name.contains("require")`. `x["foo"]` is `x.foo`.
- **A compiled object keeps its shape for life.** Everything proven about a layout rests on that. "It turns into an ordinary object when something odd happens" was designed twice and failed by measurement twice.
- **B3 owns scalar optimizations.** Do not write value numbering, hoisting or dead-code removal over loads and arithmetic in the IR: tell B3 the truth about effects and let it work. B3 sees branches and loads; it does not see into patchpoints.
- **Flow summaries are relational** and are applied at the call site.
- **No profile.** One form of code that is compact and fast everywhere. No training run, no order file.
- **No modes by program size**, as far as that can be had: what is fast in a small program must be fast in a large one.
- **An option is on by default or deleted.** No always-on options, no knobs kept "for safety".
- **No run-time safety net for compiler bugs.** Fix the bug, at no cost in speed. Checks belong in the checking builds.
- **The table of built-ins is data**, generated from `*.builtins.ts`. Type predicates (`Array.isArray`, `typeof`) always fold. `Math` functions are intrinsics.
- **CommonJS is just a function.** A module of the image runs at most once; cycles must work.

**What an executable is**

- **The image is read-only data.** No heap snapshot taken at build time, no state inherited from the build.
- **Start-up does not grow with the program.** No loop over all of the image's data at start. What is known at build time lies in the image in the form the runtime reads; what must be made is made at first use (`test/aot/startup-scaling`).
- **ASLR stays.** No heap, table or code at a fixed or guessable address.
- **Trimming removes implementations, never names.** Reachable code is always compiled; size is never bought by skipping compilation.
- **The same sources give the same executable**, at any number of threads, on any machine, in any folder.

**What does not count as progress**

- **A trade.** Smaller _and_ faster only. A change that buys size with speed, or speed with memory, is not offered as an option.
- **Working around a large or slow thing** instead of making it small or fast: order files, read-ahead, prefetch hints, repacking, compression, a compile cache. A fresh build has to be fast.
- **Tuning the collector's heuristics.** Allocate less.
- **Making the runtime faster for everybody and booking it as the compiler's gain.** The fair column is the same binary's JIT.
- **Changing the application or the benchmark.**
- **A fast path that only a benchmark takes.**
- **Lines of code are not a cost**, and neither is a temporary regression on the way to the deep fix. Duplicate _abstractions_ are a cost.

## Tried, and did not work

Read this before you propose something. "Measured" means it was built and run on real programs.

| Idea                                                                                | What happened                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An object that leaves its layout becomes an ordinary JSObject                       | Measured twice. A typed store went from 12 to 220 instructions, because every proof about a layout then needs a test                                                          |
| Cutting the inliner's budget to save size                                           | Measured "free" on one application, a loss on others. An inliner budget also moved 800 benchmark rows back and forth: change it only with all three program sizes in view     |
| More inlining to cut instruction fetch                                              | Fewer calls, but the copies crowd the L2 cache: more fetch misses, no fewer cycles                                                                                            |
| Everything compiled as hot code                                                     | A server +4.7% requests per second for +47% code. Rejected: a trade                                                                                                           |
| Ordering stubs or functions by static reference counts, by call graph, by first use | Five different orders, none better than the plain one. What is referenced often is not what runs often                                                                        |
| One copy of each stub family instead of one per register                            | 2% fewer branch sites: not worth the moves it adds                                                                                                                            |
| Splitting functions into hot and cold halves by arithmetic alone                    | The cold arms that do run end up a page away                                                                                                                                  |
| Turning the image's outliner off                                                    | A few branch sites fewer for +2.8% code                                                                                                                                       |
| A linker order file, `madvise(WILLNEED)`, read-ahead on a helper thread             | Faster from a cold disk, level when warm, 160 MB more in the page cache. Rejected: make the binary smaller                                                                    |
| A cache of compiled functions between builds                                        | Rejected: a fresh build has to be fast                                                                                                                                        |
| A heap snapshot at build time                                                       | Rejected: the image is read-only data, and start-up must not depend on what the build machine did                                                                             |
| A second, cheaper type inference for untyped code beside the checker                | Two producers of types. Rejected before it could disagree with the first                                                                                                      |
| Value numbering, loop hoisting and dead-code removal in the front end               | Deleted unrun: B3 does it once it is told the real effects                                                                                                                    |
| Static likely/unlikely hints in the IR's own cost estimate                          | They cost instructions: several readers give an "unlikely" arm slower code. The hints go to B3 alone                                                                          |
| Throwing at run time on a value that does not fit its declared type                 | It was fast, and it broke normal TypeScript                                                                                                                                   |
| Moving rarely used fields out of line                                               | -13% bytes for +2.8% instructions: a trade                                                                                                                                    |
| Adding a guess wherever one is possible                                             | A guess that fails costs three branch sites (the jump out, the call, the jump back) where no guess costs one. Sort failing guesses by where they came from before adding more |
| A special opcode or fast path for one framework's hot function                      | Benchmark-shaped. Rejected                                                                                                                                                    |
| A fixed low address for the heap or for tables, to shorten addresses                | Loses ASLR. Rejected                                                                                                                                                          |
| Checking one binary against itself with a hash at start                             | It proves nothing and costs start-up                                                                                                                                          |
| Shipping the compiler as a separate download                                        | Settled: one binary                                                                                                                                                           |
| Judging a server change by instructions alone                                       | Three batches cut a server's instructions by 2.8% and its cycles rose by 0.8%, with 10% more code                                                                             |
| Judging by one pair of builds                                                       | Code placement alone moves a route by 3%, the flow analysis' visiting order by 5%                                                                                             |

## Working style that paid off

- **Build it, then measure it.** A count of sites or bytes never closed a question; a prototype did, usually within the hour.
- **When a gain is smaller than expected, find out why** before moving on. The missing part is usually a second cause.
- **Break a sum down before you act on it.** The largest row of a profile is often five unrelated things.
- **Compare each operation with what Go and clang emit** for the same source. The gap is the to-do list.
- **A flat profile means the data layout is wrong**, not that there is nothing left.
- **For hundreds of compile errors, one person with the build loop beats ten without it.**
- **Real test suites and real packages find what written tests miss**: `test/aot/other-suites`, `test/aot/real-apps`, `test/aot/typed-packages`.
