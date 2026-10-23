# The fuzzer

`run.ts` draws small programs from ten sources, runs each compiled and in plain Bun, and keeps what differs: confirmed, reduced, and attributed to the pass or the
result of the flow analysis without which it goes away. `../fuzzer-fixed-seeds.test.ts` runs a small, fixed part of it in CI.

```sh
bun test/aot/fuzz/run.ts --seconds 3600 --jobs 16 --validate --out /tmp/fuzz    # the Bun that runs this is the Bun under test
bun test/aot/fuzz/run.ts --rounds --seconds 3600 --jobs 12 --validate --out /tmp/fuzz   # for days: an hour a round, each in /tmp/fuzz/<n>, until /tmp/fuzz/STOP exists
bun test/aot/fuzz/run.ts --replay grammar:1234                                  # one program again, printed with its verdicts
```

Lanes that look elsewhere than the default one. Several at once find more than one of them alone at the same width:

```sh
stress="--collector-stress 1,2,3,5,7,11 --run-seconds 2 --compiled-run-seconds 60"   # a collection at every n-th allocation that leaves the fast path, full or young, drawn anew for every batch: one interval is blind to what another sees
.. --as-a-user --no-attribution --modes every-function-hot,erased-and-hot $stress   # what a user builds, everything hot, under collector stress
.. --as-a-user --no-attribution --modes nothing-inlined $stress
.. --workers 4 --modes default,every-function-hot        # four workers run each program at once: compiled code and its tables are shared by all threads
.. --bun <a build with AddressSanitizer> --as-a-user --no-attribution --sources changing-buffers --modes default,every-function-hot,erased-and-hot --environment "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1 Malloc=1"
.. --bun <a build with AddressSanitizer> --as-a-user --no-attribution --modes every-function-hot,erased-and-hot --environment "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1 Malloc=1"
.. --sources typed-object-mutations:4,unsound-types:4,grammar,mutation --validate --modes default,every-function-hot,validate   # typed programs, never erased
.. --modes no-flow-results,hot-without-flow-results      # the code with every guard and every slow road in it
.. --modes default,every-function-hot --flags --aot-disable=pass:<name>   # one optional pass off a round, walking `--aot-list=registry`
.. --threads 16 --jobs 2 --batch 64                      # the compiler's own threads, and what shows only in a shared build
```

`AOT_FUZZ_TYPESCRIPT=<node_modules/typescript>` lets the source `unsound-types` ask TypeScript's own checker. `--bun <path>` tests another Bun than the one that runs the fuzzer.

| File | What it holds |
| --- | --- |
| `run.ts` | the command line; its header lists every option and the files written to `--out` |
| `fuzzer.ts` | the driver: draw, judge, confirm, reduce, attribute, tell findings apart |
| `grammar.ts`, `protocols.ts`, `new-targets.ts`, `object-mutations.ts`, `typed-object-mutations.ts`, `held-across-suspensions.ts`, `where-the-stack-ends.ts`, `changing-buffers.ts`, `unsound-types.ts`, `mutate.ts`, `sources.ts` | the ten sources: programs made from a grammar, objects that answer the language's protocols, constructors that run for another `new.target`, objects that are changed behind the code that uses them, the same behind a reference of a declared type, values that nothing holds but a function that waits at an `await` or a `yield`, recursions that reach the end of the stack, typed arrays whose memory is detached, shrinks, grows or moves while they are in use, values that reach a place their type excludes without a cast, and mutants of `../programs` |
| `type-check.ts` | TypeScript's own checker, for the source whose programs it has to accept |
| `beds.ts`, `engine-probes.ts` | where a program runs: `bun build --compile --aot`, or the engine's test binaries, which are asked first which built-ins they lack |
| `reduce.ts` | makes a failing program small |
| `accepted-differences.tsv` | differences that are meant, and what a bed cannot do: counted, not kept |

A finding is a folder `findings/<kind and what is guilty>/` with `reduced.*`, `original.*`, both outputs and `finding.json`. The small program goes to `../programs` with the fix.

A failure that shows only while other programs share the build is kept as `findings/<kind> only together <..>/`: `p0.*` is the program, the other `p*` are the companions it needs, `main.js` imports the one its argument names, and `commands.txt` builds and runs it.

After ten findings of a group no more of that group are stored, so move a finding out of `findings/` once it has been looked at.

A finding whose name says `no switch` goes away with no pass and no result of the flow analysis switched off. Most of these are no fault of the compiler: the program prints what differs by design.
What plain Bun prints differently each time it runs is dropped and listed in `unstable.tsv`; a kind that comes again gets a line in `accepted-differences.tsv`.

