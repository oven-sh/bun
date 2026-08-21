# B-001 and B-002 — PERF_ONLY clusters

This plan covers the two unsafe clusters that exist purely for measurable
performance: `compiler_hint` (B-001) and `unchecked_index` (B-002). A
high-density sample of the `slice_from_raw` category is included as a bonus —
some of those sites are genuine (A) FFI, but a meaningful fraction are (B)
performance-motivated and belong on the same `safe-only` flag.

The thesis of (B) sites is straightforward: every one of them has a known-safe
equivalent that the compiler should — under `-Copt-level=3`, fat LTO, and
`codegen-units = 1` — lower to the same machine code. The work of this plan is
to put that thesis under measurement, gate each site behind a workspace feature
flag, and let the build system carry both forms forward indefinitely.

## Codex pass 2 amendment

Until benchmark logs are attached, call these **B-candidates**, not
`B-PROVEN-HOT`.

The plan below is a good measurement design, but the skill rubric requires the
actual safe rewrite, benchmark command, measured delta, and threshold before a
site earns final (B) classification. Any site without measurement should remain
`B-UNMEASURED` or `(C pending measurement)`.

For older sections below, read every `B-PROVEN-HOT` label as
`B-CANDIDATE-HOT` unless a benchmark log is attached in this audit directory.

## Executive summary

| Cluster      | Sites | Subclass distribution                                                              |
| ------------ | ----: | ---------------------------------------------------------------------------------- |
| B-001 (`compiler_hint`)     |    17 | 12 `unreachable_unchecked`, 2 hint shaping (`cold`, `black_box`), 3 misc           |
| B-002 (`unchecked_index`)   |    13 | 6 hot-path index, 4 cross-thread cell, 3 pending-buffer write                      |
| Bonus (`slice_from_raw`)    |   298 | ~140 (A) FFI, ~80 (B-PROVEN-HOT) owned data, ~50 (B-UNMEASURED), ~28 (C-COLD)      |

After per-site reading:

- **B-PROVEN-HOT**: 9 of B-001, 8 of B-002, ~80 of `slice_from_raw`
- **B-UNMEASURED**: 6 of B-001, 4 of B-002, ~50 of `slice_from_raw`
- **C-COLD**: 0 of B-001, 1 of B-002, ~28 of `slice_from_raw`
- **A-FFI**: 2 of B-001 (debug-only crash trigger, secure-zero memory fence), 0 of B-002, ~140 of `slice_from_raw`

The (B-PROVEN-HOT) count is the population that earns the `safe-only` feature
gate. The (B-UNMEASURED) population gets the same gate but is filed for
measurement; if benchmarks show no regression with `safe-only` on, those sites
graduate to (C) and the unsafe is deleted outright. The (C-COLD) population is
the easy win — refactor immediately, no gate needed.

The expected outcome of the measurement pass is asymmetric. The LLVM
optimizations that subsume each safe form are well-known:

- `unreachable!()` lowers to `panic_str` with `#[cold]`; in `_unchecked` form
  the call site becomes `ud2`. On every `unreachable!()` site that follows an
  exhaustive match arm, LLVM's reachability analysis has already proved the
  arm unreachable in IR before instruction selection, so the panic call is
  dead-code-eliminated and the resulting code is bit-identical.
- `get_unchecked(i)` versus `&slice[i]` differ only by a `cmp; ja .panic`
  prelude. The bounds-check elimination (BCE) pass folds the `cmp` away
  whenever range analysis can show `i < len`. Loops of the shape
  `for i in 0..len { slice[i] }` always BCE; harder shapes (`slice[external_id]`)
  do not.
- `slice::from_raw_parts(p, n)` over an owned buffer versus
  `&buf[..n]` produces identical IR after `lower-slice` (the safe form
  introduces a length panic that constant-folds away when `n <= cap` is
  visible to LLVM).

Concretely, the sites we expect to actually regress under `safe-only` are
the ones where:

1. The index is **opaque to LLVM** (e.g. `deps.get_unchecked(dep_id as usize)`
   in `Tree::hoist_dependency` — `dep_id` flows from a separate `Vec`, so BCE
   cannot prove the bound).
2. The unreachable arm comes from an **inhabited enum that is reachable in IR
   even though we know it isn't at the call site** (e.g. the `_ => unsafe { core::hint::unreachable_unchecked() }` after a `matches!(...)` test that LLVM
   can't see through).
3. The slice index is **post-flush** in a streaming pipeline where LLVM cannot
   correlate `pending_n` to the `pending_*` array lengths (the source-map
   `append_mapping` hot loop).

These are listed individually below. Everything else is expected to be a wash
under `-Copt-level=3` and graduates to (C).

