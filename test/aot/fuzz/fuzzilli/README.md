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
| `bun run` refuses the file when it loads it                                             | exit code 8        | `plain-bun-refuses-the-file`   |
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

With `BUN_FUZZILLI_BUILTINS=<that file>`, Fuzzilli knows the globals, `Bun`, `process` and the `node:` and `bun:` modules, with the types of their methods. Four more generators call them: with callbacks that print `this` and their arguments and store through `this`, with options objects whose properties are values, getters or handlers, from subclasses of Bun's classes, and with `await`. `BUN_FUZZILLI_BUILTINS_WEIGHT=<n>` makes the four n times as likely. A `port` is always 0 and a `hostname` always `127.0.0.1`. The list leaves out what starts a process, sends a signal, loads native code, deletes files, or answers differently each time.

## Functions that built-ins call

`BunCallbacks.swift` adds a generator for what a built-in function or an operator calls back into: `toJSON`, `valueOf`, `toString`, `Symbol.toPrimitive`, getters, `Symbol.iterator` with `next` and `return`, `then`, the traps of a proxy, replacers, revivers, comparators and the callbacks of array methods. It builds one or two objects with some of these, as an object literal, an instance of a class, an object that inherits from one of them or a proxy, and hands them to a few of about 250 calls, operators and forms of iteration. Each of the functions prints its name and how many of them ran before it, and each use prints its result, or the name of what it threw, and the count. So the output holds which functions ran, how often and in what order. `BUN_FUZZILLI_CALLBACKS_WEIGHT=<n>` makes the generator n times as likely, and 0 turns it off.

A second generator in that file is about an object that the program already holds: an instance of a class or of a function, an object literal, an object that inherits from one, or an array. One or two uses follow, out of 25 kinds. In most of them a built-in calls or constructs something of the program, and that stores into the object: with an assignment, a computed key, `Object.assign`, `Object.defineProperty`, `Reflect.set`, also with the object as the receiver, `delete`, `Object.setPrototypeOf`, or a store to a member of a member. What is called is the constructor under `Symbol.species` of an array, a regular expression, a promise or a typed array, the constructor of a subclass of one of these, `this` of `Array.from` and `Array.of`, a method under `Symbol.split`, `replace`, `match`, `matchAll`, `search`, `iterator`, `toPrimitive` or `hasInstance`, `next`, `valueOf`, `toString`, `then`, `toJSON`, `exec`, `has` and `keys` of what a method of `Set` takes, a replacer, a reviver, a comparator, a callback of a method of arrays, iterators, sets and strings, a getter or a setter, a trap of a proxy of the object, or a callback of `queueMicrotask`, `setTimeout`, `setImmediate` and `process.nextTick`. Such a constructor can answer the held object, so that the built-in fills it. Four in ten of these functions store nothing, so that the built-in is the only one that does. In the other kinds the built-in stores by itself: a method of `Array.prototype` or of `RegExp.prototype` with the object as `this`, `Object.defineProperties`, the fields of a class whose base constructor returns the object, a function that gets the object as `this` from `call`, `apply`, `bind` or `Reflect.apply`. Behind each use the program prints two to five members of the object, read by name: as they are, with `typeof`, through a function, with `in` or with a pattern. Then it prints `Object.keys`. The names are those that the functions store, and `lastIndex` and `length`. One of them may also be read in front of the use and printed behind it. What the use results in is printed, printed in part (`typeof`, `length`, joined with a member of the object in one expression), or not used. Use and reads may stand in a loop. A program prints every variable of its top level at its end, so a scene stands in a block, or in a function that is called once or in a loop with the `try` around the call: nothing but the scene has the object. The same setting weighs this generator. With `BUN_FUZZILLI_STORES=<percent>`, that share of the programs gets one to three such scenes at its end, without guards, and three in four of those programs are their scenes and nothing else.

## Run

```sh
mkdir -p /tmp/fuzzilli
BUN_FUZZILLI_BUILTINS=/tmp/fuzzilli/builtins.json \
BUN_FUZZILLI_ENTRY_POINT=/tmp/fuzzilli/program.js .build/release/FuzzilliCli --profile=bunCompiler \
  --jobs=32 --storagePath=<storage> --resume <bun>/build/fuzzilli/bun-asan
```

No corpus is kept in this repository. With a new `<storage>`, Fuzzilli starts from an empty one: it generates its first programs itself and writes each program that reaches new code in the compiler to `<storage>/corpus`. `--resume` goes on from there.
The Bun it starts has to be the one from "Build Bun": only a build with `--fuzzilli=on` takes programs from Fuzzilli and reports coverage.
"Many programs in one executable" below mutates the `<storage>/corpus` of such a run, and the Bun it tests can be any build.

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

