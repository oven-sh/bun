# Codex PipeWriter / `LaunderedSelf` Re-entry Finding — 2026-05-16

## Why This Was Worth A Separate Promotion

The `LaunderedSelf` guardrail showed that `black_box(ptr::from_mut(self))` is
not globally wrong by itself. The question then became whether any remaining
source call sites have the *specific* failing condition: a protected `&mut self`
receiver enters callback-capable code that can mint another `&mut` into the
same allocation.

`PipeWriter` does.

## Source Evidence

`src/io/PipeWriter.rs` has several explicit R-2 comments:

- `PosixBufferedWriter::_on_write(&mut self, ...)` at `:426-451`
- `WindowsBufferedWriter::on_write_complete(&mut self, ...)` at `:1572-1619`
- `WindowsStreamingWriter::on_write_complete(&mut self, ...)` at `:2105-2185`

Representative source comment at `:2105-2117` says the parent callback can
re-enter JS and then call:

```text
writer.with_mut(|w| w.end()) or .write(..)
```

`FileSink` is the concrete parent exemplar:

- `src/runtime/webcore/FileSink.rs:254-266` uses
  `impl_streaming_writer_parent!(borrow = ptr)`, which correctly avoids
  materializing `&mut FileSink`.
- But `FileSink::on_write(this: *mut FileSink, ...)` at `:463-531` can later
  run pending JS/microtasks and call:
  - `(*this).writer.with_mut(|w| w.end())` at `:524`
  - `(*this).writer.with_mut(|w| w.close())` at `:526`

That fresh `&mut Writer` aliases the still-live `&mut self` receiver of the
writer completion method. `borrow = ptr` protects the parent. It does not
protect the writer receiver.

## Experiment

Registry entry: **EXP-106**.

Reproducer:

```text
experiments/EXP-106/
```

Bad path:

```text
phase5_experiment_results/EXP-106-bad.log
```

Miri Tree-Borrows reports:

```text
error: Undefined Behavior: write access through <1496> at alloc700[0x8] is forbidden
  --> src/main.rs:19:9
help: the protected tag <1491> was created here, in the initial state Reserved
  --> src/main.rs:24:30
   |
24 |     fn on_write_complete_bad(&mut self) {
```

Good raw-owner control:

```text
phase5_experiment_results/EXP-106-good.log
```

The control passes. It uses the same parent callback write but starts the
writer completion path from a raw owner pointer instead of an `&mut self`
receiver.

## Correct Interpretation

This finding does **not** mean:

- `impl_streaming_writer_parent!(borrow = ptr)` is bad. It is the right parent
  mode for `FileSink`.
- Every `PipeWriter` callback is separately proven bad.
- `LaunderedSelf` itself is globally unsound.

It does mean:

- Callback-running writer completion methods must not have `&mut self`
  receivers when parent callbacks can re-enter the same writer.
- `black_box(ptr::from_mut(self))` is a reload barrier, not a borrow-protector
  eraser.
- The same raw-owner fix model used for EXP-026/099/100..104 applies here.

## Remediation Shape

Migrate callback-running writer completion/error paths to raw-owner entry
points:

```rust
fn on_write_complete_raw(this: *mut Self, status: uv::ReturnCode) { ... }
```

Create only statement-scoped `&mut` references in spans that do not call parent
callbacks / JS / libuv / uSockets. Keep the existing parent `borrow = ptr`
discipline; it solves a separate parent-provenance problem and should not be
regressed.

