# Codex Pass 3 — Higher-Severity Findings

This pass revisits the audit after the user's challenge that "two bugs" is too
weak. The challenge exposed a flaw in the previous framing: it treated
patch-ready point bugs as the only headline, while several broader safe-API
soundness defects were sitting in the code as "port TODO" or generic
cross-thread abstractions.

## Finding P3-001 — Safe cross-thread task traits lack a Send/unsafe boundary

**Severity:** P0/P1 design soundness defect.
**Confidence:** High for the API contract problem; medium for existing live
exploitation because current impls often follow a local convention.
**Blast radius:** JSC async work, crypto jobs, filesystem jobs, image pipeline,
glob, transpiler, DNS, blob IO.

### Evidence

`src/jsc/any_task_job.rs` defines a safe trait:

```rust
pub trait AnyTaskJobCtx: Sized {
    fn init(&mut self, _global: &JSGlobalObject) -> JsResult<()> { Ok(()) }
    fn run(&mut self, global: *mut JSGlobalObject);
    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()>;
}
```

`AnyTaskJob<C>::run_task` then runs `job.ctx.run(...)` on a work-pool thread.
There is no `C: Send` bound and the trait is not `unsafe`.

`src/jsc/ConcurrentPromiseTask.rs` has the same shape:

```rust
pub trait ConcurrentPromiseTaskContext: Sized {
    fn run(&mut self);
    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated>;
}

unsafe impl<C: ConcurrentPromiseTaskContext> Send for ConcurrentPromiseTask<'_, C> {}
```

`src/jsc/WorkTask.rs` repeats it for raw-pointer contexts:

```rust
pub trait WorkTaskContext: Sized {
    fn run(this: *mut Self, task: *mut WorkTask<Self>);
    fn then(this: *mut Self, global_this: &JSGlobalObject) -> Result<(), JsTerminated>;
}

unsafe impl<C: WorkTaskContext> Send for WorkTask<C> {}
```

`src/runtime/node/node_crypto_binding.rs` adapts a safe `CryptoJobCtx` into
`AnyTaskJobCtx` with no `Send` bound:

```rust
pub trait CryptoJobCtx: Sized {
    fn init(&mut self, global: &JSGlobalObject) -> JsResult<()>;
    fn run_task(&mut self);
    fn run_from_js(&mut self, global: &JSGlobalObject, callback: JSValue);
    fn deinit(&mut self);
}

impl<C: CryptoJobCtx> AnyTaskJobCtx for CallbackCtx<C> { ... }
```

`src/threading/work_pool.rs`'s `owned_task!` macro also stamps `unsafe impl Send`
over generic parameters without adding Send bounds. One concrete expansion is:

```rust
bun_threading::owned_task!([Op: PasswordOp] PasswordJob<Op>, task);
```

where `PasswordOp` is only `trait PasswordOp: 'static`.

### Why this is more serious than a local unsafe block

The unsafe block is not the problem; the **safe abstraction boundary** is. A safe
trait implementor can put a non-Send value inside its context, schedule the job,
and have `run` execute on a worker thread. The compiler cannot defend the
boundary because Bun has erased the boundary with `unsafe impl Send` or raw
pointer scheduling.

Existing contexts make clear why a simple `+ Send` bound was avoided:

- `ConcurrentPromiseTask` itself stores `JSPromiseStrong` and
  `&JSGlobalObject`.
- `TransformTask<'a>` stores an `IntrusiveRc<JSTranspiler>`, a `&'a
  JSGlobalObject`, and a copied `Transpiler<'static>`.
- `PipelineTask<'a>` stores `JSValue` in `Input.pinned`, `Strong` in
  `Deliver::WriteDest`, and a `&'a JSGlobalObject`.
- `AnyTaskJob` contexts include `Strong`, `StrongOptional`, and
  `JSPromiseStrong`.