A program that is only stored has never run, and four of five end at a statement that throws, half way down on average. With `BUN_FUZZILLI_GUARDS=<percent>`, in that share of the programs every operation outside functions that can have a guard gets one (`BunGuards.swift`): `try { v5 = new v3(); } catch (e) {}`. With `BUN_FUZZILLI_TRY_BLOCKS=<percent>`, in that share of the programs with guards every other statement at the top level that can throw, a loop or a class with all that is in it, gets a try block of its own, and what it defines is declared in front of the block: `let v5 = undefined; try { v5 = v3.a; } catch(e6) {}`. The code inside functions stays as it is.

`run-batch.ts` takes `--count` programs out of the folder. Several of them can share a folder. With a list, such as `--count 1,3,12`, the batches go through the list in turn: the compiler ranks the code of an executable by how often it expects it to run, so the same program is compiled in another way beside few programs than beside many. It writes one file for each `--group` programs, with an `import()` of each, and builds one executable with those files as entry points behind `run-each-program-in-a-worker.ts`. That file starts a Worker for each program, which imports that program alone, and ends the Worker after `--milliseconds` (default 250) or 512 MB. The executable runs all programs, `bun run` of the same files runs them again, and the two are compared by what each program printed and how it ended.

The compiler takes each entry point that a Worker can start for a program of its own: it analyzes it alone and ranks its code alone. With `--group 1` every program is such an entry point, and up to 127 of them share an executable and nothing else. Such an entry point imports its program with an `import` statement, as the entry point of an application imports a file. A larger group holds an `import()` of each of its programs: the compiler takes what stands behind `import()` for code that may never run, and it leaves out no file behind it that a `package.json` calls free of side effects. With `--group 500` the programs of a batch are one program.

An entry point of its own costs each program the part of Bun's modules that it uses, about a third of a second of one processor however many share the executable. `--together 32`, with `--group 1`, pays that once for many. A text that shows neither kind of module gets an `export {};`. `bun run` first runs each program in a Worker of its own. Then an entry point imports 32 programs with `import` statements, one behind the other, and behind each a file that prints a mark. A program that ends in an error is the last of its entry point. One that doesn't end in time waits, and so does one that is no module or brings a CommonJS file: in which order `bun run` runs several CommonJS files that a module imports differs from run to run. A Worker runs an entry point as a whole, in the executable and under `bun run`, and what was printed is compared from mark to mark. The programs that print the same are done: with 400 or more in a build that takes 15 to 20 milliseconds of one processor for each, and a build of 4,000 takes no more for each than one of 400. A program that prints something else waits until 120 of them fill a batch in which each is an entry point, which tells the documented differences from the rest as before. One that prints the same there goes back among those of its neighbors that printed the same. If it still prints something else, it is kept as `among-neighbors-<hash>`, with as few of them as show it in `neighbors.txt`, in the order in which one entry point imports them. Entry points that have much of Bun's modules in common are one program for the compiler, so a large batch is mostly one program.

A program that ends in an error is the last of its entry point, so each such program costs an entry point: five programs of a hundred drawn ones, and half of the time of a build. `--throwers 20` takes 20 of 100 of them and leaves the others out, for a lane that is after many programs. `--slow 10` does the same with the programs that don't end in time under `bun run`: each of them needs an entry point to itself, and its runs take the whole bound. A program with an `await` isn't asked again among its neighbors: what it prints behind an `await` at its top level can come behind a neighbor's mark, at a moment that differs from run to run under `bun run` too.

A drawn program is a closed world: the compiler sees where every value comes from and proves the receiver, the callee and the arguments of nearly every call. A program that uses packages is compiled on expectations instead. `--launders 50` makes half of the runs of `run-batch.ts` hand values of every program (objects, functions, classes, texts, numbers, keys: one, all of a kind, a third, or all) through `new Function("value", process.argv[9] ?? "return value")`, see `launder-values.ts`. In TypeScript the value keeps its declared type. Those runs, and with `--checks 50` half of the others, build with `--aot-check=verify-each-pass,validate-references`, which moves no output and takes four times as long.

A build of 126 generated TypeScript programs of 400 lines takes 14 seconds of one processor: 2.3 seconds however few they are, and 90 milliseconds for each, up to 600 programs at least. A build that ends in errors takes a quarter of that, the errors of each stage come in a build of their own, and one program in a hundred has one. `--ignores-type-errors 100` writes `// @ts-ignore` above every line of a TypeScript program, which counts only where the line has an error of the type checker. A build with `--aot-validate` takes three times as long as one without. The line of a batch lists `build`, `failed-build` and `validating-build` apart.

`--draws ts` or `--draws js` needs no `--programs` and no Fuzzilli: the driver makes the programs of a batch itself. Each starts empty, and `--ordinary-scenes` and `--scenes-of-every-size` write it. `--families 30` draws 30 programs of 100 from the sources of `../sources.ts` instead, which stay as they are drawn, but for the `export {};` that the bed of those sources adds to a text that doesn't say that it stays a script.

