# IR text tests

These test the front end of `bun build --compile --aot`. A test is one source file: a small program, plus directives in `//` comment lines that say what to run and what the printed IR must contain.

```ts
// RUN: lower
// CHECK-LABEL: function {{*}}name="add"
// CHECK: [[sum]] = Add
// CHECK-NOT: = Add

export function add(a: number, b: number): number {
  return a + b;
}
```

| Folder | What it tests |
| --- | --- |
| `commands/` | the commands and the option words |
| `lower/<construct family>/` | lowering, one folder per family of constructs |
| `lower/programs/<topic>/` | whole programs |

Folders named `imports` and `node_modules` hold what tests import, not tests. The driver is `src/aot/tests/ir_tests.rs`, with `src/aot/tests/support/`.

## Run

Run `bun bd` once first. It writes the generated tables that `bun_aot` includes.

```sh
cargo test -p bun_aot --test ir_tests          # everything
cargo test -p bun_aot --test ir_tests lower    # one folder
```

| Variable | Effect |
| --- | --- |
| `AOT_IR_FILTER=<text>` | runs only the files whose path contains the text |
| `AOT_IR_OUTPUT=<folder>` | writes what each run printed into the folder |
| `AOT_IR_UPDATE=1` | rewrites the lines below a `GENERATED` line that no longer hold |
| `AOT_IR_JOBS=<n>` | runs n files at a time. The default is one per core |
| `TESTAOT=<testaot>` | the engine also reads and verifies what each run emits. CI sets it |

A failure is a line `FAIL <file>:<line>: <why>`. Without `TESTAOT` the check lines are still compared, and each run prints a `SKIP` line.

## Write a test

Put the file in `lower/<construct family>/` and start it with `// RUN: lower`. Nothing has to be registered.

| Command | Prints |
| --- | --- |
| `lower` | the functions of the entry module |
| `link`, `emit` | the whole program: a line per record, and every function with its body |

| Directive | Meaning |
| --- | --- |
| `RUN: <command>`, `RUN(<PREFIX>): <command>` | runs a command and matches its output against the `CHECK` lines, or the `<PREFIX>` lines |
| `OPTIONS: <option word>..` | `erase-types`, `builtin-modules`, `runs-tests`, `runs-in-place`, `platform=darwin`, `threads=<n>` and a few more. `support/commands.rs` has the list |
| `DIAGNOSTIC: <name> [<count> or <file>:<line>]` | the build must report it. The name is `TS<number>`, `Build`, `Resolve` or one of the engine's kinds. A diagnostic that no line lists fails the run, and a warning counts |
| `STATISTIC: <name> >= <n>` | holds a counter of the build to a number. Also `=` and `<=` |
| `FILE: <path>` | begins another file, so one test can hold a tree. `ENTRY:`, `CWD:` and `LINK:` go with it |
| `SAME: <PREFIX> <PREFIX>` | the two runs print the same |
| `GENERATED: <function name>..` | the last directive. `AOT_IR_UPDATE=1` writes the lines below it |

The check lines (`CHECK`, `-NEXT`, `-NOT`, `-LABEL`, `-COUNT-<n>`) and the patterns (`{{*}}`, `[[name]]`) are the ones of the engine's tests. `Source/JavaScriptCore/aot/tests/README.md` in WebKit describes them.

- Export what the test looks at. A function that nothing reaches is printed without its body.
- Enter a function with a label: `// CHECK-LABEL: function {{*}}name="add"`.
- Bind ids with `[[name]]`. Never write `v12`, `b3` or `f7`.
- The printer leaves out a field that has its zero value, so a pattern cannot name one.
- A type error in a `.ts` file stops the build. Write `// @ts-expect-error` before the line, or list it: `// DIAGNOSTIC: TS2322`.
- Give a rule a positive and a negative case.

To hold a whole function to what is printed today, end the file with `// GENERATED: add` and run `AOT_IR_UPDATE=1 AOT_IR_FILTER=<file> cargo test -p bun_aot --test ir_tests`.

To add a folder beside `commands/` and `lower/`, add an entry to `AREAS` and a `#[test]` in `ir_tests.rs`.
