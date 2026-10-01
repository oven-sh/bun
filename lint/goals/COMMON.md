# Rules for every unit of the `bun --lint` work

Read this file first, then the file of your unit, then the repository's CLAUDE.md and src/CLAUDE.md.

## What is being built

Two Bun maintainers asked for `bun --lint`: a FULL TypeScript type checker plus lint rules, written in Rust, on top
of Bun's own parser and AST. The project lead's words: "implement full typescript type checker in Rust and lint, on
top of bun's AST. You can probably keep most of the existing parsing pass and add a custom visiting pass." He also
decided that all of it ships as ONE pull request: https://github.com/oven-sh/bun/pull/44200, branch
`robobun/abbc0c92/bun-lint`. The work is split into units that own disjoint files and run at the same time, each
in its own git worktree and on its own branch. An integrator merges the unit branches into the PR branch.

## Design (decided, do not reopen)

- The parse pass stays ONE copy. A lint parse keeps the TypeScript syntax that the parser drops today in a side
  table ("sidecar") beside the unchanged tree. No new const generic on the parser `P`, no new `Expr` or `Stmt`
  variant, no field added to an existing AST type, no edit to the existing visit pass.
- The type grammar is generic over a sink (`src/js_parser/parse/type_sink.rs`): `Discard`, `DecoratorMetadata`,
  and a `Build` sink that makes type nodes.
- A new read-only pass indexes, binds and checks. It never writes a `bun_ast` `Ref`, `Symbol` or `Scope`.
- The checker is a MECHANICAL PORT of typescript-go, the way `src/react_compiler` is a port (read
  `src/react_compiler/DESIGN.md`): same function names (in snake_case), same order, same control flow, the
  upstream comments that explain semantics kept as one-line comments, only the AST reads changed. Do not
  redesign. Do not "improve". The oracle is upstream's own test baselines, byte for byte.
- Reports, when the files exist (a restart of the machine can remove them, then work from the code and the
  reference): `/workspace/notes/lint/design/design-report.md`, `/workspace/notes/lint/parser-inventory/`,
  `/workspace/notes/lint/port-map/`.

## Reference sources (read-only, never edit)

- `/workspace/ref/typescript-go` = microsoft/typescript-go at 89d5d5b (Apache-2.0). `internal/checker`,
  `internal/binder`, `internal/ast`, `internal/parser`, `internal/scanner`, `internal/compiler`,
  `internal/module`, `internal/tsoptions`, `internal/diagnostics`, `internal/testrunner`.
- `/workspace/ref/typescript-go/_submodules/TypeScript` = microsoft/TypeScript at 5848bc5 (Apache-2.0):
  `src/compiler/diagnosticMessages.json`, `src/lib`, `tests/cases`, `tests/baselines/reference`.
- If a directory or a helper under `/workspace/tools` is missing, run `sh /workspace/notes/lint/tools/bootstrap.sh`.

## THE MACHINE CAN RESTART AT ANY TIME. WORK THAT IS NOT PUSHED IS LOST.

This already happened twice. The first time a day of work was lost. So:
- After EVERY commit, push your unit branch: `git push origin HEAD:<your unit branch>`. Only that branch.
  Never push to `robobun/abbc0c92/bun-lint` or to `main`.
- Commit in small steps that compile. Prefer ten small pushed commits over one large one.
- After you change a file under `/workspace/notes/lint/units/<your unit>/`, run
  `/workspace/tools/save-notes "<your unit>: <what changed>"`. It commits and pushes the notes.
- When you start, look at what exists: `git log --oneline origin/<your unit branch>` (if the remote branch
  exists, your worktree must contain it: `git merge --ff-only origin/<your unit branch>`), and read your
  unit's notes directory. Continue from there. Do not redo work that is committed.

## RUN WHAT YOU WRITE

In the last round, units wrote tens of thousands of lines and ran none of them in their worktree, because the
build lock was busy: they checked single files in scratch crates. Do not do that again as the only check. A
change is done when the real crate compiles (`cargo check -p <crate>`) and the real test ran
(`bun bd test <file>` or `cargo test -p <crate> --lib`). A source file that no `mod` line reaches is not
compiled and does not count as written. Waiting for the lock is normal: give the command a timeout of
3600000 ms and wait.

## Hard rules

1. Work ONLY in the worktree and on the branch that your unit file names. Touch ONLY the files your unit owns.
   If you need a change in a file that another unit owns, do not make it: write what you need, with the exact
   signature, into `NEEDS.md` in your unit's notes directory, and work around it on your side.
2. Commit only your own files, by explicit path (`git add <path> ...`). NEVER `git add -A`, `git add .` or
   `git commit -a`. Never open or close a pull request. Never switch branches. Never rebase. Never force-push.
3. A parse WITHOUT `--lint` pays nothing: no new allocation, no new syscall, no larger AST struct, no test in
   `Lexer::next`, in the node constructors (`new_expr`, `s`, `b`) or in `parse_paren_expr`. The AST files have
   `const` layout assertions: they must keep passing unchanged.
