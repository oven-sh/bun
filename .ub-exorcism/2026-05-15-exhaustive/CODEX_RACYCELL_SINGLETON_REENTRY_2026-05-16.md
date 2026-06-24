# Codex RacyCell / Singleton Re-entry Sweep — 2026-05-16

Purpose: separate a real safe-boundary UB bug from generic `RacyCell` fear.
This is the follow-up that produced EXP-099 while keeping the EXP-047 demotion
intact.

## Correction Boundary

EXP-047 was correctly demoted: `RacyCell::get()` and `ThreadCell::get()` return
raw pointers. A caller must use `unsafe` to dereference those pointers or send
them across threads in a racy way, so the old generic witness proved a fragile
unsafe contract, not an unsound safe Bun API.

EXP-099 is different. Bun's own safe helper immediately materialises a mutable
reference:

- `src/runtime/node/node_cluster_binding.rs:35-51` stores
  `CHILD_SINGLETON: RacyCell<Option<InternalMsgHolder>>`.
- `child_singleton<'a>() -> &'a mut InternalMsgHolder` safely turns that global
  raw pointer into a caller-chosen `&mut InternalMsgHolder`.
- `on_internal_message_child` holds that mutable singleton at
  `node_cluster_binding.rs:147-151` and calls `singleton.flush(global)`.
- `handle_internal_message_child` can re-enter the same helper at
  `node_cluster_binding.rs:155-158`.
- `src/jsc/ipc.rs:140-159` defines `InternalMsgHolder::flush(&mut self)` and
  explicitly documents that `dispatch_unsafe -> event_loop.run_callback` can
  re-enter via a fresh `&mut Self`.

The source tries to work around optimizer caching with
`black_box(ptr::from_mut(self))`, but that does not erase the protected
Tree-Borrows / Stacked-Borrows tag created by the `&mut self` receiver. The
EXP-099 witness mirrors the actual shape and Miri rejects re-entering
`child_singleton()` while `flush(&mut self)` remains live.

## Experiment

Path:
`experiments/EXP-099/`

Invocation:

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-099
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-099.log
```

Signal:

```text
error: Undefined Behavior: reborrow through <...> is forbidden
  --> src/main.rs:27:9
   |
27 |         (*CHILD_SINGLETON.get()).get_or_insert_with(...)
   |         ^^^^^^^^^^^^^^^^^^^^^^^^ Undefined Behavior occurred here
   = help: the protected tag was created at `fn flush(&mut self)`
   = help: the protected tag later transitioned to Unique due to a child write
```

Verdict: `CONFIRMED_UB`.

## RacyCell Payload Sweep

| site | status | rationale |
|---|---|---|
| `src/runtime/node/node_cluster_binding.rs:35` `CHILD_SINGLETON` | EXP-099 | Safe helper returns `&mut`; `flush(&mut self)` runs re-entrant JS callbacks. |
| `src/runtime/cli/create_command.rs:2855` `THREAD` | no EXP | Main-thread install/create command join-handle bookkeeping; no source-shaped safe re-entry or cross-thread deref witness found. |
| `src/runtime/cli/test/parallel/runner.rs:790,795` `WORKER_FRAME` / `WORKER_CMDS` | watchlist | Worker-local state. Worth documenting, but no concrete race path found in this sweep. |
| `src/bun.rs:1119` `ARGV` | no EXP | Init-once startup global; used as process argv storage. No mutable re-entry edge found. |
| `src/http/h3_client/AltSvc.rs:138` `CACHE` | watchlist | HTTP-thread cache. Needs owner-thread assertion/hardening, but no confirmed safe-code race witness found. |

## Remediation Shape

Use the same callback-receiver pattern as the stronger audited R-2 fixes:

1. Change callback-running entry points from `flush(&mut self, ...)` to
   `unsafe fn flush(this: *mut Self, ...)` or a `NonNull<Self>` newtype.
2. Copy/take local data through short statement-scoped raw dereferences.
3. Do not hold any `&mut Self` receiver across `event_loop.run_callback`.
4. Add an EXP-099-fix Miri model proving the raw-owner variant is Tree-Borrows
   clean before changing the source.

This should be bundled with the EXP-026 timer receiver cleanup, because both
defects are the same conceptual bug: a callback-running method has an `&mut
self` receiver even though its body can synchronously re-enter the owner.

