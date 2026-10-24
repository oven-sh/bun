# Tests of ahead-of-time compilation (`bun build --compile --aot`)

The top of [`run-programs.ts`](run-programs.ts) says how a program under `programs/` is written and judged. This page lists the
groups of tests, the one command that runs each, what CI has to know, and where a new test goes.

## The groups

| Group | Command | What it runs | What it needs |
| --- | --- | --- | --- |
| **Fast**: what CI runs | `bun test test/aot` | Every `*.test.ts` in this folder. Of the programs under `programs/` a share, another for each commit of Bun ("The share", below): each runs three ways, which must agree: plain Bun, compiled, compiled with its types erased; of `packages/` one importer in ten; of `generated/` a quarter of the part of each generator's programs that is meant for every run | A Bun that includes the compiler, as every released build does. `python3` for `generated-by-python`, `external-sources-of-typed-objects` and `made-cases-three-ways`; `python3`, `jsc` and `testaot` beside the Bun for `generated-code`, `collector-stress/`, `heat/` and `bad-time/`; `testaot` and the folder `aot-tests` beside it for `engine-tests`; `python3`, ARM64 and a checkout of WebKit (`$BUN_WEBKIT_PATH` or `vendor/WebKit`) for `paired-returns`. A test that is skipped prints what is missing to stderr |
| **Every program** | `AOT_SHARE=all bun test test/aot` | The same files with every program under `programs/`, each `variant-*` with its tenth of them, every case of `each-case-alone`, the whole of what each generator means for every run | The same, and a day of one four-core machine: 130 hours of one processor |
| **A tenth of it** | `AOT_PROGRAMS=quick bun test test/aot` | One program in ten, the same ones every time, and no share of anything else. A debug or ASAN build of Bun takes that tenth by itself, with the shares of `variant-*`, `each-case-alone`, `jit-mode-eager-tier-up`, `trimmed-matches-untrimmed`, `heat` and `bad-time` | The same |
| **Slow**: everything | `AOT_PROGRAMS= AOT_GENERATED=all AOT_REPEATED_BUILDS=300 bun test test/aot` | All importers of `packages/`, every generated program, the long form of `repeated-builds` | The same, and hours |
| **All of Bun's tests under `--aot`** | `bun test/aot/whole-suite.ts` | Every test file of the repository twice with `scripts/runner.node.ts`: as it is, and with `--aot` added to each `bun test` and `bun run`. It lists the files that pass only as they are | What the whole suite needs, twice the time |
| **Needs `perf`** | `AOT_PERF=1 bun test test/aot/perf` | Instructions per iteration of everyday idioms against the pinned numbers in `perf/pins.<os>-<arch>.json` | Linux, `perf stat` with user-mode counters |
| **Against the JIT** | `bun test/aot/perf/idioms-against-the-jit.ts` | Every idiom of `perf/idioms` and `perf/everyday`, compiled as TypeScript and as JavaScript, against the same binary's JIT: instructions per iteration, collections, peak memory; the losses first. `perf/idioms-against-the-jit.test.ts` lists each loss as a todo | Linux, user-mode counters |
| **Needs installed packages** | `AOT_TYPED_PACKAGES=<node_modules> SEMA=<bun-sema> bun test test/aot/typed-packages-wide-trees` | `packages/bun-sound/run.py`: the typed versions of react-dom, react-reconciler, seroval, fuse.js .. compiled into large programs: the answers of the untouched packages, and that each is still compiled as typed | A `node_modules` with the packages as npm installs them, `bun-sema` (the checker's CLI), python3, and a front end and `testaot`, found as for the scripts of `shell/` |
| **Needs the network** | `AOT_SERVERS=1 bun test test/aot/servers` | Six HTTP servers, compiled, asked for every route | npm, or `AOT_SERVERS_MODULES=<a node_modules folder>` |
| **Needs the compiler's own tools** | `JSC=<jsc> FRONT_END=<bun> TESTAOT=<testaot> PLAIN=<any bun> test/aot/shell/quick.py all` | The programs again without building Bun: front end, `testaot compile` with B3 and Air validated after every phase, `jsc` | `jsc` and `testaot`; the top of `shell/toolchain.py` says how to build them. `FRONT_END`: `bun-aot` (`cargo build --release -p bun_aot_standalone`), or a Bun, which is its own front end (`bun compile --aot-out=<file>`). python3 |
| | `JSC=<jsc> FRONT_END=<bun> TESTAOT=<testaot> test/aot/shell/expectations.py all` | What the compiler generates: the `// IR=`, `// CALLS-`, `// SIZE<`, `// COUNTER:` .. lines and the `//!` comments in the programs. **These are the positive and negative tests of the optimizations.** `bun test test/aot/generated-code` runs this script, in six seconds, with the Bun under test as the front end and the `jsc` and `testaot` that lie beside it (`$JSC` and `$TESTAOT` otherwise). CI packs both, built from the WebKit that Bun was linked with, into the same zip | The same. The `CALLS` and `SIZE` lines are read on ARM64 only |
| | `JSC=<jsc> FRONT_END=<bun> TESTAOT=<testaot> PLAIN=<any bun> python3 test/aot/shell/collector-stress.py all` | The programs twice: as they are, and with a collection at every third allocation that leaves the fast path and every freed cell overwritten while the compiled program runs. **It finds values that compiled code still uses and the collector cannot see.** `--every 1` and `--every 2` find other ones; `--young` finds a store without a write barrier. `bun test test/aot/collector-stress` runs it, full and young, dealt out to fifty files | The same. Linux x64 shows more than ARM64. Four and a half hours of one core for both |
| | `JSC=<jsc> FRONT_END=<bun> TESTAOT=<testaot> PLAIN=<any bun> python3 test/aot/shell/bad-time.py all` | The programs once more; at the end of each the shell is asked whether its realm "is having a bad time": every array in storage that nothing reads or writes in place, for good. The answers stay right, so no other test sees it. **It finds a program that the engine brings there by its own doing.** `bad-time-known.txt` lists the programs that mean it | The same |
| | `JSC=<jsc> FRONT_END=<bun> TESTAOT=<testaot> PLAIN=<any bun> python3 test/aot/shell/heat.py hot all`, and `cold` | The programs once more, compiled as if every function were hot, or every function cold. The compiler has forms of its own for hot code and for the coldest part of a large program; most functions of a test program run once, and none of the programs is large. **It finds a form that gives another answer than the one beside it.** `heat-known.txt` lists the programs that count calls or ask for a form. `bun test test/aot/heat` runs both, dealt out to sixteen files | The same. An hour and three quarters of one core for both |
| | `JSC=<jsc> FRONT_END=<bun> TESTAOT=<testaot> python3 test/aot/shell/test262.py <test262> --out <file> built-ins language`, then `--known <file>` in the place of `--out <file>` | test262, the conformance suite of ECMAScript, compiled forty tests to a program: 33,467 of its 47,536 files can run as module code; 31,231 pass; the file holds the others with what each says (most try to change a built-in). The second run fails when a test that passed in the first no longer does. Two to three minutes on four cores | The same, and a checkout of test262 (WebKit has one in `JSTests/test262`) |
| **The engine's own tests** | `bun test test/aot/engine-tests` | `testaot all`: the IR text tests and native tests of every pass and analysis of the engine, as packed with the WebKit that Bun was linked with, and the IR text tests in `engine-tests/`, which name entries of Bun's table of built-ins | `testaot` and the folder `aot-tests` beside the Bun. Part of what CI runs |
| **IR text tests of the front end** | `cargo test -p bun_aot --test ir_tests` | The files under `test/aot/ir/`: a small input, a command (`lower`, `link`, `emit`, `print`, `verify`) and the IR text it must print. [`ir/README.md`](ir/README.md) | A Rust toolchain, and one `bun bd` for the generated tables. Runs in `.github/workflows/rust-lints.yml` |
| **From a death by a signal to its place** | `python3 test/aot/shell/where-it-died.py --image <image> --map <map> <jsc> --aotImagePath=<image> ..` | Follows a command with ptrace and, if it dies of a signal, prints the address it faulted at, the function or stub, its callers, the registers and the code around it, on one line. `shell/quick.py` does this by itself where the shell dies of a signal, so the log of a machine that nobody can log in to says where | Linux on x86-64 or ARM64; no debugger |
| **From a wrong answer to its cause** | `bun test/aot/tools/bisect.ts <program>` | Builds and runs a program that differs from plain Bun again and again with optimizations switched off: it halves the set of switches, then the range of ids, and prints one switch and one id | `testaot` beside the Bun or in `$TESTAOT`, for the names of the switches |
| **Trimmed against whole** | `bun test/aot/trimmed-against-whole/run.ts --cores 0-15 --corpus test262 --test262 <test262> --corpus jstests --jstests <WebKit's JSTests> --corpus docs --corpus aot-programs --corpus locales --corpus every-name --corpus names --corpus node --corpus bun-tests` | Each program is built twice, with `--compile --aot` and with `--trim` as well, and both executables must print the same and exit the same. **It finds what `--trim` leaves out of a program that reaches it.** For a difference it names the part whose absence makes it. `--help` lists the options and says why every executable runs in a cgroup of its own. `bun test test/aot/trimmed-against-whole` runs ten minutes of it: 200 files of test262, every service of `Intl`, and programs and seeds that change with the commit | A Bun that was linked for `--trim`; Linux with `systemd-run` for the programs that start processes; a day on sixteen cores for everything |
| **New seeds**: only where `AOT_FRESH_SEEDS=1` asks for them | `AOT_FRESH_SEEDS=1 bun test test/aot/generated-fresh-seeds test/aot/mutated-programs` | One program of each random generator, and mutants of the programs, from a seed that no earlier run has used: the day and the commit of the Bun under test. **The other generated tests run the same seeds every time and only show that what worked still works.** The seed is in the name of each test; `AOT_FRESH_SEED=<seed>` runs it again | python3 |
| **Without end** | `python3 test/aot/fuzz/farm.py <config.json>` | Every generator and mutator, round after round with new seeds, against several builds of Bun (as it ships, with AddressSanitizer and assertions, with `--aot-validate`) and under collector stress. [`fuzz/README.md`](fuzz/README.md) | python3, the builds, a machine with hours to spare |
| **Other people's suites** | `bun test/aot/other-suites/run.ts jsc <WebKit>/JSTests`<br/>`bun test/aot/other-suites/run.ts test262 <test262>`<br/>`bun test/aot/other-suites/run.ts node test/js/node/test` | JavaScriptCore's own tests (7,500), the conformance suite of the language (53,000) and Node's own tests as they lie in this repository (3,700), each file run by plain Bun and as an executable. **Not whether a test passes is asked, but whether the executable does what plain Bun does with the same file.** Prints what dies, differs, is refused or breaks the compiler; counts apart the tests that change a built-in object, which an executable refuses: those it also runs as text in one executable of its own, whose realm is locked the same way, and what the compiled test does otherwise there is printed as a difference | the suites, which Bun's CI does not carry; 13 minutes and an hour and a half at 40 tests at a time |
| **Bun's own tests** | `bun test/aot/other-suites/bun-tests.ts test/js` | Each of the 1,400 test files of `test/js`, 120 of them the tests of real npm packages, run twice by the same Bun: `bun test` and `bun test --debug-aot`. **The verdicts are compared test by test.** Prints the files that are not built or die and the tests that differ, with the first error | `bun install --ignore-scripts` in `test/`, and a sandbox for the packages' code (`--wrap`); an hour at 40 files at a time on a busy machine |
| **The TypeScript compiler under checking flags** | `AOT_TYPESCRIPT_FLAGS=1 bun test test/aot/the-typescript-compiler-under-checking-flags` | The type checker of the `typescript` package, built with every function cold, validating, with every pass verified and with every test a guard, and run. **Fault after fault has shown on this program alone and under one of these flags alone.** Without the variable: the build as usual | An hour of processor time |
| **Needs ptrace** | `bun test test/aot/startup-scaling` | **Startup may not grow with the program.** Each file builds one program twice, beside 100 and beside 20,000 unused things of several kinds (functions, classes, object literals, strings, modules ..), runs it until it is ready in each scenario (nothing, `Bun.serve`, a request, Workers, a `node:vm` context, the first `fs.stat`, resolve, `import()`, stack trace, collection ..) and fails when instructions, private memory or resident pages of the executable grew. `startup-scaling-in-place` does the same for `--compile-in-place`. `kindsThatGrow` in `startup-scaling.ts` lists what still grows. `bun test/aot/startup-scaling/print-table.ts --counts=1000,100000 functions classes` prints the readings; `print-profile.ts <scenario> <program> <larger program>` names the functions that grew, from single steps | Linux x64 (a hardware counter, or ptrace where there is none) or macOS, a release build. Part of what CI runs |

Tests of `--aot` outside this folder, all found by `bun test aot`: `test/cli/aot-*.test.ts`, `test/cli/run/run-aot.test.ts`,
`test/cli/test/test-aot*.test.ts`, `test/cli/inspect/compile-aot-inspector.test.ts`,
`test/bundler/compile-aot-*.test.ts`, `test/bundler/bundler_compile_aot.test.ts`.

An opt-in group is switched on by an environment variable named `AOT_<GROUP>`, and without it every test of the group is skipped,
so that `bun test test/aot` never needs more than a Bun. The top of each test file says what its variables mean.

## What CI has to know

- **Nothing has to be registered.** `scripts/runner.node.ts` runs every file under `test/` whose name contains `.test.` or `spec.`.
  For the same reason no program or helper below this folder may have such a name.
- **This folder has steps of its own**, `<platform>-test-aot` (`getAotTests()` in `.buildkite/ci.ts`), and the `test-bun` shards leave
  it out: it costs twice the rest of `test/`. With it go the tests of `--aot`, `--trim`, `--library` and `--dts` that lie elsewhere
  (`aotTests` there: `bundler/bun-build-api-dts`, `bundler/bun-build-dts`, `bundler/bundler_compile_aot`, `bundler/compile-aot*`,
  `bundler/compile-trim*`, `bundler/trim-runtime-icu`, `cli/aot-*`, `cli/compile/compile-library*`): on macOS,
  where `test-bun` has two shards, they took as long as everything else in them. What follows holds for them too. A pull request that touches a path in `aotSources` of `.buildkite/ci.ts` (`src/aot`,
  `src/sema`, `src/builtin_sources`, `src/bundler/aot`, `src/trim`, `src/exe_format`, `src/codegen/aot-schema`, `src/codegen/builtins`,
  `src/options_types/aot_options.rs`, `scripts/build/aot*`, `scripts/build/trim`, `packages/bun-sound`, this folder, the pinned WebKit,
  and the host's files for compiled programs: `src/resolver/compiled_program.rs`, `src/standalone_graph/executable_*`,
  `src/crash_handler/compiled_frames.rs`, `src/sql_jsc/shared/RowDecoder.rs`, `src/runtime/cli/check_command/compile_check.rs`,
  `src/codegen/declared-type-checks.ts`, `src/jsc/bindings/BunCompiled*` ..) runs it on every platform but Ubuntu: every file on
  Debian, `collector-stress` and `bad-time` on Debian x64 alone. Any other build runs a tenth, on Debian x64 and arm64: one file in ten,
  without those two groups, `heat`, `startup-scaling` and `variant-*`. macOS x64 and Windows arm64 only ever run that tenth. A failing
  file is run once more, not three times.
- **Every lane but Debian's two draws its files**: `getAotFileDraw()` in `.buildkite/ci.ts` gives the runner `--one-in=<n>`: one file in
  two on macOS, one in eight on Alpine, Windows and the ASAN build. The draw follows from the commit and the path, so
  every shard makes the same one, each commit takes other files, and in time all are taken.
  `BUILDKITE_COMMIT=<commit> scripts/runner.node.ts --include=aot/ --one-in=<n>` makes it again.
- **The number of shards follows from the lines of these tests in `test/expected-durations.json`**, twelve minutes to a shard and at most 27 (16 on arm64, 8 on macOS), and
  the files are dealt out by those lines. A file without a line adds nothing to the number of shards and is dealt out as the median of the
  folder: a new file that takes minutes needs a line. `scripts/update-test-durations.mjs` renews them from builds that ran all of the
  folder.
- **No platform rejects `--aot`**, and `every-platform.test.ts` never skips itself. Only a Bun that was built without the compiler
  rejects the flag. A test file that uses the flag skips itself there: `import { describe, test } from "./supported";` in place of the same names of `bun:test`, or
  `test.skipIf(!!unsupported)` with `unsupported` of `run-programs.ts` where only some of its tests use it. Never a list of
  platforms: the Bun under test is asked. `test-files-self-skip.test.ts` reads every test file of the repository that is in
  this folder or whose text uses the flag, and is red if one does not ask.
- **A file whose tests read the lines `operation:` of `BUN_JSC_aotCountsPath`** imports the three names from `./supported-with-counted-calls` instead:
  the run time counts no calls of its operations on Windows (that file says why), and a count of nothing proves nothing.
- **A skip says why on stderr**: `console.error("SKIPPED: <file>: <what is missing, what switches it on>")`. Neither reporter prints the
  name of a skipped test, and CI's prints a dot.
- **A test file is a process in CI, and `bun test test/aot` is one process for all.** What a helper keeps in a variable of its
  module, and what an `afterAll` removes, meets the next file there.
- **The runner's environment reaches every build and every executable** through `bunEnv`: `BUN_GARBAGE_COLLECTOR_LEVEL=1` and
  `BUN_JSC_randomIntegrityAuditRate=1.0` on every lane, a `TMPDIR` of its own for each file.
- **What changes code is a flag.** No environment variable changes the code that a build generates. `"buildEnv"` in a
  `<program>.json` may set only the five `BUN_JSC_*` options that log or write a side file (`loggingOptions` in `run-programs.ts`); a
  test that sets another fails. Everything else is a flag, hidden `--aot-<word>` flags included: in `"build"` of the
  `<program>.json`, or in the second argument of `variant()`.
- **A declaration file anywhere under `programs/` is read for every program there**, because `programs/tsconfig.json` includes it, as
  a project's `tsconfig.json` would. What a `.d.ts` of a test declares needs names of its own: no `declare function require`, no
  class with a method `m`.
- **Every folder under `programs/` runs.** `parts.mts` is the table of what CI runs as a test file of its own without a file for it:
  the folders of programs, the variants, whatever is split into parts. Its top says how one of them is run by hand. A large folder is
  split by a hash of the path: its number of parts stands there.
- **The time limit of a file is five minutes, on four vCPUs.** `getTestTimeout()` in `scripts/runner.node.ts` gives them to every path
  with the word `aot`; whatever limit a test gives itself, the file is killed then. The Linux x64 machine is two cores with two
  threads each, so a file may cost some 500 seconds of processor time (user and system) to be safe: 200 builds. A program that has
  TypeScript files is built twice, with its types and with its types erased; any other program and every program of a `variant-*`
  is built once. What takes more than three minutes gets more parts in `parts.mts`.
- **Many programs in one executable.** A build costs about as much for 250 small programs as for one. `joined(label, flags, part, parts)`
  of `joined-programs.ts` puts the programs that can share a process into groups of about 250, builds each group twice, once with
  every function through B3 and once with `flags`, runs both and compares what each program printed. It is for a way of generating
  code that every function can take: `joined-programs-all-code-direct-*`, `joined-programs-predictions-fail-*`. A red
  names the programs that differ or stopped the executable; each is then run alone with the same flags.
- **The direct code generators and the check of references.** `run-programs.ts` builds every program with
  `--aot-check=validate-references`, and a build with that check sends every function through B3. A build whose flags hold
  `--aot-testing=GenerateAllCodeDirectly` therefore goes without it, and must count `FunctionsGeneratedDirectly`. So does one with
  `--aot-testing=GenerateColdCodeDirectly`, which hands the generator what is neither hot nor warm of a very large program
  (`variant-cold-code-direct`). Without either word no code is generated directly.
- **The share.** All programs in all ways are 130 hours of one processor, and CI has 24 shards of twelve minutes on four vCPUs. So a
  run that is told nothing takes a share, and which one follows from `Bun.revision`: each commit takes other programs, and in
  time all are taken. `inShare(name, oneIn)` and `partInShare(part, parts, oneIn)` of `run-programs.ts` decide: one program in
  10 for `programs()` and `programsBuiltWith()` (a list of names given to the second is taken whole), one in 400 for each
  `variant-*` (a fortieth of its tenth, another for each variant), one in 10 of `each-case-alone`, one in 100 for
  `jit-mode-eager-tier-up`, a quarter for `generated()`, one of forty pieces of each file's part for `collector-stress`, `heat` and
  `AOT_PROGRAMS=<name> bun test test/aot/<file>` runs a red again, `AOT_SHARE=<revision>` the whole share of that commit,
  `AOT_SHARE=all` everything. A test with a body of its own in a `*.test.ts` is in no share: it runs every time. What grows with
  the suite belongs in a share.
- **What a script writes is not kept.** Some folders of `programs/` are written by a script, whole or in part: `generate.ts` lists
  them. What is kept under the name of such a program takes its place, and what somebody has decided about one (`<name>.expected.txt`, `<name>.json` ..) is kept under its name. A test file writes the programs that it runs into a temporary folder when it starts, under the names they would have in
  `programs/`, and treats them like any other program. `bun test/aot/generate.ts <folder> <where>` writes a folder out to be read. The programs of
  `built-ins-alone` and `built-ins-asked-in-place` follow from the table of built-ins of the Bun under test, `aot_builtin_table.json`:
  in `$AOT_BUILTIN_TABLE`, beside that Bun (CI packs it there) or in the folder `codegen` beside it. Their names are known only when they are
  made, a group at a time (the rows of one built-in, or of one holder), so the part of a folder goes by the group; so does the share
  wherever all folders are walked (`variant-*`, `joined()`, `jit-mode-eager-tier-up`, `collector-stress`, `heat`, `bad-time`).
- **How many programs run at once** is `AOT_PROGRAMS_JOBS`, by default `os.availableParallelism()`. That is the number of cores of
  the machine, also in a container or under `taskset` that allows fewer: set the variable there.
- **Disk.** Each program that is being run has an executable the size of Bun in the temporary directory, which is deleted
  afterwards. CI tests `bun-profile`, which on Linux carries its debug information: three times the bytes of the Bun that ships. A
  test file that builds many programs builds them on a stripped copy: `...withoutDebugInformation()` of `run-programs.ts` after
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
| A program that must print what plain Bun prints | `programs/<topic>/<name>.ts` (`.tsx`, `.js`), or a folder `programs/<topic>/<name>/` with its other files, whose entry point is `main.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs` or `.cjs`. Its first line says what it tests |
| The smallest program for something the compiler once got wrong | `programs/counterexamples/` |
| A program that differs from plain Bun on purpose | the same with `<name>.expected.txt` or `<name>.build-errors.txt`; most are in `programs/type-rules/` |
| A program that differs from plain Bun on purpose, and not because of a type (a locked built-in, `f.caller`) | the same with `<name>.expected.txt`, to which the build with erased types is held too. Where that build prints what plain Bun prints: `"erased": "as plain Bun"` in `<name>.json` |
| A program that fails today | the same with `<name>.todo.txt`, which says how it fails. The fix deletes that file |
| A test that states what is not so yet | `test.todo(..)` with its body, under a line `// TODO: <what happens today>`. A row of a table: `eachRow([.. gap("<what happens today>", [..]) ..])` of `supported.ts` in place of `test.each`. Where the test has a list of its own for that (`known-today.ts`, `notYet` in a row, a `*.known.json`), the list. `bun test --todo <file>` runs them and is red for each that has come true: the fix takes the mark off. A silent wrong value, a crash, a hang or a refused build of a valid program at default flags gets no such mark: it stays red |
| What the generated code must or must not contain, which allocations are removed, how often a run-time path is taken | `// IR=`, `// CALLS-`, `// COUNTER:` .. lines and `//!` comments in the program; the top of `shell/expectations.py` lists them |
| That an optimization ran on a host built-in (`Response`, `Headers`), which `testaot` does not have | `// STATISTIC: <StatisticId> (= \| >= \| <=) <n>` lines in the program's entry point. `run-programs.ts` builds such a program with the hidden `--explain=statistics` and checks the lines on the build that keeps the types, not in a variant that adds build flags |
| What the IR of a program built with Bun's own modules holds behind a pass | a `<what-it-tests>.test.ts` with `printIR` of `harness/printed-ir.ts`: the build writes the program (`--aot-out`), `testaot print --until=<pass>` prints it. A Bun without assertions prints no IR |
| One pass, analysis or lowering rule in isolation | IR text: `aot/tests/<folder>/<case>.ir` in WebKit, `test/aot/ir/<area>/<case>.ir` or `.ts` here |
| Programs that import packages | a case in `packages/<topic>.ts` |
| A folder of `programs/` that a script writes, whole or beside programs written by hand | a script that exports `programs()`, and a line in `generators` of `generate.ts`. Nothing that it writes is checked in |
| Programs written by a generator | `generated/<name>.ts` and `generated-<name>.test.ts`: a part that always runs, chosen because it has failed before, and the whole under `AOT_GENERATED=all`. A generator in Python: `generated/python/<name>.py`, which prints the program of the seed it is given, and a line in `generated/python-generators.ts`. `generated/python-random.ts` produces Python's random numbers, so a port to TypeScript can be compared with its original |
| A table of small cases, crossed from a few axes | `generated/<name>.ts` that returns files of cases, one case a line, for `programsOf` in `generated/case-files.ts`, and `generated-table-<name>.test.ts`: every file is compiled as one program, and a sample that covers every value of every axis is compiled case by case, each alone in its program. `AOT_GENERATED=all` compiles every case alone. `bun generated/<name>.ts <folder> [--sample=<n>] [--only=<regex>]` writes the files |
| Cases written by hand, each of which must hold alone in a program | a line `t("<name>", ..)` in a file under `each-case-alone/`. `each-case-alone-<part>.test.ts` deal the cases out among themselves. A case that `--aot` may refuse with a TypeError stands in `<file>-and-may-be-refused.ts`, whose `t` also takes what plain Bun answers |
| Two programs that differ in nothing a programmer could be told a rule about, and so must answer alike | `answer-alike/<pair>/a.*` and `b.*`; the top of `answer-alike.test.ts` says what else a pair may hold |
| A table of cases of which some depart from plain Bun, on purpose or not yet fixed | a test that records the verdict of each such case in a JSON file and fails when one changes, for better or for worse: `modules-three-ways`, `external-sources-of-typed-objects`, `file-kinds`. Where a script writes the cases, one folder each: `three-ways/made/<table>.py` with its verdicts in `<table>.json`, and a line in a `made-cases-three-ways-<n>.test.ts` |
| Anything that needs flags, several builds, a server, or looks into the executable | a `<what-it-tests>.test.ts` of its own |
| Anything slow, or that needs more than a Bun | the same, skipped unless its `AOT_<GROUP>` variable is set, and a row in the first table of this page |