4. No panic on user input. In code that input can reach: no `unwrap`, `expect`, `panic!`, `unreachable!`,
   `todo!`, array index that can be out of range, or unbounded recursion. Where upstream panics or asserts, report
   an internal diagnostic and continue. Bound recursion with `bun_core::StackCheck` as the parser does.
5. Comments: ONE line each. A repository check rejects any added run of two or more comment lines (doc comments
   too), except a block that contains `SAFETY:`. No `TODO`, `FIXME`, `XXX`, `HACK`. No comment that mentions a
   tool, an assistant, a prompt, a plan, a unit or a pull request number. Say only facts about the code.
6. The workspace denies warnings, dead code, unused imports and many clippy lints. `cargo check -p <crate>`,
   `cargo clippy -p <crate>` and `cargo fmt -p <crate> -- --check` must be clean for the crates you touch.
   Code that nothing calls yet fails `dead_code = "deny"`: land a caller or a test with it, or make it `pub`
   from a crate root that a test uses. Do not silence the lint with `#[allow(dead_code)]`. One exception:
   `src/typecheck/lib.rs` may carry `#![allow(dead_code)]` until `bun --lint` calls the checker.
7. No new dependency from crates.io. Prefer `bun_core`, `bun_sys`, `bun_paths`, `bun_collections`, `bun_alloc`
   over `std` (see the table in src/CLAUDE.md).
8. Tests: follow CLAUDE.md ("Writing Tests"). `bun:test`, `harness` (`bunExe`, `bunEnv`, `tempDir`), no
   `setTimeout`, no network, no hardcoded port, assert stdout and stderr before the exit code, never assert the
   absence of "panic". A test must fail without the change it tests and pass with it.
9. Copied or ported upstream code is Apache-2.0. Keep a file `UPSTREAM_PORTED` in the crate that names the
   upstream repository and commit, and keep upstream file names recognisable in module names.
10. Commit messages say what the code does. They never mention a tool, an assistant or this specification.
11. Be honest in reports: say what works, what does not, and what you did not verify.

## Building and testing in a worktree

- THE MACHINE HAS 32 GB OF MEMORY FOR EVERYTHING, AND IT IS REMOVED WHEN THAT IS USED UP. That is how the work
  was lost three times. One debug build of bun needs most of it. So: run EVERY heavy command through the lock
  helper, which lets ONE heavy command run at a time on the whole machine. Heavy means: any `bun bd`, any
  `bun run build*`, any `cargo` command, any test run, any script that starts more than four processes.
  A watchdog ends the largest compiler, linker or test process when memory runs short: if your build dies
  with signal 9, look at `/workspace/tools/memwatch.log` and run it again alone.
  Examples: `/workspace/tools/lk bun bd -j8 --version`,
  `/workspace/tools/lk cargo check -p bun_js_parser --message-format=short`,
  `/workspace/tools/lk bun bd test test/cli/lint/lint.test.ts`. A command can wait a long time for the lock:
  give EVERY build or test command an explicit timeout of 3600000 ms. The default 2 minutes kills it, which
  then looks like a hang or like exit code 137.
- First time in a new worktree: `bun install`, then `(cd test && bun install)`, then
  `/workspace/tools/lk bun bd -j8 --version` (a full debug build, it also fetches `vendor/`; `-j8` keeps the
  compilers within the memory). `cargo check` works only after that. Look first whether `build/debug/bun-debug`
  exists: then the worktree is built and the next build is short.
- A script of yours that starts `bun`, `bun-debug`, `node` or `tsc` many times runs at most FOUR of them at a
  time, and goes through the lock helper when it runs longer than a minute.
- Fast loop: `cargo check -p <crate>`. Full build and run: `bun bd <args>`. Tests: `bun bd test <file>`.
  NEVER plain `bun test` or `bun <file>` to judge your change: those run the installed release binary, not
  your build. If a test fails only with `timed out after 5000ms`, run it again with `--timeout 180000`.
- Never write `pgrep -f <text>` or `pkill -f <text>` where `<text>` is also in your own command line.
- Measurement helpers: `/workspace/notes/lint/tools/symsizes.py <bun-profile>` (parser symbol sizes by
  address), `/workspace/notes/lint/tools/cgbench.sh <bun-profile> <out dir> <tag> 20` (instruction and
  branch counts of the transpiler benchmark under valgrind, fixed inputs), `cgsum.py` (sums a cachegrind file).
  A release build with symbols is `bun run build:release`, output `build/release/bun-profile`.

## Reports

Keep a running log of decisions and open points in your unit's notes directory (the unit file names it), and
save it with `/workspace/tools/save-notes`. The final report lists: commits, files, what is done, what is not,
each deviation from upstream with the reason, each place where you are unsure, and the exact commands that
reproduce your test results.