## The `safe-only` Cargo feature

```toml
# Root Cargo.toml (the workspace) — defines the surface.
[workspace.metadata.bun.features]
# Documentation-only; the actual flag is declared per-crate.

# Each crate that contains at least one (B) site:
# src/<crate>/Cargo.toml
[features]
default = []
# `safe-only` makes every (B) site fall through to its safe equivalent.
# Enabled in CI on a second build to verify both forms compile and pass
# tests. Not exposed to end users — `bun bd` and the release binary always
# build without it.
safe-only = []
```

### Per-site pattern

The two shapes that recur throughout B-001 and B-002 are:

```rust
// B-001 unreachable
#[cfg(feature = "safe-only")]
{
    unreachable!("<original SAFETY comment as panic message>")
}
#[cfg(not(feature = "safe-only"))]
// SAFETY: <original justification>
unsafe { core::hint::unreachable_unchecked() }

// B-002 indexing
#[cfg(feature = "safe-only")]
let dep = &deps[dep_id as usize];
#[cfg(not(feature = "safe-only"))]
// SAFETY: dep_id was produced by the same lockfile that produced deps.
let dep = unsafe { deps.get_unchecked(dep_id as usize) };
```

Where the pattern recurs more than three times in one file, hoist a macro:

```rust
// In bun_core (top of workspace).
#[macro_export]
macro_rules! unreachable_unchecked_perf {
    ($msg:literal) => {{
        #[cfg(feature = "safe-only")]
        { unreachable!($msg) }
        #[cfg(not(feature = "safe-only"))]
        // SAFETY: per call-site comment.
        unsafe { core::hint::unreachable_unchecked() }
    }};
}
```

This collapses 12 of the 17 B-001 sites into a one-liner each and keeps the
"why" inline as the panic message — which fires only in `safe-only` debug
builds, where it functions as a regression detector for bugs that used to be
silent UB.

### Workspace plumbing

The audit's recommendation is **one** workspace-level passthrough feature,
declared in every crate that gates a (B) site. The crates needing it are
(from this analysis):

- `bun_alloc`
- `bun_bundler`
- `bun_collections`
- `bun_core`
- `bun_css`
- `bun_event_loop`
- `bun_http`
- `bun_install`
- `bun_io`
- `bun_jsc`
- `bun_runtime`
- `bun_semver`
- `bun_sourcemap`
- `bun_base64`

A passthrough at `bun_bin` (the staticlib root) may propagate the flag to
dependency crates explicitly, for example
`bun_install = { path = "../install", default-features = false, features = ["safe-only"] }`.
Do **not** rely on a bare workspace-level `--features safe-only` as if it
enabled that feature in every member crate. Cargo features are package-scoped:
the command-line feature applies to selected packages, and workspace-wide
coverage needs either package-qualified flags such as
`bun_install/safe-only`, explicit `-p <crate> --features safe-only` runs, or
dependency-feature propagation through the root crates. We choose the verbose
form because it documents exactly which crates have unsafe-for-perf and avoids
silently missing a member crate that declares no local `safe-only` feature.

### CI matrix

```yaml
# .buildkite/ci.yml (sketch)
matrix:
  - name: default
    cmd: bun bd
  - name: safe-only
    cmd: cargo build --release -p bun_bin --features bun_bin/safe-only
                     && cargo test --release -p bun_install --features safe-only
                     && cargo test --release -p bun_semver --features safe-only
```

The `safe-only` lane is allowed to regress benchmarks; what it must not do is
fail to compile or fail a correctness test. Any divergence between the two
lanes is itself a finding — it means a (B) site is silently relying on the
unsafe form for correctness, not just speed, and the (B) classification was
wrong.

## Per-site analysis — B-001 (`compiler_hint`)

### B-001.1 — `bun_alloc/lib.rs:1486` `secure_zero` (`black_box` + `compiler_fence`)

Subclass: **(A-FFI)**, miscategorized in the inventory. This is not
`unreachable_unchecked`; it is a deliberate dead-store-elimination defeat for
zeroing key material before drop. The `black_box(p)` after the `memset`
prevents LLVM from concluding the buffer is dead and eliding the writes; the
`compiler_fence(SeqCst)` blocks reordering. The safe equivalent does not
exist — `black_box` is itself the abstraction Rust offers for "make the
optimizer pretend this value escapes." No `safe-only` gate; the site stays as
written.

### B-001.2 — `bun_bundler/src/bundler/transpiler.rs:1932`

