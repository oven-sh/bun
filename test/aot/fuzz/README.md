# Fuzzing the ahead-of-time compiler

`run.ts` generates small programs. It runs each one twice, with `bun <file>` and as an executable built with `bun build --compile --aot`. It keeps every program where the two runs differ, the build fails or the executable crashes.

CI runs only the fuzzer's own tests (`../fuzzer-*.test.ts`). Run the fuzzer by hand after a compiler change.

## Run

```sh
bun test/aot/fuzz/run.ts --seconds 3600 --jobs 16 --out /tmp/fuzz
```

Start it from the repository root. The Bun that runs the script is the Bun under test, and `--bun <path>` tests another one. The comment at the top of `run.ts` lists every option.

| Command | What it does |
| --- | --- |
| `run.ts --sources <a>,<b>` | uses only these sources |
| `run.ts --batch 1` | gives every program its own build. A shared build hides some bugs |
| `run.ts --gc-stress 1,2,3,5,7,11` | collects at every n-th slow-path allocation |
| `run.ts --rewritten` | also rewrites each program so that the compiler knows less about it. It needs the `typescript` package, which `bun install` at the root installs. Without it nothing is rewritten |
| `run.ts --replay <source>:<seed>` | generates one program again and prints it with its verdicts. `--print-only` only prints it |
| `run-as-tests.ts --seconds 600 --jobs 16 --out /tmp/as-tests` | runs each program as a test file, with `bun test` and with `bun test --aot` |
| `burst.ts --minutes 60 --out /tmp/burst` | starts many runs with different options side by side |

One run tests one way to build. Several runs with different options find more than one wide run.

`burst.ts` takes the whole machine. In one minute on 192 cores its runs wrote about 900,000 small files into the temporary folder, so check `df -i` there first. A `tmpfs` runs out of inodes long before it runs out of space.

## Findings

`<out>/findings/<name>/` holds the reduced program, the original, the output of both runs and `finding.json`. `<out>/as-tests/<name>.<ext>` is the reduced program in the format of `../parallel`.

A signal or a failed assertion is always a bug. A timeout on a busy machine is not.

`accepted-differences.tsv` lists the differences that are intended. A finding that matches a line is counted and not kept. The comment at the top of the file describes the format.

To turn a finding into a test:

1. Replay it on a fresh build.
2. Reduce its file under `<out>/as-tests/` by hand. `bun test/aot/run-parallel.ts --root=<out>/as-tests <file>` runs it the way CI does.
3. Commit the small program with the fix, as `test/aot/parallel/<topic>/<what-it-tests>.<ext>`. Commit no seeds and no generator output.

## Add a source

A source turns a seed into a program. Its name is its file name.

Write `<subject>.ts` with `export function generate(random: Random, typed: boolean): string`, and add its name to the matching list in `sources.ts`. Start the file with a comment that says what its programs test. Every program must print what it computes, print the same in every run, and exit by itself within a second or two.

## Layout

| Path | What it is |
| --- | --- |
| `run.ts`, `burst.ts`, `run-as-tests.ts` | the command lines |
| `fuzzer.ts`, `runners.ts`, `reduce.ts` | the main loop, how a program is built and compared, the reducer |
| `sources.ts`, `family.ts`, `sources/` | the registry of sources, and sources that are lists |
| `grammar.ts` | the general-purpose generator |
| `mutate.ts`, `tokens.ts` | mutation of the programs in `../parallel` |
| the other `*.ts`, `generators/`, `case-scripts/` | generators, one subject each |
| `fuzzilli/` | a Fuzzilli profile and driver. See `fuzzilli/README.md` |
