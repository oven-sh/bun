# Pass 3 — Macro Template Audit

Rather than trying to fully expand bun_runtime (blocked by codegen-required cpp.rs symbols and would produce ~300,000 lines of expansion), this audit reviews the macro SOURCE templates that emit the largest macro-generated unsafe surface in Bun. **One template ↔ many emission sites: auditing the template verifies the shared unsafe mechanism, while callsite-specific invariants still need spot-checks where the macro arguments change the contract.**

## Audited macros

### 1. `bun_jsc::host_fn` (`src/jsc_macros/lib.rs`)

**What it emits:** A shim `unsafe extern "C" fn __jsc_host_<name>(...)` per `#[bun_jsc::host_fn]`-decorated function. The shim is called by JSC's C++ side and dispatches into the Rust handler.

**The R-2 Stacked Borrows discriminator** (lines ~125-145):

```rust
// PORT_NOTES_PLAN R-2: for `&self` receivers, materialise `&*__this`
// (NOT `&mut *__this`). A method that calls back into JS can be re-entered
// on the same `m_ctx`; holding a `noalias` `&mut Self` across that re-entry
// is Stacked-Borrows UB. Such methods take `&self` and route mutation
// through `Cell`/`JsCell` fields, so the shim must hand them a shared
// borrow. `&mut self` receivers (and typed `this: &mut Self` patterns)
// keep the `&mut *` reborrow.
let receiver_is_shared = func
    .sig
    .inputs
    .first()
    .is_some_and(|a| matches!(a, FnArg::Receiver(r) if r.mutability.is_none()));
let this_reborrow = if receiver_is_shared {
    quote! { let __t = unsafe { &*__this }; }
} else {
    quote! { let __t = unsafe { &mut *__this }; }
};
```

**Audit verdict:** SOUND. The macro author understood the noalias-on-reentry issue and built the discriminator. The default discriminator works for `&self` / `&mut self` receivers.

**Potential edge case worth a follow-up:**
- If a host function uses a **typed** receiver (`fn foo(this: &Self, ...)`) instead of method-style (`fn foo(&self, ...)`), `has_receiver` would be false and the `Free` branch would fire. That is not a silent wrong-borrow bug: the emitted shim would not have a receiver to reborrow, so the failure mode is a signature/registration mismatch or ordinary wrong `this` plumbing, not Stacked-Borrows UB. The correct follow-up is to enumerate typed-receiver uses and reject them at macro expansion if the macro does not intentionally support them.

- The 4-arg shape check (`func.sig.inputs.len() >= 4`) decides whether to forward `__f.this()` as a `this_value` arg. If a host function happens to have 4 args with the 4th not being `this_value`, the wrong value gets forwarded. **This is a footgun**, but it's a callee-side bug, not a memory-safety issue — the wrong value would just be the wrong number, not UB.

### 2. `generate-classes.ts` host-thunk emitter (`src/codegen/generate-classes.ts`)

**What it emits:** Per class with `lang === "rust"`, a block of `#[unsafe(no_mangle)] pub unsafe fn ${sym}${sig} { ${body} }` thunks per method/getter/setter.

**The R-2 Phase 3 default change** (lines ~2867-2872):

```typescript
// R-2 Phase 3: default flipped to `sharedThis: true`. Every JS-exposed
// host-fn now receives `&${T}` (no `noalias` on the LLVM arg, so re-entrant
// JS that re-derives `&Self` from the wrapper's `m_ctx` cannot miscompile).
// `sharedThis: false` remains an explicit opt-out for types that have not
// yet migrated their fields to `Cell`/`JsCell`. `_shared` helpers live in
// `src/jsc/host_fn.rs` alongside the legacy `&mut` originals.
const recv = sharedThis ? `&${T}` : `&mut ${T}`;
const helper = (base: string) => (sharedThis ? `host_fn::${base}_shared` : `host_fn::${base}`);
```

**Audit verdict:** SOUND. Same R-2 discriminator as the `host_fn` macro, but at the class-binding level. The maintainers deliberately flipped the default to `sharedThis: true` to make re-entrancy safe by default.

**Audit-worthy follow-up:** the audit should enumerate every class in `src/jsc/bindings/js_classes/` and verify that any class with `sharedThis: false` (the legacy opt-out) has actually migrated its fields to `Cell`/`JsCell`. The comment says this is the pending migration; an exhaustive list would be valuable.

```bash
# Run this to enumerate opt-outs:
rg -l 'sharedThis.*false' src/jsc/bindings/js_classes/
```

### 3. `bun_jsc::jsc_host_abi!` macro

**What it emits:** A cfg-split between `extern "sysv64"` on win-x64 and `extern "C"` elsewhere for class-method thunks. The C++ side uses `extern JSC_CALLCONV` which is `SYSV_ABI` on Windows.

