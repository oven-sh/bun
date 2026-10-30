# Measuring the code that `bun build --compile --aot` generates

Start here when you want to know whether a change to the compiler made programs faster or slower.

## Compare two builds

```sh
bun test/aot/perf/compare-builds.ts --before <bun> --after <bun>
```

It needs Linux, and hardware counters that a user may read (`sysctl kernel.perf_event_paranoid` at 2 or below). It measures with both Buns:

- **every small benchmark** of `idioms/` and `everyday/` (about 1,800), as TypeScript and as the same text without its types, in three program sizes;
- **one request of each route of seven servers** (`../servers/app`: Bun.serve, node:http, Hono, Elysia, Express, Fastify, Koa).

Then it prints every row that moved by more than 2% and two instructions, and exits with 1 if a row got slower:

```
5,490 rows compared, instructions per turn or per request, threshold 2%

2 got slower
  +4.3%          532.0 >        554.0  small typed everyday-small-objects/arguments-kept-in-a-new-object
  +2.6%       55,130.1 >     56,570.4  server koa text

0 got slower, and so did the same code under the JIT: look in the runtime, not in the compiler

1 got faster
  -52.2%         186.1 >         89.0  called typed text/char-code-at-loop-in-function
```

A row that moved is measured a second time on both sides. It is printed only if both readings of one Bun lie beyond both readings of the other by more than the threshold.

| You want                                | Add                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A quick answer (13 minutes on 16 cores) | `--only '^[a-z-]+/'`: the 260 benchmarks of `idioms/` alone. Everything takes an hour and a half                                                                                     |
| One group, one benchmark                | `--only '^text/'`, `--only 'char-code-at'`                                                                                                                                           |
| No servers, or some                     | `--servers none`, `--servers koa,fastify`                                                                                                                                            |
| No network                              | `--modules <node_modules>`: what `bun install` made of `../servers/app/package.json`                                                                                                 |
| A baseline that is measured once        | `--out <folder>` on the first run, then `--before <folder>/before`                                                                                                                   |
| What a compiler flag costs              | the same Bun on both sides and `--build-flag=--aot-disable=<pass>`. A server whose executable the flag leaves as it is has the same code on both sides: it is named and not measured |
| Another threshold                       | `--threshold 0.5`                                                                                                                                                                    |

### The three program sizes

The same text is not compiled the same way everywhere, and a change often moves one size only.

| Size         | What it models                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `small`      | The benchmark is the whole program. Its loop calls `turn()` directly, so `turn()` is usually copied into the loop                                    |
| `called`     | The loop finds `turn()` at run time. `turn()` stays a function with a caller, like most functions of a real program                                  |
| `very-large` | The same, compiled the way it would be inside a very large program, where only code in a loop or with several callers counts as code that runs often |

### How a number is made

The cost of a turn is the difference between a run of _n_ turns and a run of _n_ / 4, divided by 3 _n_ / 4. Start-up and warm-up cancel out. Instructions are counted in user mode over the whole
process with `perf_event_open`. Collections run on the program's own thread, at points that depend only on what was allocated. So a number does not depend on the load of the machine, and most rows
repeat to the instruction.

A server is started three times, and each route takes the least of the three: what the runtime's caches learn in the first requests differs from start to start, and can cost a route 3% for as
long as the process lives. Requests go one after the other over one connection, every answer is compared, and the counter is read between blocks of 200 requests of one route, while the server
waits. The number is the median of 40 blocks, so it leaves out the collector: a collection falls into one block in five or ten and costs as much as hundreds of requests. What a change does to the
collector shows in CPU time and memory (`../servers/measure`). The server runs at fixed addresses (`setarch -R`), because the cost of a hash table keyed by addresses depends on them.

## Find out where the instructions went

```sh
BUN_JSC_aotMapFilePath=app.map <bun> build --compile --aot app.ts --outfile app
python3 test/aot/tools/exact_counts.py run --out after.counts --map app.map --symbols <bun with symbols> -- ./app
python3 test/aot/tools/exact_counts.py diff before.counts after.counts
```

`exact_counts.py` runs the executable under valgrind's callgrind and adds the counts up by compiled function, by stub of the compiler and by C++ function of the runtime. `serve` in place of `run`
counts exactly _n_ requests to a warm server. The top of the file has the details and what to watch out for.

Other ways in, none of which needs a counter of the processor:

