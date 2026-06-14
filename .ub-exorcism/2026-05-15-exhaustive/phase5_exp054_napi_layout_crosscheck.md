# EXP-054 N-API Layout Cross-Check

**Verdict:** `NO_EVIDENCE` for current x86_64 Linux / LP64 layout drift.

EXP-054 was originally recorded as an `OPEN` FFI-contract hypothesis because
five N-API `#[repr(C)]` POD mirrors in `src/runtime/napi/napi_body.rs` lack
compile-time size / alignment / offset assertions:

- `napi_property_descriptor`
- `napi_extended_error_info`
- `napi_type_tag`
- `napi_node_version`
- `struct_napi_module`

The risk is real as preventive engineering: these types sit at the native-addon
ABI boundary, so a future field reorder or padding drift would break every
addon. But absence of asserts is not itself current UB.

## Experiment

`experiments/EXP-054/` contains a source-faithful LP64 witness:

1. `build.rs` compiles `c_layout.c` against Bun's real
   `src/runtime/napi/node_api.h` with `NAPI_VERSION=10`.
2. The C reflector prints `sizeof`, `_Alignof`, and `offsetof` values for the
   five public N-API structs.
3. `src/main.rs` mirrors the current Rust `#[repr(C)]` definitions and performs
   compile-time `size_of`, `align_of`, and `offset_of` assertions against the
   same constants.

Invocation:

```bash
CARGO_TARGET_DIR=/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-054/target \
  cargo +nightly run \
  --manifest-path /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-054/Cargo.toml \
  2>&1 | tee /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase5_experiment_results/EXP-054-layout-crosscheck.log
```

Result:

```text
EXP-054 C header layout matched expected LP64 N-API constants
EXP-054 Rust mirror layout matched Bun's C N-API header layout on LP64
```

## Correct Classification

Demote EXP-054 from `OPEN` to `NO_EVIDENCE` for current UB. Keep it as
structural hardening under EXP-063 (`#[layout_locked]` derive + C reflector).

Residual work:

- Land compile-time layout asserts in `src/runtime/napi/napi_body.rs`.
- Cross-validate on macOS and Windows before asserting platform-specific
  constants.
- Extend the same template to Win32 and BoringSSL mirrors, but do not count the
  N-API structs as a live UB finding unless a concrete C/Rust layout mismatch is
  observed.
