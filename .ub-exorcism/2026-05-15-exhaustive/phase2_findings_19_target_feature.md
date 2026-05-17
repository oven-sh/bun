# Phase 2 — Bucket 19: Target-Feature Mismatch

**Run:** 2026-05-15-exhaustive
**Bucket:** UB-TAXONOMY §19 (Target-Feature Mismatch)
**Scope:** Workspace-wide (`src/**/*.rs`) — bun_core, foundation, runtime, every crate
**Verdict:** **N/A — clean. Zero `#[target_feature]` sites anywhere in the workspace.**

## Numbers

| Metric | Count |
|---|---|
| `#[target_feature(...)]` attributes (the UB-relevant form) | **0** |
| `#[cfg(target_feature = "...")]` gates | 2 |
| `multiversion::` macro uses | 0 |
| `is_x86_feature_detected!` / `is_aarch64_feature_detected!` | 0 |
| `core::arch::x86`/`x86_64`/`aarch64`/`wasm32` intrinsics from Rust | 4 sites, all baseline-ISA |

## All hits, classified

### 1. `src/threading/Futex.rs:459, 479` — `#[cfg(not(target_feature = "atomics"))]`
- Form: `cfg(target_feature)` (compile-time **read**, not `#[target_feature]` enable).
- Body: `compile_error!("WASI target missing cpu feature 'atomics'")` inside `#[cfg(target_arch = "wasm32")]` module.
- UB risk: **none** — this is a build-time sanity check that the wasm32 target was built with `-Ctarget-feature=+atomics`. It does not authorize the compiler to emit feature-gated instructions in non-compatible functions.

### 2. `src/perf/hw_timer.rs:226` — `core::arch::x86_64::__cpuid_count`
- `cpuid` is **baseline x86_64**; `__cpuid_count` is a `safe fn` on x86_64 (no `#[target_feature]` required).
- Comment in file confirms: "`__cpuid_count` is a safe fn on x86_64 — cpuid is baseline".
- UB risk: **none**.

### 3. `src/perf/hw_timer.rs:37, 51` — inline asm `mrs CNTVCT_EL0` / `rdtsc`
- Baseline aarch64 (`CNTVCT_EL0` is EL0-readable on every ARMv8 core) and baseline x86_64 (`rdtsc` is i586+).
- No ISA extension required; no `#[target_feature]` needed.
- UB risk: **none**.

### 4. `src/threading/Futex.rs:468, 485` — `core::arch::wasm32::memory_atomic_wait32` / `memory_atomic_notify`
- Gated by `#[cfg(target_arch = "wasm32")]` + the compile_error guard above.
- These intrinsics require the `atomics` feature, and the compile_error refuses to build without it — so by the time the call site compiles, the feature is enabled on the whole compilation unit.
- UB risk: **none** (whole-target feature, not a per-fn `#[target_feature]` mismatch).

### 5. `src/css/targets.rs:146` — local variable named `target_feature`
- False positive on the substring; unrelated to the attribute.

## Why Bun is structurally immune to Bucket 19

Bun delegates every SIMD-shaped operation to vendored C/C++ libraries that handle their own CPU-feature dispatch internally:

- `bun_simdutf_sys` (UTF-8/16 conversion, base64 — see `src/base64/lib.rs`)
- `bun_wyhash` (hashing — see `src/bun.rs:478`)
- Google Highway (called from C++ side)
- BoringSSL (crypto)
- libdeflate / zlib-ng / brotli / zstd (compression)

The Rust surface never authors per-function `#[target_feature]` enables, never uses `multiversion::`, and never runtime-detects CPU features from Rust. The single ISA-specific Rust code path (`hw_timer.rs`) uses only baseline ISA instructions reachable without any feature attribute.

## Conclusion

**Bucket 19: zero findings. No beads required.** Phase 1 invariant (zero `target_feature` in bun_core/foundation) and Section J invariant (zero in any runtime/misc crate) both hold workspace-wide. No remediation, no follow-up.
