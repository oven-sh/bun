# Measuring the code that `bun build --compile --aot` generates

Start here when you want to know whether a change to the compiler made programs faster or slower.

| Path | What it is |
| --- | --- |
| `idioms/<group>/<name>.ts` | small benchmarks, one to a file |
| `everyday/<group>.txt` | small benchmarks, many to a file |
| `compare-builds.ts` | two builds of Bun against each other |
| `idioms-against-the-jit.ts` | compiled code against the same binary's JIT |
| `*.measure.ts`, `measure.ts` | one program against another. CI does not run these |
| `*.test.ts` | what CI runs |

The tools count instructions, so they need Linux and hardware counters that a user may read (`sysctl kernel.perf_event_paranoid` at 2 or below).

## Compare two builds

```sh
bun test/aot/perf/compare-builds.ts --before <bun> --after <bun>
```

It measures every small benchmark, typed and with its types erased, and one request of each route of the servers in `../servers/app`. Then it prints every row that moved by more than 2%, and exits with 1 if a row got slower.

```
4 rows compared, instructions per turn or per request, threshold 2%

0 got slower

0 got slower, and so did the same code under the JIT: look in the runtime, not in the compiler

0 got faster

0 moved, but are known to cost one of two amounts from run to run (`unsteadyBenchmarks`)
```

The full run is slow. To narrow it down:

| You want | Add |
| --- | --- |
| One group, one benchmark | `--only '^text/'`, `--only 'char-code-at'` |
| No servers, or some | `--servers none`, `--servers koa,fastify` |
| What a compiler flag costs | the same Bun on both sides and `--build-flag=<flag>` |
| Another threshold | `--threshold 0.5` |

Each benchmark is measured in two sizes. In `small` its loop calls `turn()` directly, so `turn()` is usually inlined. In `called` the loop finds `turn()` at run time, so it stays a function with a caller, like most functions of a real program.

The cost of a turn is the difference between a run of n turns and a run of n / 4. Start-up and warm-up cancel out, and the number does not depend on the load of the machine.

## Other tools

```sh
bun test/aot/perf/idioms-against-the-jit.ts --bun <bun> [--only <regular expression>]
bun test/aot/perf/measure.ts --list
bun test/aot/perf/measure.ts [<part of a path>..]
```

`../tools/exact_counts.py` counts the instructions of an executable by function, under valgrind. The top of the file says how. Build with `--aot-symbols` so that compiled functions have names.

[`../servers/measure/README.md`](../servers/measure/README.md) has the servers' requests per second, latency and memory.

## Add a benchmark

Add a section to a file in `everyday/`. The name follows `////`, and the code declares `turn`:

```ts
//// literal-made-and-read
function turn(i: number): number {
  const triple = [i, i + 1, i + 2];
  return triple[0]! + triple[1]! + triple[2]!;
}
```

A new `<name>.measure.ts` has to be listed in `measure.ts`. `measures-are-listed.test.ts` checks that.

## Which number decides

1. Wall-clock time on a real program decides. Instructions are the early warning: cheap, exact, the same at any load.
2. Instruction counts may not rise. A change that raises a row here needs a reason that is worth more than the row.
3. Fewer instructions are not always less time. For a server, read requests per second and cycles beside the instructions.
4. Judge by several kinds of programs, and by the worst of them: a command-line application, a server, a long computation.

## Traps

- A run that never started looks like a pass. Read the count of rows.
- Build what you measure the way it ships. A debug or ASAN build has other numbers and other winners.
- A `tsconfig.json` or `node_modules` in a parent folder changes what the compiler knows, and so the code.
- When a row gains, check that the work is still there. The compiler may have folded it away.
- If the JIT's number moved too, the runtime changed, not the compiler.
- A then B is not an A/B. Interleave the runs and swap the order every round.
- A small benchmark that shows a gain is a reason to measure the real program, not a result.
