# Draft Security Policy Proposal

> **Audit artifact, not adopted project policy.** This is a redacted,
> publication-safe SECURITY.md proposal produced by the unsafe-code audit. It
> deliberately avoids listing unfixed findings, but it has **not** been adopted
> by Bun maintainers and must not be treated as Bun's official vulnerability
> disclosure policy until maintainers review and install it.

This document proposes how Bun could describe security vulnerability reporting,
Rust soundness commitments, and what is in and out of contract for security
purposes.

Bun is a JavaScript runtime, bundler, test runner, and package manager. The runtime is implemented primarily in Rust (with C++ bindings to JavaScriptCore for JavaScript execution); the safety properties documented here apply to the Rust portion of the codebase and to its FFI boundaries with vendored C/C++ dependencies.

---

## Reporting a vulnerability

If you believe you have found a security vulnerability in Bun, use Bun's
currently published security reporting channel. A recommended policy for
maintainers to adopt is:

1. **GitHub Security Advisory** — Preferred. Use the [Report a vulnerability](https://github.com/oven-sh/bun/security/advisories/new) button on the repository's Security tab. This creates a private advisory thread visible only to maintainers.
2. **Email** — use the address published by the Bun project, if any.
3. **Acknowledgement target** — maintainers should publish an expected response
   window for critical reports; this audit artifact does not set one.

When reporting, please include:

- **A reproducer.** Minimal Rust or JavaScript code that triggers the issue, or a malformed input file (lockfile, archive, HTTP payload) that exposes it.
- **For soundness findings:** the `cargo +nightly miri` output, the Stacked Borrows / Tree Borrows diagnostic, or the specific Rust safety obligation you believe is violated.
- **The Bun version** (`bun --revision`) and OS / arch.
- **Whether the issue is exploitable from untrusted input** (a public package, a malicious HTTP request, a crafted file dropped into a project directory, etc.) or only from already-trusted code paths.

### What maintainers should ask in return

- **Coordinated disclosure.** Contact maintainers before public disclosure so
  they can validate the report, prepare fixes, and coordinate credit in a
  security advisory.
- **No exploitation against production deployments.** Test in your own environment.

---

## Proposed soundness commitments

Bun's Rust code is held to the following soundness commitments:

### 1. Unsafe-code discipline

Every `unsafe` block, `unsafe fn`, `unsafe impl`, and `unsafe trait` in Bun's Rust source must uphold a documented soundness obligation. The obligations are catalogued in `audit/synthesis/invariants.md` (see "Soundness invariants Bun's unsafe code upholds" below).

For new contributions:

- Every `unsafe` block must carry a `// SAFETY:` comment naming the obligation it discharges.
- New `unsafe impl Send` / `unsafe impl Sync` must propagate trait bounds where possible (e.g., `impl<T: Send> Send for Wrapper<T>`) and must include a justification comment for any unbounded impl.
- New `transmute` calls must use a checked alternative (`strum::FromRepr`, `TryFrom`, `bytemuck`) wherever the input could carry an arbitrary value.

### 2. Patterns documented in `src/CLAUDE.md`

Bun's Rust code uses several house patterns that the audit relies on. Contributors are expected to follow them:

- **R-2 `sharedThis` discipline.** All JS-exposed host functions default to `sharedThis: true`, which means the host function receives `&Self` (no `noalias` on the LLVM argument, so re-entrant JS that re-derives `&Self` from the wrapper's `m_ctx` cannot miscompile). Opting out (`sharedThis: false`) requires that the type's fields be migrated to `Cell` / `JsCell` so that interior mutation does not need `&mut`. The macro that emits this discipline lives in `src/codegen/generate-classes.ts` and `src/jsc/host_fn.rs`.
- **`impl_streaming_writer_parent!` borrow modes.** The macro in `src/io/PipeWriter.rs` encodes three modes for FFI callback targets: `borrow = mut` (body forms `&mut *this`; safe when nothing re-enters), `borrow = shared` (body forms `&*this`; safe when re-entrant code only needs `&Self`), and `borrow = ptr` (body calls `Self::method(this, ..)` with `this: *mut Self`; required when the callback may free `self`). New FFI callback targets must pick the correct mode.
- **`bun_core::heap` lifecycle helpers.** The runtime uses a custom heap-roundtrip primitive (`heap::create`, `heap::take`, `heap::destroy`) instead of `Box::from_raw`/`Box::into_raw` to keep pointer provenance discipline visible. See `src/bun_core/heap.rs`.
- **`bun_core::atomic_cell::AtomicCell<T>` default ordering.** `AtomicCell` defaults to `AcqRel` for `swap`/`compare_exchange`, `Acquire` for `load`, `Release` for `store`. Relaxed access requires opting in via `load_relaxed`/`store_relaxed` — named so a grep finds every site that opted out of ordering. New atomic uses should prefer `AtomicCell` over `core::sync::atomic` primitives unless there is a specific reason.

### 3. Verification

Recommended release-gate verification:

- **`cargo +nightly miri test`** on a subset of crates where it is supported (FFI-heavy and JS-engine crates are infeasible under miri's isolation; per-crate runs are feasible for `bun_ast`, `bun_alloc`, `bun_ptr`, `bun_threading`, `bun_wyhash`, `bun_md`, `bun_errno` and others).
- **`bun bd test` end-to-end suite** on Linux x64, macOS aarch64/x64, and Windows x64.
- **Cross-target `cargo check`** via `bun run rust:check-all` to ensure `#[cfg(...)]`-gated code compiles on every supported platform.
- **CI matrix** on every PR. Bun currently uses Buildkite configuration under
  `.buildkite/`; any GitHub Actions example in this audit should be treated as
  a template, not the current source of truth.

### 4. SAFETY-comment coverage

The audit baseline as of `428f61eb3486` (2026-05-15) found that 9,450 of 11,044 `unsafe`-bearing sites have a nearby proof marker (a `// SAFETY:` comment within 4 lines). The remaining 1,594 sites are tracked for hardening. Coverage can be reported per release if maintainers adopt this policy.

---

## Audit baseline

As of the most recent audit (`428f61eb3486`, 2026-05-15):

| Metric | Value |
|--------|------:|
| Total `unsafe` sites | 11,044 |
| `unsafe { ... }` blocks | 9,754 (88%) |
| `unsafe fn` | 903 (8%) |
| `unsafe impl` | 345 (3%) |
| `unsafe trait` | 20 (<1%) |
| `UnsafeCell::new(...)` | 22 (<1%) |
| Workspace crates with `unsafe` | 84 of 108 |
| SAFETY-comment coverage | 9,450 / 11,044 (86%) |

Classification (current):

| Bucket | Count | Status |
|--------|------:|--------|
| (A) Strictly unavoidable | ~9,800 | Hardened via SAFETY comments and clippy lints |
| (B) Performance-only | ~27 | Intended for a `safe-only` Cargo feature; pending benchmark logs |
| (C) Refactorable | ~110 firm | Mechanical safe rewrites tracked as cleanup PRs |
| T1 / T1-equivalent findings | 40 | Memory-safety findings and explicitly-labelled non-UB security items are separated in the public soundness-debt dashboard; critical crash-reliability items are tracked outside the T1 risk table |
| Tier 2 unsafe-contract defects | ~32 | Architecture-level; tracked separately |
| Tier 3 watchlist | ~58 | Latent / threat-model-dependent |

The full audit dashboard (with risk scoring and trend) can be published at
`audit/soundness-debt-dashboard.md` if maintainers choose to carry this
reporting format forward.

---

## Soundness invariants Bun's unsafe code upholds

Bun's Rust unsafe surface is structured around 15 named invariants. The full catalogue is in [`audit/synthesis/invariants.md`](audit/synthesis/invariants.md). The headline invariants:

| ID | Invariant | Reach |
|----|-----------|-------|
| **I-001** | Pointer-provenance discipline at FFI callback boundaries (callback paths that can free `self` must thread `*mut Self` end-to-end; `&self` / `&mut self` is forbidden if dealloc is reachable). Documented in `src/CLAUDE.md § Pointer provenance at FFI boundaries`. | 1,610+ sites |
| **I-002** | JSC `Strong`/`Weak` thread affinity (handles are `!Send`/`!Sync`; construction and destruction must happen on the JS thread). | ~55 handle-lifecycle sites |
| **I-003** | Refcount transfer on `to_js()` / `create()` (returning a wrapped JSC pointer transfers the caller's `+1` to the JS wrapper; the caller must not re-`ref()`). | Every `to_js`-returning type |
| **I-004** | Atom-string thread-table affinity (atomized strings live in a per-thread atom table; dropping from another thread is unsound). Mitigation: build via `String::clone_utf8` for cross-thread strings. | Cross-thread `bun_core::String` uses |
| **I-005** | `MimallocArena` non-Drop semantics (values inside the arena do not run `Drop`; types owning heap allocations / refcounts / FDs must be freed explicitly before arena reset). | Every arena-allocated type |
| **I-006** | OOM cannot unwind through FFI (failed allocation must not panic-unwind into C; `handle_oom` converts to a controlled abort). | Every allocation crossing FFI |
| **I-007** | Send/Sync field-level invariants for `unsafe impl` (manual impls must justify per-type; bounded propagation `unsafe impl<T: Send> Send` preferred over unbounded). | 353 manual impls |
| **I-008** | Atomic ordering correctness (each atomic uses the weakest correct ordering; `AcqRel`/`Acquire`/`Release` defaults via `AtomicCell`). | 101 atomic sites |
| **I-009** | `mem::transmute` lifetime extension is reachable from safe API only via documented contract. | Subset of 30 `mem_transmute` sites |
| **I-010** | Enum-from-integer transmutes are bound-checked (`transmute<u16, Enum>` is sound only if the integer is a valid discriminant). | Subset of 30 `mem_transmute` sites |
| **I-011** | `NonNull::new_unchecked` source non-nullity is proved. | Subset of 62 `pin_unchecked` sites |
| **I-012** | `get_unchecked` index is in-bounds. | 13 sites |
| **I-013** | `unreachable_unchecked` is genuinely unreachable. | 17 sites |
| **I-014** | `UnsafeCell` interior-mutability discipline (caller ensures no aliasing at mutation). | 28 sites |
| **I-015** | `MaybeUninit::assume_init*` runs only after every field is written. | 182 sites |

The audit's per-finding plans (under `audit/plans/`) cite the specific invariants each finding violates, so reviewers can verify the obligation chain.

---

## Proposed security contract

Bun could make the following security commitments to its users:

### Memory safety

- The Rust runtime should maintain Rust's safety guarantees for all code paths
  reachable from safe Rust callers and from JavaScript code that does not use
  `bun:ffi`.
- The HTTP server (`Bun.serve`), HTTP client (`fetch`), file system APIs
  (`node:fs`), and package manager (`bun install`) should not corrupt memory in
  response to accepted inputs: malformed network traffic, malicious lockfiles,
  hostile archives, etc. Findings against this commitment are candidate P0
  security issues.
- The bundler and transpiler should not corrupt memory in response to source
  code input.

### Confidentiality of secrets

- Process environment, credentials, and TLS private keys passed to Bun's runtime APIs (`Bun.env`, `Bun.password`, `node:crypto`) must not leak through Bun's APIs in ways the underlying primitive does not already allow.
- The package manager's lockfile parser must not exfiltrate filesystem contents in response to a hostile lockfile.

### Sandbox boundaries that we do **not** claim

Bun does not claim to be a sandbox. JavaScript code running under Bun has the same OS-level permissions as the `bun` process. Anything reachable from `Bun.spawn`, `node:child_process`, `Bun.file`, the network APIs, or `bun:ffi` is intentionally available to JS callers. **A security model that treats JavaScript code itself as untrusted (e.g., running arbitrary user-provided scripts on a shared host) is out of scope.**

---

## What is **out of contract** for security purposes

The following surfaces are part of Bun's API but are explicitly **privileged-by-design**. Findings against these are not security vulnerabilities unless they exceed the privileged contract.

### `bun:ffi` raw-pointer capability surface

`bun:ffi` exists to let JavaScript code call native code with zero overhead. The following APIs accept raw addresses or function pointers and form Rust references from them:

| API | Surface | Contract |
|-----|---------|----------|
| `bun:ffi.toArrayBuffer(addr, len)` | Form `ArrayBuffer` over caller-supplied `(addr, len)` | Caller guarantees the range is mapped, valid, and (for writable buffers) writable, and not aliased with Rust- or JSC-owned memory. |
| `bun:ffi.toBuffer(addr, len)` | Form Node-style Buffer | Same contract as `toArrayBuffer`. |
| `bun:ffi.toCStringBuffer(addr, len)` | Form Buffer with NUL-terminated bytes | Same contract. |
| `bun:ffi.ptr(fn)` / FFI finalizer registration | JS-supplied number becomes a typed-array finalizer function pointer | Caller guarantees the pointer is a valid finalizer with the right ABI. |
| `bun:ffi.JSCallback` | JS function becomes a C-callable function pointer | The pointer is valid only until the JSCallback is closed; calling after close is the caller's bug. |

If a finding shows that `bun:ffi` corrupts memory **without** the user violating
the contract above, it should be treated as a security bug. If the user violated
the contract (passed an invalid address, freed memory while a buffer was live,
etc.), that is operating as designed.

We document this here so that auditors and reporters can distinguish "Bun bug" from "bun:ffi user error" without ambiguity.

### Standalone-binary mode (`bun build --compile`)

The `bun build --compile` output embeds the source code and runtime into a single executable. Tampering with the resulting binary (modifying the embedded source map, the bundled assets, or the standalone graph metadata) is **out of contract for security purposes**: the user has already built and signed (or chosen not to sign) the binary, and Bun does not promise that a tampered binary is safe to execute. Findings of the form "a tampered standalone binary causes UB at startup" are tracked as hardening (defense-in-depth), not as vulnerabilities.

### Vendored C/C++ dependencies

Bun vendors and statically links to a number of C/C++ libraries (BoringSSL, libuv, lol-html, lsquic, mimalloc, simdutf, zlib-ng, zstd, tinycc, picohttpparser, libarchive, libdeflate, and others; see `vendor/` and `scripts/build/deps/*.ts`). The audit covers Bun's Rust-side bindings to these libraries; **it does not re-audit the libraries themselves**. If you find a vulnerability in a vendored library, report it upstream as well as through Bun's published security channel so maintainers can track the upstream fix and update the vendored copy.

### The JavaScript engine

Bun uses JavaScriptCore (a fork of WebKit's JSC) as its JavaScript engine. The engine itself is audited and maintained by the WebKit project; we update from upstream periodically and apply Bun-specific patches under `vendor/WebKit/`. **JSC vulnerabilities are reported to the WebKit project; we coordinate fixes with them.**

---

## Verification (how to reproduce our claims)

The audit artifacts are intended to be reproducible. To verify Bun's soundness claims locally:

```bash
git clone https://github.com/oven-sh/bun
cd bun
bun install
bun run rust:check-all          # cross-platform compile check
bun bd test                     # full test suite under debug build
```

For per-crate miri runs (where supported):

```bash
cd src/<crate>
cargo +nightly miri test
```

Some Bun crates cannot be run under miri because they touch FFI to JSC, libuv, BoringSSL, or simdutf in ways that exceed miri's isolation. Per-crate runs on `bun_ast`, `bun_alloc`, `bun_ptr`, `bun_threading`, `bun_wyhash`, `bun_md`, and `bun_errno` are the canonical safe-Rust foundation.

The audit artifacts (published in the audit PR as `.unsafe-audit/`) contain:

- `unsafe-inventory.jsonl` — every unsafe site with metadata.
- `audit/sites/` — per-site write-ups for the higher-risk findings.
- `audit/plans/` — refactor plans.
- `audit/synthesis/` — global views (invariants, refactor clusters, risk scoring).
- `verification-log.md` — per-crate miri/check log.
- `AUDIT_SUMMARY.md` — top-level summary.

The audit proposes publishing a redacted public version of the soundness-debt
dashboard on each release; maintainers can decide whether to adopt that release
note format.

---

## Acknowledgments

Suggested reviewers before adoption:

- The Bun core maintainer team.
- Rust unsafe-code reviewers familiar with Stacked Borrows / Tree Borrows,
  JavaScriptCore FFI, and Bun's Zig-to-Rust porting constraints.
- The public audit artifacts and verification logs in this PR.

Previous security advisories are listed at <https://github.com/oven-sh/bun/security/advisories>.

---
