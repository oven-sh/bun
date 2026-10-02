# Tools for ahead-of-time compilation

For working on `bun build --compile --compile-aot`. Each script says how to use it at the top.

Most of them need the **map** of the image, which says what is where in its code. A build writes one when it is asked to:

```sh
BUN_AOT_OPTIONS=aotMapFilePath=app.map bun build --compile --compile-aot app.ts --outfile app
```

| Question | Tool |
| --- | --- |
| It crashed. Where? | `decode-trace.ts crash.txt --exe bun-profile --map app.map` decodes the trace string that the crash handler prints, locally. |
| What code did this function get? | `disassemble.ts app --map app.map <name>`. Branches say which function or stub they go to. |
| Where does the time go? | `sample <pid> 5 -file app.sample`, then `sample-report.ts app.sample --map app.map --code-at <address>`: by compiled function and by stub. The code is mapped at another address in every run; `BUN_AOT_VERBOSE=1` prints it at start ("of code at 0x..."). |
| Which call sites are the stubs called from? | `lr-probe.c` and `lr-report.ts`. A stub pushes no frame, so `sample` gives its time to the wrong caller. `disassemble.ts --samples` puts the samples next to the instructions. |
| Does it still do what the interpreter does? | `stress.ts` runs WebKit's `JSTests/stress` through `--compile-aot`, each test against itself run from bytecode. Run it after adding a lowering. |
| How do I keep a runaway compile from taking the machine down? | `capped.ts <GB> <seconds> <command...>` |

The tests are `test/bundler/bundler_compile_aot*.test.ts`, `test/cli/run/run-aot.test.ts` and `test/cli/test/test-aot.test.ts`. The programs
in `test/bundler/compile-aot/` print what they compute, and must print the same with and without ahead-of-time compilation,
in every configuration that `bundler_compile_aot_programs.test.ts` lists.

In WebKit, `Tools/Scripts/aot/fuzz.py` mutates `JSTests/stress` and compares the interpreter with compiled code in the `jsc`
shell, and `run-jsc-stress-tests` has the modes `aot` and `aot-validate`.