All entry points are one program beside a program that can load a module under a name that the build does not know, which text that is evaluated can do too, and the compiler proves less about that one program. So a program that is written to do so (`../the-world-is-open.ts`, or `eval` as a value) waits, and such programs share executables with each other. The build has the say: when its report names a program as the reason, that program leaves for those as well, and the rest is built again. The line of a batch counts "executables with a program for each group" and "executables that are one program".

- A program that the compiler refuses leaves, and the rest is built again.
- When the process ends in the middle, the program it was in gets the blame and the rest run in a new process. `stopped-before.txt` holds the programs that the runner had stopped earlier in that process: their threads can outlive them.
- The programs that differ run a second time, both ways, with twenty times the time. The rules for what counts are those in the table above.
- A program that names `.stack`, `.message` or `.raw` is counted as a documented difference when both runs end alike and each line that differs is printed by a statement that names one of the three, or a variable that such a line names, and so on. A difference in what else it prints counts.
- They also run in an executable that is built without `--aot`, each as a group of its own. A program that prints and ends there as in the `--aot` executable is counted as "as an executable without --aot" and not kept.
- A file that `bun run` refuses when it loads it is counted as "bun run refuses the file" and not kept.
- A program in which an object literal or a class has two getters, or two setters, of one name, and which ends the same way in both runs, is counted as "an accessor defined twice" and not kept: the place of that key among the others differs.
- A program that still differs is built alone first. If that build warns that the program writes to a built-in, the program is counted as a documented difference: the build of a group gives the warning once.
- It then runs twice under `bun run`, with a stack of 8 MB and of 2 MB. If what it prints changes, it prints how deep a recursion went, and it is counted as a documented difference.
- It is then built a second time with `--no-compile-function-source`. If what the executable prints changes, the program prints something that it worked out from the text of a function, such as its length, and it is counted as "function text".
- A program that reads `this` outside every function and class then runs under `bun run` with `undefined` in its place, which is what an executable has there. If it now prints what the executable printed, it is counted as a documented difference.
- A program with `[key]: value` in an object literal then runs under `bun run` with each such key converted to a property key in front of its value, which is the order in an executable. If it now prints what the executable printed, it is counted as a documented difference.
- A program whose executable reports a `ReferenceError` that `bun run` doesn't report is then built from the text that `bun build --no-bundle` makes of it, in which expressions that nothing uses are gone, and without its tests of a variable in front of an empty block (`if (!name) {}`). If that executable does as `bun run` does, the program read a variable before its declaration ran in such an expression, and it is counted as a documented difference.
- A program that still differs is built alone. If it no longer differs, its neighbors, which are all other programs of the executable, are halved while the difference stays, in groups of the same size: the programs of a group are analyzed together, so what one does to a built-in can change how another is compiled, and all programs of an executable share its tables. `report.txt` says which it was, and `neighbors.txt` holds the neighbors.
- A program whose second pair of runs agrees is kept as "unsteady", with what the first pair printed in `first-compiled.stdout` and `first-bun-run.stdout`.

What it keeps under `--finds` is laid out as under `BUN_FUZZILLI_FINDS`. `--also-keep=<way>,<way>` keeps programs that ended in a way that is only counted otherwise, for example `bun run is unsteady`. It prints a line for each batch: programs a second of processor time, the time and peak memory of the build and of the two runs, and how many programs ended in which way.

### A search instead of draws

With `--staticCorpus` Fuzzilli mutates the same programs for ever. `counters-as-coverage.py` gives it something to search by, with any build of Bun. Fuzzilli starts that file in place of Bun. It hands each program on to the Bun that collects (`BUN_FUZZILLI_COLLECTOR`), builds what that Bun stored with the Bun under test (`BUN_FUZZILLI_COUNTS_WITH`) and `--aot-report`, and then moves it into the folder. The report holds several hundred counters of the compiler: how often each pass changed something, how many checks the analysis removed, how many sites were resolved in which way. A bit of Fuzzilli's coverage map stands for a counter and the size class of how far the program moved it from where an empty program leaves it. So a program that moves a counter as none before it stays in the corpus and is mutated further. A program costs one more build.

```sh
BUN_FUZZILLI_COLLECTOR=<bun>/build/fuzzilli/bun-asan BUN_FUZZILLI_COUNTS_WITH=<the Bun to test> \
BUN_FUZZILLI_COLLECTS_PROGRAMS=/tmp/fuzzilli/programs BUN_FUZZILLI_ENTRY_POINT=/tmp/fuzzilli/program.js \
.build/release/FuzzilliCli --profile=bunCompiler --jobs=4 --storagePath=/tmp/fuzzilli/generator --overwrite test/aot/fuzz/fuzzilli/counters-as-coverage.py &
```

`run-batch.ts` writes `counters-<process id>.json` into `--finds`: the largest value of each counter in its builds so far. A counter that stays at zero counts something that no program has made the compiler do.

## Programs that the driver rewrites