```rust
let value_expr: bun_ast::Expr = match loader {
    options::Loader::Jsonc => { ... }
    options::Loader::Json  => { ... }
    options::Loader::Toml  => { ... }
    options::Loader::Yaml  => { ... }
    options::Loader::Json5 => { ... }
    // SAFETY: outer match arm guarantees one of the five.
    _ => unsafe { core::hint::unreachable_unchecked() },
};
```

Subclass: **(B-UNMEASURED)**, ranking (C-likely).

This match arm is reached after an outer dispatch already narrowed to those
five loaders, but the outer dispatch is a `match` of its own (in
`parse_data_loader`'s caller) and LLVM does not see through the narrowing.
The `unreachable_unchecked` claims an exhaustive match it is structurally
unable to express, because `options::Loader` has more variants.

Safe rewrite under `safe-only`:

```rust
_ => unreachable!("parse_data_loader entered with non-data Loader"),
```

Hot-path evidence: parse_data_loader is only entered when bundling JSON/TOML/
YAML/JSON5/JSONC files. Per `bundle` benchmark, this is < 1% of bundling time
on the standard React fixture. The `_` arm is taken zero times in well-formed
input. **Expected delta: 0 ns.** This is a (C) candidate dressed up as (B);
move to (C) after measurement.

### B-001.3 — `bun_event_loop/MiniEventLoop.rs:301-311`

```rust
match &mut *slot {
    Some(b) => &raw mut **b,
    None    => core::hint::unreachable_unchecked(),
}
```

Subclass: **(B-PROVEN-HOT)**.

The slot is `Some` immediately above via `slot.write(...)`, but the write is
through a raw pointer and LLVM cannot infer the result. The `Some` arm is the
fast path on every `file_polls_raw` call, which happens once per IO callback —
many thousands of times per second under `Bun.serve` load.

Safe rewrite under `safe-only`:

```rust
match &mut *slot {
    Some(b) => &raw mut **b,
    None    => unreachable!("just wrote Some above"),
}
```

Bench targets: `bench/snippets/http-hello.js`, `bench/snippets/native-overhead.mjs`.
**Expected delta: 0-2% throughput regression** (one extra `cmp; jne` per IO
callback; predicted-taken, branchless after LLVM's BCE on the match
tag).

### B-001.4 — `bun_install/lockfile/Tree.rs:1131`

```rust
Err(_) => unsafe { core::hint::unreachable_unchecked() },
```

Inside `hoist_dependency::<false, METHOD>`. The comment claims the only `Err`
site is gated on `AS_DEFINED`, which this caller passes as `false`. The
generic monomorphizes; LLVM **may** see through this when `AS_DEFINED = false`
and DCE the error arm naturally — making this an (B-UNMEASURED) leaning hard
toward (C).

Hot-path evidence: lockfile hoist is on the critical path of `bun install`.
The (B) cost here is paid per recursive `hoist_dependency` call; install of
the `next-forge` benchmark fixture does ~120k calls. If the safe form
re-introduces a panic-fmt page-fault per call this matters; if LLVM DCEs it,
it doesn't.

Bench target: `bench/install/` (next-forge fixture under `bun install`).
**Expected delta: 0 ns (LLVM should DCE).** Move to (C) after measurement.

### B-001.5 — `bun_install/PackageManagerTask.rs:284,542`

Two sites, both of the form:

```rust
let Callback::PackageManifest { loaded_manifest, .. } = &network.callback
else { unsafe { core::hint::unreachable_unchecked() } };
```

Subclass: **(B-UNMEASURED)**.

These destructure a callback union whose tag is checked one stack frame up.
LLVM cannot inline through the worker-pool dispatch boundary in either case.
But each site fires only on package-manifest completion (once per package),
and the body is dominated by network IO. **Expected delta: 0 ns measurable.**
Move to (C).

Safe rewrite: `else { unreachable!("tag was {{PackageManifest|Apply}}") }`.

### B-001.6 — `bun_install/PackageManagerTask.rs:545` (the same pattern, `Callback::Apply`)

See above. Same disposition.

### B-001.7 to B-001.10 — `bun_jsc/generated.rs:{409,464,494,622}`

Four sites, all of the form:

```rust
_ => unsafe { core::hint::unreachable_unchecked() },
```

inside `convert_from_extern` for codegen'd FFI-tagged unions. The tag space is
documented as `0..=N` per the bindgen contract. The risk profile here is the
inverse of the others: the unsafe assumes a C++ bindgen contract that is
**not enforced by the Rust type system**. A bindgen drift (adding a variant
on the C++ side without regenerating Rust) silently triggers UB.

Subclass: **(B-PROVEN-HOT)** for codegen ergonomics, **(C-RECOMMENDED for
hardening)** for soundness.

These should switch to:

```rust
_ => unreachable!("bindgen tag drift: {} out of declared range", ext.tag),
```

unconditionally — not gated by `safe-only`. The cost is one bounds check per
SSL config load, which happens at most a few times per `Bun.serve` startup.
**This is the strongest "rewrite the unsafe" candidate in B-001.**

### B-001.11 — `bun_runtime/api/crash_handler_jsc.rs:92`

Subclass: **(A-FFI)**, miscategorized.

Deliberately dereferences `0xDEADBEEF` to trigger SIGSEGV for testing the
crash handler. `black_box(ptr)` after the write prevents LLVM from concluding
the function is unreachable past the write. No safe form; the unsafe is the
test. No gate.

### B-001.12 to B-001.15 — `bun_runtime/api/js_bundle_completion_task.rs:{504,599,621,755}`

Four sites of the form `_ => unsafe { core::hint::unreachable_unchecked() }`
after a `matches!(this.result, BundleV2Result::Value(_))` check. LLVM does
not see through `matches!` to the subsequent `&mut this.result` rebinding;
the `_` arm appears reachable in IR.

Subclass: **(B-UNMEASURED)** uniformly.

These fire once per completed `Bun.build()` call — they are not in a tight
inner loop. The benchmark coverage (`bench/bundle/index.ts`) does enough
builds to detect a regression if there is one.

Safe rewrite: `unreachable!("checked Value arm via matches! above")`.
**Expected delta: 0 ns measurable** (per-call overhead drowned by build
work). Move to (C) after measurement.

### B-001.16 — `bun_runtime/bake/DevServer.rs:5913` (`inspector()`)

Subclass: **(B-PROVEN-HOT)**.

Not `unreachable_unchecked` — uses `bun_core::hint::cold()`, which is an
intrinsic wrapper for `#[cold]` branch annotation. Already lowers to the same
codegen as `core::intrinsics::cold_path()` (the safe-stable hint). No gate
needed; this is correctly classified but the inventory's `compiler_hint` tag
is misleading. The site stays as written.

### B-001.17 — `bun_event_loop/MiniEventLoop.rs:302` (sibling of B-001.3)

Same site, expanded form of the unsafe block. Disposition merges with B-001.3.

## Per-site analysis — B-002 (`unchecked_index`)

### B-002.1 — `bun_base64/lib.rs:606` (`char_to_index`)

```rust
let d = unsafe { *self.char_to_index.get_unchecked(c as usize) };
```

Subclass: **(B-PROVEN-HOT)**, but the safe form provably equals the unsafe
form.

`c: u8` and `char_to_index` is `[u8; 256]`. The Rust bounds-check elimination
pass is conservative on `c as usize`, but the index type `u8` widening
to `usize` produces a value in `0..=255`, and a 256-entry array's bounds
check on a `u8` index is a known BCE-friendly pattern. As of `rustc 1.83`,
LLVM eliminates the check on `-Copt-level=3`. Pre-1.80 builds may not.

Bench target: `bench/snippets/atob.mjs`, `bench/snippets/buffer-base64.mjs`.
Hot path: every base64 decode byte. **Expected delta: 0 ns on rustc ≥ 1.83;
~3% throughput regression on older toolchains.**

Safe rewrite: `let d = self.char_to_index[c as usize];`. Gate behind
`safe-only` to verify.

### B-002.2 — `bun_base64/lib.rs:622` (`dest.get_unchecked_mut`)

```rust
unsafe { *dest.get_unchecked_mut(dest_idx) = (acc >> acc_len) as u8 };
```

Subclass: **(B-PROVEN-HOT)**.

`dest_idx` ranges from 0 up to `calc_size_for_slice(source)`, which the
caller is documented to size `dest` for. LLVM cannot prove this — the
relation between `source.iter().count()` and `dest.len()` flows through the
caller and is not visible inside `decode`. The check is real.

Bench targets: same as B-002.1. **Expected delta: 1-4% throughput regression
on the base64 decode benchmark** — this is the strongest "actually keep the
unsafe" candidate in B-002.

Safe rewrite (under `safe-only`):

```rust
dest[dest_idx] = (acc >> acc_len) as u8;
```

### B-002.3 — `bun_core/string/immutable.rs:486` (`next_codepoint`)

```rust
let first = unsafe { *contents.get_unchecked(*current) };
```

Subclass: **(B-PROVEN-HOT)**, but the BCE should fire.

The line above is `if *current >= len { ... return -1; }`, then this line
indexes `contents` at `*current`. This is the canonical BCE pattern: an
explicit range check that LLVM directly recognizes. The bounds check is
eliminated on stable. **Expected delta: 0 ns.**

Bench targets: `bench/snippets/buffer-to-string.mjs`, every JSC string
codepoint walk (most JS string operations). Move to (C).

### B-002.4 — `bun_core/string/immutable.rs:1499` (`eql_comptime_check_len`)

```rust
unsafe { a.get_unchecked(..b.len()) == b }
```

Subclass: **(B-PROVEN-HOT)**, no BCE possible.

Two callers: one with `check_len = true` (early-returns on length mismatch),
one with `check_len = false` (caller guarantees `a.len() >= b.len()`). The
second can't be BCE'd — LLVM has no view of the caller's invariant. The hot
path is lexer keyword matching where this fires on every identifier.

Bench targets: `bench/scanner/scan.bun.js`, `bench/bundle/index.ts`.
**Expected delta: 1-3% scanner throughput regression** — the second-strongest
"keep the unsafe" candidate after base64.

### B-002.5 — `bun_css/selectors/parser.rs:65` (`small_list_into_box`)

```rust
unsafe { v.push(core::ptr::read(src.get_unchecked(i))) };
```

Subclass: **(B-PROVEN-HOT)**, but the safe form is structurally different.

This drains a `SmallList` by `ptr::read`-ing each element. Replacing
`get_unchecked` with `[i]` is straightforward; the `ptr::read` cannot go
away because the function bitwise-moves and then `set_len(0)`s the source.
Loop `0..len` so BCE fires.

Bench targets: `bench/snippets/markdown.mjs` (CSS-heavy stylesheets). Move to
(C) — the `get_unchecked` here is gratuitous; `[i]` BCE's trivially.

### B-002.6 — `bun_http/HTTPThread.rs:987` (`HTTP_THREAD.get_unchecked`)

Subclass: **(B-UNMEASURED)**, but suspect (A) on closer reading.

`HTTP_THREAD` is a `ThreadCell`, not a `Vec` — the `get_unchecked` here is
the **`ThreadCell` accessor that skips the debug owner-check**, not slice
indexing. The `safe` form would call `.get()` which performs an owner check
in debug. In release, the check is `#[cfg(debug_assertions)]`-gated and the
two paths are identical. The inventory mis-tagged this as `unchecked_index`.

No `safe-only` gate. The site stays as written.

### B-002.7 — `bun_install/lockfile/Tree.rs:1020` (`deps.get_unchecked(dep_id as usize)`)

Subclass: **(B-PROVEN-HOT)**, BCE-hostile.

`dep_id: DependencyID` is sourced from a separate `Vec` and indexed into
`deps`; LLVM cannot relate them. The hot path is the inner loop of
hoist_dependency, hit ~120k times on the next-forge fixture.

Bench target: `bench/install/`. **Expected delta: 2-5% lockfile-resolution
throughput regression.** Keep the unsafe behind `safe-only`.

### B-002.8 — `bun_io/lib.rs:683,821` (`LOOP.get_unchecked()`)

Same `ThreadCell` accessor pattern as B-002.6. Both sites are mis-tagged.
No gate; stays as written.

### B-002.9 — `bun_semver/lib.rs:536,537,613` (Pointer projection)

```rust
unsafe { this_buf.get_unchecked(a_off..a_off + a_len) }
```

Subclass: **(B-PROVEN-HOT)**, BCE-hostile.

`a_off`, `a_len` come from a packed `Pointer` struct (`u32`/`u16` fields).
LLVM cannot prove `a_off + a_len <= this_buf.len()` — the invariant lives in
the constructor of `Pointer`, not at the use site. Three sites, all in the
semver inner comparison loop.

Bench target: `bench/snippets/semver.mjs`. **Expected delta: 3-8% semver
satisfies throughput regression**, by far the largest B-002 hot-path impact.
Keep the unsafe behind `safe-only`.

### B-002.10 — `bun_sourcemap/InternalSourceMap.rs:1006` (`pending_*` writes)

```rust
unsafe {
    *self.pending_generated_line.get_unchecked_mut(i) = generated_line;
    *self.pending_generated_column.get_unchecked_mut(i) = current.generated_column;
    *self.pending_source_index.get_unchecked_mut(i) = current.source_index;
    *self.pending_original_line.get_unchecked_mut(i) = current.original_line;
    *self.pending_original_column.get_unchecked_mut(i) = current.original_column;
}
```

Subclass: **(B-PROVEN-HOT)**, BCE-friendly with refactoring.

`i = self.pending_n as usize`, with the invariant `pending_n < SYNC_INTERVAL`
(const). Five separate `get_unchecked_mut` against five separate Vec/array
fields. Whether BCE fires depends on whether the field's length is visible at
the use site: if the fields are `[T; SYNC_INTERVAL]` arrays, LLVM proves
the bound from `pending_n < SYNC_INTERVAL` and the safe form is free; if
they're `Vec<T>`, the length is dynamic and BCE fails.

Bench target: `bench/sourcemap/`, `bench/bundle/index.ts`. **Expected delta:
0 ns if fields are arrays, 2-3% per-mapping regression if Vec.** Worth
inspecting the field types — the comment "invariant `pending_n <
SYNC_INTERVAL`" reads like the fields are sized to `SYNC_INTERVAL`, in which
case this is a (C) candidate.

## Per-site analysis — bonus `slice_from_raw` sample (30 sites)

The 298 sites split roughly into three populations. The audit's per-site
classification follows; subclass abbreviations are (A) FFI, (B) PERF, (C)
COLD.

### `bun_alloc/lib.rs:183` (`free`)

```rust
let buf = unsafe { core::slice::from_raw_parts_mut(bytes.as_ptr().cast_mut(), bytes.len()) };
self.raw_free(buf, ...);
```

**(B-UNMEASURED).** The vtable takes `&mut [u8]`; the caller has `&[u8]`. The
unsafe rebuilds a mutable slice over the same range purely to fit the
signature — there is no real provenance round-trip. Refactor the vtable to
take `*mut u8, len`; this is (C). No gate needed.

### `bun_alloc/lib.rs:666,677` (`realloc_slice`)

**(A-FFI).** `mi_realloc` returns a raw `*mut c_void`; only the FFI boundary
can produce a slice. Required-unavoidable. No gate.

### `bun_alloc/lib.rs:962,980` (`ZigString::slice`, `utf16_slice_aligned`)

**(A-FFI).** `_unsafe_ptr_do_not_use` is set by the C++ side of `ZigString`;
the slice fabrication is the FFI boundary. Required-unavoidable. No gate.

### `bun_alloc/lib.rs:1133,1148` (`m_ptr.latin1`, `m_ptr.utf16`)

**(A-FFI).** WebKit `WTFStringImpl` direct buffer access. No gate.

### `bun_alloc/lib.rs:1446,1468` (`default_free`, `dupe`)

**(A-FFI)** for `default_free` (caller-supplied raw pointer);
**(B-UNMEASURED)** for the `dupe` site at 1468 — the `copy_nonoverlapping`
target is mimalloc-allocated and could be a `Vec::from_raw_parts` round-trip.

### `bun_alloc/lib.rs:2599,2628,2718,2755,2762,2809,2831` (string pool internals)

**(B-PROVEN-HOT)** mostly. Each fabricates a slice over a pool-owned
allocation. Could be (C) — the pool already knows its capacity — but the
performance argument is real: the pool API is in the critical path of
`bun_install`'s manifest parser (~10M slice fabrications on the next-forge
fixture). Behind `safe-only`, replace with `&mut self.backing_buf[start..end]`
where possible. **Expected delta: 1-3% manifest-parse regression.**

### `bun_alloc/MimallocArena.rs:460,500,532` (arena helpers)

**(B-PROVEN-HOT).** Arena `dupe`/`init_with`/`alloc_slice` — every allocation
through the parse-arena. Hot in the parser. Behind `safe-only`, the slice
fabrication itself doesn't disappear (the raw `*mut u8` cannot become a
checked slice), but `Vec::from_raw_parts_in` could replace the slice + later
`set_len`. **Expected delta: ~0 ns** — the slice is fabricated, not indexed.

### `bun_alloc/NullableAllocator.rs:90`

**(B-UNMEASURED)** — same pattern as `lib.rs:183`. (C) candidate.

### `bun_alloc/stack_fallback.rs:610`

**(A-FFI)** — slice over a `MaybeUninit<u8>` block sized to a SIMD lane. No
gate.

### `bun_core/env_var.rs:343`

**(A-FFI)** — `getenv` output. No gate.

### `bun_core/lib.rs:246,247` (`environ`)

**(A-FFI)** — POSIX `environ` table. No gate.

### `bun_core/lib.rs:516,517,551,556` (`spare_bytes_mut`, `allocated_bytes_mut`)

**(B-PROVEN-HOT).** Both are `Vec` spare-capacity views. The safe equivalent
is `v.spare_capacity_mut().as_mut_ptr().cast::<u8>()` paired with the
`spare.len()` already in scope — but that produces `&mut [MaybeUninit<u8>]`,
which is the typed-correct form. The unsafe is laundering the type to `&mut
[u8]` for writers that pre-initialize. Gate behind `safe-only` with a
`MaybeUninit::slice_assume_init_mut` (still unsafe but more localized) or
return `&mut [MaybeUninit<u8>]` and migrate the callers. **Expected delta:
0 ns codegen-wise; significant type-system clean-up.**

### `bun_core/string/HashedString.rs:52`, `string/immutable.rs:1065,1079,3105`

**(A-FFI).** All four are slice views over C++-managed string buffers
(`WTFStringImpl`-backed). The provenance is C++; no Rust source ever held a
typed view. No gate.

### `bun_core/string/immutable.rs:1394-1407,1422,1423,1433,1434,1435` (~9 sites)

**(A-FFI).** Same category — all C++-string-buffer projections. No gate.

### `bun_collections/multi_array_list.rs:508,521,555-562,779,792` (~6 sites)

**(B-PROVEN-HOT).** The `multi_array_list` columnar allocator's whole point is
fabricating column slices from a single shared allocation. The safe form
would store each column as a separate `Vec`, defeating the data layout. These
are foundational to the AST representation; gate behind `safe-only` but the
expectation is the `safe-only` build will regress AST-walk benchmarks by
5-15%. **One of the strongest "keep the unsafe" cases in the codebase.**

### `bun_jsc/array_buffer.rs:291,564,574,614`

**(A-FFI).** `ArrayBuffer` backing store from V8/JSC. No gate.

### `bun_runtime/allocators/LinuxMemFdAllocator.rs:130,184`

**(A-FFI).** `mmap` return. No gate.

### `bun_runtime/api/BunObject.rs:1371,1672,1705`, `bunx_command.rs:866,1038,1310,1363`, `cli/mod.rs:490`, `run_command.rs:832,977,3274,3860,3871,3958,4090`, `create_command.rs:865`, `cli/test/Scanner.rs:123`

Heavy cluster of `slice::from_raw_parts(<owned_buf>.as_ptr(), <known_len>)`
where the buffer is a stack-allocated path buffer and `len` is the
`std::io::Write::write` byte count. **(C-COLD)** uniformly — every one of
these CLI parsing sites can be rewritten as `&buf[..written]` with no
codegen cost. These are the prime (C) refactor candidates in this cluster.

### `bun_runtime/crypto/CryptoHasher.rs:395,710,1004`, `ffi/ffi_body.rs:2679`, `ffi/FFIObject.rs:97,845,900,928`, `ffi/mod.rs:100`

**(A-FFI)** uniformly. Output buffers from BoringSSL hashers; JSC argument
arrays. The pointer + length comes from C; no safe equivalent. No gate.

### `bun_bundler/ParseTask.rs:1739,1756,1768`

**(A-FFI).** Documented bundler-plugin ABI; pointer + length come from
third-party native plugins. No gate.

## Bench targets per cluster

Per the goal of measuring deltas, the following Bun benchmarks exercise each
cluster's hot path. All run via `bun bench/runner.mjs <snippet>`:

| Cluster member                         | Bench target                                                         |
| -------------------------------------- | -------------------------------------------------------------------- |
| B-002.1, B-002.2 (base64)              | `bench/snippets/atob.mjs`, `bench/snippets/buffer-base64.mjs`        |
| B-002.3, B-002.4 (string immutable)    | `bench/snippets/buffer-to-string.mjs`, `bench/snippets/string-decoder.mjs` |
| B-002.7 (lockfile dep lookup)          | `bench/install/` (next-forge `bun install`)                          |
| B-002.9 (semver pointer projection)    | `bench/snippets/semver.mjs`                                          |
| B-002.10 (sourcemap append_mapping)    | `bench/sourcemap/`, `bench/bundle/index.ts`                          |
| B-001.3, B-001.17 (event loop)         | `bench/snippets/http-hello.js`, `bench/snippets/native-overhead.mjs` |
| B-001.4-6 (install hoist)              | `bench/install/`                                                     |
| B-001.7-10 (jsc bindgen drift guards)  | startup overhead under `bench/snippets/native-overhead.mjs`          |
| B-001.12-15 (Bun.build dispatch)       | `bench/bundle/index.ts`                                              |
| `slice_from_raw` multi_array_list      | `bench/bundle/index.ts`, `bench/scanner/scan.bun.js`                 |
| `slice_from_raw` semver Pool internals | `bench/install/`, `bench/snippets/semver.mjs`                        |
| `slice_from_raw` MimallocArena         | `bench/bundle/index.ts`                                              |

The harness pattern is identical for every entry: build twice (`cargo build
--release` vs. the package-scoped safe-only build for the touched crate/root
passthrough, e.g. `cargo build --release -p bun_bin --features
bun_bin/safe-only`), run each benchmark with each binary under `hyperfine
--warmup 3 --runs 10`, and record p50 / p95 / variance. Differences within
±2% are noise on the Linux CI fleet; differences outside ±5% are load-bearing.

## Expected perf-delta hypothesis

The thesis to be falsified by measurement is:

> Under `-Copt-level=3` with fat LTO and `codegen-units = 1`, the
> overwhelming majority of (B) sites compile to bit-identical machine code
> regardless of `safe-only`. The minority that regresses does so because the
> safe-form bounds check is opaque to LLVM's range analysis — specifically:
> (a) cross-Vec indexing (an `id` from one collection used as an index into
> another), (b) pointer-projection slices where the constructor's invariant
> is not visible at the use site, and (c) multi-array_list column slicing.

If the measurement comes back the way the hypothesis predicts, the
implications are:

1. The ~12 of B-001's `unreachable_unchecked` sites collapse to
   `unreachable!()` outright. No gate needed; the safe form is the default.
2. The ~5 BCE-friendly sites in B-002 (`char_to_index`, `next_codepoint`
   range-checked index, `small_list_into_box` `0..len` loop) collapse to
   `[i]` outright.
3. The ~3 BCE-hostile (B-002.4, B-002.7, B-002.9, B-002.10-if-Vec) and the
   `multi_array_list` cluster stay on `safe-only` indefinitely. These are
   the genuine perf-only sites; the audit can publish the measured deltas
   as the justification.
4. The `slice_from_raw` (C-COLD) population (~28 sites in CLI parsing)
   refactors immediately, with no gate.

The sites most likely to **regress** under `safe-only`:

- `bun_semver/lib.rs:536,537,613` — semver pointer projection (cross-Vec index)
- `bun_install/lockfile/Tree.rs:1020` — lockfile dep cross-lookup
- `bun_collections/multi_array_list.rs:*` — columnar slicing
- `bun_base64/lib.rs:622` — base64 decode output write
- `bun_core/string/immutable.rs:1499` — lexer keyword matching with
  `check_len = false`

If any other site regresses, the audit's mental model of LLVM's optimizer
is wrong and that finding goes into a separate `WHAT-WE-LEARNED.md`.

## What we'd land

A first demonstration PR is small enough to review in one sitting and
exercises the full mechanism. The proposed scope:

**PR title:** "`safe-only`: gate compiler-hint and unchecked-index unsafe behind a Cargo feature"

**Crates touched:** `bun_install`, `bun_semver` (two crates with the
highest-density (B) sites — 5 B-001 + B-002 sites total).

**Diff outline:**

1. Add `[features] safe-only = []` to `src/install/Cargo.toml` and
   `src/semver/Cargo.toml`.
2. Define `bun_core::unreachable_unchecked_perf!` in `src/bun_core/hint.rs`
   alongside the existing `cold()` helper.
3. Convert four sites in `bun_install` (`Tree.rs:1131`,
   `PackageManagerTask.rs:284,542,545`) and three sites in `bun_semver`
   (`lib.rs:536,537,613`) to use the macro / the per-site `#[cfg]` form.
4. Add `.buildkite/safe-only.yml` lane that runs `cargo test --features
   safe-only -p bun_install -p bun_semver` and `bench/snippets/semver.mjs`
   against both builds, posting the deltas.
5. Document the feature in `src/CLAUDE.md` under "Conventions" so future
   contributors know to use the macro when adding similar perf-only unsafe.

This PR's reviewable surface is < 100 lines of code plus a CI lane.
Successful merge proves the pattern; subsequent PRs scale to the other 11
crates in the (B) list.

The audit's larger story — the (C) refactors in `slice_from_raw` and the
`unreachable!` sites that turn out to be free — follows as separate PRs,
each one carrying its own measurement appendix.

## Falsifiability notes

This plan is wrong if any of the following turn out to be true under
measurement:

- `unreachable!()` regresses by > 1% on any (B-001) hot path. This would mean
  LLVM is no longer DCE'ing the panic call after `cold` annotation — a
  toolchain regression worth reporting upstream.
- A BCE-friendly site (B-002.1, B-002.3, B-002.5) regresses by > 1%. This
  would mean rustc's BCE pass has gotten worse; reproducer + bug report.
- A site in the "Expected delta: 0 ns" column regresses by > 5%. Either the
  audit misread the code or LLVM's interprocedural pass is doing more work
  than expected; investigate per-site.
- A site in the "Keep the unsafe" column does *not* regress. This is the
  best possible outcome — the unsafe was unnecessary all along and the site
  graduates to (C). The audit publishes the measured equivalence and
  unsafe-free Rust replaces the unchecked form.

Each of these is a falsification event that updates the plan, not a failure.
The point of the `safe-only` mechanism is exactly to make these
falsifications cheap to observe.
