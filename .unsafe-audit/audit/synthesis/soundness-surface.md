# Phase 3 — Soundness Surface

This document maps which `unsafe` is reachable from Bun's public API surface — i.e., what an unprivileged caller (JavaScript code, package.json, command-line args) can reach through which unsafe paths.

Because Phase 1's `cargo +nightly rustdoc --output-format json` failed (vendor deps unavailable; see Phase 1 limitations), this surface map uses a coarse heuristic — per-crate `pub`-item enumeration plus the structural understanding of Bun's architecture from `src/CLAUDE.md`. A subsequent audit pass should regenerate this from a working rustdoc JSON.

## Soundness-surface tiers

### Tier 0 — JavaScript-reachable (every Bun user's surface)

These are unsafe paths reachable from arbitrary JS code running under `bun`:

- **`Bun.serve`** — HTTP/HTTPS/HTTP3 server. Reach: every `uws_*` callback path (`bun_uws_sys` 253 sites), every HTTP3/QUIC path (lsquic via `bun_http_jsc` 287 sites), every TLS termination path (`bun_boringssl` 146 sites). A malicious request can trigger the receive-side state machines; soundness here matters end-to-end.
- **`fetch()`** — Outbound HTTP client. Reach: `bun_http` (170 sites), DNS via `bun_cares_sys` (62 sites), TLS via `bun_boringssl`.
- **`Bun.file()` / `Bun.write()`** — File I/O. Reach: `bun_sys` (332 sites), `bun_io` (213 sites).
- **`Bun.spawn`** — Child process. Reach: `bun_spawn` (105 sites), `bun_spawn_sys`.
- **`new Response(stream)` / `ReadableStream`** — Streams. Reach: `bun_io` `PipeWriter`/`PipeReader` (the canonical reentrant-callback test bed).
- **`Bun.sql`** — SQL drivers. Reach: `bun_sql` (90 sites in `bun_sql_jsc` alone).
- **`bun:sqlite`** — SQLite FFI. Reach: SQLite bindings (not directly accounted by our enumeration since SQLite is C in `vendor/`).
- **`bun:ffi`** — User-supplied FFI. Reach: `bun_tcc_sys`, the TinyCC JIT, plus arbitrary user `extern "C"`. **This surface lets the user write arbitrary unsafe code IN A SAFE-LOOKING API.** It's an inherent trade-off of the feature.
- **`HTMLRewriter`** — Reach: `bun_lolhtml_sys` (41 sites).
- **`Bun.serve` WebSocket** — Reach: `bun_uws_sys` again, plus `bun_websocket_client` (deflate).
- **JS runtime APIs in general** — Reach: ALL of `bun_jsc` (745 sites) for every JS↔native boundary.

### Tier 1 — Build-tool-reachable (every `bun build` / `bun install` user)

- **`bun install`** — Package manager. Reach: `bun_install` (525 sites), `bun_libarchive_sys` (83 sites for tarballs), DNS, HTTP.
- **`bun build` / `Bun.build`** — Bundler. Reach: `bun_bundler` (498 sites), `bun_js_parser`, `bun_css`, `bun_resolver` (182 sites), `bun_transpiler`.

### Tier 2 — Internal (reachable only through Bun itself, not JS)

- Allocator: `bun_alloc` (273 sites), `bun_mimalloc_sys` (84 sites).
- Threading: `bun_threading` (126 sites), `bun_event_loop` (73 sites).
- Misc utilities.

## High-leverage soundness questions

### Question 1 — Can untrusted HTTP input reach a UB-producing `unsafe` site?

The HTTP receive path is `bun_uws_sys` → `bun_http_jsc::request_handler` → ... → user JS code. The receive-side state machines (HTTP/1.1 header parser via `picohttpparser`, HTTP/2 frame decoder via `lshpack`, HTTP/3 via `lsquic` + `lsqpack`) live in C in `vendor/`. **Their soundness is not in scope for this audit**, but our Rust wrappers (`bun_picohttp` 67 sites, `bun_http_jsc` 287 sites) ARE.

The pattern to verify per cluster:
- Are header lengths validated before being passed to `slice::from_raw_parts(ptr, len)`?
- Are content lengths bounded before being used to size buffers?
- Can a malformed request cause us to dereference a uws callback's `userdata` pointer after `us_socket_close` has run?

**Phase 5 plans for `bun_uws_sys` and `bun_http_jsc` will include audit checklists per callback signature** to verify the proof obligation for each.

### Question 2 — Can untrusted JS code free a Strong handle from the wrong thread?

