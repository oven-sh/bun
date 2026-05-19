# EXP-055 libuv HandleType Cross-Check

**Verdict:** `NO_EVIDENCE` for current `uv_handle_type` discriminant drift.

EXP-055 was recorded as `OPEN` because `src/libuv_sys/libuv.rs::HandleType`
is hand-transcribed from libuv's `UV_HANDLE_TYPE_MAP` and lacked one
compile-time assertion per variant. That is a useful CI gate, but it is not a
current UB finding unless the Rust discriminants actually differ from the C
header.

## Experiment

`experiments/EXP-055/` contains a source-faithful witness:

1. `build.rs` compiles `c_handle_type.c` against Bun's vendored
   `src/jsc/bindings/libuv/uv.h`.
2. The C reflector prints all `uv_handle_type` discriminants, including
   `UV_FILE` and `UV_HANDLE_TYPE_MAX`.
3. `src/main.rs` mirrors the current Rust `HandleType` enum and verifies every
   discriminant at compile time.

Invocation:

```bash
CARGO_TARGET_DIR=/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-055/target \
  cargo +nightly run \
  --manifest-path /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-055/Cargo.toml \
  2>&1 | tee /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase5_experiment_results/EXP-055-handle-type-crosscheck.log
```

Result:

```text
EXP-055 libuv C enum constants matched Rust HandleType mirror
EXP-055 Rust HandleType mirror matched Bun's libuv C header constants
```

## Function-Pointer Note

The companion `uv_write_t::write` note is also better classified as portability
hardening, not as a counted UB finding. The experiment asserts
`size_of::<usize>() == size_of::<fn(*mut (), ReturnCode)>()` on the current
target, which is enough to reject the specific "width mismatch" concern here.

That does not make `usize -> fn` transmute a model pattern. A future cleanup can
store a small wrapper pointer or use a typed callback trampoline to avoid the
integer round-trip entirely. But the current evidence does not justify counting
EXP-055 as live UB.

## Correct Classification

Demote EXP-055 from `OPEN` to `NO_EVIDENCE` for current source. Keep the
compile-time discriminant assertions as hardening under EXP-063 / layout-lock
infrastructure.
