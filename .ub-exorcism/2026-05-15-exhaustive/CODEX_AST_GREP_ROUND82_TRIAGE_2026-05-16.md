# Codex ast-grep Round-82 Triage — 2026-05-16

Scope: fresh run of the skill's bundled ast-grep UB pattern suite against current `src/` after the registry had converged through round 81.

Raw output:

- `phase2_raw/codex_ast_grep_ub_patterns_round82_2026-05-16.log`
- 84,757 lines

## Pattern Counts

Counts below are approximate location-line counts from the raw ast-grep output. They are used for prioritization, not as a source-of-truth finding count.

| Pattern | Hits | Triage |
|---|---:|---|
| `aliasing-cast-ref-to-mut` | 5 | Covered by existing aliasing/callback entries or FFI const-cast review; no new EXP |
| `aliasing-deref-while-borrowed` | 5 | Covered by EXP-077 / EXP-048 family / F-A-5 layout-pun review / lifetime-erasure rows; no new EXP |
| `alignment-repr-packed-field-ref` | 6887 | Broad false-positive-heavy pattern; alignment findings already narrowed to EXP-004/088/093/095 plus hardening clusters |
| `atomic-relaxed-load-store` | 391 | Already covered by atomic discipline notes; no new too-weak ordering surfaced in this triage |
| `float-from-int-bits` | 11 | Advisory only; safe Rust, not UB |
| `get-unchecked` | 14 | Existing owners include EXP-007 / EXP-008 / EXP-009 / sourcemap hardening; no unregistered high-confidence miss |
| `manual-Allocator-impl` | 6 | Existing allocator-layout findings are EXP-004/091/092; remaining allocator impls are structural hardening |
| `repr-Rust-transmute` / `type-punning-transmute` | 17 | Covered by phase2 type-punning table; live owners include EXP-002/051/077 plus reviewed fn-pointer/POD cases |
| `send-sync-manual-impl` | 146 | Covered by Bucket 8, EXP-019/045/080/082/083/084, plus hardening-only siblings |
| `set-len` | 77 | Covered by uninit/set_len sweeps and EXP-005/078/090; no new promoted site |
| `slice-from-raw-parts` | 21 | Covered by provenance/alignment buckets; no new promoted site |
| `uninit-maybeuninit-assume-init` | 4 | Covered by EXP-089 or documented sound `[MaybeUninit<T>; N]` construction |
| `uninit-mem-zeroed-uninit` | 6 | Already reviewed as zero-valid FFI/POD or hardening; no new EXP |
| `utf8-as-bytes-index` | 16 | Not UB by itself. These are byte-oriented path/package/shell operations or correctness hardening, not invalid `str` construction. |

## High-Signal Spot Checks

### `aliasing-cast-ref-to-mut`

Hits:

- `runtime/webview/HostProcess.rs:94` — `global.bun_vm() as *const _ as *mut _`
- `runtime/webcore/blob/copy_file.rs:1580,1666` — `EventLoop::enter_scope(self.event_loop as *const _ as *mut _)`
- `jsc/bun_string_jsc.rs:77` — `JSGlobalObject` const-to-mut for C++ out-call
- `jsc/JSGlobalObject.rs:183` — same C++ FFI shape

Triage: the `copy_file` event-loop casts are in the same family as EXP-073/074/076-style event-loop mutation through shared provenance and should be handled when that remediation pattern lands. The JSC/global-object casts are FFI const-cast review items: C++ takes a mutable pointer for legacy ABI reasons, while Rust only has a shared JSGlobalObject handle at the call site. This triage did **not** prove a fresh production reborrow violation distinct from the existing aliasing rows.

### `aliasing-deref-while-borrowed`

Hits:

- `ini/lib.rs:1361` — lifetime widening to `DotEnvLoader<'static>`
- `bun_core/util.rs:747` — `WStr` slice reinterpretation
- `bundler/linker_context/doStep5.rs:694` — `[MaybeUninit<Stmt>] -> [Stmt]`
- `runtime/webcore/Sink.rs:1232` — `TaggedPtrUnion::as_uintptr()` adjacent to EXP-048
- `jsc/TopExceptionScope.rs:497` — layout-pun reviewed as F-A-5

Triage: all five have existing owners. The CSS/INI/static-lifetime family is covered by EXP-077 / lifetime-erasure rows; `Sink.rs` is explicitly adjacent to EXP-048 but not closed by the central helper; `TopExceptionScope` is reviewed in F-A-5 with size/alignment and single-field-layout reasoning.

### `uninit-maybeuninit-assume-init`

Hits:

- `sql_jsc/shared/CachedStructure.rs:58` — sound `[MaybeUninit<ExternColumnIdentifier>; 70]` construction; the element type is `MaybeUninit`, so the outer array has no initialized-element requirement.
- `bun_core/util.rs:1003`, `:1050` — `PathBuffer::uninit` / `WPathBuffer::uninit`, already EXP-089.
- `install/lockfile/Tree.rs:91` — `DepthBuf` scratch array, already EXP-089.

No new EXP.

### `repr-Rust-transmute` / `type-punning-transmute`

Representative hits were cross-checked against `phase2_findings_06_type_punning.md`:

- BoringSSL `sk_GENERAL_NAME_free_func` function-pointer erasure — reviewed ABI-identical callback pointer.
- `event_loop/AnyTask.rs:69` — reviewed function-pointer erasure over `*mut T` / `*mut c_void`.
- `sys/linux_syscall.rs:209` — reviewed POD `rustix::fs::Stat` / `libc::stat` with size/alignment and field-offset checks.
- `css/css_parser.rs:2718/2723` — EXP-077.
- `errno/linux_errno.rs:192` — EXP-002.
- `runtime/image/backend_wic.rs:923` — reviewed Windows `GetProcAddress` function-pointer cast.
- `packages/bun-native-plugin-rs/src/lib.rs:637` is not under `src/`, but remains the public-FFI owner for EXP-051 in the wider audit.

No new EXP.

## Artifact Changes From This Triage

- Added this triage document.
- Added raw detector output at `phase2_raw/codex_ast_grep_ub_patterns_round82_2026-05-16.log`.
- Corrected the Phase-4 header from `EXP-001..EXP-095` to `EXP-001..EXP-096`.
- Corrected the final-report Phase-5 log count from 110 to 111 and included EXP-096 in the evidence-set sentence.

## Bottom Line

The fresh detector run increased confidence rather than increasing the bug count. The only new substantive issue from this current detector cycle remains EXP-096, and it is correctly scoped as `DEFERRED` strict-provenance release-gate work, not default-runtime UB.
