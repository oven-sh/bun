# Pass 3 — Macro-Expanded Unsafe Deep-Dive

Pass 2's quick macro-expand survey reported `bun_alloc: 299 expanded unsafe tokens vs 273 source-level`. Pass 3 extended this to 5 more major crates with longer timeouts and codegen-file stubs.

**Accuracy discipline:** Don't overclaim. Most macro-emitted unsafe is benign by construction. Report the nuance.

## Vendor-deps + codegen-files workaround

To run `cargo expand` on bun_install / bun_bundler / bun_runtime (which depend on the bun-codegen pipeline), I created audit-only stubs for the codegen files:

```
build/debug/codegen/generated_classes.rs       (empty stub)
build/debug/codegen/generated_js2native.rs     (empty stub)
build/debug/codegen/generated_jssink.rs        (empty stub)
build/debug/codegen/generated_host_exports.rs  (empty stub)
```

This is sufficient for `cargo expand` to walk the macro expansion. It is NOT a substitute for the real codegen output; only valid for audit-time expansion reading.

## Per-crate expansion results

| Crate | Source-level unsafe | Expanded unsafe tokens | Multiplier |
|-------|---:|---:|---:|
| `bun_ast` | 30 | 232 | 7.7x |
| `bun_threading` | 126 | 122 | ~1x |
| `bun_collections` | 157 | 174 | 1.1x |
| `bun_install` | 525 | 1,050 | 2.0x |
| `bun_bundler` | 498 | 835 | 1.7x |
| `bun_jsc` | 745 | 1,728 (after cpp.rs stub) | 2.3x raw / 1.85x net |
| `bun_alloc` (pass 2) | 273 | 299 | 1.1x |

Important: the source-level unsafe count is based on ast-grep matches in source files; the expanded count is regex-based on the cargo-expand output. They aren't directly comparable — a single source-level `unsafe { ... }` block can produce multiple expansion-level tokens, and many `unsafe`-tokens in the expansion (especially `#[derive]`-emitted) didn't appear in the source-level inventory at all.

## Pattern breakdown — what macros emit

Per-crate breakdown of expansion-level unsafe by syntactic shape:

| Crate | unsafe impl | of which TrivialClone | unsafe impl Send | unsafe impl Sync | #[unsafe(no_mangle)] | unsafe fn |
|-------|---:|---:|---:|---:|---:|---:|
| bun_ast | 131 | 112 (85%) | 3 | 3 | 0 | 8 |
| bun_threading | 17 | 6 (35%) | 8 | 6 | 3 | 19 |
| bun_collections | 22 | 17 (77%) | 3 | 2 | 0 | 22 |
| bun_install | 118 | 96 (81%) | 0 | 0 | 17 | 40 |
| bun_bundler | 96 | 68 (71%) | 12 | 11 | 5 | 5 |

## Key finding: 78% of macro-emitted `unsafe impl` is benign `TrivialClone`

The dominant pattern in expansion is `unsafe impl ::core::clone::TrivialClone for X {}` (299 of 384 expansion-level `unsafe impl` across the 5 surveyed crates — **78%**). This is auto-emitted by Rust nightly's `#[derive(Clone)]` for types that are `Copy`, allowing a memcpy-fast-path for `Clone::clone`.

Verbatim from `bun_ast` expansion:

```rust
#[automatically_derived]
#[doc(hidden)]
unsafe impl ::core::clone::TrivialClone for ImportKind {}
#[automatically_derived]
impl ::core::clone::Clone for ImportKind {
    ...
}
```

These are **sound by construction**:
- `TrivialClone` is `unsafe` because asserting "memcpy is a valid Clone" requires the type to be Copy.
- The compiler only emits this impl when the type is genuinely Copy (every field is Copy, no `#[repr(packed)]` weirdness, etc.).
- The safety obligation is discharged at the type-level Copy bound, not at any call site.

