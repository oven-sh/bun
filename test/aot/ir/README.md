# IR text tests

## What is here

Tests of the front end of `bun compile`. A test is one source file: a small program, plus directives in `//` comment lines that say
what to run and what the printed IR must contain.

```ts
// RUN: lower
// CHECK-LABEL: function {{*}}name="add"
// CHECK: [[sum]] = Add
// CHECK-NOT: = Add

export function add(a: number, b: number): number {
  return a + b;
}
```

The driver is `src/aot/tests/ir_tests.rs`, with `src/aot/tests/support/`.

| Area | What it tests |
| --- | --- |
| `commands/` | the commands `lower`, `link` and `emit`, and the option words |
| `lower/<construct family>/` | lowering, one folder per family of constructs |

- A test file ends in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` or `.cjs`. A declaration file (`.d.ts`, `.d.mts`, `.d.cts`)
  is not a test, and neither is a `package.json` or a `tsconfig.json`.
- The driver descends into subfolders. Folders named `imports` and `node_modules` contain what tests import, not tests.
- `tsconfig.json` here is the one every test sees, unless a folder below has one of its own.
- To add an area, create a folder here and add two lines to `ir_tests.rs`: an entry in `AREAS` and a `#[test]`.

## Running

Every area. Run `bun bd` once first: it writes the generated tables that `bun_aot` includes.

```sh
cargo test -p bun_aot --test ir_tests
```

One area:

```sh
cargo test -p bun_aot --test ir_tests lower
```

| Variable | Effect |
| --- | --- |
| `TESTAOT=<testaot>` | the engine reads, types and verifies what each run emits. CI sets it |
| `AOT_IR_FILTER=<text>` | runs only the files whose path contains the text |
| `AOT_IR_OUTPUT=<folder>` | writes what each run printed to `<folder>/<path below test/aot/ir>.<PREFIX>.txt`, followed by its diagnostics and statistics as `DIAGNOSTIC:` and `STATISTIC:` lines. A run that failed outright writes `FAILED: <why>` |
| `AOT_IR_JOBS=<n>` | runs n files at a time. The default is one per core |

What the tests print:

| Line | Meaning |
| --- | --- |
| `FAIL <file>:<line>: <why>` | the expectation on that line does not hold. The test fails |
| `SKIP <file>:<line>: <command>: TESTAOT is not set` | the check lines were compared, but the engine did not see the output |
| `SKIP <area>: the engine verified none of <n> runs: ..` | the same for the area, on stderr, so it shows in a passing run too |
| `PANIC <file>` | the file was running when some thread panicked |

The front end works on threads of a shared pool, so a panic cannot be traced to one file: `PANIC` names every file that was
running. With `AOT_IR_JOBS=1` that is one file. Where tests are built to abort on a panic, the panic ends the area, and the `FAIL`
lines of the other files are lost.

## What a run does

Every command does the same work, and they differ only in what they print:

1. It loads, checks, lowers and links, with the file as the only entry point.
2. It prints, and the check lines are matched against that text.
3. It serializes the program and passes the bytes to `$TESTAOT print --wire`, which reads, types and verifies them.
   - The engine prints the program as it read it. That text must equal the front end's, line by line.
   - If the engine reports diagnostics instead, the `DIAGNOSTIC` lines decide.
   - A tool that cannot be started, or that fails in any other way, fails the run.

| Command | Prints |
| --- | --- |
| `lower` | the functions of the entry module, in id order |
| `link` | the program: a line per record (`signature`, `layout`, `variable`, `module`, .., `entry`), and every function with its body |
| `emit` | the same as `link` |

No command takes an argument. A program that does not build is not a failure by itself: the output is empty, and the `DIAGNOSTIC`
lines decide. An internal error of the front end always fails the run.

The build differs from `bun compile` in three ways:

- **Every export of the entry point counts as read.** In a product build link drops an export that the host does not read, and
  with it a function that only the export keeps.
- **Bun's own modules are not loaded.** `node:path` is a value of the host, not a module with source. The program has the test's
  modules and the compiler's library (`/$bun/js/prelude/*.ts`).
- **It runs on one thread**, unless `threads=` says otherwise.

## Directives

`<P>` is `CHECK` for a `RUN:`, and the prefix for a `RUN(<prefix>):`.

```
RUN: <command>
RUN(<prefix>): <command>
OPTIONS: <option word> { <option word> }
<P>: p
<P>-NEXT: p
<P>-NOT: p
<P>-LABEL: p
<P>-COUNT-<n>: p
DIAGNOSTIC: <name> [ <count> ]
STATISTIC: <StatisticID> ( = | >= | <= ) <n>
```

A directive is a whole comment line: `//`, a name in capitals, then `:`. A comment after code on the same line is never a
directive. Any other name in capitals before a `:` is an error, so a mistyped directive does not pass as a comment.

