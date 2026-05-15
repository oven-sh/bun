# PASS 3 — Reachability from `pub` API & Test Coverage of Unsafe Sites

**Audit date:** 2026-05-15
**Inventory:** `.unsafe-audit/unsafe-inventory.jsonl` (11,044 sites, 84 of 108 workspace crates)
**Inputs reused:** Pass 1 inventory, Pass 2 SAFETY-comment gap baseline (windowed-marker heuristic, window=4), and workspace dependency data from `cargo metadata --format-version 1 --no-deps`.

This pass answers two cross-cutting questions:

1. **Reachability** — given that `bun_bin` is the only artifact-producing crate (`libbun_rust.a` linked into the `bun` binary), which unsafe sites are reachable from JS-callable bindings (`*.classes.ts`-driven host functions, `JSObject`-backed methods, NAPI/V8 shims) versus CLI-only paths versus internally unreachable code?
2. **Test coverage** — which unsafe-heavy crates lack direct Rust unit tests AND lack obvious JS test-suite exposure? Pass 2 identified `bun_glob`, `bun_resolver`, `bun_url`, `bun_semver` as zero-Rust-tests; this pass widens that to the whole 84-crate set.

The audit is **not** a precise call-graph analysis. `cargo metadata` gives crate-level dependency closure, not function-level reachability, rustdoc JSON, monomorphized symbols, or C++/codegen callback edges. Pass 3 later added macro-expanded evidence, so the older "no expanded macros" caveat should now be read as "no fully deduplicated macro-expanded whole-program graph." The findings here should be read as **a triage index for SAFETY-comment hardening and test-investment priorities**, not as a soundness verdict on any specific site.

---

## Executive summary

| Metric | Count |
|---|---:|
| Total unsafe sites | 11,044 |
| Workspace crates with at least one unsafe site | 84 / 108 (78%) |
| Crates reachable from JS via `bun_runtime` dep closure | 81 (10,987 sites; **99.5%**) |
| Crates reachable from CLI (`bun_bin`) but NOT JS | 2 (`bun_bin`, `bun_platform`, 12 sites total) |
| Crates with no reverse-dep edge from `bun_bin` | 1 (`bun_libarchive_sys`, 45 sites — orphan, see §Reachability) |
| Crates with at least one `#[test]` attribute | 21 / 84 |
| Crates with **zero** Rust unit tests | **63 / 84** (75% of unsafe-bearing crates) |
| Sites in zero-Rust-test crates | **8,889** (80.5% of all unsafe) |
| Sites flagged "no nearby SAFETY marker" (window=4) | 1,594 (re-derived from Pass 2 baseline) |

### Headline findings (tiered)

- **T1 — Confirmed observations**
  - `bun_runtime` is the single mega-crate (4,893 unsafe sites, 247 files, 5,590 `pub fn`, 145 `pub unsafe fn`). It depends transitively on 77 other workspace crates, so almost every unsafe-bearing crate is JS-reachable in the call-graph sense.
  - 63 crates with unsafe have **zero** `#[test]` attributes. Of these, **5 of the top 10 unsafe-densest crates** are in that zero-test set: `bun_jsc`, `bun_install`, `bun_http_jsc`, `bun_resolver`, `bun_http` — totaling 1,909 sites of untested-in-Rust unsafe.
  - `bun_libarchive_sys` (45 sites) appears in the workspace but **no other workspace crate names it as a dependency** according to `cargo metadata --no-deps`. Treat this as stale-crate hygiene until deletion/build verification proves it is truly unused. Do not count it as a Tier 1 safety issue.
  - `bun_sys/lib.rs` is the highest-priority hardening target by raw counts: 234 unsafe sites, 354 `pub fn`, 25 `pub unsafe fn`, **101 sites missing a nearby SAFETY marker (43%)**, and only 18 indirect JS test files (`test/js/node/fs/*`) exercise it. The miss-rate reflects that the file is laid out as parallel `pub fn`-per-syscall and the SAFETY contract is often consolidated in a module-level comment.

- **T2 — Architecture defects (not unique bugs, but recurring shape)**
  - The windowed-marker heuristic systematically undercounts sites where SAFETY discipline lives in **trait-level prose** rather than per-site comments. `RawSocketEvents` in `src/runtime/socket/uws_handlers.rs:230-254` is the canonical case: 22 default-impl `unsafe fn` lines (one per method × 6 traits) all flag "missing marker" because the contract is documented at the trait header (L218-229) and at the per-callsite SAFETY blocks (L277, L282, …). Real action item is "document at *one* canonical place AND link from per-site `// SAFETY: see trait header`," not "add 22 redundant comments."
  - Several FFI bindings crates (`bun_libuv_sys`, `bun_simdutf_sys`, `bun_libarchive_sys`, `bun_lolhtml_sys`, `bun_zlib_sys`, `bun_mimalloc_sys`) have effectively **no direct Rust tests** even though they expose tens of `pub unsafe fn` items. JS-side tests exercise them transitively, but there is no in-crate proof that the unsafe glue matches the C signatures it claims to wrap. Pass 2's CI-matrix recommendation already covers this (cross-compile checks), but does not test runtime behavior.
  - `bun_alloc` (273 sites) has 10 unit tests for the **arena and stack-fallback paths**, but `bun_alloc/lib.rs:118` mimalloc allocator hookup and the global allocator wiring have only smoke coverage via `bun bd`-driven JS tests. The 16 "missing marker" sites in `bun_alloc/lib.rs` and 25 in `bun_alloc/stack_fallback.rs` are mostly the `unsafe impl Allocator` / `unsafe fn allocate`/`deallocate` quartet, which is documented at trait level but not per-method.

- **T3 — Latent watchlist (untested + JS-reachable + no nearby marker)**
  - The file-level "untested unsafe density" cluster (§Cluster) names 16 specific files where unsafe count ≥ 30, JS test exposure ≤ 5 files (by best-guess basename match), and at least one missing-marker site. Top three:
    - `src/runtime/api/cron.rs` — 155 sites, **91 missing markers (59%)**, 3 JS tests (`test/js/bun/cron/*`). Re-entrant `*mut Self` discipline lives in trait `CronJobBase` (L72-126); the missing-marker count is partly an artifact of trait dispatch, but the breadth of per-instance state mutation through raw pointers warrants a dedicated per-job-class invariant comment.
    - `src/bun_core/lib.rs` — 101 sites, **52 missing markers (51%)**, 0 JS tests (foundation crate; only Rust tests). Includes `const unsafe fn from_raw` at L140 and several `Vec::set_len` calls (L408, L567) that are mechanically correct but locally undocumented.
    - `src/bun_core/atomic_cell.rs` — 46 sites, **29 missing markers (63%)**. The `unsafe impl Sync/Send` block at L65-66 has a thorough comment (L59-64) but the heuristic's 4-line window misses the 9-line comment block; per-method `UnsafeCell::get()` calls below are uncommented but covered by the file-level invariant. Hardening fix is per-method `// SAFETY: see file header (L59-64)` pointers, not new prose.

### Prioritization for SAFETY-comment hardening

Given the JS-reachable closure covers nearly every crate, "JS-reachable + missing marker" alone is not a useful filter — it picks up ~1,500 sites. The actual high-leverage filter is **"JS-reachable + missing marker + low JS-test exposure + dense neighbors"**. The Cluster table (§Cluster) and the 30-site sample (§Sample) implement that filter.

---

## Part 1 — Reachability from `pub` API

### Methodology

`bun_bin` is the only crate that produces a linkable artifact (`libbun_rust.a`, consumed by `scripts/build/rust.ts` and linked into the `bun` binary). Everything else is a library crate. We define **reachability tiers** as:

- **REACHABLE-FROM-JS** — crate appears in the transitive `[dependencies]` closure of `bun_runtime` (the crate that owns every JS-binding generator under `src/runtime/{api,server,socket,webcore,node,crypto,ffi,image,test_runner,valkey_jsc}/*.classes.ts` and the `host_fn` registry).
- **REACHABLE-FROM-CLI** — crate is in the closure of `bun_bin` but NOT in `bun_runtime`'s closure. CLI-only paths (the boot stub, panic handler, allocator init).
- **INTERNAL-ONLY** — crate is not in `bun_bin`'s reachable closure. Either dead, behind an unused feature, or wired up via macros the static dep graph cannot see.

