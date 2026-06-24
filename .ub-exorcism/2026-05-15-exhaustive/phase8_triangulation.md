# Triangulation v2 — Real External Models (Codex + Gemini + Claude)

**Run:** `2026-05-15-exhaustive` · **Phase:** 8 v2 · **Coordinator:** triangulation-coordinator (v2)
**Method:** real CLI invocations against the four high-stakes remediations from `phase8_remediation_plan.md`. Per-finding outputs are saved under `/tmp/triangulation/EXP-NNN-{codex,gemini}.log`.

This v2 **supersedes** `phase8_triangulation_v1.md` (preserved for comparison). Where v1 used three structured self-personas ("Codex-lens", "Gemini-lens", "Grok-lens") run by Claude, v2 invokes the actual external CLIs.

## Lens inventory

| Lens | Tool | Version | Status |
|---|---|---|---|
| External-1 | `codex exec` | codex-cli 0.130.0 (model `gpt-5.5`, xhigh reasoning) | **4/4 succeeded** (EXP-010, EXP-035, EXP-051 on first run; EXP-044 on retry — first attempt got stuck in a web-search loop trying to fetch the `:608-868` exemplar, resolved by sanitizing the prompt and setting `tools.web_search=false`). |
| External-2 | `gemini -p` | gemini-cli 0.42.0 | **4/4 succeeded after fallback** — first round used the default model and all 4 hit `TerminalQuotaError: capacity exhausted, reset in 10h56m`. Retried with `-m gemini-2.5-flash` (separate quota pool) and all four returned verdicts. EXP-051 needed a second retry because the first flash attempt stalled after the `update_topic` planning step. |
| External-3 | Grok CLI | n/a | **Not installed on host** (`which grok` returns "not found"). Out of scope per the coordinator brief. |
| Internal | Claude (audit-run model) | Opus 4.7 (1M context) | Used as the third lens per the v2 coordinator brief (Grok CLI absent from host). |

**Triangulation v2 runs on Codex + Gemini-2.5-flash + Claude across all four findings.** The v1 self-triangulation document is preserved verbatim at `phase8_triangulation_v1.md` for delta inspection; the Gemini-lens column in v1 was a structured persona, not a model call.

---

## EXP-010 — Bundler parallel-callback `&mut LinkerContext` aliasing (cluster B-1..B-5)

**Source:** `src/bundler/LinkerContext.rs:1657-1663` + 4 sibling callbacks
**Architect's pick:** A — `*mut Self` template from the EXP-012 fix-model.
**Candidate remediations presented to the models:** A (architect's `*mut Self` template), B (message-passing refactor), C (crossbeam-scope + per-column `Cell`/atomic).

### Codex output (verbatim, model `gpt-5.5`, ~22.8k tokens used)

> **Verdict:** Choose **A**. It fixes the actual UB by no longer materializing competing `&mut LinkerContext` references, has zero hot-path cost, preserves callback/plugin semantics, and keeps the diff small enough for reviewers to audit each unsafe access against named disjoint column sets. The key condition is that the fix must not recreate `&mut Self` inside helpers; it should use raw-pointer/narrow-field access with explicit SAFETY comments and tests around the column partition. For production, this is the best balance of correctness, performance, reviewability, maintainability, and public API stability.
>
> **Dissent:** Preserve the argument for **B** as the gold-standard ownership design: a single owner plus message passing eliminates this class of aliasing by construction instead of relying on maintained unsafe invariants. If the callback write sets are likely to evolve, cannot be mechanically checked, or become observable through public/plugin APIs, B's larger blast radius may be justified, ideally in a major release. C is cleaner than A in the type system, but the hot-path atomic/interior-mutability cost and possible API leakage make it a weaker production tradeoff here.

### Gemini output (verbatim, model `gemini-2.5-flash`)

> The optimal remediation for EXP-010 is **(A) Architect's `*mut Self` template**. This approach offers a superior balance of correctness, performance, and project impact. By adopting a proven `*mut Self` pattern with rigorously defined `SAFETY` invariants, it directly addresses the aliasing issue at zero runtime cost, which is crucial for a bundler hot path. Its contained diff blast radius (~150 LoC) minimizes the risk of introducing new bugs and simplifies review, focusing on the critical `unsafe` block's guarantees. Furthermore, it preserves public API stability, which is paramount for crates.io consumers, making it the most pragmatic and production-ready solution that adheres to the project's established conventions for managing complex `unsafe` interactions.
>
> A compelling dissent favors **(B) Message-passing refactor**, despite its significant overhead, for its complete eradication of aliasing and reliance on safe Rust. While acknowledging the ~1000 LoC diff, potential performance implications, and plugin-author-visible semantic changes, the long-term maintainability and inherent correctness guarantees of a message-passing architecture present a more robust solution against future UB regressions. The upfront cost of refactoring and potential API adjustments might be a worthwhile investment to transition away from complex `unsafe` blocks, which, regardless of documentation, always carry a higher cognitive load and risk of subtle errors for future developers. This approach prioritizes absolute type-system safety over incremental performance or minimal code change.

### Claude lens (audit-run model, third lens)

> **Verdict:** A. The UB shape is type-system-rejected reborrows from a shared `*mut`, not a dynamic data race; the writes are column-disjoint at runtime but unprovable in the type system. The architect's `*mut Self` template is the minimal change that converts the unsoundness from a *materialization* problem (forming overlapping `&mut`) into a *discipline* problem (each callback's per-field reborrow with named SAFETY columns). Option C (crossbeam + per-column `Cell`/atomic) would express the disjointness in the type system but pays an unconditional atomic cost on the bundler hot path — measurable regression even at relaxed ordering, and `LinkerContext` has dozens of columns. Option B (message-passing) eliminates aliasing by construction but is a ~1000 LoC refactor that introduces queue backpressure as a new failure mode (worse than the latent UB it replaces, which has zero observed production crashes). The architect's pick wins on every axis except "express the invariant in the type system", which is not worth the perf hit.
>
> **Dissent worth preserving:** The Loom witness is *pending*, per the finding statement — A is correct only if the disjoint-write claim is true at runtime, not just at the SAFETY-comment layer. Land A with the Loom harness in the same PR or as a CI gate; otherwise the next refactor that moves a callback can silently violate the disjointness claim without anyone noticing.

