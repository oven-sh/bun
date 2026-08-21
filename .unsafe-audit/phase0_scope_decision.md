# Phase 0 — Scope Decision

**Project:** Bun (oven-sh/bun) — JavaScript runtime ported from Zig to Rust in commit `23427db` (16 hours before this audit).
**Audit run:** rust-unsafe-code-exorcist, pass 1 of N (user plans multi-harness triangulation across Claude Code + codex/gpt-5.5).
**Date:** 2026-05-14

## Mode, profile, authorization

| Setting | Value | Rationale |
|---------|-------|-----------|
| Mode | `audit-and-refactor` | User wants the full marketing artifact AND a demonstration PR option. Phase 11 will gate any source edit on explicit cluster-level approval. |
| Toolchain profile | `full` | nightly + miri + cargo-geiger + cargo-expand + cargo-careful + cargo-fuzz + cargo-mutants + hyperfine all installed during bootstrap. |
| Perf budget | `5%` | Default; reasonable for a runtime. Phase 5 plans must measure deltas for any (B)→(C) graduation. |
| Execution authorization | `refactor-on-approve` | Per cluster, Phase 11. No source edits until explicit approval. |
| GitHub authorization | **NONE — local only** | User is running multi-harness; will push only after comparing runs. No `git push`, no `gh pr create`, no remote-mutating action without explicit per-action approval. See `~/.claude/projects/-data-projects-bun/memory/feedback_no_github_push_without_auth.md`. |

## Scope: in vs. out

### IN scope (108 workspace crates, all Rust under `src/`)

The full workspace, per user request. Auto-detected mode was `audit-only` (default fallback for a binary crate with no recent `unsafe|miri|loom|UB|soundness` commits in the message window); the user overrode to `audit-and-refactor` because they want demonstration-PR option.

Top density by directory (raw count of `unsafe fn|impl|trait|extern|{` patterns from preliminary ripgrep — see `phase1/*__ast_*.json` for the precise ast-grep counts after Phase 1):

| Crate dir | Unsafe hits | .rs files | Primary character |
|-----------|------------:|----------:|-------------------|
| `runtime/` | 5302 | 438 | JS-visible runtime APIs; mixed FFI / JSC bindings / safe code |
| `jsc/` | 900 | 124 | JavaScriptCore C++ glue (Rust side); mostly (A) FFI |
| `install/` | 568 | 71 | npm package manager; mixed |
| `bun_core/` | 562 | 38 | Foundation: strings, allocators, output — high (B) and (C) potential |
| `bundler/` | 525 | 51 | JS/TS bundler; performance-critical |
| `sys/` | 416 | 16 | Cross-platform syscall wrappers; mostly (A) syscall FFI |
| `bun_alloc/` | 296 | 15 | Allocator implementation; mostly (A) (allocator identity) |
| `ptr/` | 154 | 11 | Pointer utilities; rich (C) candidate surface |
| `*_sys/` (boringssl, brotli, cares, libdeflate, libuv, lolhtml, mimalloc, picohttp, simdutf, spawn, tcc, libarchive, uws, windows, zlib) | varies | varies | Almost entirely (A) — FFI bindings to vendored C/C++ |
| `*_jsc/` (ast_jsc, bundler_jsc, css_jsc, http_jsc, install_jsc, js_parser_jsc, patch_jsc, semver_jsc, sourcemap_jsc, sql_jsc, sys_jsc, url_jsc) | varies | varies | Rust side of JSC C++ interop; mostly (A) |

### OUT of scope (explicit)

- `vendor/` — vendored C/C++ libraries. Not Rust. Their soundness is upstream's problem; we only audit the Rust bridges in `*_sys` crates that wrap them.
- `src/jsc/bindings/*.cpp` — C++ bindings. Out of skill scope (Rust-only).
- `src/js/**/*.ts` — built-in JS modules.
- `.zig` files alongside `.rs` files — reference-only per AGENTS.md (kept for porting semantics; not compiled).
- `test/` and `bench/` — test code can have unsafe but it doesn't ship.
- `packages/` — TypeScript user-facing packages.
- `scripts/` — build/dev scripts (TypeScript/JavaScript).

### Dep-side reachable unsafe (in scope for soundness-surface)

These dependency crates' unsafe IS reachable through Bun's public API and will be characterized in Phase 3 (not modified — we wrap, replace, or file upstream issues):

- `mimalloc` (via `bun_mimalloc_sys`) — global allocator, all heap touches Bun does
- `lsquic` / HTTP3 stack — entire HTTP/3 surface
- `boringssl` — TLS / crypto
- `libuv` — Windows event loop
- `libarchive` — tar/zip
- `lolhtml` — HTMLRewriter
- `picohttp` — HTTP parser
- `tinycc` — FFI JIT
- WebKit/JavaScriptCore — JS engine

## Activated pattern bundles

Based on the preliminary surface scan (>1600 `extern "C"` occurrences, 119 `MaybeUninit::assume_init*`, 54 `Pin::new_unchecked`, 25 `mem::transmute`, 1460 `from_raw|into_raw`, 27 `get_unchecked`, ~1027 `unsafe impl`, ~3 `unsafe trait`), all of the following pattern bundles activate:

- `00-CANONICAL-UNAVOIDABLE.md` — every `*_sys` crate, allocator, signal handlers
- `10-POINTER-MIGRATIONS.md` — `bun_ptr/`, `bun_io/`, raw pointer hand-rolling across runtime/
- `20-SIMD-AND-PERF.md` — `bun_simdutf_sys`, `bun_highway`, `bun_base64`, `bun_wyhash`, `bun_unicode`
- `25-INTRINSICS-AND-COMPILER-HINTS.md` — likely scattered; rg shows `core::hint::*` usage in some perf-critical paths
- `27-UNSAFECELL-PATTERNS.md` — to be enumerated in Phase 1
- `30-CONCURRENCY-PATTERNS.md` — `bun_threading`, `bun_event_loop`, `bun_dispatch`
- `35-ATOMICS-AND-ORDERINGS.md` — atomics scattered across event loop and threading
- `40-MACRO-GENERATED-UNSAFE.md` — `bun_clap_macros`, `bun_jsc_macros`, `bun_css_derive`, `bun_core_macros` will need `cargo expand` accounting
- `50-SEND-SYNC-IMPLS.md` — ~1027 `unsafe impl` is a LARGE Send/Sync audit surface; will dominate Phase 3 synthesis
- `60-FFI-PATTERNS.md` — every `*_sys` crate, `bun_jsc`, `bun_runtime/api/`
- `65-ALLOCATOR-PATTERNS-DEEP.md` — `bun_alloc`, mimalloc bridge, arena/bumpalo usage
- `70-UNINIT-AND-TRANSMUTE.md` — 119 `assume_init*` + 25 `transmute` = real surface
- `75-LOCK-FREE-PATTERNS.md` — event loop, JSC garbage collector callbacks
- `80-PIN-PROJECTIONS.md` — 54 `Pin::new_unchecked` = async runtime, Bun.serve
- `85-PROC-MACRO-UNSAFE.md` — `bun_codegen`, derive macros
- `90-OPERATIONS.md` — for the harness + bead conversion

Pattern bundles NOT activated:
- `45-WASM-AND-CXX.md` — no wasm-bindgen / pyo3 / napi-rs (Bun has its own NAPI but doesn't use the `napi` crate)
- `55-EMBEDDED-PATTERNS.md` — Bun is not embedded
- `100-CRYPTOGRAPHY-AUDIT.md` — Bun uses BoringSSL via FFI; its own crypto code is small and we'll audit it inline
- `130-TAGGED-POINTER-MIGRATION.md` — to be checked in Phase 1; will activate if we find `as usize` tagged-pointer patterns

## What this audit will NOT do

- Audit the C++ side of JSC bindings (`src/jsc/bindings/*.cpp`) — out of skill scope
- Audit the vendored C/C++ libraries — upstream's responsibility
- Audit JavaScript built-ins in `src/js/`
- Replace BoringSSL with rustls, libuv with mio, mimalloc with jemalloc, etc. — these are architectural choices outside an unsafe-audit's remit
- Rewrite the JSC C++ FFI surface in safe Rust (impossible by definition; the (A) bucket will be large here)
- Make claims that cargo-expand-derived unsafe is a Bun authorship problem when it's a derive-macro authorship problem (e.g., `pin-project-lite`, `bytemuck-derive`) — those go to the dep-soundness surface
- Push any artifact to GitHub without explicit per-action approval

## Phase-by-phase plan adjustments for Bun's scale

Standard skill flow assumes O(100) unsafe sites. Bun has O(10000+). Adjustments:

- **Phase 1 enumerate:** runs as written but `cargo expand` on 108 crates may take hours; if it stalls past 2 hours we'll skip expand on non-derive crates and re-attempt later. ast-grep enumeration is unaffected.
- **Phase 2 per-site write-up:** writing one `.md` per site is infeasible at 10k+. We cluster aggressively in Phase 3 first, then write one per-cluster write-up + per-representative-site write-ups (target: ~150-300 cluster reps, not 10k individual files).
- **Phase 3 synthesize:** is the load-bearing phase given the scale. Soundness-surface mapping (which `unsafe` is reachable from `pub`) gets first-class treatment.
- **Phase 4 classify:** per cluster, not per site. The (A)/(B)/(C) judgment applies to the cluster's pattern; per-site overrides documented as exceptions.
- **Phase 5 plans:** per cluster, with one or two representative refactor diffs per (C) cluster.
- **Phase 6 adversarial:** per cluster.
- **Phase 7 fresh-eyes:** the three calibrated prompts run against the proposed cluster-level rewrites.
- **Phase 8 beads:** one parent epic per refactor cluster (per skill), one bead per representative site, plus a "remaining sites in this cluster" bead with the bulk count.
- **Phase 9 verify harness:** the harness is the project's own `cargo test` + miri on selected crates + `cargo +nightly geiger` baseline. We will NOT try to make miri pass on the entire Bun test suite — Bun's tests touch the filesystem, network, and JS engine heavily; we run miri on the safe-only impls and the property-equivalence tests authored in Phase 5.
- **Phase 10 maintainer-lens:** the maintainer-empathy review reads the audit cold and gives the "would the Bun maintainers land this?" verdict. /idea-wizard runs against the highest-impact clusters.
- **Phase 11 remediation-offer:** asked once, after the full artifact is built; user picks clusters; all approved refactors land on a single local `claude/unsafe-exorcist-demo` branch in the active checkout. NO PUSH.

## Resumability

Audit dir is `git init`'d; every Phase artifact is committed as it's finished so a future re-run can pick up where this one left off. The user explicitly plans to compare runs from multiple harnesses — the audit dir is the canonical comparison surface.
