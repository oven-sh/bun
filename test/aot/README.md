# Tests of ahead-of-time compilation (`bun build --compile --aot`)

The top of [`run-programs.ts`](run-programs.ts) says how a program under `programs/` is written and judged. This page lists the
groups of tests, the one command that runs each, what CI has to know, and where a new test goes.

## The groups

| Group | Command | What it runs | What it needs |
| --- | --- | --- | --- |
| **Fast**: what CI runs | `bun test test/aot` | Every `*.test.ts` in this folder: each program under `programs/` is built, run and compared with plain Bun; of `packages/` one importer in ten; of `generated/` the part of each generator's programs that always runs | A Bun that includes the compiler (macOS arm64, Linux x64 with glibc). Elsewhere every file skips itself. `python3` for `generated-by-python`, `external-sources-of-typed-objects` and `made-cases-three-ways`; `python3` and a `jsc` shell beside the Bun for `generated-code` and `collector-stress/`. Each says on stderr what it lacks where it is skipped |
| **A tenth of it** | `AOT_PROGRAMS=quick bun test test/aot` | One program in ten, the same ones every time. A debug or ASAN build of Bun chooses this by itself | The same |
| **Slow**: everything | `AOT_PROGRAMS= AOT_GENERATED=all AOT_REPEATED_BUILDS=300 bun test test/aot` | All importers of `packages/`, every generated program, the long form of `repeated-builds` | The same, and hours |
| **All of Bun's tests under `--aot`** | `bun test/aot/whole-suite.ts` | Every test file of the repository twice with `scripts/runner.node.ts`: as it is, and with `--aot` behind each `bun test` and `bun run`. It lists the files that pass only as they are | What the whole suite needs, twice the time |
| **Needs `perf`** | `AOT_PERF=1 bun test test/aot/perf` | Instructions per iteration of everyday idioms against the pinned numbers in `perf/pins.<os>-<arch>.json` | Linux, `perf stat` with user-mode counters |
| **Needs installed packages** | `AOT_TYPED_PACKAGES=<node_modules> SEMA=<bun-sema> bun test test/aot/typed-packages-wide-trees` | `packages/bun-sound/run.py`: the typed versions of react-dom, react-reconciler, seroval, fuse.js .. compiled into large programs: the answers of the untouched packages, and that each is still compiled as typed | A `node_modules` with the packages as npm installs them, `bun-sema`, python3 |
| **Needs the network** | `AOT_SERVERS=1 bun test test/aot/servers` | Six HTTP servers, compiled, asked for every route | npm, or `AOT_SERVERS_MODULES=<a node_modules folder>` |
| **Needs the compiler's own tools** | `JSC=<jsc> SEMA=<bun-sema> PLAIN=<any bun> test/aot/shell/quick.py all` | The programs again without building Bun: front end, compiler with its graphs validated after every phase, `jsc` shell | `jsc`; the top of `shell/quick.py` says how to build it. For `SEMA`, `bun-sema` or any canary or debug build of Bun, which is its own front end (`bun check --aot --aot-out=<file>`). python3 |
| | `JSC=<jsc> SEMA=<bun-sema> test/aot/shell/expectations.py all` | What the compiler generates: the `// IR=`, `// CALLS-`, `// SIZE<` .. lines in the programs. **These are the positive and negative tests of the optimizations.** `bun test test/aot/generated-code` runs this script, in six seconds, with the Bun under test as the front end and the `jsc` that lies beside it (`$JSC` otherwise). CI packs the shell of the WebKit that Bun was linked with into the same zip | The same. The `CALLS` and `SIZE` lines are read on ARM64 only |
| | `JSC=<jsc> SEMA=<bun-sema> PLAIN=<any bun> python3 test/aot/shell/collector-stress.py all` | The programs twice: as they are, and with a collection at every third allocation that leaves the fast path and every freed cell overwritten while the compiled program runs. **It finds values that compiled code still uses and the collector cannot see.** `--every 1` and `--every 2` find other ones; `--young` finds a store without a write barrier. `bun test test/aot/collector-stress` runs it, full and young, dealt out to fifty files | The same. Linux x64 shows more than ARM64. Four and a half hours of one core for both |
| | `JSC=<jsc> SEMA=<bun-sema> PLAIN=<any bun> python3 test/aot/shell/bad-time.py all` | The programs once more; at the end of each the shell is asked whether its realm "is having a bad time": every array in storage that nothing reads or writes in place, for good. The answers stay right, so no other test sees it. **It finds a program that the engine brings there by its own doing.** `bad-time-known.txt` lists the programs that mean it | The same |
| | `JSC=<jsc> SEMA=<bun-sema> python3 test/aot/shell/test262.py <test262> --known test/aot/shell/test262-known.json built-ins language` | test262, the conformance suite of ECMAScript, compiled forty tests to a program: 33,467 of its 47,536 files can run as module code; 31,231 pass, and `test262-known.json` holds the others with what each says (most try to change a built-in). It fails when a test that passed no longer does. Two to three minutes on four cores | The same, and a checkout of test262 (WebKit has one in `JSTests/test262`; the list was recorded at its revision 3655e746) |
| **Needs ptrace** | `bun test test/aot/instruction-counts` | Instructions an operation of small snippets, by where they are spent, and the bytes of their code, against a snapshot | Linux x64, a release build. Part of what CI runs |

