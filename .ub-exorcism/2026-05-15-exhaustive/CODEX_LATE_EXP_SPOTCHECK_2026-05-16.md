# Codex Late-EXP Spot Check — 2026-05-16

Purpose: adversarially re-check the late Codex-promoted EXP entries that are most
likely to embarrass the report if overclaimed. This is not a new bug hunt; it is
a source-and-log consistency check against current `claude/ub-exorcist-audit`
source state.

## Verdict

No demotions required in this pass. The late high-risk entries checked here are
defensible as written, with one important framing rule:

> EXP-073..084 are not all "we found a production crash path" claims. Several
> are generic safe-API / unsafe-contract defects: safe Rust can exercise the bad
> API shape, and the shipped code exposes that API. Production reachability is
> only claimed where the registry explicitly says so.

## Source Checks

| EXP | Source facts rechecked | Evidence log |
|---|---|---|
| EXP-073 | `CopyFileWindows` stores `event_loop: &EventLoop`; its throw/resolve path casts to `*mut EventLoop` and calls the mutating `enter_scope` shape. The sibling `WriteFileWindows` uses the raw-pointer representation called out by the remediation text. | `phase5_experiment_results/EXP-073-default-miri.log`, `EXP-073-tree-borrows.log` |
| EXP-074 | `TimerObjectInternals::parent_ptr(&self)` starts from shared provenance and reaches a write to plain `EventLoopTimer.state`; the source comment's "write through Cell/UnsafeCell" discipline does not cover that plain field. | `phase5_experiment_results/EXP-074-default-miri.log`, `EXP-074-tree-borrows.log` |
| EXP-075 | `DevServer::try_define_deferred_request(&mut self, ...)` stores a backref minted from `std::ptr::from_ref(self)` and later writes through `dev.cast_mut()`. This matches the report's shared-provenance write claim. | `phase5_experiment_results/EXP-075-default-miri.log`, `EXP-075-tree-borrows.log` |
| EXP-076 | `WindowsNamedPipeContext` stores `vm: &'static VirtualMachine`; later code casts that shared reference to `*mut VirtualMachine` to call a mutating VM enqueue path. The fix logs show the raw-pointer representation is the intended repair. | `phase5_experiment_results/EXP-076-default-miri.log`, `EXP-076-tree-borrows.log`, plus fix logs |
| EXP-077 | CSS module result types expose `'static` references after lifetime widening; the Miri log reports a dangling reference inside `ToCssResult`. The report already limits production reachability by noting current in-tree callers only read `result.code`. | `phase5_experiment_results/EXP-077-default-miri.log` |
| EXP-078 | `src/bun_core/util.rs:111-119` defines safe trait method `ArrayLike::set_len_and_slice`; the `Vec<T>` impl at `:294-301` calls `set_len(n)` and returns `as_mut_slice()`. A safe caller can read before writing, so the generic safe-API UB claim is valid. | `phase5_experiment_results/EXP-078-default-miri.log` |
| EXP-079 | `Transpiler::env_mut(&self)` is a safe shared-receiver method that returns `&mut Loader`; the Tree-Borrows log confirms the overlapping-mutable-borrow witness. | `phase5_experiment_results/EXP-079.log` |
| EXP-080 | `src/dispatch/lib.rs:302-317` generates `pub kind` and `pub owner` fields while documenting the invariant on `unsafe fn new`; users such as `DevServerHandle` add `Send`/`Sync` externally. The public fields really do bypass the only unsafe constructor. | `phase5_experiment_results/EXP-080-default-miri.log` |
| EXP-081 | POSIX `IteratorResult` contains a lifetime-erased `Name` pointing into iterator storage; the rerun log reports a dangling pointer after retaining an entry and dropping the iterator. | `phase5_experiment_results/EXP-081-rerun.log` |
| EXP-082 | `src/jsc/webcore_types.rs:60-96` defines `Blob` with `global_this: Cell<*const JSGlobalObject>` plus `unsafe impl Send` and `unsafe impl Sync`; `:224-231` exposes safe `global_this(&self) -> Option<&JSGlobalObject>`. `JSGlobalObject` is emitted by `opaque_ffi!`, whose body contains `UnsafeCell` + `PhantomData<*mut u8>`, so it is thread-affine by auto-trait. | `phase5_experiment_results/EXP-082.log` |
| EXP-083 | `src/runtime/shell/IOWriter.rs:237-252` and `src/runtime/shell/IOReader.rs:72-100` declare `Send + Sync` over `UnsafeCell` state. Safe methods such as `IOWriter::enqueue(&self, ...)` and `IOReader::{start,add_reader,remove_reader}(&self, ...)` mutate that state. | `phase5_experiment_results/EXP-083.log` |
| EXP-084 | `src/jsc/VirtualMachine.rs:611-612` declares `Send + Sync`; safe methods `as_mut(&self)` and `get_mut()` at `:664-688` route through TLS `get_mut_ptr()`, which uses `unwrap_unchecked()` after a debug-only assertion. A safe off-thread call is therefore a release-mode UB trap. | `phase5_experiment_results/EXP-084-release.log` |

## Corrections Avoided

- Do **not** rewrite EXP-082/083/084 as proven production races unless a live
  off-thread caller is shown. They are stronger than watchlist items because the
  safe API boundary is unsound, but the report should keep its current
  "generic safe-API / unsafe-contract defect" framing.
- Do **not** demote EXP-078 because current call sites fill immediately. The
  unsoundness is at the safe trait method boundary; the current helper contract
  cannot prevent a safe caller from observing the uninitialized slice.
- Do **not** demote EXP-080 as "only unsafe callers can construct it": the point
  is that the generated fields are public, so safe callers can bypass
  `unsafe fn new`.
