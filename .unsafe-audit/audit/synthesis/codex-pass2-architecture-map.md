# Codex pass 2 architecture map

This document records the architecture understanding used for the second unsafe-code audit pass. It is intentionally Rust-focused; vendored C/C++ and JavaScriptCore C++ bindings are relevant only at FFI boundaries.

## Source-of-truth documents read

- Root `CLAUDE.md` / AGENTS instructions: build, test, safety, and contribution rules for this repository.
- Root `README.md`: product surface and high-level purpose.
- `src/CLAUDE.md`: Rust workspace structure and the most important porting invariants.
- `src/jsc/bindings/v8/AGENTS.md`: V8 compatibility layer constraints and handle-scope discipline.
- Existing `.unsafe-audit` artifacts from the Claude Code pass.

## Workspace shape

The Rust side is a Cargo workspace with **108 workspace members**. The final binary is built through `src/bun_bin`, which produces `libbun_rust.a`; Bun's build system links that into the complete executable with JavaScriptCore and vendored native libraries.

Important dependency tiers:

| Tier | Crates | Unsafe role |
| --- | --- | --- |
| Foundation | `bun_core`, `bun_alloc`, `bun_sys`, `bun_ptr`, `bun_threading`, `bun_collections`, `bun_paths` | Allocation, syscalls, pointer wrappers, intrusive collections, thread primitives. Unsafe here is high leverage. |
| Language tooling | `bun_ast`, `bun_js_parser`, `bun_js_printer`, `bun_resolver`, `bun_transpiler`, `bun_bundler`, `bun_css` | Arena-backed AST, parser/printer hot paths, bundler parallelism, generated enums. |
| Runtime/JSC bridge | `bun_jsc`, `bun_runtime`, `bun_event_loop`, `bun_io`, `bun_http`, `bun_http_jsc`, `bun_*_jsc` | JS-visible APIs, JSC handle lifetimes, event-loop callbacks, thread-affine handles. |
| Package/tooling | `bun_install`, `bun_semver`, `bun_glob`, `bun_patch`, `bun_standalone_graph` | Package manager, lockfile parsing, semver and filesystem-heavy code. |
| FFI shim crates | `bun_uws_sys`, `bun_libuv_sys`, `bun_boringssl_sys`, `bun_cares_sys`, `bun_mimalloc_sys`, `bun_libarchive_sys`, `bun_lolhtml_sys`, `bun_zlib_sys`, `bun_picohttp_sys` | Thin wrappers around vendored/native libraries. Unsafe is mostly structural. |

By local dependency count, the major aggregators are `bun_runtime` (78 workspace dependencies), `bun_install` (41), `bun_jsc` (39), and `bun_bundler` (33). That matches the unsafe inventory: `bun_runtime`, `bun_jsc`, `bun_install`, and `bun_bundler` dominate the reachable surface.

## Unsafe inventory shape

From `unsafe-inventory.jsonl`:

| Kind | Sites |
| --- | ---: |
| `unsafe_block` | 9,754 |
| `unsafe_fn` | 903 |
| `unsafe_impl` | 345 |
| `unsafe_cell_decl` | 22 |
| `unsafe_trait` | 20 |
| **Total** | **11,044** |

Top crates by unsafe sites:

| Crate | Sites | Interpretation |
| --- | ---: | --- |
| `bun_runtime` | 4,893 | Public JS API surface, Web APIs, Node compatibility, JSC callbacks. |
| `bun_jsc` | 745 | JSC value/object handles, generated conversions, VM lifecycle. |
| `bun_install` | 525 | Package manager and lockfile hot paths. |
| `bun_bundler` | 498 | Parallel bundling, parser/printer integration, chunk graph. |
| `bun_core` | 461 | Shared pointer/string/allocator/system helpers. |
| `bun_sys` | 332 | OS abstraction and syscall wrappers. |
| `bun_http_jsc` | 287 | HTTP/JSC crossing. |
| `bun_alloc` | 273 | Mimalloc and arena allocation. |
| `bun_uws_sys` | 253 | uWebSockets FFI. |
| `bun_io` | 213 | Event loops, wakers, IO dispatch. |

Top semantic categories:

| Category | Sites | Notes |
| --- | ---: | --- |
| `other` | 3,533 | Needs better pass-3 taxonomy; too broad for final polish. |
| `ptr_cast` | 2,231 | Porting/reference erasure, FFI, raw field projection. |
| `fd_syscall` | 1,292 | OS/event-loop/syscall and task lifecycle. |
| `ptr_intrinsic` | 956 | `addr_of!`, raw projections, pointer reads/writes. |
| `zig_port_mut_ref` | 923 | Zig `*Self` callbacks translated to raw pointer then reborrow. |
| `raw_ptr_lifecycle` | 537 | raw ownership handoff, slices, Box/heap round trips. |
| `zig_port_shared_ref` | 448 | raw pointer to shared borrow after proving no mutation/free path. |
| `libc_ffi` | 345 | C ABI calls. |
| `raw_method_call` | 308 | calls through raw receivers. |
| `ptr_arith` | 302 | parser/allocator/syscall pointer arithmetic. |

## Architectural invariants that drive classification

### 1. FFI callback receiver discipline

Bun repeatedly receives `*mut Self` through C/JSC/libuv callbacks. `src/CLAUDE.md` makes this load-bearing: when the callback body may free or re-enter through `self`, the boundary must stay as a raw pointer until the body proves the borrow is safe.

This is why bulk-rewriting `unsafe { &mut *this }` would be wrong. The audit must ask whether the callback can free/re-enter, not merely whether the syntax is ugly.

### 2. Arena-backed AST values

`bun_ast` and the parser/printer stack rely on bump arenas and raw references into stable arena memory. The important edge case from the root instructions applies here: arena reset does not run `Drop`, so any arena-owned type with heap allocations/refcounts must be explicitly cleaned up first.

`StoreRef<T>` / `StoreSlice<T>` live in this zone. That is why the `StoreSlice<T>` Send/Sync bug is high-signal: it violates a local invariant stated correctly by the adjacent `StoreRef<T>` implementation.

### 3. JavaScriptCore handle affinity

`bun_jsc` and `bun_runtime` wrap JSC values and VM state. Handles like `Strong`, `Weak`, `JSValue`, and `VirtualMachine` are intentionally thread-affine even when raw pointer wrappers are `Send`/`Sync` for scheduling. A correct audit distinguishes "type-level Send used as task token" from "JS object may be dereferenced on any thread."

### 4. FFI shim crates are mostly structural unsafe

The `*_sys` crates contain a large number of `unsafe` declarations/calls because Rust cannot make C ABI preconditions safe. The highest-value work there is usually:

- Make raw C integer returns safe at the wrapper boundary.
- Keep extern declarations returning `c_int` instead of Rust enums.
- Harden `SAFETY` comments to name ownership, lifetime, nullability, and thread constraints.

### 5. Perf-only unsafe must be proven, not assumed

`unreachable_unchecked`, `get_unchecked`, and raw slice construction in hot parser/printer paths may belong in (B), but the skill requires measured deltas. Without artifacted benchmarks, those are (B-candidate), not final (B).

## Audit implications

This architecture supports the first pass's broad conclusion: the correct unit is not "remove unsafe everywhere." The correct unit is "make every unsafe site pay rent":

- FFI and JSC sites pay rent by naming precise preconditions.
- Parser/printer hot paths pay rent by measured performance wins.
- Wrapper/raw-pointer sites pay rent only if they preserve provenance or ownership better than safe alternatives.
- Anything that can be expressed as a safe constructor, checked enum conversion, or compile-time trait assertion should be refactored.

