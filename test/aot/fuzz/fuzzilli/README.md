# Fuzzing `bun build --compile --aot` with generated programs

Everything in this folder does the same thing. It generates a program, compiles it with `--aot`, runs it, and compares what it prints and how it exits with `bun <file>`. A difference is a compiler bug unless it is a documented one.

The programs come from two places. The drivers (`run-*.ts`) generate their own and need nothing but a Bun. A [Fuzzilli](https://github.com/googleprojectzero/fuzzilli) profile mutates programs and keeps the ones that reach new code in the compiler, which needs an instrumented build of Bun.

[`../README.md`](../README.md) describes the other fuzzer, `run.ts`.

## Files

| Files | What they do |
| --- | --- |
| `lane.ts` | Starts several drivers for a set time and collects their findings. Start here. |
| `run-alone.ts` | Builds each program into its own executable, as a user does. About a second per program. |
| `run-batch.ts` | Builds many programs into one executable and runs each in a Worker. Cheaper, but a program is never the entry point. |
| `run-test-projects.ts`, `run-loads.ts`, `compare-test-runs.ts` | Compare `bun test --aot` with `bun test`. |
| `run-growth.ts`, `run-scenes-of-large-sizes.ts` | Find build times that grow faster than the program. |
| `run-footprint.ts`, `run-price-sweep.ts` | Compare an executable's memory and CPU time with `bun <file>`. |
| `write-*.ts`, `textbook/` | The generators, and seed programs for the one that mutates. |
| `*.swift`, `fuzzilli.patch`, `list-builtins.ts` | The Fuzzilli profile. |
| `reprl.py`, `counters-as-coverage.py` | Stand-ins for Fuzzilli and for an instrumented Bun. |
| `what-the-page-declares.ts` | The differences that the drivers count as documented. |

The comment at the top of each file says what it does and lists its options.

## Run the drivers

```sh
bun test/aot/fuzz/fuzzilli/lane.ts --kind few --minutes 60 --jobs 8 --out /tmp/lane --bun build/release/bun
```

`--kind` picks the generators and how many programs share a build. The `kinds` table at the top of `lane.ts` lists them. A job fills about one core. Options that `lane.ts` does not know go to the drivers.

A generated program may connect to any host. On Linux, `lane.ts` gives each driver a network namespace that reaches nothing, if `unshare` allows it. Run everything else in a sandbox such as `../../real-apps/jail.sh`.

To start one driver yourself:

```sh
bun test/aot/fuzz/fuzzilli/run-alone.ts --bun build/release/bun --work /tmp/alone/work --finds /tmp/alone/finds --seconds 600
```

A `write-*-sweep.ts` file enumerates every combination of a few small tables, often hundreds of thousands of programs. Most take a folder, a first index, a count and a stride. With `--programs`, `run-alone.ts` takes the files of a folder instead of generating. That is also how you check that it sees a program you know is miscompiled.

```sh
bun test/aot/fuzz/fuzzilli/write-bound-sweep.ts /tmp/bounds 0 3000 10007
bun test/aot/fuzz/fuzzilli/run-alone.ts --bun build/release/bun --work /tmp/alone/work --finds /tmp/alone/finds --programs /tmp/bounds
```

## Run Fuzzilli

You need Linux, Swift 6.3 and a WebKit checkout.

Build Bun with coverage. `--fuzzilli-compiler-only=on` limits C++ coverage to the functions in `scripts/build/fuzzilli-compiler-coverage.txt`. In Rust, only the crates named `bun_aot*` and `bun_sema*` report coverage.

```sh
BUN_WEBKIT_PATH=<WebKit> bun scripts/build.ts --profile=release-local --asan=on --assertions=on \
  --fuzzilli=on --fuzzilli-compiler-only=on --rust-lto=off --build-dir=build/fuzzilli
```

Build Fuzzilli with the profile:

```sh
git clone https://github.com/googleprojectzero/fuzzilli && cd fuzzilli
git checkout be2811d00282320381fc8007d64873745772011d
cp <bun>/test/aot/fuzz/fuzzilli/*.swift Sources/Fuzzilli/Profiles/
git apply <bun>/test/aot/fuzz/fuzzilli/fuzzilli.patch
swift build -c release
```

List Bun's and Node's APIs for the profile, then start it:

```sh
mkdir -p /tmp/fuzzilli
bun test/aot/fuzz/fuzzilli/list-builtins.ts build/fuzzilli/codegen/aot_builtin_table.json /tmp/fuzzilli/builtins.json
BUN_FUZZILLI_BUILTINS=/tmp/fuzzilli/builtins.json BUN_FUZZILLI_FINDS=/tmp/fuzzilli/finds \
BUN_FUZZILLI_ENTRY_POINT=/tmp/fuzzilli/program.js .build/release/FuzzilliCli --profile=bunCompiler \
  --jobs=32 --storagePath=<storage> --resume <bun>/build/fuzzilli/bun-asan
```

No corpus is in this repository. Fuzzilli writes each program that reaches new code to `<storage>/corpus`, and `--resume` continues from there.

The Bun that Fuzzilli starts compiles each program in a fork of itself and writes no executable (`src/runtime/cli/fuzzilli_compile_loop.rs`). Then it runs the compiled program and `bun run` of the same file and compares exit code, signal and stdout (`fuzzilli_run_comparison.rs`). If they differ it runs both again, so a program that prints the time is not reported. To have something to compare, it appends a `printValue(name, value)` call for every top-level name.

`reprl.py` sends a few programs by hand and prints how each ended:

```sh
BUN_JSC_useJIT=0 python3 test/aot/fuzz/fuzzilli/reprl.py build/fuzzilli/bun-asan build --compile --aot --aot-check=Validate \
  --aot-threads=1 /tmp/fuzzilli/program.js -- a.js b.js
```

### Verdicts

| What happened | Exit code or signal | Counted as |
| --- | --- | --- |
| both runs exit with 0 and print the same | 0 | `same` |
| the build reports an error | 1 | `refused-by-the-build` |
| both runs fail with the same exit code and print the same | 2 | `same-failure` |
| they differ in a documented way | 3 | `documented-difference` |
| `bun run` differs from itself | 4 | `plain-bun-is-unsteady` |
| `bun run` hits a limit | 5 | `neither-finished` |
| `bun run` is killed by a signal | 6 | `plain-bun-crashed` |
| the second compiled run agrees with `bun run` | 7 | `compiled-program-is-unsteady` |
| `bun run` rejects the file when it loads it | 8 | `plain-bun-refuses-the-file` |
| they print something different | SIGUSR1 | `finding-10` |
| they exit with different codes | SIGUSR2 | `finding-12` |
| only the compiled program hits a limit | SIGALRM | `finding-14` |
| the compiled program is killed by a signal | that signal | `finding-<signal>` |
| the build crashes, or fails an assertion or `--aot-check=Validate` | that signal | `compiler-signal-<signal>` |
| the build reports an `internal compiler error` or exceeds its memory limit | SIGABRT | `compiler-signal-6` |
| the build exceeds its CPU limit | SIGXCPU | `compiler-signal-24` |

Fuzzilli treats a signal as a crash, reduces the program and writes it to `<storage>/crashes`.

Nothing reads `docs/compiler/compatibility.mdx` to decide what is documented. Bun goes by `differs_as_documented` in `fuzzilli_run_comparison.rs`. `run-alone.ts` and `run-batch.ts` go by `what-the-page-declares.ts` and a short list of names each.

### Settings

Fuzzilli passes every variable that starts with `BUN_FUZZILLI_` on to Bun.

| Variable | Meaning |
| --- | --- |
| `BUN_FUZZILLI_ENTRY_POINT` | Each Bun writes the program it is compiling to `<folder>/<process id>.<name>`. The folder must exist. Use a RAM disk. |
| `BUN_FUZZILLI_BUILTINS` | The file from `list-builtins.ts`. Without it Fuzzilli calls none of Bun's and Node's APIs. |
| `BUN_FUZZILLI_TYPES` | Fuzzilli writes TypeScript: `mixed`, or a list such as `right=70,wrong=30`. `TypeScriptSettings` in `BunTypeScript.swift` has the settings. Needs a `.ts` entry point and `BUN_FUZZILLI_PRINTS_VALUES=0`. |
| `BUN_FUZZILLI_FINDS` | The folder for findings. |
| `BUN_FUZZILLI_OUTCOMES` | Each Bun writes its count of each verdict to `<folder>/<process id>.outcomes`. |
| `BUN_FUZZILLI_CPU_SECONDS`, `BUN_FUZZILLI_MEMORY_MEGABYTES` | Limits of a build: 30 and 4096. |
| `BUN_FUZZILLI_RUN_CPU_SECONDS`, `BUN_FUZZILLI_RUN_WALL_SECONDS`, `BUN_FUZZILLI_RUN_MEMORY_MEGABYTES` | Limits of a run: 5, 20 and 2048. A run also ends at 1 MB of output. |
| `BUN_FUZZILLI_RUNS_PROGRAMS=0`, `BUN_FUZZILLI_CHECKS_PASSES=0` | Only compile. Leave out `--aot-check=Validate`. |
| `BUN_FUZZILLI_PRINTS_VALUES` | 0 adds no `printValue` calls. 2 prints every property of a value. |

The Swift files and `counters-as-coverage.py` read a few more. A comment describes each where it is read.

With `BUN_FUZZILLI_COLLECTS_PROGRAMS=<folder>`, Bun compiles nothing and moves each program into the folder, which must be on the same file system as the entry point. `run-batch.ts` takes them from there and tests any build of Bun. Nothing is new coverage then, so give Fuzzilli a corpus to mutate:

```sh
BUN_FUZZILLI_COLLECTS_PROGRAMS=/tmp/fuzzilli/programs BUN_FUZZILLI_ENTRY_POINT=/tmp/fuzzilli/program.js \
.build/release/FuzzilliCli --profile=bunCompiler --jobs=4 --storagePath=/tmp/fuzzilli/generator --overwrite \
  --staticCorpus --importCorpus=<storage>/corpus --corpusImportMode=full <bun>/build/fuzzilli/bun-asan &

bun test/aot/fuzz/fuzzilli/run-batch.ts --bun <the Bun to test> --programs /tmp/fuzzilli/programs \
  --work /tmp/fuzzilli/work --finds /tmp/fuzzilli/finds --count 2000 --group 500 --batches 0 --flags=--aot-threads=1
```

## Findings

The drivers under `--finds`, and Bun under `BUN_FUZZILLI_FINDS`, store a finding the same way:

```txt
<finds>/index.txt                  one line for each finding
<finds>/<kind>-<hash>/<n>/
  program.<extension>              the program as it was built
  report.txt                       how both runs ended, the first line that differs, a driver's build command
  compiled.stdout compiled.stderr bun-run.stdout bun-run.stderr
```

Findings of one kind whose reports are the same, digits aside, share a hash. `n` is the base-2 logarithm of the program's size, so the lowest `n` holds the smallest program. In a program of several files, a line `// @filename: ./<path>` starts the next file.

| Kind | Meaning |
| --- | --- |
| `stdout`, `exit-code` | The executable prints something else, or exits with another code. |
| `signal` | The executable crashed. |
| `limit`, `never-ends` | Only the executable hit a limit. |
| `false-proof` | An executable built to check the compiler's proofs at run time stopped at one. |
| `build-stopped`, `compiler-signal-<n>` | The compiler crashed or reported an internal error. |
| `unsteady` | Two runs of the executable differ. |

A prefix says how the program was built or run: `together-` is several programs in one executable, `test-run-` is `bun test --aot`, `cost-<switch>-` is that `--aot-testing` switch. A difference that an executable built without `--aot` shows too is counted and not stored.

A driver exits with 0 whether or not it found something, so look at `index.txt`. `lane.ts` also writes `status.txt` every 20 seconds and, at the end, `findings.tsv` and `as-tests/`, which has the smallest program of each finding in the format of `../../parallel`.

## From a finding to a test

1. Run it again by itself, with the command in `report.txt` or with `run-alone.ts --programs`.
2. Reduce it. `run-test-projects.ts --reduce <folder of a finding>` reduces a project, and `compare-test-runs.ts --shrink` finds the other test file that a failure needs. Cut a single program by hand until every line is needed. `bun test/aot/run-parallel.ts --root=<out>/as-tests <file>` runs it the way CI will.
3. Commit the small program with the fix, as `test/aot/parallel/<topic>/<what-it-tests>.<extension>`. [`../../README.md`](../../README.md) has the format. Commit no seeds and no generator output.

## Add a generator

- A sweep: name the file `write-<subject>-sweep.ts`, take `<folder> [first] [count] [stride]`, and write one file for each program. A first line `// Flags: <flags>` adds build flags. Every program must print something, and the same in every run. `test/aot/a-few-of-every-sweep-*.test.ts` find the file by its name and build a dozen of its programs.
- A random generator: export a function that returns the lines of one small piece of code, and call it from a new method `sceneOf<Name>()` of the class `Scenes` in `write-ordinary-scenes.ts`. `--scene sceneOf<Name>` then generates nothing else. Add it to the list in `writeOrdinaryScenes()` to have it picked at random, and to `kinds` in `lane.ts` for a lane of its own.
- A Fuzzilli code generator: add a `CodeGenerator` and its weight to `bunCodeGenerators` (`BunBuiltins.swift`), `bunCallbackGenerators` (`BunCallbacks.swift`) or `typeScriptCodeGenerators` (`BunTypeScript.swift`). Copy the Swift files again and rebuild.
- A Fuzzilli profile: copy `BunCompilerProfile.swift`, change `processArgs`, and register the new name in `Sources/Fuzzilli/Profiles/Profile.swift`, as `fuzzilli.patch` does for `bunCompiler`.

Try a new generator on a compiler that has the bug you wrote it for. Programs that fail the same way in both runs find nothing and look clean. `--aot-testing` has fault injections for this, listed in `driver/AOTOptionWords.cpp` in the engine's `aot` folder:

```sh
bun test/aot/fuzz/fuzzilli/lane.ts --kind loops --minutes 5 --out /tmp/red --flags="--aot-threads=1 --aot-testing=AssumeIndexesInBounds"
```

Each of these sweeps has fault injections that 240 of its programs, 60 in a build, find in all four builds. A change of a sweep that loses its fault injection makes it blind.

| Sweep | `--aot-testing` |
| --- | --- |
| `write-random-edge-number-sweep.ts` | `AssumeNoNaNStores`, `IgnoreFreshArrayEscapes` |
| `write-random-remainder-sweep.ts` | `AssumeNoNaNStores`, `AssumeInvariantArrayStorage` |
| `write-random-old-length-sweep.ts` | `IgnoreLengthStores`, `SkipStorageChecks` |
| `write-random-rare-value-sweep.ts` | `AssumeArgumentsNeverEscape`, `OverstateTypedArrayLength` |
| `write-random-typed-edge-sweep.ts` | `MisplaceUncheckedReads`, `SkipStorageChecks` |
| `write-chain-use-sweep.ts` | `AssumeArgumentsNeverEscape`, `MisplaceUncheckedReads` |
| `write-control-flow-sweep.ts` | `SkipUnrollTripCountCheck`, `AssumeUnknownCallsReturnUndefined` |
| `write-generator-use-sweep.ts` | `AssumeInvariantArrayStorage` |
| `write-kind-pair-sweep.ts`, `write-variable-key-sweep.ts` | `MisnumberFunctionRecords` |
| `write-throwing-read-sweep.ts` | `SkipBoundsProof`, `AssumeIndexesInBounds` |
| `write-class-member-sweep.ts` | `AssumeGuardsAndFacts`, `DropLastCase` |
| `write-await-order-sweep.ts` | `AssumeArgumentsNeverEscape` |
| `write-number-formula-sweep.ts` | `OverstateTypedArrayLength`, `MisplaceUncheckedAccesses` |
| `write-remainder-use-sweep.ts` | `AssumeArithmeticElementUsers`, `SkipStorageChecks` |
| `write-hand-loop-sweep.ts` | `AssumeGuardsAndFacts`, `AssumeInvariantArrayStorage` |
| `write-captured-value-sweep.ts` | `MisplaceUncheckedAccesses`, `OverstateTypedArrayLength` |
| `write-guards-in-a-row-sweep.ts` | `AssumeIndexesInBounds` |
| `write-binding-pattern-sweep.ts`, `write-call-target-sweep.ts` | `TreatEqualIntegersAsLess` |
| `write-index-formula-sweep.ts` | `AssumeIndexesInBounds`, `AssumeInvariantArrayStorage` |
| `write-self-call-sweep.ts`, `write-second-counter-sweep.ts` | `AssumeArithmeticElementUsers`, `AssumeIndexesInBounds` |
| `write-generator-answer-sweep.ts` | `AssumeIndexesInBounds`, `AssumeInvariantArrayStorage` |
| `write-kind-test-sweep.ts` | `AssumeNullishHostResults` |
| `write-built-in-use-sweep.ts` | `AssumeUnknownCallsReturnUndefined`, `AssumeInvariantArrayStorage` |
| `write-returned-literal-sweep.ts` | `AssumeInvariantArrayStorage` |
| `write-number-field-sweep.ts` | `OverstateTypedArrayLength` |
| `write-field-again-sweep.ts` | `IgnoreMarksInShapeChecks` |
| `write-hole-callback-sweep.ts` | `IgnoreFreshArrayEscapes`, `MisplaceUncheckedReads` |
| `write-handler-variable-sweep.ts` | `MisnumberFunctionRecords` |
| `write-conversion-sweep.ts` | `AssumeNullishHostResults` |
| `write-element-method-sweep.ts` | `AssumeIndexesInBounds`, `MisplaceHoistedArrayStorage` |
| `write-prototype-statement-sweep.ts` | `AssumeGuardsAndFacts`, `AssumeUnknownCallsReturnUndefined` |
| `write-own-key-sweep.ts` | `AssumeIndexesInBounds` |
| `write-passed-argument-sweep.ts` | `IgnoreFreshArrayEscapes`, `AssumeUnknownCallsReturnUndefined` |
| `write-late-field-sweep.ts` | `AssumeGuardsAndFacts`, `MisplaceHoistedArrayStorage` |
| `write-eval-variable-sweep.ts` | `SkipInt32Reboxing` |
| `write-appended-element-sweep.ts` | `IgnoreLoopArrayStores`, `SkipStorageChecks` |
| `write-bigint-loop-sweep.ts` | `AssumeInvariantArrayStorage`, `MisplaceUncheckedReads` |
| `write-promise-chain-sweep.ts` | `AssumeArgumentsNeverEscape`, `AssumeUnknownCallsReturnUndefined` |
| `write-stepped-element-sweep.ts` | `SkipUnrollEntryChecks`, `OverstateTypedArrayLength` |
| `write-replaced-function-sweep.ts` | `AssumeInlineBuiltinsPure`, `AssumeGuardsAndFacts` |
| `write-static-loop-sweep.ts`, `write-text-order-sweep.ts`, `write-private-field-sweep.ts` | `AssumeNullishHostResults` |
| `write-construction-sweep.ts` | `AssumeUnknownCallsReturnUndefined`, `MisnumberFunctionRecords` |
| `write-comparison-value-sweep.ts` | `TreatEqualIntegersAsLess` |
| `write-grid-loop-sweep.ts` | `AssumeIndexesInBounds`, `SkipStorageChecks` |
| `write-loop-receiver-sweep.ts` | `AssumeGuardsAndFacts`, `IgnoreEscapeAfterUnknownCall` |
| `write-several-pushes-sweep.ts` | `AssumeLocalArrayReceivers`, `MisplaceHoistedArrayStorage` |
| `write-filled-instance-sweep.ts` | `AssumeGuardsAndFacts`, `AssumeInvariantArrayStorage` |
| `write-table-iterator-sweep.ts` | `AssumeInlineBuiltinsPure`, `AssumePermanentlyPristineIterables` |
| `write-searched-list-sweep.ts` | `IgnoreFreshArrayEscapes`, `MisplaceHoistedArrayStorage` |
| `write-indexed-store-sweep.ts` | `AssumeIndexesInBounds`, `AssumeNullishHostResults` |
| `write-random-mixed-statement-sweep.ts` | `IgnoreFreshArrayEscapes`, `MisplaceHoistedArrayStorage` |
| `write-random-mixed-class-sweep.ts` | `AssumeGuardsAndFacts`, `DropLastCase` |
| `write-random-mixed-async-sweep.ts` | `AssumeArgumentsNeverEscape`, `IgnoreEscapeAfterUnknownCall` |
| `write-random-mixed-loop-sweep.ts` | `SkipUnrollEntryChecks`, `IgnoreLengthStores` |
| `write-captured-store-sweep.ts` | `AssumeIndexesInBounds`, `IgnoreLoopArrayStores` |
| `write-place-store-sweep.ts` | `IgnoreLoopArrayStores`, `MisplaceUncheckedAccesses` |
| `write-comparator-sweep.ts` | `MisplaceUncheckedReads`, `TreatEqualIntegersAsLess` |
| `write-named-loop-sweep.ts`, `write-replaced-object-sweep.ts` | `AssumeGuardsAndFacts` |
| `write-truncated-read-sweep.ts` | `AssumeNoNaNStores`, `AssumeIndexesInBounds` |
| `write-straight-store-sweep.ts` | `AssumeNoNaNStores`, `AssumeSpillSlotsDead` |
| `write-repeated-birth-sweep.ts` | `AssumeGuardsAndFacts`, `IgnoreEscapeAfterUnknownCall` |
| `write-handled-list-sweep.ts` | `IgnoreLoopArrayStores`, `IgnoreFreshArrayEscapes` |
| `write-pattern-protocol-sweep.ts` | `IgnoreEscapeAfterUnknownCall`, `DropLengthCheckedReads` |
| `write-matched-table-sweep.ts` | `AssumeInvariantArrayStorage`, `SkipStorageChecks` |
| `write-pattern-shape-sweep.ts`, `write-joined-text-sweep.ts` | `TreatEqualIntegersAsLess`, `AssumeSpillSlotsDead` |
| `write-trimmed-text-sweep.ts` | `MisplaceHoistedArrayStorage`, `DropLengthCheckedReads` |
| `write-built-key-sweep.ts`, `write-constant-field-sweep.ts`, `write-defined-member-sweep.ts` | `AssumeGuardsAndFacts` |
| `write-field-order-sweep.ts` | `AssumeGuardsAndFacts`, `SkipFencesAfterLateStores` |
| `write-row-nest-sweep.ts` | `SkipLengthChecks`, `MisplaceUncheckedAccesses` |
| `write-stencil-sweep.ts` | `AssumeNoNaNStores`, `SkipStorageChecks` |
| `write-list-life-sweep.ts` | `AssumeInBoundsElementsPresent`, `IgnoreFreshArrayEscapes` |
| `write-bundled-module-sweep.ts` | `AssumeUnknownCallsReturnUndefined`, `AssumeArgumentsNeverEscape` |
| `write-yielded-number-sweep.ts` | `OverstateTypedArrayLength`, `AssumeIndexesInBounds` |
| `write-generator-method-sweep.ts`, `write-built-code-sweep.ts`, `write-cut-text-sweep.ts` | `MisfoldBranchInSweep` |
| `write-nested-push-sweep.ts` | `IgnoreLoopArrayStores`, `SkipLengthChecks` |
| `write-nested-state-sweep.ts` | `AssumeLocalArrayReceivers`, `MisroundLoopBounds` |
| `write-digit-arithmetic-sweep.ts` | `SkipCapacityChecks`, `SkipUnrollTripCountCheck` |
| `write-changed-collection-sweep.ts` | `IgnoreEscapeAfterUnknownCall`, `AssumeArgumentsNeverEscape` |
| `write-wrapped-module-sweep.ts` | `AssumeGuardsAndFacts`, `DropLengthCheckedReads` |
| `write-imported-common-sweep.ts` | `AssumeUnknownCallsReturnUndefined`, `DropLengthCheckedReads` |
| `write-bare-loop-sweep.ts`, `write-bare-pair-sweep.ts` | `IgnoreLoopArrayStores`, `SkipLengthChecks` |
| `write-bare-branch-sweep.ts` | `AssumeInlineBuiltinsPure`, `SkipBoundsProof` |
| `write-bare-call-sweep.ts` | `OverstateBoundArgumentCount`, `AssumeUnknownCallsReturnUndefined` |
| `write-bare-birth-sweep.ts` | `SkipClassGuards`, `AssumeGuardsAndFacts` |
| `write-bare-condition-sweep.ts` | `TreatEqualIntegersAsLess`, `DropEdgeInSweep` |
| `write-bare-promise-sweep.ts` | `SkipFencesAfterLateStores`, `AssumeUnknownCallsReturnUndefined` |
| `write-heap-view-sweep.ts` | `AssumeIndexesInBounds`, `DropLengthCheckedReads` |
| `write-bare-getter-sweep.ts` | `AssumeGuardsAndFacts`, `DropLastCase` |
| `write-bare-iterate-sweep.ts` | `AssumeInvariantArrayStorage`, `IgnoreFreshArrayEscapes` |
| `write-indirect-element-sweep.ts` | `AssumeArithmeticElementUsers`, `MisplaceUncheckedAccesses` |
| `write-bare-sum-sweep.ts` | `SkipBoundsProof`, `SkipUnrollTripCountCheck` |
| `write-carried-text-sweep.ts` | `SkipInt32Reboxing`, `DropLengthCheckedReads` |
| `write-matrix-sweep.ts` | `MisplaceHoistedArrayStorage`, `SkipUnrollEntryChecks` |
| `write-product-modulo-sweep.ts` | `OverstateTypedArrayLength`, `SkipBoundsProof` |
| `write-second-name-sweep.ts` | `AssumeUnknownCallsReturnUndefined`, `AssumeGuardsAndFacts` |
| `write-aliased-nest-sweep.ts` | `AssumeInvariantArrayStorage`, `MisplaceHoistedArrayStorage` |
| `write-heir-field-sweep.ts` | `IgnoreEscapeAfterUnknownCall`, `SkipFencesAfterLateStores` |
| `write-store-and-test-sweep.ts` | `SkipLengthChecks`, `MisplaceUncheckedAccesses` |
| `write-ring-index-sweep.ts` | `AssumeArithmeticElementUsers`, `OverstateTypedArrayLength` |
| `write-number-text-sweep.ts` | `SkipInt32Reboxing`, `AssumeIndexesInBounds` |
| `write-growing-match-sweep.ts` | `IgnoreFreshArrayEscapes`, `DropEdgeInSweep` |
| `write-literal-fill-sweep.ts` | `IgnoreLoopArrayStores`, `AssumeLocalArrayReceivers` |
| `write-function-name-sweep.ts` | `MisnumberFunctionRecords`, `AssumeUnknownCallsReturnUndefined` |
| `write-proxy-trap-sweep.ts` | `AssumeUnknownCallsReturnUndefined`, `DropLengthCheckedReads` |
| `write-local-object-sweep.ts` | `SkipInt32Reboxing`, `SkipUnrollTripCountCheck` |
| `write-first-turn-sweep.ts` | `AssumeArithmeticElementUsers`, `MisplaceHoistedArrayStorage` |
| `write-converted-store-sweep.ts` | `AssumeNoNaNStores`, `SkipBoundsProof` |
| `write-wide-index-sweep.ts` | `AssumeIndexesInBounds`, `DropLengthCheckedReads` |
| `write-narrowed-capture-sweep.ts` | `MisnumberFunctionRecords`, `OverstateTypedArrayLength` |
| `write-hole-read-sweep.ts` | `IgnoreFreshArrayEscapes`, `MisplaceHoistedArrayStorage` |
| `write-folded-key-sweep.ts` | `AssumeInlineBuiltinsPure`, `DropLengthCheckedReads` |
| `write-two-statements-sweep.ts` | `MisplaceUncheckedAccesses`, `IgnoreCollectorSpillReads` |
| `write-two-members-sweep.ts` | `AssumeNullishHostResults`, `SwapBuiltinCellNumbers` |
| `write-function-call-sweep.ts` | `AssumePermanentlyPristineIterables`, `SkipUnrollTripCountCheck` |
| `write-asked-text-sweep.ts` | `AssumeInlineBuiltinsPure`, `AssumeIndexesInBounds` |
| `write-outgrown-counter-sweep.ts` | `MisplaceHoistedArrayStorage`, `OverstateTypedArrayLength` |
| `write-changed-member-sweep.ts` | `AssumeGuardsAndFacts`, `MisnumberFunctionRecords` |
| `write-moved-elements-sweep.ts` | `AssumeNoNaNStores`, `SkipStorageChecks` |
| `write-known-text-sweep.ts` | `AssumeUnknownCallsReturnUndefined`, `AssumeArgumentsNeverEscape` |
| `write-laid-in-steps-sweep.ts` | `AssumeGuardsAndFacts`, `IgnoreEscapeAfterUnknownCall` |
| `write-constant-place-sweep.ts` | `AssumeInBoundsElementsPresent`, `IgnoreLoopArrayStores` |
| `write-seen-early-sweep.ts` | `IgnoreMarksInShapeChecks`, `SkipFencesAfterLateStores` |
| `write-changed-parent-sweep.ts` | `SkipHierarchyGuards`, `SkipClassGuards` |
| `write-same-each-time-sweep.ts` | `SkipUnrollTripCountCheck`, `SkipLengthChecks` |
