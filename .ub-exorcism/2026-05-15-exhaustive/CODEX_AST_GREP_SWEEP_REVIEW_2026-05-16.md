# Codex ast-grep UB Sweep Review — 2026-05-16

This is a triage layer over the raw skill detector output in
`phase3_raw/codex_ast_grep_ub_patterns_2026-05-16.txt`. Codex later reran the
same skill detector directly and captured the equivalent output at
`phase2_raw/codex_ast_grep_ub_patterns_2026-05-16.log`.

The important rule: **ast-grep hits are candidates, not verdicts**. This pass is
for preventing two opposite mistakes:

1. promoting broad detector noise into public claims, and
2. missing precise detector hits that deserve a Phase-5 experiment.

## Detector Summary

| Pattern | Warnings | Files | Triage |
|---|---:|---:|---|
| `alignment-repr-packed-field-ref` | 6,887 | 623 | Too broad for verdicts; treat as a filter only. Rust's E0793 and the existing packed-type audit are better signals. |
| `lifetime-escape-as-ptr` | 3,067 | 455 | Huge surface; already partially represented by F-L-* clusters. Needs source-specific lifetime proof, not bulk promotion. |
| `atomic-relaxed-load-store` | 391 | 84 | Bucket-7 already spot-checked the most relevant publication surfaces. Keep as Phase-11 queue input. |
| `set-len` | 77 | 34 | High-value detector. EXP-005/034/036 already prove the dangerous class. Remaining hits need per-call "initialized before set_len" checks. |
| `refcount-from-raw` | 25 | 16 | Mostly lifecycle chokepoints; Bucket-13 has one confirmed Phase-5 closure: EXP-056 zero-ref `NodeHTTPResponse` deallocation through shared provenance. |
| `slice-from-raw-parts` | 21 | 7 | Already overlaps EXP-004 / SQLDataCell / StringBuilder surfaces. Triage by allocation ownership and alignment. |
| `type-punning-transmute` | 17 | 15 | High-value; already maps to EXP-002/006/035/051 plus lifetime-transmute cluster. |
| `get-unchecked` | 14 | 6 | High-value; EXP-007/008/009 cover confirmed hostile-input shapes. Remaining hits need bounds-source proof. |
| `aliasing-cast-ref-to-mut` | 5 | 4 | Small enough to review manually; no new registry promotion yet. |
| `aliasing-deref-while-borrowed` | 5 | 5 | Small enough to review manually; 3 already mapped to Phase-4 rows. |
| zero-hit detectors | 0 | n/a | `pin-new-unchecked`, `await-holding-mutex`, `async-drop-block-on`, `raw-fd-without-OwnedFd`, etc. are useful negative findings. |

## Manual Review: `aliasing-cast-ref-to-mut` (5 hits)

| Site | Source-shape verdict | Action |
|---|---|---|
| `src/jsc/bun_string_jsc.rs:77` | FFI mutability mismatch: `&JSGlobalObject` passed to C++ as `*mut JSGlobalObject`. Not a Rust `&mut` unless C++ mutates through it; this is an FFI contract issue, not an automatic aliasing verdict. | Add to FFI-constness hardening queue; do not count as UB without C++ side-effect proof. |
| `src/jsc/JSGlobalObject.rs:183` | Same C++ ABI constness hole for `Bun__msToGregorianDateTime`. Function appears date-conversion / out-param oriented; global object may be logically shared. | Hardening: expose a `*const JSGlobalObject` binding if C++ does not mutate. No registry entry yet. |
| `src/runtime/webview/HostProcess.rs:94` | `&'static VirtualMachine` cast to `*mut` for WebView host spawn path. This is JS-thread / event-loop-affinity contract territory. | Phase-11 follow-up: verify `spawn` only uses the VM through owning-thread event-loop APIs. |
| `src/runtime/webcore/blob/copy_file.rs:1580` and `:1666` | `CopyFileWindows.event_loop: &EventLoop` cast to `*mut EventLoop` for `EventLoop::enter_scope`, which mutates `entered_event_loop_count`. The source comment says VM-owned event loop is process-lifetime, but the type is a shared reference. | **Promoted to EXP-073.** Default Miri and Tree Borrows both reject the exact shared-reference-to-mutable-enter-scope shape. The sibling `WriteFileWindows` already stores `*mut EventLoop`, which is the isomorphic fix model. |

## Manual Review: `aliasing-deref-while-borrowed` (5 hits)

