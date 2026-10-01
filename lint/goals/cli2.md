# Unit "cli", round 2: TypeScript files, runnable tests, the rest of ESLint's recommended rules

Read `/workspace/notes/lint/goals/COMMON.md` first, then `/workspace/notes/lint/goals/cli.md` (round 1: what you
own, the milestones C1 to C3). This file says where the work stands and what is left.

- Worktree: `/workspace/wt/cli`. Branch: `robobun/abbc0c92/lint-cli`. Push it after every commit:
  `git push origin HEAD:robobun/abbc0c92/lint-cli`.
- Notes: `/workspace/notes/lint/units/cli/` (`API.md`, `NEEDS.md`, `LOG.md`). Save them with
  `/workspace/tools/save-notes "cli: <what>"`.

## Where the work stands (verified by the integrator on 2026-09-30)

Round 1 wrote C1, C2 and ten of the eleven rules of C3 in 50 commits and ran none of them in the worktree. They
are merged into the pull request branch, and the unit branch equals that branch. First execution:
- The debug build passes after two additions of the integrator (commit `4d06830629`): the file
  `src/lint/rules/no_debugger.rs`, which `rules/mod.rs` declared and nobody had written, and the three match arms
  for `Metadata::Code` of your `NEEDS.md` X2 (`src/jsc/VirtualMachine.rs`, `src/jsc/lib.rs`,
  `src/runtime/server/DevErrorPage.rs`).
- `test/cli/lint/lint.test.ts` 61 pass, `diagnostics.test.ts` 17 pass, `rules.test.ts` 11 pass,
  `test/cli/run/as-node.test.ts` 13 pass, `test/cli/env/bun-options.test.ts` 12 pass. `cargo clippy` and
  `cargo check --all-targets` are clean for `bun_lint`. CI of the pull request builds on every platform.
- `cargo test -p bun_lint --lib` does NOT link: undefined symbols `highway_count_char`,
  `highway_last_index_of_char`, `highway_index_of_any_char`, `highway_index_of_char`, `highway_memmem`,
  `simdutf__validate_ascii`. So the Rust tests of `src/lint` have never run in the real workspace.
- `Parser::parse_for_lint` and `Parser::parse_for_lint_with_codes` exist now (`src/js_parser/parse/parse_entry.rs`,
  owner: parser, see `/workspace/notes/lint/units/parser/API.md`). `bun --lint` does not call them yet.

## What is left, in this order

D1. The Rust tests of `src/lint` run. Either give the test binary of `bun_lint` the stand-ins it needs (the parser
    unit did that for its crate in `src/js_parser/native_test_shims.rs`, read `API.md` of the parser, "How the
    tests of the parser run"; a crate cannot use the `#[cfg(test)]` items of another crate, so decide between a
    small shared test-support crate and a copy, and say why), or move what those tests check into `bun:test`
    files and delete them. Then `cargo test -p bun_lint --lib` passes in the worktree and your `API.md` names
    the command. Answer `NEEDS.md` X3 yourself after that: say whether `bun_lint` can be in `MIRI_CRATES`.
D2. TypeScript files go through `Parser::parse_for_lint_with_codes`.
    - A syntax error of a `.ts`, `.tsx`, `.mts`, `.cts` or declaration file prints with the code of tsc, in both
      formats: `file.ts(1,7): error TS1005: ';' expected.` Where the parser has no code for a message, say in
      `API.md` what is printed.
    - The rules run on TypeScript and TSX files, on the tree as written (`ParsedForLint::stmts`). Each rule must
      be right on TypeScript syntax: a rule that compares or reports an expression has to know that `x as T`,
      `x!`, `<T>x`, `x satisfies T` and parentheses leave no node, and read the side table where ESLint's
      answer depends on them (`ParsedForLint::sidecar`, the wrapper records). Add TypeScript cases to the fixture
      of every rule, with typescript-eslint's behaviour as the expectation where it differs from ESLint's.
    - Tests: TypeScript cases in `test/cli/lint/lint.test.ts` and in the rule fixtures.
D3. The rest of ESLint's `eslint:recommended` set that needs neither types nor variable scopes, by the method of
    round 1 (one module per rule named as ESLint names it, ESLint's own valid and invalid cases as the fixture,
    every deliberate difference in `API.md`): `for-direction`, `getter-return`, `no-async-promise-executor`,
    `no-case-declarations`, `no-cond-assign`, `no-constant-binary-expression`, `no-constant-condition`,
    `no-control-regex`, `no-delete-var`, `no-dupe-else-if`, `no-empty`, `no-empty-character-class`,
    `no-empty-static-block`, `no-extra-boolean-cast`, `no-fallthrough`, `no-invalid-regexp`,
    `no-irregular-whitespace`, `no-loss-of-precision`, `no-misleading-character-class`,
    `no-nonoctal-decimal-escape`, `no-octal`, `no-prototype-builtins`, `no-regex-spaces`, `no-setter-return`,
    `no-unexpected-multiline`, `no-unsafe-finally`, `no-unsafe-optional-chaining`, `no-unused-labels`,
    `no-useless-backreference`, `no-useless-catch`, `no-useless-escape`, `no-with`, `require-yield`.
    A rule that needs comments (`no-fallthrough`, `no-empty`, `no-irregular-whitespace`) waits until the parser
    records them (its round 2, B1): note it in `NEEDS.md` and go on with the others.
D4. After D3: the rules of `eslint:recommended` that need to know which declaration a name refers to
    (`constructor-super`, `no-class-assign`, `no-const-assign`, `no-dupe-args`, `no-ex-assign`, `no-func-assign`,
    `no-global-assign`, `no-import-assign`, `no-new-native-nonconstructor`, `no-obj-calls`, `no-redeclare`,
    `no-shadow-restricted-names`, `no-this-before-super`, `no-undef`, `no-unreachable`,
    `no-unused-private-class-members`, `no-unused-vars`). The tree as written has the scopes and the declared
    symbols of the parse pass and unbound references. Design the name resolution once, inside `bun_lint`, reading
    `ParsedForLint::scopes_in_order` and `symbols` without writing them, write it down in `API.md`, then add the
    rules. The type checker will have its own binder: do not wait for it.

## Always

- Every test file of round 1 keeps passing, also with the leak check of CI (`BUN_DESTRUCT_VM_ON_EXIT=1
  ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1
  LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$PWD/test/leaksan.supp`).
- No new flag, no configuration file, no suppression comments: they are not asked for yet.
- The plain format that `bun --lint` prints is the contract of the conformance runner (your `API.md`, "What
  `bun --lint` prints"). Change it only together with that section.
