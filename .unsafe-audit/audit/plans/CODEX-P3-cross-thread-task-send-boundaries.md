# CODEX-P3 Plan — Cross-Thread Task Send Boundaries

## Problem

Bun has several generic task wrappers that run part of a user-supplied context
on a work-pool thread and later complete on the JavaScript thread. The current
Rust API makes those context traits safe and mostly unbounded by `Send`.

This is a soundness-boundary bug. If a type may run on a worker thread, the
contract must be expressed either by Rust's `Send` trait or by an explicit
`unsafe` trait with per-impl proof.

## Affected APIs

### `AnyTaskJobCtx`

File: `src/jsc/any_task_job.rs`.

The trait is safe:

```rust
pub trait AnyTaskJobCtx: Sized {
    fn run(&mut self, global: *mut JSGlobalObject);
    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()>;
}
```

`AnyTaskJob<C>::run_task` calls `job.ctx.run(...)` on the work pool. There is no
`C: Send` bound.

Concrete contexts include `SecretsCtx`, `Pbkdf2Ctx`, `ZstdCtx`, `ExternCtx`, and
`CallbackCtx<C: CryptoJobCtx>`.

### `ConcurrentPromiseTaskContext`

File: `src/jsc/ConcurrentPromiseTask.rs`.

```rust
pub trait ConcurrentPromiseTaskContext: Sized {
    fn run(&mut self);
    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated>;
}

unsafe impl<C: ConcurrentPromiseTaskContext> Send for ConcurrentPromiseTask<'_, C> {}
```

Concrete contexts include `CopyFile<'_>`, `WalkTask<'_>`, `TransformTask<'_>`,
and `PipelineTask<'_>`.

### `WorkTaskContext`

File: `src/jsc/WorkTask.rs`.

```rust
pub trait WorkTaskContext: Sized {
    fn run(this: *mut Self, task: *mut WorkTask<Self>);
    fn then(this: *mut Self, global_this: &JSGlobalObject) -> Result<(), JsTerminated>;
}

unsafe impl<C: WorkTaskContext> Send for WorkTask<C> {}
```

Concrete contexts include `ReadFile`, `WriteFile`, and `GetAddrInfoRequest`.

### `CryptoJobCtx`

File: `src/runtime/node/node_crypto_binding.rs`.

`CryptoJobCtx` is safe and lacks `Send`, but `CallbackCtx<C>` implements
`AnyTaskJobCtx`, which runs `inner.run_task()` on the worker.

### `owned_task!`

File: `src/threading/work_pool.rs`.

The macro emits:

```rust
unsafe impl<$($gen)*> Send for $ty {}
```

without adding `Send` bounds to generic parameters. Example:

```rust
bun_threading::owned_task!([Op: PasswordOp] PasswordJob<Op>, task);
```

where `PasswordOp` is only `trait PasswordOp: 'static`.

## Why not just add `Send`?

Because existing tasks intentionally contain JS-thread-affine fields:

- `JSPromiseStrong`
- `Strong` / `StrongOptional`
- `JSValue`
- `&JSGlobalObject`
- `IntrusiveRc<JSTranspiler>`

Some of these are kept inert on the worker and only used or dropped after the
task returns to the JS thread. That can be sound, but it is an unsafe
programming discipline, not a normal safe `Send` proof.

## Preferred remediation ladder

### PR A — make the contract explicit

Convert the task context traits to `unsafe trait`:

```rust
pub unsafe trait ConcurrentPromiseTaskContext: Sized { ... }
pub unsafe trait WorkTaskContext: Sized { ... }
pub unsafe trait AnyTaskJobCtx: Sized { ... }
pub unsafe trait CryptoJobCtx: Sized { ... }
```

Every impl must gain a `// SAFETY:` block answering:

1. Which fields are touched in `run` on the worker?
2. Which fields are JS-thread-affine and must not be touched until `then`?
3. Where does the destructor run?
4. What keeps any referenced JS/global/VM state alive?

This is the smallest truthful change. It does not pretend current contexts are
plain `Send`.

### PR B — split worker state from completion state for new tasks

Introduce a stricter wrapper for new code:

```rust
pub trait WorkerPart: Send + 'static {
    type Output: Send + 'static;
    fn run(self) -> Self::Output;
}

pub trait JsCompletion {
    type Output;
    fn then(self, output: Self::Output, global: &JSGlobalObject) -> JsResult<()>;
}
```

Existing Zig-port wrappers can stay under the unsafe trait while new Rust-native
tasks use the split model.

### PR C — remove misleading lifetime references from cross-thread contexts

Concrete candidates:

- `CopyFile<'a>::global_this: &'a JSGlobalObject` -> `*const JSGlobalObject` or
  a `BackRef<JSGlobalObject>` with an unsafe worker-inert proof.
- `ConcurrentPromiseTask<'a>::global_this: &'a JSGlobalObject` -> raw/backref.
- `TransformTask<'a>` and `PipelineTask<'a>` should document exactly which
  fields are worker-inert and which are worker-read.

### PR D — harden `owned_task!`

Split the macro:

- `owned_task_send!([T: Send] ...)` for ordinary tasks.
- `owned_task_unchecked_send!(...)` for legacy tasks, requiring an adjacent
  `// SAFETY:` block at the invocation.

## Verification

1. `cargo check -p bun_jsc` after trait changes.
2. `cargo check -p bun --features ...` or Bun's normal debug build once vendor
   deps are available.
3. Add compile-fail style tests where feasible:
   - a non-Send dummy context must fail for the strict wrapper;
   - the legacy wrapper must require `unsafe impl` / `unsafe trait impl`.
4. Run a small JS smoke matrix for each concrete wrapper:
   - async `Bun.file(...).text()`;
   - async `Bun.write`;
   - `Bun.password.hash`;
   - `Bun.gzipSync` async equivalents if applicable;
   - `new Bun.Glob(...).scan()`;
   - `new Bun.Transpiler().transform(...)`;
   - image pipeline if enabled.

## Marketing value

This is the first pass-3 issue to lead with. It is not a cleanup; it is a
high-leverage soundness contract across Bun's worker-pool architecture.
