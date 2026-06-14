# Codex Safe-API Contract Sweep — 2026-05-16

Purpose: continue the UB-exorcist pass after registry convergence by looking for safe Rust APIs that expose unsafe invariants to ordinary callers. This is distinct from counting `unsafe` blocks: the defect is that safe callers can invoke the API in a way that violates Rust's aliasing, validity, thread-affinity, or lifetime model.

## Method

1. Re-read the existing `CODEX_MUT_FROM_REF_SWEEP_2026-05-16.md` and the Phase-2 lifetime findings.
2. Re-ran a narrower direct-signature pass for safe `pub fn ...(&self) -> &mut ...` shapes. The broad textual sweep had 70 hits; the stricter direct-signature pass found 37.
3. Re-read high-risk survivors against current `origin/main@4d443e5402`, starting with rows previously marked contractual/defensible.
4. Required either an existing confirmed EXP witness or a new Miri/Tree-Borrows experiment before promoting any row.

## Promotion

### EXP-087 / F-L-6 — `ThreadPool::get_worker(&self, id) -> &'static mut Worker`

Source:

- `src/bundler/ThreadPool.rs:414-428`
- `src/bundler/ThreadPool.rs:629-652`

Finding: `ThreadPool::get_worker(&self, id)` locks `workers_assignments` while looking up or creating the heap-pinned `Worker`, then drops the lock and returns `&'static mut Worker`. The lock serializes map mutation only. It does not guard the lifetime or uniqueness of the returned mutable reference.

Safe Rust can call the method twice for the same `ThreadId` and keep both results live:

```rust
let first = pool.get_worker(id);
let second = pool.get_worker(id);
first.touched = 1;
second.touched = 2;
```

`experiments/EXP-087` mirrors this shape with an `UnsafeCell<Worker>` and safe `get_worker(&self) -> &'static mut Worker`. Miri with Tree Borrows rejects the second write:

```text
error: Undefined Behavior: write access through <245> at alloc110[0x0] is forbidden
  --> src/main.rs:34:5
help: the accessed tag <245> was created here ... let second = pool.get_worker();
help: the accessed tag <245> later transitioned to Disabled due to a foreign write ... first.touched = 1;
```

Verdict: `CONFIRMED_UB` safe-API shape. Production reachability remains caller-dependent: current bundler code may keep the one-worker-per-stack discipline, but the public safe API does not encode it.

## Reviewed But Not Promoted

- Existing EXP-057 covers the broad 17-site `fn(&self) -> &'a mut T` cluster. The wider 70-hit textual queue remains remediation inventory, not 70 new findings.
- EXP-079 covers `Transpiler::env_mut(&self) -> &'a mut Loader<'a>`.
- EXP-083 covers shell `IOWriter` / `IOReader` `Sync` plus safe `&self` mutators over `UnsafeCell<State>`.
- EXP-084 covers `VirtualMachine: Send + Sync` plus safe TLS-backed mutation.

## Artifact Impact

- Added `EXP-087` to `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`.
- Added `experiments/EXP-087` and `phase5_experiment_results/EXP-087.log`.
- Promoted Phase-4 F-L-6 from contractual/defensible to confirmed safe-API UB.
- Updated `phase2_findings_15_lifetimes_escape.md`, `phase8_remediation_plan.md`,
  `FINAL_UB_REPORT.md`, `UB_RUNBOOK.md`, and the convergence tracker to 83
  registry entries / 53 `CONFIRMED_UB` at the time of this sweep. Later
  follow-ups continued through EXP-111 and superseded the interim 94-entry /
  60-confirmed checkpoint; use `FINAL_UB_REPORT.md` for the current pinned-base
  count.