## Values that reach a place their type excludes (`unsound-types`)

`../generated/unsound-types.ts` puts each program together from a hole of TypeScript's type system, a type, the value that arrives, the place where the reference is held, the kind of function that uses it, the time and the uses. A program is clean under `strict` and has no cast, no `any` and no `!`: `type-check.ts` asks TypeScript itself, and what it refuses is listed in `refused-by-typescript.tsv` and not run. That is a bug of the generator.

- A program is about one hole, which is its group: `groups.tsv` counts programs, runs and failures by hole, and two holes that fail with the same words are two findings.
- It has up to four cases, each with its own declarations. A finding is cut down to the case that fails by itself before it is reduced.
- The table `filed` at the top of the generator lists the holes, forms and uses that run into a bug that is filed already. They are not drawn. Take a line out when its fix is in. `AOT_FUZZ_UNSOUND_HOLES=a,b` draws from those holes only, filed or not.
- `../generated-unsound-types.test.ts` runs every hole that is not filed from fixed seeds.

```sh
bun test/aot/fuzz/run.ts --sources unsound-types:8,grammar --validate --out /tmp/fuzz    # eight programs of it for one of the grammar
bun test/aot/fuzz/run.ts --sources unsound-types --count-only --out /tmp/census          # which holes fail, and how: nothing is reduced
bun test/aot/generated/unsound-types.ts /tmp/programs --count=1000 && bun test/aot/fuzz/type-check.ts /tmp/programs
```

# The fuzz farm

`farm.py` makes programs without end and runs each against several builds of Bun. `AOT_FRESH_SEEDS=1` makes the tests run a small part of the same thing with a new seed
(`../generated-fresh-seeds-*.test.ts`, `../mutated-programs-*.test.ts`); this folder is for machines that have hours.

```sh
python3 test/aot/fuzz/farm.py config.json                 # round after round, until <out>/STOP exists
python3 test/aot/fuzz/farm.py config.json --rounds 1 --programs 300 --only typed-programs
python3 test/aot/fuzz/farm.py config.json --replay generated:objects 2000001389 --form release --mode plain --keep /tmp/case
python3 test/aot/fuzz/report.py <out>/counts.tsv --by form   # or: --by producer
```

The top of `farm.py` describes the config, the verdicts and the files it writes.

## What makes the programs (`producers.py`)

| Producer | Programs |
| --- | --- |
| `generated:<name>` | `../generated/python/<name>.py <seed>`: every generator listed in `../generated/python-generators.ts`. A generator that is a table (`<name>.py count`) is walked through; the others get seeds that were never used |
| `mutated:ts`, `mutated:js` | a program of `../programs`, changed a little: another constant, operator, string or identifier, a statement dropped, repeated or moved |
| `border:ts` | the same programs with a statement inserted that does to an object in scope what untyped code may do: freeze, delete, define, another prototype, extra and indexed properties, a proxy |
| `corpus:programs` | the programs of `../programs` as they are |

## The builds that matter

| Form | What it is | What only it has found |
| --- | --- | --- |
| as Bun ships | link-time optimization and the symbol order file | registers that unwinding did not restore: whether that crashes depends on register allocation |
| AddressSanitizer with assertions | `--profile=release-local --asan=true --assertions=true` | an assertion that had been false for two days, behind which an ordinary object lost its prototype |
| validated | any build, with `"build_flags": ["--aot-validate"]` in the form | |
| release | | |

A Bun that was built with `--asan=true` against a WebKit built beside it sees no allocation of WTF (strings, vectors, hash tables, objects from the fast allocator) unless `Malloc=1` is in
the environment of every process. `../a-matcher-asks-a-compiled-object-for-a-name-nothing-else-has.test.ts` once told the two apart: silent without it, a use after free with it.

Each form lists the collector modes to run its executables in: `plain`, `full` (a collection at every third allocation that leaves the fast path, freed cells
overwritten) and `young` (the same with young collections, which depend on write barriers).

## When it finds something

1. `<out>/NEW.tsv` has one line for the first finding of each signature that `known-differences.tsv` does not explain, and `<out>/finds/<signature>/case-*/` the program, both outputs and a `meta.json`.
2. Make it small: `python3 reduce.py main.ts small.ts -- python3 still.py config.json <form> <mode> <verdict>`.
3. The small program goes to `../programs/counterexamples/` with the fix. A difference that is meant gets a line in `known-differences.tsv`, with the reason.

A death by a signal, a sanitizer report or a failed assertion is always a bug. A time limit that runs out is no verdict: the farm runs at idle priority on busy machines.
