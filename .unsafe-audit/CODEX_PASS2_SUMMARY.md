# Codex pass 2 summary

**Harness:** Codex / GPT-5.x applying `rust-unsafe-code-exorcist` as a second, adversarial pass over the Claude Code audit.
**Date:** 2026-05-15.
**Repository head audited:** `428f61eb3486` (`Bun.serve: finish h3/h1 -> http3/http1 ServerConfig rename in Rust (#30741)`).
**Scope:** Rust code under `src/`; no source edits, no beads filed, no GitHub pushes.

This pass did not replace the existing Claude Code audit. It stress-tested it against the skill rubric, Bun's current source, and the reviewer's own pushback. The result is an addendum layer that preserves the first pass while making its claims sharper.

## Added artifacts

- `audit/synthesis/codex-pass2-architecture-map.md` — Rust workspace architecture and unsafe reachability map.
- `audit/synthesis/codex-pass2-phase-gap-analysis.md` — phase-by-phase skill compliance and remaining polish-bar gaps.
- `audit/synthesis/codex-pass2-adversarial-reclassification.md` — corrected classifications, strengthened findings, and new watchlist items.
- `audit/synthesis/codex-pass2-safety-comment-gap.md` — heuristic SAFETY-comment coverage index.
- `audit/plans/CODEX-P2-windows-waker-placeholder.md` — focused remediation plan for the stale Windows `BundleThread` placeholder branch.

## Pass-2 headline

The first-pass conclusion is broadly right: Bun's Rust unsafe is not random. Most of it is a structured porting layer for FFI, JavaScriptCore handles, arena-backed AST data, allocator/syscall wrappers, and cross-thread task dispatch.

Codex pass 2 changes the audit in four ways:

1. It downgrades several "demo PR" claims until they are mechanically corrected.
2. It upgrades one Windows-only stale unsafe branch to a focused remediation plan.
3. It promotes an in-tree `TODO(ub-audit)` around parallel chunk generation to an explicit watchlist item.
4. It converts vague "SAFETY-comment coverage" language into a reproducible heuristic baseline.

## Confirmed or strengthened findings

### P0: `StoreSlice<T>` unbounded Send/Sync remains the strongest finding

`src/ast/nodes.rs:339-340` still has:

```rust
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}
```

The sister type `StoreRef<T>` immediately above is bounded as `T: Send` / `T: Sync` and its comment explicitly names the laundering risk. This is still the cleanest first PR: tiny patch, strong story, low ambiguity.

### P1: `usize -> SystemErrno` remains a real latent soundness bug

`src/errno/linux_errno.rs:175-188` still transmutes a value in `[0, 4096)` into an enum with dense discriminants `0..=133`. Current call reachability appears dead, but the impl is public and the SAFETY comment is false. The first pass's proposed `strum::FromRepr` direction is correct.

### P1/P2: Windows `BundleThread::uninitialized()` still bypasses the safe placeholder

`src/io/lib.rs` now defines `Async::Waker::placeholder()` for Linux, macOS, and Windows. But `src/bundler/BundleThread.rs:147-155` still uses the placeholder only on Unix and falls back to `zeroed_unchecked()` on Windows under a comment that says it is "technically invalid_value UB".

Even if the current `WindowsWaker { loop_: Option<BackRef<_>> }` layout makes all-zero a valid `None` on today's compiler, this branch is stale and unnecessary. The reviewable fix is `#[cfg(windows)] waker: Async::Waker::placeholder()`.

### Watchlist: parallel bundler chunk generation has an in-tree `TODO(ub-audit)`

`src/bundler/Chunk.rs:130-132` says `Renamer<'r>` still borrows `&'r mut` and is reborrowed mutably from each parallel part-range task, even though the printer only reads it. `generateCompileResultForJSChunk.rs:54-62` and `generateCompileResultForCssChunk.rs:38-47` materialize `&mut LinkerContext` / `&mut Chunk` in each task while peer tasks hold their own views.

This is not marked as a confirmed bug in pass 2 because the implementation needs a call-graph pass over the printer. It is, however, exactly the kind of Stacked Borrows hazard the skill is designed to surface and should be tracked explicitly.

## Corrected first-pass claims

1. **C-001 count is over-optimistic until the const site is removed or handled.** `S-000286` is inside `pub const fn StoreRef::from_static`; `NonNull::from(r)` is not a drop-in replacement on the pinned toolchain. Treat C-001 as **at least 22 firm safe rewrites**, not 23, until the per-site const scan is complete.
2. **C-002 should standardize on `strum::FromRepr`, not `num_enum`.** `strum` is already a workspace dependency and the top-level review agrees. Older plan sections and bead text still mention `num_enum`; they should be harmonized before Phase 11.
3. **C-003 should not assume a `static_assertions` dependency.** `static_assertions` is not present in `Cargo.toml` or `Cargo.lock`. Bun already uses a zero-dependency compile-time auto-trait trick in `src/runtime/shell/subproc.rs`; use that style unless maintainers explicitly accept a new dependency.
4. **The (B) bucket needs measurement logs before it is "proven hot."** The plan is good, but the artifact does not contain hyperfine/bench output. Until then, write "B-candidate" or "B-UNMEASURED", not final B.

## Verification status

No Bun source changes were made in this pass, so I did not run `bun bd test`.

Lightweight verification performed:

- Re-read root `CLAUDE.md`, root `README.md`, `src/CLAUDE.md`, and `src/jsc/bindings/v8/AGENTS.md`.
- Re-ran the skill prerequisite/toolchain check; `cargo-geiger`, `cargo-mutants`, and `hyperfine` are now detected in `phase0_toolchain.json`.
- Recomputed inventory summaries from `unsafe-inventory.jsonl`.
- Spot-checked the source lines backing every pass-2 correction above.

Still missing for a soundness claim:

- `cargo +nightly miri test -p bun_ast --lib` after the `StoreSlice<T>` patch.
- Targeted Windows compile/check for the `BundleThread` placeholder change.
- A small bundler regression fixture for the `Renamer<'r>` parallel fan-out watchlist.
- Hyperfine or Bun's benchmark output for every site kept as (B).

