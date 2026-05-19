# Codex Review — Phase 1 Section K (`jsc-core`)

Reviewed against current `origin/main` source on `claude/ub-exorcist-audit`.

## Corrections Applied

1. **`Weak<T>` `ctx` is not an inert round-trip pointer.**
   `src/jsc/Weak.rs:61-68` describes `ctx` as opaque storage, but the C++ side
   forwards it to finalizers: `src/jsc/bindings/Weak.cpp:32-44` calls
   `Bun__FetchResponse_finalize(context)` for `WeakRefType::FetchResponse`.
   The live Rust call site is `src/runtime/webcore/fetch/FetchTasklet.rs:1549-1554`,
   and the finalizer entry is `:2158-2164`. The UB audit should treat `ctx`
   lifetime/thread-affinity as a Phase-2 proof obligation, not as "never
   dereferenced as Rust data."

2. **Unsafe-impl count was inflated by comment text.**
   `rg 'unsafe impl'` returns 29 because it includes six comment references.
   Actual impl lines are 23 via `rg '^\\s*unsafe\\s+impl'`: 18 Send/Sync lines
   and 5 non-Send/Sync unsafe trait impls (`ExternalSharedDescriptor` x3,
   `bytemuck::NoUninit`, `unbounded_queue::Linked`).

3. **Blob `ExternalSharedDescriptor` is not missing a SAFETY comment.**
   Current source has the type-level SAFETY comment at
   `src/jsc/webcore_types.rs:487-488` and method-level caller contracts at
   `:491/:495`. It still deserves lifecycle verification, but not a
   "missing-comment" finding.

4. **Strong's `0x10000` floor is a pointer-corruption diagnostic, not a
   thread-affinity assertion.**
   `src/jsc/Strong.rs:239-247` catches obviously corrupted/small handle pointers.
   It does not prove the handle is dropped on the JS thread. The Section K table
   now names it as a runtime corruption guard only.

## Source Facts That Held Up

- `Strong`, `Weak<T>`, `JSPromise::Weak<T>`, `JSPromise::Strong`, `JSValue`,
  `GlobalRef`, and `JsRef` are all `!Send + !Sync` through current fields
  (`NonNull`, `PhantomData<*mut T>`, `BackRef`, or `JSValue`), so Section K is
  right to avoid claiming confirmed live JSC-thread UB for those wrappers.
- `JSPromise::Weak<T>::get(&self) -> &mut JSPromise` is deliberately tied to
  the `opaque_ffi!` zero-sized-handle model (`src/jsc/JSPromise.rs:139-149`).
  It remains a good proof target, but not an immediate bug without breaking the
  opaque-handle invariant.
- `ConcurrentPromiseTask`, `WorkTask`, and `AnyTaskJob` all have current-source
  SAFETY narratives around work-pool to JS-thread sequencing. They remain
  serious unsafe-contract audit targets, but the Phase-1 artifact should not
  promote them to "confirmed production UB" without a concrete interleaving or
  reproducer.