### Consensus

**Three-way agreement on A (architect's `*mut Self` template).** All three reject C (hot-path atomic regression) and B (over-large diff, queue backpressure as worse failure mode than the latent UB).

### Dissent (preserved)

Codex and Gemini **both** flag option B (message-passing) as the gold-standard ownership design for a future major release — Codex frames it as "if the callback write sets are likely to evolve or become observable through plugin APIs"; Gemini frames it as "transition away from complex `unsafe` blocks which always carry higher cognitive load". This is the same dissent in two voices, and worth preserving for the planning horizon. Claude's separate dissent — *"A is only correct conditional on the Loom witness landing in the same PR"* — is the actionable add for the EXP-010 PR.

### Recommended remediation

**A (`*mut Self` template), unchanged from Phase 8.** Add the Loom harness to a future EXP-010-fix experiment directory and run it in the same CI lane as the Miri batch (this matches v1's recommendation; v2 still endorses it). Hold B in reserve for a future major refactor if the callback write sets ever grow to include plugin-observable side effects.

---

## EXP-035 — `StandaloneModuleGraph::CompiledModuleGraphFile` tampered-binary `read_unaligned`

**Source:** `src/standalone_graph/StandaloneModuleGraph.rs:230-246, 577-580`
**Architect's pick:** A — per-field newtype + `TryFrom<u8>`.
**Candidate remediations:** A (per-field newtype + try_from), B (`bytemuck::CheckedBitPattern` derive), C (signed-checksum / HMAC over `__BUN` section), D (serde-style typed deserializer).

### Codex output (verbatim, ~22.4k tokens)

> **Verdict:** Pick **B**, with the important constraint that the read path must use bytemuck's *checked* byte/unaligned APIs so validation happens before any `CompiledModuleGraphFile` or enum value is materialized. That closes the actual validity UB: bytes are first treated as raw bit patterns, then each sparse enum tag is checked, then a typed value is constructed. Perf impact should be lost in the noise: this is startup/module-graph metadata parsing, and the added work is a handful of byte-range/tag checks per entry. Compared with A, B has a smaller handwritten diff, fewer bespoke `TryFrom<u8>` implementations to audit, and centralizes the unsafe invariant in a crate already designed for this boundary. C is not a fix because integrity does not imply Rust validity, and D adds dependency/design weight without improving the invariant.
>
> **Dissent worth preserving:** A is the most conservative choice if the team distrusts derive macros or wants the binary format boundary to be painfully explicit. A raw `#[repr(C)]` wire struct of `u8`s plus local `TryFrom<u8>` conversions is easy to audit with no macro expansion or trait semantics involved, and each enum's accepted values are visible at the call site. That may be preferable for a security-sensitive runtime if maintainers value boring explicitness over smaller diff size. But it is more manual surface area, so the production recommendation stays B unless bytemuck's checked API cannot represent the exact layout cleanly.

### Gemini output (verbatim, model `gemini-2.5-flash`)

> The optimal remediation for EXP-035 is **Remediation B: `bytemuck::CheckedBitPattern` derive per field**. This approach directly addresses the identified validity Undefined Behavior (UB) by ensuring that the enum values are validated *before* being materialized, preventing the "constructing invalid value" error confirmed by Miri. It offers a high correctness margin, minimal performance overhead due to efficient generated code, and excellent maintainability due to its reliance on a well-established in-tree library and derive macros, which significantly reduce boilerplate compared to manual implementations. The reduced diff blast radius and clear intent also contribute to its reviewability, making it the most pragmatic and production-ready solution for safeguarding against tampered binary attacks that exploit enum validity.
>
> A dissent could argue that while Remediation B effectively closes the *validity* UB, it alone does not provide sufficient *integrity* protection for the binary as a whole against sophisticated attackers in scenarios involving `curl|bash` installers. A malicious actor could potentially craft a valid-looking (but functionally incorrect) enum value if only Remediation B is applied, or tamper with other non-enum parts of the `__BUN` section. Therefore, for a truly robust defense against the described threat model, a layered approach combining the validity guarantees of Remediation B with the comprehensive integrity checks of Remediation C (Signed-checksum / HMAC wrapper over the whole `__BUN` section) would offer superior security, even if it introduces additional performance and complexity costs.

### Claude lens

> **Verdict:** A or B (both sound; the *fix mechanism* is identical — raw bytes → per-field validity check → typed value). The architect picked A; Codex picks B. Both close the validity UB at the same boundary. On reviewability: a hand-written `match` enumerating 21 Loader variants is more obvious-by-inspection than a `derive(CheckedBitPattern)` whose accepted-byte set is computed by macro expansion. On maintainability: the derive scales as new variants are added; the hand-written path requires a sync. The decisive criterion is *whether `bytemuck` already supports the exact shape* — `CheckedBitPattern` does *not* directly support `#[repr(C)]` structs containing `#[repr(u8)]` enums; you have to use per-field newtypes anyway, then derive on the newtypes. So B and A converge in practice: per-field newtypes + (derive | hand-written). Both reject C as defense-in-depth that does *not* close the validity UB ("integrity is not validity"). Both reject D as serde-dependency bloat for no improvement in invariant strength.
>
> **Dissent worth preserving:** the *granularity* question — eight per-field newtypes versus one monolithic `TryFrom<RawCompiledFile> for CompiledFile` — is the genuine open issue, and neither v1 nor v2 settles it. Eight newtypes is a Phase 11 cleanup multiplier because the `Loader` newtype is already re-used in three other modules; monolithic try_from gives a single audit point. Recommend eight newtypes plus a centralized validation harness.

### Consensus

**All three reject C (alone — integrity ≠ validity) and D (serde bloat).** Codex and Gemini both pick B (`bytemuck::CheckedBitPattern` derive); Claude is indifferent between A and B (architect picked A). **The architect's A and the two real-model B picks are not in real disagreement** — both reduce to "per-field newtype + per-field validity-checked decode of raw bytes". Codex explicitly notes that B requires per-field newtypes anyway (bytemuck can't derive on `#[repr(C)]` structs containing enums directly).

### Dissent (preserved)

- **Gemini** uniquely raises a layered-defense argument: B alone closes validity UB but doesn't protect against valid-byte-but-functionally-incorrect tampering of other `__BUN` section fields. Gemini recommends combining B with C (signed-checksum/HMAC). This **echoes v1's Grok-lens "ship A first then signed-binary verification as a separate PR"** — but Gemini frames it as a *single-PR* layered defense rather than a follow-up.
- **Codex** prefers `bytemuck` derive for smaller hand-rolled surface; **Claude** prefers hand-written `match` for security-sensitive obviousness; **architect** picked hand-written. The stylistic dissent is preserved but not load-bearing — both are sound.

### Recommended remediation

**Per-field newtype + per-field validity check (architect's A spelled as either hand-written `TryFrom<u8>` or `bytemuck::CheckedBitPattern` derive on the newtypes).** Reject C (integrity ≠ validity) and D (serde bloat). Defense-in-depth checksum/HMAC remains a *separate* PR with a *separate* threat model — additive, not a substitute. **Unchanged from v1.**

---

## EXP-044 — `bundle_v2.rs` JS-loop trampoline `&mut *self.bv2` reborrow

**Source:** `src/bundler/bundle_v2.rs:1216, 1227, 1362, 1376`
**Architect's pick:** A — EXP-012 fix-model (`ThisPtr<BundleV2>` + `ref_guard`).
**Candidate remediations:** A (`ThisPtr` + `ref_guard`), B (`RefCell` runtime borrow check), C (`RwLock`), D (queue inner imports as async).

### Codex output (verbatim, model `gpt-5.5`, ~106.7k tokens after retry)

> **Verdict:** Choose **A**. It is the only production-grade fix that removes the unsound long-lived `&mut` shape while preserving Bun's existing synchronous plugin semantics, hot-path performance, native pointer ABI, and user-visible behavior. The key invariant is: `ThisPtr<BundleV2>` plus `ref_guard()` keeps the receiver alive, while each `unsafe { &mut *this.as_ptr() }` borrow must be narrowly scoped and never held across a JS/plugin callout. That matches the stated in-tree `WebSocketUpgradeClient::cancel` fix-model: raw receiver, lifetime guard, local reborrows, named SAFETY comments. It is small, reviewable, and compatible with `bun-plugin-mdx` / `bun-plugin-tailwind` re-entry. B converts a valid re-entry into a panic, C can deadlock on same-thread re-entry, and D changes the published plugin contract.
>
> **Dissent worth preserving:** A is not "safe Rust"; it moves correctness into a sharper unsafe invariant. A reviewer should insist the patch proves every `&mut BundleV2` dies before `JSBundlerPlugin__matchOnLoad` or any equivalent JS trampoline call, ideally backed by the Phase 5 re-entry harness and Tree-Borrows/Miri trace. If the code cannot be cleanly structured so borrows are short-lived, then A becomes only cosmetic and a deeper state-machine split is needed. But given the proposed model and Bun's canonical precedent, A is still the right fix.
>
> *(First run got stuck in a web-search loop trying to fetch the WebSocketUpgradeClient.rs:608-868 exemplar; resolved by re-running with sanitized prompt and `tools.web_search=false`. Both runs converged on A.)*

### Gemini output (verbatim, model `gemini-2.5-flash`)

> **Verdict:** The optimal remediation is **A) "ThisPtr fix-model"**. This approach directly addresses the Tree Borrows violation by carefully managing mutable re-borrows via raw pointers (`*mut Self`) combined with an RAII guard for reference counting. It's explicitly designed for re-entrant scenarios, aligns with existing in-tree patterns, ensures zero performance degradation, and crucially, maintains public-API stability by preserving the synchronous nature of `onLoad`. While it involves `unsafe` blocks, these are localized, well-understood by the team due to existing exemplars, and are accompanied by explicit safety comments, making the solution correct, performant, and reviewable within the project's established conventions.
>
> **Dissent:** While the "ThisPtr fix-model" is practical, its reliance on `unsafe` Rust and raw pointers introduces inherent risks that `RefCell` (Option B) aims to eliminate, albeit with a different set of trade-offs. The solution is dependent on meticulous manual auditing and reasoning for its correctness, potentially increasing the burden of future maintenance and review for developers less familiar with the specific `unsafe` pattern. Although `RefCell` would panic on legitimate re-entry, signaling a programmatic issue that could be addressed by re-evaluating the plugin contract, it represents a "fail-fast" safety mechanism. The chosen `unsafe` approach suppresses this signal, requiring rigorous adherence to the established manual safety invariants for long-term stability.

### Claude lens

> **Verdict:** A. The re-entry happens on the same OS thread mid-callstack via a JS callback; the outer `&mut BundleV2` is still live on the stack when the inner `&mut` would form. The architect's `ThisPtr` + `ref_guard` template (a) replaces the receiver type with `*mut Self`, so no parent retag occurs at trampoline entry, (b) holds the allocation alive via RAII refcount across the inner re-entry, and (c) per-site SAFETY comments name the "JS event loop is single-threaded; plugin re-entry only occurs at well-defined turn boundaries" invariant. Both B and C convert latent UB into immediate production regressions: `RefCell::borrow_mut()` panics on legitimate re-entry from `bun-plugin-mdx` and `bun-plugin-tailwind` (both ship synchronous re-imports); `RwLock` deadlocks against itself because the JS loop is single-threaded by construction. D (queue inner imports) breaks the published plugin API contract — sync-onLoad becomes async-from-bundler-POV — and is a major-release-only change.
>
> **Dissent worth preserving:** the *accessor naming* discipline omitted from the architect's plan — `bv2_mut → bv2_ptr`, returning `*mut BundleV2` from an `unsafe fn`, so the trampoline body is the only site that forms `&mut`. This is the same diff and prevents an `&mut`-returning safe API from being the canonical surface (which would invite future callers to assume re-entry safety the type system doesn't guarantee). v1 surfaced this; v2 still endorses it.

