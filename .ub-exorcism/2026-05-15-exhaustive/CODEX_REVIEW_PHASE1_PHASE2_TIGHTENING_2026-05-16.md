# Codex Review — Phase 1/2 Tightening (2026-05-16)

Scope: adversarial cleanup of the live UB-exorcist artifacts after the Phase-1
fan-out and early Phase-2 validity sweep. No source files were edited.

## Corrections Applied

1. **Strict-provenance findings are separated from default-Miri UB.**
   EXP-020 (`URL::host_with_path`) and EXP-029 (`EnvStr`) both have real
   `-Zmiri-strict-provenance` failures, but they are now `NEEDS_REFINEMENT`
   with `STRICT_PROVENANCE_FAIL` severity. Public summaries should count them
   separately from default-Miri/runtime UB traces.

2. **Restored accidentally drifted verdicts.**
   EXP-001, EXP-002, EXP-026, and EXP-027 are back to their correct statuses:
   `CONFIRMED_UB`. Registry lint is clean and the verdict distribution is now:
   `CONFIRMED_UB=16`, `NEEDS_REFINEMENT=5`, `OPEN=2`, `RESOLVED=1`,
   `NO_EVIDENCE=1`.

3. **Fixed PR #30765 wording.**
   The three source fixes are still in open PR #30765, verified with:
   `gh pr view 30765 --repo oven-sh/bun`. The artifacts now say PR #30765
   **proposes** the Linux errno, GuardedLock, and StoreSlice fixes; they no
   longer imply those fixes landed or that Windows was patched by that PR.

4. **Corrected `SystemErrno` counts.**
   `src/errno/linux_errno.rs` has 134 valid discriminants (`0..=133`), not
   `~15`. Phase-2 validity tables now use `134 / 65 536` and `99.80%` invalid.

5. **Narrowed Section I `SendPtr<T>`.**
   `SendPtr<T>` in `src/runtime/dns_jsc/dns.rs` is private and currently only
   instantiated as `SendPtr<Request>` at `dns.rs:3080`. It remains a good
   Phase-2 hardening target because the generic impl is wider than its
   invariant, but it is not an EXP-019-equivalent public safe-API bug without a
   second instantiation or safe escape.

6. **Kept the lockfile `read_array` correction intact.**
   `Buffers::read_array<T>` is not a one-stroke fix for EXP-003/005/006/007.
   The new `read_array::<PatchedDep>` bool-validity issue is now phrased as a
   `MUST-BE-UB` candidate pending its own EXP/Miri log, not as part of the
   already Miri-confirmed count.

7. **Tightened signal-handler wording.**
   Section U now distinguishes the POSIX signal entry point from the Rust panic
   hook and Windows VEH. It also avoids implying that `fork`/`execve` are the
   problem; the unsafe path is the non-async-signal-safe setup before reaching
   any process-spawn primitive.

## Verification

```bash
python3 /home/ubuntu/.codex/skills/rust-undefined-behavior-exorcist/scripts/lint-experiment-designs.py \
  .ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md
# [OK] ... all blocks well-formed
```

Additional grep sweeps found no remaining live stale phrases for:

- overbroad `read_array` fix-point claims
- `SymbolMap::follow()` described as read-only
- the false Windows `RawSlice<u16>` auto-trait inversion as a live claim
- PR #30765 fixes described as already landed
- stale `SystemErrno` valid-discriminant counts