Per Invariant I-002 (`bun_jsc::Strong` thread affinity), the answer should be no — `Strong` is `!Send`. But there are places where the handle is "moved" via `*mut Self` cross-thread (the worker pool, FetchTasklet). The audit looks for sites where a `Strong` field's lifetime crosses into a worker thread without a documented hand-off mechanism.

This is the kind of bug that ONLY appears under load. Static analysis alone won't catch it; the audit's contribution is **identifying the candidate sites** and proposing instrumentation (e.g., a debug-build runtime check on `Strong::drop` that asserts thread identity matches the constructor).

### Question 3 — Does the AST arena ever drop a `Drop`-bearing value?

Per Invariant I-005, this is forbidden. Phase 2 (per-site) will enumerate all types allocated in `bun_alloc::MimallocArena` and verify their `Drop` is trivial OR they're freed before the arena resets.

### Question 4 — Can `bun:ffi` users bypass the unsafe-audit conclusions?

By design, `bun:ffi` lets users write arbitrary unsafe code from JavaScript. The audit cannot bound user-supplied unsafe. The audit can, however, harden the `bun:ffi` boundary itself — verifying that the TinyCC JIT compiler invocation (`bun_tcc_sys`) doesn't UB on adversarial user input, and that the dispatch table for `bun:ffi`-registered callbacks doesn't carry stale function pointers.

### Question 5 — Are there `pub unsafe fn`s reachable from `pub fn` callers within a crate?

Every such site is a soundness-surface marker — the safe API is asserting the invariant for its caller. Phase 2 enumeration per `pub unsafe fn` site will verify:

- A SAFETY comment naming the caller-side proof obligation
- A test that the safe wrapper enforces the obligation
- A clippy lint (if expressible) that catches future regressions

## Reachability heuristic outputs

A rough count of `pub unsafe fn` per crate (preliminary; the precise list will be generated in Phase 5):

| Crate | `pub unsafe fn` count (rough) |
|-------|------------------------------:|
| `bun_runtime` | ~200 |
| `bun_jsc` | ~85 |
| `bun_core` | ~40 |
| `bun_sys` | ~30 |
| `bun_alloc` | ~25 |
| `bun_io` | ~25 |
| `bun_install` | ~22 |
| `bun_bundler` | ~20 |
| `bun_ptr` | ~15 |
| `bun_collections` | ~10 |

Total `pub unsafe fn` across the workspace is ~500-600 (subset of the 903 `unsafe fn` total). **Each of these is a soundness-surface marker** and gets a hardened SAFETY comment as the Phase 5 minimum deliverable.

## Sites whose soundness depends on external C code

These are deliberately NOT in scope for refactoring (we can't touch the C side), but they're in scope for **wrapper hardening**:

- **mimalloc** — heap allocator. Bun trusts mimalloc's `mi_malloc`/`mi_free` to be sound for arbitrary `mi_heap_t*`. The wrappers in `bun_alloc::MimallocArena` etc. are then sound as long as the heap pointer is mimalloc-owned. (A) at the FFI boundary.
- **WebKit/JSC** — JS engine. Bun trusts JSC's GC + handle table + WTFStringImpl refcounting. Verified by JSC's own tests upstream.
- **BoringSSL** — TLS / crypto. Bun trusts BoringSSL for SSL_*, EVP_*, RSA_*, EC_*.
- **libuv** — Windows event loop (POSIX uses raw kqueue/epoll). Bun trusts libuv for callback dispatch.
- **lsquic / lshpack / lsqpack** — HTTP/3 stack.
- **picohttpparser** — HTTP/1.1 parser. Bun trusts it on adversarial input.
- **libarchive** — tar/zip parsers. Bun trusts it on adversarial input.
- **lol-html** — HTML rewriter. Bun trusts it on adversarial input.
- **TinyCC** — JIT compiler for `bun:ffi`. Bun trusts the C compiler on user-supplied source.
- **c-ares** — async DNS.
- **zlib-ng / brotli / zstd** — compression.

Each of these is documented in the dep-soundness section of the AUDIT_SUMMARY as "trusted external; soundness inherited from upstream."

## What this audit can and can't claim

**Can claim:**
- Per-site classification of every Bun-authored `unsafe` site in the inventory
- Hardened SAFETY comments for the (A) sites
- (C) refactor plans for the sites that don't need to be unsafe
- (B) `safe-only` feature for the perf-only sites with measured deltas

**Can't claim (without a follow-up audit pass):**
- Macro-expanded unsafe coverage — `cargo expand` didn't run; derive-emitted unsafe is invisible
- Precise call-graph reachability — `cargo +nightly rustdoc --output-format json` didn't run
- Soundness of C-side parsers under adversarial input — out of scope
- That miri runs clean end-to-end — Bun's test surface is too large for miri's isolation model; per-module miri runs will be designed in Phase 9
