# EXP-053 Reclassification — `Source::get_handle` / `to_stream`

Date: 2026-05-16

## Verdict

EXP-053 is **NO_EVIDENCE for current UB** and should be tracked as
layout-drift hardening.

The current production cast is sound today because Bun's `Pipe` layout really
does satisfy the libuv prefix invariant:

- `src/libuv_sys/libuv.rs:1160-1175` defines `#[repr(C)] pub struct Pipe`
  with the `UV_HANDLE_FIELDS` / `UV_STREAM_FIELDS` prefix at offset 0.
- `src/libuv_sys/libuv.rs:670-673` implements `unsafe trait UvHandle for
  Pipe`.
- `src/libuv_sys/libuv.rs:813-815` implements `unsafe trait UvStream for
  Pipe`.
- `src/libuv_sys/libuv.rs:3590` asserts `Pipe.data` is at offset 0.

The finding is still a real hardening opportunity: `src/io/source.rs:260` and
`:270` bypass the central trait methods and spell the prefix cast directly:

```rust
core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast()
```

That direct cast would silently survive a future `Pipe` layout drift, while
`pipe.as_handle_mut()` / `pipe.as_stream()` would force the caller through
the marker-trait contract.

## Existing Experiment

The existing EXP-053 experiment is valuable, but it proves *future drift*, not
current UB:

1. `.cast()` accepts a deliberately broken layout.
2. The runtime model shows the wrong field is read as `uv_handle_t::data`.
3. The marker-trait form rejects the broken layout at compile time.

Logs:

- `phase5_experiment_results/EXP-053.log`
- `phase5_experiment_results/EXP-053_run.log`
- `phase5_experiment_results/EXP-053_compile_fail.log`

## Artifact Rule

Do not count EXP-053 as `NEEDS_REFINEMENT` or as a current UB bug. Count it as:

- `NO_EVIDENCE` for current source UB.
- A one-line hardening PR: replace the two direct casts with
  `UvHandle::as_handle_mut()` / `UvStream::as_stream()`.

This keeps the report defensible: the audit can still recommend the fix, but it
should not imply Bun currently miscasts `Pipe`.
