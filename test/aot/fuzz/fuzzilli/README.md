# Fuzzilli for `bun build --compile --aot`

[Fuzzilli](https://github.com/googleprojectzero/fuzzilli) generates JavaScript programs and keeps the ones that reach new code in the target. Here the target is the ahead-of-time compiler: the front end (`src/aot`, `src/sema`) and the engine's half (`aot` and `b3` in JavaScriptCore). Every program that compiles is also run, and compared with `bun run`.

## What runs

In a build with `--fuzzilli=on`, `bun build --compile --aot <file>` that Fuzzilli starts doesn't build `<file>` and exit. It stays alive and takes one program after another from Fuzzilli. It compiles each one through every stage up to the finished image, which stays in memory: it writes no executable. The code is `src/runtime/cli/fuzzilli_compile_loop.rs`.

Most of what a small build does is the same for every program, so Bun does that part once. It compiles an empty program, then starts a second build that loads the declaration files, loads and lowers Bun's own code, and stops right before it reads the entry point (`Preload` in `src/options_types/aot_options.rs`). From there it forks once for each program. The child finishes the build, and the parent tells Fuzzilli how the child ended. A crash ends only the child.

A forked process has one thread, so the whole build runs on it. To fold a call of a built-in, the compiler runs it in a small VM, which the child creates. Bun has to be started with `BUN_JSC_useJIT=0` so that this VM only interprets. The profile sets it. The compiler's output doesn't depend on it.

Two things differ in an engine built with `--fuzzilli=on`. A forked process inherits the memory that the engine has reserved. And until the whole-program analysis has run, `--aot-verify-each-pass` and the program verifier skip Bun's own functions: they are the same in every build, and the analysis then drops the ones the program doesn't reach.

Then it runs the program twice with the same binary: the image, as `bun run --aot` would, and the file, with `bun run`. It compares the exit code, the signal and stdout (`src/runtime/cli/fuzzilli_run_comparison.rs`). When they differ, it runs both once more, so that a program that prints the time or a random number isn't reported.

So that there is something to compare, Bun puts a declaration of `printValue` in front of each program and, behind it, a call of `printValue` for every name that the program declares outside a block. `printValue` is also a built-in in the profile, so generated code calls it from inside functions. It's `console.log`. With `BUN_FUZZILLI_PRINTS_VALUES=2` it's `src/runtime/cli/fuzzilli_print_values.js`, which reads every property, calls getters, shows which properties are writable, and never prints the message of an error. Compiling it about doubles the time for a small program. The profile builds with `--no-compile-function-source`, and `bun run` hides the text of functions too, because the two print it differently.

Each run has its own process group and none of Fuzzilli's descriptors. It ends after `BUN_FUZZILLI_RUN_CPU_SECONDS` of processor time (default 5), `BUN_FUZZILLI_RUN_WALL_SECONDS` (default 20), 1 MB of output, or `BUN_FUZZILLI_RUN_MEMORY_MEGABYTES` of resident memory (default 2048). The compiled run reports coverage, so the compiler's run-time functions count.

| What happens                                                                            | What Fuzzilli sees | Counted as                     |
| --------------------------------------------------------------------------------------- | ------------------ | ------------------------------ |
| both runs exit with 0 and print the same                                                | exit code 0        | `same`                         |
| the build is refused with a diagnostic                                                  | exit code 1        | `refused-by-the-build`         |
| both runs fail with the same exit code and print the same                               | exit code 2        | `same-failure`                 |
| they differ in a way that `docs/compiler/compatibility.mdx` lists                       | exit code 3        | `documented-difference`        |
| `bun run` differs from itself                                                           | exit code 4        | `plain-bun-is-unsteady`        |
| `bun run` reaches a limit                                                               | exit code 5        | `neither-finished`             |
| `bun run` ends by a signal                                                              | exit code 6        | `plain-bun-crashed`            |
| the second compiled run agrees with `bun run`                                           | exit code 7        | `compiled-program-is-unsteady` |
| they print something different                                                          | a crash (SIGUSR1)  | `finding-10`                   |
| they exit with different codes                                                          | a crash (SIGUSR2)  | `finding-12`                   |
| only the compiled program reaches a limit                                               | a crash (SIGALRM)  | `finding-14`                   |
| the compiled program ends by a signal                                                   | a crash, that one  | `finding-<signal>`             |
| the build crashes, fails an assertion, `--aot-validate` or `--aot-verify-each-pass`     | a crash            | `compiler-signal-<signal>`     |
| the build reports an `internal compiler error`                                          | a crash (SIGABRT)  | `compiler-signal-6`            |
| the build takes more than `BUN_FUZZILLI_CPU_SECONDS` of processor time (default 30)     | a crash (SIGXCPU)  | `compiler-signal-24`           |
| the build grows the process by more than `BUN_FUZZILLI_MEMORY_MEGABYTES` (default 4096) | a crash (SIGABRT)  | `compiler-signal-6`            |

With `BUN_FUZZILLI_OUTCOMES=<folder>`, each instance of Bun keeps these counts in `<folder>/<process id>.outcomes`. `BUN_FUZZILLI_RUNS_PROGRAMS=0` only compiles. `BUN_FUZZILLI_CHECKS_PASSES=0` leaves out `--aot-validate` and `--aot-verify-each-pass`. `BUN_FUZZILLI_PRINTS_VALUES=0` adds nothing to a program: a value that is printed is a value that the compiler can't remove.

With `BUN_FUZZILLI_FINDS=<folder>`, Bun keeps each program that ends in a crash in the table above before it tells Fuzzilli, which doesn't record a crash while it reduces another program. It also keeps `compiled-program-is-unsteady` and `plain-bun-crashed`. A program goes to `<folder>/<kind>-<hash>/<n>/program.js`, next to `report.txt` and what the two runs printed, or what the compiler printed. Programs that end the same way, numbers aside, have the same hash. `n` is the base-2 logarithm of the program's size and each `n` is kept once, so the folder with the lowest `n` holds the smallest program. `<folder>/index.txt` lists what was kept, in order, and nothing more is kept once it holds 1 MB.

Fuzzilli reduces every crash and writes it to `<storage>/crashes`.

## Build Bun

```sh
BUN_WEBKIT_PATH=<WebKit> bun scripts/build.ts --profile=release-local --asan=on --assertions=on \
  --fuzzilli=on --fuzzilli-compiler-only=on --rust-lto=off --build-dir=build/fuzzilli
```

`--fuzzilli-compiler-only=on` limits coverage to the compiler, so a program is interesting only when it reaches new code there. The C++ functions are listed in `scripts/build/fuzzilli-compiler-coverage.txt`. The Rust crates are the ones named `bun_aot*` and `bun_sema*` (`scripts/build/rust/units.ts`). It needs an engine built from source, because the prebuilt one reports coverage everywhere.

## Build Fuzzilli

The patch applies to commit `be2811d00282320381fc8007d64873745772011d`, which needs Swift 6.3.

```sh
git clone https://github.com/googleprojectzero/fuzzilli && cd fuzzilli
git checkout be2811d00282320381fc8007d64873745772011d
cp <bun>/test/aot/fuzz/fuzzilli/*.swift Sources/Fuzzilli/Profiles/
git apply <bun>/test/aot/fuzz/fuzzilli/fuzzilli.patch
swift build -c release
```

## Bun's and Node's APIs

The compiler has a table of every built-in: its name, its parameters, the properties it reads from an options object, and the functions in it that it calls. `list-builtins.ts` turns the table into the list that the profile reads at startup (`BunBuiltins.swift`).

```sh
bun test/aot/fuzz/fuzzilli/list-builtins.ts build/fuzzilli/codegen/aot_builtin_table.json /tmp/fuzzilli/builtins.json
```

With `BUN_FUZZILLI_BUILTINS=<that file>`, Fuzzilli knows the globals, `Bun`, `process` and the `node:` and `bun:` modules, with the types of their methods. Four more generators call them: with callbacks that print `this` and their arguments and store through `this`, with options objects whose properties are values, getters or handlers, from subclasses of Bun's classes, and with `await`. A `port` is always 0 and a `hostname` always `127.0.0.1`. The list leaves out what starts a process, sends a signal, loads native code, deletes files, or answers differently each time.

## Run

```sh
mkdir -p /tmp/fuzzilli
BUN_FUZZILLI_BUILTINS=/tmp/fuzzilli/builtins.json \
BUN_FUZZILLI_ENTRY_POINT=/tmp/fuzzilli/program.js .build/release/FuzzilliCli --profile=bunCompiler \
  --jobs=32 --storagePath=<storage> --resume <bun>/build/fuzzilli/bun-asan
```

`--additionalArguments=--no-builtin-modules` makes a build about twice as fast: Bun's own modules are not compiled along with each program. Some syntax needs a helper from them, so when such a build reports an internal error, Bun builds the program once more with the modules and reports what that build says. That takes as long as a hundred small programs, so turn off the generators of that syntax: `BUN_FUZZILLI_DISABLED_GENERATORS=ForOfWithUsingLoopGenerator,ForOfWithAwaitUsingLoopGenerator,ForAwaitOfWithUsingLoopGenerator,ForAwaitOfWithAwaitUsingLoopGenerator`. A program that uses a `node:` module doesn't run without the modules, so leave out `BUN_FUZZILLI_BUILTINS` too.

Each instance of Bun writes the program it is compiling to `/tmp/fuzzilli/<process id>.program.js`, so put that folder on a RAM disk. Run the whole thing somewhere it can't reach the network or your files, for example in `test/aot/real-apps/jail.sh`.

## Many programs in one executable

A build costs far more than the program in it: Bun's own modules are compiled along with every program. `run-batch.ts` compiles thousands of programs in one build instead. It works with any build of Bun, because it needs no coverage.

Fuzzilli only generates. With `BUN_FUZZILLI_COLLECTS_PROGRAMS=<folder>`, Bun compiles nothing: it moves each program into the folder, with the calls of `printValue`, and tells Fuzzilli that the program ran. `BUN_FUZZILLI_ENTRY_POINT` must be on the same file system as the folder. Each instance waits while 4096 of its programs are still there. Nothing is new coverage, so give Fuzzilli a corpus to mutate:

```sh
BUN_FUZZILLI_COLLECTS_PROGRAMS=/tmp/fuzzilli/programs BUN_FUZZILLI_ENTRY_POINT=/tmp/fuzzilli/program.js \
.build/release/FuzzilliCli --profile=bunCompiler --jobs=4 --storagePath=/tmp/fuzzilli/generator --overwrite \
  --staticCorpus --importCorpus=/tmp/fuzzilli/storage/corpus --corpusImportMode=full <bun>/build/fuzzilli/bun-asan &

bun test/aot/fuzz/fuzzilli/run-batch.ts --bun <the Bun to test> --programs /tmp/fuzzilli/programs \
  --work /tmp/fuzzilli/work --finds /tmp/fuzzilli/finds --count 2000 --group 500 --batches 0 --flags=--aot-threads=1
```

`run-batch.ts` takes `--count` programs out of the folder. Several of them can share a folder. It writes one file for each `--group` programs, with an `import()` of each, and builds one executable with those files as entry points behind `run-each-program-in-a-worker.ts`. That file starts a Worker for each program, which imports that program alone, and ends the Worker after `--milliseconds` (default 250) or 512 MB. The executable runs all programs, `bun run` of the same files runs them again, and the two are compared by what each program printed and how it ended.

- A program that the compiler refuses leaves, and the rest is built again.
- When the process ends in the middle, the program it was in gets the blame and the rest run in a new process.
- The programs that differ run a second time, both ways, with twenty times the time. The rules for what counts are those in the table above.
- A program that still differs is built alone. If it no longer differs, its neighbors are halved while the difference stays: the programs of a group are analyzed together, so what one does to a built-in can change how another is compiled. `report.txt` says which it was and holds the neighbors.

What it keeps under `--finds` is laid out as under `BUN_FUZZILLI_FINDS`. It prints a line for each batch: programs a second of processor time, the time and peak memory of the build and of the two runs, and how many programs ended in which way.

## Try one program without Fuzzilli

`reprl.py` speaks Fuzzilli's protocol to one Bun. It prints how each program ended, how long it took, and programs per second. The program as it ran, and what the two runs printed, are left beside the entry point.

```sh
BUN_JSC_useJIT=0 python3 test/aot/fuzz/fuzzilli/reprl.py build/fuzzilli/bun-asan build --compile --aot --aot-validate \
  --aot-verify-each-pass --aot-threads=1 /tmp/fuzzilli/program.js -- a.js b.js
```
