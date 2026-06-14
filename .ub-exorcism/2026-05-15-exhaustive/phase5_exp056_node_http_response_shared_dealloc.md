# EXP-056 — NodeHTTPResponse zero-ref `deref(&self)` deallocates through shared provenance

## Verdict

`EXP-056` is promoted from `NEEDS_REFINEMENT` to `CONFIRMED_UB`.

This is a narrow confirmation: it confirms the zero-ref destructor path in
`NodeHTTPResponse::deref(&self)`, not the earlier speculative cross-thread
`Cell<u32>` race framing.

## Source facts

- `src/ptr/lib.rs:638-643` documents `AsCtxPtr` as `&self -> *mut Self` with
  shared/read-only provenance. The comment explicitly says consumers must route
  mutation through `Cell` / `JsCell` / `UnsafeCell`.
- `src/runtime/server/NodeHTTPResponse.rs:1924-1934` implements
  `NodeHTTPResponse::deref(&self)`.
- The zero-ref branch calls `deinit(&self)`.
- `src/runtime/server/NodeHTTPResponse.rs:1919` then runs
  `drop(bun_core::heap::take(self.as_ctx_ptr()))`.
- That is a deallocation through a pointer derived from `&self`.

The source audit also found that `RefPtr<NodeHTTPResponse>` is not used in the
workspace, so the confirmed problem should not be described as a broad `RefPtr`
safe-handle defect.

## Miri witness

Reproducer:

`experiments/EXP-056/src/main.rs`

Invocation:

```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-056
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-strict-provenance" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-056-shared-dealloc.log
```

Signal:

```text
error: Undefined Behavior: deallocation through <490> at alloc286[0x0] is forbidden
...
the conflicting tag <480> has state Frozen which forbids this deallocation
...
the conflicting tag <480> was created here
src/main.rs:11:9
std::ptr::from_ref(self).cast_mut()
```

The witness is intentionally source-shaped:

```rust
fn as_ctx_ptr(&self) -> *mut Self {
    std::ptr::from_ref(self).cast_mut()
}

fn deinit(&self) {
    unsafe { drop(Box::from_raw(self.as_ctx_ptr())) }
}

fn deref(&self) {
    let n = self.ref_count.get() - 1;
    self.ref_count.set(n);
    if n == 0 {
        self.deinit();
    }
}
```

## Correct classification

Confirmed:

- Zero-ref `deref(&self)` deallocates the `NodeHTTPResponse` allocation through
  shared/read-only provenance.
- Tree Borrows rejects the operation.
- This is the same abstract-machine shape as the source path.

Not claimed:

- No `RefPtr<NodeHTTPResponse>` use was found.
- No production cross-thread `Cell<u32>` race is claimed here.
- No claim is made that every non-zero `ref_()` / `deref()` call is unsound;
  the non-zero path remains an ordinary interior-mutable `Cell` update.

## Remediation direction

Change the zero-ref release path so the destructor owns an original/raw heap
pointer, not a pointer reconstructed from `&self`.

The existing `CellRefCounted::deref(this: *mut Self)` pattern in
`src/ptr/ref_count.rs:692-715` is the right shape: it accepts the raw pointer,
projects only the refcount field for the decrement, and calls `destroy(this)`
on zero without converting through a whole-struct shared reference.
