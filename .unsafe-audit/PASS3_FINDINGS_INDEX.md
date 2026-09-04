# Pass 3 — Consolidated Findings Index (FINAL + Codex Accuracy Corrections)

**Pass 3 complete.** All 10 deep-dive agents finished. ~10,229 lines of pass-3 plan content alone, plus the macro-template work and verification reproducers.

**Accuracy discipline:** T1 = confirmed/high-confidence patchable memory-safety bug. T2 = unsafe public-contract / architecture defect. T3 = latent watchlist. **P0 = highest-risk priority**; use "CVE-class" only when an untrusted external input reaches UB or concrete security impact through an ordinary user command.

**Codex review note (2026-05-15):** the raw agent totals below were useful triage output, but several Pass 3 entries were over-tiered. The corrected adjudication is in [CODEX_PASS3_FINAL_REVIEW.md](CODEX_PASS3_FINAL_REVIEW.md). The four install P0s remain high-confidence. The bundler B-1..B-5 group is promoted to confirmed high-confidence Stacked Borrows / Tree Borrows UB. The `UvHandle::close` transmute, the four JSC `pass3-ub-*` items, `pending_tasks`, `ThreadSafeRefCount::ref_`, `FetchTasklet::abort_task`, WebSocket deflate H3, `WeakPtrData`, `JsCell<T>`, and `RacyCell<T>` are demoted or reworded as described below. Do not use the raw "39 T1" count as a final marketing number.

**Supersession note:** this is a Pass-3 snapshot. The current public headline is the Pass-4/5 dashboard count: **40 T1/T1-equivalent entries**, with strict memory-safety bugs separated from explicitly-labelled non-memory-UB security items; critical crash-reliability items are tracked separately. Use [PASS4_FINDINGS_INDEX.md](PASS4_FINDINGS_INDEX.md), [PASS5_ACCURACY_SWEEP.md](PASS5_ACCURACY_SWEEP.md), and [audit/synthesis/PASS4-risk-scoring.md](audit/synthesis/PASS4-risk-scoring.md) for final public counts.

## Pass-3 agents completed

| Agent | Crate / topic | T1 + P0 | T2 | T3 | Plan |
|-------|---------------|--------:|---:|---:|------|
| P3-macro | Macro-template audit + macro expansion (8 crates) | 0 | 0 | 0 | [synthesis](audit/synthesis/PASS3-macro-template-audit.md), [survey](audit/synthesis/PASS3-macro-expanded-deep-dive.md) |
| P3-install | bun_install (525 sites) | **4 P0** + 3 P1 + 2 P2 | 0 | 4 | [plan](audit/plans/PASS3-bun-install-deep-dive.md) |
| P3-jsc | bun_jsc (745 sites) | 0 confirmed live UB after Codex review | 9 | 3 | [plan](audit/plans/PASS3-bun-jsc-deep-dive.md) |
| P3-uws-libuv | bun_uws_sys + bun_libuv_sys (386 sites) | 0 memory-safety T1 after Codex review | 5 | 15 | [plan](audit/plans/PASS3-uws-libuv-deep-dive.md) |
| P3-http | bun_http + bun_http_jsc (457 sites) | H9 confirmed UB + security hardening findings | 3 | 3 | [plan](audit/plans/PASS3-http-stack-deep-dive.md) |
| P3-bundler | bun_bundler (498 sites) | 5 same-shape + 1 | 4 | 1 | [plan](audit/plans/PASS3-bun-bundler-deep-dive.md) |
| P3-core | bun_core (461 sites) | 5 | 7 | 9 | [plan](audit/plans/PASS3-bun-core-deep-dive.md) |
| P3-sys | bun_sys (332 sites) + cfg-gated | 6 | 3 | 16 | [plan](audit/plans/PASS3-bun-sys-and-cfg-gated.md) |
| P3-cross | refcount races / Drop order / dyn Trait / async | 1 confirmed T1 (`StoreSlice<T>`) | 8 | 12 | [plan](audit/plans/PASS3-cross-cutting-races-drops-async.md) |
| P3-reach | Reachability + test coverage | (index, not bugs) | (index) | (index) | [synthesis](audit/synthesis/PASS3-reachability-and-test-coverage.md) |
| **Pass-3 total** | | Raw agent total: **39 T1 + 4 P0 + 3 P1 + 2 P2**; Pass-3 corrected snapshot is **~37 strict/near-strict memory-safety T1** after Codex demotions | **32+ T2** | **58+ T3** | |

## The 4 Pass-3 supply-chain P0 findings (highest priority)

These are supply-chain attack primitives — a malicious file in a victim's repo causes UB when they run a Bun command.

