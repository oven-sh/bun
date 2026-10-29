# Fuzzing the ahead-of-time compiler

`run.ts` generates small programs forever. It runs each one twice, once with `bun <file>` and once as an executable built with `bun build --compile --aot`, and keeps every program where the two
runs differ, the build fails, or the executable crashes.

Nothing in this folder runs in CI except the fuzzer's own tests (`../fuzzer-*.test.ts`). Run it by hand after a compiler change, for as long as you can spare a machine.

## Run it

```sh
bun test/aot/fuzz/run.ts --seconds 3600 --jobs 16 --out /tmp/fuzz
```

- `bun` must be built from this tree (`bun run build:release` leaves it at `build/release/bun`). The Bun that runs the script is the Bun under test; `--bun <path>` tests another one.
- Start it from the repository root. It needs no network and no reference build.
- Two sources start `python3` and generate nothing if it is missing. `--rewritten` needs the `typescript` package, which `bun install` at the root installs.
- The comment at the top of `run.ts` lists every option.

| Goal                                    | Command                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Check that the fuzzer itself works      | `--seconds 120 --jobs 4` (a few hundred programs)                                        |
| A change to one part of the compiler    | ten minutes to an hour of the sources that target it: `--sources <a>,<b> --seconds 3600` |
| A release, or a change to flow analysis | every source overnight: `--rounds --seconds 3600 --jobs 32`, until `<out>/STOP` exists   |

A build takes about a second of one core, so sixteen jobs judge tens of thousands of programs an hour. Most findings come in the first hour after a change.

On Linux every program, plain and compiled, runs in its own PID namespace and process group (`unshare --user --pid`, `setsid`) where the kernel allows it, so a generated program cannot signal
anything but itself. In addition, a program that mentions `kill` is not run at all (`accepted-differences.tsv`).

## Options that find different bugs

One run tests one way to build. Several runs side by side, each with different options, find more than one wide run.

```sh
.. --modes default,hot,cold     # how hot a function is decides how it is compiled
.. --modes default,separate-entry-points                             # every program is its own entry point: the compiler proves more about a small program
.. --batch 1                                                  # every program gets its own build: a shared build hides false flow-analysis claims
.. --modes large,cold-large           # code paths that only a very large application gets
.. --modes check-proofs,hot-check-proofs             # the executable checks at run time what the compiler proved
.. --validate                                                 # the same, in a fully validating build
.. --modes check-moved-loads,check-claims                 # the same for hoisted loads and for what the back end is told
.. --modes no-flow-results,hot-no-flow-results           # every guard and slow path stays in the code
.. --gc-stress 1,2,3,5,7,11 --compiled-run-seconds 60  # a collection at every n-th slow-path allocation
.. --fail-predictions 1,2,7                                   # take the slow path although the fast one would have worked
.. --lowered-limits                                           # one compiler limit at 0, 1 or 2: a small program hits what only a large one does
.. --rewritten                                            # also rewrite each program so that it prints the same and the compiler knows less about it
.. --company 33,65,130,300                                    # build beside that many unrelated object shapes that use the same property names
.. --workers 4                                                # four workers run each program at once
.. --threads 16 --jobs 2 --batch 64                           # the compiler's own threads, and bugs that only show in a shared build
.. --no-verifiers                                                # leave the compiler's verifiers off, as in a user's build
.. --flags --aot-disable=pass:<name>                          # one optional pass off (`--aot-list=registry` lists them)
```

Every executable that exits normally is run a second time with `BUN_JSC_validateAOTRuntime=1`, which turns on the run-time checks; `--run-once` skips that.

With an AddressSanitizer build, pass `--bun <path> --environment "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1 Malloc=1"`. Without `Malloc=1`, ASan does not see WTF's allocations (strings,
vectors, hash tables). To test several builds of Bun on the same programs, start one run per build with the same `--seed`.

Some sources need their own settings to be useful:

| Sources                                                        | Options                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `out-of-memory-recovery`, `builtin-allocation-after-full-heap` | `--batch 4 --run-environment BUN_JSC_markedBlockCageSizeInMB=64 --compiled-run-seconds 150`                  |
| `work-during-stack-unwinding`, `stack-overflow-points`         | `--gc-stress 0,0,7,23 --compiled-run-seconds 60`                                                             |
| `workers-terminated-midway`                                    | `--batch 4 --compiled-run-seconds 40`                                                                        |
| `regexp-heavy-backtracking`                                    | `--batch 1 --run-seconds 30 --compiled-run-seconds 200`                                                      |
| `last-reference-read-during-allocation`                        | `--run-environment "BUN_JSC_slowPathAllocsBetweenGCs=1 BUN_JSC_scribbleFreeCells=1 BUN_JSC_useZombieMode=1"` |
| `builtin-own-properties-by-name`                               | `--single-file --no-verifiers --validate --modes default,validate --batch 1`                                 |

`burst.ts` starts many such runs side by side, shares the machine's cores among them, and lists what they found in `<out>/NEW.tsv`:

```sh
bun test/aot/fuzz/burst.ts --minutes 60 --out /tmp/burst
```

Four of its lanes run `fuzzilli/lane.ts` instead of `run.ts`; see `fuzzilli/README.md`.

## Sources

A source turns a number, the seed, into a program. `--sources a,b:8` picks sources and weights them; by default all are used. A source's name is its file name. The comment at the top of each file
says what its programs are about.

