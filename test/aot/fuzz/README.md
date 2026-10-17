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
| validated facts | any build, with `BUN_JSC_validateAOTTypedFacts=1` where the program is built | |
| release | | |

Each form lists the collector modes to run its executables in: `plain`, `full` (a collection at every third allocation that leaves the fast path, freed cells
overwritten) and `young` (the same with young collections, which depend on write barriers).

## When it finds something

1. `<out>/NEW.tsv` has one line for the first finding of each signature that `known-differences.tsv` does not explain, and `<out>/finds/<signature>/case-*/` the program, both outputs and a `meta.json`.
2. Make it small: `python3 reduce.py main.ts small.ts -- python3 still.py config.json <form> <mode> <verdict>`.
3. The small program goes to `../programs/counterexamples/` with the fix. A difference that is meant gets a line in `known-differences.tsv`, with the reason.

A death by a signal, a sanitizer report or a failed assertion is always a bug. A time limit that runs out is no verdict: the farm runs at idle priority on busy machines.