| ID | Location | Adversarial input | Mechanism |
|----|----------|-------------------|-----------|
| **PUB-INSTALL-1** | `lockfile/Package.rs:3320-3478` `Meta::has_install_script` | Malicious `bun.lockb` byte 3-255 | `#[repr(u8)] enum HasInstallScript` has 3 valid values (0/1/2); reading any other byte from disk → niche-violating transmute → immediate UB on `bun install` |
| **PUB-INSTALL-2** | `lib.rs:1128` `Meta::origin` | Same shape for `Origin` enum | Same niche-violating transmute pattern, different enum |
| **PUB-INSTALL-3** | `yarn.rs:918-925` | Malicious `yarn.lock` | Forms `&mut [Dependency]` over UNINITIALIZED Vec capacity; `DependencyVersionTag` is niche-bearing → UB at slice creation |
| **PUB-INSTALL-4** | `lockfile/Tree.rs:1020` | Malicious `bun.lockb` dependency ID value | `deps.get_unchecked(dep_id as usize)` — attacker-controlled dependency ID → OOB read |

**Combined attack scenario:** Plant a malicious `bun.lockb` or `yarn.lock` in a public package. Every developer who clones the repo and runs `bun install` triggers UB. The memory-safety impact is concrete (invalid enum values, uninitialized typed slices, or unchecked OOB reads); exploitability beyond crash / information disclosure is not claimed without a separate exploit proof.

The maintainers' Zig original used `@enumFromInt` which panics on invalid discriminants in safe build modes. The Rust port faithfully reproduced the syntax but `transmute<u8, Enum>` is unconditionally UB. **This is the canonical Zig→Rust translation gap** documented across the audit; pass-3 found four high-severity instances of it in the supply-chain-attack-reachable code path.

## Other high-severity pass-3 findings

### Network-remote DoS

| ID | Location | Class |
|----|----------|-------|
| **H3** | `http_jsc/websocket_client/WebSocketDeflate.rs:232` | **Demoted by Codex review.** The original "5-byte input → 4 GB output" claim is not supported: `decompress_to_vec` writes only into existing spare capacity, and the zlib fallback checks size after each growth chunk. Keep as bounded memory-amplification hardening for `permessage-deflate`, not as unbounded OOM before the 128 MiB cap. |
| **H9** | `picohttp/lib.rs:383` | Writes NUL through `cast_mut()` of `&[u8]`-derived pointer — **Stacked Borrows UB on every inbound HTTP/1.1 request and fetch response** |
| **H5** | `http/lib.rs:631, 2218` | `request_content_len_buf: [u8; 11]` overflows on `body_len ≥ 10^11` — silently emits `Content-Length: 0` while writing actual body bytes (request-smuggling primitive) |

### CLI input → UB

| ID | Location | Class |
|----|----------|-------|
| **P3-BC-001** | `bun_core::fmt::Raw` / `fmt::s` / `fmt::raw` | Safe `Display` runs `from_utf8_unchecked` on caller bytes — reachable via argv, tarball paths, tmpname formatting |

### Stacked Borrows / parallel processing UB

| ID | Location | Class |
|----|----------|-------|
| **bundler-B1..B5** | `bundler/Chunk.rs:130-132`, `LinkerContext.rs:1657`, `generateCompileResultForJSChunk.rs:61-62`, `generateCompileResultForCssChunk.rs:45-46`, `prepareCssAstsForChunk.rs:77-78` | **5 same-shape UB sites** across parallel bundler callbacks. `&mut LinkerContext` / `&mut Chunk` materialized N times across worker threads. Behaviorally benign (read-only bodies) but reference-shape UB under SB/TB. |
| **U2.×8** (pass-2 reconfirmed in pass-3) | http/AsyncHTTP.rs, http/lib.rs, node_fs.rs, bun_alloc/lib.rs, bun_core/string, jsc/lib.rs, ZigString.rs ×2 | `Box::from_raw`/`heap::destroy`/`mi_free` through `*mut T` derived from `core::ptr::from_ref(slice).cast_mut()` — dealloc through `SharedReadOnly` provenance |

### Cross-thread soundness

