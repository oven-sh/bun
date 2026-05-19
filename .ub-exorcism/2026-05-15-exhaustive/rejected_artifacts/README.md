# Rejected / Quarantined Artifacts

This directory holds generated artifacts that should **not** be committed to
Bun source without a fresh maintainer-facing rewrite.

## `ffi-bare-jsvalue-regression.test.ts`

Quarantined on 2026-05-16 during Codex review.

Reasons:

- It repeated the old EXP-109 hypothesis after the source-root graph disproved
  that hypothesis for the production `JSCallback` path.
- It created a new `test/js/bun/ffi/*.test.ts` file even though `AGENTS.md`
  says tests should be added to the existing file for the touched module by
  default.
- It modeled "save raw `ptr`, let the `JSCallback` object fall out of scope,
  then call through the raw pointer" as a Bun bug. That is not the source-root
  question. Current source shows a live `JSCallback.#ctx` owns a heap
  `Function`, which owns `FFICallbackFunctionWrapper`, which owns
  `JSC::Strong<JSFunction>` and `JSC::Strong<GlobalObject>`.
- It should be replaced, if desired, by a small regression guard inside the
  existing `bun:ffi` test file proving that a live `JSCallback` remains callable
  after forced GC.

Canonical correction:

- `../CODEX_EXP109_ROOT_GRAPH_CORRECTION_2026-05-16.md`
- `../UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` § EXP-109
