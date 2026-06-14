# Incidental findings (non-UB)

Surfaced during Path (b) per-leaf-crate Miri runs. These are NOT UB but are bugs worth filing with Bun maintainers.

## I-1: Zig `defer` keyword in `src/safety/CriticalSection.rs` doc comments

**File:line:** `src/safety/CriticalSection.rs:1-28` (the `//!` module-level doc comment block)

**Bug:**
The module doc has indented code blocks (rustdoc treats them as doctests):
```rust
//!     shared_data.critical_section.begin();
//!     defer shared_data.critical_section.end();
//!     // (do stuff with shared_data...)
```

`defer` is a Zig keyword, not Rust. rustdoc tries to compile the extracted lines as a doctest and fails with:
```
error: expected one of `!` or `::`, found `.`
  --> src/safety/CriticalSection.rs:19:12
   |
19 | shared_data.critical_section.beginReadOnly();
```

The parse error is reported on the `.` of `shared_data.critical_section.beginReadOnly()` but it's really triggered by the prior line `defer shared_data.critical_section.end();` being invalid Rust.

**Reproduction:**
```bash
cd /data/projects/bun/src/safety
cargo +nightly miri test
# fails with 2 doctest errors at CriticalSection.rs lines 6 and 18
```

Library test surface itself runs clean under Miri (`test result: ok. 0 passed; 0 failed`).

**Fix:**
Either:
1. Wrap the example lines in `text` code-block syntax: `//! ```text` ... `//! ```` (idiomatic for non-Rust example syntax that you want to show)
2. Rewrite to idiomatic Rust + RAII (CriticalSectionGuard scope-end auto-drops):
   ```rust
   //! ```ignore
   //! let _guard = shared_data.critical_section.begin();
   //! // (do stuff with shared_data...)
   //! // _guard auto-ends on scope exit
   //! ```
   ```
3. Use `no_run` to keep the example searchable but skip compilation: `//! ```no_run`

**Impact:** rustdoc fails when run on bun_safety, blocking any per-crate `cargo doc` workflow.

## I-2: vendor/ directory empty (vendor-fetch step missing)

**Symptom:** `cargo metadata` and every cargo command failed across the workspace with:
```
unable to update /data/projects/bun/vendor/lolhtml/c-api
failed to read /data/projects/bun/vendor/lolhtml/c-api/Cargo.toml
No such file or directory (os error 2)
```

**Root cause:** `vendor/` directory is empty (size 0). The build script at `scripts/build/deps/lolhtml.ts` is supposed to fetch `cloudflare/lol-html @ 77127cd2b8545998756e8d64e36ee2313c4bb312` into `vendor/lolhtml/`, but `bun bd --configure-only` skips this step. The c-api path-dependency in `src/lolhtml_sys/Cargo.toml` (`path = "../../vendor/lolhtml/c-api"`) requires that vendor content to be present.

**Workaround (used by this audit):**
```bash
cd /data/projects/bun/vendor
mkdir -p lolhtml && cd lolhtml
git clone --depth 1 https://github.com/cloudflare/lol-html.git .
git fetch --depth 1 origin 77127cd2b8545998756e8d64e36ee2313c4bb312
git checkout --detach 77127cd2b8545998756e8d64e36ee2313c4bb312
```

**Fix recommendation:** `bun bd --configure-only` should run the source-fetch step for each dep in `scripts/build/deps/*.ts` even when not building. Alternatively: document the workaround in CLAUDE.md so non-`bun bd` workflows (cargo-direct Miri, cargo-geiger per-package, etc.) know to bootstrap vendor/ first.

**Note:** The same issue affects every other `*_sys` crate that has a vendored path-dep (boringssl_sys, cares_sys, libuv_sys, etc.). The audit only happened to hit lolhtml first because it's transitively imported by `bun_lolhtml_sys` which most workspace crates depend on via bun_runtime.

## I-3: bun_collections test compile-fail — ambiguous `init()` across LinearFifo impls

**File:line:** `src/collections/linear_fifo.rs:212/224/237` (three competing `init()` definitions)