`run-batch.ts` can rewrite a program when it takes it. What is drawn depends on the text of the program alone, and what is kept under `--finds` is the text that was built.

`--splits <percent>` (`split-into-files.ts`) cuts functions and classes of that share of the programs out into other files, so that calls and values cross from file to file. The program moves into a folder of its own, `./split-<hash>/main.ts`, and what the driver lays out as the program only imports that file. A function without indentation can move, a function directly in a block without indentation, a class, and a constant or a variable whose initializer names no variable of main. In half of the programs, what a block without indentation declares becomes a declaration of the file first. A part imports the names of main that it uses, so the two files import each other. An import cannot be assigned to, so a variable moves together with every function that assigns to it, into one file, and main reads it as an import. If something that cannot move assigns to it, they all stay. A class whose definition reads variables of main is defined where it stood, by a function of the part that returns it.

| What is drawn                         | From                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The form of a part                    | `.ts`, `.js`, `.mjs`, `.cjs`, or a package in `node_modules`: CommonJS or a module, found by `main` or by `exports`, in JavaScript, in TypeScript, or in both with an `"aot"` condition                                                                                                              |
| What main is told about JavaScript    | A declaration file that is right, one that is wrong, one that isn't valid, or none                                                                                                                                                                                                                   |
| What is wrong in a declaration        | Another type for a parameter or the result (a primitive, `never`, a literal, a tuple, an object type, an interface or a class of main), one parameter more or fewer, a member under another name, a declaration left out                                                                             |
| A part in TypeScript                  | As it stood, with annotations that its code doesn't fit, or with a declaration of its own for a type of main that says something else, both below `// @ts-nocheck`                                                                                                                                   |
| How main gets past the checker        | `// @ts-ignore` or `// @ts-expect-error` above each line that names something of a part, `// @ts-nocheck`, or nothing                                                                                                                                                                                |
| `package.json`                        | In 45 programs of 100 the folder has one that lists main as the only file with side effects, and names are then handed on more often. A package says `"sideEffects"`: `false`, `true`, or a list                                                                                                     |
| `tsconfig.json` in the folder         | None, or `strict`, `skipLibCheck`, `allowJs`, `checkJs`, `noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `isolatedModules`, each on or off                                                                                                            |
| Between main and a part               | Nothing, a file in TypeScript that exports the names again, or one with a function of its own around each function of the part, typed by `Parameters` and `ReturnType` of that function                                                                                                              |
| Above a part in CommonJS              | Nothing, or up to three files in CommonJS that hand on the names of the file below, as compilers to CommonJS write `export { x } from` and `export *`: getters, stores, a loop over the keys, `module.exports = require()`. A package in CommonJS can have such an index above a file inside it      |
| Calls from JavaScript into main       | A part calls functions of main by their names, or as callbacks that main hands over, with arguments of other types and in other numbers, directly and through `call`, `apply`, `Reflect.apply`, `bind` and `new`. It makes an instance of a class of main, changes it, and calls each of its methods |
| JavaScript without a declaration file | No comments, or JSDoc comments that say the types of its functions, right or wrong                                                                                                                                                                                                                   |
| How main gets the names of a part     | `import`, and for a part that imports nothing of main also `import *`, `await import()` and `require()`                                                                                                                                                                                              |

A package in TypeScript can ship its sources as a project does: files below `src` that name each other with `.js`, a file that only `import type` and `export type` reach, and a `tsconfig.json` of its own whose options are drawn apart from main's. Main asks one function of such a package and prints the answers.

JavaScript is the same text with its types erased by `Bun.Transpiler`. One program in ten is refused by the checker, and the line of a batch counts the refusals by the code of the first error. A refused program whose folder has a `tsconfig.json` is then checked by `bun check` in that folder. If that accepts the project, the program is kept as "refused-though-checked".

`--prints-members <percent>` (`print-members-of-objects.ts`) rewrites each `printValue("v1", v1)`. The compiler follows an object for as long as it sees everything that is done to it, and `console.log(object)` ends that. A rewritten program prints a primitive as it is and `typeof` for an object, and behind that members of the object, read by name. One program in four reads no member, one reads one member of one variable, one reads one member of each, and one reads up to three, the keys and the length.

`--hooks-fail <percent>` changes functions that count their calls, which are the ones that built-ins call: four in ten of them end in an error that no `throw` statement raises, such as a name that nothing declares, `null.member`, `1n + 1` or `structuredClone(() => 0)`. The error passes through the built-in to the `try` around it.

`--scenes-of-every-size <percent>` (`write-scenes-of-every-size.ts`) writes one or two scenes whose one parameter is a size: the cases of a switch over numbers or texts, the elements of a list literal, the fields of an object literal or of a pattern, the operands of a call, a concatenation or a sum, the variables that a closure captures or a `try` stores, the classes that share a method, the members of a union, the levels of calls, blocks and groups of a pattern, the files behind a barrel, the length of a text or a key. The size is drawn one below, at or above a number at which the compiler changes what it does (`bun build --aot-list=registry` lists them), small numbers more often than large ones. Everything else in the scene is plain, but for one place: a value of another kind, a hole, a getter, a member that is missing. Other kinds of scenes are what passes of the compiler look for and a generator of random operations seldom writes: divisions by constants, rest parameters handed on, collections filled by counted loops, awaits of direct calls, keys put together from parts, `new RegExp(text)`, `require`, imports of JSON and text, unions told apart by a tag, `new URL(text).pathname`, generators ended before their first step, the helpers that TypeScript, esbuild and Bun emit, and WebAssembly modules written as bytes. In TypeScript one more kind declares a type, calls a function over it with what the type says, and then with one value that is not: it comes through `any`, `unknown`, a type parameter, `JSON.parse` or a declaration file beside a JavaScript file. A program that gets such scenes gets no ordinary ones. `writeOneSceneOfEverySize(kind, seed, isTypeScript, size)` writes one scene of a kind, with every size in it as given.

`run-scenes-of-large-sizes.ts` builds the same kinds of scenes at sizes that a batch cannot afford, one program to a build: 256, 1,024, 4,096, 16,384 and 65,536, each kind until a build is refused, stops, or doesn't end in `--seconds` (default 600). It prints one line for each build, with the time, the memory, and how many times the time of the size before. All times are processor time, which doesn't depend on what else the machine does. It keeps a program whose build doesn't end in time (`not-ended-<kind>-<extension>-<size>`), stops (`build-stopped-`), takes 20 seconds or more and over nine times the time of a quarter of the size (`grows-`), or whose executable prints something else than `bun run` (`differs-`). `--share 3/24` lets 24 processes share the kinds, and `--rounds 0` never ends.

`--ordinary-scenes <percent>` (`write-ordinary-scenes.ts`) writes one to three scenes of ordinary code, drawn from tables, in front of the lines that print the variables. In six programs of ten the scenes are the whole program, because what the compiler knows about a function of the library depends on all its callers. A scene appends to a text and prints it at its end, and most of its statements stand in no `try`.

| Scene       | What is drawn                                                                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parsed data | Two to five texts of lists or records go through the same code, out of `JSON.parse`, a copy of its result, or literals. They are of one kind, but for a cell of another kind, a key that is missing, added or in another place. The code asks what an element is (`===`, `typeof`, `switch`, `Array.isArray`) beside arithmetic on it |
| Walks       | Iterators of arrays, sets, maps, strings and generators, iterator helpers and array methods, with built-in functions, arrows and functions as callbacks. Beside them iterators that are written by hand, as an object, a class, a class below `Iterator` or a generator, walked by `for-of`, patterns, spread and built-ins           |
| Idioms      | Built-ins that are handed to built-ins (`map(Number)`, `replace(/-/g, String)`, `JSON.parse(text, Array.of)`), and array-likes, thenables, set-likes and objects with `valueOf`, `toString` or `Symbol.toPrimitive` where a built-in takes them                                                                                       |

A fourth kind of scene is about a variable that changes in the middle of the expression that reads it: between two elements of an array literal, two members of an object literal, among them a getter and a setter of one name, two arguments, two parts of a template. What changes it is an assignment, an arrow that is called on the spot, a function, a getter. A scene is plain in most of its places, so that what is odd in it stands alone: most have one caller with one kind of value, and print what they read without a function that all values pass through.

A fifth kind is a module whose exports have the names of globals (`NaN`, `Array`), of members that every object has (`constructor`, `toString`) or of keywords (`default`, `typeof`). They are read through a namespace, the module's own or that of another file: with a pattern, by name, under a key, from a copy.

`--unwraps-try-blocks <percent>` takes `try` blocks out of a program, all or half of them: what stood in one stands in a plain block, and its `catch` is gone. A statement that throws then ends the program, in both runs.

`--names-of-globals <percent>` gives one or two variables, functions, classes or parameters of a program the name of a global, such as `NaN`, `Array` or `process`. With `--splits` such a name is also exported, imported and read from a namespace.

`--hands-over-built-ins <percent>` (`hand-over-built-ins.ts`) puts built-in functions where a program hands over functions of its own: as callbacks, as traps of a proxy, as methods of an object that a built-in calls. One program in three has one such place. A program draws from one to three built-ins, so that one of them can be the only callee that a function of the library sees.

`--prints-into-a-text <percent>` replaces `printValue` by a function of the program that appends to a text, which is printed at the end. `console.log` is a call of the host, about which the compiler knows nothing, and it sees through a function that appends to a variable.

`--validates <percent>` builds that share of the batches a second time with `--aot-validate` and runs them. A program at which that executable stops is kept as "validation", and a build that stops as "validating-build-stopped".

`--collects <percent>` runs the executable of that share of the batches a second time, with a collection at every few allocations and with what is freed overwritten (`BUN_JSC_slowPathAllocsBetweenGCs`, `BUN_JSC_useZombieMode`, `BUN_JSC_scribbleFreeCells`; the interval, and whether the collections are young, are drawn for each batch). Only programs that printed the same as under `bun run` in the first run count. One that prints something else now is asked again, and so is `bun run` in the same environment: what `bun run` prints too is only counted. The rest is kept as "collections-stdout", an end by a signal as "collections-signal", and one that `bun run` shares as "bun-run-collections-signal". `report.txt` has the environment.

`--ends-early <percent>` runs the executable of that share of the batches three times more. The runner ends the Worker of each program at a moment that it draws from a span of 1 to 256 ms (`BATCH_ENDS_WITHIN`), whatever the program is doing then. In each such pass 1, 2, 4 or 8 Workers run at the same time (`BATCH_AT_ONCE`), and half of the passes run under collections as with `--collects`. What is printed doesn't count. A process that ends by a signal is kept as `ended-early-signal`, or as `bun-run-ended-early-signal` when `bun run` of the same files ends so too. The moment is drawn anew in every run, so a find is repeated by running it many times.

`--beside-an-external <percent>` is drawn once for a process. Such a process builds everything with `--external a-package-outside`, lays that package into `node_modules` beside the programs, and lets every entry point import it first. The package does nothing. Beside it the compiler counts on code that it hasn't seen, and it compiles every function of the built-in modules: a build takes a minute and a half longer, so such a lane takes large batches.

`--one-scene <percent>` leaves a program one of its scenes: what the compiler makes of a function depends on what else the program holds.

## TypeScript

Fuzzilli writes JavaScript. With `BUN_FUZZILLI_TYPES` set, it writes TypeScript (`BunTypeScript.swift`, and the part of `fuzzilli.patch` that changes `JavaScriptLifter.swift`). What a program prints doesn't depend on its types, so the comparison with `bun run` stays the same.

```sh
BUN_FUZZILLI_TYPES=mixed BUN_FUZZILLI_PRINTS_VALUES=0 BUN_FUZZILLI_ENTRY_POINT=/tmp/fuzzilli/program.ts \
  .build/release/FuzzilliCli --profile=bunCompiler --jobs=32 --storagePath=<storage> --resume <bun>/build/fuzzilli/bun-asan