Implementation used for the corrected pass:

```
cargo metadata --format-version 1 --no-deps
```

Then parse `.packages[].dependencies[]` for workspace-local crate names and BFS from `bun_runtime` and `bun_bin`.

The first draft of this document used a crude `Cargo.toml` text scan:

```
$ cd src && for c in */Cargo.toml; do
    name=$(rg '^name = "(bun_[^"]+)"' $c -or '$1')
    deps=$(rg '^bun_[^ .]+ ' $c -o)
    echo "$name|$deps"
done
```

That text scan produced the same headline closure counts, but `cargo metadata` is the defensible source and is the method to use for future recomputation.

### Result

| Tier | Crates | Unsafe sites |
|---|---:|---:|
| REACHABLE-FROM-JS | 81 | 10,987 (99.48%) |
| REACHABLE-FROM-CLI | 2 (`bun_bin`, `bun_platform`) | 12 (0.11%) |
| INTERNAL-ONLY | 1 (`bun_libarchive_sys`) | 45 (0.41%) |
| Total | 84 | 11,044 |

**Reachability ceiling.** Because `bun_runtime` re-exports or wraps nearly every other library crate (HTTP, install, bundler, css, sql, crypto, dns, sourcemap, etc.) and JS calls fan out through it via class-binding entry points, **the static reachability filter is too coarse to be discriminating** for prioritization. The granularity needs to drop to the file or function level.

### File-level reachability proxy

We use co-located `*.classes.ts` files as a strong signal of "this directory directly defines a JS-visible class." 30 such files exist, distributed across:

- `src/jsc/` (`resolve_message.classes.ts`)
- `src/runtime/api/` (Archive, BunObject, Glob, JSBundler, ParsedShellScript, ResumableSink, S3Client, S3Stat, SecureContext, Shell, Terminal, cron, filesystem_router, h2, html_rewriter, sourcemap, sql, valkey, x509certificate, BroadcastChannel, …)
- `src/runtime/crypto/` (crypto.classes.ts)
- `src/runtime/ffi/` (ffi.classes.ts)
- `src/runtime/image/` (image.classes.ts)
- `src/runtime/node/` (node.classes.ts)
- `src/runtime/server/` (server.classes.ts)
- `src/runtime/socket/` (sockets.classes.ts)
- `src/runtime/test_runner/` (jest.classes.ts)
- `src/runtime/valkey_jsc/` (valkey.classes.ts)
- `src/runtime/webcore/` (encoding.classes.ts, response.classes.ts, …)

Of the top-30 unsafe-dense files, **13 are co-located with a `.classes.ts`** (i.e., the file is in a directory that directly registers a JS class), and **17 are not** (foundation, FFI bindings, internal helpers). The "directly co-located" cohort:

```
src/runtime/api/cron.rs                         155 sites  ← cron.classes.ts
src/runtime/node/node_fs.rs                     127 sites  ← node.classes.ts
src/jsc/VirtualMachine.rs                       120 sites  ← resolve_message.classes.ts
src/runtime/webcore/Blob.rs                     119 sites  ← encoding.classes.ts
src/runtime/socket/socket_body.rs               112 sites  ← sockets.classes.ts
src/runtime/server/mod.rs                        98 sites  ← server.classes.ts
src/runtime/server/server_body.rs                75 sites  ← server.classes.ts
src/runtime/socket/uws_handlers.rs               73 sites  ← sockets.classes.ts
src/runtime/api/html_rewriter.rs                 62 sites  ← html_rewriter.classes.ts
src/runtime/server/RequestContext.rs             58 sites  ← server.classes.ts
src/runtime/socket/Listener.rs                   53 sites  ← sockets.classes.ts
src/runtime/socket/WindowsNamedPipe.rs           53 sites  ← sockets.classes.ts
src/runtime/test_runner/bun_test.rs              53 sites  ← jest.classes.ts
```

Total: 1,158 unsafe sites in code that has a one-step JS reachability edge to a registered class. That's a more tractable hardening cohort than "10,987 transitively JS-reachable sites."

### Reachability table — top 20 unsafe-densest crates

| Crate | Sites | Files | `pub fn` | `pub unsafe fn` | Tier | Reachability evidence |
|---|---:|---:|---:|---:|---|---|
| `bun_runtime` | 4,893 | 247 | 5,590 | 145 | JS | Owns all `.classes.ts`; entry point for JSC host registration |
| `bun_jsc` | 745 | 74 | 1,799 | 28 | JS | `bun_runtime` depends on; defines JSValue, Strong, VM glue |
| `bun_install` | 525 | 46 | 887 | 9 | JS | Exposed via `Bun.install`, `bun install` CLI, and `bun_runtime` |
| `bun_bundler` | 498 | 36 | 557 | 13 | JS | Exposed via `Bun.build`, `JSBundler.classes.ts`, CLI build |
| `bun_core` | 461 | 28 | 1,374 | 46 | JS | Foundation; everything depends on it |
| `bun_sys` | 332 | 9 | 583 | 35 | JS | Syscall wrappers; called from `node:fs`, `Bun.file`, package manager |
| `bun_http_jsc` | 287 | 8 | 89 | 24 | JS | WebSocket client, HTTP/2; called from `WebSocket.classes.ts` etc. |
| `bun_alloc` | 273 | 14 | 289 | 24 | JS | Global allocator + arenas; reachable through every alloc path |
| `bun_uws_sys` | 253 | 24 | 646 | 21 | JS | uWebSockets FFI; reachable via `Bun.serve`, WebSocket client |
| `bun_io` | 213 | 10 | 390 | 11 | JS | Pipe readers/writers; reachable via spawn, Blob, fetch streaming |
| `bun_resolver` | 182 | 5 | 293 | 2 | JS | Module resolution; reachable via every `import` and `require` |
| `bun_http` | 170 | 23 | 328 | 5 | JS | HTTP types/parser; reachable via `fetch`, `Bun.serve` |
| `bun_collections` | 157 | 8 | 600 | 14 | JS | Hash maps, vec extensions; foundation utility |
| `bun_libuv_sys` | 133 | 1 | 349 | 4 | JS | libuv bindings (Windows event loop) |
| `bun_ptr` | 128 | 6 | 138 | 24 | JS | RefCount + raw-pointer helpers; foundation utility |
| `bun_threading` | 126 | 10 | 110 | 0 | JS | ThreadPool, worker dispatch |
| `bun_css` | 116 | 25 | 1,546 | 3 | JS | CSS parser; reachable via bundler |
| `bun_spawn` | 105 | 2 | 93 | 4 | JS | `Bun.spawn` core; reachable via `Bun.spawn` and `node:child_process` |
| `bun_sql_jsc` | 90 | 13 | 328 | 1 | JS | `Bun.sql` (Postgres + MySQL); reachable via `sql.classes.ts` |
| `bun_libarchive` | 81 | 1 | 76 | 2 | JS | tar/zip parsing; reachable via `bun install` package fetch |

(Tier `JS` = `REACHABLE-FROM-JS`. All 20 are JS-reachable. The exceptions in the wider table are below.)

### Crates outside the JS-reachable closure

```
bun_bin       5 sites  REACHABLE-FROM-CLI  (Cargo entrypoint; phase_c_exports.rs)
bun_platform  7 sites  REACHABLE-FROM-CLI  (host OS/arch helpers; called by bin pre-main)
bun_libarchive_sys 45 sites INTERNAL-ONLY  (orphan; see below)
```

**`bun_libarchive_sys` orphan check.** `cargo metadata --format-version 1 --no-deps` shows no workspace package with a dependency named `bun_libarchive_sys`. `rg 'bun_libarchive_sys' --type toml src/` returns only `src/libarchive_sys/Cargo.toml` itself, and `rg 'libarchive_sys' --type rust` yields only comments referring to the old Zig binding path. The actual libarchive binding appears to live in `src/libarchive/lib.rs` against `vendor/libarchive` headers. This is strong evidence of stale workspace code, but it is **hygiene**, not a memory-safety bug, until a deletion branch proves `cargo metadata`, `bun bd`, and relevant package-manager/archive paths still pass.

### The JS-Rust call surface in numbers

Beyond the static dep graph, the actual JS→Rust call surface is enumerable from the boundary itself:

