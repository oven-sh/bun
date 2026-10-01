# Unit "typecheck", round 2: make the port compile, every file of it

Read `/workspace/notes/lint/goals/COMMON.md` first, then `/workspace/notes/lint/goals/typecheck.md` (round 1: what
you own, the architecture, the rules of the port). This file says where the work stands and what is left.

- Worktree: `/workspace/wt/typecheck`. Branch: `robobun/abbc0c92/lint-typecheck`. Push it after every commit:
  `git push origin HEAD:robobun/abbc0c92/lint-typecheck`.
- Notes: `/workspace/notes/lint/units/typecheck/` (`API.md`, `NEEDS.md`, `PORT_STATUS.md`, and the scratch
  directories of round 1). Save them with `/workspace/tools/save-notes "typecheck: <what>"`.

## Where the work stands (verified by the integrator on 2026-09-30)

Round 1 translated typescript-go into 172 Rust files with 121,196 lines under `src/typecheck/` in 35 commits:
`ast` 24,302 lines, `checker` 59,077, `binder` 5,149, `printer` 4,822, `lowering` 4,573, `importer` 3,998,
`scanner` 3,954, `stringutil` 6,596, `core` 3,006, `tspath` 1,928, `jsnum` 1,713, and smaller ones.
`src/typecheck/lib.rs` is ONE comment line. It declares no module, so cargo compiles NONE of these files:
`python3 /workspace/notes/lint/tools/undeclared.py src/typecheck` prints "compiled by cargo: 1 of 172 files".
Some files were compiled alone with rustc in scratch crates (the leaf packages, the lowering, parts of `ast`).
The checker has never been compiled. The module `diagnostics`, which the files name as `crate::diagnostics`, is
not in the tree: a generated table is in the notes (`diagnostics-scratch/crate/diagnostics`).
`src/typecheck/Cargo.toml` has no dependency.

## The goal of this round

`sh /workspace/notes/lint/tools/typecheck-survey.sh` exits 0. That means: `cargo check -p bun_typecheck` passes
AND every `.rs` file under `src/typecheck/` is reached by a `mod` line from `lib.rs`. Nothing else counts.

## How to get there

1. Bottom-up, one layer at a time. Declare a layer in `lib.rs` (or in the `mod.rs` of its directory), make the
   crate compile, commit, push. Then the next layer. Never declare two layers in one step, except where they
   need each other. The order:
   1. `core`, `collections`, `jsnum`, `stringutil`, `tspath`
   2. `diagnostics` (bring the generated table and its generator script into the tree: 2,206 messages from
      `/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json` and
      typescript-go's `internal/diagnostics/extraDiagnosticMessages.json`, the extras win by code; a message has
      a stable id, a code, a category and a text), then `scanner`
   3. `ast`
   4. `evaluator`, `binder`
   5. `module`, `modulespecifiers`, `nodebuilder`, `pseudochecker`, `printer`
   6. `checker`
   7. `importer`, `lowering`
2. The files were written by many hands that did not compile against each other. Where two files disagree about
   a name, a signature or a type:
   - the contract of round 1 wins where it speaks (`API.md` and the directories `checker-data-model-contract/`
     and `node-table-id-contract/` of the notes);
   - else upstream wins: the Go name in snake_case, the Go parameter order, the Go result;
   - the provider is fixed to match, and the consumers follow. Do not add an adapter that keeps both spellings.
3. Fix a compile error by making the code say what upstream says. Open the Go function
   (`/workspace/ref/typescript-go/internal/...`, the file and line are in `PORT_STATUS.md` and in the comment at
   the head of each Rust file) and compare. Do NOT delete a function, empty its body, or replace it with
   `todo!()`, `unimplemented!()`, `unreachable!()` or a constant to get past an error. A callee that is not
   ported is a stand-in of the stand-in log (typecheck.md, K3), which records its name.
4. `src/typecheck/lib.rs` may carry `#![allow(dead_code)]` until `bun --lint` calls the checker. No other lint
   is switched off: unused imports, unused variables, unused `mut` and the clippy lints of the workspace are
   fixed. No `unsafe`. No `unwrap`, `expect`, `panic!` on a path that input can reach (typecheck.md, rules of
   the port): an upstream panic is an internal diagnostic plus a safe fallback.
5. Dependencies: add to `src/typecheck/Cargo.toml` what the code uses (`bun_ast`, `bun_js_parser`, `bun_core`,
   `bun_alloc`, `bun_collections`, and crates of `[workspace.dependencies]` such as `bitflags` or `smallvec`).
   No new crate from crates.io. Commit `Cargo.lock` with it.
6. Work in the real crate. `cargo check -p bun_typecheck --message-format=short` through
   `/workspace/tools/lk`, with a timeout of 3600000 ms. A file that compiles alone in a scratch crate and not in
   the real one is not done.
7. Commit by explicit path, in small steps, and push after every commit. Update `PORT_STATUS.md` (state
   `ported` now means: compiled by cargo in the real crate) and save the notes.
8. Comments: one line each. Keep the upstream comment that explains semantics as a one-line comment, drop the
   rest. No comment about this work, its steps or its tools.

## When the survey is green

Stop and report: the number of files and lines that cargo compiles, the stand-ins that the log still names (by
layer), the places where a contract was changed and why, and every function whose translation you doubt (with
the Go line). Tests, the test importer and the first diagnostic (typecheck.md, K4) are the next round.