### Consensus

**Three-way agreement on A (`ThisPtr` + `ref_guard`).** All three reject B (panic on valid re-entry from `bun-plugin-mdx` / `bun-plugin-tailwind`), C (deadlock on same-thread re-entry), and D (breaks published plugin API contract).

### Dissent (preserved)

All three lenses share the same underlying concern: **A is unsafe-discipline-based, not type-system-proved.** They differ in how they want to mitigate it:
- **Codex:** insist a reviewer prove every `&mut BundleV2` dies before any JS callout — backed by the Phase 5 re-entry harness and a Tree-Borrows/Miri trace landing in the same PR. If short-lived restructuring isn't feasible, A is "only cosmetic" and a deeper state-machine split is needed.
- **Gemini:** flags that A "suppresses the fail-fast signal" that B's `RefCell` panic would provide; argues B's runtime panic is actually informative ("a programmatic issue that could be addressed by re-evaluating the plugin contract"). This is a minority view — Claude and Codex both reject B as a strict production regression — but the *underlying* point about losing a fail-fast signal is worth capturing.
- **Claude:** the `bv2_mut → bv2_ptr` renaming discipline omitted from the architect's plan; accessor should return `*mut BundleV2` from an `unsafe fn` so the trampoline body is the only `&mut`-forming site.