```

The extension of the entry point makes Bun read the programs as TypeScript. The programs declare `printValue` and print their variables themselves, because `// @ts-nocheck` only counts on the first line. Each variable of the top level is printed right behind its declaration and again at the end, so a program that ends early has printed what it had until then. `FuzzILTool --liftCorpusToJS` writes TypeScript too. Rename its files to `.ts`.

Fuzzilli's typer has a type for every variable. It runs twice over a program: the first run collects what each function is called with, and the second one uses that for the parameters. From those types come annotations on parameters, return values, `let` and `const`, and class fields, and an object type for each object literal. An async function returns a `Promise<T>`, a generator a `Generator<Y, R, any>`, and getters and the methods of literals have return types too.

An object type is written in one of several ways that mean the same members: an `interface`, a type alias, a mapped type, `Pick` or `Omit` of a larger interface, an interface with a type parameter that has a default, or an interface with one or two bases, where the base can be generic or joined with `&`. It can have optional members that the literal doesn't have, some of them of its own type. A literal is declared as its type also where it has accessors, methods and computed keys, and `this` in them has that type. A class names its base class where the model follows the base. A class can have a type parameter for the type of one field, an `implements` clause, fields with `declare`, `public` or `readonly`, and parameters of its constructor that are fields.

Each annotation is one of four kinds.