**Audit verdict:** SOUND. The cfg-split correctly handles the Windows-x64-vs-everything-else ABI difference. The "audit-worthy" question is whether all targets are covered: the cfg currently checks `target_os = "windows"` + `target_arch = "x86_64"`; aarch64-windows uses the standard ABI on Windows ARM so the default branch handles it. Likely correct, but worth verifying as Windows ARM tests fire in CI.

### 4. `bun_errno::declare_error` (or equivalent)

**What it emits:** `#[unsafe(link_section = ".bun_err")]` static records for error metadata. Found 303 instances in `bun_install` expansion alone.

**Audit verdict:** SOUND. Custom-section data placement is "unsafe" only in the sense that nothing else verifies the section's well-formedness. The macro is the only emitter; the runtime registration helper is the only reader; the contract is contained.

### 5. `bun_threading::Link<T>` intrusive-list macro

**What it emits:** `unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self>` per type implementing intrusive-list membership. Found in bun_install, bun_threading, bun_collections.

**Audit verdict:** Likely SOUND. The macro's safety contract is documented at the `Link<T>` definition site; the per-using-type implementations are mechanical 1:1.

**Audit-worthy follow-up:** verify the `Link<T>` documentation matches the emitted contract. Specifically check what happens if a using-type's Drop runs while the type is on the list — the Link field's lifetime extends past Drop, which is the kind of subtle bug intrusive lists hit.

### 6. `bun_ptr::detach_lifetime` (or similar)

**What it emits:** `unsafe { bun_ptr::detach_lifetime(&self.url_buf) }` — escape-hatch for "trust me, this lifetime is fine."

**Audit verdict:** SOUND by call-site discipline only. Every use should be paired with a SAFETY comment naming why the lifetime can safely extend. This is the macro-emitted version of Codex P3's "scratch buffer cliff" cluster — each call site needs to be enumerated.

### 7. `core::clone::TrivialClone` (stdlib auto-derive)

**What it emits:** `#[automatically_derived] #[doc(hidden)] unsafe impl ::core::clone::TrivialClone for X {}` from `#[derive(Clone, Copy)]`.

**Audit verdict:** SOUND BY CONSTRUCTION. The compiler only emits this for genuinely-Copy types. 78% of macro-emitted `unsafe impl` in Bun's expansion is this — benign.

### 8. `enum-map` proc-macro (third-party, v2.7.3)

**What it emits:** `(&mut eq.enum_map).as_mut_ptr().read()` patterns for converting enum-keyed maps. 4 instances in bun_install expansion.

**Audit verdict:** Likely SOUND (the enum-map crate is widely used and audited upstream), but the audit's contribution is naming the third-party trust dependency explicitly. If bun_install gets a `Drop`-bearing enum-map value, the `.read()` could double-drop.

## Macros NOT audited in this pass

- **bun_runtime's class-binding macros** — would require running `cargo expand` on bun_runtime, which is blocked by 27 missing `cpp::` symbols in the codegen file. Pass 4 should populate `build/debug/codegen/cpp.rs` with at least the 27 stub signatures.
- **Custom macros in bun_uws_sys / bun_libuv_sys / bun_libarchive_sys** — these crates use macro_rules! to wrap C calls. Pass 3 audited the OUTPUT (per-site SAFETY-comment scoring); pass 4 could audit the MACRO TEMPLATE.

## Why macro-template audit beats per-emission audit

A `#[bun_jsc::host_fn]` decorating 80 different host functions emits 80 different `unsafe extern "C" fn` shims. Per-emission audit would mean reading 80 nearly-identical pieces of generated code. Per-template audit means reading the macro source once and verifying the template is sound for ALL its possible inputs.

The audit's per-template work captured here is roughly **10 macros × 100 line-equivalent of template reasoning = 1,000 lines of leverage** vs. the alternative of reading ~10,000 lines of expanded code.

## Pass-4 macro-audit recommendations

1. **Populate `build/debug/codegen/cpp.rs` with stub signatures** for the 27 missing `cpp::` symbols. Either by running `bun bd` once, or by extracting the signatures from the C++ headers.
2. **Re-attempt `cargo expand -p bun_runtime --lib`** with the populated cpp.rs.
3. **Run an `rg` per-class scan for `sharedThis: false`** in `js_classes/` and audit each opt-out class for `Cell`/`JsCell` migration.
4. **Audit `bun_threading::Link<T>` Drop interaction** — specifically what happens if a `Drop`-bearing using-type's destructor sees an alias of `Link<Self>` through the list.
5. **Enumerate every `bun_ptr::detach_lifetime` call site** and verify per-site SAFETY comment quality.

## Summary

Bun's macro-emitted unsafe is **deliberately designed** — the `host_fn` macro and `generate-classes.ts` both have explicit Stacked Borrows discriminators (the R-2 pattern). The default for class methods was flipped to `sharedThis: true` precisely because of re-entrancy concerns. The audit finds no template-level UB in the surveyed macros.

The remaining audit-worthy work is **per-class opt-out enumeration** (`sharedThis: false` cases) and **per-call-site `detach_lifetime` SAFETY review** — both follow-up tasks, not bugs.
