# Codex `LaunderedSelf` / `black_box(ptr::from_mut(self))` Guardrail — 2026-05-16

## Question

EXP-099..104 all involve receiver-protector failures around callback-capable
methods. Bun also has a central helper, `bun_ptr::LaunderedSelf`, whose comment
claims that a `black_box(ptr::from_mut(self))` raw pointer "carries no
`noalias`" and can be reborrowed through `Self::r(this)`.

That raises a high-risk interpretation question:

- Is `LaunderedSelf::r(this)` itself always UB?
- Or is the confirmed defect narrower: using that raw pointer after the live
  receiver has entered callback-capable code / re-entry that performs foreign
  writes into the same allocation?

The answer matters because overclaiming here would make the report easy to
dismiss.

## Source Facts

`src/ptr/lib.rs:279-310` defines:

- `unsafe trait LaunderedSelf`
- `fn r<'a>(this: *mut Self) -> &'a mut Self`
- a safety contract saying callers must ensure the pointee is live, single
  threaded, and that each produced `&mut Self` is short-lived and sole at the
  point of use.

Current impls:

| Type family | Source | Notes |
|-------------|--------|-------|
| `SSLWrapper<T>` | `src/uws/lib.rs:400` | Drives EXP-100..104 receiver-reentry family. |
| `PosixBufferedWriter<Parent>` | `src/io/PipeWriter.rs:348` | Parent callbacks after I/O completion. Needs source-specific audit before promotion. |
| `PosixStreamingWriter<Parent>` | `src/io/PipeWriter.rs:691` | Same writer family. |
| `WindowsBufferedWriter<Parent>` | `src/io/PipeWriter.rs:1522` | Same writer family. |
| `WindowsStreamingWriter<Parent>` | `src/io/PipeWriter.rs:2030` | Same writer family. |

`SSLWrapper` has several `black_box(ptr::from_mut(self))` methods:

- `shutdown(&mut self)` at `src/uws/lib.rs:573-674`
- `update_handshake_state(&mut self)` at `src/uws/lib.rs:856-943`
- `handle_writing(&mut self, ...)` at `src/uws/lib.rs:1069-1115`

Those methods can synchronously call user/owner callbacks, which is why they
belong to the EXP-100..104 family. The presence of `LaunderedSelf` is not, by
itself, enough to classify every implementation as a production UB finding.

## Supporting Experiment

Supporting model:

```text
experiments/EXP-105/
```

This is intentionally **not** added to the registry as a new production
finding. It is a calibration experiment for the interpretation of existing
receiver-reentry findings.

Modes:

| Mode | Result | Meaning |
|------|--------|---------|
| `direct-bad` | Clean | A direct `black_box(ptr::from_mut(self))` followed by `LaunderedSelf::r(this)` did not fail Tree Borrows by itself. |
| `callback-bad` | Fails | If the receiver enters callback-capable code that performs an intervening foreign write, the stale raw pointer is disabled and a callback write through it is UB. |
| `raw-good` | Clean | Starting from a raw owner / `NonNull` control path avoids the receiver-protector problem. |

Commands run:

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-105
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- direct-bad \
  2>&1 | tee ../../phase5_experiment_results/EXP-105-direct.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- callback-bad \
  2>&1 | tee ../../phase5_experiment_results/EXP-105-callback.log
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- raw-good \
  2>&1 | tee ../../phase5_experiment_results/EXP-105-good.log
```

The failing log says:

```text
error: Undefined Behavior: write access through <1347> at alloc689[0x0] is forbidden
  --> src/main.rs:31:13
help: the accessed tag <1347> was created at `ptr::from_mut(self)`
help: tag later transitioned to Disabled due to foreign write at `self.flags = 3`
```

## Defensible Conclusion

Do **not** claim:

- "`black_box` never helps."
- "`LaunderedSelf` is globally unsound."
- "Every `Self::r(this)` call is a separate confirmed UB site."

Do claim:

- `black_box(ptr::from_mut(self))` is not a proof that a live `&mut self`
  receiver has stopped mattering.
- The EXP-099..104 family is real when the method enters callback-capable code
  while that receiver is live and the callback can re-enter / foreign-write the
  same allocation.
- Raw-owner entry points and statement-scoped reborrows are the correct fix
  model. The EXP-105 `raw-good` control matches the Phase-8 recommendation.

## Impact On Counts

No new registry entry. No new headline finding.

The support logs increase the raw log count from 152 to 155, but the registry
remains:

```text
100 EXP entries
65 CONFIRMED_UB
16 NO_EVIDENCE
17 DEFERRED
2 RESOLVED
0 OPEN
0 NEEDS_REFINEMENT
```

This guardrail makes the report stronger because it narrows the claim to the
exact condition Miri demonstrates.

