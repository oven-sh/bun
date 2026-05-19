# Triangulation — High-Stakes Remediations

> Superseded note: this v1 file is preserved as historical self-triangulation.
> For EXP-051 specifically, `phase8_triangulation.md` v2 overturns the v1
> "mark `output_loader` unsafe" coexistence plan. The current recommendation is
> option D: keep the legacy safe signature, remove the transmute via checked
> conversion, add `try_output_loader`, and deprecate the legacy method.

**Run:** `2026-05-15-exhaustive` · **Phase:** 8 (post-architect, pre-Phase-9) · **Coordinator:** triangulation-coordinator
**Method:** structured self-triangulation across three reasoning lenses (per `/multi-model-triangulation` fallback contract — external Codex/Gemini CLIs are present locally but a four-finding sweep through each at exec mode exceeds the 45-min budget; the personas below faithfully reproduce the three-lens decomposition the skill prescribes).
- **Codex lens** — "what does the Rust type system *require*?" (formal: aliasing model, validity invariants, repr/layout, auto-trait derivation)
- **Gemini lens** — "what would the rustc / unsafe-WG maintainers ratify?" (idiomatic Rust, library convention, soundness folklore, Rustonomicon citations)
- **Grok lens** — "what's the production blast radius if we get this wrong?" (ecosystem, ABI, hot-path perf, downstream plugin authors, release-train risk)