| ID | Location | Class |
|----|----------|-------|
| **cross-T1-1** | `bun_ptr::ThreadSafeRefCount::ref_` (release builds) | **Demoted by Codex review unless a bad caller is shown.** The primitive is `unsafe` and requires a live `T`; add `try_ref` hardening, but count a confirmed race only at call sites that can ref from a raw pointer without an existing live reference. |
| **cross-contract-2** | `bun_ptr::WeakPtrData` | **Demoted by Codex review.** Plain `u32` is a real unsafe-contract hazard if weak refs cross threads, but no current bad caller was shown. Track as T2 hardening unless a cross-thread use is proved. |
| **cross-T1-3** | install pipeline (5 sites) | **Demoted by Codex review.** The pattern mirrors Zig's monotonic increment / release decrement / acquire load; queue state is mutex-protected. Treat as ordering-policy cleanup unless a concrete non-atomic payload is shown to be published through the counter. |
| **jsc-contract-2** | `ConcurrentPromiseTask.rs:55`, `WorkTask.rs:58` | T2 unsafe-contract defect: blanket `Send` hides a future context that could touch JSC handles off-thread. No current live UB path proved. |
| **jsc-contract-3** | `webcore_types.rs:96` Blob | T2 unsafe-contract defect: `Sync` over `Cell` fields is too broad. Needs a split JS-thread/worker type, but current concurrent mutation path is not proved in this artifact. |
| **jsc-contract-4** | `VirtualMachine::Sync` via BackRef | T2 unsafe-contract defect: type system permits dangerous captures; current call sites are disciplined. |
| **PUB-N-A** | `JsCell<T>` unconditional Send | T2 unsafe-contract defect unless a concrete current send of `JsCell<!Send>` is shown |
| **PUB-N-B** | `RacyCell<T>` unconditional Sync | T2 unsafe-contract defect unless a concrete current cross-thread `RacyCell<!Sync>` use is shown |

### Platform-specific UB (pass-3 cfg-gated audit)

| ID | Location | Class |
|----|----------|-------|
| **sys-T1-2** (macOS) | `sys/lib.rs:498` macOS dirent arm | Zero-`namlen` edge case → `Name::borrow` one-past-end deref |
| **sys-T1-3** (Linux) | `sys/lib.rs:373` Linux `getdents64` | Panics if kernel emits `reclen < 19` — defensive guard missing |
| **sys-T3-x** (FreeBSD) | `sys/lib.rs:570` FreeBSD dirent arm | Same shape; FreeBSD has 0/0 tests |
| **sys-T1-4** | sys/lib.rs:6488, :6556, windows/mod.rs:3801 | `UNICODE_STRING::Buffer: *mut u16` from `&[u16]` slices — provenance footgun |
| **uws-libuv-F2** | `libuv.rs:437-460` Loop::shutdown | `debug_assert_eq!` for second-close check, but Zig's `bun.debugAssert` evaluates in release — **port-introduced regression** silently leaks handles in release builds |

### bun_core / fmt UTF-8 invariant violations

5 T1 findings in bun_core including the fmt::Raw UTF-8 violation, plus `StringBuilder::move_to_slice` returning `Box<[u8]>` with uninit tail, `BoundedArray::resize` exposing uninit niche-T, and two `MutableString::set_len` patterns reachable from safe API.

### maybe_uninit niche-T exposures (deep family)

Pass 2 found `linear_fifo::assume_init_slice` (F-1); pass 3 found:
- `BoundedArray::resize` (P3-BC-003) — new entry point on same family
- `MutableString::inflate` (P3-BC-005) — separate but same shape
- `Channel::{try_read_item, read_item}` (F-2, latent, pass-2 carry-in)

## Final cumulative T1 count

| Source | T1 count |
|--------|---------:|
| Pass 1 | 2 |
| Pass 2 (Claude + Codex P2 + Codex P3) | ~18 |
| Pass 3 (raw before Codex demotions, 4 P0 + 39 T1) | ~43 |
| **Pass-3 snapshot after Codex corrections** | **~37 strict/near-strict memory-safety T1** |
| **Current Pass-4/5 public dashboard** | **40 T1/T1-equivalent entries** |

Plus ~32+ T2 (architecture defects) and ~58+ T3 (latent watchlist) from pass 3 alone. The `+` reflects Codex-demoted entries that should no longer inflate strict memory-safety T1. The later 40-entry dashboard includes explicitly-labelled non-memory-UB security items rather than silently folding them into memory-safety counts; critical crash-reliability items are tracked outside that T1 risk table.

## Pass-3 NEGATIVE findings (bugs ruled out)

- bun_install §10 "significant negatives" — 11 patterns specifically audited and ruled clean
- bun_jsc — 6 cross-thread tracing wins (AnyTaskJob, RuntimeTranspilerStore, WebWorker::SendPtr, Debugger::SendVmPtr, AbortSignal::Timeout, EventLoop::run_callback)
- bun_runtime (pass-2) — 5 negatives: SSLConfig Sync, Bun__fromMmap, GC-pinning across signal.ref_, ShellSubprocess::Drop, h2 bytemuck::Pod
- HTTP — 7 sound subsystems (H2 stream-id, HEADERS/CONTINUATION reassembly, H3 frame dispatch, redirect, ThreadSafeStreamBuffer, Decompressor lifetime, conn-pool keying)
- Pin / panic-in-Drop / async-cancel — empty surface
- atomic ordering — 0 happens-before bugs
- 537 raw_ptr_lifecycle sites — 0 UAFs, 0 double-frees
- 298 slice_from_raw sites — 0 high-priority external buffer-overrun primitives (the new H9 is a different writes-through-SharedReadOnly shape)
- Macros — host_fn + generate-classes.ts template audit found 0 macro-level UB; both have R-2 Stacked Borrows discriminators