**Bug:**
Cargo +nightly miri test --lib on `bun_collections` fails:
```
error[E0034]: multiple applicable items in scope
note: candidate #1 is defined in an impl for the type `linear_fifo::LinearFifo<T, linear_fifo::DynamicBuffer<T>>`
   --> src/collections/linear_fifo.rs:237:5
    |
237 |     pub fn init() -> Self {
note: candidate #2 is defined in an impl for the type `linear_fifo::LinearFifo<T, linear_fifo::SliceBuffer<'a, T>>`
   --> src/collections/linear_fifo.rs:224:5
note: candidate #3 is defined in an impl for the type `linear_fifo::LinearFifo<T, linear_fifo::StaticBuffer<T, N>>`
   --> src/collections/linear_fifo.rs:212:5
```

Some test file (likely an `#[cfg(test)]` mod) calls `LinearFifo::<T, _>::init()` without disambiguating which buffer type. Tests don't compile → Miri can't run.

**Impact:** Bun's `bun_collections` Miri test suite is currently un-runnable. EXP-001 (linear_fifo::assume_init_slice) needs in-tree Miri evidence; this blocks it.

**Fix:** disambiguate the test call sites (e.g., `LinearFifo::<T, DynamicBuffer<T>>::init()` or rename the methods to `new_static` / `new_dynamic` / `new_slice`).

## I-4: Zig-style `vendor/lolhtml` bootstrap is silently skipped by `bun bd --configure-only`

(Same root cause as I-2 — combined here for emphasis.) After running `bun bd --configure-only`, `build_options.rs` materialized at `build/debug/codegen/build_options.rs` BUT `vendor/lolhtml/` stayed empty. The configure step doesn't fetch vendor deps. Recommend: split `bun bd` into `configure` / `vendor-fetch` / `build` phases, with `configure-only` running configure + vendor-fetch.

## I-5: `cargo check --workspace` fails with 65 errors because codegen stubs are tiny

**File:line:** every `bun_jsc` source that calls `crate::cpp::*` functions (e.g. `src/jsc/bun_string_jsc.rs:48,98,133,140,159,165`, `src/jsc/VM.rs:192`, `src/jsc/JSObject.rs:234`, `src/jsc/lib.rs:2039`)

**Symptom:**
```
src/jsc/bun_string_jsc.rs:48:14: error[E0061]: this function takes 6 arguments but 2 arguments were supplied
src/jsc/bun_string_jsc.rs:48:14: error[E0308]: mismatched types: expected `Result<JSValue, JsError>`, found `u64`
... (65 errors)
error: could not compile `bun_jsc` (lib) due to 65 previous errors
```

**Root cause:** `build/debug/codegen/cpp.rs` is only **1.7 KB** (a stub); `generated_classes.rs` is **44 bytes**, `generated_host_exports.rs` is **49 bytes**, `generated_js2native.rs` is **46 bytes**, `generated_jssink.rs` is **43 bytes** — all stubs.

The real codegen happens when ninja executes the codegen `build` statements. `bun bd --configure-only` only generates `build.ninja` itself plus `build_options.rs` (the smallest, configure-time-known artifact). It does NOT run ninja, so the bigger codegen scripts that emit `cpp.rs`, `generated_classes.rs`, etc. never fire.

**Impact:** any audit workflow that uses `cargo check --workspace` / `cargo clippy --workspace` to scan the whole tree fails at `bun_jsc` link-edge. Path-b per-leaf-crate Miri works for leaf crates that don't import `bun_jsc::cpp` (`bun_threading`, `bun_semver`, `bun_safety` confirmed working in this run); `bun_collections` failed but for a DIFFERENT reason (I-3 ambiguous init()).

**Fix recommendation:** Add a `bun bd --codegen-only` mode that runs configure + vendor-fetch + the codegen ninja statements (without doing the actual C++/Rust compile step). This unlocks workspace-wide cargo-only workflows including:
- `cargo check --workspace` (CI gate viability)
- `cargo +nightly miri test --workspace` (Path-c full-workspace Miri matrix from Phase 11 SOAK)
- `cargo clippy --workspace` with the UB-relevant lint group from UB_RUNBOOK.md
- `cargo-geiger --workspace` for unsafe-surface trend tracking

Document this in CLAUDE.md "Changes that don't require a build" section.