| Kind     | What is written                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `absent` | nothing                                                                                                                                        |
| `right`  | the type from the typer                                                                                                                        |
| `wider`  | a union with more members, `any`, `unknown`, `object`, a base interface, `Readonly<T>`, `Partial<T>`, `Same<T>`, `T & {}`, a `readonly` array  |
| `wrong`  | another primitive, another interface or class of the program, an array of other elements, a tuple, the type without its `null` and `undefined` |

A type error stops the build, and a program that doesn't build tests nothing. So for each program, one of three things makes the checker accept it.

- **Casts.** A small model follows what the checker knows about each expression. It follows arithmetic and comparisons, the members of the program's interfaces and classes, calls of its functions, methods and constructors, arrays and strings with their common methods, `Math`, `Number`, `Object`, `JSON` and other objects of the library, `Map<K, V>` and `Set<T>` with type arguments, and typed arrays. Where it can show that an operation is accepted, the operation is written as it is. Everywhere else the operands are cast to `any`, or the line gets `// @ts-ignore`. A value reaches a declaration of another type through `as any`, `as unknown as T`, `!`, or one of the detours below.
- **`// @ts-ignore` above every line.** Nothing is cast.
- **`// @ts-nocheck`.** Nothing is cast.

A detour is a generic function that returns its argument: through `pass<T>`, a generic class, a `Map<K, V>`, a callback of `map`, `filter`, `reduce`, `find`, `flatMap`, `forEach`, `sort` or `Array.from`, a `Set<T>`, a `Record<string, T>`, a rest parameter, a destructuring pattern, a variable that closures read and write, a generator, an accessor over a private field, an optional member, `T[K]`, mapped and conditional types, type parameters with defaults and constraints, a `switch` over a discriminated union, a type predicate that is always true or always false, overloads, or `JSON.parse` declared as the type. There are also enums for whole numbers and for strings, whose members are written as constants or as expressions, the enum as the type of a number, unions of a few literals, tuples for short arrays, `satisfies`, `as const`, index signatures, and `int32` for parameters, constants, members and return values. What is stored in an `int32` is written `(value | 0)` where it isn't a whole number in range. A function of the program can get a type parameter of its own, with a bound or a default, for one of its parameters and for what it returns.

