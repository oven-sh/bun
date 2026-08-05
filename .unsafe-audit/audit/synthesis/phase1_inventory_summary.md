# Phase 1 — Enumeration Summary

**Generated:** 2026-05-14
**Inventory:** `.unsafe-audit/unsafe-inventory.jsonl` (11,044 sites)
**Cluster summary:** `phase1/cluster-summary.json`

## Totals

| Kind | Sites |
|------|------:|
| `unsafe { ... }` blocks | 9,754 |
| `unsafe fn` (incl. `pub unsafe fn`) | 903 |
| `unsafe impl` (Send/Sync/other) | 345 |
| `unsafe trait` | 20 |
| `UnsafeCell::new(...)` | 22 |
| **Total** | **11,044** |

These counts dedupe by `(file, line, normalized-kind)` and apply unsafe-fn vis-prefix collapsing so e.g. `pub unsafe fn foo` and `unsafe fn foo` aren't double-counted.

Patterns NOT discovered by ast-grep (but appearing in ripgrep):
- `Pin::new_unchecked` — preliminary rg showed 54 hits; ast-grep's structural pattern matched 0 because Bun calls it via `NonNull::new_unchecked` from `bun_ptr::ScopedRef::new(...)`. The rg hits are dominated by `NonNull::new_unchecked` (legitimate non-null asserts) not `Pin::new_unchecked` (Pin-projection). True `Pin::new_unchecked` count is low.
- `mem::transmute` — 30 sites total per my refined categorizer; ast-grep's exact pattern missed several because they spelled it `core::mem::transmute::<T, U>` (turbofish) rather than the bare form.
- `MaybeUninit::assume_init` — appears in 182 sites per the semantic categorizer; ast-grep's pattern was too specific.

