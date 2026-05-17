# EXP-111 Source-Scope Correction

**Date:** 2026-05-16
**Reviewer:** Codex
**Verdict impact:** EXP-111 remains `CONFIRMED_UB`, but the remediation scope is broader than "flip `Renamer<'r>` from `&mut` to `&`".

## Correction

The existing EXP-111 evidence is real, but the old wording under-scoped the cause.

The default-Miri witness fails at concurrent `&mut Chunk` retags:

```text
error: Undefined Behavior: Data race detected between (1) retag write on thread `unnamed-1`
and (2) retag write of type `Chunk<'_>` on thread `unnamed-2`
```

That means the witness proves the worker fan-out's whole-`Chunk` mutable reborrow shape. It does **not** isolate `ChunkRenamer` as the only cause.

## Source Facts

- `generate_compile_result_for_js_chunk` says the callback "never forms `&mut LinkerContext`" at `src/bundler/linker_context/generateCompileResultForJSChunk.rs:21-23`, but then forms both `&mut LinkerContext` and `&mut Chunk` at `:60-68`.
- `generate_compile_result_for_css_chunk` says the same at `src/bundler/linker_context/generateCompileResultForCssChunk.rs:18-20`, but then forms both mutable references at `:44-47`.
- `generate_code_for_file_in_chunk_js` still takes `c: &mut LinkerContext` and `chunk: &mut Chunk` at `src/bundler/linker_context/generateCodeForFileInChunkJS.rs:30-35`.
- `ChunkRenamer::as_renamer(&mut self)` produces `Renamer<'_, '_>` from a mutable `ChunkRenamer` view at `src/bundler/ungate_support.rs:498-506`.
- `Renamer<'r, 'src>` variants still hold `&mut {Number,NoOp,Minify}Renamer` at `src/js_printer/renamer.rs:96-116`.
- `MinifyRenamer::name_for_symbol` and `NumberRenamer::name_for_symbol` call `symbols.follow()` (`src/js_printer/renamer.rs:257-258,825-830`).
- `SymbolMap::follow()` mutates path-compression links through `Cell` at `src/ast/symbol.rs:667-727`.
- `LinkerContext::link()` calls `self.graph.symbols.follow_all()` before returning chunks at `src/bundler/LinkerContext.rs:913`, which may make worker-time `follow()` store-free. That invariant must be proved or replaced with a no-compress follow path.

## Correct Remediation Scope

Do not claim EXP-111 is closed by a renamer-only patch.

A defensible fix must:

1. Stop part-range worker callbacks from materializing concurrent whole-owner `&mut LinkerContext` / `&mut Chunk` references.
2. Keep the existing narrow write design: `CompileResultSlots` for per-task output slots and atomic RMW for byte counters.
3. Change the fan-out renamer view to shared/read-only, or use per-worker owned renamer snapshots.
4. Prove worker-time symbol lookup cannot path-compress in parallel, either by proving `follow_all()` fully compressed all paths before codegen or by using a no-compress read-only follow function.

## Artifact Changes Made

- `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`: EXP-111 title, hypothesis, falsifiability, and remediation notes updated.
- `phase4_unified_findings.md`: F-010b updated to describe EXP-111 as the `Chunk` / renamer-specific subcase of the EXP-010 fan-out family.
- `FINAL_UB_REPORT.md`: F-010b row and top EXP-111 summary updated.
- `phase8_remediation_plan.md`: R-EXP-111 rewritten so the winning fix removes concurrent whole-owner `&mut` worker entries before claiming the renamer fix closes the bug.
- `UB_RUNBOOK.md`: follow-up instructions now warn that a renamer-only patch is incomplete.