Tests follow some declarations and stand at the start of some functions. A test narrows the declared type of the variable or parameter, and each branch uses the value as what the checker takes it for there. The tests are `typeof`, a comparison with `null`, `undefined` or a literal, truthiness, `instanceof` with a class of the program, a class of the library or a class whose `Symbol.hasInstance` always says yes, `in`, `Array.isArray`, and functions that return `value is T`, some of which answer the same for every argument. They are written as `if` and `else`, a conditional expression, `&&`, `||`, an early `break` or `return`, a loop, a condition kept in a constant, a closure in a branch, a call of a function that `asserts` its argument and may not look at it, a `switch` over `typeof` or over the value, a union with a member that tells its parts apart, and `?.` and `??`. The value can also be tested as a member of an object, an element of a tuple or a field. Other declarations are followed by a function with a parameter of a drawn type, which is called with the variable and with values of every kind through `any`.

A scene is such a function in which the value travels before it is used: through operations whose results are kept, typed variables and fields, variables that closures or the module hold, calls, arrays, maps, sets and patterns. The value may only be compared on the way. It may arrive in a variable in a later turn of a loop that began with a value of the declared type. A second parameter may be the only one that is tested. The parameter can have a function type and be called. The function can be an arrow function, a generator or an async function that awaits first.

A scene without a cast is a function that the checker accepts as it stands. In it a value comes to be where another type is declared, and travels on from there as in other scenes, through code without a cast. An array, a member, an instance of a generic class or a `Map` gets a second name whose type allows more, and is written through that name. A class whose method takes one type is used as an interface whose method takes more. `Object.assign` writes the member. A function with an optional second parameter is handed on as a function of one parameter, and that one as a function of two. A call changes a member between a test of the member and its use. Or nothing is there: an element past the end of a list, in a list made with `new Array<T>(2)`, behind a change of `length` or behind `delete`, a key that a record doesn't have, `firstOf<T>([])`, a variable declared with `!`, a field that a method reads before the constructor assigns it, a member that a spread replaces with `undefined`. Or the value changes below a name whose type says that it doesn't: `Readonly<T>`, `readonly T[]`, a `readonly` field or `as const`, written through a second name. The value that arrives is a literal or the variable that the scene follows, with its declared type.

As often as `generic` says, generic code stands in between. A generic function stores its second argument in its first, a list, a member, a `Map`, a `Pile<T>` or an object with a method, and is called with a type argument that allows more than the first argument's own type. `store<T, K extends keyof T>(target, key, value: T[K])` gets a key that is one of two. A class that extends `Base<T>` at one type is used as `Base` of a wider one. `asserts value is T` and `value is T` say so whatever the value is. Or generic code that is used at the type finds nothing: `lastOf<T>([])`, `Array.from<T>({ length: 2 })[1]`, `Object.values<T>({})[0]`, a field declared with `!` in `Slot<T>`, an optional parameter returned with `!`.

Bystanders are variables of the function that have nothing to do with the value: a counter, a fraction, a text, a list, an object, a closure that counts. Statements between the steps of the journey change them, some of them inside closures that also hold the value, and the function prints them at the end, or returns them, also in a new list or a new object out of which the caller reads. The counter starts at 0 or at what the caller gives: a parameter, one with a default, a rest parameter, a member of an object. A scene has the counter alone, the counter and one more, or all of them. What is computed from the value is sometimes stored back where the value came from. Beside about a third of the scenes stands a twin: a function that makes an object with a key that the journeys use (`held`, `value`, `first`), which holds another type there. Three twins of four are called. The `try` is inside the function or around its call. The call stands alone, in a loop, also a loop of one turn, in a loop within a loop, in a callback of `forEach`, or four times in a row: how often the compiler expects a function to run follows from that.

