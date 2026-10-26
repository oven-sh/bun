# Fuzzilli for `bun build --compile --aot`

[Fuzzilli](https://github.com/googleprojectzero/fuzzilli) generates JavaScript programs and keeps the ones that reach new code in the target. Here the target is the ahead-of-time compiler: the front end (`src/aot`, `src/sema`) and the engine's half (`aot` and `b3` in JavaScriptCore).

## What runs

In a build with `--fuzzilli=on`, `bun build --compile --aot <file>` that Fuzzilli starts doesn't build `<file>` and exit. It stays alive and takes one program after another from Fuzzilli. It compiles each one through every stage up to the finished image, which stays in memory. It writes no executable and runs nothing. The code is `src/runtime/cli/fuzzilli_compile_loop.rs`.

Most of what a small build does is the same for every program, so Bun does that part once. It compiles an empty program, then starts a second build that loads the declaration files, loads and lowers Bun's own code, and stops right before it reads the entry point (`Preload` in `src/options_types/aot_options.rs`). From there it forks once for each program. The child finishes the build, and the parent tells Fuzzilli how the child ended. A crash ends only the child.

A forked process has one thread, so the whole build runs on it. To fold a call of a built-in, the compiler runs it in a small VM, which the child creates. Bun has to be started with `BUN_JSC_useJIT=0` so that this VM only interprets. The profile sets it. The compiler's output doesn't depend on it.

Two things differ in an engine built with `--fuzzilli=on`. A forked process inherits the memory that the engine has reserved. And until the whole-program analysis has run, `--aot-verify-each-pass` and the program verifier skip Bun's own functions: they are the same in every build, and the analysis then drops the ones the program doesn't reach.

| The build                                                                            | What Fuzzilli sees |
| ------------------------------------------------------------------------------------ | ------------------ |
| succeeds                                                                             | exit code 0        |
| is refused with a diagnostic                                                         | exit code 1        |
| crashes, fails an assertion, or fails `--aot-validate` or `--aot-verify-each-pass`   | a crash            |
| reports an `internal compiler error`                                                 | a crash (SIGABRT)  |
| takes more than `BUN_FUZZILLI_CPU_SECONDS` of processor time (default 30)            | a crash (SIGXCPU)  |
| grows the process by more than `BUN_FUZZILLI_MEMORY_MEGABYTES` (default 4096, Linux) | a crash (SIGABRT)  |

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
cp <bun>/test/aot/fuzz/fuzzilli/BunCompilerProfile.swift Sources/Fuzzilli/Profiles/
git apply <bun>/test/aot/fuzz/fuzzilli/fuzzilli.patch
swift build -c release
```

## Run

```sh
mkdir -p /tmp/fuzzilli
BUN_FUZZILLI_ENTRY_POINT=/tmp/fuzzilli/program.js .build/release/FuzzilliCli --profile=bunCompiler \
  --jobs=32 --storagePath=<storage> --resume <bun>/build/fuzzilli/bun-asan
```

`--additionalArguments=--no-builtin-modules` makes a build about twice as fast: Bun's own modules are not compiled along with each program. Some syntax needs a helper from them, so when such a build reports an internal error, Bun builds the program once more with the modules and reports what that build says.

Each instance of Bun writes the program it is compiling to `/tmp/fuzzilli/<process id>.program.js`, so put that folder on a RAM disk. Run the whole thing somewhere it can't reach the network or your files, for example in `test/aot/real-apps/jail.sh`.

## Try one program without Fuzzilli

`reprl.py` speaks Fuzzilli's protocol to one Bun. It prints how each build ended, how long it took, and programs per second.

```sh
BUN_JSC_useJIT=0 python3 test/aot/fuzz/fuzzilli/reprl.py build/fuzzilli/bun-asan build --compile --aot --aot-validate \
  --aot-verify-each-pass --aot-threads=1 /tmp/fuzzilli/program.js -- a.js b.js
```
