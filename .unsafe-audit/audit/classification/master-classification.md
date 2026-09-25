# Phase 4 — Master Classification

This document tallies the (A) / (B) / (C) verdict for every cluster in the audit. Per-site verdicts live in the per-cluster plan files (`../plans/*.md`).

**Pass:** 1 of N (the user is running multi-harness triangulation).

**Iteration discipline reminder:** Phase 4 reapplies until two consecutive passes flip <5% of sites AND zero (A)→(C) flips. This first pass establishes the baseline; subsequent passes from Phase 6 adversarial reclassification will test each verdict.

## Codex pass 2 amendment

Codex pass 2 is the first adversarial reclassification pass. It preserves the
overall shape of this table but applies these corrections:

- C-001 has **23 technically refactorable** sites, but only **22 firm demo-PR**
  sites until the `const fn` `StoreRef::from_static` site is excluded or solved.
- C-002 should use **`strum::FromRepr`**, not `num_enum`.
- C-003 assertion rewrites must use Bun's no-dependency auto-trait proof pattern
  or explicitly add an assertion dependency; `static_assertions` is not present
  today.
- B-001/B-002 are **B-candidates** until benchmark logs are attached.
- Add CODEX-P2: Windows `BundleThread` waker placeholder as a focused
  remediation/watchlist item.

## Codex pass 3 amendment

Codex pass 3 adds cross-cutting safe-API soundness clusters. These are not
single unsafe-site refactors; they are places where safe Rust APIs expose a
contract that is weaker than the implementation requires.

- **P3-XTHREAD:** cross-thread task context traits and `owned_task!` need either
  `Send` bounds, `unsafe trait` contracts, or a worker-state/JS-completion split.
- **P3-STATIC-MUT:** output writers and thread-local scratch-buffer APIs return
  references whose aliasing/lifetime contracts are not encoded in their safe
  signatures.
- **P3-SELFREF:** movable self-referential port artifacts (first concrete:
  `PackageFilterIterator`) need pinning or owning combined types.
- **P3-PM-TASK:** package-manager resolve tasks store `&'static mut NetworkTask`
  across thread-pool boundaries; the intended model is raw pointer or pool index.

## Cluster verdicts

| Cluster | Sites | Verdict | Confidence | Plan |
|---------|------:|---------|------------|------|
| **C-001** NonNull::new_unchecked from reference source | 40 | **(C) REFACTORABLE** for 23 sites (22 firm demo-PR sites after excluding `StoreRef::from_static` const blocker); (A) for 17 | High | [plans/C-001-nonnull-from-reference.md](../plans/C-001-nonnull-from-reference.md) |
| **C-002** mem::transmute<int, enum> with bounded input | ~30 | **(C) REFACTORABLE** for most; **pre-existing-ub** for any with unbounded input | High (pending agent completion) | plans/C-002-transmute-to-enum.md |
| **C-003** propagating `unsafe impl<T: Send>` | ~40 | **(C) REFACTORABLE** via NonNull + PhantomData; (A) for raw-ptr-to-C-state | Medium (pending agent completion) | plans/C-003-send-sync-impls.md |
| **C-004** custom helper functions wrapping single unsafe ops | ~200 | Mix (C)/(A); per-caller analysis required | Medium | plans/C-004-helper-functions.md (deferred) |
| **C-005** `Self::xxx(this)` in pure-Rust callers | TBD | **(C) REFACTORABLE** where call graph permits | Low (needs rustdoc JSON) | plans/C-005-pure-rust-this.md (deferred) |
| **A-001** Zig-port `*mut Self` at FFI callbacks | ~1,610 | **(A) STRICTLY_UNAVOIDABLE** for most; (C) for pure-Rust subset | High | plans/A-001-zig-port-mut-self.md |
| **A-002** `bun_core::heap::take`/`destroy` round-trips | 204 | **(A) STRICTLY_UNAVOIDABLE** | High | [plans/A-002-heap-roundtrip-audit.md](../plans/A-002-heap-roundtrip-audit.md) (deferred) |
| **A-003** `*_sys` FFI shim crates | ~1,200+ | **(A) STRICTLY_UNAVOIDABLE** | High | plans/A-003-ffi-shim-hardening.md |
| **B-001** `unreachable_unchecked` in match tails | ~12 | **(B) CANDIDATE** until measurement | Medium | plans/B-001-and-B-002-perf-only.md |
| **B-002** `get_unchecked` on bounded indices | 13 | **(B) CANDIDATE** until measurement | Medium | plans/B-001-and-B-002-perf-only.md |
| **B-003** `MaybeUninit::assume_init` in in-place init | ~120 | (B)/(C) mix per site | Low (per-site triage needed) | plans/B-003-maybe-uninit.md (deferred) |
| **CODEX-P2** Windows `BundleThread` waker placeholder | 1 | Remediation/watchlist | High | plans/CODEX-P2-windows-waker-placeholder.md |
| **CODEX-P3-XTHREAD** cross-thread task context traits/macro | 5 APIs + many impls | **pre-existing soundness-design defect** | High | plans/CODEX-P3-cross-thread-task-send-boundaries.md |
| **CODEX-P3-STATIC-MUT** writer/TLS scratch-buffer references | multiple public APIs | **pre-existing safe-API unsoundness** | High | plans/CODEX-P3-static-mut-lifetime-and-writer-aliasing.md |
| **CODEX-P3-SELFREF** movable self-referential artifacts | first site: PackageFilterIterator | high-risk watchlist | High | synthesis/codex-pass3-higher-severity-findings.md |
| **CODEX-P3-PM-TASK** package-manager borrowed task slots | 2 request variants + enqueue paths | high-risk watchlist | Medium-High | synthesis/codex-pass3-higher-severity-findings.md |

