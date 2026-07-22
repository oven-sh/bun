# CODEX-P2 — Windows `BundleThread` waker placeholder

**Cluster:** stale zero-initialization / invalid-value avoidance.
**Source:** `src/bundler/BundleThread.rs:136-155`, `src/io/lib.rs:2171-2193`.
**Inventory site:** `S-000482`.
**Status:** plan only; no source edits authorized.

## Problem

`BundleThread::uninitialized()` constructs a placeholder `BundleThread` before `thread_main` writes the real waker and signals `ready_event`.

The Unix path uses the safe abstraction:

```rust
#[cfg(unix)]
waker: Async::Waker::placeholder(),
```

The Windows path still does this:

```rust
#[cfg(windows)]
// TODO(port,windows): `Waker { loop_: &'static _ }` is also
// NonNull; provide a `placeholder()` once the Windows event-loop
// port lands. Kept as-is here to avoid an untestable change.
// SAFETY: see TODO — this is technically invalid_value UB on
// Windows; the field is overwritten before any read.
waker: unsafe { bun_core::ffi::zeroed_unchecked() },
```

But `src/io/lib.rs` now provides the Windows placeholder:

```rust
pub const fn placeholder() -> Self {
    Self { loop_: None }
}
```

So the TODO is stale: the safe API exists and the call site does not use it.

## Classification

**P1/P2 remediation.**

The in-tree comment calls the current branch "technically invalid_value UB." Current `WindowsWaker` stores `Option<BackRef<WindowsLoop>>`, so a layout-level argument may make all-zero a valid `None` on today's compiler. That nuance should not block the fix: relying on zeroed layout is unnecessary because the intended safe sentinel exists.

## Proposed patch

Replace the cfg split with the same safe call on all platforms:

```rust
waker: Async::Waker::placeholder(),
```

Then delete the stale Windows TODO/SAFETY block.

If maintainers prefer preserving cfg-local comments, use:

```rust
#[cfg(unix)]
waker: Async::Waker::placeholder(),
#[cfg(windows)]
waker: Async::Waker::placeholder(),
```

but there is no technical need to keep the duplication.

## Why this is safe

`thread_main` writes the real waker before `ready_event.set()` releases any caller that can enqueue work:

```rust
core::ptr::addr_of_mut!((*instance).waker)
    .write(Async::Waker::init().unwrap_or_else(|_| panic!("Failed to create waker")));
```

The placeholder is not meant to be observed by `wake`, `wait`, or `uv_loop`. It exists only so `BundleThread` is a fully initialized Rust value between allocation and the real write.

`WindowsWaker::placeholder()` encodes this explicitly as `loop_: None`; any accidental use panics through `loop_ref()` instead of depending on zeroed representation.

## Verification

Minimum:

```sh
cargo check -p bun_bundler --target x86_64-pc-windows-msvc
```

Preferred per repository guidance for platform-gated code:

```sh
bun run rust:check-all
```

If source edits are authorized and this is included in a demo PR, also run the narrowest relevant Bun debug-build test that exercises `Bun.build` thread creation:

```sh
bun bd test <bundler test file>
```

Use the exact existing test file for the bundler behavior; do not create a new file unless no appropriate file exists.

## PR shape

Single-file patch, expected diff under 10 lines.

Suggested title:

```text
bundler: use Windows Waker placeholder in BundleThread::uninitialized
```

Suggested commit body:

```text
BundleThread already uses Async::Waker::placeholder() on Unix so the
temporary waker field is a valid Rust value before thread_main writes the
real waker. The Windows Waker now has the same placeholder API, but the
cfg(windows) branch still zero-initialized the field under a stale TODO that
called the value invalid.

Use the safe placeholder on Windows too.
```

