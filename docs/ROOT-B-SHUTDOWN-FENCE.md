# Root B: worker teardown vs. cross-thread completions

## The failure class

`WebWorker::shutdown` (`src/jsc/web_worker.rs:1216`) tears down a worker's
`VirtualMachine` in five ordered steps. Step 2 sets `is_shutting_down`, drains
timers, force-closes sockets and the c-ares channel, calls
`ScriptExecutionContext::markTerminating()` (so C++ `postTaskTo` posters are
fenced), and drains the concurrent queue via
`release_queued_tasks_for_shutdown()`. Step 5 `std::alloc::dealloc`'s the raw
`VirtualMachine` box (≈`web_worker.rs:1383`) and frees the uws loop.

Nothing in that sequence cancels or awaits work already handed to a
process-global thread (WorkPool, the HTTP thread, the bundle thread). Those
jobs complete later and post back through a pointer captured at schedule time:
a `BackRef<EventLoop>`, a `&'static VirtualMachine`, or a `*const
JSGlobalObject`. Every one of those pointers is into the freed VM box or the
freed JSC heap.

All reproduced cross-thread UAFs in this class converge on
**`EventLoop::enqueue_task_concurrent`** (`src/jsc/event_loop.rs:997`). Putting
a check _inside_ the funnel does not help: `&self` there is already a pointer
into the freed box. Several callers also "guard" with an off-thread
`vm.is_shutting_down()` read; that read is itself a UAF face (the flag lives in
the freed box).

## Shutdown map (reference)

| step | action                                                         | fences                        |
| ---- | -------------------------------------------------------------- | ----------------------------- |
| 1    | `self.vm = null` under `vm_lock`                               | parent-thread readers         |
| 2a   | `is_shutting_down = true`, `on_exit`, drain timers/sockets/DNS | on-thread re-entry            |
| 2b   | `ScriptExecutionContext::markTerminating()`                    | C++ `postTaskTo` posters      |
| 2c   | `Bun__JSCTaskScheduler__markShuttingDown()`                    | `Atomics.notify` posters      |
| 2d   | `release_queued_tasks_for_shutdown()`                          | tasks already queued          |
| 3    | `WebWorker__teardownJSCVM`                                     | GC finalizers, JSC heap freed |
| 4    | `WebWorker__dispatchExit`                                      | parent releases its ref       |
| 5    | `vm.destroy()`; `dealloc(vm_ptr)`; free uws loop               | VM box freed                  |

Rust-side cross-thread posters were not serialized with any of 2b/2c/2d.

## The fence: enqueue by identifier

Off-thread jobs now carry the worker's `ScriptExecutionContextIdentifier` (a
`u32`) instead of a `BackRef<EventLoop>` / `&VirtualMachine`, and post through

```rust
ScriptExecutionContextIdentifier::post_concurrent_task(id, task) -> bool
```

backed by the same locked-registry + `isTerminating()` gate that
`ScriptExecutionContext::postTaskTo` already uses:

```cpp
extern "C" bool ScriptExecutionContext__postConcurrentTask(Identifier id, void* task) {
    Locker locker { allScriptExecutionContextsMapLock };
    auto* ctx = allScriptExecutionContextsMap().get(id);
    if (!ctx || ctx->isTerminating()) return false;
    Bun__EventLoop__enqueueConcurrentTask(ctx->globalObject(), task);
    return true;
}
```

`markTerminating()` (shutdown step 2b) takes the same lock to set the flag, so
every poster serializes into exactly one of two cases:

1. The poster's whole critical section ran before `markTerminating()`: the task
   is in the concurrent queue, and step 2d's drain observes and reclaims it.
2. `markTerminating()` ran first: the poster sees `isTerminating()` and returns
   `false` without touching the VM. The caller owns the task and runs its
   abandon path.

A `u32` identifier cannot dangle. The funnel's `bool` return replaces every
stale off-thread `is_shutting_down()` read.

Companion helpers on the same lock:

- `ScriptExecutionContextIdentifier::is_alive()` — "should I even start?" check
  for work bodies that write into JSC-heap buffers (e.g. `Scrypt`'s output
  `ArrayBuffer`). A best-effort fast drop; the authoritative gate is
  `post_concurrent_task`.
- `ScriptExecutionContextIdentifier::unref_event_loop_concurrently()` — the
  `concurrent_ref` decrement that `ConcurrentCppTask` (WebCrypto) needs after
  its body ran on the pool thread, without dereferencing the VM.

## Abandon path

On `post_concurrent_task` → `false` the target VM and its JSC heap are gone (or
about to be). The abandon path:

- **must not** touch `Strong`/`Weak`/`JSPromiseStrong`/`JSGlobalObject`/
  `VirtualMachine`/`KeepAlive::unref` — the HandleSet is freed, the loop is
  freed;
- **may** free any pure-Rust heap it owns (body buffers, `Vec`s, `Box<[u8]>`);
- **must** free a freshly heap-allocated `ConcurrentTask` node (ownership was
  not transferred);
- **may** leak the job box when it holds JSC handles. Bounded: one per
  terminated worker per in-flight op.

## Coverage

Three generic helpers carry most of the surface:

| helper                     | users                                                       |
| -------------------------- | ----------------------------------------------------------- |
| `WorkTask<C>`              | `ReadFile`, `WriteFile`, `GetAddrInfoRequest`               |
| `ConcurrentPromiseTask<C>` | `CopyFile`, `TransformTask`, `WalkTask`, `PipelineTask`     |
| `AnyTaskJob<C>`            | `Pbkdf2Ctx`, `CryptoJob<Scrypt/…>`, `ZstdCtx`, `SecretsCtx` |
| `ConcurrentCppTask`        | WebCrypto (`PhonyWorkQueue::dispatch`)                      |

Direct callers converted alongside: `FetchTasklet`, `PasswordJob`,
`CompressionStream` (zlib/brotli/zstd), `AsyncFSTask` / `NewAsyncCpTask` /
`AsyncReaddirRecursiveTask`, `S3HttpSimpleTask` / `S3HttpDownloadStreamingTask`,
`Archive::AsyncTask`, `JSBundleCompletionTask`, `TranspilerJob`.

Explicitly **not** enqueue-shaped and left for their own fixes: nested-worker
child-init reading a freed parent VM, `node:quic` finalizer ordering,
`RedisClient::finalize` free-then-read, `Bun.SQL` handle crashes during
terminating-VM JS execution, the `serve.listen`/JS-re-entry assert zone.

## Reserve alternative (not taken)

Refcount-deferred VM dealloc + a closed-flag at the funnel: each off-thread job
takes an `Arc` clone of a per-VM gate and brackets its enqueue with a read
lock; `shutdown` takes the write lock before dealloc. Same sweep, but:

- `shutdown` then _waits_ on in-flight pool jobs (a slow argon2/RSA can stall
  terminate for seconds);
- more atomics on the hot enqueue path;
- the gate must be `Arc`'d so it outlives the VM box anyway.

The identifier route reuses an existing lock, adds no wait, and matches what
the C++ side already does.

## Post-fix gate

`repro/rootB-verify/verify.mjs`: one worker per iteration arms one in-flight op
of every cross-thread source above (self-contained, loopback-only, public API),
the parent `terminate()`s mid-flight, ×100. PASS = rc 0, `ROOT-B VERIFY: PASS`,
zero ASan/assert/panic. Baseline on current canary: SIGSEGV on teardown 1
(release), heap-use-after-free on teardown 1-3 (debug+ASAN).