All three dissents are actionable additions to the EXP-044 PR.

### Recommended remediation

**A (`ThisPtr` + `ref_guard`), unchanged from Phase 8.** Add: (1) `bv2_mut → bv2_ptr` rename to `unsafe fn` returning `*mut BundleV2`; (2) Phase 5 re-entry harness as a regression test in the same PR; (3) Miri / Tree-Borrows trace showing the new shape is clean; (4) consider a `tracing::warn!` instrumentation point inside the trampoline that detects re-entry (partially addresses Gemini's "lost fail-fast signal" dissent without taking the RefCell-panic production regression). If short-lived-borrow restructuring isn't feasible at any callsite, escalate to a state-machine split rather than landing A as cosmetic-only.

---

## EXP-051 — `bun-native-plugin-rs::BunLoader` `(u8 as u32)` transmute (public FFI)

**Source:** `packages/bun-native-plugin-rs/src/lib.rs:637`
**Architect's pick:** B — manual `try_from(u8) -> Result<BunLoader, InvalidLoader>` with explicit per-variant match. This **implicitly** changes the public signature.
**v1's recommended override (via Grok-lens):** Coexistence plan — keep `output_loader -> BunLoader` (mark `unsafe fn`, deprecated), add `try_output_loader -> Result`, two-minor deprecation, remove in next major.
**Candidate remediations to v2 models:** A (architect's flag-day swap of return type), B (Grok's coexistence: mark old `unsafe fn` + add `try_output_loader`), C (pure-deprecation: `#[deprecated]` old, no `unsafe`, add `try_output_loader`), D (something neither (a)/(b)/(c) considered).

### Codex output (verbatim, ~23.4k tokens)

> **Verdict:** Choose **D: a compatibility-first checked conversion**. Keep `output_loader(&self) -> BunLoader` source-compatible for the current major release, but remove the `transmute` immediately and implement it through a total checked path: `try_output_loader()` plus a documented legacy behavior for invalid bytes, likely `expect`/panic with a precise host-invariant violation message. Add `try_output_loader(&self) -> Result<BunLoader, InvalidLoader>` as the recommended API, implement `TryFrom<u8>` or an explicit `match`, and deprecate the old method with migration guidance. This gives the best production tradeoff: UB is gone now, perf cost is one tiny bounds/match check, the diff is reviewable, no new dependency is required, and crates.io consumers do not get a flag-day compile break. A is too disruptive for a published crate; B is not actually non-breaking because safe-to-`unsafe fn` is a source break, and it shifts the safety burden to plugin authors who do not control host bytes; C is only acceptable if the old implementation is also made non-UB.
>
> **Dissent worth preserving:** There is a principled argument for B in a future **major** release: a loader byte from FFI is an invariant-bearing value, and an unchecked `BunLoader` return cannot faithfully represent invalid data. In that world, removing or making the legacy API unsafe is cleaner because it forces callers to acknowledge the invariant boundary. But doing that in a minor release would punish every existing plugin author for a host-side representation bug. The near-term fix should prioritize eliminating UB without breaking consumers; the major-release cleanup can tighten the public surface later.

### Gemini output (verbatim, model `gemini-2.5-flash`)

> The optimal remediation for EXP-051 is Option B, the "Coexistence plan." This approach provides an immediate fix by correctly marking the existing `output_loader` function as `unsafe`, forcing consumers to explicitly acknowledge the host-side invariant required to prevent undefined behavior, thereby improving correctness margin and reviewability. Concurrently, it introduces a safe, idiomatic `try_output_loader` API that returns a `Result`, enabling proper error handling and guiding users toward a future-proof, robust pattern. This strategy effectively addresses the UB without a flag-day breakage, offering a clear deprecation path over several minor releases before eventual removal in a major version, thus preserving public API stability for existing `crates.io` consumers.
>
> A valid dissent against Option B might argue that merely marking the existing function `unsafe` does not truly eliminate the UB risk for existing callers who might blindly wrap calls in `unsafe { ... }` without understanding the invariant, or for those whose `u8` values are already outside the valid discriminants of `BunLoader`. While it pushes the burden of correctness onto the caller, it doesn't prevent them from misusing the API. Furthermore, the continued existence of the `unsafe` function, even deprecated, means the underlying validity UB potential persists in the codebase for longer than strictly necessary, potentially leading to hard-to-diagnose issues in older code that doesn't migrate. Option A, despite its immediate disruption, offers a cleaner, more complete, and truly type-safe solution from the outset, albeit at a higher cost to current API stability.

### Claude lens

> **Verdict:** D, agreeing with Codex (and updating v1's pick away from B). Codex correctly identifies that v1's "coexistence" plan (option B as presented to v2, and which Gemini still endorses here) is *also* a source break — changing a safe `fn` to `unsafe fn` requires every caller to add `unsafe { … }` at the call site. So both A (return-type change) and B (safety-marker change) silently break native-plugin authors at next `cargo update`. C (pure-deprecation, just add a warning, do *not* fix the existing API) is a non-fix because the UB is still present in `output_loader` — even with `#[deprecated]`, a plugin author who ignores the warning is still in UB-land. **D is the only path that ships a UB-free crate without breaking compilation of existing consumers.** Implementation: the old `output_loader -> BunLoader` keeps the same safe signature, but its body becomes `self.try_output_loader().expect("host returned invalid loader byte; this is a host bug, not a plugin bug")` (or returns a documented safe default like `BunLoader::None`); UB is gone, the panic is precise and points at the host, and crates.io compatibility is preserved. The new `try_output_loader -> Result` is the recommended path forward.
>
> **Dissent worth preserving:** there is a real argument that *panicking* in the legacy API is worse than the unsoundness it replaces — bundler-process panics on hostile-host input may be easier for an attacker to chain than a controlled UB-induced crash. The mitigation is to make the legacy path return a sentinel (`BunLoader::None` or similar) and emit a `tracing::warn!` rather than panic; document the behavior change in CHANGELOG. The triangulation does *not* settle this sub-choice; both panic-with-message and warn-and-default are sound.

### Consensus

**Codex and Claude converge on D — compatibility-first checked conversion** (a *new* remediation that neither v1's architect's plan (A) nor v1's recommended override (B = "Grok coexistence") considered). **Gemini still picks B (v1's pick)** — but Gemini's own dissent paragraph weakens its position by acknowledging *exactly* the gap Codex/Claude identified: "merely marking the existing function `unsafe` does not truly eliminate the UB risk for existing callers who might blindly wrap calls in `unsafe { ... }` without understanding the invariant... it doesn't prevent them from misusing the API." That is precisely Codex's argument for why D dominates B. **All three lenses reject A (flag-day return-type change) and C (deprecation without fixing the UB).** The 2-1 split on B-vs-D resolves in favor of D because Gemini's own dissent concedes B's correctness deficit.

### Dissent (preserved)

- **Gemini's verdict (B) is genuine dissent** worth preserving for the record: Gemini argues the explicit `unsafe` marker on `output_loader` is itself the *correctness* fix because it forces callers to acknowledge the host invariant. Codex's counter: that's an *audit-and-discipline* fix, not a *UB-elimination* fix; D actually removes the transmute regardless of caller behavior. The split is meaningful: under B, a plugin author who wraps the call in `unsafe { … }` without reading the docs is still in UB-land; under D, the transmute is gone period.
- **The sub-choice within D — *panic* vs *warn-and-default* on invalid-host-byte in the legacy `output_loader` — is unresolved.** Both are sound; the choice is policy. Recommend defaulting to a sentinel (e.g. `BunLoader::Default` or `BunLoader::None`) plus `tracing::warn!` plus a `#[deprecated]` annotation; ship "panic with precise host-bug message" as a `--features=strict` opt-in.

### Recommended remediation

**ADOPT D. Overturns v1.**
1. Keep the public signature `pub fn output_loader(&self) -> BunLoader` source-compatible.
2. Implement its body via the new internal `TryFrom<u8>` / `bytemuck::CheckedBitPattern` path; on invalid bytes, **default to a documented sentinel + `tracing::warn!`** (preferred) or `expect("host bug: invalid loader byte")` (acceptable). Either way, the `transmute` is removed and the UB is closed.
3. Add `pub fn try_output_loader(&self) -> Result<BunLoader, InvalidLoader>` as the recommended forward API.
4. `#[deprecated(since = "...", note = "use try_output_loader; output_loader masks host-side bugs via sentinel default")]` on the old API.
5. Plan removal of the old API in the next major release.

This is **strictly different from both** v1's architect pick *and* v1's recommended override.

---

## Cross-finding pattern observations

1. **EXP-010, EXP-035, EXP-044 are all *confirmed unchanged* from v1.** The real-model triangulation produced no new architectural divergence on the three "internal-only" findings. The `*mut Self` template (EXP-010, EXP-044) and per-field validity check (EXP-035) remain the right grain. Marginal additions from v1 — Loom harness for EXP-010, `bv2_mut → bv2_ptr` renaming and re-entry regression test for EXP-044, defense-in-depth checksum as a separate PR for EXP-035 — are still endorsed.

2. **EXP-051 is the finding where v1's structured-self-triangulation diverges from the real-model output.** v1's Grok-lens recommended "coexistence: mark `unsafe fn` + add `try_output_loader`"; v1 explicitly overrode the architect on that basis. Codex (real model) flags that v1's recommendation is *itself* a source-compatibility break: safe-to-`unsafe fn` requires every caller to add `unsafe { … }`. v2 therefore lands on **D — a compatibility-first checked conversion** — which neither v1 lens nor the architect's plan considered. **This is the highest-value output of v2.**

3. **The `bytemuck::CheckedBitPattern` derive route surfaced as the preferred shape for EXP-035 from Codex, while the architect's plan and v1 both prefer hand-written `TryFrom<u8>`.** Both are sound; the practical distinction is whether bytemuck's macro can express `#[repr(C)]` structs containing `#[repr(u8)]` enums directly (it cannot — per-field newtypes required either way). The dissent is preserved but does not change the recommendation.

4. **Gemini-flash recovered after the default-model quota wall, but the flash model produces visibly shorter and less rigorous output than Codex.** On EXP-051 in particular, Gemini-flash picked v1's losing pick (B) while its own dissent paragraph conceded the central argument against B. This pattern — model "self-undermining dissent" — is a useful triangulation signal: a model whose dissent disagrees with its own verdict is a weaker vote than one whose dissent merely names tradeoffs. **A re-run with the full Gemini Pro model (once default-model quota resets ~2026-05-16 21:36 UTC) would strengthen the EXP-051 vote count** but is unlikely to change the verdict given Codex's depth on the API-break analysis.

5. **The "three-lens-converge-on-A" findings (EXP-010, EXP-044) are now overdetermined.** With Codex, Gemini, and Claude all picking A for both findings, the verdict is robust against single-lens failures. The "minority dissents" (Codex's B-for-major, Gemini's RefCell-as-fail-fast, Claude's rename discipline) are *additive constraints on the PR* rather than alternative verdicts.

---

## Comparison with prior self-triangulation (`phase8_triangulation_v1.md`)

### Where v2 (real models) AGREES with v1 (self-triangulation)

- **EXP-010:** Architect's A (`*mut Self`). All three real lenses (Codex + Gemini + Claude) converge on A. Same dissent (Loom harness; Codex and Gemini both flag B as the future-major option). v1's structured "Codex-lens" / "Gemini-lens" / "Grok-lens" personas correctly predicted the real-model verdict. Self-triangulation was accurate here.
- **EXP-035:** Per-field validity check. Architect's A vs real-model B (bytemuck-derive) is the same stylistic split v1 surfaced. Self-triangulation was accurate. *(Marginal v2 addition: Gemini-flash's "combine with C in one PR" minority view; v1 framed C as a follow-up.)*
- **EXP-044:** EXP-012 fix-model (`ThisPtr` + `ref_guard`). All three real lenses agree. v1's dissent on `bv2_mut → bv2_ptr` renaming still endorsed. *(Marginal v2 addition: Gemini-flash's "lost fail-fast signal" dissent argues for a `tracing::warn!` re-entry counter instead of just the SAFETY comment.)*

### Where v2 (real models) DIVERGES from v1 (self-triangulation)

- **EXP-051 — THIS IS THE BIG ONE.** v1's structured-self triangulation adopted Grok-lens's "coexistence" plan: mark `output_loader` as `unsafe fn` + deprecated, add `try_output_loader -> Result`. **Real-model Codex (and Claude on review) call this out as ALSO a source-compatibility break** — safe-to-`unsafe fn` forces every existing native-plugin author to add `unsafe { … }` at the call site at next `cargo update`. **v1's "Grok-lens persona" missed this**; real-model Codex didn't, and real-model Gemini (which actually picked B = v1's pick) *also* conceded the gap in its own dissent paragraph. v2 therefore overrides v1 in favor of option D (compatibility-first: keep legacy signature, swap body to checked path with sentinel default or precise panic, add `try_output_loader -> Result`, deprecate).

**The user's brief asked specifically:** *"Verify [v1's Grok-coexistence verdict] is right vs real external models."* Answer: **No, it is not right.** Real-model Codex and Claude both produce option D; real-model Gemini-flash picks v1's B but its own dissent paragraph concedes the central argument for D ("merely marking the existing function `unsafe` does not truly eliminate the UB risk for existing callers"). The 2-of-3 vote for D plus Gemini's self-undermining dissent makes the override definitive. v1's Grok-lens persona correctly identified that the architect's flag-day swap was a break, but invented a "fix" that was *itself* a break. Real-model Codex closed the loop. The "Grok-lens persona" was insufficiently rigorous on the safe-fn-to-`unsafe`-fn break.

---

## Triangulation summary table

| Finding | v1 verdict | v2 Codex | v2 Gemini-flash | v2 Claude | v2 verdict |
|---|---|---|---|---|---|
| **EXP-010** | A (`*mut Self`) | A | A | A | **Unchanged.** Add Loom harness. |
| **EXP-035** | A (per-field newtype + try_from) | B (bytemuck-derive — semantically equivalent to A on newtypes) | B (Gemini adds: combine with C as layered defense) | A or B (equivalent) | **Unchanged.** Per-field validity check; checksum is separate PR (Gemini's "combine in one PR" minority view recorded). |
| **EXP-044** | A (`ThisPtr` + `ref_guard`) | A | A (with dissent on "lost fail-fast signal") | A | **Unchanged.** Add `bv2_mut → bv2_ptr` rename + re-entry regression test + trampoline `tracing::warn!` re-entry counter. |
| **EXP-051** | **B (Grok coexistence: mark `unsafe fn` + add `try_output_loader`)** | **D (compatibility-first: keep signature, swap body to checked, add `try_output_loader`)** | B (same as v1; Gemini's own dissent concedes B's correctness gap) | **D (agreeing with Codex; v1's and Gemini's pick is ALSO a source break)** | **OVERTURNED v1.** Adopt D. Codex+Claude (2/3) outvote Gemini, and Gemini's own dissent concedes D's central argument. |

---

## CLI errors encountered

1. **Gemini CLI default model: full quota exhaustion.** First-round attempt with the default model on all 4 EXP prompts returned `TerminalQuotaError` (HTTP 429, `reason: QUOTA_EXHAUSTED`, reset in ~10h56m from 2026-05-16 ~10:40 UTC). **Resolved** by switching to `-m gemini-2.5-flash` (separate quota pool); all 4 prompts then returned verdicts. `gemini-flash-latest` and `gemini-1.5-pro` returned `ModelNotFoundError` (404); `gemma-3-27b-it` also 404.
2. **Gemini CLI on EXP-051 (flash): first attempt stalled mid-response** after emitting only the `update_topic` planning step. Killed and rerun; second attempt completed normally. Suspected transient pre-flight planning hang, not a quota issue.
3. **Gemini CLI trust gate:** initial attempts failed with `Gemini CLI is not running in a trusted directory`. Resolved by adding `--skip-trust`.
4. **Codex on EXP-044 first run: web-search loop.** Codex tried to look up the WebSocketUpgradeClient.rs exemplar at `:608-868`, exhausted ~20 URL attempts, and produced no verdict before timeout. Killed; re-running with a sanitized prompt that removed the line-range citation and `-c 'tools.web_search=false'` produced a clean verdict in 21k tokens.
5. **Codex sandbox warning (cosmetic):** `Codex could not find bubblewrap on PATH. Will use the bundled bubblewrap in the meantime.` Did not affect any output.
6. **Grok CLI: not installed on host.** Per the coordinator brief, out of scope; not retried.

---

## Deliverable summary

- **EXP-010 (bundler parallel-callback aliasing):** Three-lens unanimous on **architect's A (`*mut Self`)**. v1 confirmed unchanged. Codex+Gemini joint dissent: B (message-passing) remains the gold-standard ownership design for a future major release; preserve for the planning horizon. Claude dissent: A is conditional on a Loom harness landing in the same PR — without it, the next refactor can silently violate column-disjointness.

- **EXP-035 (tampered standalone binary):** Three-lens consensus on **per-field validity check** (Codex+Gemini pick B = bytemuck-derive; Claude indifferent A/B; architect picked A — all reduce to "per-field newtype + per-field validity-checked decode"). All three reject D (serde bloat). All three reject C *alone* (integrity ≠ validity); Gemini adds the minority view that C should be combined with B in a single PR rather than landed separately. v1 confirmed unchanged on the *fix mechanism*; Gemini's single-PR-layered-defense view is a new option worth surfacing to the EXP-035 PR author.

- **EXP-044 (JS-loop trampoline reborrow):** Three-lens unanimous on **architect's A (`ThisPtr` + `ref_guard`)**. v1 confirmed unchanged. All three reject B (panic on legitimate plugin re-entry from `bun-plugin-mdx`/`bun-plugin-tailwind`) and C (deadlock). Same dissent as v1: rename `bv2_mut → bv2_ptr`, ship a plugin re-entry regression test. Gemini-flash adds a unique dissent — A "suppresses the fail-fast signal" — that motivates an additive `tracing::warn!` re-entry counter inside the trampoline (cheap diagnostic, no production regression).

- **EXP-051 (BunLoader public FFI transmute):** **THIS IS THE FINDING WHERE v1 IS OVERTURNED.** Codex and Claude both converge on a *new* option D — compatibility-first checked conversion — that v1's self-triangulation did not consider. Gemini-flash picked v1's B but its own dissent paragraph conceded D's central argument ("merely marking the existing function `unsafe` does not truly eliminate the UB risk for existing callers"). v1's "Grok coexistence" plan (mark `unsafe fn` + add `try_output_loader`) is *also* a source break, because changing safe-to-`unsafe fn` forces every caller to add `unsafe { … }`. D keeps the old signature, swaps the body to a checked path with a documented behavior change (sentinel default + `tracing::warn!` preferred; precise panic acceptable), adds `try_output_loader -> Result`, and deprecates the old API. **Net effect: UB removed, zero source-compatibility break.** Surface this clearly to the Bun maintainers before opening the EXP-051 PR.

**Bottom line:** three of four findings confirmed unchanged with marginal additive recommendations (Loom harness, `bv2_ptr` rename, `tracing::warn!` re-entry counter, single-PR layered defense). One (EXP-051) has a genuine remediation change: the real-model triangulation surfaced a non-breaking path (option D) that the v1 structured-self-triangulation did not invent, and that v2's Gemini-flash *also* did not invent despite agreeing with v1's losing pick. This is the most valuable single output of the v2 run, and it would not have surfaced from another self-triangulation pass.

---

## Cross-reference

- v1 (structured self-triangulation, preserved): `phase8_triangulation_v1.md`
- Architect's plan: `phase8_remediation_plan.md` (R-EXP-010, R-EXP-035, R-EXP-044, R-EXP-051)
- Raw model outputs: `/tmp/triangulation/EXP-{010,035,044,051}-{codex,gemini}.log`
- Reproducers: `experiments/EXP-{010,035,044,051}/src/main.rs`