## Concrete reproductions

- `verification/repro-storeslice-send.rs` — proves StoreSlice<Cell<u32>> Send laundering compiles
- `verification/repro-linear-fifo-niche.rs` — demonstrates the niche-T cast permits invalid bit patterns

## Verification by miri

Pass 2/3 cumulative: **23 crates attempted under -Zmiri-strict-provenance**. 7 crates with real tests passed (43 total tests). Bun's `bun_core::atomic_cell` discipline, raw_ptr_lifecycle discipline (537 sites), Pin discipline are all empirically clean.

## Macro-expanded surface

8 crates expanded (~250,000 lines of Rust). 78% of macro-emitted unsafe impls are benign `core::clone::TrivialClone` from `#[derive(Clone, Copy)]`. Net ~200-300 additional unsafe sites applies to the first five expanded crates before `bun_jsc`; with `bun_jsc`, the additional macro-only surface is larger and still not deduped against source-level unsafe. Concentrations:
- `bun_threading::Link<T>` intrusive-list macro
- `bun_errno::declare_error` static-section emitter
- `bun_jsc::host_fn` C-ABI bridge (audited as template; no UB)
- `bun_ptr::detach_lifetime` lifetime-erasure escape hatch
- `enum-map` third-party proc-macro
- bun_runtime — STILL not expandable (needs real cppbind.ts output)

## Reachability + test coverage (pass-3 synthesis)

- **99.48% of unsafe is JS-reachable** through `bun_runtime`'s dep closure
- **63 of 84 unsafe-bearing crates have ZERO Rust unit tests**
- **13 "double-blind" crates** (no Rust tests AND no matched JS tests): bun_libuv_sys, bun_cares_sys, bun_crash_handler, bun_simdutf_sys, bun_lolhtml_sys, bun_libarchive_sys, bun_perf, bun_zlib_sys, + 5 more
- **`bun_libarchive_sys` appears ORPHAN** — no other crate appears to depend on it; 45 sites of likely dead code still in the workspace. This is stale-crate hygiene until confirmed by `cargo metadata` plus build/link checks, not a T1 soundness finding.
- **Top hardening targets** (high unsafe + low test coverage): `sys/lib.rs` (234 sites, 101 missing markers), `runtime/api/cron.rs` (155 sites, 91 missing), `bun_core/lib.rs` (101 sites, 52 missing), `dns_jsc/dns.rs` (219 sites, 59 missing)

## Pass-3 recommended PR landing order

After all this work, the highest-leverage PRs:

1. **P0-level supply-chain fixes** (PUB-INSTALL-1..4) — Mechanical: replace `transmute<u8, Enum>` with `match`/`TryFrom`. ~20 lines per fix.
2. **picohttp NUL-write (H9)** — Replace `cast_mut()` through a shared slice with a mutable-buffer / owning-Vec provenance pattern. ~5 lines.
3. **Bundler Renamer cascade (B1..B5)** — Apply the `doStep5.rs:43-58` `*mut LinkerContext` template across all 5 sites, and account for `SymbolMap::follow()` path-compression writes.
4. **StoreSlice Send/Sync bounds** — Add `<T: Send>`/`<T: Sync>` bounds matching the sister `StoreRef<T>` pattern. 2 lines, T1.
5. **fmt::Raw UTF-8 violation (P3-BC-001)** — Replace `from_utf8_unchecked` with `from_utf8_lossy` or panic on invalid input. ~3 lines.
6. **WebSocket deflate bounded-amplification hardening (H3)** — Keep the 128 MiB cap, but document and test the fallback path. This is no longer described as a 4 GiB pre-check allocation primitive.
7. **T2 contract hardening tranche** — JsCell/RacyCell/Blob/WeakPtrData/ThreadSafeRefCount: add bounds, thread-affinity markers, atomics, or `try_ref` only where the call-site proof requires it.
8. **linux_errno + SystemErrno::from_raw fixes** — Pass 2 known.
9. **dirent-parser bounds (sys-T1-2,3,FreeBSD)** — Add the `reclen >= 19` defensive guard.
10. **Windows BundleThread waker placeholder** — Pass 2 known.

11+. The remaining T1 findings as smaller follow-up PRs; T2 contract defects tracked separately so they do not inflate the T1 count.

The first 6 PRs alone, if landed, would fix the most user-reachable issues in the audit — including the supply-chain attack vector.
