# Codex Ast-Grep Round 115 Refresh — 2026-05-16

**Purpose:** rerun the UB skill's bundled `ast-grep` pattern pack after the
EXP-106 promotion and W4 wording refresh, then map signals to existing EXP
owners instead of inflating the registry.

**Command:**

```sh
/home/ubuntu/.codex/skills/rust-undefined-behavior-exorcist/scripts/ast-grep-ub-patterns.sh \
  /data/projects/bun/src \
  > /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase2_raw/codex_ast_grep_ub_patterns_round115_2026-05-16.log 2>&1
```

**Raw output:** `phase2_raw/codex_ast_grep_ub_patterns_round115_2026-05-16.log`
(84,757 lines, ~6 MB). **Dropped from the PR** to keep the diff
reviewable; the triage table below preserves every actionable signal.
To regenerate, rerun the command above against `origin/main@4d443e5402`.

## Pattern Counts

| Pattern | Hits | Triage |
|---|---:|---|
| `alignment-repr-packed-field-ref` | 6,887 | Broad starting filter. Most are ordinary field references; rustc E0793 is the real hard gate for packed-field references. Do not treat this count as findings. |
| `lifetime-escape-as-ptr` | 3,067 | Broad starting filter. Existing lifetime-erasure findings are already split between confirmed EXPs (e.g. EXP-077) and reviewed/demoted contractual sites. |
| `atomic-relaxed-load-store` | 391 | Already covered by the atomic discipline audit; no fresh too-weak ordering signal from this rerun. |
| `send-sync-manual-impl` | 146 | Existing Send/Sync bucket owner. Confirmed entries include EXP-018/019/082/083/084/098; many remaining rows are documented marker/FFI cases. |
| `set-len` | 77 | Existing uninit / capacity bucket owner. Confirmed entries include EXP-005/034/078; many remaining rows are FFI-buffer capacity patterns already covered in Phase 2. |
| `refcount-from-raw` | 25 | Existing refcount bucket owner; no new unpaired owner found from this raw grep alone. |
| `slice-from-raw-parts` | 21 | Existing slice/provenance bucket owner; use per-site source proof, not raw count. |
| `repr-Rust-transmute` / `type-punning-transmute` | 17 each | Existing validity/type-punning bucket owner. Confirmed entries include EXP-002/097; several rows are reviewed FFI/layout casts. |
| `get-unchecked` | 14 | Existing owner: EXP-007/008/009 for the confirmed attacker-controlled paths. Other rows need bounds-source proof before promotion. |
| `uninit-*` | 10 total | Existing owner: EXP-001/078 plus reviewed `MaybeUninit` windows. |
| `aliasing-cast-ref-to-mut` | 5 | High-signal subset; fully mapped below. |
| `aliasing-deref-while-borrowed` | 5 | High-signal subset; fully mapped below. |

## High-Signal Aliasing Subset

### `aliasing-cast-ref-to-mut` (5 hits)

| Site | Round-115 disposition |
|---|---|
| `src/runtime/webcore/blob/copy_file.rs:1580` | Already **EXP-073**: `CopyFileWindows.event_loop: &EventLoop` cast to `*mut EventLoop` and passed to mutating `EventLoop::enter_scope`. Default Miri + Tree-Borrows witnesses exist. |
| `src/runtime/webcore/blob/copy_file.rs:1666` | Same as above; second call path for EXP-073. |
| `src/runtime/webview/HostProcess.rs:94` | Existing hardening queue from round 82: `&'static VirtualMachine` cast to `*mut` for WebView host spawn. This is JS-thread / event-loop-affinity contract territory. No C/Rust side-effect proof yet; do not count as UB. |
| `src/jsc/JSGlobalObject.rs:183` | Existing FFI constness hardening queue: C++ ABI takes mutable `JSGlobalObject*` for date conversion / out-params. No proof that C++ mutates through the global object pointer. |
| `src/jsc/bun_string_jsc.rs:77` | Same FFI constness class for `BunString__fromJS`. Needs C++ side-effect proof before promotion. |

### `aliasing-deref-while-borrowed` (5 hits)

| Site | Round-115 disposition |
|---|---|
| `src/runtime/webcore/Sink.rs:1232` | Already `F-A-1` / EXP-048-adjacent strict-provenance row: `TaggedPtrUnion::as_uintptr()` returns integer bits, then source forms `&mut Subprocess`. Deferred strict-provenance migration; not new default-runtime UB. |
| `src/bun_core/util.rs:747` | Already `F-A-3`, reviewed/demoted. `WStr` is `#[repr(transparent)]` over `[u16]`; remaining obligations are the explicit `unsafe fn` caller contract. |
| `src/bundler/linker_context/doStep5.rs:694` | Already `F-A-4`, reviewed/demoted. Source audit proved the `MaybeUninit<Stmt>` window is initialized for the sliced region. Brittle but not current UB. |
| `src/jsc/TopExceptionScope.rs:497` | Already `F-A-5`, reviewed/demoted. Single-field layout plus const size/alignment assertion makes the `MaybeUninit` storage pun defensible under the relevant cfg. |
| `src/ini/lib.rs:1361` | Already `F-A-6`, reviewed/demoted. `load_npmrc()` drops the parser before return and surviving data is boxed/owned. |

## Verdict

No new EXP entry from this refresh.

This rerun is useful because it verifies that the bundled skill detector pack
still points at the same high-signal aliasing sites, and every high-signal site
has a current owner: confirmed EXP, deferred strict-provenance migration,
reviewed/demoted contractual site, or FFI constness hardening queue.

The raw counts are **not** public-facing finding counts. They are detector
hits. This note's then-current registry count (103 EXP entries, 68
`CONFIRMED_UB`) was superseded by later EXP-109/110/111 normalization and
fresh-eyes corrections. Use `FINAL_UB_REPORT.md` for the current public count:
106 registry entries, 70 `CONFIRMED_UB`, 0 `OPEN`, 0 `NEEDS_REFINEMENT`.
