# Codex Review — Phase 1 Section M

Run: `2026-05-15-exhaustive`

Scope reviewed:
- `phase1_inventory_M.md`
- `phase1_notes/M_bundler_transpiler.md`
- EXP-010 in `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`
- Current source around the bundler parallel-codegen paths

## Corrections applied

1. **Fixed the `SymbolMap::follow()` conceptual error.**
   Section M was still too close to the old "printer is read-only" framing.
   Current `src/ast/symbol.rs:667-727` shows `SymbolMap::follow()` performs
   path compression through `Cell`. That means a fix that merely changes
   `&mut LinkerContext` / `Renamer<'r>` to shared borrows is incomplete unless
   it also proves prior `follow_all()` made every later `follow()` store-free,
   or introduces a no-compress/read-only follow path for parallel codegen.

2. **Updated EXP-010 remediation notes.**
   The registry now records the follow/path-compression proof obligation so
   future remediation agents do not apply the tempting but incomplete
   `&mut -> &` rewrite.

3. **Kept the high-confidence structural finding.**
   `generateCompileResultForJSChunk.rs:61-62`,
   `generateCompileResultForCssChunk.rs:45-46`,
   `prepareCssAstsForChunk.rs:76-80`, and
   `GenerateChunkCtx::c()` still materialize aliased `&mut` references across
   parallel worker tasks. The correction above does not demote EXP-010; it makes
   the eventual fix plan accurate.

## Source checks run

- Re-read `src/bundler/Chunk.rs:121-132`: existing TODO still names the
  aliased `Renamer<'r>` problem.
- Re-read `src/ast/symbol.rs:643-727`: `follow_all()` and `follow()` both write
  `Symbol::link` through `Cell`; `follow()` is not read-only.
- Re-read `src/bundler/linker_context/generateCompileResultForJSChunk.rs:54-74`
  and `generateCompileResultForCssChunk.rs:38-53`: both form `&mut
  LinkerContext` and `&mut Chunk` in worker callbacks.
- Re-read `src/bundler/linker_context/prepareCssAstsForChunk.rs:72-80`: the CSS
  task keeps the `&mut LinkerContext` issue; the per-chunk `&mut Chunk` side is
  unique.
- Re-read `renameSymbolsInChunk.rs` and `doStep5.rs`: these remain the better
  raw-pointer/shared-borrow templates, but they are not enough unless symbol
  following is made store-free in the parallel path.

## Remaining review risk

EXP-010 now has a minimized Tree-Borrows model witness
(`experiments/EXP-010`, raw log
`phase5_experiment_results/EXP-010-tree-borrows-model.log`). Publication
wording should still say "Miri-confirmed model of the current source shape",
not "full integrated `bun build` Miri trace".