The semantic categorizer ([refine-categories below](#semantic-categories)) catches these by full-text inspection of every captured site.

## Top 5 crates by site count

| Crate | Sites | % of total | Primary character |
|-------|-----:|-----:|-------------------|
| `bun_runtime` | 4,893 | 44% | JS-visible runtime; mix of FFI + Zig-port patterns |
| `bun_jsc` | 745 | 7% | JavaScriptCore C++ glue from Rust side |
| `bun_install` | 525 | 5% | npm package manager |
| `bun_bundler` | 498 | 5% | JS/TS bundler |
| `bun_core` | 461 | 4% | Foundation: strings, allocator, heap helpers |

The remaining 56% spans 103 other crates.

## Top syntactic pattern clusters

Clustering by normalized text (identifiers → ID, integers → N, strings → "S", whitespace collapsed) yields **8,531 distinct pattern clusters across 11,044 sites**. The top 20 cover ~6% of all sites:

| # sites | Pattern |
|---:|---------|
| 145 | `unsafe { &mut *this }` |
| 82 | `unsafe { bun_core::heap::take(this) }` |
| 49 | `unsafe { Self::finish(this) }` |
| 42 | `unsafe { &*this }` |
| 34 | `unsafe { bun_core::ffi::zeroed_unchecked() }` |
| 26 | `unsafe { &*jsc_vm }` |
| 23 | `unsafe { &mut *manager_ptr }` |
| 23 | `unsafe { &*vm }` |
| 22 | `unsafe { core::slice::from_raw_parts(ptr, len) }` |
| 22 | `unsafe { &mut *p }` |
| 20 | `unsafe { p.as_mut() }` |
| 20 | `unsafe { bun_core::ffi::slice(ptr, len) }` |
| 16 | `unsafe { &mut *this_ptr }` |
| 14 | `unsafe { core::ptr::addr_of!((*item).next) }` |
| 13 | `unsafe { &mut *p.as_ptr() }` |
| 13 | `unsafe { &mut *ctx }` |
| 13 | `unsafe { Self::deref(this) }` |
| 13 | `unsafe { &mut *vm }` |
| 12 | `unsafe { &*p }` |
| 12 | `unsafe { core::hint::unreachable_unchecked() }` |

These are dominated by what we'll call the **"Zig-port `*mut Self` pattern"** (see [Soundness Invariants](invariants.md) for the load-bearing reason). The `src/CLAUDE.md` documents this pattern explicitly:

> If a callback may free `self` (close, error, GC finalize), do **not** materialize `&self`/`&mut self` at the boundary — a `&self`-derived raw pointer carries `SharedReadOnly` provenance, and `Box::from_raw`/dealloc through it is UB. Pass and dispatch off `*mut Self` until the body proves ownership.

The dereferences `&*this` / `&mut *this` happen INSIDE the body once the function has proved ownership. This is intentional and necessary under Stacked Borrows.

## Semantic categories

After running every captured site through a text-based categorizer:

| Category | Sites | Likely bucket |
|----------|-----:|---------------|
| `zig_port_mut_ref` (`unsafe { &mut *<ident> }`) | 923 | (A) at FFI boundary / (C) in pure-Rust |
| `zig_port_shared_ref` (`unsafe { &*<ident> }`) | 448 | same |
| `zig_port_self_call` (`unsafe { Self::xxx(this) }`) | 239 | same |
| `bun_heap_lifecycle` (`heap::take`/`destroy`/`into_raw`) | 204 | (A) — `Box::from_raw` is genuinely unsafe; refactoring requires owned `Self` |
| `bun_ffi_helper` (`ffi::slice`/`zeroed_unchecked`/`callback_ctx`) | 171 | (B)/(C) — helpers built on unsafe but with safe alternatives in some uses |
| `raw_method_call` (`(*this).foo()`) | 308 | (A)/(C) — same FFI-boundary discipline |
| `raw_ptr_lifecycle` (`from_raw`/`into_raw`) | 537 | (A)/(C) — depends on owner |
| `ptr_intrinsic` (`core::ptr::*`) | 956 | mostly (A); some (C) for `read_unaligned`/`copy_nonoverlapping` |
| `ptr_arith` (`ptr.add(...)`/`offset(...)`) | 302 | mostly (A); some (C) |
| `ptr_cast` (`as_ptr`/`cast`/`cast_mut`) | 2,231 | mostly (A); pointer juggling |
| `slice_from_raw` (`slice::from_raw_parts`) | 298 | (A) at FFI / (C) in some pure-Rust cases |
| `libc_ffi` | 345 | (A) |
| `libuv_ffi` | 254 | (A) |
| `uws_ffi` | 184 | (A) |
| `boringssl_ffi` | 146 | (A) |
| `mimalloc_ffi` | 84 | (A) |
| `libarchive_ffi` | 83 | (A) |
| `zlib_ffi` | 82 | (A) |
| `cares_ffi` | 62 | (A) |
| `lolhtml_ffi` | 41 | (A) |
| `brotli_ffi` | 4 | (A) |
| `zstd_ffi` | 4 | (A) |
| `syscall` | 104 | (A) |
| `fd_syscall` | 1,292 | (A) — `bun_sys::File` wrappers around posix open/read/etc. |
| `mmap` | 6 | (A) |
| `allocator` | 169 | (A) — `bun_alloc::*` allocator implementations |
| `c_alloc` (`malloc`/`free`/`calloc`/`realloc`) | 288 | (A) |
| `maybe_uninit` | 182 | (B)/(C) — `MaybeUninit::assume_init` chains, mostly safe via `init_array` |
| `mem_transmute` | 30 | (C) — most are `bytemuck`/`zerocopy` candidates; some are lifetime extensions ((A) or (B)) |
| `mem_zeroed` (`mem::zeroed`) | 10 | (B) — `Default::default()` works for most non-FFI uses |
| `pin_unchecked` (also catches `NonNull::new_unchecked`) | 62 | (C) — most are non-null asserts that could be `NonNull::from(...)` |
| `compiler_hint` (`unreachable_unchecked`/`assert_unchecked`) | 17 | (B) PERF_ONLY |
| `unchecked_index` (`get_unchecked`) | 13 | (B) PERF_ONLY |
| `unsafe_cell` | 28 | (A)/(B) — interior mutability where `Cell` is insufficient |
| `atomic` | 101 | (A) — atomics are safe in Rust but `fence` and unsynchronized ops need unsafe |
| `send_impl` | 87 | mix — many are auto-derivable; some require raw-pointer field justification |
| `sync_impl` | 78 | same as send_impl |
| `other_unsafe_impl` | 188 | needs per-site triage |
| `jsc_object_handle` | 55 | (A) — JSC GC handles |
| `smart_ptr_raw` (`Box::from_raw`/`Arc::from_raw`/etc.) | 55 | (A)/(C) — most are paired with `into_raw`, refactorable to owned |
| `jsc_ffi` | 8 | (A) |
| `zig_legacy_str` (`ZigString`/`zig_str`) | 12 | (A)/(C) — bridge to legacy Zig string types |
| `other` (after refinement) | 3,533 | needs Phase 2 triage; many are `(*ptr).field.method()` style |

(Categories overlap; a single site can carry multiple labels. The category counts sum to more than 11,044.)

## Limitations of this enumeration

1. **`cargo geiger` failed on every crate.** Bun's vendor deps (`lolhtml/c-api`, `tinycc`, etc.) aren't checked in — they're fetched at build time by `scripts/build/deps/*.ts`. Without those, `cargo metadata` itself fails (`No such file or directory: vendor/lolhtml/c-api/Cargo.toml`), and `cargo geiger` / `cargo expand` / `cargo +nightly rustdoc --output-format json` all depend on a working `cargo metadata`. Geiger would have given us a baseline unsafe count to track drift; we'll rely on the ast-grep inventory instead.

2. **`cargo expand` not run.** Same root cause. This means **macro-generated unsafe is invisible to this audit** — specifically, derives that emit unsafe (e.g., `pin-project-lite`, `zerocopy-derive`, custom `bun_jsc_macros`, `bun_clap_macros`, `bun_core_macros`, `bun_css_derive`). The inventory's macro-expanded unsafe count is **0**; the true count is probably in the hundreds. A subsequent audit pass should resolve the vendor-dep issue (e.g., by running `bun bd` once to materialize the deps) and re-run `cargo expand`.

3. **No rustdoc JSON.** Same cause. Without rustdoc JSON, the "reachability from `pub` API" analysis in Phase 3 uses a coarse heuristic (per-file visibility scanning) rather than a precise call graph.

4. **ast-grep structural patterns are conservative.** They catch only the syntactic shapes listed; semantic equivalents spelled differently (e.g., `std::mem::transmute` vs `mem::transmute` vs `core::mem::transmute` with turbofish) are caught by the text-based categorizer but not the structural patterns.

5. **`.zig` files were correctly excluded** (per project policy — they're reference-only). Some crates have `.zig` files outnumbering `.rs` files; the inventory is `.rs`-only.

These limitations are explicitly recorded so future passes (especially the user's planned multi-harness comparison) can address them without surprise.
