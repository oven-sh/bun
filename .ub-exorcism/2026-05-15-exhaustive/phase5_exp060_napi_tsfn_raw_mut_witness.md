# EXP-060 Miri witness: N-API `ThreadSafeFunction` raw handle mints concurrent `&mut`

## Verdict

`CONFIRMED_UB`.

The original EXP-060 framed the issue as "Shuttle/loom owed" around `dispatch_state`, the queue, and finalizer teardown. The stronger and simpler bug is earlier: the exported N-API functions mint `&mut ThreadSafeFunction` from an opaque raw C handle before any internal synchronization can run.

## Source evidence

Bun exposes:

- `pub type napi_threadsafe_function = *mut ThreadSafeFunction` (`src/runtime/napi/napi_body.rs:1968`)
- `napi_call_threadsafe_function` forms `unsafe { &mut *func }.enqueue(...)` (`src/runtime/napi/napi_body.rs:2947-2954`)
- `napi_acquire_threadsafe_function` forms `unsafe { &mut *func }.acquire()` (`src/runtime/napi/napi_body.rs:2958-2961`)
- `napi_release_threadsafe_function` forms `unsafe { &mut *func }.release(...)` (`src/runtime/napi/napi_body.rs:2965-2971`)
- `napi_unref_threadsafe_function` / `napi_ref_threadsafe_function` also form `&mut *func` (`src/runtime/napi/napi_body.rs:2975-3007`)

`ThreadSafeFunction::enqueue` then takes `self.lock.lock_guard()` (`src/runtime/napi/napi_body.rs:2732-2734`), but the `&mut ThreadSafeFunction` has already been created. The mutex cannot retroactively make the reference-uniqueness assertion true. Concurrent addon calls through the same `napi_threadsafe_function` handle therefore create overlapping `&mut` references to the same allocation at the C ABI boundary.

## Dynamic witness

Experiment:

- `experiments/EXP-060/src/main.rs`
- raw log: `phase5_experiment_results/EXP-060-mut-raw-handle-miri.log`

The reproducer mirrors the source shape:

1. allocate a `ThreadSafeFunction`-like object with `Mutex` + `AtomicU8`,
2. copy the opaque raw pointer into two foreign-thread handles,
3. each thread runs an exported-function-like wrapper that first does `let tsfn = unsafe { &mut *func }`,
4. only after that does the method take the internal mutex.

Miri reports:

```text
Undefined Behavior: Data race detected between (1) atomic store on thread `unnamed-1`
and (2) retag write of type `ThreadSafeFunction` on thread `unnamed-2`
```

The reported retag is exactly the `&mut *func` operation. The internal mutex is present in the witness, which is the important point: the bug is not "the queue lacks a lock"; it is "the exported Rust wrapper asserts unique mutable access before entering the lock."

## Fix shape

The exported functions should not create `&mut ThreadSafeFunction` for cross-thread operations. Use one of:

1. make the extern wrappers operate on raw pointers and expose internal methods with `&self` plus interior mutability (`Mutex`, atomics, `UnsafeCell` only behind the lock);
2. introduce a `TsfnHandle(NonNull<ThreadSafeFunction>)` wrapper whose methods are `unsafe fn` / C-ABI-only and never materialize `&mut Self` for producer-thread operations;
3. split JS-thread-only operations from producer-thread operations, so only the JS thread may use `&mut ThreadSafeFunction`, while addon threads use a narrower `ThreadSafeFunctionShared` containing only queue/atomic state.

`release`, `acquire`, and `call` need the same rewrite. The finalizer/env-teardown race from F-21-4 remains worth modeling, but EXP-060 no longer needs Shuttle to justify promotion: Miri has already confirmed the C-ABI raw-handle reference-uniqueness violation.
