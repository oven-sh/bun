# Tests of ahead-of-time compilation

These are the tests of `bun build --compile --aot` and `bun test --aot`. CI runs all of them on every pull request.

## Layout

| Where | What it is | What runs it |
| --- | --- | --- |
| `parallel/<topic>/<name>.ts` | A program. Compiled, it must exit and print as it does under `bun <file>`. A program of several files is a folder with a `main.*` | `run-parallel.ts` |
| `library-sweeps/` | Programs that compile much of Bun's library | `run-parallel.ts --root=test/aot/library-sweeps` |
| `ir/` | A small source text and the IR that the front end must make of it. See [`ir/README.md`](ir/README.md) | `cargo test` |
| `engine-tests/`, `from-source/`, `answers/`, `native/` | Tests of one stage of the engine that need Bun's table of built-ins or Bun's front end. The rest of the engine's tests are in WebKit, in `Source/JavaScriptCore/aot/tests`, and its README says how to write one | `testaot`, which `engine/*.test.ts` start |
| `*.test.ts`, here and in the topic folders | Everything else: flags, messages, several builds, a server, what the executable holds | `bun test` |
| `harness/`, `supported.ts` | Helpers for the test files | |
| `tools/`, `shell/`, `fuzz/`, `perf/`, `other-suites/` | Tools that you start by hand | |

More tests of `--aot` are in `test/cli/aot-*.test.ts`, `test/cli/run/run-aot.test.ts`, `test/cli/test/test-aot*.test.ts`, `test/cli/inspect/compile-aot-inspector.test.ts`, `test/bundler/compile-aot-*.test.ts` and `test/bundler/bundler_compile_aot.test.ts`.

## Run

```sh
# one program, or several
bun bd test/aot/run-parallel.ts test/aot/parallel/<topic>/<name>.ts
bun bd test/aot/run-parallel.ts test/aot/parallel/<topic>/<name>/main.ts

# one test file, or all of them
bun bd test test/aot/<name>.test.ts
bun bd test test/aot

# the front end's IR tests
cargo test -p bun_aot --test ir_tests

# the engine's tests
testaot run test/aot/engine-tests/<file or folder> --show-output
testaot native <part of a name>
bun bd test test/aot/engine
```

`run-parallel.ts` tests the Bun that runs it. It prints one line of JSON per program, with `"state":"pass"` or `"state":"fail"`, and exits with 1 if a program failed. It builds each program four times: as written, with `--aot-erase-types`, with `--aot-testing=FailSpeculations:<n>` and with `--aot-harden=proof-checks`. `--no-erased` makes only the first build.

`engine/*.test.ts` look for `testaot` in `$TESTAOT`, beside the Bun under test, in `build/release-local` and in `build/release`. `bun run build:local --target=engine-test-programs` builds it.

## Add a test

Pick the cheapest kind that still asks the question.

| What you want to test | Where it goes |
| --- | --- |
| What the front end lowers a construct to | `ir/lower/<construct family>/<name>.ts` |
| One rule or one rewrite of the engine | An `.ir` file in WebKit's `aot/tests/<stage>/`. `tools/ir-test-from-source.ts` drafts one |
| A program that must print what plain Bun prints | `parallel/<topic>/<name>.ts` |
| The smallest program for something the compiler got wrong | The same, in the folder of its topic or in `parallel/edge-cases/` |
| Several builds, a server, or a look into the executable | A `<what-it-tests>.test.ts`. The build is what costs, so use one build for many cases |
| That `--trim` changes nothing about a program | A section in `trimmed-is-whole/cases/<subject>.js.txt` |

Nothing has to be registered. `scripts/runner.node.ts` runs every file under `test/` whose name contains `.test.` or `spec.`, and every program under `parallel/`. So no program or helper may have such a name.

### A program

The first line is a comment that says what the program tests. Keep one case to a program where a case can change what the compiler knows about the others.

```ts
// A call with two numbers returns their sum.
function add(a: number, b: number): number {
  return a + b;
}
console.log(add(2, 3));
```

More comment lines at the top say how it is built and run. These are the common ones, and the top of `run-parallel.ts` has the full list.

| Line | Meaning |
| --- | --- |
| `// Flags: <flags>` | more flags for the build |
| `// Env: NAME=value` | the environment of both runs |
| `// Exit code: <n>` | what both runs end with. Without it, a reference run that does not exit with 0 fails the program |
| `// Under: <flags>: <why>` | one more build with those flags |
| `// STATISTIC: <name> >= <n>` | holds a counter of the build to a number, to show that an optimization ran. Also `=` and `<=` |
| `// Todo: it grows: <why>`, `// Todo: "<word>" \| "<word in its place>": <why>`, `// Todo: only frames (..): <why>` | a known difference of one of these three kinds. The program still runs, and fails once it passes. No other difference can be marked |

A program that differs from plain Bun on purpose ends with what it must print:

```ts
/* Output:
two
*/
```

A program brings every package that it loads, in a `node_modules` beside or above it. A package that is meant to be missing has a name under `@made-up/`.

### A test file

Import `describe` and `test` from `./supported` in place of `bun:test`. They skip the file on a Bun that was built without the compiler. Never skip by a list of platforms.

A test that does not pass today is a `test.todo(..)` with its body.

## CI

- A test file that asks the operating system something (processes, files, sockets, memory, native code) runs on every platform only if `aotTestsThatAskTheSystem` in `scripts/runner.node.ts` lists it. Everything else runs on Linux alone, because the compiler is deterministic.
- A platform or a sanitizer that cannot run a program has a line for it in `test/expectations.txt`, with the reason.
- A file is killed after three minutes.
- A file that judges by a clock or by memory has a line `// Runs alone: <why>`.
- A path is short. Windows does not find a path of 260 characters.
- A group of tests that needs more than a Bun is switched on by an environment variable `AOT_<GROUP>`. The top of each such file says what it needs.

## Tools

| Command | What it does |
| --- | --- |
| `bun test/aot/tools/bisect.ts <program> [--bun <bun>]` | Builds a program that differs from plain Bun with each switch, and prints the fewest that set the answer right |
| `bun test/aot/tools/same-output.ts --before <bun> --after <bun> <program or folder>..` | Compares the IR and the machine code that two Buns make, for a change that is meant to change nothing |
| `bun test/aot/tools/compare-check-orders.ts [--bun=<bun>] <program or folder>..` | Builds programs with their files type-checked in several orders. The messages and the IR must be the same in each |
| `bun test/aot/tools/ir-test-from-source.ts main.ts > main.ir` | Drafts an `.ir` test of the engine from a small program |
| `bun test/aot/tools/update-ir-tests.ts <file or folder>..` | Rewrites such a file from the source it holds, as `bun test -u` does for snapshots |

The last two need `testaot`. The top of every other file in `tools/`, `shell/` and `other-suites/` says what it does and what it needs.

[`fuzz/README.md`](fuzz/README.md), [`perf/README.md`](perf/README.md), [`backend/README.md`](backend/README.md) and [`real-apps/README.md`](real-apps/README.md) have the fuzzers, the benchmarks and the applications.