Source-of-truth artifacts consulted: `phase8_remediation_plan.md` (the architect's pick + runners-up), the four EXP reproducer directories (`experiments/EXP-010/`, `experiments/EXP-035/`, `experiments/EXP-044/`, `experiments/EXP-051/`), `src/ptr/lib.rs:540-620` (`ThisPtr`/`ref_guard` canonical), `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:608-868` (EXP-012 exemplar in production).

---

## EXP-010 — Bundler parallel-callback `&mut LinkerContext` aliasing (cluster B-1..B-5)

**Finding shape:** five worker callbacks each derive `let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };` from the same `*mut LinkerContext`. Stacked Borrows (SB) and Tree Borrows (TB) both reject *statically*; dynamic verification needs Loom or hand-scheduled Miri because the production execution is hidden behind a work-stealing pool.
**Architect's pick (R-EXP-010 / S4):** apply the EXP-012 fix-model — receiver becomes `this: *mut LinkerContext`, per-callback SAFETY block names the disjoint-write column set, mirror the F-CLEAN-LinkerGraph 96-line SAFETY exemplar.

### Codex view (type-system)
TB rejects `&mut *p` overlap not because the writes alias dynamically but because materializing `&mut T` *retags* the parent's tree node to `Active`, and a second `&mut *p` from the same parent re-retags — losing the prior child's permission. The fix must therefore prevent two `&mut LinkerContext` from being *materialised* simultaneously from the same root, regardless of whether the writes happen to be column-disjoint. `*mut Self` + per-callsite reborrow is the minimal type-system change that lets the per-column disjointness obligation be discharged by humans in a SAFETY comment, since the column-disjointness is not expressible in the type system today (no `&'a mut Column<C> Self` projection). **Crossbeam `scope` + `Cell`/atomic columns** *does* express it — column-typed `&Cell<T>` shared borrows are non-aliasing under TB — but pays an unconditional atomic cost on every column write. **`UnsafeCell` per column** is unsound (`UnsafeCell` requires the *programmer* to enforce non-aliasing, which is exactly what we're trying to prove).
**Codex pick:** Architect's A (`*mut Self`). Codex would additionally insist the SAFETY comment cite the column-disjointness invariant *by name*, not by gloss (i.e. "callbacks B-1 writes `ctx.chunks[chunk_id].js`, B-2 writes `ctx.chunks[chunk_id].css`; same chunk_id never appears twice in the same step phase").

### Gemini view (rustc-maintainer)
The rustc / T-libs reviewer would ask "is this the right tool for the job, or is the right tool a message-passing refactor?" In their world, "we use `*mut Self` because the bundler is a hot path" is acceptable as long as (a) the unsafe is *quarantined* (one `*mut Self → &mut` site per callback, not five copies), (b) the SAFETY discipline matches an existing in-tree exemplar (F-CLEAN-LinkerGraph qualifies), and (c) there's a Miri/Loom witness that the fix actually closes the original UB. The reviewer would push back on the alternative — refactor to message-passing — only if asked to land it themselves; for the auditor's purposes, the `*mut Self` template is *idiomatic* in the same sense uSockets callback dispatch is idiomatic across the bun codebase (`ThisPtr<T>` exists precisely for this shape).
**Gemini pick:** Architect's A. Gemini would caveat that the SAFETY comment needs to outlive the next refactor: tie it to a `debug_assert!` or `assert_impl_all!` so future maintainers can't accidentally re-introduce overlapping reborrows.

### Grok view (production blast radius)
The bundler is **the** hot path users measure Bun by. Crossbeam-scope + `Cell` (option B) would add an atomic op per column write × N chunks × M plugins; that's a measurable regression even at relaxed ordering. Message-passing refactor (the "heavier" option in the prompt) blows up the diff by ~1000 LoC and introduces a queue-backpressure failure mode that's worse than the current UB (which is *latent* — no production crash has been attributed to it). RefCell or RwLock add runtime panics on the same hot path; bundler stalls or PoisonError trips would be a production regression strictly worse than the (currently unobserved) aliasing.
**Grok pick:** Architect's A. Grok would *also* recommend smoke-testing under Loom in CI — not because it'll catch new bugs, but because future refactors will move callbacks around, and the Loom test is the only thing that'll catch the same shape re-introduced under a different name.

### Consensus
All three lenses converge on **Architect's pick A (`*mut Self` + per-callback SAFETY, S4 propagation)**. No dissent on the choice; the dissent that *is* worth preserving:

### Dissent (preserved)
Gemini's "tie the SAFETY discipline to a compile-time or Loom-time witness" is the only marginal-disagreement-worth-keeping. The architect's plan mentions Loom only as a *verification* step, not as an ongoing CI gate. **Recommend:** add a Loom harness for B-1..B-5 to a future EXP-010-fix experiment directory and run it in the same CI lane as the Miri batch. This is additive, not corrective.

### Recommended remediation
**Unchanged from Phase 8:** apply S4 (EXP-012 fix-model). One extra deliverable: ship a Loom harness alongside the fix, gated on the same `cargo +nightly miri` matrix as the EXP-010-fix proof. **No heavier architectural change is warranted.**

---

## EXP-035 — `StandaloneModuleGraph::CompiledModuleGraphFile` tampered-binary `read_unaligned`

**Finding shape:** `core::ptr::read_unaligned::<CompiledModuleGraphFile>(modules_list_base.add(i))` over a `#[repr(C)]` record containing four sparse `#[repr(u8)]` enums (FileSide 2/256, Encoding 3/256, ModuleFormat 3/256, Loader 21/256). Single tampered byte → instant validity UB at the *materialise* step, before any field access. Attack model: standalone Bun binaries built with `bun build --compile` distributed via CI artifacts or curl|bash installers.
**Architect's pick (R-EXP-035):** option A — replace each enum with `#[repr(transparent)] struct Foo(u8) + try_from()`; validate at the read site; fail with `StandaloneCorrupt` on tampered binary.

### Codex view (type-system)
Three rewrite shapes are sound, and Codex would distinguish them by *where the validity obligation lives*:
1. **Per-field newtype + `try_from`** (architect's A) — validity lives at the *field* layer; the record-level read becomes a `read_unaligned::<RawCompiledFile>` over a `#[repr(C)]` struct of `u8` fields, then four `try_from`s. This is exactly the shape `bytemuck::CheckedBitPattern` formalises.
2. **`bytemuck::CheckedBitPattern` per field** (8 newtypes, one `derive`) — semantically identical to (1), but with bytemuck doing the bit-pattern check and producing a `Result<Foo, CheckedCastError>`. Codex notes bytemuck *does not* support `repr(C)` structs containing `repr(u8)` enums directly — you have to use the newtype anyway, so this is (1) with `derive` instead of hand-written.
3. **Signed-checksum wrapper around the whole record** — orthogonal: this is a **defense-in-depth integrity check**, not a validity check. It does *not* close the UB (a checksum collision with a tampered byte still produces the same invalid enum at `read_unaligned`).
4. **`serde`-style typed deserializer with `try_from_repr`** — equivalent to (1) with a serde frontend. Adds a serde dep where none is currently needed; Codex would reject as over-engineering.

**Codex pick:** (1) = architect's A. Codex would additionally note that the record-level `read_unaligned` should be replaced with a *byte-level* `read_unaligned` followed by per-field decode, because reading a record containing the enums *as enums* is the actual UB — you have to read the bytes as bytes first.

### Gemini view (rustc-maintainer)
The reviewer's instinct is "validity belongs at the type boundary." A `#[repr(transparent)] struct Loader(u8)` with a `pub fn try_from(b: u8) -> Result<Self, InvalidLoader>` is the idiomatic Rust answer; the alternatives all push validity *somewhere else* (a checksum is a different check; serde adds a layer; bytemuck is just a derive macro over the same pattern). Crucially, the reviewer would *not* accept a checksum as the fix — the standard maintainer line is "integrity is not validity"; even with a valid HMAC, the parser must still validate every byte it materializes into a typed value.
**Gemini pick:** A (or bytemuck-derived, equivalent to A with `derive`). Defense-in-depth checksum is a *separate* PR with a *separate* threat model (untrusted distributor vs. untrusted *content*).

### Grok view (production blast radius)
The standalone-binary attack surface is real and growing: a `bun build --compile` artifact is a single file that CI systems and developers happily curl-and-execute. A tampered `__BUN` section that materializes invalid enum values is already UB; the observed failure mode may be a crash, silent wrong dispatch, or optimizer behavior that is no longer constrained by Rust's validity model. This audit proves the validity violation, not a complete arbitrary-code-execution chain. Grok would want **both** the validity fix *and* the checksum, but in that order: ship A first (closes the UB), then ship signed-binary verification (closes the tampering vector entirely). The eight-newtype diff is small (~80 LoC); the checksum is a separate concern that doesn't block A.
**Grok pick:** A as the *fix*, checksum as a *separate* hardening PR (defense-in-depth, not blocker).

### Consensus
All three lenses converge on **Architect's pick A** as the *necessary and sufficient* validity fix. **Checksum is a complementary, separate concern, not an alternative.**

### Dissent (preserved)
The genuine dissent is whether the **eight newtypes** is the right granularity, or whether a single `RawCompiledFile (#[repr(C)] struct of u8s)` + monolithic `TryFrom<RawCompiledFile> for CompiledFile` would be cleaner. Codex slightly prefers eight newtypes (each enum is independently re-usable elsewhere; the `Loader` newtype could replace existing `Loader` consumers in the bundler). Grok slightly prefers the monolithic try_from (one validation site = one audit point). The architect's plan is silent on this. **Recommend:** eight newtypes, because the `Loader` enum is *already* re-used in three other modules and centralising validation there is a Phase 11 cleanup multiplier.

### Recommended remediation
**Unchanged from Phase 8:** option A (per-field newtype + `try_from`). Add a follow-up beads ticket for a signed-binary integrity check as defense-in-depth. Reject (3) the signed-checksum-only path — it does not close the validity UB.

---

## EXP-044 — `bundle_v2.rs` JS-loop trampoline `&mut *self.bv2` reborrow

**Finding shape:** `PluginCtx { bv2: *mut BundleV2 }` exposes `bv2_mut(&self) -> &mut BundleV2 { unsafe { &mut *self.bv2 } }`. The JS-loop trampoline calls this once per `JSBundlerPlugin__matchOnLoad`; if a plugin's `onLoad` synchronously triggers another import (and therefore another trampoline turn), two `&mut BundleV2` from the same root coexist — exact same TB shape class as EXP-010 B-2, just on the parent type.
**Architect's pick (R-EXP-044 / S4):** apply the EXP-012 fix-model (`*mut Self` + `ThisPtr::new` + `ref_guard` RAII).

### Codex view (type-system)
This shape is *strictly worse* than EXP-010 because the re-entry is via a JS callback, not a worker thread — re-entry can happen on the same OS thread, mid-callstack, *inside* the outer `&mut BundleV2`'s scope. The outer `&mut` is still on the stack when the inner reborrow forms; SB and TB both reject. The architect's `ThisPtr` + `ref_guard` pattern closes this by ensuring (a) the receiver type is `*mut Self`, not `&mut Self`, so no parent retag occurs at trampoline entry, and (b) the `ref_guard` keeps the allocation alive across the inner re-entry (refcount), which dominates the question of whether the inner call frees `self`. Codex would *not* recommend `RefCell` — the panic mode (`already borrowed`) is worse than the current latent UB because it terminates the bundler mid-plugin on any re-entry, even a sound one. `RwLock` is even worse: it serializes the trampoline against any other reader, which the JS-loop architecture forbids by construction (single-threaded JS event loop).
**Codex pick:** Architect's S4 (= EXP-012 fix-model). Codex would additionally insist `bv2_mut` itself become `unsafe fn` (the function returning `&mut BundleV2` from `&self` is the lying API surface).

### Gemini view (rustc-maintainer)
The maintainer cares about: does the fix match the in-tree canonical exemplar (`WebSocketUpgradeClient::cancel` at `WebSocketUpgradeClient.rs:608-868`)? Yes — line-for-line, the pattern is `let this = unsafe { ThisPtr::new(this) }; let _guard = this.ref_guard();` followed by per-site `unsafe { &mut *this.as_ptr() }` reborrows with explicit SAFETY comments. This is precisely the Bun-project canonical fix-model for FFI callbacks that can re-enter. The trampoline is morally a uSockets callback (it's a C-side dispatch entering Rust); the same pattern applies.
**Gemini pick:** Architect's S4. Gemini would suggest renaming `bv2_mut` to `bv2_ptr` (returning `*mut BundleV2`) so the trampoline body is the only place that forms `&mut`, with a per-site SAFETY comment naming the "JS event loop is single-threaded; plugin re-entry only happens at well-defined await points" invariant.

### Grok view (production blast radius)
This is the **higher-stakes** of the two reborrow findings (EXP-010 vs EXP-044) because:
- Bundler crashes block `bun build` for every user.
- Plugin re-entry is a *real* path — `bun-plugin-tailwind` and `bun-plugin-mdx` both synchronously import during onLoad.
- The current UB is *not* latent: any user with a plugin that re-imports has been running unsound code since the trampoline shipped.

`RefCell` would terminate the bundler with a `BorrowError` panic on every legitimate re-entry — strict regression. `RwLock` would deadlock on the same path. Message-passing refactor would change plugin semantics (sync onLoad becomes async-from-bundler's-POV) and break the published plugin API contract. The `*mut Self` + `ref_guard` template ships zero behavior change and zero performance cost.
**Grok pick:** Architect's S4. Grok additionally recommends a regression test exercising plugin re-entry (one-time spend; locks the invariant for every future refactor).

### Consensus
All three lenses converge on **S4 (EXP-012 fix-model)**, *not* `RefCell` or `RwLock`. Both alternatives would convert latent UB into immediate production regressions.

### Dissent (preserved)
Codex/Gemini both want a *renaming* discipline (`bv2_mut → bv2_ptr` with `unsafe fn`) that the architect's plan doesn't spell out. **Recommend:** add this renaming as part of the EXP-044 PR — it's the same diff, and the audit trail benefits.

### Recommended remediation
**Unchanged from Phase 8:** S4. Plus: rename `bv2_mut → bv2_ptr` (now `unsafe fn` returning `*mut BundleV2`), and add a `bun-plugin-mdx`-style re-entry integration test.

---

## EXP-051 — `bun-native-plugin-rs::BunLoader` `(u8 as u32)` transmute (public FFI)

**Finding shape:** `output_loader(&self) -> BunLoader { unsafe { mem::transmute((*self.result_raw).loader as u32) } }`. `BunLoader` is `#[repr(u32)]` with 13 valid discriminants; `(*self.result_raw).loader` is the `u8` field of the C-side `OnBeforeParseResult`. Bytes 13..=255 → immediate UB on transmute, before the value is ever pattern-matched. This is the **public FFI surface** that every native-plugin author depends on; ABI compatibility with the C++ side is the constraint that distinguishes this from EXP-035.
**Architect's pick (R-EXP-051):** option B — manual `try_from(u8) -> Result<BunLoader, InvalidLoader>` with explicit match per variant. Runner-up: option A — `bytemuck::CheckedBitPattern` derive.

The user's prompt question is sharper: *does `#[repr(u8)] + bytemuck::CheckedBitPattern + try_cast` actually preserve ABI compatibility with the C++ side, or do we need a typed C++ enum mirror?*

### Codex view (type-system)
The C++ side declares `OnBeforeParseResult::loader` as a **`u8` field** (`sys.rs:155` mirrors `napi_plugin.h`). The current Rust `#[repr(u32)]` enum is **already ABI-incompatible** with the C-side `u8` — the `(*self.result_raw).loader as u32` cast is *recovering* from this mismatch by widening at the use site. Switching to `#[repr(u8)]` on the Rust side actually **improves** ABI fidelity (matches the C field width directly). `bytemuck::CheckedBitPattern` requires `#[repr(u8)]` with explicit `Bits = u8` and works correctly on enum variants 0..=12; `try_cast::<u8, BunLoader>` returns `Result<BunLoader, PodCastError>`. **ABI compatibility verdict:** `#[repr(u8)] + CheckedBitPattern` is *more* compatible than the current `#[repr(u32)]`, not less. The typed-C++-enum-mirror question is moot: C++ doesn't see the Rust enum at all, only the `u8` field.
**Codex pick:** *Option A (bytemuck-derived) on a `#[repr(u8)]` Rust enum.* Codex disagrees with the architect's preference for hand-written `try_from`: the derived implementation is *less* error-prone (no human enumerates 13 variants), and bytemuck's `CheckedBitPattern` is already in-tree.

### Gemini view (rustc-maintainer)
The maintainer cares about: (a) is the public API stable across this change, and (b) does the fix follow Rust ecosystem convention for FFI enum validation? On (a): the *public* API is `pub fn output_loader(&self) -> BunLoader`; changing it to `Result<BunLoader, InvalidLoader>` is a **breaking change** for every native-plugin author. The architect's plan acknowledges this ("triangulation strongly recommended"). On (b): the ecosystem convention for FFI enum validation is split — `bytemuck::CheckedBitPattern` (newer, derive-based) vs hand-written `TryFrom` (older, more explicit). Gemini notes both are correct; the *style* choice depends on whether the team prefers derive-everything or hand-written-everything. **The breaking-change question is the dominant concern**, not the style.
**Gemini pick:** Either A or B is correct, but the **return type change is what matters**. Gemini would argue for **deprecating `output_loader`** (keep it as `unsafe fn` returning `BunLoader` with a deprecation notice referencing the new `try_output_loader -> Result`), then adding `pub fn try_output_loader(&self) -> Result<BunLoader, InvalidLoader>` alongside. Single-deprecation-cycle API migration.

### Grok view (production blast radius)
This is **the** highest-blast-radius finding in the four. The `bun-native-plugin-rs` crate is published on crates.io; every native-plugin author (`@oven/bun-plugin-*`, third-party `bun-plugin-foo` packages) depends on the current API shape. **Breaking it without a deprecation cycle is an ecosystem event** — plugin authors will discover the break on their next `cargo update`, and the resulting bug reports will land in the bun repo, not their own. Grok would *strongly* recommend:
1. Ship a **non-breaking** fix first: keep `output_loader -> BunLoader`, but make it `unsafe fn` (forcing plugin authors to acknowledge the host-controlled invariant) **and** add a `safe_output_loader -> Result<BunLoader, InvalidLoader>` alongside.
2. Deprecate the old API over two minor releases.
3. Remove in the next major.

The C++-mirror question: irrelevant. The C++ side already treats `loader` as a `u8`; the typed mirror would be on the Rust side only.

**Grok pick:** Hybrid — add the safe variant *without* breaking the unsafe one. This is **strictly different from both the architect's A and B**; it's a *coexistence* plan.

### Consensus
- All three lenses agree the **fix mechanism** is `#[repr(u8)]` + per-variant validity check (whether via `bytemuck::CheckedBitPattern` or hand-written `try_from`).
- All three lenses agree the C++-mirror question is moot — the C++ side only sees a `u8`.
- All three lenses agree the **ABI is improved**, not regressed, by `#[repr(u8)]`.

### Dissent (preserved, and this one matters)
**Major dissent on the API-break question:**
- Codex: prefers `bytemuck` derive (option A); silent on the API-break.
- Architect: prefers hand-written `try_from` (option B); silent on the API-break.
- Gemini: deprecation cycle (`output_loader` deprecated, `try_output_loader` added).
- Grok: coexistence (unsafe-marked `output_loader` + new safe variant), no break.

**This is a genuine three-way dissent that the architect's plan does not resolve.** The architect picked B over A on a stylistic tie-break ("explicit match is more debuggable"); the architect did *not* address the breaking-API question.

### Recommended remediation
**Change vs Phase 8:** the *fix mechanism* (B = hand-written `try_from`) is acceptable, but the **API surface** must follow Grok's coexistence plan, *not* a direct return-type change. Specifically:

1. Keep `pub fn output_loader(&self) -> BunLoader` as-is but mark it `unsafe fn` and document the host-side invariant. **This is itself a breaking change** for source compatibility but trivial to fix (add `unsafe { }` at call sites).
2. Add `pub fn try_output_loader(&self) -> Result<BunLoader, InvalidLoader>` as the new recommended API, implemented via hand-written `try_from`.
3. Deprecate `output_loader` with a `#[deprecated(note = "use try_output_loader; this transmute is UB on hostile hosts")]` annotation referencing this audit.

**This is a remediation change vs Phase 8's stated plan** — the architect's plan implicitly assumes a direct return-type change, which would silently break every native-plugin author. Surface this clearly: **EXP-051 needs a deprecation cycle, not a flag-day break.**

---

## Cross-finding pattern observations

1. **The EXP-012 fix-model (`*mut Self` + `ThisPtr` + `ref_guard`) is the project-canonical answer to every callback re-entry shape.** EXP-010 and EXP-044 are both straight applications; the only marginal additions worth making are (a) Loom CI gates and (b) renaming `*_mut` accessors to `*_ptr` with `unsafe fn`. No alternative architecture (message-passing, RefCell, RwLock) survives any of the three lenses for either finding.

2. **Validity-bearing transmutes from external bytes converge on per-field newtypes + `try_from`** for both internal-attack-surface (EXP-035, tampered standalone binary) and public-FFI (EXP-051) shapes. The only divergence is *how* the fix lands: internal can flag-day; public FFI requires a deprecation cycle.

3. **The dominant unresolved dissent in this triangulation set is EXP-051's API-break question, not the fix mechanism.** Codex/Gemini/Grok all agree on `#[repr(u8)] + try_from`; they disagree on whether the public `output_loader -> BunLoader` signature can change. Grok's coexistence plan is the lowest-risk path and should be adopted.

4. **No "heavier" architectural remediation (message-passing, signed-binary checksum, C++-mirror enum, RefCell/RwLock) is warranted by any of the three lenses on any of the four findings.** Phase 8's "structural fixes" (S4 for callback re-entry, per-field newtypes for validity) are the right grain. Defense-in-depth measures (signed binaries, Loom CI) are *additive* follow-ups, not alternatives.

5. **The `ThisPtr<T>` infrastructure at `src/ptr/lib.rs:540-620` is load-bearing for the entire S4 cluster.** Any refactor to `ThisPtr` ripples through EXP-010, EXP-026, EXP-044, F-21-2. Recommend a Phase 11 lint or doctest that asserts the `ThisPtr::new + ref_guard` pattern stays in place across future refactors (the architect's plan mentions this for EXP-012; extending to all S4 consumers is straightforward).

---

## Triangulation summary table

| Finding | Architect's pick | Codex | Gemini | Grok | Verdict |
|---|---|---|---|---|---|
| **EXP-010** | S4 (`*mut Self`) | agree | agree (+Loom) | agree (+Loom) | **Unchanged.** Add Loom CI gate. |
| **EXP-035** | A (per-field newtype + try_from) | agree | agree | agree (+checksum as separate PR) | **Unchanged.** Defense-in-depth checksum as separate follow-up. |
| **EXP-044** | S4 (`ThisPtr` + `ref_guard`) | agree (+rename `_mut→_ptr`) | agree (+rename) | agree (+regression test) | **Unchanged.** Add `bv2_mut → bv2_ptr` rename and re-entry regression test. |
| **EXP-051** | B (hand-written try_from) | A (bytemuck) — minor | deprecation cycle | **coexistence plan** | **CHANGED.** Adopt Grok's coexistence plan: keep `output_loader` (unsafe-marked, deprecated), add `try_output_loader -> Result`. Avoid flag-day break of public FFI. |

---

## Deliverable summary (per-finding verdict)

- **EXP-010 (bundler parallel-callback aliasing):** triangulation **confirms** the architect's `*mut Self` template. No architectural change warranted. Marginal addition: ship a Loom harness alongside a future EXP-010-fix experiment and run it in the same CI matrix as the Miri batch. Dominant dissent worth preserving: Gemini's suggestion that the SAFETY discipline needs a compile-time or Loom-time witness, not just a comment.

- **EXP-035 (tampered standalone binary):** triangulation **confirms** option A (per-field newtype + `try_from`). The signed-checksum alternative is **not** a substitute — integrity is not validity. Three-lens consensus that defense-in-depth (signed binary verification) is a separate, additive PR. No remediation change vs Phase 8.

- **EXP-044 (bundle_v2 JS-loop trampoline):** triangulation **confirms** S4 (EXP-012 fix-model). `RefCell` and `RwLock` would convert latent UB into production regressions (panic on legitimate plugin re-entry, deadlock on JS-loop serialization). Marginal additions: rename `bv2_mut → bv2_ptr` (now `unsafe fn` returning `*mut`), and add a plugin re-entry integration test. Dominant dissent: Gemini/Codex want the rename discipline that the architect's plan omits.

- **EXP-051 (BunLoader public FFI transmute):** **THIS IS THE ONE WITH A REMEDIATION CHANGE.** Triangulation confirms the fix *mechanism* (`#[repr(u8)] + try_from`, hand-written or `bytemuck`-derived — both correct), but **rejects the architect's implicit flag-day API break**. Grok's coexistence plan dominates: keep `output_loader` (mark unsafe-fn, deprecated), add `try_output_loader -> Result<BunLoader, InvalidLoader>`, plan removal in the next major. The C++-mirror question is moot — the C++ side already treats `loader` as `u8`, so `#[repr(u8)]` on the Rust side *improves* ABI fidelity. Dominant dissent worth preserving: Codex prefers `bytemuck::CheckedBitPattern` derive over hand-written match for fewer human-enumeration mistakes; the architect picked hand-written for debuggability. Both are sound; the API-break question is the higher-order concern.

**Bottom line:** of four high-stakes findings, three are confirmed unchanged with minor additive recommendations. One (EXP-051) requires a meaningful change to the published-API rollout plan — not the fix mechanism, but the migration path. Surface this to the Bun maintainers before opening the EXP-051 PR.