| Site | Source-shape verdict | Action |
|---|---|---|
| `src/bundler/linker_context/doStep5.rs:694` | Already tracked as F-A-4. Follow-up source audit proves the current window is initialized: `stmts_count` is the exact write budget, `all_export_stmts_base` is captured after per-export writes, and the three conditional trailing terms each emit one statement before the cast. | Demote to `DEFENSIBLE-BUT-BRITTLE` / `REVIEWED`; no EXP until a real missing-write path is found. |
| `src/bun_core/util.rs:747` | Central `WStr::from_raw_mut(ptr, len) -> &mut WStr`. This is an `unsafe fn` whose precondition includes writability and NUL termination. `WStr` is verified `#[repr(transparent)] pub struct WStr([u16])`, so the slice-to-newtype reborrow is layout-valid. | No registry entry; keep as library contract, not a UB finding. |
| `src/runtime/webcore/Sink.rs:1232` | Already covered by EXP-048 strict-provenance cluster: tag-bit integer round-trip then `&mut Subprocess`. | No new entry; keep strict-provenance framing, not default-runtime UB. |
| `src/jsc/TopExceptionScope.rs:497-498` | Already tracked as F-A-5. Follow-up source audit shows this is defensible: under `cfg(any(debug_assertions, bun_asan))`, `ExceptionValidationScope` has exactly one non-ZST field (`scope: TopExceptionScope`), and the in-source const assertion proves equal size/alignment, which forces field offset 0. `MaybeUninit<T>` preserves layout. | Demote to `DEFENSIBLE-LAYOUT-PUN` / `REVIEWED`; do not count as UB. |
| `src/ini/lib.rs:1361` | Already tracked as F-A-6 / unregistered lifetime-transmute cluster. Follow-up source audit confirms the local parser drops before return; `DotEnvLoader::get()` only lends owned map bytes; parser substitutions copy into the parser arena; and every value that survives `load_npmrc()` is boxed/owned. | Demoted to contractual lifetime-erasure / auditability refactor. Do not count as live UB and do not cite unused EXP-024. |

## New Work Items From This Sweep

1. **Do not add new `CONFIRMED_UB` counts from the broad alignment detector.**
   The 6,887 hits are intentionally noisy and mostly ordinary field references.

2. **Split the lifetime-transmute cluster by evidence.**
   `src/ini/lib.rs:1361` is source-audited and demoted. The CSS result-type
   pair (`src/css/css_parser.rs:2718,2723`) is now EXP-077 with a default-Miri
   dangling-reference witness for the safe-API shape; reviewed in-tree callers
   only read `result.code`, so production reachability remains caller-dependent.
   `bun_alloc::Mutex` is already EXP-059; the resolver / transpiler worker
   lifetime wideners are contractual proof obligations, not counted live UB
   without a worker-teardown / arena-reset witness.

3. **EXP-073 now covers the focused EventLoop aliasing experiment.**
   The `CopyFileWindows` `&EventLoop -> *mut EventLoop` sites are small and
   source-specific enough for default-Miri + Tree-Borrows proof; the harness
   mirrors the exact stored-`&EventLoop` then mutable-`enter_scope` shape.

4. **Use the detector output as the Phase-11 candidate queue.**
   The raw file is 84,757 lines; it should not be published as a finding list.
   Public claims should only come from rows that have source-specific proof,
   Miri/loom/TSan output, or an explicit caveat such as `DEFERRED`,
   `NO_EVIDENCE`, or a source-specific follow-up condition.

## Artifact Corrections Applied In This Pass

- `EXP-017` was later demoted to `NO_EVIDENCE` for current production source.
  The primitive Miri race model is real, but the source-overlap audit found no
  current path that rewrites the callback after queue publication. It remains a
  regression guard, not a counted production-UB finding.
- `EXP-056` was later promoted to `CONFIRMED_UB` by a source-shaped Miri
  witness. The `NodeHTTPResponse` `AnyRefCounted` bridge is not merely
  "Cell-only"; zero-count `deref()` calls
  `deinit()` and frees the allocation through `self.as_ctx_ptr()`. The report
  now points at `EXP-056-shared-dealloc.log` and no longer treats this as an
  open witness obligation.
- `phase4_unified_findings.md` and `FINAL_UB_REPORT.md` were reconciled with
  the registry: direct EXP rows no longer disagree with registry verdicts.
