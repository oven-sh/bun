# Codex pass 3 summary — higher-severity unsafe findings

**Harness:** Codex applying `rust-unsafe-code-exorcist` plus a `multi-pass-bug-hunting`
adversarial pass.
**Date:** 2026-05-15.
**Scope:** Rust code under `src/`; no Bun source edits, no beads filed, no GitHub pushes.

The user challenged the pass-1/pass-2 result: two bugs is too weak for a
codebase with 11,044 unsafe sites. That criticism is fair. Pass 3 changed the
strategy from "classify unsafe sites" to "attack the strongest safety contracts
the port relies on."

## Pass-3 headline

The audit should no longer say "two soundness bugs" as if those are the only
important findings. The stronger picture is:

1. **Two compact, patch-ready latent bugs** from pass 1/2:
   `StoreSlice<T>` unbounded Send/Sync and Linux `usize -> SystemErrno`.
2. **Three broader soundness-design defects** that affect safe APIs or generic
   abstractions:
   - cross-thread task abstractions that schedule generic contexts without a
     `Send` or `unsafe trait` boundary;
   - process/TLS writer APIs that return `&'static mut` and can be aliased by
     safe Rust;
   - thread-local / FFI scratch-buffer APIs that return references whose true
     lifetime is "until the next call", not the type signature's lifetime.
3. **Three high-risk porting TODO clusters** that are not yet called confirmed
   live UB, but should be tracked as P1/P2 work:
   - `PackageFilterIterator` is a movable self-referential type;
   - package-manager resolve tasks store `&'static mut NetworkTask` across a
     thread-pool boundary;
   - `CopyFile<'a>` explicitly stores a `&JSGlobalObject` in a task that crosses
     worker threads, with an in-source comment saying the lifetime is unsound.

The main lesson: the earlier audit underweighted **safe API soundness** because
it focused on per-site unsafe counts. The bigger problems are smaller in count
but larger in blast radius.

## Added artifacts

- `audit/synthesis/codex-pass3-higher-severity-findings.md`
- `audit/plans/CODEX-P3-cross-thread-task-send-boundaries.md`
- `audit/plans/CODEX-P3-static-mut-lifetime-and-writer-aliasing.md`

## Strongest new findings

### P0/P1: cross-thread task traits do not express their Send boundary

Files:

- `src/jsc/any_task_job.rs`
- `src/jsc/ConcurrentPromiseTask.rs`
- `src/jsc/WorkTask.rs`
- `src/runtime/node/node_crypto_binding.rs`
- `src/threading/work_pool.rs`

The generic traits are safe to implement, but the wrappers run their context on
the work pool:

- `AnyTaskJobCtx::run(&mut self, *mut JSGlobalObject)` runs off the JS thread.
- `ConcurrentPromiseTaskContext::run(&mut self)` runs off the JS thread.
- `WorkTaskContext::run(*mut Self, *mut WorkTask<Self>)` runs off the JS thread.
- `CryptoJobCtx` is adapted into `AnyTaskJobCtx` without a `Send` bound.
- `owned_task!([Op: PasswordOp] PasswordJob<Op>, task)` stamps `unsafe impl Send`
  over a generic parameter without requiring `Op: Send`.

This is not just a theoretical lint. Existing contexts intentionally carry
`JSPromiseStrong`, `Strong`, `JSGlobalObject` references, `IntrusiveRc`, and
other JS-thread-affine handles. Those may be safe under a very narrow "only
field X is touched on the worker" proof, but the type system is not enforcing
that proof and the traits are not `unsafe`.

The fix is not a blind `+ Send`; that will likely fail because some current
contexts are deliberately not `Send`. The robust fix is to make the cross-thread
contract explicit: `unsafe trait`, split worker-state from JS-thread completion
state, or use a raw-pointer/index carrier with per-impl safety comments.

### P1: `Output::{writer,error_writer,...}` returns aliasable `&'static mut`

File: `src/bun_core/output.rs:1067-1109`.

The code explicitly says this is a "known-unsound shim":

