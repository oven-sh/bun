# Codex Review — Phase 1 Section Q (`http-network-stack`)

Reviewed the new Section Q artifacts against current source and executed the
missing EXP-020 mirror.

## Corrections Applied

1. **EXP-020 now has an actual experiment and log.**
   The registry claimed a concrete strict-provenance hit, but no
   `experiments/EXP-020` directory or `EXP-020.log` existed. I added the mirror
   harness and ran:

   ```bash
   MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run
   ```

   Miri reports:

   ```text
   unsupported operation: integer-to-pointer casts and `ptr::with_exposed_provenance`
   are not supported with `-Zmiri-strict-provenance`
   ```

   The log is `phase5_experiment_results/EXP-020.log`.

2. **EXP-020 wording tightened.**
   The prior text said "any deref is UB" and included bucket 14
   (`*const T` mutation). Current source does not mutate through the pointer;
   the concrete failure is the strict-provenance integer-to-pointer cast. The
   registry now keeps the allowed verdict `NEEDS_REFINEMENT` and puts the
   strict-provenance detail in the severity/expected-signal fields, so public
   summaries do not count this with default-Miri/runtime UB traces.

3. **Section Q notes now distinguish address-range proof from provenance proof.**
   `is_slice_in_buffer(self.path, self.href)` and
   `is_slice_in_buffer(self.host, self.href)` prove address containment. They do
   not preserve provenance for `let ptr = start as *const u8`. The remediation
   should form the returned pointer from the original `self.href`/`self.host`
   base using provenance-preserving pointer APIs.

## Source Facts That Held Up

- `src/url/lib.rs:340-351` is present on audited base
  `origin/main@4d443e5402`; W4 spot-check against latest fetched
  `origin/main@e750984db6` shows the same `as usize` arithmetic followed by
  `as *const u8`.
- The positive comparison site in `src/http/lib.rs:4136-4141` remains a useful
  remediation pattern: it derives the mutable pointer from the owning `Vec`
  base with `base.add(off)` rather than from the borrowed slice's integer
  address.
- The picohttp H9 provenance issue at `src/picohttp/lib.rs:383` is still live
  and still only justifies bounds, not write provenance. EXP-011 now has a
  Tree-Borrows mirror witness for the exact `buf.as_ptr()` →
  `cast_mut().write(0)` wrapper pattern; it should be described as a
  confirmed model witness, not as a full integrated picohttpparser trace.