A program that is its scenes alone has one to four scenes at the top level, the helpers that they use and nothing of what Fuzzilli wrote, which then only seeds the choices. `without-casts` says how many of the scenes are without a cast. If Fuzzilli's program has no class, its interfaces stay declared, and the scenes use them: a literal with the members of an interface is a value of it.

Other declarations are followed by statements that change what the variable holds, through `any`. A member or an element gets a value of another kind, is deleted or becomes an accessor. The object gets another prototype, one more member, or is frozen. A method is replaced. An array gets holes or another length. A variable declared with `let` gets a value of another kind. Or the statements call a function, a constructor or a method that the program declares, with values of every kind.

`BUN_FUZZILLI_TYPES` is `mixed`, `right`, `wider`, `wrong` or `absent`, or a list such as `right=70,wrong=30,generic=50`.

| Setting                             | Default        | Meaning                                                                       |
| ----------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| `absent`, `right`, `wider`, `wrong` | 15, 45, 20, 20 | weights of the four kinds                                                     |
| `unchecked-file`                    | 10             | percent of programs with `// @ts-nocheck`                                     |
| `every-line-ignored`                | 10             | percent of programs with `// @ts-ignore` above every line                     |
| `ignored-line`                      | 25             | percent of operations that get `// @ts-ignore` and no casts                   |
| `generic`                           | 25             | percent of annotated variables whose value takes a detour                     |
| `declared`                          | 50             | percent of expressions that get a variable of their own and aren't inlined    |
| `int32`                             | 10             | percent of `number` annotations that become `int32` where the build allows it |
| `files`                             | 0              | percent of programs whose declarations are in files of their own              |
| `tested`                            | 12             | percent of declarations that tests or a scene follow                          |
| `without-casts`                     | 25             | percent of those in which it is a scene without a cast                        |
| `scenes-alone`                      | 0              | percent of programs that are their scenes and nothing else                    |
| `seed`                              | 0              | changes every choice                                                          |

A program always becomes the same text. The profile puts a string such as `"types 123"` at the start of every program (`TypeScriptSeeds`), which seeds its choices. Each choice is drawn from that seed and from a number for the place where it is made. That number is computed from the instruction, from what it uses and, for a block, from one instruction in it, and not from the numbers of variables or the rest of the program. So when Fuzzilli removes or changes a part of a program, the rest keeps its types: a finding can be reduced, and a program in the corpus hands its types on to the programs made from it. Another such string inside a block seeds what follows it there. In 15 of 100 programs the profile adds or changes one, which draws the types of a part of the program again. `TypeScriptSeeds` also turns away the programs that are refused whatever their types are (`rejectProgramThatCannotBuild`): a store to a built-in or to a member of one, a private name outside its class or declared twice, `super()` in a class without a base class, and a regular expression with the flag `v`. A program without a seed, such as one from an older corpus, takes a hash of itself. With `files`, the helpers and enums of a program go to one file and its object types to another, and the program imports them. The file of helpers and a second file can import each other, the program can import everything from a file that only has `export *`, and in a third of these programs all helpers are in one file that is the same for every program, so the programs of a batch share it. Two in five of these programs also import a CommonJS file (`.cjs`) that requires a second one, which may require it back. The file exports through `exports.x`, `module.exports`, `this`, `__esModule` with `default`, a function or a class with members, getters, or a loop over the names. The program imports it by default, by name, both, as a namespace, with `require` or with `await import`. Each file follows the program behind a line `// @filename: ./<name>.ts`, so whatever writes the program to disk has to cut the text there and put the files beside it.

In a typed run the profile adds five code generators (`typeScriptCodeGenerators`): an object whose accessors and methods store it into itself and hand it on, a variable that a closure captures and that holds objects and primitives in turn, a variable that is compared with an object and then used as a key, a class with a base class, and whole numbers in operators, templates and keys. The profile turns off `with`, which TypeScript doesn't allow. It starts 15 in 100 instances of Bun with `--aot-erase-types`, which compiles the same text without reading its types.

## For so many minutes, without Fuzzilli

`lane.ts` starts several drivers that draw their programs themselves (`--draws`), ends them after so many minutes, and lists what they found in the files that `../run.ts` writes. It needs nothing but Bun. `../burst.ts` starts it beside its runs of `run.ts`. `--kind` picks which programs are drawn and how many share a build; the table stands at the top of the file.

```sh
bun test/aot/fuzz/fuzzilli/lane.ts --kind few --minutes 60 --jobs 8 --out /tmp/lane
```

## Try one program without Fuzzilli

`reprl.py` speaks Fuzzilli's protocol to one Bun. It prints how each program ended, how long it took, and programs per second. The program as it ran, and what the two runs printed, are left beside the entry point.

```sh
BUN_JSC_useJIT=0 python3 test/aot/fuzz/fuzzilli/reprl.py build/fuzzilli/bun-asan build --compile --aot --aot-validate \
  --aot-verify-each-pass --aot-threads=1 /tmp/fuzzilli/program.js -- a.js b.js
```