Tests of `--aot` outside this folder, all found by `bun test aot`: `test/cli/aot-*.test.ts`, `test/cli/run/run-aot.test.ts`,
`test/cli/test/test-aot*.test.ts`, `test/cli/lint/aot-rules.test.ts`, `test/cli/inspect/compile-aot-inspector.test.ts`,
`test/bundler/compile-aot-*.test.ts`, `test/bundler/bundler_compile_aot.test.ts`.

An opt-in group is switched on by an environment variable named `AOT_<GROUP>`, and without it every test of the group is skipped,
so that `bun test test/aot` never needs more than a Bun. The top of each test file says what its variables mean.

## What CI has to know

- **Nothing has to be registered.** `scripts/runner.node.ts` runs every file under `test/` whose name contains `.test.` or `spec.`.
  For the same reason no program or helper below this folder may have such a name.
- **Seven of the twelve lanes refuse `--aot`** (Linux arm64, musl, macOS x64, Windows), `bun run --aot` too. A test file that uses
  the flag skips itself there: `import { describe, test } from "./supported";` in place of the same names of `bun:test`, or
  `test.skipIf(!!unsupported)` with `unsupported` of `run-programs.ts` where only some of its tests use it. Never a list of
  platforms: the Bun under test is asked. `test-files-self-skip.test.ts` reads every test file of the repository that is in
  this folder or whose text uses the flag, and is red if one does not ask.
- **A skip says why on stderr**: `console.error("SKIPPED: <file>: <what it lacks, what switches it on>")`. Neither reporter prints the
  name of a skipped test, and CI's prints a dot.
- **A test file is a process in CI, and `bun test test/aot` is one process for all.** What a helper keeps in a variable of its
  module, and what an `afterAll` removes, meets the next file there.
- **The runner's environment reaches every build and every executable** through `bunEnv`: `BUN_GARBAGE_COLLECTOR_LEVEL=1` and
  `BUN_JSC_randomIntegrityAuditRate=1.0` on every lane, a `TMPDIR` of its own for each file.
- **A declaration file anywhere under `programs/` is read for every program there**, because `programs/tsconfig.json` includes it, as
  a project's `tsconfig.json` would. What a `.d.ts` of a test declares needs names of its own: no `declare function require`, no
  class with a method `m`.
- **A folder under `programs/` runs only if a `<topic>.test.ts` names it.** A large folder is split by a hash of the path:
  `programs("strings", 1, 2)` and `programs("strings", 2, 2)` in two files.