- `source_writer_escape` exits a `thread_local!` `RefCell` borrow and returns
  `&'static mut io::Writer`.
- Public safe APIs then expose `writer()`, `writer_buffered()`,
  `error_writer()`, `error_writer_buffered()`, and `error_stream()`.

Safe Rust can call any two of these and hold two live `&mut` references to the
same TLS `Source` fields. The in-source invariant says callers use them
"briefly with no two live at once", but that is not a safe API contract.

This matters because the writer APIs are widely used across CLI, install,
bundler, runtime, test runner, and router code. The right shape is closure-based
access (`with_error_writer(|w| ...)`) or raw-pointer access for legacy callers.

### P1/P2: references into TLS / FFI scratch buffers escape as normal slices

Representative files:

- `src/resolver/fs.rs:1724-1744` (`ModKey::hash_name`)
- `src/http/lshpack.rs:32-105` (`HPACK::decode`)
- `src/install/repository.rs:527-610` (`Repository::try_ssh`, `try_https`)
- `src/paths/resolve_path.rs:1393-1407` (`normalize_string`, `normalize_string_z`)

These APIs return ordinary references into storage that is reused by the next
call on the same thread or the next FFI encode/decode operation. That is a
Zig-style "borrow until next call" contract, but the Rust signatures do not
express it. A safe caller can keep the first returned slice and call the API
again, causing mutation behind a live shared reference or invalidating the
claimed lifetime.

Several current call sites immediately duplicate or intern the result, which is
good. The issue is that the APIs themselves are safe and reusable. Convert these
to caller-provided output buffers, owned returns, closure APIs, or raw pointer
views with explicit unsafe contracts.

## High-risk watchlist promoted by pass 3

- `src/runtime/cli/filter_arg.rs:40-43,332-340`: `PackageFilterIterator` stores
  a `GlobWalkerIterator<'static>` borrowing its sibling `walker`; the TODO says
  it is unsound if the struct moves after init. The struct remains movable and
  has safe methods.
- `src/install/PackageManagerTask.rs:24-30,633-653` and
  `src/install/PackageManager/PackageManagerEnqueue.rs:352-382,1654-1687`:
  package-manager tasks store `&'static mut NetworkTask` in a thread-pool task.
  The comments already say this cannot soundly cross that boundary and should
  become a raw pointer or pool index.
- `src/runtime/webcore/blob/copy_file.rs:46-67`: `CopyFile<'a>` stores a
  `&'a JSGlobalObject` and the in-source comment says this task crosses threads
  and the lifetime is unsound in practice.

## Verification status

No Bun source was changed, so no `bun bd test` was run.

Lightweight verification performed:

- Re-read the task-wrapper implementations and their call sites.
- Confirmed `bun_jsc::concurrent_promise_task` and `bun_jsc::work_task` are
  public modules exported from `src/jsc/lib.rs`.
- Confirmed `NonNull<T>` is `!Send`/`!Sync` on this toolchain, which means the
  task wrappers are deliberately bypassing auto-trait protection for JS handles.
- Ran UBS over all Rust under `src/` and a second targeted UBS pass over the
  12 files behind the pass-3 findings. Both runs emitted summary-only JSONL
  records in this environment, not per-finding records. The counts are kept in
  `pass3/` as coarse corroboration, but the pass-3 findings above are
  source-read findings, not UBS-generated findings.

## Revised demo-PR recommendation

Do not lead only with C-001 cleanup. Lead with:

1. `StoreSlice<T>` bound fix.
2. Linux errno checked conversion fix.
3. Cross-thread task-boundary hardening design PR or at least a safety-contract
   PR converting these traits to `unsafe trait` with per-impl proofs.
4. Output writer API migration scaffold (`with_writer`, `with_error_writer`) and
   first call-site sweep.
5. Thread-local scratch-buffer lifetime audit, starting with `ModKey::hash_name`
   and `HPACK::decode`.

That is a much stronger marketing artifact: it shows the skill can move from
site counting to real soundness contracts.