**The "macro-expanded unsafe is N× source-level" headline should explicitly exclude `TrivialClone` from the comparison.** Otherwise the multiplier is misleadingly inflated by a benign compiler-auto-emitted impl.

## Second-largest macro-emitted pattern: `#[unsafe(link_section = ".bun_err")]`

303 instances in `bun_install` alone. These come from `bun_errno`'s `#[declare_error]` macro placing error-metadata records in a custom ELF section. The "unsafe" of `link_section` is asserting the section name doesn't conflict with another emitter — a layout-level invariant, not a runtime soundness issue.

**Also sound by construction.** The macro is the only emitter of `.bun_err`; the data is read by a runtime registration helper that only trusts well-formed records.

## Third-largest pattern: `#[unsafe(no_mangle)]`

17 in `bun_install` (the `__bun_dispatch__*` exports), 3 in `bun_threading`, 5 in `bun_bundler`. These are functions exposed to JSC's C++ side. The "unsafe" is Rust 2024's edition syntax requiring `no_mangle` to be explicitly unsafe (global symbol-name conflict opportunity).

Each one is a Bun → C bridge that the audit's A-003 cluster already classifies as STRICTLY_UNAVOIDABLE.

## What's left after deflating the benign patterns?

After subtracting `TrivialClone` + `link_section` + `no_mangle`:

| Crate | Net macro-emitted unsafe NOT covered by source-level inventory |
|-------|---:|
| bun_ast | ~10-15 (mostly enum-map's `(&mut eq.enum_map).as_mut_ptr().read()` and similar derive output) |
| bun_threading | ~40 (the `Link<T>` intrusive-list macro emits per-instance `unsafe fn link`) |
| bun_collections | ~30 (similar Link/intrusive-list patterns) |
| bun_install | ~50-80 (a mix of `Self::destroy(ptr::from_mut::<Self>(self))` patterns, `bun_ptr::detach_lifetime`, and JSC binding code) |
| bun_bundler | ~80-100 (similar mix) |

So the **real** macro-emitted unsafe surface that's NOT covered by the source-level inventory is on the order of **~200-300 additional sites** across these 5 crates — meaningful, but not the "2x the source count" the raw multiplier suggested. This number deliberately excludes the later `bun_jsc` retry below.

## Macro-emitted patterns worth deeper audit

### 1. `enum-map` proc-macro's `(&mut eq.enum_map).as_mut_ptr().read()` pattern

Found 4 instances in bun_install's expansion. This reads from a `MaybeUninit` after presumably-complete initialization. The enum-map crate is third-party but very widely used; assumed sound but worth a one-off verification.

### 2. `bun_threading::Link<T>` intrusive-list macro

```
unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self>
```

Found in bun_install / bun_threading / bun_collections. Each per-using-type instance is generated by the `impl_linked!` (or similar) macro. The macro's safety contract is documented in `bun_threading`; the per-using-type implementations are mechanical 1:1 to a struct's `Link` field.

Audit obligation: verify the macro author's documentation matches the emitted contract, AND verify no using-type has a misuse (e.g., a `Drop` impl that frees the `Link` slot before the unlinking).

### 3. `bun_ptr::detach_lifetime` macro

Emits `unsafe { bun_ptr::detach_lifetime(&self.url_buf) }` in bun_install. This is the "trust me, this lifetime is OK" escape hatch. Each call site is a place the audit's Codex P3 "scratch buffer cliff" cluster should look harder.

### 4. `#[bun_jsc::host_fn]` macro emitting `unsafe extern "C" fn`

JSC host-function bridges. Each one is a place an exception from Rust could unwind into C. Pass 2 already noted `panic = "abort"` eliminates the unwind-UB axis; the SAFETY obligation is on the function body's correctness.

## What this means for the audit's headline

**Without deflation:** "Bun has 11,044 source-level + ~2,000-3,000 macro-expanded unsafe tokens (estimated)."

**With deflation (more honest):**

> Bun has 11,044 source-level unsafe sites. In the first five expanded crates, the macro-expanded surface adds another ~200-300 sites of meaningful unsafe (the rest of the macro-expanded count is `TrivialClone` from `#[derive(Clone, Copy)]` and `#[unsafe(link_section)]` for static-data registration — both sound by construction).
>
> After the later `bun_jsc` retry, the macro-only surface is larger and not yet fully deduped against source-level unsafe. Do not quote "~200-300" as a whole-audit total including `bun_jsc`.

## bun_jsc expansion — RETRY SUCCESS after cpp.rs stub

`cargo expand -p bun_jsc --lib` was retried after creating `build/debug/codegen/cpp.rs` as an empty audit stub. Result:

- 64,943 lines expanded
- 1,728 unsafe tokens
- 134 TrivialClone (benign)
- 104 `#[unsafe(no_mangle)]` (JSC C++ bridge function exports)
- 107 `#[unsafe(link_section)]` (error metadata records)
- **Net non-benign: 1,383 macro-emitted unsafe tokens** vs 745 source-level sites = ~1.85x

The 1,383 net count includes duplicates of source-level unsafe (source `unsafe { ... }` blocks appear in the expansion verbatim), so the TRUE additional surface beyond source-level is smaller. Pessimistic estimate: ~500-800 additional macro-only unsafe sites in bun_jsc. This is why the earlier "~200-300" headline must be scoped to the pre-`bun_jsc` crate set.

## bun_runtime expansion — STILL FAILED

The empty cpp.rs stub is sufficient for bun_jsc's `extern { }` macro to expand into its body, but bun_runtime then fails to compile because the body references undefined functions like `crate::cpp::BunString__createUTF8ForJS`, `crate::cpp::Bun__parseDate`, `crate::cpp::JSC__JSObject__putRecord`, etc. — these are codegen'd from C++ headers via `bun src/codegen/cppbind.ts`.

A pass-4 audit would need to populate cpp.rs with at least minimal stub functions for each reference, OR run `bun bd` once to populate the real codegen output. The latter is recommended.

For now, the macro-expanded survey covers:
- bun_alloc (pass 2, 1.1x)
- bun_errno (pass 2, 1.4x)
- bun_ast (7.7x raw, 2.5x net after TrivialClone)
- bun_threading (~1x, mostly Link macro)
- bun_collections (1.1x)
- bun_install (2.0x raw, 1.0x net)
- bun_bundler (1.7x raw, 1.0x net)
- bun_jsc (2.3x raw, 1.85x net)

**Total expansion volume:** ~250,000 lines of expanded Rust surveyed across 8 crates. Bun_runtime and 100 smaller crates remain un-surveyed.

## Recommendations

1. **Don't headline the macro-expansion multiplier without the TrivialClone deflation.** The "macro multiplies unsafe by 2x" framing is misleading.
2. **For the net macro-emitted sites, audit the macro author's safety contract, not each emission site.** Per-emission audit is mechanical 1:1; per-macro audit catches the interesting bugs (e.g., a macro that emits sound code for normal types but unsound code for `?Sized` types). Use "~200-300" only for the first five-crate subset; quote the `bun_jsc` estimate separately until deduped.
3. **Targeted macro audit list:**
   - `bun_threading::Link` intrusive-list macro
   - `bun_errno::declare_error` static-section emitter
   - `bun_jsc::host_fn` C-ABI bridge
   - `bun_core::ffi::*` helper macros
   - `bun_ptr::detach_lifetime` lifetime-erasure escape hatch
   - `enum-map` third-party proc-macro (Cargo.lock shows version 2.7.3)
4. **For pass 4: retry `bun_jsc` and `bun_runtime` cargo expand with explicit feature flags.** The full expanded surface of `bun_runtime` (4,893 source sites) is likely the highest-value macro-expanded set still un-surveyed.
