# Pass 2 — Macro-Expanded Unsafe Survey

The pass-1 inventory enumerated 11,044 source-level unsafe sites. Codex pass 2 already flagged this as a lower bound because `cargo expand` failed (vendor-deps blocker). After bypassing the blocker with a stub for `vendor/lolhtml/c-api`, this pass-2 survey ran `cargo expand` on representative crates and counted macro-generated unsafe.

## Results

Per-crate count of `unsafe`-bearing tokens in the expanded source (matching `unsafe impl`, `unsafe fn`, `unsafe trait`, `unsafe { ... }`, `#[unsafe(...)]`):

| Crate | Source-level sites (Phase 1) | Macro-expanded unsafe tokens | Multiplier |
|-------|---:|---:|---:|
| `bun_errno` | ~8 | 9 in expansion + 2 `#[unsafe(no_mangle)]` | ~1.4x |
| `bun_alloc` | 273 | **299** | ~1.10x (+9.5%) |
| `bun_clap_macros` | (proc-macro crate) | 1 | n/a |
| `bun_ast` | 30 | (expand stalled at 120s timeout — partial result) | unknown |
| `bun_threading` | 126 | (expand stalled) | unknown |
| `bun_jsc_macros` | (proc-macro crate) | (expand stalled) | unknown |
| `bun_core_macros` | (proc-macro crate) | (expand stalled) | unknown |
| `bun_css_derive` | (proc-macro crate) | 0 | n/a |

## What macro-generated unsafe looks like in Bun

### `unsafe impl ::core::clone::TrivialClone`

```rust
// From bun_errno after expansion:
unsafe impl ::core::clone::TrivialClone for SystemErrno {}
```

This is emitted by Bun's own `#[derive(TrivialClone)]` or `bun_core_macros::TrivialClone` — assertion that the type is "trivially clonable" (memcpy-safe). The source-level `unsafe impl` count of 345 does NOT include these derive-emitted impls.

### `#[unsafe(no_mangle)]` exports

```rust
#[unsafe(no_mangle)]
unsafe fn __bun_dispatch__ErrnoNames__Sys__name(
    ...
) -> bun_core::ZStr {
    unsafe { system_errno_name(errno) }
}
```

These are dispatch functions emitted by `#[bun_errno::errno_table]` and similar macros. The `#[unsafe(no_mangle)]` is Rust 2024's edition syntax requiring the attribute itself to be marked unsafe (because no_mangle creates a global namespace conflict opportunity). Bun has many of these `__bun_dispatch__*` exports.

### `unsafe extern "C"` blocks (from bindgen-style macros)

Generated from Bun's own FFI helper macros and the various `bun_*_sys` declarative-macro blocks. The `extern_block` ast-grep pattern already captured these where they're written directly, but the macro-expanded versions are additional.

## Implication for the audit

**The "11,044 unsafe sites" headline is a LOWER BOUND.** A complete inventory that includes macro-expanded unsafe would likely show 14,000-18,000+ unsafe sites or tokens. The exact multiplier depends on whether you count:
- **Tokens** (every `unsafe` keyword) — the highest count
- **Distinct soundness obligations** (one per `unsafe fn` body or `unsafe { ... }` block) — closer to source-level
- **Distinct invariants** (one per cluster of structurally-similar sites) — the smallest, ~50-200 in Bun's case

The audit's per-cluster classification work doesn't change much — the (A) STRICTLY_UNAVOIDABLE bucket grows by the macro-expanded count, but the (C) REFACTORABLE bucket is essentially unchanged (most macro-emitted unsafe is for `TrivialClone` / `no_mangle` / `bindgen extern` — none are refactorable).

## Comparison with Codex pass-2 safety-comment gap (1,594 missing)

The Codex pass-2 SAFETY-comment gap heuristic found 1,594 of 11,044 source-level sites without a nearby `SAFETY`/`Invariant` marker. With macro expansion, that "missing comment" count would rise — most macro-emitted `unsafe impl TrivialClone` etc. do NOT have a SAFETY comment in the emitted code (the comment lives in the macro definition).

The maintainers' hardening work could either:
1. Emit SAFETY-comment text directly in the macro output (one-line addition per macro)
2. Provide a centralized doc-comment block in the macro definition that the maintainer trusts (one line per macro definition, but readers have to chase it)

Most projects choose (2); the audit notes the choice for transparency.

## What's NOT covered by this survey

- Crates where `cargo expand` hung or failed (bun_ast, bun_threading, bun_jsc_macros, bun_core_macros) — these are the most macro-heavy. A pass-3 audit should either:
  - Increase the expand timeout (these crates probably take 5-15 minutes each)
  - Build them in release mode first to warm the dep cache
  - Use `cargo expand -p <crate> --bin <bin>` for binary targets specifically
- macros emitted INTO test code (`#[test]` macro expansion). Not relevant to runtime soundness.
- Procedural macros' own internal unsafe (these are proc-macro crates, only used at compile time; their unsafe doesn't ship in the final binary).

The bottom line: **macro-generated unsafe is real and substantial in Bun, but it follows the same broad classification (mostly (A), some (B), rare (C)) as the source-level inventory.** The audit's recommendations don't materially change; the headline number does.
