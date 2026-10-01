## `bun_jsc` and `bun_runtime`: the three match arms that `Metadata::Code` forces (X2)

For the integrator. No unit owns the three files, and cli.md does not list them for this unit. Until the arms are
in, `bun_jsc` and `bun_runtime` of the branch `robobun/abbc0c92/lint-cli` do not compile.

The text: one arm in each file, in place of its arm for `Build`. As a patch it is
`c2-seam-arbitration/final/02-forced-arms.patch`, which has the call of the first two on a line of its own between
the braces. In the worktree `git apply --check` of it passes at `7587bce918`, so this lands the three:
`git apply /workspace/notes/lint/units/cli/c2-seam-arbitration/final/02-forced-arms.patch`

- `src/jsc/VirtualMachine.rs`, line 3612, the closure `msg_to_js` of `process_fetch_log`. In place of
  `bun_ast::Metadata::Build => BuildMessage::create(global_this, msg),`:
  `bun_ast::Metadata::Build | bun_ast::Metadata::Code(_) => { BuildMessage::create(global_this, msg) }`
- `src/jsc/lib.rs`, line 1379, `fn msg_to_js`. In place of
  `bun_ast::Metadata::Build => BuildMessage::create(global, msg.clone()),`:
  `bun_ast::Metadata::Build | bun_ast::Metadata::Code(_) => { BuildMessage::create(global, msg.clone()) }`
- `src/runtime/server/DevErrorPage.rs`, line 159, `fn write_message`. In place of `Metadata::Build => b"",`:
  `Metadata::Build | Metadata::Code(_) => b"",`

Each arm takes a message with a code as a build message.

Why: `src/ast/lib.rs` has `Metadata::Code(u32)` since `4d9b8e5139` (cli.md C2.1: the code is a third variant of
`Metadata`). These are the three matches on `bun_ast::Metadata` that have no `_` arm, so each is error E0004,
`Metadata::Code(_)` not covered. Without the two crates there is no `bun bd` and no `bun bd test`, and the job
`cargo clippy` of `.github/workflows/rust-lints.yml` fails (`cargo clippy --workspace --no-deps --keep-going` and
`cargo check --workspace --all-targets --keep-going`).

Decision: not applied in this unit, left to the integrator. COMMON.md rule 1 keeps a unit out of a file that is
not on its list, and this directory records no ruling that lets the unit edit the three files. So C2.1 is done in
`bun_ast` only and the workspace does not build. If the arms are refused, the variant cannot stay. The fallback is
a field `code: u32` on `Msg` (`c2-seam-arbitration/final/ALTERNATIVE-msg-code-field.patch`), which needs no file
outside this unit's list and is a departure from C2.1. That patch is against e3566be889 and does not apply at
`7587bce918`: the variant comes out first, and `src/lint/diagnostic.rs` (line 148) and the three tests of
`msg_code_tests` then read `msg.code` where they call `msg.code()`.

State at `7587bce918`:

- Read there, not compiled for this note: each of the three matches has an arm for `Build`, an arm for `Resolve`
  and no other. No commit after e3566be889 touches the three files.
- Reported by the review of `4d9b8e5139` and not run again for this note:
  `BUN_CODEGEN_DIR=/workspace/wt/cli/build/debug/codegen /workspace/tools/lk cargo check -p bun_jsc --message-format=short`
  in the worktree exits with 101 and has E0004 at `src/jsc/VirtualMachine.rs:3611:20` and at
  `src/jsc/lib.rs:1378:11`; `bun_runtime` is not reached. `cargo check -p bun_ast` exits with 0, so the assertion
  `size_of::<Msg>() == 152` holds.
- The research, in a copy of the workspace at e3566be889: without the arms E0004 at the three places
  (`c2-seam-arbitration/logs/shadow-neg1.log` and `shadow-neg2.log`, the third at
  `src/runtime/server/DevErrorPage.rs:157:34`); with them `cargo check -p bun_ast -p bun_jsc -p bun_runtime` exits
  with 0 (`shadow-check2.log`); with the fallback the workspace checks too (`shadow-alt.log`).
- To run once the arms are in: `/workspace/tools/lk cargo check -p bun_ast -p bun_jsc --message-format=short`.
  `-p bun_runtime` also needs `bun_lint` to compile, which waits for the rule modules that "State of the tree" of
  API.md lists as not in the tree.

## `scripts/rust-miri.ts`: add `bun_lint` to `MIRI_CRATES` (X3)

For the integrator. No unit owns the file.

The text: in `const MIRI_CRATES = [` (lines 39 to 57) the line `  "bun_lint",` after the line `  "bun_http_types",`
(the crates after `bun_hash` are in alphabetical order).

Why: CI runs the `#[test]`s of a crate only through `bun run rust:miri` (job `cargo miri test` of
`.github/workflows/rust-lints.yml`) and only for the crates of that list. `bun_ast` is in it, `bun_lint` is not.
For every other crate the job `cargo clippy` type-checks the tests (`cargo check --workspace --all-targets`) and
nothing runs them. So no CI job runs the tests of `src/lint`:

- `src/lint/tests.rs`, 14 tests across the modules: what no lint run reaches yet (a message chain in both formats
  and in the order, related information in another file, the number of a `Msg`, a message without a position or
  without a file, the four categories) and the order, both formats, the line map and the name of an operand on
  POSIX and on Windows.
- The tests inside `diagnostic.rs`, `diagnosticwriter.rs`, `program.rs`, `scanner.rs`, `tspath.rs`, `code_frame.rs`.

State at `acf29666d1`: run outside the tree only. A scratch workspace of two crates (a copy of `src/ast` with
`Metadata::Code`; `diagnostic.rs`, `diagnosticwriter.rs`, `program.rs`, `scanner.rs`, `tspath.rs`, `code_frame.rs`
and `tests.rs` of `src/lint` as they are in the tree; the lint tables of the workspace):
`MIRIFLAGS=-Zmiri-tree-borrows cargo miri test -p bun_lint --lib` 28 passed (the 14 of `tests.rs` and the 14 inside
the modules), 15 s; `cargo clippy -p bun_lint --all-targets --no-deps` clean. NOT run in the real workspace, where
`bun_lint` also holds the rule modules and depends on `bun_js_parser`.

For whoever adds a test: the source line of a coloured frame stays at most 32 bytes. A longer one reaches simdutf
through `bun_core::strings::is_all_ascii`, which Miri cannot call (a finding of the research of C2, not checked
again here).