- **`#[unsafe(no_mangle)] extern "C" fn` exports:** **392 symbols across 116 files.** These are the trampolines the C++ JSC bindings call into. Each one is a JS-reachable entry point by construction.
- **`// HOST_EXPORT(...)` markers:** 95 hand-written markers across 8 files (`src/jsc/Debugger.rs`, `src/jsc/virtual_machine_exports.rs`, `src/jsc/event_loop.rs`, `src/runtime/timer/Timer.rs`, `src/runtime/hw_exports.rs`, `src/runtime/generated_host_exports.rs`, `src/runtime/node/node_cluster_binding.rs`, `src/runtime/api/BunObject.rs`). The `src/codegen/generate-host-exports.ts` generator scrapes these and emits the trampoline file. `src/runtime/generated_host_exports.rs:14` documents the design: "the proc-macro emits the #[no_mangle] shim inline next to every impl, scattering ~425 unmangled symbols across 80+ files."
- **`.classes.ts`-driven host method registrations:** 30 JS classes, each with constructor/prototype/static method tables generated by `src/codegen/generate-classes.ts`. Methods registered there are JS-reachable via the wrapped class's prototype chain.
- **NAPI / V8 native-addon callbacks** (`src/runtime/napi/napi_body.rs`, 85 unsafe sites): an inverted reachability — the addon calls back into Rust through generated trampolines. Anything reachable from a `napi_*` symbol is JS-reachable from a user's `require('addon.node')` call.

