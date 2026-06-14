# EXP-040 Reclassification — `S3HttpSimpleTask::Drop` `assume_init_mut`

Date: 2026-05-16

## Verdict

EXP-040 is **NO_EVIDENCE for current production UB** and should be tracked as a
panic-safety hardening / future-refactor trip-hazard.

The Miri reproducer is real, but it models a future leak-fix shape, not current
Bun source. In current source:

- `S3HttpSimpleTask::new` immediately performs
  `bun_core::heap::into_raw(Box::new(init))` at
  `src/runtime/webcore/s3/simple_request.rs:238-240`.
- `execute_simple_s3_request` calls that constructor at `:599-613` with
  `http: MaybeUninit::uninit()`, then starts the line-652
  `task.http.write(AsyncHTTP::init(...))` call. Rust evaluates the
  `AsyncHTTP::init` arguments first, so the line-655 `.expect("OOM")` panic
  can occur before `MaybeUninit::write` stores the initialized `AsyncHTTP`.
- Panic sites between allocation and `task.http.write(...)` leak the raw task;
  unwinding does **not** run `Drop for S3HttpSimpleTask` because the task has
  already escaped as a raw pointer.
- `Drop for S3HttpSimpleTask` (`:476-495`) is reached by the normal callback
  reclamation path (`on_response` uses `bun_core::heap::take(this)` at
  `:331-335`) after the HTTP request exists.

Therefore the current failure mode is a leak / stuck keepalive on panic, not
`assume_init_mut` UB.

## What the Miri Witness Proves

`experiments/EXP-040/src/main.rs` adds a `ReclaimOnUnwind` scopeguard around
the half-initialized task. That is the natural future fix for the leak, and
Miri correctly shows that reclaiming before `http.write(...)` makes the current
unconditional Drop read uninitialized `AsyncHttp` memory.

Log:

- `phase5_experiment_results/EXP-040.log`

This witness is valuable as a regression guard for any future panic-reclaim PR:
before adding reclaim-on-unwind, first change `http` to `Option<AsyncHTTP>` or
add an `initialized: bool` guard.

## Artifact Rule

Do not count EXP-040 as current UB. Count it as:

- `NO_EVIDENCE` for current production UB.
- `PANIC-SAFETY-HARDENING`: leaks on panic today; turns into UB if a reclaim
  path lands without guarding `http`.