| Question                                                | Tool                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Which tests does a request run, and which of them fail? | `../servers/measure/tests-by-request.ts`, `failed-tests-by-request.ts` |
| How often does a request look something up at run time? | `../servers/measure/arrivals-by-request.ts`                            |
| Which optimization is a benchmark's speed owed to?      | `what-each-switch-is-worth.ts`                                         |
| Which property accesses got worse between two builds?   | `sites-that-got-worse.ts`                                              |
| What does the compiler say about a program?             | `bun build --compile --aot --explain`                                  |

## Compare with the JIT

```sh
bun test/aot/perf/idioms-against-the-jit.ts --bun <bun>          # the small benchmarks, the losses first
test/aot/servers/measure/against-the-jit.sh <bun> <released bun>  # the servers: requests per second, latency, memory, counters
```

The fair column is **the same binary's JIT**: the same runtime, the same built-in modules, the same native code. Against another Bun the table also shows every other difference between the two
builds. [`../servers/measure/README.md`](../servers/measure/README.md) says what makes the servers' numbers fair.

## Hold a build against the pins

```sh
bun test/aot/perf/measure.ts                    # everything: about an hour of processor time
bun test/aot/perf/measure.ts pinned idioms      # the files whose path holds one of the words
bun test/aot/perf/measure.ts --list
```

CI does not run these. Its machines have no counter of executed instructions that a user may read (a test that asks for one says
`instructions are not counted here` and with which error), and the rest takes minutes. Run them on a Linux x64 machine with a counter before
a change to the compiler lands, and after one that was meant to make programs faster. Each file is a file of `bun test`, named
`<name>.measure.ts`, and can be run alone: `bun test ./test/aot/perf/operations.measure.ts`.

| Files                                                                                                                                                 | What they hold                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idioms`, `idioms-in-parts-*`                                                                                                                         | Instructions per turn of each benchmark of `idioms/` (`pins.linux-x64.json`)                                                                                                                     |
| `pinned-everyday-idioms-*`                                                                                                                            | The same for `everyday/` (`everyday-pins.linux-x64.json`): 1,163 benchmarks, as TypeScript and as JavaScript. 128 of them are the entry points of one executable, and nothing runs under the JIT |
| `pinned-applications`                                                                                                                                 | zod, and the type checker of the `typescript` package (`application-pins.linux-x64.json`)                                                                                                        |
| `idioms-against-the-jit`, `idioms-in-a-very-large-program`                                                                                            | No benchmark takes over 1.35 times the JIT's instructions, unless `behind-the-jit.linux-x64.json` lists it. What a list names has a pin                                                          |
| `generated-code-of-idioms-*`, `generated-code-of-operations-*`                                                                                        | The same programs by their generated code: instructions and patchpoints of each function and loop. Nothing runs, so it needs no counter, only time                                               |
| `operations`, `small-benchmarks`, `front-end`, `plain-bun-costs`, `serial-time`                                                                       | Single operations, whole small programs, a model of a processor's front end, what a program pays that never asks for the compiler, how much of a build runs on one thread                        |
| `equivalent-*`, `*-in-cold-code`, `names-given-by-key` ..                                                                                             | One loop against another of the same executable. Nothing is pinned                                                                                                                               |
| `compare-builds`                                                                                                                                      | `compare-builds.ts` finds no difference between a Bun and itself: its numbers repeat on a busy machine                                                                                           |
| `../long-functions-*`, `../many-*-build-time`, `../analysis-scaling`, `../startup-scaling` ..                                                         | What a build or a start costs as a program grows                                                                                                                                                 |
| `../minifying-first-saves-no-code-*`, `../knowing-more-adds-no-code`, `more-knowledge-costs-no-site`, `../typed-package-costs-no-more-than-erased` .. | Bytes of code and classes of accesses: one build against another of the same program                                                                                                             |

A pin only goes down: `AOT_PERF=lower bun test/aot/perf/measure.ts idioms` rewrites the pins that got better.

### How many turns a number needs

The loop counter of a benchmark starts at 0 in every call, so a run of _n_ turns against a run of _n_ / 4 measures the turns from _n_ / 4 to _n_. Compiled code does not warm
up, but a number taken from few turns is another number for one benchmark in seven: a number that is printed has fewer digits, a dictionary that is built once in 256 turns is still
being built, no collection has run. So the pins are taken with as many turns as make 800 million instructions. Two processes that do the same differ by 8,000 instructions (35,000 in one
pair of a hundred), which is why 1,000 turns of a short benchmark say nothing.

## What CI holds

| Test                              | What it holds                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start.test.ts`                   | Page faults, system calls and private memory of a start. Its instructions only where they can be counted                                                      |
| `threads-of-a-build.test.ts`      | How many threads a build starts                                                                                                                               |
| `../servers/budgets-of-*.test.ts` | Bytes of code, tests that fail, accesses by name, calls of the run time, allocations of one round of requests to each server: exact counts of branch counters |
| `../build-scaling`                | Peak memory of a build as a program grows, and its instructions where they can be counted                                                                     |