## Aggregate first-pass verdict

Of the 11,044 sites in the inventory:

| Bucket | Site estimate | Notes |
|--------|--------------:|-------|
| **(A) STRICTLY_UNAVOIDABLE** | ~9,500–10,000 | FFI shims, allocator, Zig-port at FFI boundaries, Stacked Borrows discipline, JSC handles |
| **(B) PERF_ONLY** | ~50–80 | Concentrated in 3 clusters; `safe-only` feature flag is the deliverable |
| **(C) REFACTORABLE** | ~120–250 | Concentrated in C-001/C-002/C-003 plus pure-Rust subsets of A-001 |
| **`pre-existing-ub` / safe-API soundness defects** | 2 compact bugs + 3 broad pass-3 clusters | Compact bugs are patch-ready; pass-3 clusters need design PRs |
| **Pending Phase 2 triage** | ~500–1,000 | The `bun_heap_lifecycle` + custom helper categories need per-site review for whether the helper is the right abstraction |

**The headline ratio is still useful for per-site unsafe classification, but it
is not enough.** Pass 3 shows that some of the largest risks are small in site
count but large in blast radius: safe task traits, writer references, scratch
buffer lifetimes, and movable self-referential types.

## Falsifiable justifications per cluster

Per the Polish Bar requirement, each (A) cluster's "unavoidable because X" justification:

- **A-001 (Zig-port `*mut Self` at FFI callbacks):** Unavoidable BECAUSE Stacked Borrows tags a `&mut self` reborrow as `Unique`, and dispatching to a callback that may `Box::from_raw(self as *mut)` invalidates that tag from the language's perspective. Alternatives FAIL:
  1. *"Just take `&mut self`"* → invalidates the borrow stack on dealloc → UB caught by `cargo miri test` (per Bun's `src/CLAUDE.md` and PipeWriter.rs comments)
  2. *"Use `RefCell` to defer borrow checking to runtime"* → adds a runtime check on every call and still doesn't fix the dealloc-tag issue
  3. *"Use `Pin` to lock the reference"* → `Pin` doesn't help here; the issue is reborrow tag expiry, not movement

- **A-002 (`bun_core::heap` round-trips):** Unavoidable BECAUSE `Box::from_raw` requires a previously-obtained `Box::into_raw` and aliasing-exclusive ownership. The language cannot express "this raw pointer is the unique live pointer" in the type system. Alternatives FAIL:
  1. *"Use `Arc<T>`"* → reference counting overhead; doesn't compose with C-side `void*` user-data idiom
  2. *"Use `Rc<T>`"* → `!Send`; doesn't compose with worker pool

- **A-003 (`*_sys` FFI shims):** Unavoidable BECAUSE `extern "C"` blocks are the language-level FFI primitive. The unsafety is purchased to declare the foreign symbol's existence and signature. Alternatives FAIL by definition — there is no safe-Rust expression of "this symbol is declared in a C library."

## Adversarial reclassification (Phase 6)

Phase 6 runs an adversarial reclassifier that tries to defeat every (A) and find a safe-equivalent for every (B). Codex pass 2 completed the first round; remaining questions include:

- **A-001 adversarial:** "Could `pin-project-lite`-style structural pinning replace some of these?" — Answer: no, the issue is dealloc tag invalidation, not movement.
- **A-002 adversarial:** "Could `slab` or `slotmap` replace `Box::from_raw`?" — Answer: only for sites where the C side accepts a `usize` token; most FFI passes `void*`.
- **A-003 adversarial:** "Could `cxx`-style bindings reduce the unsafe surface?" — Answer: `cxx` only works for C++ with specific patterns; Bun's bindings are too varied. `bindgen` already generates the headers; the unsafe `extern` is the irreducible kernel.
- **C-001 adversarial:** "Are any of the 23 technically refactorable sites actually load-bearing for a subtle invariant?" — Per the C-001 plan, each site is either sourced from a Rust reference or has an existing non-null witness. One `StoreRef::from_static` site remains excluded from the firm demo batch because its safe replacement is blocked by `const fn` availability on Bun's pinned toolchain.
- **C-002 adversarial:** "Could the `strum::FromRepr` rewrite hide a real out-of-range value the unsafe transmute silently `unreachable_unchecked!`'d through?" — Yes, and that's a feature: the rewrite turns UB into a panic or checked fallback, which is bug-finding, not bug-hiding.
- **CODEX-P2 adversarial:** "If WindowsWaker currently stores `Option<BackRef<_>>`, is `zeroed_unchecked()` actually UB?" — The safe placeholder exists, so this does not need a layout-law debate. Replace the stale branch with `Async::Waker::placeholder()` and verify Windows check.

The next Phase 6 pass should be a quiet convergence pass: no new P0/P1 issues, no stale dependency claims, and <5% cluster-count flips.
