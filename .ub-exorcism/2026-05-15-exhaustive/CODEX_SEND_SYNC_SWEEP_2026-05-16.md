# Codex Send/Sync Follow-Up Sweep — 2026-05-16

Scope: targeted continuation of `/rust-undefined-behavior-exorcist` Bucket 8
after EXP-085 landed. Goal was not to inflate counts, but to check whether the
Send/Sync surface still had missed unbounded generic impls or stale artifact
labels.

## Commands

```bash
rg -n --glob '*.rs' 'unsafe\s+impl\s*(<[^>]+>)?\s*(Send|Sync)\s+for\s+' /data/projects/bun/src
rg -n --glob '*.rs' 'unsafe\s+impl\s*<[^>]+>\s*(Send|Sync)\s+for\s+' /data/projects/bun/src
rg -n --glob '*.rs' 'unsafe\s+impl\s*(Send|Sync)\s+for\s+' /data/projects/bun/src
rg -n 'JsCell|SendPtr|RacyCell|ThreadCell|StoreSlice|unbounded.*Send|unsafe impl<T> Send|unsafe impl<T> Sync' \
  /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/{UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md,phase4_unified_findings.md,phase2_findings_08_send_sync.md,FINAL_UB_REPORT.md}
```

Current counts:

| Query | Count |
|-------|------:|
| all textual `unsafe impl Send/Sync` rows | 157 |
| generic `unsafe impl<...> Send/Sync` rows | 42 |
| concrete `unsafe impl Send/Sync` rows | 115 |

This corrects stale Phase-2 prose that said "115 rows total" and "73 concrete
rows". The 42-generic count still matches the earlier split; the concrete side
grew / was undercounted.

## Verdict

This sweep originally promoted no new EXP. The later EXP-098 follow-up
revisited the `AtomicCell<T: Copy>` row from the same Bucket-8 surface and
proved that the earlier hardening-only classification was too weak.

| Shape | Live registry status |
|-------|----------------------|
| `StoreSlice<T>` unbounded `Send`/`Sync` | EXP-019 `CONFIRMED_UB` |
| `JsCell<T>` unbounded `Send`/`Sync` | EXP-045 `CONFIRMED_UB` |
| `WorkTask<C>` / `ConcurrentPromiseTask<C>` missing `C: Send` | EXP-046 `CONFIRMED_UB` unsafe-contract defect |
| `RacyCell<T>` / `ThreadCell<T>` unbounded `Sync` | EXP-047 `NO_EVIDENCE` as project UB; hardening-only after safe-boundary check |
| `AtomicCell<T: Copy>` unbounded `Send`/`Sync` | EXP-098 `CONFIRMED_UB` generic safe-API contract |
| `Blob`, shell IO, `VirtualMachine` asserted cross-thread contracts | EXP-082 / EXP-083 / EXP-084 `CONFIRMED_UB` |
| `GuardedLock` missing `_not_send` | EXP-018 `CONFIRMED_UB` |

The two generic `SendPtr<T>` rows remain **hardening-only**, not UB findings:

- `src/runtime/dns_jsc/dns.rs:105-107` is module-private and current source
  instantiates it only as `SendPtr(req)` for `req: *mut Request` before handing
  the request to the work pool under the documented DNS cache discipline.
- `src/bundler/BundleThread.rs:170-173` is function-local inside
  `BundleThread::spawn`, instantiated only with `instance: *mut Self`, moved
  into one spawned thread, and immediately consumed by `thread_main`.

Best remediation for both hardening rows is non-generic named wrappers
(`DnsRequestPtr`, `BundleThreadPtr`) or a shared audited `SendPtr<T>` whose
constructor is `unsafe` and whose type parameter is bounded/documented. They
should not be counted as confirmed UB today.

## Artifact Corrections Made

Updated `phase2_findings_08_send_sync.md` with a current-status overlay:

- corrected live counts to 157 total / 115 concrete / 42 generic;
- changed EXP-018 from `OPEN` to `CONFIRMED_UB`;
- clarified that EXP-045 is confirmed while EXP-047 was corrected from
  over-strong `CONFIRMED_UB` wording to hardening / `NO_EVIDENCE` as project
  UB after a direct Bun-crate safe-boundary check;
- preserved the original Phase-2 rows as historical source notes rather than
  the live registry state.

## Residual Follow-Ups

1. Payload/access audit for the 87 textual `RacyCell<...>` mentions and two
   real `ThreadCell` statics remains useful for production exploitability.
   EXP-047 no longer proves a safe-contract defect: its Miri race needs
   caller-side `unsafe` deref. Do not claim all current payloads are `Send +
   Sync`; the audited-base source includes raw-pointer / `NonNull` /
   handle-shaped payloads, so the live question is per-site cross-thread
   access discipline.
2. Per-context production exploitability for EXP-046 remains separate from the
   trait-bound verdict. The Send-bound compile experiment already proved that
   all seven current contexts rely on the unsafe wrapper-level Send.
3. `CompletionHandle` / `JSBundleCompletionTask` remains a reviewed
   sequencing-sensitive row, not a confirmed live race unless a concurrent
   read/write path is shown.

## Validation

Registry lint and convergence were rerun after later follow-ups through
EXP-092:

```text
[OK] UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md — all blocks well-formed
CONVERGED after round 56 (>=10 rounds, two consecutive quiet).
```

No source-code files were modified.
