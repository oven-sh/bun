# Unit "parser", round 2: prove what was written, then close the gaps

Read `/workspace/notes/lint/goals/COMMON.md` first, then `/workspace/notes/lint/goals/parser.md` (round 1: what
you own, the milestones P1 to P3). This file says where the work stands and what is left.

- Worktree: `/workspace/wt/parser`. Branch: `robobun/abbc0c92/lint-parser`. Push it after every commit:
  `git push origin HEAD:robobun/abbc0c92/lint-parser`.
- Notes: `/workspace/notes/lint/units/parser/` (`API.md`, `NEEDS.md`, your probes and the differential harness
  `grammar-diff/`). Save them with `/workspace/tools/save-notes "parser: <what>"`.

## Where the work stands (verified by the integrator on 2026-09-30)

Round 1 wrote P1, P2 and P3 in 36 commits and ran none of them in the worktree. They are now merged into the
pull request branch, and the unit branch equals that branch. First execution:
- The debug build passes. `cargo clippy` and `cargo check --all-targets` are clean for `bun_ast`, `bun_js_parser`.
- `cargo test -p bun_js_parser --lib`: 70 passed.
- `test/bundler/transpiler/typescript-grammar*.test.ts` (4 files): 366 cases pass.
- The nine older files of parser.md P1.6 pass, after ONE fix: `const a: typeof #a = 1;` was accepted by a parse
  without lint, and `test/bundler/transpiler/transpiler.test.js` expects the error
  `Expected identifier but found "#a"`. The fix keeps the old error unless `S::STRICT` (commit `4d06830629`).
- CI of the pull request: every platform builds. The ASAN lane failed on a leak that is older than this work:
  `Metadata::MDot` held a `Vec<Ref>` inside arena nodes. It is now a `StoreSlice<Ref>` in the arena
  (commit `be1ebe5295`), and `TypeSink::member` takes the arena.

Lesson of the `typeof #a` case, which is now a rule: for a parse WITHOUT lint, "valid TypeScript" means that tsc
as a whole reports nothing for the construct: no parse diagnostic AND no grammar error of the checker. Where tsc's
parser accepts a text and its checker rejects it, and Bun rejected it before, Bun keeps rejecting it when
`!S::STRICT`. No older test changes its expectation, except decorator metadata that now equals tsc's.

## Part A. Proofs that round 1 owes (do these first, in this order)

A1. The differential run of P1.7, with your own harness (`grammar-diff/harness.mjs`, `diff.mjs`, `causes.mjs`,
    the two corpora and the tsc oracle files).
    - Base binary: a release build of commit `e3566be889` (the tree before the parser work). Make it once, in a
      scratch worktree that you remove afterwards: `git worktree add --detach /workspace/wt/parser-base e3566be889`,
      `bun install` there, `/workspace/tools/lk bun run build:release` there. Keep `build/release/bun` and
      `build/release/bun-profile` of it under `/workspace/notes/lint/measure/parser/base/` (that path is not
      committed).
    - Head binary: `/workspace/tools/lk bun run build:release` in your worktree.
    - Run the harness with both, then `diff.mjs`. Required result: ZERO records of class A>R (base accepted, head
      rejects), zero crashes and hangs. Every R>A record has a cause, and the source of each is valid for tsc as
      a whole (rule above): where it is not, restore the rejection for `!S::STRICT` and add the case to a test.
      Every A>A record is decorator metadata whose new value equals tsc 6.0.2.
    - Write the table (class, cause, count, one example) into `API.md` and into your report.
A2. The zero-cost proof of P2, on the same two release builds:
    `python3 /workspace/notes/lint/tools/symsizes.py <bun-profile>` for both, and
    `/workspace/notes/lint/tools/cgbench.sh <bun-profile> <out dir> <tag> 20` for both. Required: +0 conditional
    branches in each of the five groups. Explain every instruction difference by function
    (`/workspace/notes/lint/tools/cgsum.py <file.cg> --top 40` on both sides). Where the type grammar of a parse
    without lint got slower or larger, fix it: the `Discard` instantiation must not pay for `Build`.
    Also report `size_of` of `P<true,false>`, `Lexer`, `Msg`, `Expr`, `Stmt`, `Binding`, `E::Arrow`, `G::Decl`,
    `G::Arg`, `G::Fn`, `G::Property` on both trees (the const assertions in `src/js_parser/p.rs` hold `P`).
A3. The proof of P3.1: a lint parse leaves the statements, `scopes_in_order` and the value symbols as a normal
    parse makes them. Test: for every `.ts` and `.tsx` file under `test/` and `src/js` that parses, visit and
    print the lint-parsed tree and compare the bytes with the normal transpile. Report the counts.

## Part B. What P3 does not have yet

B1. Comments. The side table has no comments. Record every comment with its range and its kind (line, block,
    JSDoc block), in source order, including comments inside JSX opening tags (`next_inside_jsx_element` does not
    pass the comment hook) and before the first token. Record the directive comments of the reference's scanner
    (`@ts-ignore`, `@ts-expect-error`: kind and range, only the last line of a block comment counts), the
    triple-slash directives and the `@ts-nocheck` / `@ts-check` pragmas of the file header. Rewind the lists at
    every backtracking point. `full_start` takes these comments.
B2. `bun_ast::Metadata::Code(u32)` exists now (`src/ast/lib.rs`, owner: cli, see its `API.md`, "Diagnostic code on
    `bun_ast::Msg`"). A syntax error of a lint parse carries its tsc code on the `Msg` itself. Keep the table
    `SyntaxErrors` only for what a `Msg` cannot hold (the range and the text of the reference), and say in
    `API.md` what a caller reads from where.
B3. A lint parse rejects what typescript-go rejects, with the reference's code (list of the typecheck unit,
    `/workspace/notes/lint/units/typecheck/NEEDS.md`, L2: `a + b = c`, `-a = b`, `a++ = b`, `await x = y`,
    `a++ ++`, `a--.b`, `++ delete a.b`, `new A?.b()`, `yield*` without an operand, `a.` before a line, and
    `for (using of of [])`). A parse without lint stays as it is.
B4. The list "Not done" of your `API.md` ("Syntax errors of a lint parse"): the checks outside the type grammar
    (TS1477, TS17007, TS17006, TS1209, TS18030, TS2754, TS1034, TS2880, TS1357, TS1260, TS1011), strict reading
    of class members, parameters and heritage clauses, an error in the first token of a file.
B5. Tests in `bun:test` that reach a lint parse through the command: `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1
    bun --lint <file>` exists now (`src/runtime/cli/lint_command.rs`, owner: cli). The cli unit switches it to
    `parse_for_lint_with_codes` for TypeScript. Until then, your Rust tests are the coverage: keep
    `cargo test -p bun_js_parser --lib` green and say in `API.md` which command runs which test.

## Always

- The nine older test files of parser.md P1.6 and your four `typescript-grammar*.test.ts` files pass, also with
  the leak check of CI: `BUN_DESTRUCT_VM_ON_EXIT=1
  ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1
  LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$PWD/test/leaksan.supp bun bd test <file>`.
- A value that an arena node holds owns no heap memory (no `Vec`, `Box`, `String` inside a node or a record of
  the side table): an arena never drops it.
