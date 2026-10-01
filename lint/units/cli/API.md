# API of the cli unit

What another unit reads to learn the interface of `bun --lint`, of the crate `bun_lint` and of the diagnostic code
on `bun_ast::Msg`. Worktree `/workspace/wt/cli`, branch `robobun/abbc0c92/lint-cli`. The references are
microsoft/typescript-go 89d5d5b (`/workspace/ref/typescript-go`) and eslint/eslint 4618052e
(`/workspace/ref/eslint`, version 10.11.0 of its package).

Where to look:

- The parser unit: "Diagnostic code on `bun_ast::Msg`" is the interface it waits on. "Which parse entry a file
  gets" says what `Parser::parse_for_lint` will change.
- The conformance unit: "What `bun --lint` prints" is the contract of the plain format, of the codes and of the
  exit codes. "Plain format of tsc" has the writer and the options that give the bytes of a baseline.
- The typecheck unit: "Public surface of `bun_lint`" has the diagnostic that a diagnostic of the checker becomes.
- The integrator: "State of the tree", "The command `bun --lint`", and the lists of differences: "Rules and ESLint"
  for the rules, "Differences from the reference" in the sections of the two ports of typescript-go.

Two kinds of sections. A section about one piece of code ("Operands", "Diagnostic code", "Order and
deduplication", "Plain format", each "Rule") says what that code does. It was written with the commit that added
the code, and its paragraph "Not verified" is about that time. The other sections say what is decided for the unit
as a whole: cli.md, and the rulings of the research that arbitrated C1, C2 and C3.

How much of all that the tree holds is kept in ONE place, "State of the tree". It is a reading of the commit that
it names, and it has the commands that show what has changed since. The other sections do not keep the state:
where one of them says what the tree has or lacks, the sentence is dated ("since `<commit>`", "when this was
written", "yet") or points there.

## State of the tree

This is the one section of this file that keeps the state of the tree, and it is a reading of ONE commit:
`6f1c493a64` (2026-09-30 21:40 UTC). It is about the files of that commit (`git show 6f1c493a64:<path>`), not about
what the worktree held beside them: other steps had work there that was not committed. Everything here is from
reading the source. Nothing was built or run for this section.

The branch moves in small commits, several in an hour, and a reading that is not renewed is wrong after the next
one. This section named `e8031ec9ce` long after `7dd3e55437` had made the rules run, and went on saying that no
rule runs. So it carries its own checks: "The checks" below lists what came after this reading and has, for each
entry of "Not in the tree", a command that prints something once the part is there. For any other commit than the
one named here the checks are right and the two lists are not. Whoever lands a part moves its entry and names the
new commit here.

No build of the branch exists. At this commit `bun_lint` does not compile (the module of one rule is missing) and
`bun_jsc` and `bun_runtime` do not compile (three match arms are missing); both are under "Not in the tree".
`build/debug/bun-debug` of the worktree is still the binary of e3566be889 (build id
`fa081293ab45b8578a3c33a16fdc4047349fa8cd`, linked 2026-09-29 16:08; `LOG.md`, section 2), and that binary runs a
file that is given with `--lint`. So no binary of this branch has the flag, none of the `bun:test` files named
below has run against this code, and what this file says that `bun --lint` does is what the code says. No gate
(build, `cargo check`, clippy, the tests) has a run at this commit: `LOG.md`, "Gate results".

In the tree:

- `src/ast/lib.rs`: the code on `Msg` (`Metadata::Code`, `Msg::code`, `Log::add_range_error_with_code`, the
  assertion on the size), since `4d9b8e5139`.
- `src/lint/`: the diagnostic, its order and deduplication, the plain writer with its line map and its path names,
  the code frame, the rule type, the context of a rule, the re-scan of tokens (`tokens.rs`), the helpers of
  ESLint's `ast-utils` (`ast_utils.rs`), the one walk (`linter.rs` calls the handlers of all eleven rules and
  `rules/mod.rs` declares their eleven modules), and the modules of ten rules: `no_compare_neg_zero.rs`,
  `no_dupe_class_members.rs`, `no_dupe_keys.rs`, `no_duplicate_case.rs`, `no_empty_pattern.rs`,
  `no_self_assign.rs`, `no_sparse_arrays.rs`, `no_unsafe_negation.rs`, `use_isnan.rs` and `valid_typeof.rs`.
- ESLint's attribution, since `d6cf19f5dd`: the second line of `src/lint/UPSTREAM_PORTED`,
  `eslint/eslint 4618052eed6bb3ef420cf0db0490bbda2fd835a5`, and ESLint's licence text, `src/lint/LICENSE.eslint`.
- The flag, the gate and the branch, since `0eb4275454`, `8358260034` and `66bf3e151e`. `AUTO_OR_RUN_PARAMS` of
  `src/runtime/cli/Arguments.rs` has the row `--lint`, and `src/options_types/context.rs` has `ContextData.lint`.
  `parse` reads the flag for the auto command and for `bun run` alone and returns there through `accept_lint`,
  ahead of `bunfig.toml` and of every other flag. `accept_lint` asks `lint_is_enabled` for the variable.
  `src/runtime/cli/mod.rs` declares `lint_command`, and `exec_auto_or_run` calls `lint_command::exec` directly
  after `init`, ahead of every run mode.
- `src/runtime/cli/lint_command.rs`: `exec`, and the refusals that other files call. `exec` reads each operand,
  parses JavaScript with `Parser::parse_only` and runs the rules on it inside that call (`bun_lint::lint`, since
  `7dd3e55437`), parses TypeScript with `Parser::parse` and runs no rule on it, makes a `bun_lint::Diagnostic` of
  each message of the parser, sorts and deduplicates the diagnostics of the run, writes code frames when stderr is
  a terminal and the plain format when it is not, and exits with 0, 2 or 1 ("Operands").
- Of the refusals of "The command `bun --lint`": the gate (`G`) and the run without an operand; the rows 1, 9, 11,
  13, 14 and 15 of the table; the compiled executable; `--sequential`, `--workspaces` and `--interactive`. Row 1
  has no code of its own: it is what clap answers to a value for a row that takes none.
- `test/cli/lint/`: `lint.test.ts` (the file that is not run, the gate, the refusals, the operands),
  `diagnostics.test.ts`, `rules.test.ts`, `lint-helpers.ts`, and the cases of all eleven rules in
  `rules/<rule>.json`. `test/cli/env/bun-options.test.ts` has the tests of row 13. `src/lint/tests.rs` and the
  `mod tests` of the modules are Rust tests that CI does not run (point 3 of "Open" below).

Not in the tree. "The checks" uses the numbers:

1. `src/lint/rules/no_debugger.rs`, the module of the eleventh rule. `rules/mod.rs` declares it and `linter.rs`
   calls `rules::no_debugger::s_debugger`, so `bun_lint` does not compile without the file, and `bun_runtime`
   depends on `bun_lint`. The cases of the rule are in the tree (`test/cli/lint/rules/no-debugger.json`).
2. The three match arms that `Metadata::Code` forces in `bun_jsc` and `bun_runtime` ("Diagnostic code on
   `bun_ast::Msg`", under "Open"). Without them the two crates do not compile: the code on `Msg` is done in
   `bun_ast` only and the workspace does not build. The request is X2 of `NEEDS.md`.
3. The refusals of the rows 2 to 8, 10 and 12 of the table. Nothing refuses such a command line at this commit.
   A lint run returns from the argument parser before the flags of those rows are read, so
   `bun --lint --watch x.ts` checks `x.ts` once and exits.
4. The three tests of "Unchanged on purpose" (cli.md C1.5): `bun x.ts --lint`, `bun lint`, `node --lint y.js`.
   `test/cli/run/as-node.test.ts` is as it was at e3566be889.
5. `Parser::parse_for_lint`. The parser unit has it on its own branch (`robobun/abbc0c92/lint-parser`, worktree
   `/workspace/wt/parser`, read there at `e200dc91ce`: `src/js_parser/parse/parse_entry.rs`, and "Syntax errors
   of a lint parse" in its `API.md`). This branch has none of those commits, so "Which parse entry a file gets"
   holds as it is written. Two things there do not fit what is here, both for the integration: that entry hands
   its closure a `ParsedForLint` where `bun_lint::lint` takes a `ParsedOnly`, and it keeps the codes of syntax
   errors in a table of its own (`SyntaxErrors`) where this branch has them on `Msg`.

The checks, run in `/workspace/wt/cli`. After `#` is the entry and what the command printed at `6f1c493a64`:

```sh
git log --oneline 6f1c493a64..HEAD                                    # what came after this reading: nothing
git ls-tree --name-only HEAD src/lint/rules/no_debugger.rs            # 1: nothing
git grep -n 'Metadata::Code' HEAD -- src/jsc src/runtime/server       # 2: nothing
git grep -n -E 'refuse\("|--lint cannot be' HEAD -- src/runtime/cli   # 3: ten lines, see below
git grep -n -e '--lint' HEAD -- test/cli/run/as-node.test.ts          # 4: nothing
git grep -n -E '^describe\(' HEAD -- test/cli/lint/lint.test.ts       # 4: nine lines, none of a test of C1.5
git grep -n 'fn parse_for_lint' HEAD -- src/js_parser                 # 5: nothing
git grep -n 'EXPERIMENTAL_LINT' HEAD -- src/bun_core/env_var.rs       # "Open" 1: nothing
git grep -n 'bun_lint' HEAD -- scripts/rust-miri.ts                   # "Open" 3: nothing
git grep -n -i 'eslint' HEAD -- LICENSE.md docs/project/license.mdx   # "Open" 4: nothing
readelf -n build/debug/bun-debug | grep 'Build ID'                    # fa081293...: the binary of e3566be889
```

The check of entry 3 lists every refusal that the tree has: a row of the table is in the tree when its text is in
that list. The ten lines at this commit. In `lint_command.rs`: the text of `refuse`
(`--lint cannot be used with {}`), `refuse("bunx")`, `--lint cannot be set in BUN_OPTIONS`,
`--lint cannot be used in a compiled executable`, `--lint cannot be set in --compile-exec-argv` and
`--lint cannot be used with \"{}\" after the first file`. In `Arguments.rs`: `refuse("--sequential")`,
`refuse("--workspaces")`, `refuse("--interactive")` and `refuse("bun build")`. A row that is missing will be one
more `refuse("<what>")`, with the words of its line after `cannot be used with`.

Open, for the owner of a file that is not this unit's, with the exact text. `NEEDS.md` beside this file is where
such a request is written out (it has point 2 as X2 and point 3 as X3; points 1 and 4 are in this list only);
this list is the short form:

1. `src/bun_core/env_var.rs` (no unit owns it), inside `pub mod feature_flag`, after the line of
   `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT`:
   `new_feature_flag!(pub BUN_FEATURE_FLAG_EXPERIMENTAL_LINT, "BUN_FEATURE_FLAG_EXPERIMENTAL_LINT", {});`
   It is then read as `bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_LINT.get() == Some(true)`.
   The macro expands to `pub(crate)` items, so it cannot be used from `bun_runtime`. Until the line is there,
   `lint_is_enabled` of `Arguments.rs` reads the variable with `bun_core::getenv_z` and has the truth rule of
   `string_is_truthy` written out. The values that turn the flag on do not change with that line.
2. The three arms for `Metadata::Code` in `src/jsc/VirtualMachine.rs`, `src/jsc/lib.rs` and
   `src/runtime/server/DevErrorPage.rs`: their text is in "Diagnostic code on `bun_ast::Msg`" and in X2 of
   `NEEDS.md`. They are not applied (entry 2 above), and `bun_jsc` and `bun_runtime` do not compile until they
   are.
3. `scripts/rust-miri.ts`, the list `MIRI_CRATES`: add `"bun_lint"`. CI runs the `#[test]`s of a crate only when
   the crate is in that list. `bun_ast` is in it, `bun_lint` is not.
4. `LICENSE.md` and `docs/project/license.mdx` (files of the conformance unit): ESLint is MIT and COMMON.md rule 9
   speaks of Apache-2.0 only. `src/lint/LICENSE.eslint` is in the tree. The line for the two files, which the
   research of C3 proposes under "Additional credits":
   `- Bun's lint rules are a port of rules of [ESLint](https://github.com/eslint/eslint) (MIT, notice in src/lint/LICENSE.eslint).`

## The command `bun --lint` (rulings of C1)

`bun --lint <files>` and `bun run --lint <files>` check their operands and run none of them. This section is cli.md
C1 with the rulings of its arbitration (2026-09-29, read and probed at e3566be889). The probes, and the planned
`lint_command.rs` that was type-checked with the arguments of `bun_runtime`, are in `c1-seam-arbitration-topdown/`
(`HOWTO.txt`, `typecheck/lint_command_typecheck.rs`). Which parts of it the tree has is in "State of the tree".
For those parts the text below was compared with the code and with its tests at the commit named there, by
reading: the messages, the order of the checks and what each test expects are what is written here, and what the
code has beyond the table is listed under it. For a part that is not in the tree the text is the ruling alone:
where its code and its tests, once they land, say something else, they are right and this section is to be
corrected.

### Flag, gate and dispatch

- The flag is `--lint`. It takes no value and has no help text, which hides it. It is one row in
  `AUTO_OR_RUN_PARAMS` (`src/runtime/cli/Arguments.rs`), which feeds `AUTO_TABLE` and `RUN_TABLE`, and it is read
  only for the auto command and for `bun run`, into `ContextData.lint: bool` (`src/options_types/context.rs`).
  `RUN_TABLE` is also the table of node emulation and of `bunx`: neither reads the flag.
- The gate is the environment variable `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT`, with the truth rule of the feature
  flags of `bun_core` (`string_is_truthy` in `src/bun_core/env_var.rs`): unset, empty, `0`, `false`, `no` and `off`
  in any ASCII case are off, every other value is on. Only the environment of the process counts: a lint run loads
  no `.env` file. Without the gate `--lint` is refused: stderr names the variable, the exit code is 1, no file is
  read or run. The variable is read with `bun_core::getenv_z` (point 1 of "Open" above says why).
- The branch is in `exec_auto_or_run` (`src/runtime/cli/mod.rs`), directly after the context is made and ahead of
  every run mode: `--parallel` and `--sequential`, `--filter`, the REPL, `--eval`, the `.lockb` case and the run
  itself. It calls `lint_command::exec`, which is `#[cold]`, `#[inline(never)]` and does not return.
- No JavaScriptCore VM is made in a lint run, and no file is run. The full parse links two functions of the C++
  side for constant folding (`JSC__jsToNumber`, `Bun__JSC__operationMathPow`). They need no VM: the arbitration
  saw `bun build --no-bundle --minify-syntax` fold with them while `BUN_JSC_dumpOptions=1` printed nothing.

### Refusals

Each writes one line to stderr and exits with 1, and nothing is read, parsed or run. `G` stands for
`error: --lint is experimental. Set the environment variable BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1 to enable it`.
The last column is what happens with the variable unset: `G`, or the same line, because the refusal is decided
without the gate (it is about where the flag came from, or the command is not the auto command or `bun run`).

| # | command line | stderr | variable unset |
| --- | --- | --- | --- |
| 1 | `bun --lint=value x.ts` | `error: The argument '--lint' does not take a value.` from clap, which also writes the help of the command to stdout | same |
| 2 | `bun --lint -e CODE` (`--eval`) | `error: --lint cannot be used with --eval` | `G` |
| 3 | `bun --lint -p CODE` (`--print`) | `error: --lint cannot be used with --print` | `G` |
| 4 | `bun --lint -` (stdin as the script) | `error: --lint cannot be used with a script from stdin` | `G` |
| 5 | `bun --lint --watch x.ts` | `error: --lint cannot be used with --watch` | `G` |
| 6 | `bun --lint --hot x.ts` | `error: --lint cannot be used with --hot` | `G` |
| 7 | `bun --lint --filter '*' s` | `error: --lint cannot be used with --filter` | `G` |
| 8 | `bun --lint --parallel s` | `error: --lint cannot be used with --parallel` | `G` |
| 9 | `bunx --lint p`, `bun x --lint p`, `bun --lint x p` | `error: --lint cannot be used with bunx` | same |
| 10 | `bun repl --lint` | `error: --lint cannot be used with bun repl` | `G` |
| 11 | `bun build --lint x.ts` | `error: --lint cannot be used with bun build` | same |
| 12 | `bun test --lint` | `error: --lint cannot be used with bun test` | same |
| 13 | `BUN_OPTIONS=--lint bun x.ts` | `error: --lint cannot be set in BUN_OPTIONS` | same |
| 14 | `bun build --compile --compile-exec-argv=--lint x.ts` | `error: --lint cannot be set in --compile-exec-argv`, and nothing is compiled | same |
| 15 | `bun --lint a.ts -b.ts`: a token that starts with `-` after the first operand | `error: --lint cannot be used with "-b.ts" after the first file` | `G` |

- Row 5 is decided while the arguments are parsed: that is before the fork of the Windows watcher in
  `create_context_data`.
- Row 9 is about `--lint` among the flags that `bunx` reads before the name of the package. `bunx pkg --lint`
  hands the flag to the package, as before.
- Row 15 holds for a literal `--` and for `-` too. clap drops one `--` directly after the operand where it stops,
  so `a.ts -- -b.ts` is `a.ts -b.ts`; such a file is written `./-b.ts`. `bun --lint -- -a.ts` checks `-a.ts`.
- Ruled by the arbitration, not in the list of cli.md C1.4, and open for the lead: `--sequential`, `--workspaces`
  and `--interactive` are refused as rows 5 to 8 are (`error: --lint cannot be used with --sequential`), because
  each selects a run mode. A compiled executable that finds `--lint` in `BUN_OPTIONS` or in its baked arguments
  writes `error: --lint cannot be used in a compiled executable`.
- Not covered: `--lint` with any other subcommand (`bun --lint install`, `bun exec --lint CMD`, `init`, `add`,
  `create`, `upgrade`, `pm`, ...). `which()` skips a leading flag, the subcommand runs and drops the flag, as
  before. `BUN_OPTIONS='--lint "v"'` is one unknown token and is dropped.

What the code of the refusals that are in the tree has beyond the table (read at the commit of "State of the
tree"):

- The order for the auto command and for `bun run`. While the arguments are parsed: clap (row 1), then, in
  `accept_lint` of `Arguments.rs`, row 13, `G`, and `--sequential`, `--workspaces` and `--interactive`. Then, in
  `lint_command::exec`: the run without an operand, and row 15. So `bun --lint --sequential` without a file gets
  the line of `--sequential`.
- Row 9 tests every token that starts with `-` up to the name of the package, so `--lint=value` there gets the
  same line (`bunx` does not parse with clap). The token after `--package` or `-p` is a value and is not tested.
- Row 11 holds wherever the flag stands: `bun build x.ts --lint` and `bun --lint build x.ts` are refused too.
  `bun build --lint=value` gets the line of row 1, and the help of `bun build` on stdout.
- Row 13 is checked where a lint run would start, so only when the flag reaches the auto command or `bun run`. It
  holds with a second `--lint` on the command line too.
- Row 14 splits the value at spaces, tabs and line ends and tests every word: `--smol --lint` and `--lint=value`
  are refused.
- A compiled executable tests the options that it parses itself, those built into it and those of `BUN_OPTIONS`,
  and refuses `--lint=value` among them with the same line.

### Unchanged on purpose

cli.md C1.5 wants a test for each of the first three:

- `bun x.ts --lint`: `x.ts` runs and `--lint` is an argument of the script.
- `bun lint`: the script `lint` of `package.json` runs.
- `node --lint y.js`, where `node` is Bun under that name: `y.js` runs and `process.execArgv` is `["--lint"]`, with
  the variable set or not. One thing changes there with the row in `RUN_TABLE`, ruled as accepted and open for the
  lead: `node --lint=value y.js` ran, and then ends in the line of row 1, as `node --watch=1 y.js` does today.
- Also unchanged: `bun run x.ts --lint`, `bunx pkg --lint`, and `./app --lint` for a compiled executable.

These pass with a release of Bun that does not know `--lint`, too: they pin, they do not show the change.

### What a lint run reads

- The operands and nothing else. The arbitration ruled that the argument parser returns before `bunfig.toml` is
  loaded, so `bun --lint` and `bun run --lint` behave alike; `package.json`, `tsconfig.json`, `jsconfig.json` and
  `.env` are read by the run path and by the resolver, which a lint run does not enter.
- What happens before the flag is seen stays: `--cwd` (a relative operand is relative to it), `--help` (the help,
  exit code 0) and, for the auto command, `--version` and `--revision`.
- Every other flag of the auto command and of `bun run` before the first operand is neither read nor validated
  (`--define`, `--loader`, `--tsconfig-override`, `--preload`, `--port`, `--inspect`, `--smol`, ...):
  `bun --lint --port abc x.ts` checks `x.ts`. An unknown long flag there is dropped by clap as everywhere in Bun:
  `bun --lint --fix a.ts` checks `a.ts`. Neither is refused.

### Exit codes

| code | when |
| --- | --- |
| 0 | no diagnostic of the category `error` |
| 2 | one or more: a syntax error, a report of a rule, an operand that is missing, cannot be read or has an unsupported extension, an `internal-error`. It is the code tsc uses |
| 1 | a refusal, or no operand (`error: --lint needs one or more files`): decided before a file is read |

A warning is printed and does not change the exit code.

## Which parse entry a file gets

Until `Parser::parse_for_lint` is in this branch, rules run on JavaScript through `Parser::parse_only`, and
TypeScript files report syntax errors only (cli.md C3.3). The parser unit has that entry on its own branch and this
branch does not ("State of the tree", entry 5 of "Not in the tree").

| operand | loader | parse entry | syntax errors | rules |
| --- | --- | --- | --- | --- |
| `.js`, `.jsx` | `jsx` | `Parser::parse_only` | of the parse pass | all eleven, in one walk |
| `.mjs`, `.cjs` | `js` | `Parser::parse_only` | of the parse pass | all eleven, in one walk |
| `.ts`, `.mts`, `.cts` | `ts` | `Parser::parse` | of the parse pass and of the visit pass | none |
| `.tsx` | `tsx` | `Parser::parse` | of the parse pass and of the visit pass | none |
| `.d.ts`, `.d.mts`, `.d.cts` | | none: the file is read and not parsed | none | none |

- Why two entries. A rule reads the tree as it was written. `Parser::parse_only`
  (`src/js_parser/parse/parse_entry.rs`) hands its closure the statements before the visit pass, nothing folded,
  dropped or bound, and `bun_lint::lint` takes its `ParsedOnly`. It is the parser without TypeScript
  (`P<'a, false, false>`). `Parser::parse` takes TypeScript and runs the visit pass, which rewrites the tree: its
  log is read and its tree is dropped.
- JavaScript: an error that only the visit pass reports is not reported, and such code is linted as it reads. The
  arbitration of C1 found nine inputs that the parse pass alone takes and the full parse rejects (`scanImports`
  against `transformSync` of `Bun.Transpiler`): `1 = 2`, `([]) = 1`, `[...a, b] = c`, `({a:1} = 1)`, `a?.b = 1`,
  `++a++`, `const a = 1; a = 2;`, `function f(){ break; }`, `continue;`.
- TypeScript: `debugger;` in `a.ts` is not reported. The tests of the rules on TypeScript are written when the
  entry exists. The options of that parse are in "Operands" below: a macro call stays a call, nothing is evaluated.
- Declaration files are read and not parsed: one that is missing or cannot be read is reported, a syntax error in
  one is not. cli.md C1.3 lists them among the files that are parsed; `Parser::parse` has no ambient top level
  (difference 1 of "Operands" below). A name `x.d.<ext>.ts` is no declaration file.
- With `parse_for_lint` (parser.md P3.1) every loader goes through that one entry: the rules run on TypeScript,
  a declaration file is parsed as ambient, and its sidecar brings what "Rules and ESLint" waits for: the comments
  and the parentheses.

The tree does this since `7dd3e55437`: `parse` of `src/runtime/cli/lint_command.rs` picks the entry by the loader
("Operands" below). Before that commit every operand went through `Parser::parse` and no rule ran.

## Operands of `bun --lint` (`src/runtime/cli/lint_command.rs`)

Written for C1 (`1af662bf94`), when every operand went through `Parser::parse` and the log of the parser was
printed as Bun prints it. Since then the file sorts the diagnostics and prints them in the two formats
(`c6adc76119`), runs the rules on JavaScript (`7dd3e55437`), logs a stack overflow of that parse (`8b8e569e03`)
and refuses a token that starts with `-` after the first operand (`73933f7aa0`). What follows is the file as it
is at the commit of "State of the tree".

`lint_command::exec(ctx)` takes `ctx.positionals` (without the leading `run` of `bun run`) and then
`ctx.passthrough` as the operands. Before a file is read it refuses two things, each with the exit code 1: a run
without an operand (`error: --lint needs one or more files`), and a token that starts with `-` after the first
operand (row 15 of "Refusals"). Then `check_file` takes each operand in turn: the loader of its extension from
`bun_bundler::options::DEFAULT_LOADERS`, the text of the file (`bun_ast::to_source`; a byte order mark is
converted), the parse and, for JavaScript, the rules. All that is found is a `bun_lint::Diagnostic`. After the
last operand the diagnostics of the run are sorted and deduplicated once and written to stderr. No file is run and
no JavaScriptCore VM is made.

- Extensions: `.js` and `.jsx` (loader `jsx`), `.mjs` and `.cjs` (`js`), `.ts`, `.mts` and `.cts` (`ts`), `.tsx` (`tsx`).
  Any other extension: `File '<operand>' has an unsupported extension. The only supported extensions are ...`
  (the text of TS6054), under the code `unsupported-extension`. The file is not read, and the run continues.
- A file that does not exist: `File '<operand>' not found.` (TS6053). Any other read error:
  `Cannot read file '<operand>': <errno name>.` (TS5012). Both have the code `cannot-read-file`, and the run
  continues. These three diagnostics belong to no file.
- Parse entry (`parse`), by the loader ("Which parse entry a file gets"). `js` and `jsx`: `Parser::parse_only`
  with `bun_lint::lint(file, tree, source, &arena)` as its closure. The rules read the statements as they were
  written, and their reports are added to what the parser logged. `ts` and `tsx`: `Parser::parse`. Its log is read,
  its tree is dropped and no rule runs. A declaration file is read and not parsed (difference 1 below). The
  options of both entries are `ParserOptions::init` plus `no_macros` and `is_macro_runtime` (a macro call stays a
  call, nothing is evaluated), `top_level_await` and `standard_decorators`. The log level is `Warn`: warnings are
  printed too.
- A parse that fails gives the errors of its log and no report of a rule: `Parser::parse_only` calls its closure
  only for a file without a syntax error. It returns a stack overflow without logging it, so that file is parsed
  once more with `Parser::parse`, which logs the overflow at the place the lexer reached. A failure that leaves no
  error in the log becomes one error with the name of the failure as its text, at the start of the file.
- Each message of the log becomes a diagnostic through `Diagnostic::from_msg` ("Public surface of `bun_lint`"):
  its code is `syntax`, or `TS<n>` for a message that carries a number.
- A file in which something was found is kept as a `SourceFile` under its absolute name
  (`tspath::get_normalized_absolute_path` of the operand and of the working directory, which is the one after
  `--cwd`). A file in which nothing was found is dropped after its parse.
- Output (`run`, `write_diagnostics`): `program::sort_and_deduplicate_diagnostics` over the diagnostics of all
  operands, then `code_frame::write_code_frames` when `Output::is_stderr_tty()`, with colour when
  `Output::enable_ansi_colors_stderr()`, and `diagnosticwriter::write_format_diagnostics` when stderr is no
  terminal; both get the working directory, `tspath::USE_CASE_SENSITIVE_FILE_NAMES` and `b"\n"`. What is printed
  is in "What `bun --lint` prints". Without a diagnostic nothing is written.
- Exit code: 2 when a diagnostic of the run has the category `error` (a syntax error, a report of a rule, a file
  that is missing or cannot be read, an unsupported extension, an `internal-error`), else 0, and 1 for the two
  refusals above. A warning does not change the exit code.
- Beside `exec` the file has the refusals that `Arguments.rs` and `mod.rs` call ("Refusals"): `refuse`,
  `refuse_in_bun_options`, `refuse_in_bunx`, `refuse_in_compiled_executable` and `refuse_in_exec_argv`.
- Tests: `test/cli/lint/lint.test.ts`, `describe("bun --lint operands")` and the `describe` of the token after
  the first file; `test/cli/lint/diagnostics.test.ts` for the two formats, the order and the exit codes;
  `test/cli/lint/rules.test.ts` for the rules. None of them has run against a build of this code ("State of the
  tree").

Differences from the specification (cli.md C1.3):

1. Declaration files (`.d.ts`, `.d.mts`, `.d.cts`) are read and NOT parsed; the specification lists them among the
   files that are parsed. `Parser::parse` has no ambient top level: for `export const x: number;` it reports
   `The constant "x" must be initialized`, which is false in a declaration file. A declaration file that is missing
   or cannot be read is still reported. A syntax error in a declaration file is not reported. This ends when the
   parser has an entry that reads a declaration file as ambient. A name `x.d.<ext>.ts` is not taken as a
   declaration file: it is parsed as TypeScript.

## Diagnostic code on `bun_ast::Msg` (`src/ast/lib.rs`)

This section is the interface that the parser unit waits on. parser.md P3.5 asks that a syntax error of a lint
parse carries tsc's code, and `src/ast/lib.rs` is a file of this unit. It is in the tree since 4d9b8e5139. The one
call of the parser is `log.add_range_error_with_code(Some(source), range, 1005,
bun_ast::alloc_print(format_args!("'{}' expected.", ";")), Box::default())`: tsc's number, tsc's text, and no
code in the text. `bun_lint::Diagnostic::from_msg` reads the number with `Msg::code` and the output has `TS1005`.
A message without a number prints with the code `syntax`.

A message of Bun's log can carry the number of a TypeScript diagnostic. It is attached with
`Log::add_range_error_with_code` (no caller outside tests yet: the parser's syntax errors have no code) and read
with `Msg::code` (`Diagnostic::from_msg` of `bun_lint`). This is the whole interface:

- `Metadata::Code(u32)`: the third variant of `bun_ast::Metadata`, beside `Build` and `Resolve(MetadataResolve)`.
  `Code(1005)` is TS1005. It holds a number only; the name of a lint rule stays in the diagnostic of `bun_lint`.
- `Msg::code(&self) -> Option<u32>`: `Some(number)` for `Metadata::Code(number)`, `None` for `Build` and `Resolve`.
- `Log::add_range_error_with_code(&mut self, source: Option<&Source>, r: Range, code: u32,
  text: Cow<'static, [u8]>, notes: Box<[Data]>)`: pushes one `Kind::Err` message with `Metadata::Code(code)` and
  adds 1 to `log.errors`. The location is the one `add_range_error` computes. A range with a negative start is no
  position, whatever its length: `line` and `column` are -1, `offset` and `length` are 0. A formatted text is
  `bun_ast::alloc_print(format_args!(..))`.
- `const _: () = assert!(core::mem::size_of::<Msg>() == 152);` below the enum: the size `Msg` had with two variants.
- Not changed: `Msg::write_format` and `Log::print` print no code. Every other `add_*` method of `Log` makes
  `Build` or `Resolve` as before, so `code()` is `None` for its messages. `Msg::clone` and
  `Log::append_to_with_recycled` keep the variant.
- Tests: `mod msg_code_tests` in `src/ast/lib.rs`, three `#[test]`s (`bun_ast` is in `MIRI_CRATES` of
  `scripts/rust-miri.ts`).

Open: the variant leaves three exhaustive matches on `Metadata` incomplete, in files this unit does not own.
`bun_jsc` and `bun_runtime` do not compile (E0004, `Metadata::Code(_)` not covered; seen in a copy of the
workspace, `c2-seam-arbitration/logs/shadow-neg1.log` and `shadow-neg2.log`) until each has the arm below, which
takes a coded message as a build message. The three edits are `c2-seam-arbitration/final/02-forced-arms.patch`.
They are not applied ("State of the tree", entry 2 of "Not in the tree", which has the check). The request is X2
of `NEEDS.md`, with the decision (left to the integrator: no ruling lets this unit edit the three files) and with
what follows if the arms are refused. Until they are in, this interface is done in `bun_ast` only and the
workspace does not build.

- `src/jsc/VirtualMachine.rs`, the closure `msg_to_js` of `process_fetch_log`:
  `bun_ast::Metadata::Build | bun_ast::Metadata::Code(_) => { BuildMessage::create(global_this, msg) }`
- `src/jsc/lib.rs`, `fn msg_to_js`:
  `bun_ast::Metadata::Build | bun_ast::Metadata::Code(_) => { BuildMessage::create(global, msg.clone()) }`
- `src/runtime/server/DevErrorPage.rs`, `fn write_message`: `Metadata::Build | Metadata::Code(_) => b"",`

Not verified in the worktree when the change was made: nothing was compiled or run there. `src/ast/lib.rs` is the
text of `c2-seam-arbitration/final/01-bun_ast-msg-code.patch` plus one comment line; what was run on that text in a
scratch workspace (check, clippy, rustfmt, the three tests under Miri) is in `c2-seam-arbitration/final/HOWTO.txt`.
The review of the commit reports for the worktree at `7587bce918` (none of it was run again for this text):
`cargo check -p bun_ast`, `cargo clippy -p bun_ast --no-deps --all-targets` and `cargo fmt -p bun_ast -- --check`
exit with 0, `MIRIFLAGS=-Zmiri-tree-borrows cargo miri test -p bun_ast --lib msg_code_tests` has 3 passed, and
`cargo check -p bun_jsc` exits with 101 on E0004 at `src/jsc/VirtualMachine.rs:3611:20` and at
`src/jsc/lib.rs:1378:11`.

## Public surface of `bun_lint` (`src/lint/lib.rs`)

The crate depends on `bun_alloc`, `bun_ast`, `bun_core` and `bun_js_parser`; `bun_runtime` depends on it. The plan
named three modules: `diagnostic`, `diagnosticwriter` and `rules`. The tree has them, and `rules` is private: what
another crate gets of the rules is the function `bun_lint::lint` and the names of the rules as codes.

| public | what | more in |
| --- | --- | --- |
| `lint` | every rule over one parsed file | here |
| `diagnostic` | `FileId`, `SourceFile`, `Category`, `Code`, `MessageChain`, `Diagnostic`; `compare_diagnostics`, `equal_diagnostics`, `equal_diagnostics_no_related_info` | here, and "Order and deduplication" |
| `program` | `sort_and_deduplicate_diagnostics` | "Order and deduplication" |
| `diagnosticwriter` | `FormattingOptions`, `write_format_diagnostics`, `write_format_diagnostic`, `write_flattened_diagnostic_message` | "Plain format of tsc" |
| `code_frame` | `write_code_frames::<const ENABLE_ANSI_COLORS: bool>(output, files, diagnostics, format_opts)`: Bun's code frame with the code in front of the message, for a terminal | `src/lint/code_frame.rs` |
| `scanner` | `compute_ecma_line_starts`, `compute_line_of_position`, `get_ecma_line_and_utf16_character_of_position`, `utf16_len` | "Plain format of tsc" |
| `tspath` | `ComparePathsOptions`, `USE_CASE_SENSITIVE_FILE_NAMES`, `get_normalized_absolute_path`, `convert_to_relative_path`, `combine_paths`, `normalize_slashes`, `get_root_length`, `is_rooted_disk_path` | "Plain format of tsc" |

The crate root exports `Category`, `Code`, `Diagnostic`, `FileId`, `MessageChain` and `SourceFile` again. Private
are `rules`, `rule`, `context`, `linter`, `tokens` and `ast_utils` ("The rule framework").

```rust
/// Every rule over the statements of one file as they were written, in one walk. Not sorted, not deduplicated.
pub fn lint<'a>(
    file: FileId,
    parsed: &bun_js_parser::parse::parse_entry::ParsedOnly<'_, 'a>,
    source: &'a bun_ast::Source,
    arena: &'a bun_alloc::Arena,
) -> Vec<Diagnostic>;

pub struct FileId(pub u32);
impl SourceFile {
    pub fn new(file_name: Box<[u8]>, source: bun_ast::Source) -> SourceFile;
    pub fn file_name(&self) -> &[u8];
    pub fn source(&self) -> &bun_ast::Source;
    pub fn text(&self) -> &[u8];
    pub fn ecma_line_map(&self) -> &[u32];
}
pub enum Category { Warning, Error, Suggestion, Message }
pub enum Code { Ts(u32), Name(&'static str) }
pub struct MessageChain { pub text: Cow<'static, [u8]>, pub next: Vec<MessageChain> }
pub struct Diagnostic {
    pub file: Option<FileId>,
    pub start: u32,
    pub length: u32,
    pub category: Category,
    pub code: Code,
    pub text: Cow<'static, [u8]>,
    pub chain: Vec<MessageChain>,
    pub related: Vec<Diagnostic>,
}
impl Diagnostic {
    pub fn end(&self) -> u64;
    pub fn from_msg(file: FileId, msg: bun_ast::Msg) -> Option<Diagnostic>;
}
```

- `lint` is called inside the closure of `Parser::parse_only`, with the source and the arena of that parse. `file`
  goes on every diagnostic. The result is in the order of the walk; the caller sorts and deduplicates the
  diagnostics of all files once.
- `FileId(n)` is the index of a file in the `&[SourceFile]` of the run, which every function takes beside the
  diagnostics. `SourceFile::new` takes the absolute name with forward slashes
  (`tspath::get_normalized_absolute_path(operand, current_directory)`) and the `Source` that the file was parsed
  from: the text is not copied. The line map is made when it is first asked for.
- `Diagnostic`: `file` is `None` for what belongs to no file. `start` and `length` count bytes of
  `SourceFile::text`. `text` is the message alone, without the code and without the chain. `chain` is printed
  under the text, two more spaces per level. `related` is the related information: the code frame prints each
  entry as a note, the plain format does not print it.
- `Category` has its variants in the order of the reference, which the sort uses. `Category::name()` is the word
  that is printed.
- `Code::Ts(2322)` prints `TS2322` and `Code::Name("no-debugger")` prints the name alone. In the order a name
  counts as the number 0.
- `Diagnostic::from_msg` makes a diagnostic of a message of Bun's log. `Kind::Err`, `Warn` and `Note` become
  `Error`, `Warning` and `Message`; `Debug` and `Verbose` give `None`. The code is `Code::Ts(n)` when `msg.code()`
  is `Some(n)`, else `Code::SYNTAX`. Each note becomes related information (`Message`, `SYNTAX`). A location
  without a line is the start of the file; no location is no file. The text is copied out of the log.
- Every writer reads only `&[SourceFile]` and `&[Diagnostic]`. One more form of output (a report file for the
  conformance runner) is one more writer over the same data.
- For the checker: a diagnostic of `bun_typecheck` becomes a `Diagnostic` with `Code::Ts(n)`, its text, and its
  chain as texts. The arbitration of C2 ruled the direction: `bun_lint` may depend on `bun_typecheck`, never the
  reverse, and the conversion is on this unit's side. No code does it yet.

The codes:

| `Code` | printed | what has it |
| --- | --- | --- |
| `Code::Ts(n)` | `TS<n>` | a diagnostic that typescript-go has under the number n, with its text: the checker, and a syntax error that the parser adds with `Log::add_range_error_with_code`. Nothing makes one yet |
| `Code::Name(<rule>)` | the name of the rule | a report of a lint rule |
| `Code::SYNTAX` | `syntax` | an error or a warning of Bun's parser that has no TypeScript number, and every note of one |
| `Code::CANNOT_READ_FILE` | `cannot-read-file` | an operand that is missing or cannot be read. It belongs to no file |
| `Code::UNSUPPORTED_EXTENSION` | `unsupported-extension` | an operand with another extension. It belongs to no file |
| `Code::INTERNAL_ERROR` | `internal-error` | where the reference panics or asserts, and a walk that gives up: a file that is nested too deeply |
| `Code::INTERNAL_STAND_IN` | `internal-stand-in` | kept for the checker: a part that is not ported was reached. Nothing makes one yet |

The names that are NOT rules are `syntax`, `cannot-read-file`, `unsupported-extension`, `internal-error` and
`internal-stand-in`. The names of the rules are `no-compare-neg-zero`, `no-debugger`, `no-dupe-class-members`,
`no-dupe-keys`, `no-duplicate-case`, `no-empty-pattern`, `no-self-assign`, `no-sparse-arrays`,
`no-unsafe-negation`, `use-isnan` and `valid-typeof`. Every name matches `[A-Za-z@][A-Za-z0-9@/_-]*` and none is
`TS` with digits.

## What `bun --lint` prints: the contract for the conformance unit

For the default check of conformance.md T2.4: spawn `bun --lint <unit files>` with
`BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1` and read stderr. This is cli.md C2.2 with the rulings of its arbitration. A
number in brackets is the point of CH-1 in `units/conformance/needs-and-lint-channel/top-down/NEEDS.draft.md` that
the line answers. The tree has the output side of it in `lint_command.rs` since `c6adc76119`, the flag and the
branch that reach that code since `66bf3e151e`, and the gate since `8358260034`. No build of the branch exists
("State of the tree"), so nothing has printed this yet: `test/cli/lint/diagnostics.test.ts` pins it and has not
run.

1. stdout is empty [1]. The one exception is the refusal of `--lint=value`, where clap writes the help of the
   command to stdout.
2. When stderr is no terminal it holds diagnostics and nothing else [2]: no code frame, no colour, no empty line,
   no summary. Each line ends with LF. A text holds no line break: one inside a message is written as one space.

       <path>(<line>,<column>): <category> <code>: <text>      a diagnostic in a file
       <category> <code>: <text>                                a diagnostic that belongs to no file
       <two spaces per level><text>                             each message of its chain, from level 1, in pre-order

   `<category>` is `error`, `warning`, `suggestion` or `message`. The related information and the length of the
   span are not printed, as tsc does. Nothing in `<path>` is quoted or escaped.
3. The switch is `bun_core::Output::is_stderr_tty()` alone [3]. `FORCE_COLOR` and `NO_COLOR` only decide whether
   the code frame on a terminal has colour (`enable_ansi_colors_stderr`): a pipe gets the plain lines, without
   colour, with `FORCE_COLOR=1` too.
4. `<code>` [4] is `TS` and a number only for a diagnostic that typescript-go has under that number, with its
   text. Every other code is a name of the table above: one of the five names that are not rules, or the name of a
   rule. A syntax error of Bun's parser has no TypeScript number until the parser unit gives it one: it is
   `error syntax: <the text of Bun's parser>`.
5. The exit code [5] is 0 when no diagnostic of the category `error` was printed, 2 when one or more were, and 1
   for a refusal or for no operand. With 1, stderr has a line `error: <text>`: the colon stands directly after
   `error`, so the line is no diagnostic. Any other exit code, and a signal, is a crash.
6. Order and duplicates are those of the reference [7]: `program::sort_and_deduplicate_diagnostics`, the port of
   `SortAndDeduplicateDiagnostics` with `CompareDiagnostics` (the name of the file, the start, the END, the code,
   the category, ...). What belongs to no file comes first. An operand that is given twice is reported once.
7. `<path>` is the operand made absolute and then relative to the current directory: forward slashes on every
   platform, `..` where the file is outside that directory, absolute where it is on another root. `<line>` and
   `<column>` are 1-based and are those of tsc: a line ends after LF, CR LF, CR, U+2028 or U+2029, and the column
   counts UTF-16 code units. The text is the file as it was read: a byte order mark is not part of it.
8. A lint run reads no configuration file [8], as ruled in "The command `bun --lint`": no `bunfig.toml`,
   `tsconfig.json`, `jsconfig.json`, `package.json` or `.env`, in the current directory or above it.
9. A check that was not complete never looks clean [9]: `error internal-error: <text>` has the category `error`,
   so the exit code is 2. `internal-stand-in` is kept for the stand-in log of the checker.

On a terminal, which a runner with pipes never has: `code_frame::write_code_frames` writes one frame of Bun's log
format (`Msg::write_format`) for each diagnostic, in the same order. The message has `<code>: ` in front of it and
its chain under it, each entry of the related information is a note, and the file has the `<path>` of the plain
format. The word is `error` for an error, `warn` for a warning and `note` for a suggestion or a message. An empty
line stands between two frames. Line and column of a frame are those of Bun's log: they are not tsc's at the end
of a file and after a lone CR. The frame that `test/cli/lint/diagnostics.test.ts` expects for `let x = ;`:

    1 | let x = ;
                ^
    error: syntax: Unexpected ;
        at b.js:1:9

Not delivered:

- [6] The operands are not the roots of one program. Each is read and parsed by itself, no import is followed and
  no library file is loaded. That is the program layer.
- CH-2 and CH-3 of that draft, the report file (`BUN_INTERNAL_LINT_REPORT`) and the options
  (`BUN_INTERNAL_LINT_OPTIONS`): no code reads either variable. A report is one more writer over
  `&[SourceFile]` and `&[Diagnostic]`, which hold the length of the span and the related information that the
  plain format drops.
- A TypeScript number: the syntax errors of the parser are `syntax`, and no checker runs.

The bytes of a baseline. `diagnosticwriter::write_format_diagnostics` is the port of the function that writes the
first section of an `.errors.txt` of the reference. With the options of its harness
(`internal/testutil/tsbaseline/error_baseline.go:24-28`), which are
`FormattingOptions { compare_paths_options: ComparePathsOptions { use_case_sensitive_file_names: false,
current_directory: b"" }, new_line: b"\r\n" }`, it writes those bytes. `bun --lint` calls it with the current
directory of the process, `tspath::USE_CASE_SENSITIVE_FILE_NAMES` and `b"\n"`. How the writer differs from the
reference is in "Plain format of tsc": the code is written as `Code` prints it, and a line break inside a text
becomes a space. The rest of a baseline (the sources with their squiggles, the pretty form, the summary) is not
ported.

## Order and deduplication (`src/lint/diagnostic.rs`, `src/lint/program.rs`)

Port of typescript-go 89d5d5b, under the names of the reference in snake_case and in its order. In `diagnostic.rs`:
the comparison and equality functions of `internal/ast/diagnostic.go` (`getDiagnosticPath`, `EqualDiagnostics`,
`EqualDiagnosticsNoRelatedInfo`, `getDiagnosticMessageIdentity`, `equalMessageChain`, `compareMessageChainSize`,
`compareMessageChainContent`, `compareRelatedInfo`, `CompareDiagnostics`). In `program.rs`:
`SortAndDeduplicateDiagnostics` and `compactAndMergeRelatedInfos` of `internal/compiler/program.go` (1597-1635).

- `program::sort_and_deduplicate_diagnostics(files: &[SourceFile], diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic>`
  sorts with `compare_diagnostics` and keeps the first of each run of diagnostics that
  `equal_diagnostics_no_related_info` takes as one. The first of a run of two or more gets the related information
  of all of them, sorted with `compare_diagnostics`, each entry once (`equal_diagnostics`). A diagnostic without a
  duplicate keeps its related information as it was reported. Fewer than two diagnostics are returned as they are.
- `diagnostic::compare_diagnostics(files, d1, d2) -> Ordering` compares, in this order: the name of the file as
  bytes (`SourceFile::file_name`; empty without a file, so those come first), the start, the end, the number of the
  code, the category (warning, error, suggestion, message), the name of the code, the text, the chain (more messages
  first, then their texts), the related information (more entries first, then each pair of entries).
- `diagnostic::equal_diagnostics(files, d1, d2)` and `equal_diagnostics_no_related_info(files, d1, d2)` compare the
  same fields. Two diagnostics that `compare_diagnostics` finds equal are equal for `equal_diagnostics`.
- `src/runtime/cli/lint_command.rs` calls `sort_and_deduplicate_diagnostics` once, over the diagnostics of all
  operands, since `c6adc76119` ("Operands"). It did not when the rest of this section was written.

Differences from the reference:

1. A diagnostic holds its text, not a message key and arguments: `get_diagnostic_message_identity` is the text, and
   the comparison of `MessageArgs()` has no counterpart. For a diagnostic that the reference makes with
   `NewExternalDiagnostic` (a text and no arguments: a lint rule, a syntax error of Bun) nothing differs. For two
   diagnostics of one TypeScript number at one span the reference compares the arguments one by one and this
   compares the whole texts, which can give the other order where an argument is the start of the other one:
   `Type '{0}' is not assignable to type '{1}'.` with `A` and with `A & B` is `A` first in the reference and
   `A & B` first here (a space sorts before `'`). No diagnostic has a TypeScript number yet
   (`Log::add_range_error_with_code` has no caller outside tests).
2. A chain message is its text: `equal_message_chain` compares it where the reference compares the code and the
   arguments, and `compare_message_chain_content` compares it where the reference compares the arguments alone.
3. A code that is a name (`Code::Name`) is `Code()` 0 and `Source()` the name, as the external diagnostic of the
   reference; a TypeScript number has an empty `Source()`.
4. A stack where the reference calls itself (the three chain functions, and the related information in
   `equal_diagnostics` and `compare_related_info`): the same pairs in the same order, at any depth.
   `compare_diagnostics_no_related_info` is `CompareDiagnostics` up to the related information, which the stack of
   `compare_related_info` needs on its own; the reference has no function of that name. The three chain functions
   take the two lists where `equalMessageChain` takes two entries.
5. The test `d1 == d2` for one object at the start of four functions of the reference is not ported: each function
   returns the same without it.
6. `sort_and_deduplicate_diagnostics` takes the vector by value where the reference copies the slice. Its sort is
   stable where `slices.SortFunc` promises no order for equal elements: here those are equal in every field and
   become one diagnostic, so the output does not depend on it.

Tests: `mod tests` of `program.rs` (two `#[test]`s) and of `diagnostic.rs` (one). `bun_lint` is not in
`MIRI_CRATES`, so CI does not run them. `sh c2-sort-dedupe-probe/run.sh <scratch directory>` (no build of Bun, no
cargo, about half a minute) runs rustfmt, the check for runs of comment lines, the three unit tests against a
stand-in of `bun_ast`, clippy-driver with the lint levels of the workspace (library and tests), and then the two
files against the
functions of the reference themselves, cut out of the checkout by line number and run with Go 1.24: 20,000 random
cases with near-duplicates, nested chains and nested related information; for each pair of diagnostics of a case
the sign of `compare_diagnostics` in both directions, `equal_diagnostics` and `equal_diagnostics_no_related_info`
(188,326 pairs), then the sorted and deduplicated list (60,342 diagnostics): identical. Six more seeds of 30,000
cases (1,673,901 pairs, 540,175 diagnostics): identical. Four faults put in on purpose each change the output: the
related information of every diagnostic sorted, the size of a chain compared the other way round, the children of a
chain message taken in the other order, related entries compared without their own related information.
Also run once: rustc and clippy-driver with the flags of the build's own call for `bun_lint` and the `bun_core` and
`bun_ast` of the build tree, on `diagnostic.rs` (its call of `Msg::code` replaced: the `bun_ast` of the build tree
is older), `program.rs` and `scanner.rs`: clean.

Not verified: the build of the worktree and the `bun:test` files were not run for this change.

## Plain format of tsc (`src/lint/diagnosticwriter.rs`, `scanner.rs`, `tspath.rs`)

Port of typescript-go 89d5d5b: the plain writer of `internal/diagnosticwriter/diagnosticwriter.go`
(`WriteFormatDiagnostics`, `WriteFormatDiagnostic`, `WriteFlattenedDiagnosticMessage`, `flattenDiagnosticMessageChain`),
the line map (`ComputeECMALineStarts` and `UTF16Len` of `internal/core/core.go`, `ComputeLineOfPosition` and
`GetECMALineAndUTF16CharacterOfPosition` of `internal/scanner/scanner.go`) and the names of files
(`internal/tspath/path.go`: `ConvertToRelativePath` and `GetNormalizedAbsolutePath` with everything they call, URL
and untitled roots included; `EquateStringCaseInsensitive` of `internal/stringutil/compare.go`).

- `diagnosticwriter::write_format_diagnostics(output: &mut Vec<u8>, files: &[SourceFile], diagnostics: &[Diagnostic],
  format_opts: &FormattingOptions)` writes `path(line,column): category code: text`, then each message of the chain
  on its own line with two more spaces per level, then `new_line`. A diagnostic without a file has no
  `path(line,column): `. Line and column are 1-based, the column counts UTF-16 code units. It does not sort.
  `write_format_diagnostic` writes one; `write_flattened_diagnostic_message(output, text, chain, new_line)` writes
  the text and the chain alone (the code frame uses it).
- `FormattingOptions { compare_paths_options: ComparePathsOptions { use_case_sensitive_file_names,
  current_directory }, new_line }`. The command line of the reference (`getFormatOptsOfSys`): the current directory
  of the process, `tspath::USE_CASE_SENSITIVE_FILE_NAMES`, `b"\n"`. The baselines of the reference
  (`error_baseline.go:26`): `current_directory: b""`, `use_case_sensitive_file_names: false`, `new_line: b"\r\n"`.
- `SourceFile::file_name` is expected to be `tspath::get_normalized_absolute_path(operand, current_directory)`.
  `tspath::convert_to_relative_path(name, options)` is the name that is printed.
- `scanner::compute_ecma_line_starts(text) -> Vec<u32>`, `compute_line_of_position(line_starts, pos) -> usize`,
  `get_ecma_line_and_utf16_character_of_position(text, line_starts, pos) -> (usize, usize)` (both 0-based),
  `utf16_len(bytes) -> usize`. A line ends after LF, CR, CR LF, U+2028 or U+2029. A byte that is not part of valid
  UTF-8 is one character, as Go decodes it.

Differences from the reference:

1. A line break inside the text of a diagnostic or of a chain message (CR LF, CR or LF) is written as one space;
   the reference writes the text as it is. A diagnostic and each chain message stay one line (cli.md C2.2). In the
   first section of the 7,013 plain baselines of the reference every line is the head of a diagnostic or an indented
   chain line, and no message of `diagnosticMessages.json` has a line break.
2. The code is what `Code` of `diagnostic.rs` displays: `TS2322`, or the name of a rule alone. The reference writes
   `Source()` or `TS` and then the number for every diagnostic.
3. A position behind the end of the text is taken as the end of the text, where the reference panics.
4. `flatten_diagnostic_message_chain` keeps a stack where the reference calls itself: the same bytes, and no limit
   on the depth of a chain.
5. `tspath::USE_CASE_SENSITIVE_FILE_NAMES` is a constant of the platform (false on Windows and macOS); the reference
   asks the file system. `FormattingOptions` has no locale.
6. Case is folded with the simple case folding of Unicode 15.0.0 (the table `SIMPLE_FOLD`, made from the `unicode`
   package of Go): what `strings.EqualFold` does in Go 1.24 to 1.26; the reference requires Go 1.26. A reference built
   with a later Go folds the letters of later Unicode editions too.
7. Not ported: the format with colour and context, `WriteLocation`, the error summary, the status lines.

Against `c2-seam-arbitration/final/03-bun_lint-diagnostics.patch`: the same public names and signatures, except
`tspath::combine_paths(first_path, paths: &[&[u8]])`. The draft's own path code (no URL or untitled root, ASCII-only
folding, normalization by components) is replaced by the functions of the reference.

Tests: seven `#[test]`s in the three files; every expected value is the output of the reference functions run with
Go. `bun_lint` is not in `MIRI_CRATES`, so CI does not run them. `sh c2-2-plain-writer/run.sh <scratch directory>`
(no build of Bun, no cargo) compares the three modules with the reference functions themselves: 253,502 vectors
(roots, absolute names, printed names, folding, line maps, UTF-16 lengths, whole outputs with chains), the fold key
of every code point, the table, the unit tests, rustfmt, and clippy-driver with the lint levels of the workspace.

Not verified: the build of the worktree and the `bun:test` files were not run for this change.
`src/runtime/cli/lint_command.rs` did not call the writer when this was written.

## The rule framework, and where a configuration file and suppression comments will attach

`src/lint/rule.rs`, `context.rs`, `linter.rs`, `tokens.rs`, `ast_utils.rs` and `rules/`. All of it is private to
`bun_lint`: the way in is `bun_lint::lint`.

- A rule is a module `rules/<name>.rs`, named as ESLint names the file of the rule, with `_` for `-`. It has a
  private `static RULE: Rule` and handler functions that are `pub(crate)`. There is no trait, no registry and no
  macro: the walk names each handler.
- `Rule { name: &'static str, category: RuleCategory }`. `name` is ESLint's name of the rule when ESLint has the
  rule, and it is the code of the diagnostics of the rule (`Code::Name(rule.name)`). `RuleCategory` has one
  variant, `Correctness`: code that is wrong or does nothing. The default level comes from the category:
  `Rule::default_level(&self) -> Option<Category>` is `Some(Category::Error)` for `Correctness`, and `None` would
  be a rule that is off. So the eleven rules are on, as errors.
- One walk of a file. `linter::run(context, stmts)` makes one `Linter`, which implements `bun_ast::walk::Visitor`
  (`src/ast/walk.rs`) over the statements of `Parser::parse_only`: the tree as written, before the visit pass. A
  `visit_*` method calls the handlers of every rule that reads that node, and walks on.
- A handler gets `&mut Context`, the node and, where it needs it, the `Loc` of the node. It reports with
  `Context::report(rule, at: Loc, text)`: a diagnostic of that rule in the file of the run, at the token that
  starts at `at`. A rule gives a place and never a length: the length is that of the token, read from the text.
- `Context::report_if_global(rule, at, text, names)` is a report that holds only where a name is the global one
  (`Globals::NAN`, `NUMBER`, `UNDEFINED`). The walk calls `Context::declare` for every binding, for the name of
  every function and class, and for every import that is in the tree; `Context::finish` drops a held report when
  the file declares every name that it depends on. The tree as written has no scopes, and it has no statement
  for a macro import or for an import from `bun:bundle`: their names are not declared ("Rules and ESLint",
  difference 10).
- Depth. `visit_stmt`, `visit_expr` and `visit_binding` ask `bun_core::StackCheck` before they go one level
  deeper. A node that is too deep is not entered, the walk goes on beside it, and the file gets ONE diagnostic,
  `error internal-error: This file is nested too deeply to check all of it.`, at the first such node, with the
  length 0.
- Assignment targets. Bun's tree writes the pattern on the left of an assignment as the array or object literal
  that it looks like. The walk marks such a node before it reaches it (the left of `=`, the items and the property
  values of a marked literal, the head of a `for`-`in` and of a `for`-`of`, the `=` of a default), and
  `visit_e_array`, `visit_e_object` and `visit_e_binary` take the mark. A marked literal is a pattern for
  `no-empty-pattern` and no literal for `no-sparse-arrays` and `no-dupe-keys`; a marked `=` is no assignment for
  `no-self-assign`.
- Reading the text again. The tree has no end of a node, no parentheses and no place of a `case` clause. The
  services of `Context` (`closes`, `binary_start`, `start_of`, `case_test`, `case_start`, `close_bracket`,
  `token_end`) run Bun's own lexer from an offset of the tree (`tokens.rs`); a regular expression and a JSX
  element are one token each, taken from the tree. They use `ParsedOnly::stmts` and `ParsedOnly::name_of`, and of
  `bun_js_parser::lexer::Lexer` the seven items `init_without_reading`, `current`, `step`, `next`, `loc`, `end`
  and `token`, which have to stay public.
- Tests. `test/cli/lint/rules.test.ts` has one test for each file `test/cli/lint/rules/<rule>.json`: one run of
  `bun --lint` over one file per case, and the lines of that rule compared with the `expect` of each case. A new
  rule is a module, its calls in `linter.rs`, and a file of cases.

### Where they will attach

No configuration file exists and no suppression comment exists (cli.md C3.1: not yet). The places:

1. The level of a rule is read in one place. `Context::report_if_global`, which `Context::report` calls, asks
   `rule.default_level()`. A configuration is a table from the name of a rule to its level (off, warning, error).
   `bun_lint::lint` takes it as one more parameter, `Context` keeps it, and `report_if_global` asks it before the
   default. `None` is "off: no diagnostic" already. The `Linter` can ask the same table so as to skip the handler
   of a rule that is off. An option of a rule (`enforceForIndexOf` of ESLint and the like) is read by its handler
   through `Context` in the same way; today each handler has ESLint's default written into it.
2. The file is read in `src/runtime/cli/lint_command.rs`, in `exec`, before the first operand is read. A lint run
   reads no configuration there today ("The command `bun --lint`"). What was read is handed to every call of
   `bun_lint::lint`. `tsconfig.json` and the discovery of a project are the program layer, not this.
3. Suppression comments attach in `Context::finish`. Every report of a rule in a file passes through it before
   `lint` returns. It needs the comments of the file with their ranges, and the tree does not have them: the
   sidecar of `Parser::parse_for_lint` records every comment with its range and kind (parser.md P3.3). `Context`
   then takes that list and `finish` drops the reports that a comment covers. The `internal-error` of a walk that
   was cut is in the same list and is not to be dropped. A syntax error and a diagnostic of the checker never pass
   through `Context`: a comment does not suppress them there.

## Rules and ESLint: every deliberate difference

Each rule is a port of the file of its name in `lib/rules/` of eslint/eslint 4618052e, with ESLint's default
options and ESLint's message texts. `ast_utils.rs` is what the rules use of `lib/rules/utils/ast-utils.js`. This
section lists every place that is known where the answer is not ESLint's. A section "Rule ..." further down says
the same for one rule, with more cases.

How the differences were found. The research of C3 ran its text of the rules
(`c3-rule-support-unification/final/src-lint/`) on trees of `Parser::parse_only` and compared every report with
ESLint at the pin (`HOWTO.txt` in `final/`, on the debug build of e3566be889). The rule modules in the tree come
from that text: `no_self_assign.rs` and `use_isnan.rs` with other comments, `no_dupe_keys.rs` and
`no_dupe_class_members.rs` written again in part. The numbers of this section are those of the research and were
not measured again on the tree; the cases of the research that both parsers take are in the fixtures of the tree,
so `test/cli/lint/rules.test.ts` holds each module to the same answers once a build runs it:

- 2719 cases (`final/vectors/<rule>.json`, and the result in `final/DIFFERENCES.txt`): 2638 with ESLint's answer,
  21 at another place, 2 at another place with another text, 16 where ESLint reports and Bun does not or reports
  less, 20 that both parsers reject, 21 that only ESLint's parser rejects, 1 that only Bun's rejects. Among them
  is no case where Bun reports and ESLint, having parsed the code, does not. None of them has a macro import or
  an import from `bun:bundle`: behind one of those Bun does (difference 10).
- 16,159 real files (`node_modules`, and the tests of ESLint, of Node and of Bun): 445 reports, the same from both
  in every file that ESLint's parser takes (it rejects 92).
- In the tree, every case of `test/cli/lint/rules/<rule>.json` whose answer is not ESLint's has `differs`
  (`moved`, `other-text`, `missing`, or `extra` where Bun reports and ESLint does not) and ESLint's answer in
  `eslint`. A case that one of the parsers rejects is in the vectors only.

### The eleven rules

All are on as errors (`RuleCategory::Correctness`). "Called from" is the method of the walk in `linter.rs`.

| rule | options of ESLint, at their defaults | called from | reported at | message |
| --- | --- | --- | --- | --- |
| `no-debugger` | none | `visit_s_debugger` | the `debugger` | `Unexpected 'debugger' statement.` |
| `no-dupe-keys` | none | `visit_e_object`, for a literal that is no pattern | the key of the later property | `Duplicate key '<name>'.` |
| `no-dupe-class-members` | none | `visit_s_class`, `visit_e_class` | the key of the later member | `Duplicate name '<name>'.` |
| `no-duplicate-case` | none | `visit_s_switch` | the `case` of the later clause | `Duplicate case label.` |
| `no-empty-pattern` | `allowObjectPatternsAsParameters: false` | `visit_b_array`, `visit_b_object`; `visit_e_array`, `visit_e_object` for an assignment target | the `[` or the `{` | `Unexpected empty array pattern.`, `Unexpected empty object pattern.` |
| `no-compare-neg-zero` | none | `visit_e_binary` | the start of the comparison | `Do not use the '<operator>' operator to compare against -0.` |
| `use-isnan` | `enforceForSwitchCase: true`, `enforceForIndexOf: false` | `visit_e_binary`, `visit_s_switch` | the start of the comparison, the `switch`, the `case` | the three of "Rule `use-isnan`" |
| `valid-typeof` | `requireStringLiterals: false` | `visit_e_binary` | the value that the `typeof` is compared with | `Invalid typeof comparison value.` |
| `no-unsafe-negation` | `enforceForOrderingRelations: false` | `visit_e_binary` | the `!` | `Unexpected negating the left operand of '<operator>' operator.` |
| `no-sparse-arrays` | none | `visit_e_array`, for a literal that is no pattern | the comma of each hole | `Unexpected comma in middle of array.` |
| `no-self-assign` | `props: true` | `visit_e_binary`, not for the `=` of a default | the node on the right side | `'<name>' is assigned to itself.` |

### Differences that hold for every rule

1. On without a configuration, and not configurable. ESLint turns no rule on by itself; the eleven are `"error"`
   in its recommended configuration (`packages/js/src/configs/eslint-recommended.js`). Here each is on as an error,
   none can be turned off, and every option keeps ESLint's default (the table above). What a non-default option
   adds is not ported (`indexOf(NaN)` of `use-isnan`, the ordering operators of `no-unsafe-negation`, the message
   `Typeof comparisons should be to string literals.` of `valid-typeof`).
2. No comment configures a run. `/* eslint ... */`, `/* eslint-disable */`, `/* eslint-enable */`,
   `// eslint-disable-line`, `// eslint-disable-next-line`, `/* global ... */` and `/* globals ... */` have no
   effect, so Bun reports where such a comment silences ESLint.
3. No suggestion and no fix. ESLint attaches suggestions to the reports of `no-compare-neg-zero`, `use-isnan`,
   `valid-typeof` and `no-unsafe-negation`; a diagnostic here is the message of the report alone.
4. JavaScript only: `.js`, `.jsx`, `.mjs`, `.cjs` ("Which parse entry a file gets"). No rule runs on a TypeScript
   file; `no-dupe-class-members` of ESLint handles TypeScript too.
5. The span of a diagnostic is the first token at its place, where ESLint's report spans a node or a `loc`. For a
   regular expression that token is its `/` (the length is read without the tree, which alone knows that a regular
   expression starts there). No format prints a length; it is part of the order and of equality, which gives
   difference 6.
6. Equal reports print once. Two reports of one rule with one start and one text are one diagnostic after
   `sort_and_deduplicate_diagnostics`; ESLint prints both. Six of the 2719 cases: `x === NaN === NaN`,
   `x == NaN != NaN` and `NaN == NaN == NaN` (`use-isnan`: ESLint reports the inner and the outer comparison, both
   at 1:1, with different ends), and `({a, a} = {a})`, `({a, 'a': a} = {a})` and `({a: b.c, a: b.c} = {a: b.c})`
   (`no-self-assign`: ESLint reports the same node twice).
7. The order at one place. Diagnostics are in the order of "Order and deduplication": the file, the start, the
   end, then for two rules the name of the rule, then the text. ESLint orders the reports of a file by line and
   column and keeps, at one place, the order in which the rules reported. So two rules that report at one start
   print in the order of their names: `NaN === -0` has `no-compare-neg-zero` before `use-isnan` (ESLint at the pin,
   with the eleven rules configured in the order of cli.md, has that order for this input too).
8. A line break in a message. A key with a line break gives ESLint the message with that line break
   (`Duplicate key 'a<LF>b'.`, three cases of `no-dupe-keys`). Both formats write a line break in a text as one
   space ("Plain format of tsc", difference 1).
9. A file that is nested too deeply for the stack gets `internal-error` ("The rule framework") and the reports of
   the rules for what the walk did not enter are missing. The reports that wait for the end of the walk
   (difference 10) are all dropped in such a file. A rule that recurses by itself can be stopped by the stack
   where the walk is not: `no-self-assign`, which then gives the file the same `internal-error` at two of its
   three places and is silent at the third (section "Rule `no-self-assign`", difference 5). ESLint has no such
   diagnostic.

### Differences of some rules

10. Scopes: `use-isnan` (`NaN`, `Number`) and `valid-typeof` (`undefined`). ESLint reports only where the name is
    a reference to the global variable. The tree as written has no scopes: a declaration of the name anywhere in
    the file, in any scope, drops every report that depends on that name (one that depends on two names,
    `NaN == Number.NaN`, when both are declared). So Bun misses reports where the declaration is not in scope at
    the place (6 cases of each rule). It adds a report where the only declaration of the name is an import that
    the parse pass drops. A macro import (`with { type: "macro" }`, or a specifier that starts with `macro:`) and
    an import from `bun:bundle` leave no statement in the tree, so the walk declares none of their names and the
    name is taken for the global: `x === NaN` after `import { NaN } from "./macros.js" with { type: "macro" }` is
    reported, and so is `typeof x === undefined` after the same import of `undefined`. ESLint says nothing for
    either (section "Rule `use-isnan`", difference 7, with the cases of its fixture). A missed report ends when a
    lint run knows the scopes of the file, an added one when the names of the dropped imports reach the walk.
11. Two look-backs: `no-compare-neg-zero`, `use-isnan`, `no-self-assign` (the `(` before a first operand) and
    `no-duplicate-case`, `use-isnan` (the `case` before a test). ESLint's node starts at the `(` of its first
    operand and its clause starts at `case`. The tree has neither place. How many `)` close a `(` that stands
    before the operand is counted from the tokens and is exact (`Context::closes`); the `(` and the `case`
    themselves are looked for backwards over spaces and tabs only (`tokens::before_opens`, `tokens::case_before`).
    After a comment, a line break or another blank the report is at the first token of the operand or of the test
    (21 cases at another place; for `no-self-assign` the text changes too where a comment is part of ESLint's
    name, 2 cases). It ends with the comments of the sidecar; for a `case` also when the parser fills `Case::loc`.
12. A name with an unpaired surrogate: `no-dupe-keys`, `no-dupe-class-members`, `no-self-assign`. Such a string has
    no static name (`ast_utils::get_static_string_value`) and is equal to no other: `({"\ud800": 1, "\ud800": 2})`
    is not reported. ESLint reports it (2 cases of `no-dupe-keys`, 2 of `no-self-assign`; none of the 2719 is of
    `no-dupe-class-members`, whose three cases were added later: section "Rule `no-dupe-class-members`",
    difference 1).
13. JSX in the test of a `case`: `no-duplicate-case`. ESLint compares the tokens of two tests. A JSX element is one
    token for the scanner and is compared as its text, so `<a/>` and `<a />` are two tests here and one for ESLint
    (2 cases).
14. The two parsers: every rule, seen in `no-dupe-keys`, `no-dupe-class-members`, `no-duplicate-case` and
    `no-self-assign`. A lint run of JavaScript makes the parse pass only. Code that ESLint's parser rejects and
    Bun's parse pass takes is linted as it reads (21 cases): a second `__proto__: value` in an object literal, a
    left side that is no assignment target (`({a, a} += obj)`, `({a: 1, a: 2} = obj)`, `({a, a}) = obj`), a
    parameter name twice in an arrow function, two constructors in a class, `new.target` outside a function, an
    optional chain on the left of `=`. The other way round (1 case): `switch (a) { case await: case await: }` as a
    script is reported by ESLint (1:26) and is a syntax error for Bun (the research parsed every file with
    top-level `await` on, as a lint run does). A syntax error is Bun's own, with Bun's text and the code `syntax`;
    it is not ESLint's `Parsing error: ...`.
15. A long BigInt as a name: `no-dupe-keys`, `no-dupe-class-members`, `no-self-assign`. A BigInt that is written
    with `0x`, `0o` or `0b` and has more than 4096 digits has no static name (`ast_utils::get_static_string_value`:
    `of_big_int` gives none, because the conversion to decimal digits is quadratic). As a key it is equal to no
    other: with 4097 `f` in each key, `({ 0xf...fn: 1, 0xf...fn: 2 })`, `class A { 0xf...fn() {} 0xf...fn() {} }`
    and `({ 0xf...fn: a } = { 0xf...fn: a })` are not reported, and ESLint reports them at 1:4109, 1:4117 and
    1:8216. As the index of a member it is compared by its text and not by its value
    (`ast_utils::equal_literal_value`): with the same 4097 digits, `a[0xf...fn] = a[0xf...fn]` is reported as
    ESLint reports it, and `a[0xF...Fn] = a[0xf...fn]`, two spellings of one value, is not (ESLint: 1:4107). With
    4096 digits, and for a decimal BigInt of 5000 digits, the answer is ESLint's. Not among the 2719 cases and in
    no fixture: it was seen later, with ESLint at the pin and the probe of the research, whose helper has the
    same limit, and no build of the tree has run it (sections "Rule `no-self-assign`", difference 6, "Rule
    `no-dupe-keys`", difference 2, and "Rule `no-dupe-class-members`", difference 5).

### Rule by rule

The numbers are those of the 2719 cases. "The same" is ESLint's answer: place and text.

- `no-debugger`: 70 cases, 70 the same. No difference is known.
- `no-sparse-arrays`: 142 cases, 141 the same, 1 that both parsers reject. No difference is known.
- `no-empty-pattern`: 183 cases, 183 the same. No difference is known.
- `no-unsafe-negation`: 102 cases, 102 the same. No difference is known. cli.md C3.2 lets a rule that needs to know
  about parentheses wait for the sidecar, and this rule must not report `(!a) in b`. It does not wait: the tokens
  between the `!` and the right operand say whether a `)` there closes a `(` from before the `!`
  (`Context::closes`), and only a `!` that no parenthesis closes is reported. Where that text does not read as the
  tree says, nothing is reported.
- `no-dupe-class-members`: 295 cases, 284 the same, 8 that both parsers reject, 3 that only ESLint's rejects: two
  constructors in one class (`class A { constructor() {} 'constructor'() {} }`), for which Bun reports nothing
  because the rule, as in ESLint, does not count a constructor. Differences 12, 14 and 15; none of the 295 cases
  has the long BigInt of difference 15. Section "Rule `no-dupe-class-members`", which has the cases that were
  added later, the auto-accessor, the long BigInt, and what a lint run says of two constructors (nothing: Bun's
  parser takes them).
- `no-dupe-keys`: 468 cases, 450 the same, 1 that both parsers reject, 2 missing (difference 12), 15 that only
  ESLint's parser rejects (difference 14). Of those 15 Bun reports in two:
  `var x = { __proto__: 1, '__proto__': 2, a: 1, a: 2 };` has `1:47 Duplicate key 'a'.` (`__proto__: value` is no
  key, as in ESLint) and `({a, a} += obj);` has `1:6 Duplicate key 'a'.` (the left of `+=` is a literal for the
  walk). Difference 8. Difference 15, which none of the 468 cases has. Section "Rule `no-dupe-keys`", which has
  the long BigInt of difference 15 and the cases that were added later.
- `no-duplicate-case`: 354 cases, 329 the same, 4 that both parsers reject, 17 at another place (difference 11),
  2 missing (difference 13), 1 that only Bun's parser rejects and 1 that only ESLint's rejects (difference 14:
  `switch (a) { case new.target: break; case new.target: break; }` outside a function has
  `1:38 Duplicate case label.`). Examples of difference 11: `switch (a) { case a: break; case\na: break; }` is
  1:29 for ESLint and 2:1 for Bun; `switch (a) { case a: break; case/**/a: break; }` is 1:29 and 1:37. Like
  `no-unsafe-negation` this rule does not wait for the sidecar: what ESLint compares of a test is read from the
  tokens of its text (`Context::case_test`).
- `no-compare-neg-zero`: 86 cases, 85 the same, 1 at another place (difference 11): `(/* c */ x) === -0` is 1:1
  for ESLint and 1:10 for Bun.
- `use-isnan`: 316 cases, 307 the same, 1 that both parsers reject, 6 missing (difference 10), 2 at another place
  (difference 11), and 3 of difference 6. Section "Rule `use-isnan`", which has the cases that were added later:
  among them the ten behind an import that the parse pass drops, where Bun reports and ESLint does not
  (difference 10).
- `valid-typeof`: 202 cases, 195 the same, 1 that both parsers reject, 6 missing (difference 10). ESLint reports
  `Invalid typeof comparison value.` at the `undefined` of each and Bun reports nothing:
  `function f(undefined) {} typeof x === undefined` (1:39), `{ let undefined = 1; } typeof x === undefined` (1:37),
  `function f() { var undefined; } typeof x === undefined` (1:46),
  `try {} catch (undefined) {} typeof x === undefined` (1:42),
  `(function undefined() {}); typeof x === undefined` (1:41) and
  `function f(a = typeof x === undefined) { var undefined; }` (1:29). Section "Rule `valid-typeof`", which has the
  22 cases of difference 10 that were added later, and what comments, the two parsers and a file that is too deep
  change for this rule.
- `no-self-assign`: 501 cases, 492 the same, 4 that both parsers reject, 1 at another place and 2 with another
  text (difference 11), 2 that only ESLint's parser rejects (difference 14), and 3 of difference 6. Difference 15,
  which none of the 501 cases has. Section "Rule `no-self-assign`", which has the cases of difference 12 that
  were added later and the long BigInt of difference 15.

### Attribution

A rule module starts with one line that names its source (`//! Ported from ESLint lib/rules/no-self-assign.js, ...`).
The cases of ESLint's own tests are copied as data and have `eslintTest` in the fixtures. The rulings of C3 put a
second line, `eslint/eslint 4618052eed6bb3ef420cf0db0490bbda2fd835a5`, into `src/lint/UPSTREAM_PORTED` and
ESLint's licence text (MIT, `c3-rule-support-unification/final/LICENSE.eslint`) into `src/lint/LICENSE.eslint`;
"State of the tree" says that the tree has neither yet, and point 4 of its "Open" has the line for `LICENSE.md`.

## Rule `no-self-assign` (`src/lint/rules/no_self_assign.rs`)

Port of ESLint `lib/rules/no-self-assign.js` at eslint/eslint 4618052e, with its default option `props: true`.
On by default as an error. Message: `'{{name}}' is assigned to itself.` at the node on the right side; `name` is
the source text of that node without white space (ECMAScript's `\s`).

- Entry: `rules::no_self_assign::e_binary(&mut Context, &E::Binary)`. The walk calls it for a binary expression
  that is an assignment expression, so not for the `=` of a default in a pattern; it acts on `=`, `&&=`, `||=`, `??=`.
- Two members are compared with `ast_utils::is_same_reference`, two property names with
  `ast_utils::get_static_string_value`. The text of the reported node is read again through `Context::start_of`,
  `Context::token_end` and `Context::close_bracket`.
- Tests: `test/cli/lint/rules/no-self-assign.json`, for the test that reads every fixture of that directory
  (`test/cli/lint/rules.test.ts` in the plan; not in the tree when this was written). 572 cases, 418 with a
  report and 154 without; 74 are the cases of ESLint's own test of the rule. Every case was run through ESLint at
  the pin; the 8 cases whose answer differs carry `differs` and ESLint's answer in `eslint`. The 77 cases added
  to the 495 of the research are in `c3-rule-support-unification/final/cases/added-no-self-assign.json`.

Differences from ESLint:

1. A `(` before the object of the reported member that is followed by anything but spaces and tabs is not found
   by the look-back of `Context::start_of`. The report is then at the first token after that `(` and not at the
   `(`; the name has the `(` all the same.
   - After a line break or another blank (U+000B, U+000C, U+00A0, U+2028, U+FEFF, ...): the same text at another
     place. `a.b = (\na).b`: ESLint 1:7, Bun 2:1, both `'(a).b' is assigned to itself.`
   - After a comment: another place and another text, because ESLint's name holds the comment.
     `a.b = ( /* c */ a).b`: ESLint 1:7 `'(/*c*/a).b' is assigned to itself.`, Bun 1:17 `'(a).b' is assigned to itself.`
     `a.b = (// c\na).b`: ESLint 1:7 `'(//ca).b' is assigned to itself.`, Bun 2:1 `'(a).b' is assigned to itself.`
   This ends when the look-back can cross comments and line breaks, which needs the parser's record of comments.
2. A property name with an unpaired surrogate is equal to no name (`get_static_string_value` gives none for it):
   `a["\ud800"] = a["\ud800"]` and `({"\ud800": a} = {"\ud800": a})` are not reported. ESLint reports both.
3. Equal reports print once: for `({a, a} = {a})` ESLint says `'a' is assigned to itself.` twice at 1:12, the
   output has that line once.
4. Code that ESLint's parser rejects and Bun's parse pass takes is linted as it reads. `a?.b.c = a.b.c` reports
   `'a.b.c'` and `([a]) = [a]` reports `'a'`: Bun says `Invalid assignment target` for both only in its visit pass,
   which a lint run does not make (seen with the installed bun 1.4.3, not with a build of this branch).
   `[a] &&= [a]` and `({a} ||= {a})` report `'a'`: Bun's parser takes both in either pass, the left side of a
   logical assignment is read as the pattern it looks like. The fixture has no such case: it holds only code that
   both parsers take.
5. Where the rule itself runs out of stack ("Rules and ESLint", difference 9). The rule recurses by itself, with
   other frames than the walk, so the stack can stop it in a file that the walk enters to its end. It can stop at
   three places. Two of them call `Context::too_deep`: the file then has the `internal-error`
   (`This file is nested too deeply to check all of it.`, once for a file) and the exit code 2, and the reports
   that wait for the end of the walk are dropped as they are after a cut of the walk (`Context::finish`).
   - The guard of `each_self_assignment`, for two patterns that are too deep to compare side by side. It says so
     at the node of the right side that was not compared.
   - `report`, for a node that has no name because its text is not read again: the stack stopped the look for
     spans under it (`tokens::spans_under`, for `Context::start_of` and `Context::close_bracket`). It says so at
     that node.
   - Not yet the guard of `ast_utils::is_same_reference`. It answers `false`, which the rule takes for two
     references: two members that are too deep to compare are not reported and nothing says so, unless the walk
     is stopped in them too. It ends when that guard says it: `context: &mut Context<'_, '_>` as its first
     parameter, and `context.too_deep(right.loc);` before its `return false;`. The call in `no_self_assign.rs`
     needs no change for that: it passes its `&mut Context`.
   Seen by the review of the rule, before the two calls were there, with a probe: the `src/lint` of the tree
   compiled against the rlibs of the debug build, on a thread with a stack of 16 MiB. It printed nothing for
   - `(a = a)` followed by 15,665 `.b` (15,664: the report; 15,666: the `internal-error` of the walk), where the
     guard of `each_self_assignment` stopped;
   - `[...[...[a]]] = [...[...[a]]]` nested 5,000 to 6,000 deep (4,000: the report; 7,000: the parser rejects
     it), the same guard;
   - `(a.b = a.b)` followed by 15,660 to 15,662 `.c`, where `report` had no name;
   - `a.b.b... = a.b.b...` with about 14,600 to 15,700 `.b` on each side (14,000: the report; 15,800: the
     `internal-error` of the walk), where the guard of `is_same_reference` stopped.
   With `too_deep` called at all three places in a copy, that probe printed the `internal-error` for each of
   these and the same bytes as before for the 572 cases of the fixture. The depths are those of the probe; a
   real binary has others. ESLint at the pin fails for the second and the fourth input (a `RangeError`, and
   `Parsing error: Not enough stack space to parse input`) and reports both with `node --stack-size=60000`.
   Not verified: the two calls in the tree were not built and not run. The fixture has no such case: the depth
   at which a guard stops is that of one build, and `rules.test.ts` takes an `internal-error` for a line that it
   does not expect.
6. A BigInt that is written with `0x`, `0o` or `0b` and has more than 4096 digits has no name ("Rules and
   ESLint", difference 15): `get_static_string_value` gives none for it, because its conversion to decimal
   digits is quadratic.
   - As a property name it is equal to no name. `({ 0xf...fn: a } = { 0xf...fn: a })` and
     `({[0xf...fn]: a} = {[0xf...fn]: a})` with 4097 `f` in each key are not reported, and neither are the two
     with `0o` and 4097 `7` or with `0b` and 4097 `1`. ESLint reports the `a` on the right (1:8216 and 1:8217).
   - As the index of a member it is compared by its text and not by its value
     (`ast_utils::equal_literal_value`). With 4097 digits in each index, `a[0xf...fn] = a[0xf...fn]` is reported,
     at ESLint's place and with ESLint's text, and `a[0xF...Fn] = a[0xf...fn]`, two spellings of one value, is
     not; ESLint reports it (1:4107).
   With 4096 digits, and for a decimal BigInt of 5000 digits, the answer is ESLint's. The fixture has no such
   case. Seen with ESLint at the pin and the probe of the research (`oracle/diff.cjs`), whose helper has the
   same limit; not with a build of this branch.

## Rule `use-isnan` (`src/lint/rules/use_isnan.rs`)

Port of ESLint `lib/rules/use-isnan.js` at eslint/eslint 4618052e, with its default options
`enforceForSwitchCase: true` and `enforceForIndexOf: false`. On by default as an error. A NaN is the identifier
`NaN`, the member `Number.NaN` (also written `Number["NaN"]`, ``Number[`NaN`]``, `Number?.NaN`, `(Number).NaN`), or
a sequence expression whose last expression is one of these. The three messages:

- `Use the isNaN function to compare with NaN.`: a `<`, `<=`, `>`, `>=`, `==`, `!=`, `===` or `!==` with a NaN on
  either side. At the start of the comparison.
- `'switch(NaN)' can never match a case clause. Use Number.isNaN instead of the switch.`: a `switch` whose
  discriminant is a NaN. At the `switch`.
- `'case NaN' can never match. Use Number.isNaN before the switch.`: a `case` whose test is a NaN. At the `case`.

How it is made:

- Entry: `rules::use_isnan::e_binary(&mut Context, &E::Binary, Loc)` and
  `rules::use_isnan::s_switch(&mut Context, &S::Switch, Loc)`. The walk calls them for every binary expression and
  for every `switch`, with the position of the node. `nan` is ESLint's `isNaNIdentifier`; the name of the member is
  read with `ast_utils::get_static_property_name`.
- ESLint reports a NaN only where its `NaN` or its `Number` is a reference to the global variable
  (`sourceCode.isGlobalReference`). The tree as written has no scopes, so each report is made with
  `Context::report_if_global` and the name it depends on, `Globals::NAN` or `Globals::NUMBER` (both for
  `NaN == Number.NaN`): it is held until the walk ends and dropped when the file declares every name it depends on
  (difference 1; difference 7 for an import that declares nothing).
- Places: `Context::binary_start` for a comparison (the `(` of its left operand are part of it), the position of
  the statement for a `switch`, `Context::case_start` for a `case` (`Case::loc` is empty after the parse pass, so
  the `case` is looked for in the text before the test). The span of a diagnostic is the first token at its place,
  as for every report of `Context`; ESLint's is the whole node. The plain format prints the start only.
- What the place of a comparison costs. `Context::binary_start` reads the text of the left operand again when a
  `(` stands directly before the comparison, and this rule is its only caller in the tree. For a chain behind a
  `(`, as in `(x === NaN === NaN ...)`, that was one scan for each link, so quadratic in the links. Since
  `4f05d29cdf` the scan of the outermost reported link answers for every link of the chain (the field `chains`
  of `Context`, by the first token of the chain). Still one scan for each level, so quadratic in the depth: a
  comparison inside the right operand of another, each behind its own `(`, as in
  `(a === (a === (b === NaN) === NaN) === NaN)`. Each level has another first token, and its scan reads all that
  is nested in it. Open, for `context.rs`: a record of the matched parentheses of a scanned range, from which a
  scan inside that range is answered. The review measured both shapes before that commit, on a probe of the
  committed sources (debug, ASAN): 1.83 s, 5.80 s and 22.6 s for 1250, 2500 and 5000 links, and 0.36 s, 1.29 s
  and 5.81 s for the depths 500, 1000 and 2000. Nothing was measured after it: that the chain is read once now
  and the nested shape is not is from the code.
- Not ported: `checkCallExpression` (`indexOf` and `lastIndexOf` with a NaN; off by default) and the suggestions of
  the rule (`Replace with Number.isNaN.` and two more): a diagnostic has no suggestion.
- Tests: `test/cli/lint/rules/use-isnan.json`, read by `test/cli/lint/rules.test.ts`. 438 cases, 214 with a report
  and 224 without; 135 have the code of a case of ESLint's own test of the rule, here always with the default
  options. Every case was run through ESLint at the pin (`ecmaVersion: "latest"`, as a script, or as a module when
  the script parser rejects it; JSX on for the two cases with `jsx`); the 39 cases whose answer differs carry
  `differs` (10 `moved`, 19 `missing`, 10 `extra`) and ESLint's answer in `eslint`. The 123 cases added to the 315
  of the research are in `c3-rule-support-unification/final/cases/added-use-isnan.json`, in the order of the
  fixture. The last 26 of them came with the review of the rule: 16 with an import that the parse pass drops or
  with a control of one (difference 7), and 10 chains of comparisons behind a `(`, four of them with a comparison
  in a right operand, which hold `Context::binary_start` to ESLint's places. The one before them,
  `typeof a === NaN`, came with `1bbb6f3e68`: it is a case of `valid-typeof` that gets a line of this rule, and
  since that commit the test takes a line of another rule only for a case that the fixture of that rule has too.

Differences from ESLint:

1. A declaration of `NaN` anywhere in the file drops every report that depends on `NaN`, and a declaration of
   `Number` every report that depends on `Number`, also where the declaration is not in scope at the NaN and ESLint
   reports. A declaration is a binding (`var`, `let`, `const`, `using`, a parameter, the parameter of a `catch`, an
   import that the parse pass keeps) or the name of a function or of a class, declared or in an expression. ESLint
   reports and Bun does not:
   - `x === NaN; function g(NaN) {}` (1:1), `function g(Number) {} x === Number.NaN` (1:23),
     `function g(NaN) {} switch (NaN) { case NaN: }` (1:20 and 1:35): the parameter of another function.
   - `(function NaN() {}); x == NaN` (1:22), `(class NaN {}); x == NaN` (1:17): the name of a function expression
     or of a class expression, which only its own body sees.
   - `function f(a = x === NaN) { var NaN; }` (1:16): ESLint does not resolve a reference in a default value to a
     variable of the body.
   - The same for a `let` in an inner block, the parameter of a `catch`, of an arrow function or of a method, a
     `var` in a static block, a function declared in a block: one case of each in the fixture.
   A report that depends on both names (`NaN === Number.NaN`) is dropped only when both are declared. Of
   `function f(Number) {} switch (NaN) { case Number.NaN: case NaN: }` the `switch` (1:23) and the second `case`
   (1:55) are reported and the first `case` (1:38) is not. This difference only removes reports. Where the walk
   finds no declaration of the name, the reference is the global for ESLint too, but for an import that the parse
   pass drops: there Bun adds a report (difference 7). It ends when a lint run knows the scopes of the file.
2. Two look-backs cross only spaces, tabs and `(`. Behind anything else the report is at the first token of the
   operand or of the test, with the same text:
   - `Context::case_start`, from the test back to its `case`. `switch (x) { case /* c */ NaN: }`: ESLint 1:14,
     Bun 1:27. `switch (x) { case\n NaN: }`: ESLint 1:14, Bun 2:2.
   - `Context::binary_start`, from the left operand back to its `(`. `(/* c */ x) === NaN`: ESLint 1:1, Bun 1:10.
     `(\nx) === NaN`: ESLint 1:1, Bun 2:1. `(\u00a0x) === NaN`: ESLint 1:1, Bun 1:3.
   This ends when the look-back can cross comments and line breaks, which needs the parser's record of comments;
   for a `case` also when the parser fills `Case::loc` (`src/js_parser/parse/parse_stmt.rs` writes `Loc::EMPTY`).
3. Equal reports print once: in `x === NaN === NaN` the inner and the outer comparison start at the same place,
   ESLint says `Use the isNaN function to compare with NaN.` twice at 1:1, the output has that line once (7 cases
   of the fixture, without `differs`).
4. No comment configures a lint run. ESLint says nothing for `/* global NaN: off */ x === NaN`,
   `/* eslint use-isnan: off */ x === NaN` and `x === NaN // eslint-disable-line`; Bun reports each (1:23, 1:29,
   1:1; seen with the probe of the research, as is difference 5). The fixture has no such case.
5. Code that ESLint's parser rejects and Bun's parse pass takes is linted as it reads: `x === NaN; return` is
   reported at 1:1, where ESLint says `'return' outside of function` and nothing else. The other way round,
   `x === NaN <!-- c` is reported by ESLint (as a script) and is a syntax error for Bun's parser. The fixture holds
   only code that both parsers take.
6. In a file that is nested too deeply to walk to its end (`internal-error`,
   `This file is nested too deeply to check all of it.`) this rule reports nothing: every report of it waits for
   the declarations of the whole file, and a walk that was cut has not seen them all (`Context::finish`). For
   `x = a.b.b...;` with 400,000 `.b` and then `x == NaN;` the output has the `internal-error` and no `use-isnan`
   (`c3-rule-support-unification/final/logs/deep.log`, `member2.js`).
7. An import that the parse pass drops declares nothing, so Bun reports where ESLint says nothing. A macro import
   (`with { type: "macro" }`, or a specifier that starts with `macro:`) and an import from `bun:bundle` leave no
   statement in the tree: `P::process_import_statement` answers `S::Empty` for them, and the list of statements
   keeps no `S::Empty`. `no_macros`, which a lint run sets, is read in the visit pass only. The walk has no
   `S::Import` to call `Context::declare` for, the `NaN` or the `Number` of such an import is taken for the
   global, and `Context::finish` keeps the report. Line 1 is the import, line 2 the code:
   - `import { NaN } from "./macros.js" with { type: "macro" };` and `console.log(x === NaN);`: Bun 2:13.
   - `import { Number } from "macro:./macros.js";` and `switch (Number.NaN) { case Number.NaN: }`: Bun 2:1 (the
     `switch`) and 2:23 (the `case`).
   - `import { feature as Number } from "bun:bundle";` and `console.log(x === Number.NaN);`: Bun 2:13. The same
     for `import NaN from "bun:bundle"` and `import * as NaN from "bun:bundle"`, which Bun's parser takes.
   ESLint reports none of them: the name is the import. With a plain import (`import { NaN } from "./macros.js"`)
   both say nothing. The fixture has 10 such cases, with `differs` (`extra`) and an empty `eslint`: the named, the
   default and the namespace import of a macro and of `bun:bundle`, an alias (`{ a as NaN }`), and a report that
   depends on both names. They are the only cases of this fixture in which Bun reports and ESLint does not.
   Beside them are 6 controls with ESLint's answer. Four are reported by both: the dropped import binds another
   name (`{ NaN as a }`, `{ a }`, `{ feature }`), or it binds `NaN` and the comparison has the global `Number.NaN`
   too. Two are reported by neither: the import stays in the tree (no attribute, `with { type: "json" }`).
   It ends when the names of a dropped import reach the walk: through an accessor on `ParsedOnly` for the local
   names that `process_import_statement` removes (a file of the parser unit; `NEEDS.md` has no request for it
   yet), or through a scan of the `import` clauses of the text in `Context::finish`. The 10 cases expect nothing
   from then on. `linter.rs` notes the gap at `visit_s_import` since `8b5abdd46d`.

Not verified: nothing was compiled or run in the worktree for this change, and no build of this branch has linted
a file yet (`src/runtime/cli/lint_command.rs` did not call `bun_lint::lint` when this was written). What was
run: the code of `use_isnan.rs` is the text of the research (`c3-rule-support-unification/final/src-lint`) with
three doc comments changed or added; the research compiled that text into its probe, on the rlibs of the debug
build at e3566be889, and clippy-driver with the lint levels of the workspace was clean on it. `expect` of each of
the first 411 cases is what that probe printed, sorted and an equal report once; it is also what ESLint at the pin
printed for every case without `differs`, and `eslint` is what ESLint printed for the others (`oracle/diff.cjs` of
the research). A dry run of the body of `rules.test.ts` over the probe's reports written as plain lines: 411
cases, none wrong. rustfmt is clean on the file.

The last 26 cases were not run on a build either. `expect` of each is what the probe of the review printed
(`/tmp/rev2-isnan`, outside the worktree: `context.rs`, `tokens.rs`, `linter.rs`, `ast_utils.rs` and
`rules/use_isnan.rs` as committed at `7587bce918`, the review's copies of the six rule modules that the tree does
not have, the rlibs of the debug build of the worktree, the parser options of `lint_command.rs`). `eslint` is what
ESLint at the pin printed: `oracle/diff.cjs` with that probe says `26 cases: same 13, merged 3, extra 10`. The
body of `rules.test.ts` as it is since `1bbb6f3e68`, over that probe's plain lines: 438 cases, none wrong, no
unexpected line, so no case gets a line of another rule whose fixture does not have it. ESLint at the pin over
the 438 cases: its answer, an equal report once, is `eslint` for the 39 with `differs` and `expect` for the
others. That probe is older than two commits that change what this rule reads. `4f05d29cdf` changed
`Context::binary_start`: that the 10 chains keep their places after it was read from the code, link by link, and
not run. `20eaa7c9a2` lets `tokens::case_before` find a `case` that stands after a character outside ASCII: no
case of the fixture has one.

## Rule `no-dupe-keys` (`src/lint/rules/no_dupe_keys.rs`)

Port of ESLint `lib/rules/no-dupe-keys.js` at eslint/eslint 4618052e. The rule has no options. On by default as an
error. Message: `Duplicate key '{{name}}'.` at the key of the later property; `name` is the name of the key as the
program sees it (`a`, `"a"` and `["a"]` are `a`; `1`, `1.0`, `0x1` and `1n` are `1`).

How it is made:

- Entry: `rules::no_dupe_keys::e_object(&mut Context, &E::Object)`. The walk calls it for every object literal
  that is not an assignment target, so not for a pattern ("The rule framework"). It reads the properties of that
  literal alone; a literal inside it gets a call of its own. That is ESLint's stack of `ObjectInfo`.
- The name of a key is `ast_utils::get_static_string_value` of the key: ESLint's `getStaticPropertyName` of a
  property, which ESLint's `no-dupe-class-members` names its members with too. A plain name, a string, a number
  and a BigInt have a name, and so has a computed key that is a string, a template without substitutions, a
  number, a BigInt, `null`, `true`, `false` or a regular expression. Two of these have a name in ESLint and none
  here: a string with an unpaired surrogate (difference 1), and a BigInt that is written with `0x`, `0o` or `0b`
  and has more than 4096 digits (difference 2). A key without a name is not compared: those two, and any other
  computed key. A spread is not compared either.
- What a property defines is ESLint's `GET_KIND` and `SET_KIND`: a value, a method and a shorthand (`init`)
  define the name for reading and for writing, a getter for reading, a setter for writing. A property is reported
  when an earlier property of the literal defines the name for something that it defines. So a getter and a
  setter of one name are not reported, and the second of two getters is.
- `__proto__: value` sets the prototype and is no key. As in ESLint a property with the name `__proto__` is
  skipped when it is a value, is not computed, is no shorthand and is no method; `__proto__` alone,
  `__proto__() {}`, `get __proto__() {}` and `["__proto__"]: value` are keys.
- The keys of a literal are sorted by name with a stable sort, and each run of one name is read in the order it
  was written. The reports of one literal are therefore made in the order of the names and not of the text; the
  command line sorts them ("Order and deduplication"). A literal with fewer than two properties is not read.
- Tests: `test/cli/lint/rules/no-dupe-keys.json`, read by `test/cli/lint/rules.test.ts`. 470 cases, 335 with a
  report and 135 without; 50 have the code of a case of ESLint's own test of the rule. Every case was run through
  ESLint at the pin (`ecmaVersion: "latest"`, as a script, or as a module when the script parser rejects it; JSX
  on for the five cases with `jsx`); the 2 cases whose answer differs carry `differs` (`missing`) and ESLint's
  answer in `eslint`. The 18 cases added to the 452 of the research are in
  `c3-rule-support-unification/final/cases/added-no-dupe-keys.json`: names in another order than they sort, a
  name that starts another name, accessors of two names in one literal, a literal of 46 properties in which a
  report moves when the sort is not stable (seen with `sort_unstable_by` of the pinned toolchain), a literal
  inside a literal with the same name, literals with no property, with one and with spreads only, `__proto__` as
  an async method and as a generator, and classes (a member of a class is no key; a literal inside a class is
  read).

Differences from ESLint:

1. A key whose name has an unpaired surrogate is not compared ("Rules and ESLint", difference 12):
   `({"\ud800": 1, "\ud800": 2})` and `var x = { '\uD800': 1, '\uD800': 2 };` are not reported. ESLint reports
   the second key of each (1:16 and 1:24). Both are in the fixture, with `differs`.
2. A BigInt key that is written with `0x`, `0o` or `0b` and has more than 4096 digits is not compared ("Rules and
   ESLint", difference 15): `ast_utils::get_static_string_value` gives no name for it, because its conversion to
   decimal digits is quadratic. `({ 0xf...fn: 1, 0xf...fn: 2 })` with 4097 `f` in each key is not reported, and
   neither is the same with `0b` and 4097 `1`; ESLint reports the second key (1:4109). With 4096 `f`, and for a
   decimal BigInt of 5000 digits, the answer is ESLint's. This difference is not in `DIFFERENCES.txt` of the
   research and not in the fixture; it was seen with the probe of the research, whose helper has the same limit.
3. Code that ESLint's parser rejects and Bun's parse pass takes is linted as it reads ("Rules and ESLint",
   difference 14). The fixture has no such case: it holds only code that both parsers take.
   - A second `__proto__: value` in one literal, also with the name in quotes or written with an escape (ESLint:
     `Parsing error: Redefinition of __proto__ property`): each of them is skipped and the other keys of the
     literal are compared. `({__proto__: 1, __proto__: 2})` reports nothing and
     `var x = { __proto__: 1, '__proto__': 2, a: 1, a: 2 };` reports `Duplicate key 'a'.` at 1:47.
   - A literal where a target is expected whose properties are no targets (ESLint:
     `Parsing error: Assigning to rvalue`): `({a: 1, a: 2} = obj);`, `[{a: 1, a: 2}] = b`,
     `({x: {a: 1, a: 2}} = b)`, `({a, a}) = obj;`, `[({a, a})] = obj;`, `for ({a, a} = 1 of list);` and
     `a = { b: 1, b: 2 } = c;` report nothing: the walk takes the literal for a pattern.
   - A literal on the left of another assignment operator (the same parsing error): `({a, a} += obj);` reports
     `Duplicate key 'a'.` at 1:6 and `({ a, a } ||= x);` at 1:7. Only the left of `=` is a pattern for the walk.
   - `({a, a}) => 1;` and `async ({a, a}) => 1;` (ESLint: `Parsing error: Argument name clash`) report nothing:
     the parameters are bindings.
4. Of the differences that hold for every rule ("Rules and ESLint", 1 to 9), one shows in the cases: a name with
   a line break gives a message with a line break, which both formats write as one space (difference 8; three
   cases of the fixture, `Duplicate key 'a<LF>b'.`).

Not verified: nothing was compiled or run in the worktree for this change (no `cargo check`, no clippy of the
crate, no build, no `bun bd test`), and no build of this branch has linted a file yet: `bun_lint` does not compile
until the modules of the other eight rules are in the tree, and `src/runtime/cli/lint_command.rs` did not call
`bun_lint::lint` when this was written. What was run, all of it by
`sh c3-2-no-dupe-keys/run.sh <scratch directory>` (no build of Bun, no cargo, about ten seconds):

- rustfmt of the pinned toolchain on the file: clean. No run of two comment lines.
- The file as a module of a small crate that has stand-ins for what it reads (`E::Object`, `G::Property`,
  `flags::Property`, `Expr`, `Loc`, `ast_utils::Name` and `get_static_string_value`, `Context::report`, `Rule`,
  `rules::text`): rustc with `-D warnings`, and clippy-driver with the lint levels of the workspace and the
  `clippy.toml` of the repository without its entries for `bun_core::output`, are clean (a control with a
  `std::collections::HashMap` in the file is rejected). The stand-ins are not the real crates: a type that
  differs from its stand-in shows only in the build.
- Its logic over 49 hand-made lists of properties (kinds, flags, names, spreads, keys without a name, two wide
  literals): every list gives the expected reports. With `sort_unstable_by` for `sort_by` one of them fails.
- The text differs from the text of the research (`c3-rule-support-unification/final/src-lint/rules/`), which the
  research compiled into its probe against the rlibs of the debug build at e3566be889, in four places that change
  no answer: it returns early for fewer than two properties, it reserves the vector, it asks the kind of the
  property where the research compares what the property defines, and it reads each run of one name with
  `chunk_by` where the research keeps the previous name.
- `expect` of each of the 470 cases is what that probe printed (the text of the research, not this file), sorted
  and an equal report once; for the 468 cases without `differs` it is what ESLint at the pin printed
  (`oracle/diff.cjs`: `470 cases: same 468, missing 2`). A dry run of the body of `rules.test.ts` over the
  probe's reports written as plain lines (`simulate-test.cjs`): 470 cases, none wrong.

## Rule `no-dupe-class-members` (`src/lint/rules/no_dupe_class_members.rs`)

Port of ESLint `lib/rules/no-dupe-class-members.js` at eslint/eslint 4618052e. The rule has no options. On by
default as an error. Message: `Duplicate name '{{name}}'.` at the key of the later member; `name` is the name of
the key as the program sees it (`a`, `'a'`, `['a']` and `` [`a`] `` are `a`; `1`, `1.0`, `0x1` and `1n` are `1`).

How it is made:

- Entry: `rules::no_dupe_class_members::class(&mut Context, &G::Class)`. The walk calls it for every class,
  declared or in an expression (`visit_s_class`, `visit_e_class`), before it walks into the class. It reads the
  members of that class alone; a class inside it gets a call of its own. That is ESLint's stack of states
  (`ClassBody`, `ClassBody:exit`).
- A member is a property of the class of the kind `Normal` (a method or a field), `Get` or `Set`: what ESLint
  visits as `MethodDefinition` and `PropertyDefinition`. A property of any other kind is skipped and counts for
  nothing: a static block, and an auto-accessor (difference 3).
- The name of a member is `ast_utils::get_static_string_value` of its key: ESLint's `getStaticPropertyName`, as
  for `no-dupe-keys`. A plain name, a string, a number and a BigInt have a name, and so has a computed key that
  is a string, a template without substitutions, a number, a BigInt, `null`, `true`, `false` or a regular
  expression. Two of these have a name in ESLint and none here: a string with an unpaired surrogate
  (difference 1), and a BigInt that is written with `0x`, `0o` or `0b` and has more than 4096 digits
  (difference 5). A member without a name is not compared: those two, any other computed key, and a private
  name (`#a`).
- The state of a name is ESLint's `init`, `get` and `set`, and a name has one state for its static members and
  another for the others (`Member::state_key`). A method or a field is reported when the state has any of the
  three, and gives it `init`; a getter when it has `init` or `get`; a setter when it has `init` or `set`. So a
  getter and a setter of one name are not reported, the second of two getters is, and `static a` beside `a` is
  not.
- The constructor is no member, as in ESLint, whose parser gives it the kind `constructor`. The tree has no such
  kind. The rule takes for the constructor the member that is not static, is not computed and has the name
  `constructor`: Bun's parser rejects every other member of that description (a field, a getter, a setter, a
  generator, an async method; `parse_property.rs`), so in a tree that parsed it is the constructor.
  `static constructor() {}`, `['constructor']() {}` and the field `['constructor']` are members like any other.
- The members of a class are sorted by name and by `static` with a stable sort, and each run of one state is
  read in the order it was written. The reports of one class are therefore made in the order of the names and
  not of the text; the command line sorts them ("Order and deduplication"). A class with fewer than two members
  is not read.
- Not ported: the first test of ESLint's handler, for a `TSEmptyBodyFunctionExpression` (an overload signature of
  TypeScript is no duplicate). No rule runs on TypeScript, and Bun's parser drops such a signature
  (`parse_method_expression`, a forward declaration). The kinds `Declare` and `Abstract`, which only a class of
  TypeScript has, are skipped with the other kinds; what they are to this rule is to be decided with the tests
  on TypeScript. By the node types of typescript-eslint a `declare` field is a `PropertyDefinition`, which
  ESLint's rule checks, and an `abstract` member is none; that was not run: the parser of typescript-eslint is
  not installed beside the pin.
- Tests: `test/cli/lint/rules/no-dupe-class-members.json`, read by `test/cli/lint/rules.test.ts`. 400 cases, 294
  with a report and 106 without. 77 have the code of a case of ESLint's own test of the rule: the 57 of its run
  with its own parser, and 20 of the 21 of its run with the parser of typescript-eslint, which are JavaScript;
  the one that is left has overload signatures. Every case was run through ESLint at the pin
  (`ecmaVersion: "latest"`, as a script, or as a module when the script parser rejects it; JSX on for the five
  cases with `jsx`); the 3 cases whose answer differs carry `differs` (`missing`) and ESLint's answer in
  `eslint`. The 118 cases added to the 284 of the research are in
  `c3-rule-support-unification/final/cases/added-no-dupe-class-members.json`: those 20 of ESLint's test; names
  (a number that is infinite, separators, numbers and BigInts of many digits, escapes, a line continuation, a
  quote, a line break, a surrogate pair written as two escapes, names that differ in case, in a blank or in
  their normal form, templates with a line break); computed keys that have no name, and literals behind
  parentheses, a comment and a line break; static members, accessors and methods of one name in one class; a
  class of 50 members of the shape that moves a report when the sort is not stable; the constructor beside
  members that only have its name, also written with escapes; words that are a modifier before a name and a name
  elsewhere; a class in other places of a program (22 cases, four of them JSX); and places (U+2028 as a line
  break, characters outside the BMP before the key, a hashbang). The fixture of the research had two cases
  twice: each is in it once now.

Differences from ESLint:

1. A member whose name has an unpaired surrogate is not compared ("Rules and ESLint", difference 12):
   `class A { '\ud800'() {} '\ud800'() {} }` and `class A { '\udc00\ud800'; '\udc00\ud800'; }` are not reported,
   and of `class A { 'a\ud800'; 'a\ud800'; a; a; }` only the second `a` is (1:36). ESLint reports the second
   member of each name (1:25, 1:27, 1:22). The three are in the fixture, with `differs`.
2. Code that ESLint's parser rejects and Bun's parse pass takes is linted as it reads ("Rules and ESLint",
   difference 14). The fixture has no such case: it holds only code that both parsers take.
   - Two constructors in one class (ESLint: `Parsing error: Duplicate constructor in the same class`).
     `class A { constructor() {} constructor() {} }` reports nothing, and neither does the same class with a
     constructor written `'constructor'`, `'const\u0072uctor'` or `\u0063onstructor`: the rule counts no
     constructor. The other members of such a class are compared:
     `class A { constructor() {} constructor() {} a; a }` reports `Duplicate name 'a'.` at 1:48. Bun's parser
     has no check for a second constructor, so a lint run says nothing about it at all; JavaScriptCore rejects
     the class when the file is run (`SyntaxError: Cannot declare multiple constructors in a single class.`,
     seen with the installed bun 1.4.3).
   - A number with a leading zero as a name (ESLint: `Parsing error: Invalid number`; the body of a class is
     strict code): `class A { 01() {} 1() {} }` reports `Duplicate name '1'.` at 1:19 and `class A { 08; 8; }`
     reports `Duplicate name '8'.` at 1:15.
   - `arguments` in the initializer of a field (ESLint:
     `Parsing error: Cannot use 'arguments' in class field initializer`): `class A { a = arguments; a; }`
     reports `Duplicate name 'a'.` at 1:26.
   - The other way round: `class A { [await]() {} await() {} }` is a script for ESLint, which reports nothing in
     it, and a syntax error for Bun, which reads every file with top-level `await` on.
   - The other way round too: a BigInt key after `static`, `get`, `set` or `async`.
     `class A { static 1n; static 1n; }` has `Duplicate name '1'.` at 1:29 for ESLint and is a syntax error for
     Bun (`Expected ";" but found "1n"`), and so are `get 1n() {}`, `set 1n(v) {}`, `async 1n() {}` and
     `static 1n() {}` twice in a class (ESLint: 1:27, 1:28, 1:31 and 1:33). After a word that can be a modifier
     Bun's parser asks whether the next token can start a key, and a BigInt is not in that list
     (`could_be_modifier_keyword` in `parse_property.rs`): the word is then the key. This branch does not edit
     the parser. A BigInt key with no such word before it parses, and so do `*1n() {}`, `static [1n]` and
     `get [1n]() {}`; for them the answer is ESLint's. Not among the inputs of `parser-cases.json`. Seen with
     ESLint at the pin and the probe of the research (`oracle/diff.cjs`), and the text of the error with the
     installed bun 1.4.3; not with a build of this branch.
3. An auto-accessor is neither compared nor counted: `class A { accessor a; accessor a; }` and
   `class A { accessor a; a; }` report nothing. ESLint's parser rejects `accessor a`. ESLint's rule visits
   `MethodDefinition` and `PropertyDefinition` only, and in a parser that takes an auto-accessor its node is
   neither (`AccessorProperty` of typescript-eslint; not run: that parser is not installed beside the pin).
   A lint run parses with `standard_decorators` on (`lint_command.rs`), so Bun's parser takes an auto-accessor,
   and a decorator, in a JavaScript file; a decorated member is a member like any other
   (`class A { @dec a() {} @dec a() {} }` reports the second `a`). This is from the code of the parser and of the
   rule, and for the auto-accessor from the stand-ins below: the probe of the research parses without that
   option, and both inputs are syntax errors for it.
4. Of the differences that hold for every rule ("Rules and ESLint", 1 to 9), three show for this rule:
   - No comment configures a run (difference 2): `class A { a; a } // eslint-disable-line`,
     `/* eslint no-dupe-class-members: off */ class A { a; a }` and
     `/* eslint-disable */ class A { a() {} a() {} }` are reported (1:14, 1:54, 1:39) and ESLint says nothing.
     Not in the fixture.
   - The span (difference 5): ESLint's report spans the key. The first token at a key is the whole key but for
     a regular expression: the report at `[/a/]` has the length 1 and the one at `[/=/]` the length 2.
   - A name with a line break gives a message with a line break, which both formats write as one space
     (difference 8; three cases of the fixture, `Duplicate name '<LF>'.` and twice `Duplicate name 'a<LF>b'.`).
5. A member whose name is a BigInt that is written with `0x`, `0o` or `0b` and has more than 4096 digits is not
   compared ("Rules and ESLint", difference 15): `ast_utils::get_static_string_value` gives no name for it,
   because its conversion to decimal digits is quadratic. `class A { 0xf...fn() {} 0xf...fn() {} }` with 4097
   `f` in each name is not reported, and neither is the same with `0o` and 4097 `7` or with `0b` and 4097 `1`;
   ESLint reports the second member (1:4117). With 4096 digits, and for a decimal BigInt of 5000 digits, the
   answer is ESLint's. This difference is not in `DIFFERENCES.txt` of the research, not in the fixture and not
   among the inputs of `parser-cases.json`. Seen with ESLint at the pin and the probe of the research
   (`oracle/diff.cjs`), whose helper has the same limit; not with a build of this branch.

Not verified: nothing was compiled or run in the worktree for this change (no `cargo check`, no clippy of the
crate, no build, no `bun bd test`), and no build of this branch has linted a file yet: `bun_lint` does not compile
until the modules of the other rules are in the tree (six were missing at `7587bce918`). What was run,
all of it by `sh c3-2-no-dupe-class-members/run.sh <scratch directory>` (no build of Bun, no cargo, under a
minute):

- rustfmt of the pinned toolchain on the file: clean. No run of two comment lines.
- The file as a module of a small crate that has stand-ins for what it reads (`G::Class`, `G::Property`,
  `G::PropertyKind`, `StoreSlice`, `flags::Property`, `Expr`, `Loc`, `ast_utils::Name` and
  `get_static_string_value`, `Context::report`, `Rule`, `rules::text`): rustc with `-D warnings`, and
  clippy-driver with the lint levels of the workspace and the `clippy.toml` of the repository without its entries
  for `bun_core::output`, are clean (a control with a `std::collections::HashMap` in the file is rejected). The
  stand-ins are not the real crates: a type that differs from its stand-in shows only in the build.
- Its logic over 83 hand-made lists of members (kinds, `static`, computed keys, keys without a name, the
  constructor and the members that only have its name, static blocks, auto-accessors, two wide classes): every
  list gives the expected reports. Ten faults put into the file on purpose each make a list fail:
  `sort_unstable_by` for `sort_by`; the test for the constructor without `static`, without the computed key and
  without the name; a getter that a setter makes a duplicate; a setter that a setter does not; a method that an
  accessor does not; one state for the static members and the others; an auto-accessor counted as a field; a
  class of two members not read.
- The text differs from the text of the research (`c3-rule-support-unification/final/src-lint/rules/`), which the
  research compiled into its probe against the rlibs of the debug build at e3566be889, in five places: a member
  is a struct where the research has a tuple; it returns early for fewer than two properties; it reserves the
  vector; it reads each run of one state with `chunk_by` where the research keeps the previous name; and it takes
  the member that is not static, not computed and named `constructor` for the constructor without asking, as the
  research does, that it is a method of the kind `Normal`. The last one changes no answer for a tree that parsed:
  the 14 inputs of `parser-cases.json` with another member of that description are syntax errors for Bun's
  parser, as for ESLint's.
- `expect` of each of the 400 cases is what that probe printed (the text of the research, not this file),
  sorted; for the 397 cases without `differs` it is what ESLint at the pin printed (`oracle/diff.cjs`:
  `400 cases: same 397, missing 3`). A dry run of the body of `rules.test.ts` over the probe's reports written
  as plain lines: 400 cases, none wrong. The probe parses without `no_macros`, `is_macro_runtime` and
  `standard_decorators`, which a lint run sets; no case has a macro, a decorator or `accessor` before a name on
  its line.
- The 36 inputs of `c3-2-no-dupe-class-members/parser-cases.json`, which are what this section says of the two
  parsers, of comments and of spans but for the BigInt after a modifier (difference 2), each have the answer
  that is written with them (`check-parser-cases.cjs`, ESLint at the pin and the same probe).

## Rule `valid-typeof` (`src/lint/rules/valid_typeof.rs`)

Port of ESLint `lib/rules/valid-typeof.js` at eslint/eslint 4618052e, with its default option
`requireStringLiterals: false`. On by default as an error. One message, `Invalid typeof comparison value.`, at the
value that a `typeof` is compared with by `==`, `!=`, `===` or `!==`, on either side of the operator. The value is
reported when it is

- a string, or a template without a substitution, whose value is none of `symbol`, `undefined`, `object`,
  `boolean`, `number`, `string`, `function` and `bigint`. The value is what the program sees: `"str\u0069ng"` and
  `` `\x73tring` `` are `string` and are not reported; `"String"`, `" string"` and `""` are;
- any other literal: a number, a BigInt, `true`, `false`, `null`, a regular expression;
- the name `undefined`, where it is the global (difference 1).

Nothing else is reported: another name, another `typeof`, a template with a substitution, a tagged template, `-1`,
`void 0`, a sequence, a member of a string, and a string that another operator takes first
(`typeof a === "strnig" in b` compares with `"strnig" in b`). Only a `typeof` that is itself an operand of the
comparison counts: `!typeof a === "strnig"` and `(0, typeof a) === "strnig"` are not reported, and
`(typeof a) === ("strnig")` is, at the string.

How it is made:

- Entry: `rules::valid_typeof::e_binary(&mut Context, &E::Binary)`. The walk calls it for every binary
  expression. ESLint's handler is on the `typeof` (`UnaryExpression`) and reads its parent; here the comparison
  reads its two operands and checks the other side of each one that is a `typeof` (`check_sibling`). With a
  `typeof` on both sides each is the other's sibling and nothing is reported, as in ESLint. Parentheses are in
  neither tree.
- A template without a substitution is an `E::EString` in Bun's tree, so ESLint's `isStaticTemplateLiteral` has no
  branch of its own. The value of the string is read with `ast_utils::get_static_string_value`. A string with an
  unpaired surrogate has no such value ("Rules and ESLint", difference 12) and is reported, because it is no type
  name: `typeof a === "\ud800"` has ESLint's answer.
- ESLint reports `undefined` only where it is a reference to the global variable and the file does not declare
  that variable (`isReferenceToGlobalVariable`). The tree as written has no scopes, so this report is made with
  `Context::report_if_global` and `Globals::UNDEFINED`: it is held until the walk ends and dropped when the file
  declares `undefined` anywhere (difference 1). A report at a literal does not wait.
- Place: the start of the value. The span is the first token there, as for every report of `Context`: the whole
  string, template, number or name, and of a regular expression its `/` ("Rules and ESLint", difference 5).
- Not ported: what `requireStringLiterals: true` adds (the message
  `Typeof comparisons should be to string literals.`) and the suggestion of the rule
  (``Use `"undefined"` instead of `undefined`.``): a diagnostic has no suggestion.
- Tests: `test/cli/lint/rules/valid-typeof.json`, read by `test/cli/lint/rules.test.ts`. 476 cases, 219 with a
  report and 257 without; 13 have `jsx`. 52 have the code of a case of ESLint's own test of the rule: every code
  of that test, the 11 that it runs with `requireStringLiterals: true` too, here always with the default options.
  37 of the cases without a report have no `typeof` (the research took them from lists that several rules
  share). Every case was run through ESLint at the pin (`ecmaVersion: "latest"`, as a script, or as a module when
  the script parser rejects it; JSX on for the cases with `jsx`); the 28 cases whose answer differs carry
  `differs` (`missing`) and ESLint's answer in `eslint`. The 275 cases added to the 201 of the research are in
  `c3-rule-support-unification/final/cases/added-valid-typeof.json`, in this order: the 11 codes of ESLint's test
  with the option (11); the value of a string and of a template, with escapes, a line continuation, an unpaired
  surrogate and a character outside ASCII (12); the other literals (10); a literal inside what is compared
  (`+"strnig"`, `"strnig".length`, `(b || "strnig")`; 16); an operator that binds tighter than the comparison and
  takes the string (7) and one that binds looser and leaves it (5); comparisons of comparisons (8); the operand of
  the `typeof` (9); parentheses, comments, line ends and automatic semicolons (17); where the comparison stands:
  statements, classes, the default of a parameter and of each kind of pattern, exports, JSX (50); `undefined` as
  the global, written with an escape too, and what only contains the name (27); a literal beside a declared
  `undefined` (2); a declaration of `undefined` that is in scope at the comparison, where ESLint is silent too
  (38); one that is not in scope (22, difference 1); and the name where it declares nothing, where both report
  (41).

Differences from ESLint:

1. A declaration of `undefined` anywhere in the file drops every report at an `undefined`, also where the
   declaration is not in scope at the comparison and ESLint reports ("Rules and ESLint", difference 10). A
   declaration is a binding (`var`, `let`, `const`, `using`, a parameter, the parameter of a `catch`, an import)
   or the name of a function or of a class, declared or in an expression. In 28 cases of the fixture ESLint
   reports `Invalid typeof comparison value.` at the `undefined` and Bun does not:
   - The six of the research (`final/DIFFERENCES.txt`): `function f(undefined) {} typeof x === undefined` (1:39),
     the parameter of another function; `{ let undefined = 1; } typeof x === undefined` (1:37), a `let` of a block
     that has ended; `function f() { var undefined; } typeof x === undefined` (1:46), a `var` of another
     function; `try {} catch (undefined) {} typeof x === undefined` (1:42), the parameter of a `catch`;
     `(function undefined() {}); typeof x === undefined` (1:41), the name of a function expression, which only
     its own body sees; `function f(a = typeof x === undefined) { var undefined; }` (1:29), where ESLint does not
     resolve a reference in a default value to a variable of the body.
   - A declaration of a block that has ended: a class (`{ class undefined {} } typeof x === undefined`, 1:37), a
     function (1:42), a `const` (1:39), a `using` (1:39), the `let` of a `for`-`of` (1:42) and of a `for` (1:45),
     a `let` in a `switch` (1:52), a pattern in a `catch` (1:46), and a `let` of an inner block of the function
     that compares (`function f() { { let undefined; } return typeof x === undefined }`, 1:55).
   - A declaration of another function or class: the parameter of an arrow function
     (`(undefined) => {}; typeof x === undefined`, 1:33), of a method of an object (1:37), of a method of a class,
     for a comparison after the class (1:42) and for one in a field of it (1:44), of a function expression that
     is called (1:43); a `var` of a function that is declared after the comparison
     (`typeof x === undefined; function f() { var undefined; }`, 1:14); a function declared in a function (1:55);
     a `let` of the function before (1:68); a `var` in a static block (1:52), and a `let` in a static block for a
     comparison in a method (1:63); the name of a class expression
     (`(class undefined {}); typeof x === undefined`, 1:36).
   - One declaration drops every `undefined` of the file, and no literal:
     `function f(undefined) {} typeof x === undefined; typeof y === undefined` has 1:39 and 1:63 from ESLint and
     nothing from Bun; `function f(undefined) { return typeof x === "strnig" } typeof x === undefined` has the
     string (1:45) from both and the `undefined` (1:69) from ESLint alone.
   This difference only removes reports: without a declaration of `undefined` in the file the reference is the
   global for ESLint too. Where the declaration is in scope at the comparison both are silent. Where the name
   declares nothing both report: a default value (`var { a = undefined } = o`), the key of a pattern
   (`var { undefined: a } = o`), an assignment target (`[undefined] = o`, `for (undefined in o) {}`,
   `undefined++`), the other name of an import or of an export (`import { undefined as a } from "m"`,
   `export { a as undefined }`), the name of a member of a class or of an object, a private name, a label, a
   string, the name of an element or of an attribute in JSX, and `eval("var undefined")`. It ends when a lint run
   knows the scopes of the file.
2. No comment configures a lint run ("Rules and ESLint", difference 2). ESLint says nothing for
   `/* global undefined: off */ typeof a === undefined`, `/* eslint valid-typeof: off */ typeof a === "strnig"`,
   `typeof a === "strnig" // eslint-disable-line`, a `// eslint-disable-next-line valid-typeof` on the line
   before, and `/* eslint-disable */ typeof a === undefined`; Bun reports each (1:42, 1:45, 1:14, 2:14, 1:35).
   With `/* eslint valid-typeof: ["error", { requireStringLiterals: true }] */` in front, ESLint reports
   `typeof a === b` (1:84, `Typeof comparisons should be to string literals.`) and Bun does not, and it has that
   text for `typeof a === undefined` where Bun has `Invalid typeof comparison value.` at the same place.
   `/* global undefined */` and `/* global undefined: writable */` change nothing for ESLint either. The fixture
   has no such case.
3. Code that ESLint's parser rejects and Bun's parse pass takes is linted as it reads ("Rules and ESLint",
   difference 14): `typeof a === "strnig"; return` and `typeof a === undefined; return` are reported at 1:14,
   where ESLint says `'return' outside of function` and nothing else. The other way round,
   `typeof a === "strnig" <!-- c` and `typeof a === "\08"` are reported by ESLint (as a script, 1:14) and are
   syntax errors for Bun's parser. The fixture holds only code that both parsers take.
4. In a file that is nested too deeply to walk to its end (`internal-error`,
   `This file is nested too deeply to check all of it.`) no `undefined` is reported, before or after the place
   where the walk was cut: each such report waits for the declarations of the whole file, and a walk that was cut
   has not seen them all (`Context::finish`; "Rules and ESLint", difference 9). A literal is reported wherever
   the walk reached it. For `x = a.b.b...;` with 400,000 `.b`, then `typeof x === undefined;` and
   `typeof x === "strnig";`, the output has the `internal-error` and the report at the string (3:14) and none at
   the `undefined`; the same with the two comparisons in front of the deep statement
   (`c3-2-valid-typeof/deep.log`).
5. Of the differences that hold for every rule ("Rules and ESLint", 1 to 9), one more shows in the cases: the
   span of a report at a regular expression is its `/`, or its `/=` when the expression starts with `=`, where
   ESLint's is the literal (difference 5). No format prints a span. No case has two equal reports (difference 6):
   a value is an operand of one comparison.

Not verified: nothing was compiled or run in the worktree for this change (no `cargo check`, no clippy of the
crate, no build, no `bun bd test`), and no build of this branch has linted a file yet: `bun_lint` does not compile
until the modules of the other six rules are in the tree, and nothing compiles or calls
`src/runtime/cli/lint_command.rs` ("State of the tree"). What was run, all of it by
`sh c3-2-valid-typeof/run.sh <scratch directory>` (no build of Bun, no cargo, about half a minute; its output is
`c3-2-valid-typeof/run.log`):

- rustfmt of the pinned toolchain on the file: clean. No run of two comment lines.
- The file as a module of a small crate that has stand-ins for what it reads (`E::Binary`, `E::Unary`,
  `E::Identifier`, `Expr`, `ExprData` with a `StoreRef` where the real variant has one, `OpCode`,
  `ast_utils::get_static_string_value` and `Name`, `Context::name_of` and `Context::report_if_global`, `Globals`,
  `Rule`, `rules::is_equality`): rustc with `-D warnings`, and clippy-driver with the lint levels of the workspace
  and the `clippy.toml` of the repository without its entries for `bun_core::output`, are clean (a control with a
  `std::collections::HashMap` in the file is rejected). The stand-ins are not the real crates: a type that
  differs from its stand-in shows only in the build.
- Its logic over 239 hand-made comparisons (each operator, each side, the eight names as a string and as a
  template, other strings, a string without a value, each other literal, names, what is no literal, a `typeof` on
  both sides and on neither, other unary operators, comparisons of comparisons): every one gives the expected
  reports. Four faults put into the file on purpose each make a check fail: a type name misspelled, the `typeof`
  itself checked in place of the other side, `null` taken for no literal, `undefined` reported without waiting.
- The text differs from the text of the research
  (`c3-rule-support-unification/final/src-lint/rules/valid_typeof.rs`), which the research compiled into its
  probe against the rlibs of the debug build at e3566be889, in the names of three private functions and of their
  parameters, in its comments, and in the line breaks of one call. Nothing else differs.
- `expect` of each of the 476 cases is what that probe printed (the text of the research, not this file), sorted
  and an equal report once; for the 448 cases without `differs` it is what ESLint at the pin printed, and
  `eslint` is what ESLint printed for the other 28 (`oracle/diff.cjs`: `476 cases: same 448, missing 28`;
  `c3-2-valid-typeof/check-fixture.cjs` compares the fixture with that answer). A dry run of the body of
  `rules.test.ts` over the probe's reports written as plain lines (`c3-2-valid-typeof/simulate.cjs`): 476 cases,
  none wrong, no line that the test does not expect. In the 275 added cases no other rule reports.

Also run, with the same probe: the cases of differences 2 and 3 (`c3-2-valid-typeof/outside-the-fixture.json`, the
answers in `outside-the-fixture.log`), and `sh c3-2-valid-typeof/deep.sh <scratch directory>` (`deep.log`):
difference 4, a chain of 20,000 `=== "strnig"` after one `typeof` (one report, at the first string), 1,000
comparisons joined with `||` (1,000 reports) and 3,000 nested `typeof (... === "strnig")` (2,999 reports, none
for the innermost comparison, which has no `typeof` as an operand); none of them is too deep for the walk.