- **Generators.** Most `.ts` files in this folder export `generate(random)`, which writes a random program about one subject. `sources.ts` registers them.
- **Tables.** A few files count their programs and export `programOf(index)`, for example every kind of loop crossed with every kind of typed array. The seed picks the row.
- **Lists**, in `sources/`. Where some programs need a flag, an environment variable or extra entry points, a file in `sources/` lists them with the helpers in `family.ts`.
- **Scripts.** `case-scripts/*.py` each write a folder of small cases (source `scripted-cases`); `generators/python/*.py` each write one random program per seed (source `by-python`).
- **Stored programs.** `mutation` mutates the programs in `../parallel`; `stored-programs` runs them unchanged.

Every second program is also generated as `<source>-multi-file`: its top-level declarations move into up to four more files, some of them JavaScript, some with incomplete or invalid
declaration files, some published as packages. `--single-file` turns that off.

`unsound-types` (in `generators/`) builds each program from one hole in TypeScript's type system, so that a value reaches a place whose type excludes it without a cast, `any` or `!`. `type-check.ts` asks
TypeScript itself; programs it rejects are listed in `refused-by-typescript.tsv` and not run. The table `filed` at the top of the generator lists holes that hit an already filed bug; remove a line
when its fix lands.

`json-for-generated-types.ts` is a separate tool. It generates TypeScript types, writes one program that parses JSON under each of them, builds it and lets it generate its own inputs:

```sh
bun test/aot/fuzz/json-for-generated-types.ts --seconds 3600 --jobs 16 --out /tmp/json
```

## Findings

`<out>/findings.tsv` gets one line per finding: time, build mode, kind of failure, `<source>:<seed>`, a name, and the first two lines that differ. `<out>/findings/<name>/` holds

- `reduced.*`, the program reduced as far as the failure allows (a folder if it has several files), and `original.*`;
- `plain.txt` and `compiled.txt`, the output of the two runs;
- `finding.json`: seed, source, mode, flags, and the pass or flow-analysis result without which the failure goes away.

`<out>/as-tests/<name>.<ext>` is the reduced program again in the format of `../parallel`, with its flags, entry points and exit code in its first lines.

Kinds of failure: `different output`, `different exit code`, `crash` and `hang` for the executable; `internal compiler error`, `build crash`, `build hang`, `build error` and `build refused` for the
build; `validation failure` when a run-time check caught a false proof. A signal or a failed assertion is always a bug. A timeout on a busy machine is not.

A difference in output or exit code that an executable built without `--aot` shows too comes from the bundler or the standalone runtime, not from the compiler. It is listed in
`<out>/same-without-aot.tsv` and is not a finding.

`bun test/aot/fuzz/run.ts --replay <source>:<seed>` generates the same program again and prints it with its verdicts; `--print-only` only prints it.

## Accepted differences

`accepted-differences.tsv` lists differences that are intended (locked built-ins, for example), bugs in plain Bun, and things a test setup cannot do. Each line is a regular expression, who is
responsible, and the reason. A finding that matches is counted and not kept. The comment at the top of the file describes the format. Try a new line on the seed that produced the finding before you
commit it: the status line must say `known 1`.

## From a finding to a test

1. Replay it alone on a fresh build to see that it is still there.
2. Take its file under `<out>/as-tests/` and reduce it by hand until every line is needed. `bun test/aot/run-parallel.ts --root=<out>/as-tests <file>` runs it the way CI will.
3. Fix the compiler.
4. Commit the small program with the fix, as `test/aot/parallel/<topic>/<what-it-tests>.<ext>` or as a folder with `main.<ext>`. Flags go in its first lines: `// Flags: --aot-validate`,
   `// Env: TZ=America/New_York`, `// Entry points: ./child.cjs` (`../run-parallel.ts` lists them all). A bug in one pass is better pinned by an IR test under `test/aot/engine-tests/`.
5. Commit nothing else: no seeds, no lists of programs that once failed, no generator output. The generator can produce them again.

## Adding a source

Write `<subject>.ts` with `export function generate(random: Random, typed: boolean): string` and add its name to one of the three lists of names in `sources.ts`: TypeScript, JavaScript, or both (odd
seeds are TypeScript). Start the file with a comment that says what its programs test. Every program must print what it computes, print the same in every run, and exit by itself within a second or two.

## Layout

| Path                       | What it is                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ |
| `run.ts`, `burst.ts`       | the command line: one run, and many runs side by side                          |
| `fuzzer.ts`                | the main loop: generate, build, compare, confirm, reduce, store                |
| `runners.ts`               | how a program is built and run, the build modes, and how two runs are compared |
| `sources.ts`, `family.ts`  | the registry of sources, and helpers for sources that are lists                |
| `reduce.ts`                | the reducer                                                                    |
| `mutate.ts`, `tokens.ts`   | mutation of stored programs                                                    |
| `grammar.ts`               | the general-purpose random program generator                                   |
| `type-check.ts`            | TypeScript's own checker over generated programs                               |
| `accepted-differences.tsv` | differences that are not findings                                              |
| `*.ts`, `generators/`      | generators, one subject each                                                   |
| `sources/`                 | sources that are lists                                                         |
| `case-scripts/`            | Python scripts that write tables of small cases                                |
| `fuzzilli/`                | a Fuzzilli profile and driver for the compiler                                 |