## Which number decides

1. **Wall-clock time on a real program decides.** Instructions are the early warning: cheap, exact, the same at any load. Cycles and cache misses explain a difference; they do not decide.
2. **Instruction counts may not rise.** A change that raises a row here needs a reason that is worth more than the row.
3. **Fewer instructions are not always less time.** For code that runs a few times per request, time goes to fetching code, not to executing it. Cutting a server's instructions by 3% while its code
   grew by 10% has made it slower. For a server, read requests per second and cycles beside the instructions.
4. **Judge by several kinds of programs**, and by the worst of them: a command-line application that starts often, a server, a long computation (the TypeScript checker). A gain on one has been a
   loss on another more than once.

## Traps

Each of these has cost somebody a day.

**Running**

- **A run that never started looks like a pass.** "0 same, 0 differ", exit 0. Read the count of rows, and distrust a run that ends in a quarter of the usual time.
- **Build what you measure the way it ships.** A build without link-time optimization, or with assertions, has other numbers and other winners. Compare like with like.
- **A debug or ASAN build counts other instructions.** The tests here skip themselves on those.
- **The path matters.** The length of `$HOME` or `$TMPDIR` changes what a program that handles paths executes. Give both sides paths of the same length.
- **What lies above the folder matters.** A `tsconfig.json` or `node_modules` in a parent folder changes what the compiler knows, and so the code. The tools here write the sources into a fresh folder.
- **On macOS throw away the first run of a new executable**: it executes some 30 million instructions more.

**Instructions**

- **Some rows have two costs.** A benchmark that allocates may collect once more or less; a hash table may grow on one side of a threshold. `compare-builds.ts` measures what moved again for that reason.
- **Count the first thread if helpers run.** With the collector's helper threads on, the sum over all threads of a long run takes one of two values several percent apart. The tools here switch the helpers
  off; if you measure by hand use `perf stat -i`, or the environment at the top of `measure-idioms.ts`.
- **If the JIT's number moved too, the runtime changed.** Both columns call the same native code.
- **A benchmark's loop is part of the benchmark.** When a row "gains", check that the work is still there: the compiler may have folded it away. Every form must print the same answer, and the tools check it.
- **Whether `turn()` is copied into the loop can decide a row.** That is why there are three sizes. A budget of the inliner once moved 800 rows back and forth within an hour.
- **Sampled counts skid.** `perf record` books an instruction's cost on a neighbor; for a short stub it has been wrong by three times. Use exact counts (`exact_counts.py`).

**Time and cycles**

- **A then B is not an A/B.** The clock of a core drifts, and whatever ran before has warmed or emptied the caches. Interleave (A B B A), swap the order every round, and read cycles beside every wall time.
- **Where code lies moves a server by 3% a route**, with the same instructions, and repeating the run repeats the same layout. Two builds that differ by one unused function differ that much. Measure
  over several layouts (`measure.py --layouts`, `layouts.py`), or put the change behind a switch of one Bun, so that only the compiled program differs.
- **The order in which the compiler's flow analysis visits functions moves a server by up to 5%** the same way. One pair of builds is partly luck.
- **"Idle" cores are often not.** Check that nothing else ran there (`measure.py` marks such rows void), and that a pin really holds: `taskset -p <pid>` of the running child. A job started through
  `systemd-run` does not inherit the caller's affinity.
- **Cores that share a last-level cache slow each other down** by 3 to 5%.
- **Apple silicon hides what a server's small front end costs.** Judge cycles and time for servers on x64 too.
- **A JIT needs 200,000 requests to be warm**, for some servers 500,000. Until then its column is too slow, and the comparison flatters the compiler.

**Reasoning**

- **A static count is not run time.** How many sites have a property, how many bytes a pass emits: neither says what a program spends. Profile first.
- **Two counts of the same size need not count the same things.** Compare the sets.
- **A stand-in does not decide for the application.** A small benchmark that shows a gain is a reason to measure the real program, not a result.
- **A cause is a run that tells two builds apart.** "It started around that commit" is a guess. `../tools/bisect.ts` finds the optimization, two binaries find the commit.
- **One table is not a finding.** Repeat it before you believe it, and before you tell anyone.
