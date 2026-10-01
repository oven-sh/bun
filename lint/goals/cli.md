# Unit "cli": the `bun --lint` entry point, diagnostics output, and the lint rule framework

Read `/workspace/notes/lint/goals/COMMON.md` first. Its rules apply to everything below.

- Worktree: `/workspace/wt/cli`. Branch: `robobun/abbc0c92/lint-cli`.
- Notes directory (your log, `API.md`, `NEEDS.md`, final report): `/workspace/notes/lint/units/cli/`.
- You OWN: `src/runtime/cli/Arguments.rs`, `src/runtime/cli/mod.rs`, `src/runtime/cli/lint_command.rs` (new),
  `src/options_types/context.rs`, `src/ast/lib.rs` (only the `Msg` / `Metadata` part, for the diagnostic code),
  everything under `src/lint/`, everything under `test/cli/lint/` EXCEPT `test/cli/lint/conformance*` and
  `test/cli/lint/typecheck/`, and the existing tests `test/cli/run/as-node.test.ts` and
  `test/cli/env/bun-options.test.ts` where they pin flags.
- You do NOT own: `src/js_parser/`, `src/typecheck/`, the root `Cargo.toml` (the workspace entries for
  `bun_lint` and `bun_typecheck` exist; you may edit `src/lint/Cargo.toml` and `src/runtime/Cargo.toml` is
  already wired; run `cargo check` to refresh `Cargo.lock`, commit the lock with it and say so in your report).

## Facts about the CLI today (all verified)

`bun --lint x.ts` drops the unknown flag and EXECUTES `x.ts` (`src/clap/streaming.rs:10` and `:157-175`). Bare
`bun --lint` prints help and exits 0. `bun lint` runs the package.json script named `lint`, and that must keep
working. `which()` in `src/runtime/cli/mod.rs` skips leading flags, so `bun --lint test` dispatches to the
`test` subcommand. The auto command stops flag parsing after the first positional (`Arguments.rs`,
`stop_after_positional_at: 1`). `args.flag(name)` on a name that is not in the table of the current command is
`unreachable!` (`src/clap/comptime.rs`). `--version` and `--revision` show where a flag of the auto command is
declared (`AUTO_ONLY_PARAMS`) and read. `-e` / `--eval` shows where control leaves the run path
(`exec_auto_or_run` in `mod.rs`). The Windows `--watch` fork happens in `create_context_data`, before
`exec_auto_or_run`. Node validates `--check` ahead of its run path and refuses combinations
(`node --check -e 1` exits 9).

## Milestones, in this order. Commit and push after each step inside a milestone.

### C1. `bun --lint <files>` parses its operands and never runs them

1. A value-less flag `--lint` with NO help text (hidden) for the auto command and for `bun run`. A bool on the
   context. A branch in `exec_auto_or_run` AHEAD of every run mode that calls a `#[cold]` function in the new
   file `src/runtime/cli/lint_command.rs`. JavaScriptCore must never start in a lint run.
2. The flag works only when the environment has `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1` (use the existing
   feature-flag helper of `bun_core`, see how other `BUN_FEATURE_FLAG_*` are read). Without it, `--lint` is
   refused loudly: a message on stderr that names the variable, exit code 1, and the file is NOT run.
3. Operands: one or more files. For each: read it, parse it with Bun's parser for its loader (js, jsx, ts,
   tsx, mjs, cjs, mts, cts, and `.d.ts` files), print the syntax errors of the log to stderr, continue with the
   next file. Exit code 2 if any file had an error (the code tsc uses), 0 if none, 1 for a usage error.
   Until the parser unit delivers `Parser::parse_for_lint` (read
   `/workspace/notes/lint/units/parser/API.md` when it exists), use the parse entry that exists. With no
   operand: a usage error on stderr and exit code 1. Checking a whole project with no operand comes with the
   program layer, later.
4. Loud refusals, each with its own test: `--lint=value`, `--lint` with `-e` / `--eval`, with `-p` /
   `--print`, with stdin as the script, with `--watch` (refuse BEFORE the Windows watcher fork), with `--hot`,
   with `--filter`, with `--parallel`, under `bunx`, under `bun repl`, `bun build --lint`, `bun test --lint`,
   `--lint` inside `BUN_OPTIONS`, `--compile-exec-argv`, and a token that starts with `-` after the first
   operand. Each refusal: message on stderr, exit code 1, nothing runs.
5. Pinned as unchanged, each with a test: `bun x.ts --lint` (the flag after the script is an argument of the
   script), `bun lint` (runs the package.json script), and `node` emulation (`argv0` node ignores the flag
   as it does today).
6. Tests in `test/cli/lint/lint.test.ts`. The central test: a file that writes a marker file when it runs.
   `bun --lint file.ts` with the environment variable set must exit 0, print nothing, and the marker must not
   exist. The same command fails this test with the installed release bun, which runs the file.
   Use `tempDir`, `bunExe()`, `bunEnv` from `harness`.

### C2. Diagnostics carry a code and print in tsc's format

1. A diagnostic of a lint run has: file, start offset, length, category (error, warning, suggestion, message),
   a code (`TS2322` for the checker, a rule name such as `no-debugger` for lint rules), the message text, an
   optional chain of nested messages (each indented by two more spaces when printed), and related information.
   For `bun_ast::Msg`: add the code as a third variant of its `Metadata` enum so that `size_of::<Msg>()` stays
   152 bytes (const assertion). Keep a lint-specific diagnostic type in `bun_lint` for the rest.
2. Output: sorted by file, then position, then code, and deduplicated. Do not add a format flag. When stderr is
   a terminal, print Bun's code frame with the code in front of the message. When stderr is not a terminal,
   print tsc's plain format, one diagnostic per line plus its indented chain:
   `path(line,col): error TS2322: Type 'string' is not assignable to type 'number'.`
   (line and column are 1-based, column counts UTF-16 code units, as tsc does). Write the formatter so that the
   conformance unit can use the same bytes for `.errors.txt` baselines (see the reference
   `internal/testutil/tsbaseline/error_baseline.go` and `internal/diagnosticwriter`).
3. Tests for sorting, deduplication, both formats, non-ASCII columns, and exit codes.

### C3. The rule framework and the first rules

1. `bun_lint`: a rule is a visitor over the tree AS WRITTEN (before the visit pass), built on
   `bun_ast::walk::Visitor` (`src/ast/walk.rs`, one method per variant). All rules run in ONE walk of a file.
   A rule has a name (the ESLint name when ESLint has the rule), a category, and a default level. No
   configuration file and no suppression comments yet: say in `API.md` where they will attach.
2. First rules, all syntactic, all on by default as errors, each with tests for code that must be reported
   and code that must not: `no-debugger`, `no-dupe-keys`, `no-dupe-class-members`, `no-duplicate-case`,
   `no-empty-pattern`, `no-compare-neg-zero`, `use-isnan`, `valid-typeof`, `no-unsafe-negation`,
   `no-sparse-arrays`, `no-self-assign`. Follow the ESLint semantics of each rule exactly (its documented
   defaults); list every deliberate difference in `API.md`. Rules that need to know about parentheses or
   about syntax that the parser drops wait for the sidecar.
3. Until `parse_for_lint` exists, rules run on JavaScript through `Parser::parse_only` and TypeScript files
   report syntax errors only. State that in `API.md`. Write the TypeScript tests when the entry exists.

## Out of scope for this unit

The parser, the type checker, tsconfig, project discovery, the conformance corpus, help text, shell
completions and docs (they land when the flag becomes public).