- **`RUN`.** A file has at least one. Each `RUN` is a build of its own. A prefix is capitals and digits, and it is not `RUN`, `FORM`,
  `OPTIONS`, `DIAGNOSTIC`, `STATISTIC` or `CHECK`. A prefix needs at least one check line.
- **`OPTIONS`, `DIAGNOSTIC` and `STATISTIC`** apply to every `RUN` in the file.
- **`OPTIONS`** takes `erase-types`, `type-errors=silent`, `type-errors=log` and `threads=<n>`. The engine's option words are unknown here.
  How a mismatch is reported is a policy of the engine, so `type-errors=` changes one thing in the IR: only with `log` does a type
  site have the text of its type, which only the log prints.
- **`DIAGNOSTIC`** takes one of these names. With a count, the diagnostic must be reported that many times.
  - `TS<number>`: the code of a diagnostic of TypeScript or of the front end (`src/aot/diagnostic_codes.rs`). `TS0` is not a code.
  - `Build` or `Resolve`: a build error or a resolve error, which have no code.
  - A member of `UserDiagnosticKind` or `InternalErrorKind`: what the engine reports. Without `TESTAOT` the line is not judged, and
    the run is listed as `SKIP`.
- **A warning is a diagnostic too.** A diagnostic that no line lists fails the run, so a test whose build warns needs the line: an
  unresolved `require()` is `// DIAGNOSTIC: TS100150`.
- **`STATISTIC`** names a statistic as the schema does: `ProgramBytes`, `FunctionsLowered`, and `<LimitID>Hits` for how often a limit was
  hit (`MaxNestingDepthHits`). One that was not counted reads as 0, and so does every statistic of the engine.
- **`FORM`** is for the engine's tests, and an error here.

## Patterns

Check lines work like LLVM's FileCheck, without regular expressions. A pattern matches part of an output line.

- `<P>: p` matches somewhere after the previous match, possibly on the same line.
- `<P>-NEXT: p` matches on the line after the previous match.
- `<P>-NOT: p` matches nowhere between the matches before and after it. With no match after it, it covers the rest of the block.
- `<P>-LABEL: p` splits the output into blocks. Labels are found first, and the check lines between two labels see only the
  output between them. Without labels, the whole output is one block.
- `<P>-COUNT-<n>: p` matches n times in order (1 to 1000), with any output between the matches. For exactly n, put a `-NOT` after it.

Three things in a pattern are not literal text:

- A run of spaces or tabs matches a run of spaces or tabs.
- `{{*}}` matches any text within the line, including none. A literal `{` cannot stand directly before it.
- `[[name]]` is a variable. Its first use binds it to a whole token (the longest run of `A-Z a-z 0-9 _ . $`, never part of one),
  and every later use must equal that token.

A label cannot use a variable. Each `RUN` starts with no variable bound. A `-NOT` binds nothing: it is tried after the match that
follows it, with that match's bindings.

The engine's tests have the same check lines and patterns. `aot/tests/README.md` in WebKit describes them, and the IR text.

## Writing a test

- **Export what the test looks at**, or use it in something exported. Link keeps what an export or the module body reaches and drops
  the rest, so a function that nothing reaches is not printed.
- **Enter a function with a label**: `// CHECK-LABEL: function {{*}}name="add"`. Where a variable is needed, `function [[add]] name="add"`.
- **Bind ids**, never write `v12`, `b3` or `f7`.
- **The printer omits a field that has its zero value** (`role=Source`, `kind=Plain`). A pattern cannot name one: a positive line with it
  never matches, and a `-NOT` with it always passes.
- **A `-NOT` stops at the positive lines around it.** To check that something appears nowhere in a function, give the function a block
  with no positive line, or put the `-NOT` on both sides of the only one.
- **`link` prints the source of each module** in `functionText`, with the directives in it. The check lines do not see that text: it
  is hidden before they are matched. `path=".../link-imported-function"` still contains the word `function`. Begin the pattern with
  the record's keyword and id: `module [[m]] path=`, `variable [[g]] name="x"`.
- **Keep the source free of type errors**, unless the test expects one: a type error in a `.ts` file stops the build. A `.ts` file is
  checked and its written types are tested at run time. In a `.js` file nothing written is tested.
- **A rule gets a positive and a negative case**, in one file or in neighbors.

| What it tests | Where |
| --- | --- |
| A lowering rule | `lower/<construct family>/`, with `// RUN: lower`, or `// RUN: link` where a check names a record |
| A command or an option word of this driver | `commands/` |
| The directives and the matcher | the unit tests in `src/aot/tests/` |
| A rule of the IR, a pass or an analysis of the engine | `aot/tests/` in WebKit |
| A whole program and its output | `test/aot/programs` |