- **The time limit of a file is five minutes, on four vCPUs.** `getTestTimeout()` in `scripts/runner.node.ts` gives them to every path
  with the word `aot`; whatever limit a test gives itself, the file is killed then. The Linux x64 machine is two cores with two
  threads each, so a file may cost some 500 seconds of processor time (user and system) to be safe: 200 programs. A folder of
  programs and a `variant-*` are split by a hash of the path: `programs("strings", 1, 2)`, `variant("veneers", {..}, {}, 1, 3)`.
  Each `variant-*` runs a tenth of all programs, so it grows with the suite.
- **How many programs run at once** is `AOT_PROGRAMS_JOBS`, by default `os.availableParallelism()`. That is the number of cores of
  the machine, also in a container or under `taskset` that allows fewer: set the variable there.
- **Disk.** Each program that is being run has an executable the size of Bun in the temporary directory, which is deleted
  afterwards. CI tests `bun-profile`, which on Linux carries its debug information: three times the bytes of the Bun that ships. A
  test file that builds many programs builds them on a stripped copy: `...withoutDebugInformation()` of `run-programs.ts` behind
  `--aot` in the build's command.
- **Shards.** `test/expected-durations.json` has no entry for `aot/` until the scheduled job that writes it has seen these files, and
  until then the runner takes each for an average file. `aot` is not among the directories of `test/parallel-allowlist.json`, so
  each file runs by itself.
- **The ASAN lane** runs the tenth, with twice the time limit. The runner sets `BUN_JSC_validateExceptionChecks=1` there for every
  file that `test/no-validate-exceptions.txt` does not list, and the builds and executables that a test starts inherit it.
- **The opt-in groups want their variables set in the test step** (`getTestBunStep()` in `.buildkite/ci.ts`): `AOT_SERVERS` and
  `AOT_BACKEND` need npm and, for the second, `postgres_plain` of `test/docker`, which CI has. `AOT_PERF` wants `perf` and a quiet
  machine, which a shard of CI is not.

## Where a new test goes

| What it is | Where |
| --- | --- |
| A program that must print what plain Bun prints | `programs/<topic>/<name>.ts` (`.tsx`, `.js`), or `programs/<topic>/<name>/main.ts` with its other files. Its first line says what it tests |
| The smallest program for something the compiler once got wrong | `programs/counterexamples/` |
| A program that differs from plain Bun on purpose | the same with `<name>.expected.txt` or `<name>.build-errors.txt`; most are in `programs/type-rules/` |
| A program that fails today | the same with `<name>.todo.txt`, which says how it fails. The fix deletes that file |
| What the generated code must or must not contain | `// IR=`, `// CALLS-` .. lines in the program; the top of `shell/expectations.py` lists them |
| Programs that import packages | a case in `packages/<topic>.ts` |
| Programs written by a generator | `generated/<name>.ts` and `generated-<name>.test.ts`: a part that always runs, chosen because it has failed before, and the whole under `AOT_GENERATED=all`. A generator in Python: `generated/python/<name>.py`, which prints the program of the seed it is given, and a line in `generated/python-generators.ts`. `generated/python-random.ts` yields Python's random numbers, so a port to TypeScript can be compared with its original |
| A table of cases of which some depart from plain Bun, on purpose or not yet mended | a test that records the verdict of each such case in a JSON file and fails when one changes, for better or for worse: `modules-three-ways`, `external-sources-of-typed-objects`, `file-kinds`. Where a script writes the cases, one folder each: `three-ways/made/<table>.py` with its verdicts in `<table>.json`, and a line in a `made-cases-three-ways-<n>.test.ts` |
| Anything that needs flags, several builds, a server, or looks into the executable | a `<what-it-tests>.test.ts` of its own |
| Anything slow, or that needs more than a Bun | the same, skipped unless its `AOT_<GROUP>` variable is set, and a row in the first table of this page |
