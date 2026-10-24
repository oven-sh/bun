# The fuzzer

`run.ts` draws small programs from thirty-six sources, runs each compiled and in plain Bun, and keeps what differs: confirmed, reduced, and attributed to the pass or the
result of the flow analysis without which it goes away. `../fuzzer-fixed-seeds.test.ts` runs a small, fixed part of it in CI.

```sh
bun test/aot/fuzz/run.ts --seconds 3600 --jobs 16 --validate --out /tmp/fuzz    # the Bun that runs this is the Bun under test
bun test/aot/fuzz/run.ts --rounds --seconds 3600 --jobs 12 --validate --out /tmp/fuzz   # for days: an hour a round, each in /tmp/fuzz/<n>, until /tmp/fuzz/STOP exists
bun test/aot/fuzz/run.ts --replay grammar:1234                                  # one program again, printed with its verdicts
```

Lanes that look elsewhere than the default one. Several at once find more than one of them alone at the same width:

```sh
stress="--collector-stress 1,2,3,5,7,11 --run-seconds 2 --compiled-run-seconds 60"   # a collection at every n-th allocation that leaves the fast path, full or young, drawn anew for every batch: one interval is blind to what another sees
.. --as-a-user --no-attribution --modes cold-and-very-large,erased-cold-and-very-large,counts-as-very-large $stress --fenced   # what a very large program gets, which a small one never does by itself
.. --modes default,every-function-hot --fail-predictions 1,2,7   # the general road behind every test, taken though the value would have passed: the answer must not change
.. --as-a-user --no-attribution --modes every-function-hot,erased-and-hot $stress   # what a user builds, everything hot, under collector stress
.. --as-a-user --no-attribution --modes nothing-inlined $stress
.. --bun <a build with AddressSanitizer> --as-a-user --no-attribution --sources every-kind-of-job:6,objects-across-awaits:2,held-across-suspensions --run-environment "BUN_JSC_collectContinuously=1 BUN_JSC_useGenerationalGC=0" --jobs 8 --compiled-run-seconds 180 --environment "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1 Malloc=1"   # a collector that never rests and marks the whole heap each time, beside the program, while functions wait; half as many jobs as cores, so that it does run beside it; with --workers 4 too
.. --as-a-user --no-attribution --sources work-on-the-way-up:3,where-the-stack-ends --modes default,cold-and-very-large,counts-as-very-large --collector-stress 0,0,7,23 --compiled-run-seconds 60   # the end of the stack, and what runs on the way up
.. --as-a-user --no-attribution --sources when-the-heap-is-full --batch 4 --modes default,cold-and-very-large --run-environment "BUN_JSC_markedBlockCageSizeInMB=64" --run-seconds 30 --compiled-run-seconds 150   # a full heap, and what runs behind the caught error
.. --as-a-user --no-attribution --sources held-by-one-thing-alone --modes default,cold-and-very-large,erased --collector-stress 0,0,7,23   # what one thing alone holds, told by weak references and finalizers
.. --as-a-user --no-attribution --sources errors-nobody-catches --modes default,cold-and-very-large,erased --collector-stress 0,0,23   # errors and rejections that nobody catches, and what runs behind them
.. --as-a-user --no-attribution --sources shapes-that-die-and-come-again --modes default,cold-and-very-large,erased --collector-stress 0,0,23,47   # what a place in the code remembers about a shape dies with the shape
.. --as-a-user --no-attribution --sources workers-ended-in-the-middle --batch 1 --modes default,cold-and-very-large,erased --compiled-run-seconds 40   # a Worker that is busy without end is ended: each program is its own Worker, so it stands alone in its build
.. --as-a-user --no-attribution --sources calls-with-very-many-arguments --modes default,cold-and-very-large,counts-as-very-large,erased --run-seconds 40 --compiled-run-seconds 60   # arguments counted at run time, from none to more than any stack holds
.. --as-a-user --no-attribution --sources strings-still-in-pieces,changed-while-it-is-walked,left-half-way,numbers-across-their-borders,at-the-border-of-a-representation,patterns-made-at-run-time,lists-read-where-they-are-made --modes default,cold-and-very-large,erased,every-function-hot,nothing-inlined --collector-stress 0,0,7,23   # strings still in pieces, things that change while they are walked, generators left half way, numbers and sizes at the borders of their representations
.. --sources strings-still-in-pieces,changed-while-it-is-walked,left-half-way,numbers-across-their-borders,at-the-border-of-a-representation,patterns-made-at-run-time,lists-read-where-they-are-made --modes default,every-function-hot,cold-and-very-large --fail-predictions 2,2,7,1   # the same on the general road behind every test
.. --validate --sources numbers-however-they-are-kept:6,lists-read-where-they-are-made:2 --modes default,every-function-hot,nothing-inlined,validate,cold-and-very-large   # one number, kept beside fractions or other things, handed to everything that takes a number: every proof is asked again at run time
.. --validate --sources objects-read-where-they-are-made:4,left-half-way --modes default,every-function-hot,validate,cold-and-very-large   # small objects that need not exist, seen from outside late or never
.. --as-a-user --no-attribution --sources patterns-that-go-back-for-millions-of-turns --batch 1 --modes default --run-seconds 30 --compiled-run-seconds 200   # patterns out of run-time text on both sides of the hundred million turns at which plain Bun gives a match up: an executable finds every match that plain Bun finds, and ends where it ends
.. --as-a-user --no-attribution --sources patterns-with-subjects-made-from-them --batch 4 --modes default,every-function-hot   # patterns out of run-time text, most of them in unicode mode, each on subjects that are made from it: pairs of surrogates, halves and characters of 16 bits at every place that takes any character
.. --as-a-user --sources errors-of-values-nobody-uses --batch 8 --modes default,every-function-hot,cold-and-very-large,erased   # operations that throw where nobody uses their value: the error comes all the same, at its place
.. --as-a-user --sources two-names-where-ways-meet --batch 8 --modes default,every-function-hot,erased   # two names for one object, one of them given another object on a way that is seldom taken: where the ways have met, each names its own
.. --as-a-user --sources objects-with-very-many-fields --batch 4 --modes default,every-function-hot,erased   # where a member lies goes by its number: objects past thirty-two, sixty-four, a hundred and twenty-eight members
.. --as-a-user --no-attribution --sources programs-as-they-are --batch 8 --modes default,every-function-hot --company 33,65,130,300   # the programs of ../programs unchanged, beside so many unrelated shapes that hold their names: what is expected of `o.x` goes by every shape of the whole program with an `x`
.. --as-a-user --no-attribution --sources one-key-asked-in-every-way --batch 8 --modes default,every-function-hot,erased,cold-and-very-large   # one key, one value, every way to ask: a read that found nothing, then `in`, a store, a delete
.. --as-a-user --no-attribution --sources closures-read-through-array-methods --batch 8 --modes default,every-function-hot,erased,nothing-inlined   # a chain of array methods that becomes one loop: each turn keeps variables of its own
.. --as-a-user --no-attribution --sources objects-that-live-for-one-turn-of-a-loop --batch 8 --modes default,every-function-hot,erased,nothing-inlined   # what a turn of a loop makes and nobody keeps: each turn has its own, and what an earlier turn made is still what it was
.. --as-a-user --no-attribution --sources every-birth-and-use --batch 8 --modes default,every-function-hot   # every pair of the generated suite, not one in forty
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
| `grammar.ts`, `protocols.ts`, `new-targets.ts`, `object-mutations.ts`, `typed-object-mutations.ts`, `held-across-suspensions.ts`, `where-the-stack-ends.ts`, `many-of-one-thing.ts`, `changing-buffers.ts`, `many-live-values.ts`, `a-throw-at-every-call.ts`, `values-across-joins.ts`, `operators-at-the-edges.ts`, `objects-across-awaits.ts`, `every-kind-of-job.ts`, `work-on-the-way-up.ts`, `text-beside-compiled-code.ts`, `unsound-types.ts`, `mutate.ts`, `sources.ts` | the seventeen sources: programs made from a grammar, objects that answer the language's protocols, constructors that run for another `new.target`, objects that are changed behind the code that uses them, the same behind a reference of a declared type, values that nothing holds but a function that waits at an `await` or a `yield`, recursions that reach the end of the stack, programs with thousands of one thing, typed arrays whose memory is detached, shrinks, grows or moves while they are in use, functions with much control flow and many values of several kinds alive at once, values of every width and kind that many paths hand on to one place, a few operators at the ends of the ranges of their operands, many async functions at once whose fresh objects nothing else holds, text that becomes code at run time beside the objects of compiled code, values that reach a place their type excludes without a cast, and mutants of `../programs` |
| `when-the-heap-is-full.ts`, `held-by-one-thing-alone.ts`, `errors-nobody-catches.ts`, `shapes-that-die-and-come-again.ts`, `workers-ended-in-the-middle.ts`, `calls-with-very-many-arguments.ts` | more sources: objects kept alive until no more fit and work behind the caught error, an object that one thing alone holds across a collection, errors and rejections that nobody catches, shapes that die in a collection and are made again a little differently, Workers that are busy without end and are ended, calls whose arguments are counted at run time |
| `strings-still-in-pieces.ts`, `changed-while-it-is-walked.ts`, `left-half-way.ts`, `numbers-across-their-borders.ts`, `at-the-border-of-a-representation.ts`, `patterns-made-at-run-time.ts`, `lists-read-where-they-are-made.ts` | more sources: joined strings that nobody has read yet, handed to everything that needs their characters; arrays, Maps, Sets and objects changed at one step of the walk over them; generators closed, thrown into or dropped at every stop; counters, sums and indexes that cross the ends of int32, uint32 and the safe integers; lists, objects, tables and switches one element on either side of a power of two; regular expressions whose text arrives at run time; lists of numbers read in the function that makes them |
| `numbers-however-they-are-kept.ts` | one more: a number in a variable that holds other kinds of numbers, or other things, at other times, used right there as an element, an index, a length, a key, a field, an argument, an operand, a case and as text |
| `objects-read-where-they-are-made.ts` | one more: small objects made out of a function's own variables, changed and read right there, under one name or two, seen from outside late, on one path alone, or never |
| `patterns-that-go-back-for-millions-of-turns.ts` | one more: patterns made at run time whose first alternative fails only behind millions of turns of its groups and whose last matches at once, at lengths around the place where plain Bun gives up |
| `patterns-with-subjects-made-from-them.ts` | one more: patterns made at run time, seven of eight with the flag u or v, and subjects drawn from the pattern itself, so that most fit or fail by one unit: a pair of surrogates between literals, at the end of a match of a fixed size, behind a lookbehind, across the border of a block of a long subject, cut in half or exchanged |
| `programs-published-as-packages.ts` | a command of its own (`bun programs-published-as-packages.ts --bun <bun> --work <folder> --out <folder>`): every typed program of nine sources is published with `bun compile --library`, laid into `node_modules` as it was written or damaged in one of five ways, imported by a program that `bun compile` builds, and the executable prints what plain Bun prints for the program itself; it counts how many packages were compiled from their full types and the words of every warning that took them away |
| `errors-of-values-nobody-uses.ts` | one more: operations that throw, as a statement, under void, in a constant nobody reads, as an element, member, argument or default nobody looks at, in loops that run three times or never, in front of a second one that throws |
| `two-names-where-ways-meet.ts` | one more: two names for one object, one of which is given another object in a handler, a `finally`, an arm or a turn that is seldom taken; behind a call or a stop both are compared, stored into each other, handed on and written through |
| `objects-with-very-many-fields.ts` | one more: literals, classes, prototypes and static sides with thirty to three hundred members, some under symbols, read by name, by key and from below through a chain, then changed and read again |
| `one-name-for-many-kinds-of-things.ts` | one more: a variable, field or element that holds a function, a record without a class of its own and a list, typed array, Map, Set or pattern in the course of the program, and is used by element, by name, by call and by a walk |
| `objects-that-the-host-keeps-and-hands-back.ts` | one more: a fresh object handed to a timer, a promise, an event, a signal, a stream, an async context, a socket or a file; the host hands it to a callback that changes it, or writes into it itself, turns of the event loop later; then its maker reads it again |
| `one-key-asked-in-every-way.ts` | one more: a key and a value of every kind, asked by a read, `in`, `Object.hasOwn`, stores, a delete, a call and patterns, one behind the other for many turns: what one way has learned about the pair is no answer for another |
| `closures-read-through-array-methods.ts` | one more: closures over the variables of one turn of a loop or of an array method, some of which make closures again, read through one to five array methods that follow one another, there or in a reader that many scenes share and reach by a call, `.call`, `.apply`, `Reflect.apply` or a built-in; some scenes run once and some often |
| `objects-that-live-for-one-turn-of-a-loop.ts` | one more: objects, lists, instances, closures and the variables that closures share, made anew in each turn of a loop, coming to their use where ways meet, out of a list, a pattern, a call or a step of a generator, around handlers, labels, stops and calls of the function itself, and read again behind the loop |
| `sources.ts` (`every-birth-and-use`) | one more: the programs of `../generated/births-and-uses`, of which the tests run one in forty: all of them, one after the other |
| `memory-of-churn.ts` | no source, a command of its own: containers filled and emptied for millions of operations, in plain Bun and as an executable, judged by the largest resident size |
| `company.ts` | no source: the module of unrelated shapes that `--company` builds beside a batch; they hold the names its programs use |
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