Those fields may be safe if and only if each worker `run` method touches only
the worker-safe subset and all JS-handle drop/unprotect paths run back on the JS
thread. That is an `unsafe` contract. It is not encoded as one.

### Refactor direction

Do not blindly add `+ Send`; it will likely fail for current contexts and hide
the true invariant.

Prefer one of:

1. Make the context traits `unsafe trait` and require every impl's SAFETY comment
   to state which fields are touched on the worker and why JS-affine fields are
   inert until `then`.
2. Split context into `WorkerState: Send` and `JsCompletionState: !Send`, so the
   work pool never owns the JS-thread state.
3. Replace generic safe context traits with raw-pointer/index carriers and make
   scheduling an unsafe operation at the site that knows the invariant.

## Finding P3-002 — `Output::*writer()` exposes aliasable `&'static mut`

**Severity:** P1 soundness defect in safe API.
**Confidence:** High; source comments acknowledge it.
**Blast radius:** Very broad. Output APIs are used from CLI, install, bundler,
runtime, router, test runner, and error reporting.

### Evidence

`src/bun_core/output.rs:1067-1109` says:

```rust
// Returning `&'static mut` is *unsound* if two are alive at once, but
// matches the Zig contract until callers migrate to `with_error_writer(|w| ..)`.
```

The actual escape:

```rust
fn source_writer_escape(project: fn(&mut Source) -> &mut io::Writer) -> &'static mut io::Writer {
    let p: *mut io::Writer = SOURCE.with_borrow_mut(|s| std::ptr::from_mut(project(s)));
    unsafe { &mut *p }
}
```

Public safe accessors include:

```rust
pub fn error_writer() -> &'static mut io::Writer
pub fn error_writer_buffered() -> &'static mut io::Writer
pub fn error_stream() -> &'static mut io::Writer
pub fn writer() -> &'static mut io::Writer
pub fn writer_buffered() -> &'static mut io::Writer
```

Safe Rust can hold two such references simultaneously. The contract "callers
use it briefly" is not enforceable.

### Refactor direction

Add closure APIs and migrate callers:

```rust
pub fn with_error_writer<R>(f: impl FnOnce(&mut io::Writer) -> R) -> R
pub fn with_writer<R>(f: impl FnOnce(&mut io::Writer) -> R) -> R
```

For call sites that truly need to store a writer across a boundary, expose a
raw-pointer API with an `unsafe` contract instead of manufacturing a safe
`&'static mut`.

## Finding P3-003 — thread-local / FFI scratch buffers escape as normal refs

**Severity:** P1/P2 safe API lifetime defect.
**Confidence:** High for the abstraction defect; per-call-site severity varies.
**Blast radius:** resolver, bundler, package-manager repository handling, HTTP/2
HPACK, path normalization.

### Representative evidence

`src/resolver/fs.rs:1724-1744`:

```rust
pub fn hash_name(&self, basename: &[u8]) -> Result<&'static [u8], bun_core::Error> {
    // TODO(port): returns slice into threadlocal buffer; lifetime is unsound
    HASH_NAME_BUF.with_borrow_mut(|buf| {
        ...
        Ok(unsafe { bun_ptr::detach_lifetime(&buf[..written]) })
    })
}
```

`src/http/lshpack.rs:32-105` returns `DecodeResult { name: &'static [u8],
value: &'static [u8] }`, but the comment says those slices point into an FFI
thread-local shared buffer and are valid only until the next decode/encode call.

`src/install/repository.rs:527-610` has `try_ssh` and `try_https` returning
slices into thread-local `PathBuffer`s.

`src/paths/resolve_path.rs:1393-1407` returns `&mut [u8]` / `&mut ZStr` into a
thread-local parser buffer. With lifetime elision, callers can accidentally
obtain a long lifetime when the input is long-lived.

### Why this matters

Current call sites often immediately duplicate, intern, or consume the returned
slice. That reduces live risk but does not make the safe API sound.

A safe caller can do this shape:

```rust
let a = modkey.hash_name(b"a")?;
let b = modkey.hash_name(b"b")?;
use_both(a, b);
```

The second call mutates the storage behind `a` while `a` is still a live shared
reference. That is the same bug class as the output writer API, but for shared
slices.

### Refactor direction

Use one of:

- caller-provided output buffers;
- owned returns for cold paths;
- closure APIs that prevent the reference from escaping;
- raw pointer / view types with explicit unsafe "valid until next call" contracts.

## Finding P3-004 — `PackageFilterIterator` is movable but self-referential

**Severity:** P2 safe-type soundness defect.
**Confidence:** High that the type is unsound in isolation; current main call
site appears not to move it after initialization.

`src/runtime/cli/filter_arg.rs:40-43` defines `GlobWalkerIterator` as
`Iterator<'static, ...>` because it borrows a sibling `GlobWalker`. At
`src/runtime/cli/filter_arg.rs:332-340`, `init_walker` writes the walker, forms a
reference to it, erases the lifetime, and stores the iterator.

The comment says:

```rust
// This is unsound if `PackageFilterIterator` moves after `init_walker`.
```

The struct is not pinned, and `next(&mut self)` is safe. The current
`multi_run.rs` use keeps it in one local slot, but the type itself exposes a
safe movable self-referential state.

Fix: `Pin<Box<PackageFilterIterator>>`, or change `bun_glob` to return a single
owning walker+iterator type that does not borrow a sibling field.

## Finding P3-005 — package-manager tasks store `&'static mut NetworkTask`

**Severity:** P1/P2 high-risk watchlist.
**Confidence:** High that the current representation is not a valid Rust
ownership model; medium on current live UB because the pool discipline may
serialize actual use.

`src/install/PackageManagerTask.rs:24-30` says a `&'a mut NetworkTask` cannot
soundly cross the intrusive task boundary and should likely be demoted to
`*mut NetworkTask`.

The union payloads then store:

```rust
pub struct PackageManifestRequest<'a> {
    pub network: &'a mut NetworkTask,
}
pub struct ExtractRequest<'a> {
    pub network: &'a mut NetworkTask,
}
```

The enqueue code writes these as `'static` reborrows from pool slots. The code
has careful comments about pool ownership, but `&mut` is the wrong carrier for a
freely-aliased task slot that crosses worker threads and is later returned to a
pool. The intended model is a raw pointer or pool index.

## Finding P3-006 — `CopyFile<'a>` explicitly carries an unsound JSGlobalObject lifetime

**Severity:** P2 high-risk watchlist and concrete instance of P3-001.
**Confidence:** High for the representation problem; per-run safety depends on
worker method discipline.

`src/runtime/webcore/blob/copy_file.rs:46-67` stores:

```rust
pub global_this: &'a JSGlobalObject,
```

with the comment:

```rust
// this struct is Box-allocated and crosses threads; `'a` here is unsound in
// practice. Phase B: likely *const JSGlobalObject.
```

That comment should become a tracked remediation item. It is a concrete
counterexample to any claim that the cross-thread task wrappers are fully
encoded in Rust's type system.

## Recommended reclassification

The master classification should add a new cross-cutting cluster:

| Cluster | Verdict | Action |
|---------|---------|--------|
| **P3-XTHREAD** task traits and owned task macro | pre-existing soundness-design defect | make contract unsafe or split worker/JS state |
| **P3-STATIC-MUT** writer/TLS scratch references | pre-existing safe API unsoundness | closure APIs / caller buffers / raw unsafe views |
| **P3-SELFREF** movable self-referential port artifacts | high-risk watchlist | pin or owning combined types |
| **P3-PM-TASK** package manager borrowed task slots | high-risk watchlist | raw pointer / pool index |

This changes the marketing story for the skill: the valuable result is not just
"two small bugs". It is the ability to find the few places where thousands of
unsafe sites depend on an under-specified global contract.