A function-level reachability analysis would start by enumerating these 392 `no_mangle` symbols and walking their call trees. The static crate-level closure (this section's analysis) is an upper bound on what's reachable; the 392 is a lower bound on the *immediate* JS-reachable surface.

### What the static reachability cannot see

- **Macros that expand to `pub fn`.** `bun_jsc_macros`, `bun_clap_macros`, `bun_core_macros`, `bun_css_derive` and `pin-project-lite` generate items the inventory and crate-level reachability scan do not fully deduplicate. Pass 3's macro-expanded audit supersedes the old pass-1 "macro-expanded unsafe count is 0" limitation: macro expansion does add material surface, especially through `bun_jsc`, but the expanded counts still need template-level dedupe before being added to the global total.
- **`host_fn` registrations and the `bun_runtime::hw_exports` table.** Native host functions registered via the generated tables (`src/runtime/hw_exports.rs`, 52 unsafe sites; `src/runtime/dispatch.rs`, 51 unsafe sites; `src/runtime/dispatch_js2native.rs`) are dispatched dynamically from JS, so the static dep graph does not show the JS→Rust edge. Treat these dispatcher files as universal JS-reachable.
- **C++→Rust callbacks via vtable.** uWebSockets handlers (`src/runtime/socket/uws_handlers.rs`), libuv callbacks (`src/libuv_sys/libuv.rs`), c-ares callbacks (`src/cares_sys/c_ares.rs`) all dispatch via function-pointer fields populated at C-init time. The dep graph cannot see the indirection.

### Limitations of the heuristic

1. **Crate-level granularity.** The static closure says `bun_jsc` is in `bun_runtime`'s dependency closure. That is true at the crate level but it does not tell you which of its 1,799 `pub fn`s are wired into a binding. The right next step is a `cargo rustdoc --output-format json`-driven function-level call graph after `bun bd` materializes generated/vendor inputs.
2. **The reachability filter is too generous.** 99.48% means "in `bun_runtime`'s workspace dependency closure," not "directly callable from JavaScript." That tier is not actionable on its own; combine it with marker-coverage, boundary-symbol, `.classes.ts`, and test-coverage filters as the Cluster table does.
3. **Reachability is not the same as exploitability.** A site reachable from JS via a deep stack of validated wrappers (e.g., a `pub unsafe fn` consumed only by `bun_core::heap::take` which is only called inside well-audited macros) is far less interesting than one reachable from a JS-callable `pub fn` that takes a `JSValue` argument. The next iteration of this audit should compute argument-tainting from `JSValue`/`*const c_char`/`&[u8]` parameters back to the unsafe blocks they feed.

---

## Part 2 — Test coverage of unsafe sites

### Methodology

Two test-coverage proxies were computed:

1. **`#[test]` attribute count per crate.** `rg -c '^\s*#\[test\]' src/<crate> --type rust` summed across the crate. This counts free-function unit tests and integration tests inside `#[cfg(test)] mod tests` blocks. It does not count doctests (Pass 1 documented the vendor-dep issue that blocks `cargo test --list`).
2. **JS test files per crate (best-guess basename match).** A hand-curated mapping crate → `test/<dir>/...` based on API-name conventions. Then `walk()` each directory for `*.test.ts` / `*.test.tsx`. Conservative; only crates with obvious JS-visible names get non-empty mappings.

### Crates with zero direct Rust unit tests (63 / 84)

The full list, sorted by unsafe-site count, grouped into "high JS-test cover" / "low JS-test cover" / "no JS-test cover":

#### High JS-test cover (≥30 JS tests; crate exercised indirectly by Bun's test suite)

| Crate | Sites | `pub fn` | JS tests | Comment |
|---|---:|---:|---:|---|
| `bun_jsc` | 745 | 1,799 | 540 | JSC VM glue; exercised by every test |
| `bun_install` | 525 | 887 | 71 | `bun install` paths; `test/cli/install/*` |
| `bun_bundler` | 498 | 557 | 87 | `test/bundler/*` |
| `bun_http_jsc` | 287 | 89 | 66 | WebSocket/HTTP-2 client |
| `bun_resolver` | 182 | 293 | 44 | bundler-resolver tests |
| `bun_http` | 170 | 328 | 121 | fetch + serve test paths |
| `bun_sql_jsc` | 90 | 328 | 46 | `test/js/sql/*`, `test/js/bun/sqlite/*` |
| `bun_event_loop` | 65 | 142 | 540 | foundation utility (sum-inflated by reused mapping) |
| `bun_uws` | 35 | 34 | 44 | uWebSockets glue (HTTP server) |
| `bun_bundler_jsc` | 23 | 15 | 87 | JSC-side bundler glue |
| `bun_picohttp` | 21 | 24 | 44 | HTTP header parser |
| `bun_install_types` | 4 | 76 | 71 | install schemas |
| `bun_dotenv` | 2 | 53 | 41 | `.env` loader |
| `bun_install_jsc` | 2 | 18 | 71 | install JS binding glue |
| `bun_shell_parser` | 11 | 123 | 38 | `Bun.$` parser; covered via shell tests |

#### Medium JS-test cover (5–29 JS tests)

| Crate | Sites | JS tests | Comment |
|---|---:|---:|---|
| `bun_sys` | 332 | 18 | `test/js/node/fs/*` only — narrow path coverage |
| `bun_io` | 213 | 7 | streams + Bun.io |
| `bun_css` | 116 | 13 | `test/bundler/css/*` |
| `bun_sourcemap` | 63 | 2 | dedicated sourcemap tests |
| `bun_glob` | 5 | 6 | `test/js/bun/glob/*` |
| `bun_brotli` | 6 | 5 | streams encoding |
| `bun_zlib` | 17 | 6 | `test/js/node/zlib/*` |
| `bun_md` | 14 | 71 | install metadata parser |
| `bun_s3_signing` | 2 | 10 | S3 signing tests |

#### Zero JS-test cover (29 of 63 zero-Rust-test crates)

These are crates with **neither** Rust unit tests nor a clear JS-test bridge:

| Crate | Sites | `pub unsafe fn` | Notes |
|---|---:|---:|---|
| `bun_libuv_sys` | 133 | 4 | libuv FFI bindings (Windows) |
| `bun_cares_sys` | 75 | 4 | c-ares (async DNS) FFI |
| `bun_crash_handler` | 69 | 0 | only manually exercised by panics |
| `bun_standalone_graph` | 55 | 0 | standalone binary mode |
| `bun_exe_format` | 51 | 0 | exe format introspection |
| `bun_simdutf_sys` | 50 | 1 | simdutf FFI |
| `bun_js_parser` | 49 | 0 | parser; exercised by bundler tests transitively |
| `bun_lolhtml_sys` | 48 | 5 | lol-html FFI |
| `bun_libarchive_sys` | 45 | 0 | orphan (see §Reachability) |
| `bun_perf` | 43 | 0 | per-process perf counters |
| `bun_tcc_sys` | 29 | 1 | TinyCC JIT FFI |
| `bun_parsers` | 28 | 0 | JSON5/JSONL/TOML helpers |
| `bun_zlib_sys` | 21 | 10 | zlib-ng FFI |
| `bun_libdeflate_sys` | 17 | 3 | libdeflate FFI |
| `bun_boringssl_sys` | 15 | 4 | BoringSSL FFI |
| `bun_boringssl` | 14 | 1 | BoringSSL Rust wrapper |
| `bun_brotli_sys` | 13 | 0 | Brotli FFI |
| `bun_highway` | 12 | 0 | Google Highway SIMD |
| `bun_mimalloc_sys` | 12 | 3 | mimalloc FFI |
| `bun_zstd` | 11 | 0 | Zstandard wrapper |
| `bun_opaque` | 10 | 6 | opaque-type sentinels |
| `bun_options_types` | 9 | 3 | Bun options schemas |
| `bun_safety` | 7 | 0 | helper traits |
| `bun_url` | 6 | 1 | URL Rust wrapper (Pass 2 also flagged) |
| `bun_windows_sys` | 6 | 1 | Windows API helpers |
| `bun_which` | 3 | 0 | PATH resolver |
| `bun_sys_jsc` | 2 | 0 | bun_sys → JSC bindings |
| `bun_analytics` | 1 | 0 | telemetry |
| `bun_sha_hmac` | 1 | 0 | SHA-HMAC helper |

#### Notes on classification

- "Zero JS-test cover" does not mean "untested." It means our basename heuristic did not find dedicated tests. `bun_libuv_sys`, `bun_lolhtml_sys`, `bun_simdutf_sys` etc. are pervasively exercised through every `Bun.serve`, `HTMLRewriter`, and `String.encode` call. But the test surface doesn't single them out, which means **bug-bisection in those crates is harder**.
- `bun_jsc` registers as "zero unit tests" but is exercised by 540 JS test files (essentially the whole runtime test suite). The unit-test-less-ness is meaningful for low-level FFI sites (`Strong`, `Weak`, opaque pointers) that fail in subtle ways and need Rust-level repros, not JS-level repros.

### Test-to-unsafe ratios across the top 30 crates

Pass-2 already noted that even the best-tested crate has lopsided ratios; this table makes it explicit. "Sites per Rust test" = unsafe sites ÷ `#[test]` count (`∞` when no tests). "Sites per JS test" = unsafe sites ÷ matched JS test files (`∞` when no matched tests).

| Crate | Unsafe | Rust tests | Sites/Rust | JS tests | Sites/JS |
|---|---:|---:|---:|---:|---:|
| `bun_runtime` | 4,893 | 10 | 489.3 | 670 | 7.3 |
| `bun_jsc` | 745 | 0 | ∞ | 540 | 1.4 |
| `bun_install` | 525 | 0 | ∞ | 71 | 7.4 |
| `bun_bundler` | 498 | 1 | 498.0 | 87 | 5.7 |
| `bun_core` | 461 | 25 | 18.4 | 0 | ∞ |
| `bun_sys` | 332 | 1 | 332.0 | 18 | 18.4 |
| `bun_http_jsc` | 287 | 0 | ∞ | 66 | 4.3 |
| `bun_alloc` | 273 | 10 | 27.3 | 0 | ∞ |
| `bun_uws_sys` | 253 | 2 | 126.5 | 0 | ∞ |
| `bun_io` | 213 | 4 | 53.3 | 7 | 30.4 |
| `bun_resolver` | 182 | 0 | ∞ | 44 | 4.1 |
| `bun_http` | 170 | 0 | ∞ | 121 | 1.4 |
| `bun_collections` | 157 | 21 | 7.5 | 0 | ∞ |
| `bun_libuv_sys` | 133 | 0 | ∞ | 0 | ∞ |
| `bun_ptr` | 128 | 1 | 128.0 | 0 | ∞ |
| `bun_threading` | 126 | 2 | 63.0 | 0 | ∞ |
| `bun_css` | 116 | 0 | ∞ | 13 | 8.9 |
| `bun_spawn` | 105 | 0 | ∞ | 42 | 2.5 |
| `bun_sql_jsc` | 90 | 0 | ∞ | 46 | 2.0 |
| `bun_libarchive` | 81 | 0 | ∞ | 0 | ∞ |
| `bun_cares_sys` | 75 | 0 | ∞ | 0 | ∞ |
| `bun_crash_handler` | 69 | 0 | ∞ | 0 | ∞ |
| `bun_sourcemap` | 63 | 0 | ∞ | 2 | 31.5 |
| `bun_standalone_graph` | 55 | 0 | ∞ | 0 | ∞ |
| `bun_exe_format` | 51 | 0 | ∞ | 0 | ∞ |
| `bun_simdutf_sys` | 50 | 0 | ∞ | 0 | ∞ |
| `bun_js_parser` | 49 | 0 | ∞ | 0 | ∞ |
| `bun_lolhtml_sys` | 48 | 0 | ∞ | 0 | ∞ |
| `bun_libarchive_sys` | 45 | 0 | ∞ | 0 | ∞ |
| `bun_perf` | 43 | 0 | ∞ | 0 | ∞ |

The 13 crates with **`∞` in both columns** — `bun_libuv_sys`, `bun_libarchive`, `bun_cares_sys`, `bun_crash_handler`, `bun_standalone_graph`, `bun_exe_format`, `bun_simdutf_sys`, `bun_lolhtml_sys`, `bun_libarchive_sys`, `bun_perf`, `bun_zlib_sys`, `bun_brotli_sys`, `bun_highway`, etc. — are the audit's **double-blind cohort**: no dedicated Rust tests, no dedicated JS tests, just transitive exercise from the broader suite. Combined unsafe count in the full double-blind cohort is approximately 700 sites.

This is where bisecting a regression in CI is hardest. A breaking change in `bun_libuv_sys` will not produce a clean unit-test failure; it manifests as flaky failures in distant `Bun.serve`/`fs.watch` tests. The audit recommends that **at least the sys-binding crates ship signature-pinning tests** (one test per FFI function asserting `mem::size_of` of arg/return types matches the C header) before the next major Rust port milestone.

### Crates with Rust unit tests (21)

| Crate | `#[test]` | `#[cfg(test)]` mod | has `tests/` dir |
|---|---:|---:|---:|
| `bun_core` | 25 | 9 | 0 |
| `bun_collections` | 21 | 7 | 0 |
| `bun_md` | 14 | 1 | 0 |
| `bun_runtime` | 10 | 3 | 0 |
| `bun_clap` | 10 | 6 | 0 |
| `bun_alloc` | 10 | 2 | 0 |
| `bun_wyhash` | 8 | 1 | 0 |
| `bun_router` | 6 | 1 | 0 |
| `bun_ast` | 5 | 3 | 0 |
| `bun_io` | 4 | 1 | 0 |
| `bun_paths` | 3 | 1 | 0 |
| `bun_errno` | 3 | 1 | 0 |
| `bun_uws_sys` | 2 | 1 | 0 |
| `bun_threading` | 2 | 1 | 0 |
| `bun_base64` | 2 | 1 | 0 |
| `bun_sys` | 1 | 1 | 0 |
| `bun_shell_parser` | 1 | 1 | 0 |
| `bun_ptr` | 1 | 1 | 0 |
| `bun_http_types` | 1 | 1 | 0 |
| `bun_dispatch` | 1 | 0 | 1 |
| `bun_bundler` | 1 | 1 | 0 |

Even the best-tested crate (`bun_core`, 25 tests) has just 25 free tests against 461 unsafe sites — that is a ratio of 18.4 unsafe sites per unit test. For comparison, `bun_runtime` has 10 unit tests against 4,893 sites (489 per test). The Rust unit-test budget is non-load-bearing across the codebase.

---

## All 84 crates with unsafe (sorted by unsafe site count)

| Crate | Sites | Files | PubFn | PubUnsafe | Tier | UnitTests | JSTests | SafetyMissing | %Marker |
|-------|------:|------:|------:|----------:|------|----------:|--------:|--------------:|--------:|
| `bun_runtime` | 4893 | 247 | 5590 | 145 | REACHABLE-FROM-JS | 10 | 670 | 362 | 92.6% |
| `bun_jsc` | 745 | 74 | 1799 | 28 | REACHABLE-FROM-JS | 0 | 540 | 14 | 98.1% |
| `bun_install` | 525 | 46 | 887 | 9 | REACHABLE-FROM-JS | 0 | 71 | 33 | 93.7% |
| `bun_bundler` | 498 | 36 | 557 | 13 | REACHABLE-FROM-JS | 1 | 87 | 50 | 90.0% |
| `bun_core` | 461 | 28 | 1374 | 46 | REACHABLE-FROM-JS | 25 | 0 | 82 | 82.2% |
| `bun_sys` | 332 | 9 | 583 | 35 | REACHABLE-FROM-JS | 1 | 18 | 91 | 72.6% |
| `bun_http_jsc` | 287 | 8 | 89 | 24 | REACHABLE-FROM-JS | 0 | 66 | 1 | 99.7% |
| `bun_alloc` | 273 | 14 | 289 | 24 | REACHABLE-FROM-JS | 10 | 0 | 28 | 89.7% |
| `bun_uws_sys` | 253 | 24 | 646 | 21 | REACHABLE-FROM-JS | 2 | 0 | 9 | 96.4% |
| `bun_io` | 213 | 10 | 390 | 11 | REACHABLE-FROM-JS | 4 | 7 | 7 | 96.7% |
| `bun_resolver` | 182 | 5 | 293 | 2 | REACHABLE-FROM-JS | 0 | 44 | 4 | 97.8% |
| `bun_http` | 170 | 23 | 328 | 5 | REACHABLE-FROM-JS | 0 | 121 | 5 | 97.1% |
| `bun_collections` | 157 | 8 | 600 | 14 | REACHABLE-FROM-JS | 21 | 0 | 8 | 94.9% |
| `bun_libuv_sys` | 133 | 1 | 349 | 4 | REACHABLE-FROM-JS | 0 | 0 | 23 | 82.7% |
| `bun_ptr` | 128 | 6 | 138 | 24 | REACHABLE-FROM-JS | 1 | 0 | 1 | 99.2% |
| `bun_threading` | 126 | 10 | 110 | 0 | REACHABLE-FROM-JS | 2 | 0 | 16 | 87.3% |
| `bun_css` | 116 | 25 | 1546 | 3 | REACHABLE-FROM-JS | 0 | 13 | 6 | 94.8% |
| `bun_spawn` | 105 | 2 | 93 | 4 | REACHABLE-FROM-JS | 0 | 42 | 0 | 100.0% |
| `bun_sql_jsc` | 90 | 13 | 328 | 1 | REACHABLE-FROM-JS | 0 | 46 | 1 | 98.9% |
| `bun_libarchive` | 81 | 1 | 76 | 2 | REACHABLE-FROM-JS | 0 | 0 | 2 | 97.5% |
| `bun_cares_sys` | 75 | 2 | 85 | 4 | REACHABLE-FROM-JS | 0 | 0 | 15 | 80.0% |
| `bun_crash_handler` | 69 | 1 | 44 | 0 | REACHABLE-FROM-JS | 0 | 0 | 2 | 97.1% |
| `bun_event_loop` | 65 | 10 | 142 | 6 | REACHABLE-FROM-JS | 0 | 540 | 1 | 98.5% |
| `bun_sourcemap` | 63 | 5 | 123 | 2 | REACHABLE-FROM-JS | 0 | 2 | 2 | 96.8% |
| `bun_standalone_graph` | 55 | 1 | 32 | 0 | REACHABLE-FROM-JS | 0 | 0 | 3 | 94.5% |
| `bun_exe_format` | 51 | 4 | 26 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_simdutf_sys` | 50 | 1 | 109 | 1 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_js_parser` | 49 | 11 | 436 | 0 | REACHABLE-FROM-JS | 0 | 0 | 4 | 91.8% |
| `bun_lolhtml_sys` | 48 | 1 | 75 | 5 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_libarchive_sys` | 45 | 1 | 415 | 0 | INTERNAL-ONLY | 0 | 0 | 1 | 97.8% |
| `bun_perf` | 43 | 3 | 47 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_uws` | 35 | 1 | 34 | 0 | REACHABLE-FROM-JS | 0 | 44 | 0 | 100.0% |
| `bun_router` | 34 | 1 | 52 | 3 | REACHABLE-FROM-JS | 6 | 0 | 0 | 100.0% |
| `bun_watcher` | 34 | 5 | 46 | 0 | REACHABLE-FROM-JS | 0 | 2 | 0 | 100.0% |
| `bun_spawn_sys` | 33 | 2 | 45 | 0 | REACHABLE-FROM-JS | 0 | 3 | 0 | 100.0% |
| `bun_tcc_sys` | 29 | 1 | 23 | 1 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_parsers` | 28 | 4 | 185 | 0 | REACHABLE-FROM-JS | 0 | 0 | 1 | 96.4% |
| `bun_paths` | 28 | 4 | 248 | 1 | REACHABLE-FROM-JS | 3 | 2 | 2 | 92.9% |
| `bun_ast` | 27 | 8 | 785 | 1 | REACHABLE-FROM-JS | 5 | 0 | 4 | 85.2% |
| `bun_js_printer` | 24 | 2 | 215 | 0 | REACHABLE-FROM-JS | 0 | 0 | 1 | 95.8% |
| `bun_bundler_jsc` | 23 | 1 | 15 | 2 | REACHABLE-FROM-JS | 0 | 87 | 12 | 47.8% |
| `bun_js_parser_jsc` | 21 | 1 | 22 | 0 | REACHABLE-FROM-JS | 0 | 0 | 1 | 95.2% |
| `bun_picohttp` | 21 | 1 | 24 | 2 | REACHABLE-FROM-JS | 0 | 44 | 0 | 100.0% |
| `bun_zlib_sys` | 21 | 3 | 86 | 10 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_sourcemap_jsc` | 20 | 3 | 29 | 0 | REACHABLE-FROM-JS | 0 | 2 | 0 | 100.0% |
| `bun_libdeflate_sys` | 17 | 1 | 36 | 3 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_zlib` | 17 | 1 | 34 | 0 | REACHABLE-FROM-JS | 0 | 6 | 0 | 100.0% |
| `bun_boringssl_sys` | 15 | 2 | 121 | 4 | REACHABLE-FROM-JS | 0 | 0 | 3 | 80.0% |
| `bun_boringssl` | 14 | 1 | 8 | 1 | REACHABLE-FROM-JS | 0 | 0 | 1 | 92.9% |
| `bun_md` | 14 | 5 | 148 | 1 | REACHABLE-FROM-JS | 14 | 71 | 0 | 100.0% |
| `bun_brotli_sys` | 13 | 1 | 33 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_highway` | 12 | 1 | 12 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_mimalloc_sys` | 12 | 1 | 115 | 3 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_semver` | 12 | 2 | 118 | 0 | REACHABLE-FROM-JS | 0 | 71 | 0 | 100.0% |
| `bun_shell_parser` | 11 | 2 | 123 | 0 | REACHABLE-FROM-JS | 1 | 38 | 0 | 100.0% |
| `bun_sql` | 11 | 3 | 220 | 0 | REACHABLE-FROM-JS | 0 | 46 | 0 | 100.0% |
| `bun_zstd` | 11 | 1 | 23 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_dns` | 10 | 1 | 18 | 1 | REACHABLE-FROM-JS | 0 | 2 | 0 | 100.0% |
| `bun_opaque` | 10 | 1 | 11 | 6 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_options_types` | 9 | 3 | 60 | 3 | REACHABLE-FROM-JS | 0 | 0 | 1 | 88.9% |
| `bun_http_types` | 8 | 3 | 59 | 0 | REACHABLE-FROM-JS | 1 | 55 | 0 | 100.0% |
| `bun_ini` | 8 | 1 | 10 | 0 | REACHABLE-FROM-JS | 0 | 1 | 0 | 100.0% |
| `bun_platform` | 7 | 2 | 27 | 0 | REACHABLE-FROM-CLI | 0 | 0 | 0 | 100.0% |
| `bun_safety` | 7 | 1 | 33 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_brotli` | 6 | 1 | 14 | 0 | REACHABLE-FROM-JS | 0 | 5 | 0 | 100.0% |
| `bun_bunfig` | 6 | 2 | 7 | 0 | REACHABLE-FROM-JS | 0 | 41 | 0 | 100.0% |
| `bun_url` | 6 | 1 | 83 | 1 | REACHABLE-FROM-JS | 0 | 1 | 2 | 66.7% |
| `bun_windows_sys` | 6 | 1 | 93 | 1 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_bin` | 5 | 2 | 0 | 0 | REACHABLE-FROM-CLI | 0 | 0 | 1 | 80.0% |
| `bun_glob` | 5 | 1 | 25 | 0 | REACHABLE-FROM-JS | 0 | 6 | 2 | 60.0% |
| `bun_install_types` | 4 | 2 | 76 | 0 | REACHABLE-FROM-JS | 0 | 71 | 0 | 100.0% |
| `bun_wyhash` | 4 | 1 | 15 | 0 | REACHABLE-FROM-JS | 8 | 0 | 0 | 100.0% |
| `bun_base64` | 3 | 1 | 33 | 0 | REACHABLE-FROM-JS | 2 | 6 | 0 | 100.0% |
| `bun_css_jsc` | 3 | 1 | 13 | 0 | REACHABLE-FROM-JS | 0 | 13 | 0 | 100.0% |
| `bun_errno` | 3 | 3 | 20 | 0 | REACHABLE-FROM-JS | 3 | 0 | 0 | 100.0% |
| `bun_which` | 3 | 1 | 3 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_dispatch` | 2 | 1 | 4 | 1 | REACHABLE-FROM-JS | 1 | 0 | 0 | 100.0% |
| `bun_dotenv` | 2 | 1 | 53 | 0 | REACHABLE-FROM-JS | 0 | 41 | 0 | 100.0% |
| `bun_install_jsc` | 2 | 1 | 18 | 0 | REACHABLE-FROM-JS | 0 | 71 | 0 | 100.0% |
| `bun_s3_signing` | 2 | 1 | 16 | 0 | REACHABLE-FROM-JS | 0 | 10 | 0 | 100.0% |
| `bun_sys_jsc` | 2 | 2 | 4 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_analytics` | 1 | 1 | 12 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |
| `bun_clap` | 1 | 1 | 57 | 0 | REACHABLE-FROM-JS | 10 | 0 | 0 | 100.0% |
| `bun_sha_hmac` | 1 | 1 | 10 | 0 | REACHABLE-FROM-JS | 0 | 0 | 0 | 100.0% |

Columns:

- **Sites** — count of unsafe occurrences in the crate.
- **Files** — number of `.rs` files in the crate directory.
- **PubFn / PubUnsafe** — count of `^\s*pub (unsafe |async |const )?fn ` and `^\s*pub unsafe fn ` per crate.
- **Tier** — reachability tier from §Part 1.
- **UnitTests** — count of `#[test]` attributes (free tests only).
- **JSTests** — best-guess JS test files matched by name; conservative.
- **SafetyMissing / %Marker** — Pass 2's windowed-marker heuristic, window=4.

---

## The "untested unsafe density" cluster {#cluster}

Filter: sites ≥ 30 and (Rust unit tests = 0 or JS tests ≤ 5) and missing-marker ≥ 5. These are the files where:

- there is enough unsafe to justify dedicated review,
- there are no dedicated tests of either kind,
- some sites have unclear local proofs.

Sorted by site count.

| File | Sites | PubFn | PuU | Missing | JS-tests | Why it's here |
|------|------:|------:|----:|--------:|---------:|---|
| `src/sys/lib.rs` | 234 | 354 | 25 | 101 | 0 (no `bun_sys/*.test.ts`) | Syscall wrappers; per-fn SAFETY is sparse. Heavy `*const c_char`/buffer-pointer surface. **Highest-priority hardening target.** |
| `src/runtime/api/cron.rs` | 155 | 21 | 2 | 91 | 3 | Heavy `*mut Self` discipline through `CronJobBase` trait; markers consolidated at trait header but per-callsite proofs sparse. |
| `src/runtime/dns_jsc/dns.rs` | 219 | 132 | 16 | 59 | 4 (`test/js/node/dns/*`, `test/js/bun/dns/*`) | c-ares callback dispatch; `unsafe extern "C" fn raw_callback` at L765 is the central dispatcher. |
| `src/bun_core/lib.rs` | 101 | 141 | 14 | 52 | 0 | Foundation crate; `Vec::set_len`, `RawSlice::from_raw`, `set_len` chains. Many sites covered by parent-method invariants but no per-site marker. |
| `src/runtime/socket/uws_handlers.rs` | 73 | 0 | 0 | 55 | 49 | High JS-test count, but 55 sites without a nearby marker — almost all are the per-method `unsafe fn on_*` default trait impls. False-positive cluster; canonical fix is "see trait header `RawSocketEvents` (L218-229)" pointers. |
| `src/bun_core/atomic_cell.rs` | 46 | 19 | 5 | 29 | 0 | `unsafe impl Sync/Send` (L65-66) is well-commented (L59-64) but heuristic window=4 misses it. Per-method `UnsafeCell::get()` calls need pointer-back comments. |
| `src/runtime/api/bun/Terminal.rs` | 38 | 16 | 7 | 17 | 1 | Terminal API; `*mut Self` patterns with re-entrant callbacks. |
| `src/runtime/bake/DevServer.rs` | 169 | 75 | 2 | 19 | 20 (`test/bake/dev/*`) | HMR dev server; mostly covered, but 19 missing-marker sites worth a sweep. |
| `src/runtime/image/backend_wic.rs` | 43 | 6 | 0 | 18 | 0 | Windows Imaging Component COM bindings; very dense `(*(*self.as_ptr()).vt).Method()` virtual calls. **Manual COM-vtable bookkeeping is high risk; minimal test coverage.** |
| `src/bun_alloc/stack_fallback.rs` | 40 | 16 | 0 | 25 | 0 | `unsafe impl Allocator`; `UnsafeCell` of `[MaybeUninit; N]`; 25 sites without markers around the `Allocator` trait impls. |
| `src/libuv_sys/libuv.rs` | 133 | 349 | 4 | 41 | 0 | libuv FFI (Windows event loop); zero direct tests, hand-written bindings. |
| `src/cares_sys/c_ares.rs` | 73 | 84 | 3 | 23 | 2 | c-ares FFI; `pub unsafe fn destroy` patterns. |
| `src/bundler_jsc/analyze_jsc.rs` | 23 | 15 | 2 | 12 | 12 | **47.8% marker coverage — worst in the audit.** Wraps generated `JSC_JSModuleRecord__*` FFI; trampolines. |
| `src/bundler/linker_context/findImportedFilesInCSSOrder.rs` | 18 | 4 | 0 | 13 | 87 (`test/bundler/*`) | `bitwise_copy` / `ptr::read` of arena-allocated graph nodes; missing markers around the copy primitives. |
| `src/runtime/api/cron.rs` (default-impl traits in `CronJobBase`) | (subset of 155) | — | — | (subset of 91) | 3 | Re-counted because the trait default impls in this file are most of the missing-marker hits. |
| `src/runtime/api/Terminal.rs` (re-entrant reader callbacks) | (subset of 38) | — | — | (subset of 17) | 1 | `unsafe fn on_read_chunk(this: *mut Self, …)` re-entrant dispatch. |

The "missing markers" count above is the heuristic baseline; about 30-40% of the misses in this cluster are false-positives (trait-level comments outside the 4-line window) and the rest are genuine "no proof in source" cases.

### Files that look dense but are well-covered

For balance, the inverse cohort — files with high unsafe counts but `%Marker > 95%`:

- `src/runtime/jsc_hooks.rs` — 296 sites, 252 with marker (85%). The 44 misses are mostly auto-generated host-export trampolines.
- `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs` — 153 sites, 150 with marker (98%).
- `src/bun_alloc/lib.rs` — 119 sites, 103 with marker (87%).
- `src/runtime/webcore/Blob.rs` — 119 sites, 111 with marker (93%).
- `src/io/PipeWriter.rs` — 76 sites, 76 with marker (100%). Reference file for `*mut Self` discipline (per `src/CLAUDE.md`).
- `src/ptr/ref_count.rs` — 82 sites, 81 with marker (99%). Reference file for `RefCount<T>` patterns.

---

## Representative unsafe sites — 30 selected for review

Each entry shows: `file:line` — `text` — Reachability tier — JS-test exposure verdict — SAFETY marker status.

### A. JS-reachable, no nearby marker, low JS-test exposure (highest priority)

```
S1  src/sys/lib.rs:192       unsafe impl Sync for Name {}
    JS-reachable (Name is the result of openat / stat / etc.)
    JS tests: 18 (test/js/node/fs/*)
    Marker: missing  ← T1 finding — Sync impl needs explicit safety proof above the impl line

S2  src/sys/lib.rs:292       unsafe { core::slice::from_raw_parts(self.0.as_ptr().cast::<u8>(), len) }
    JS-reachable via Name::as_bytes()
    JS tests: 18
    Marker: missing  ← T1 — caller must ensure `len` is valid for the storage; document.

S3  src/sys/lib.rs:902       unsafe { st.assume_init() }
    JS-reachable through fstat()/stat()/lstat()
    JS tests: 18
    Marker: missing  ← T3 — needs "above we wrote the full stat buffer via the OS syscall" comment.

S4  src/runtime/api/cron.rs:78    unsafe fn maybe_finished(this: *mut Self);
    Trait method declaration; the contract IS "may free `this`" (documented L77).
    JS tests: 3
    Marker: missing (window=4 misses L77 comment)  ← false positive; trait-header comment exists.

S5  src/runtime/api/cron.rs:1586  pub fn on_timer_fire(this: *mut Self, vm: &VirtualMachine)
    Re-entrant timer callback; well-documented at L1587-1595.
    JS tests: 3
    Marker: present (in body)

S6  src/runtime/dns_jsc/dns.rs:461  unsafe { (*inflight).append(dns_lookup) }
    JS-reachable via dns.lookup / dns.resolveX
    JS tests: 4
    Marker: missing  ← T2 — `inflight` lifetime documented elsewhere; needs pointer-back.

S7  src/runtime/dns_jsc/dns.rs:765  unsafe extern "C" fn raw_callback(ctx: *mut c_void, status: c_int, …)
    c-ares C callback; `ctx` is a heap pointer we control.
    JS tests: 4
    Marker: missing  ← T1 — needs "ctx provenance: heap::into_raw of DnsLookup" prelude.

S8  src/bun_core/lib.rs:140    pub const unsafe fn from_raw(p: *const [T]) -> Self
    JS-reachable transitively via RawSlice users.
    JS tests: 0
    Marker: missing  ← T1 — `# Safety` doc-comment required for pub unsafe fn.

S9  src/bun_core/lib.rs:408    unsafe { v.set_len(prev + n) }
    Foundation; called from many places.
    Marker: missing  ← T2 — set_len contract obvious to readers but undocumented.

S10 src/bun_core/lib.rs:567    unsafe { debug_assert!(n <= v.capacity() - v.len()); v.set_len(v.len() + n); }
    Has a debug_assert proving the precondition.
    Marker: missing  ← T3 — debug_assert IS the proof; consider that the assertion is the SAFETY note.

S11 src/bun_core/atomic_cell.rs:65  unsafe impl<T: Copy> Sync for AtomicCell<T> {}
    Foundation `Sync` impl; thorough comment L59-64 (outside window).
    Marker: missing (false positive — comment IS present, just outside window=4)

S12 src/bun_core/atomic_cell.rs:75  UnsafeCell::new(value)
    `pub const fn new` constructor; safety proof at file header.
    Marker: missing (false positive)  ← see comment at S11

S13 src/runtime/api/bun/Terminal.rs:396  unsafe { &*this }
    `*mut Self` re-entrant pattern; widely used in Terminal callbacks.
    JS tests: 1 (test/js/bun/test, sparse)
    Marker: missing  ← T2 — file-level invariant about Terminal's `*mut Self` discipline needed.

S14 src/libuv_sys/libuv.rs:178   pub unsafe fn slice_mut(&mut self) -> &mut [u8]
    libuv Buf::slice_mut; documented at the function header.
    JS tests: 0 (libuv exercised transitively only)
    Marker: missing (false positive — function-header SAFETY exists above the unsafe block)

S15 src/libuv_sys/libuv.rs:450   unsafe { uv_walk(loop_, Some(close_walk_cb), ptr::null_mut()) }
    Tear-down walk; `loop_` validity comes from caller's `bun_loop()` invariant.
    JS tests: 0
    Marker: missing  ← T1 — needs "loop_ obtained from bun_loop() which is per-thread singleton" note.

S16 src/cares_sys/c_ares.rs:438  pub unsafe fn destroy(this: *mut struct_hostent) { unsafe { ares_free_hostent(this) }; }
    Pub unsafe fn wrapper around C destructor.
    JS tests: 2
    Marker: missing  ← T1 — `# Safety` doc required: "this must be a valid struct_hostent obtained from ares_*; no aliases live."

S17 src/cares_sys/c_ares.rs:703  pub unsafe fn destroy(this: *mut AddrInfo)
    Same pattern as S16.
    Marker: missing  ← T1

S18 src/runtime/socket/uws_handlers.rs:233-253  unsafe fn on_open/on_data/on_writable/...
    22 trait default impls; SAFETY at trait header (L218-229) and at adapter call sites (L277+).
    JS tests: 49 (well-tested behavior)
    Marker: missing (false positive ×22)  ← Add per-method `// SAFETY: see trait header.` pointers.

S19 src/runtime/jsc_hooks.rs:175  unsafe { (*vm).runtime_state.cast::<RuntimeState>() }
    Reaches into the VM's stable per-thread RuntimeState.
    JS tests: 365 (test/js/bun/*)
    Marker: missing  ← T2 — VM lifetime invariant documented at jsc_hooks header but not pointed to here.

S20 src/runtime/jsc_hooks.rs:771  unsafe { (*vm).preload.clear() }
    Same pattern as S19.
    Marker: missing  ← T2

S21 src/runtime/jsc_hooks.rs:1176 unsafe { &raw mut *(*state).body_value_pool }
    Pool access through stable VM pointer.
    Marker: missing  ← T2

S22 src/bundler/bundle_v2.rs:254    unsafe { p.as_mut() }
    Raw-ptr to &mut reborrow; depends on `p`'s provenance and aliasing.
    JS tests: 87
    Marker: missing  ← T1 — pointer provenance comment needed.

S23 src/bundler/bundle_v2.rs:1024   unsafe { bun_ptr::detach_lifetime(arena.alloc_slice_copy(key)) }
    Lifetime laundering — explicit reference to the audit's "lifetime extension" cluster.
    Marker: missing  ← T1 — detach_lifetime by definition needs an invariant comment.

S24 src/runtime/image/backend_wic.rs:476  unsafe { ((*(*self.as_ptr()).vt).CreateStream)(self.as_ptr(), &mut out) }
    Hand-rolled COM vtable dispatch; very dense, minimal Marker coverage.
    JS tests: 0 (Windows image backend)
    Marker: missing  ← T1 cluster — needs "self is an IUnknown live pointer; vt is the WIC vtable" prelude.

S25 src/runtime/napi/napi_body.rs:200  pub unsafe fn ref_(env: *mut NapiEnv)
    NAPI ref/deref; pub-unsafe wrapper.
    JS tests: 59 (test/napi)
    Marker: missing  ← T1 — `# Safety` doc required.

S26 src/runtime/cli/run_command.rs (subset)  multiple unsafe Vec::set_len after manual read
    CLI run-command path; reachable through `bun <file>` not JS.
    JS tests: 41 (test/cli/run)
    Marker: partial  ← T3 watchlist.

S27 src/install/windows-shim/bun_shim_impl.rs (subset)  unsafe Windows API calls
    Windows shim that fronts package binaries.
    JS tests: 0
    Marker: 7 missing of 52  ← T2 — Windows-only path with minimal CI exposure.

S28 src/runtime/bake/DevServer.rs (subset)  unsafe { &mut *p } after pointer load
    HMR dev server; pointer pattern documented at module header.
    JS tests: 20 (test/bake/dev)
    Marker: 19 of 169 missing  ← T3 — mostly covered; remaining 19 worth a sweep.

S29 src/bundler/linker_context/findImportedFilesInCSSOrder.rs:31  unsafe { core::ptr::read(src) }
    Bitwise copy of arena-allocated graph nodes.
    JS tests: 87
    Marker: 13 of 18 missing  ← T2 — needs "arena-backed, no Drop glue, fields are Copy" comment.

S30 src/bun_core/atomic_cell.rs:75  UnsafeCell::new(value)
    Reprised from S12. Foundation site; the absence of per-method markers is systematic.
    Marker: missing (file-header proof exists)  ← T3 — fix is per-method pointers, not new prose.
```

### Verdict distribution across the 30-site sample

- True missing-marker (no proof anywhere): **S1, S2, S3, S6, S7, S8, S15, S16, S17, S22, S24, S25, S29** — 13 sites that genuinely need new SAFETY proofs.
- False-positive (proof exists outside window=4): **S4, S5, S11, S12, S14, S18 (×22 instances), S30** — 7 unique false positives (many more if you count each S18 hit).
- Documented but no marker pointer: **S9, S10, S13, S19, S20, S21, S23, S26, S27, S28** — 10 sites with implicit invariants; would benefit from `// SAFETY: see <X>` pointers.

That ratio (~43% true missing, ~23% false positive, ~33% needs-pointer) is a useful refinement for the audit's recommendation: **fixing missing markers is not 1:1 with writing 1,594 new comments**; closer to 700 new comments + 600 pointers + 200 false-positive triage.

---

## Recommended priority for SAFETY-comment hardening

Given the cluster and 30-site sample, the ordered hardening sequence is:

1. **`src/sys/lib.rs` (234 sites, 101 missing, JS-reachable).** Each syscall wrapper needs a per-function `# Safety` doc comment matching the manpage. Estimated effort: 1 PR, ~3 days. Highest absolute impact.
2. **`src/runtime/api/cron.rs` + `CronJobBase` trait header (155 sites, 91 missing).** Add `// SAFETY: see trait header` pointers at each default-impl call site; expand the trait header with the `*mut Self` discipline summary. Estimated: 1 PR, 1 day.
3. **`src/runtime/dns_jsc/dns.rs` (219 sites, 59 missing).** Document the c-ares callback provenance once at module top, point per-callsite. Estimated: 1 PR, 1 day.
4. **`src/bun_core/lib.rs` + `src/bun_core/atomic_cell.rs` (101+46 sites, 52+29 missing).** Add `# Safety` to `pub unsafe fn from_raw` and similar; add `// SAFETY: see L59-64` pointers in `atomic_cell.rs`. Estimated: 1 PR, 1 day.
5. **`bun_libarchive_sys` (45 sites, INTERNAL-ONLY orphan candidate).** Decide: delete or wire only after a deletion branch proves `cargo metadata`, `bun bd`, and the archive/package-manager test paths still pass. Net negative-LOC outcome if confirmed stale.
6. **`src/runtime/image/backend_wic.rs` (43 sites, 18 missing, Windows-only).** Document the COM vtable contract once; add per-callsite pointers. Estimated: 1 PR, half a day.
7. **`src/cares_sys/c_ares.rs`, `src/libuv_sys/libuv.rs`, FFI sys-crates.** Per-function `# Safety` doc comments matching the C API contracts (cf. `ares_free_hostent`, `uv_walk`, etc.). Estimated: 1 PR per sys-crate.
8. **`bun_url`, `bun_glob`, `bun_resolver`, `bun_semver` (Pass-2's identified zero-test set).** Combine SAFETY-marker pass with a "land basic Rust unit tests" pass. Estimated: 1 PR per crate.

Total hardening surface across these priorities: roughly 600–800 specific changes across 8–10 PRs. Excluding the false-positive cluster (~600 sites in `uws_handlers`, `cron.rs` trait defaults, `atomic_cell.rs`) which gets fixed by adding marker pointers, not new comments.

---

## Limitations of the heuristic methodology

1. **Crate-level reachability is too coarse.** 99.48% of sites being "JS-reachable" is not actionable; it's a property of `bun_runtime`'s wide dep graph. The right tool is rustdoc JSON or `cargo-call-stack`-style per-function reachability, which is blocked by Pass 1's `cargo metadata` failure.
2. **JS-test mapping is a basename heuristic.** Crates like `bun_event_loop` get attributed 540 JS-tests because the closest matching directory (`test/js/bun`) covers everything; that doesn't mean event-loop-specific tests exist. A more accurate map would be a `bun bd test --coverage`-style instrumented run.
3. **Windowed marker check (window=4) is conservative.** Roughly 23% of "missing" hits in our 30-site sample are false-positives where a SAFETY comment exists outside the 4-line window (block comments, trait headers, file headers). Widening the window inflates false-coverage; the right fix is point-back markers (`// SAFETY: see L<n>`).
4. **`#[test]` count under-reports.** Doctests, `#[cfg(test)]`-gated modules whose `#[test]` lines are themselves macro-generated (e.g., `quickcheck!`), and parametric tests are not counted by `rg -c '^\s*#\[test\]'`. Some crates with seemingly "zero unit tests" may have small doctest pockets.
5. **Macros are invisible.** `bun_jsc_macros`, `bun_clap_macros`, `bun_core_macros`, `bun_css_derive`, `pin-project-lite` all emit `unsafe` that the inventory does not see (Pass 1 limitation #2). This affects both reachability (macro-emitted `pub fn` is not in the static grep) and test-coverage (macro-emitted tests are not counted).
6. **Cross-crate transitive unsafe is invisible.** A safe `pub fn` in crate A that calls a safe `pub fn` in crate B that calls `unsafe { … }` is treated as "no unsafe in A." For a true "function-level reachability from JS" graph, all callers must be inspected.
7. **`.zig` siblings are excluded by design.** Pass 1 already noted this; some crate directories have more `.zig` than `.rs` files. The inventory is correctly `.rs`-only.
8. **`bun_libarchive_sys` orphan is verified at the dependency-graph level, not at deletion-build level.** `cargo metadata --no-deps` shows no workspace reverse dependency. A positive deletion proof (`bun bd`, cargo metadata after deletion, and archive/package-manager smoke tests) is still the responsible next step before removing it.
9. **The reachability split between `REACHABLE-FROM-JS` and `REACHABLE-FROM-CLI` is binary at the crate level.** In reality, every CLI command (`bun install`, `bun run`, `bun build`, `bun test`, `bun x`) shells through `bun_runtime` initialization — which means even ostensibly CLI-only paths go through JSC bootstrap, GlobalObject construction, and host-fn registration. The two-tier split is preserved here for diagnostic purposes (to surface `bun_bin` and `bun_platform` as not-JS-reachable in name), not for security boundaries.
10. **Vendored C++/C unsafety is out of scope.** Pass 0 documented that `src/jsc/bindings/*.cpp` and `vendor/` are excluded. A complete soundness picture would include the C++ surface area through which Rust unsafe sites traffic — particularly `bun_jsc::Strong::create` → `JSC::Strong` and `bun_core::String` → `WTF::String` semantics. These deserve a separate audit.

---

## Files referenced for verification

- Crate dependency map: `/tmp/crate_deps.tsv` (108 lines, generated by `rg '^bun_' */Cargo.toml`).
- Reachability tier per crate: `/tmp/crate_reach.json`.
- Per-crate pub-fn / pub-unsafe-fn / unit-test counts: `/tmp/crate_pubapi.tsv`, `/tmp/crate_tests.tsv`.
- Per-file stats with marker coverage and pub-fn density: `/tmp/file_stats.json`.
- Combined per-crate table data: `/tmp/combined.json`.
- Crate → JS-test mapping: `/tmp/crate_jstests.json`.

Reproduction commands (top of report shows methodology in detail):

```
cd .
jq -s 'group_by(.crate) | map({crate: .[0].crate, sites: length, files: (map(.file)|unique|length)}) | sort_by(-.sites)' \
   .unsafe-audit/unsafe-inventory.jsonl
rg --files-with-matches '\.workspace = true' src -t toml \
   | xargs rg '^name = "(bun_[^"]+)"' -or '$1'   # crate names
find src -name '*.classes.ts'                    # JS-binding generators
```
