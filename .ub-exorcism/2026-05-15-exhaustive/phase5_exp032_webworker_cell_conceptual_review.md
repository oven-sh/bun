# EXP-032 WebWorker Cell Cross-Thread Review

**Verdict:** `NO_EVIDENCE` for current UB.

EXP-032 stayed open after a clean loom model because the registry claimed a
remaining "type-system lie": `WebWorker` is `!Sync`, but Bun materialises
`&WebWorker` from a raw pointer on a different thread.

That framing overstates Rust's rules. `!Sync` means **safe Rust** may not share
`&WebWorker` across threads. It does not mean unsafe code causes UB merely by
forming a shared reference on another thread. The actual UB question is whether
the code violates the memory model: unsynchronised `UnsafeCell`/`Cell` access,
invalid aliasing, dangling pointer, or another violated invariant.

## Source Evidence

Current `src/jsc/web_worker.rs` makes the intended invariant explicit:

- `live_next` / `live_prev` are `Cell<*mut WebWorker>`.
- `register`, `unregister`, and `terminate_all_and_wait` access those fields
  while holding `live_workers::MUTEX`.
- `vm: Cell<*mut VirtualMachine>` is read cross-thread only under `vm_lock`.
- The file comments explicitly avoid `&mut WebWorker` because the parent thread
  may concurrently hold `&WebWorker`; the code uses `Cell`/`JsCell`/raw pointers
  for the fields that need interior mutability.

## Dynamic Evidence

Existing `experiments/EXP-032/` models:

- `live_next` / `live_prev` / `vm` as loom `UnsafeCell`.
- `live_workers::MUTEX` as `loom::sync::Mutex`.
- `HEAD` as `AtomicUsize`.
- `register`, `unregister`, and `terminate_sweep` with the same access pattern
  as the source.

The default loom run passes all three positive tests. The ignored negative
control removes the mutex from the sweep and loom catches the race. That is
non-vacuous evidence that the serialization invariant is the load-bearing
piece.

Raw log: `phase5_experiment_results/EXP-032.log`.

## Correct Classification

Demote EXP-032 from `OPEN` to `NO_EVIDENCE`.

Remaining hardening is still reasonable:

- Replace `Cell<*mut WebWorker>` with `AtomicCell<*mut WebWorker>` if the team
  wants the synchronization policy to be local to the fields rather than only to
  the surrounding mutex discipline.
- Add a checked `Sync` marker/newtype or documentation lint if future edits
  might bypass `live_workers::MUTEX` / `vm_lock`.

But absent an unsynchronised access, `!Sync` alone is not a UB witness.
