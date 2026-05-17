# Phase 2 — Bucket 11 Findings: Panic Safety, `mem::forget`, `ManuallyDrop`

**Run:** `2026-05-15-exhaustive`
**Bucket:** 11 — Panic Safety, `mem::forget`, `ManuallyDrop`
**Source skill ref:** `references/UB-TAXONOMY.md` §11
**Author:** Phase 2 static-bucket-sweeper for Bucket 11
**Inputs read:**
- all `phase1_inventory_*.md`, all `phase1_notes/*.md`
- `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` (EXP-013, EXP-016)
- Bucket 5 sweeper's out-of-scope panic-safety sightings
- Bucket 13 sweeper's forget/from_raw audit

---

## Bucket scope clarification

Panic safety is *almost never UB on its own* — the typical outcome is a leak
or a deadlock. It becomes UB when:

1. A panic-on-unwind path leaves a partly-initialized object whose `Drop`
   then reads uninitialized bytes or double-frees.
2. `mem::forget(x)` is paired with a sibling resource that *still* runs its
   Drop, e.g. a `ptr::read` move followed by a `forget` of the source,
   where the intervening code can panic and leave the source's `Drop`
   running on bytes the read already consumed (→ double-free / UAF).
3. A panic crosses an FFI / `extern "C"` boundary, which is itself UB
   (the unwind machinery cannot traverse a non-Rust frame).
4. `Drop` does blocking I/O or takes a lock on a path that was already
   unwinding — turns "I crashed" into "I deadlocked".

Pure "the resource leaks" (no UAF, no UB, no deadlock) is **out of scope**
for the UB exorcist, but is documented here so the remediation queue
(Bucket 5's sighting list) is not lost.

---

## Phase 1 inventory totals (this bucket)

| Source | Workspace `src/` count |
|---|---|
| `impl Drop for …` blocks | **325** |
| `mem::forget(...)` (call expressions, excl. doc/comments) | **53** (80 total grep hits incl. comments) |
| `ManuallyDrop<…>` field/type uses | **58** types; **109** `ManuallyDrop::new/take/drop` call expressions |
| `core::ptr::drop_in_place` | ~17 (per A inventory; rest in macros) |
| `assume_init_drop()` | enumerated in Bucket 5 inventory |

Distribution highlights:
- Heaviest `Drop` density: `src/runtime/*` (~120 impls), `src/jsc/*` (~25),
  `src/sql_jsc/*` (~12), `src/runtime/webcore/s3/*` (~5).
- Heaviest `ManuallyDrop` density: `src/runtime/bake/DevServer.rs` (watcher
  thread hand-off), `src/runtime/api/JSTranspiler.rs` (bitwise copy of
  `Transpiler<'static>`), `src/runtime/api/bun/subprocess/Writable.rs`
  (enum-payload lifts).

Phase-1 cross-section verdict (per Section B, K, N, O notes):
> Every `ManuallyDrop` site Phase 1 inspected is a documented
> "transfer-once" idiom; **no `ManuallyDrop`-as-leak orphans were found**.
> Every `mem::forget` site Phase 1 inspected balances a sibling
> `ptr::read` / FFI ownership transfer; **no orphan `forget` calls**.

This Phase-2 sweep confirms that aggregate verdict. The new finds are
*panic-window* hazards (UB *conditional on a panic occurring between two
specific points*) and *unhandled-panic-across-FFI* hazards, not orphans.

---

## Existing experiments cross-referenced

### EXP-013 — CONFIRMED (signal-handler async-signal-safety)
- Site: `src/crash_handler/lib.rs:1320-1450` signal handlers + `:1801` Rust panic hook + `PANIC_MUTEX` at `:904`.
- Bucket 11 overlap: a panic *inside* the panic / crash handler under SA_RESETHAND can re-enter `PANIC_MUTEX.lock()`. Already enumerated in EXP-013 with the Bucket 18 (signal-safety) primary tag.
- **No change.** This is the single canonical panic-in-Drop-equivalent UB site.

### EXP-016 — NO_EVIDENCE (Drop-bypass on `MimallocArena` reset)
- Site enumeration: `phase5_experiment_results/EXP-016-astalloc-enumeration.log`, `phase5_experiment_results/EXP-016-astalloc-enumeration-tier2.log`, `phase5_experiment_results/EXP-016-needs-drop.log`, and `phase5_exp016_astalloc_drop_audit.md`.
- Bucket 11 relevance: arena-backed `Vec<T, AstAlloc>` skips per-element destructors on `MimallocArena::reset()`. That remains a valid design hazard if `T::drop` protects a memory-safety invariant.
- Current-source result: no such soundness-critical payload was found. The one concrete destructor-bearing payload from the compiler probe is `G::Property`, whose non-trivial drop comes from `TypeScript::Metadata::MDot(Vec<Ref>)`; skipping that destructor leaks the inner vector but does not create Rust UB. Keep EXP-066 as preventive hardening, not as closure of a proven current UB bug.

---

## Bucket-11 findings promoted to registry entries

Current-status overlay (registry is source of truth as of 2026-05-16):

| Phase-2 ID | Registry entry | Final verdict | Status correction |
|---|---|---|---|
| NF-1 | EXP-038 | NO_EVIDENCE | Hardening / regression guard for a hypothetical unwind-enabled profile; not current Bun production UB because configured profiles abort on panic. |
| NF-2 | EXP-039 | NO_EVIDENCE today | Source-faithful Miri witness double-drops `Handlers` only in an unwind-enabled model; Bun's configured profiles abort on panic, and only two sites have the allocation-prone window. |
| NF-5 | EXP-040 | NO_EVIDENCE | The witness proves the natural reclaim-on-unwind leak fix would trip UB unless guarded; current production code leaks the raw task instead of dropping half-initialized `http`. |

The original Phase-2 sweep used pre-registration labels for these rows. Those
placeholders have been superseded by EXP-038, EXP-039, and EXP-040.

### NF-1 (MEDIUM, panic-policy hardening): `AnyTaskJob<C>::run_task` under hypothetical unwind-enabled builds

- **Source:** `src/jsc/any_task_job.rs:141-153` (`run_task`), called via the WorkPool's C-style `fn(*mut WorkPoolTask)` callback slot wired at `:80-83`.
- **Shape:** `run_task` invokes `job.ctx.run(vm.global)` (line 147) followed by `enqueue_task_concurrent(…)` (line 151-152) with **no `catch_unwind` barrier**. Under a `panic = "unwind"` build, a panic in `C::run` would skip the enqueue and leak the job. Current Bun profiles are not that model: root `Cargo.toml` sets `panic = "abort"` for `[profile.dev]` and `[profile.release]`, and `src/bun_core/lib.rs:2701-2707` / `src/crash_handler/lib.rs:1797-1804` explicitly document that `catch_unwind` is unreachable because the panic hook aborts before unwinding.
- **Status:** **NO_EVIDENCE for current production UB.** No `catch_unwind` exists because the project-wide panic policy is abort-only. No SAFETY comment documents the panic contract on `AnyTaskJobCtx::run`; that is a documentation/hardening gap, not a current UB proof.
- **Registry entry:** **EXP-038**.
- **Final verdict:** **NO_EVIDENCE for current production UB**. The standalone witness is useful only as a regression guard for a future `panic = "unwind"` profile; current Bun dev/release/shim profiles use `panic = "abort"`, and Bun documents that the panic hook aborts before Rust unwinding starts.
- **Experiment design retained for regression testing:**
  - Bucket(s): 11 (panic safety) + 18 (FFI / cross-thread).
  - Falsifier for future unwind builds: instantiate a stub `AnyTaskJobCtx::run` that `panic!()`s under `panic = "unwind"` and assert the enqueue/leak behavior.
  - Remediation under current policy: document that panics in `AnyTaskJobCtx::run` are fatal. Do not recommend `catch_unwind` unless Bun deliberately enables unwinding for this path.
- **Origin:** pre-registration AnyTaskJob panic-policy regression guard, co-authored with Phase 1 K open-question #4.

---

### NF-2 (MEDIUM, unwind-regression guard): `Listener.rs` `ptr::read` → `mem::forget` window (2 live panic-prone sites)

- **Source:** `src/runtime/socket/Listener.rs:235, 317` — both `listen()` sites use:
  ```rust
  let handlers_moved: Handlers = unsafe { core::ptr::read(&socket_config.handlers) };
  let protos_taken   = socket_config.ssl.as_mut().and_then(|s| s.take_protos());
  let default_data   = socket_config.default_data;
  let ssl_cfg_taken  = socket_config.ssl.take();
  core::mem::forget(socket_config);
  ```
- **Shape:** Classic move-out-via-`ptr::read` + suppress-source-Drop. Under a `panic = "unwind"` build, any panic between line 1 (the `ptr::read`) and line 5 (the `mem::forget`) leaves `socket_config` un-forgotten. The compiler-inserted unwind then runs `Drop for SocketConfig`, which runs `Drop for Handlers` on bytes the `ptr::read` already moved into `handlers_moved` — **double-free / double-drop UB**.
- **Panic surface in the window:**
  - `take_protos()` → may allocate / `Vec::with_capacity` → AllocError on OOM if any code path uses `try_reserve` then `unwrap_or_oom`.
  - `ssl.take()` (line 4) — bitwise move; cannot panic on its own.
  - `socket_config.default_data` is a `Copy`/`JSValue` slot — cannot panic.
- **Scope correction (Codex 2026-05-16):** the earlier four-site claim overcounted. The connect-path sites at `src/runtime/socket/Listener.rs:1069` and `:1296` do `ptr::read`, then `Option::take()`, then `mem::forget`; their allocation-prone `take_protos()` calls occur later after the source has been forgotten. Keep them out of NF-2 unless a separate pre-`mem::forget` panic surface is proven.
- **Mitigation in place:** Bun's configured profiles are the mitigation for current production UB: `Cargo.toml` sets `panic = "abort"` for dev/release/release-derived/shim profiles, and the crash-handler comments document that panics abort before unwinding. The SAFETY comment at `:234` still does not discharge the unwind-model window.
- **Registry entry:** **EXP-039**.
- **Final verdict:** **NO_EVIDENCE for current production UB**. The Phase-5 source-faithful Miri witness mirrors the `ptr::read -> take_protos panic -> mem::forget` ordering and reports a dangling `Box` / double-drop in an unwind-enabled model. Under Bun's current `panic = "abort"` profiles, the witness is a regression guard, not a live production-UB count.
- **Experiment design:**
  - Bucket(s): 11 (panic safety) + 13 (refcount / Drop pairing).
  - Falsifier: inject a panic into `take_protos()` (e.g. via a fault-injected `Vec::try_reserve`) and assert Miri double-drop in `Drop for Handlers`.
  - Remediation if an unwind-enabled profile becomes supported: reshape to `scopeguard` (drop the half-moved state on unwind) **or** move `take_protos` before the `ptr::read(&handlers)`, so the only thing past the `ptr::read` is `mem::forget`.
- **Origin:** pre-registration Listener.rs ptr::read/forget panic-window candidate.

---

### NF-3 (MEDIUM, T0/leak only — promoted from Bucket 5 sighting): DevServer `init` Err-paths leak partially-initialized `MaybeUninit<DevServer>`

- **Source:** `src/runtime/bake/DevServer.rs:559-787` — the per-field `addr_of_mut!().write()` initialization sequence has **9 early-Err paths** (lines 687, 698, 746, 756, 766 inside `init_transpiler`; plus `FileSystem::init`, `Watcher::init`, three `framework.init_transpiler` calls, and the resolve call at `:831-843`). Each early return is taken with `dev_uninit: Box<MaybeUninit<DevServer>>` still holding partially-initialized bytes.
- **Shape:** `Box<MaybeUninit<DevServer>>::drop` is a no-op for the *fields* (MaybeUninit suppresses their Drop) but **frees the allocation**. So:
  - Fields that have already been written (`Box::from(options.root.as_bytes())`, the `IncrementalGraph::default()`s, the `WatcherAtomics::init(p)` at `:715`, the `init_transpiler`'d transpilers, etc.) are **leaked** because their `Drop` never runs.
  - This is **leak-not-UAF**: the freed `Box` returns the *outer* allocation to mimalloc, but the *contents* heap allocations (the `Box::from(...)` slice, the `Vec`s inside the graphs, the watcher's `bun_uv::Pipe` allocations) remain.
  - **No UB** — but high-magnitude leak on the unhappy path (a `DevServer` init failure during a `bun dev` startup leaks ~tens of KB of mimalloc, plus a registered watcher thread).
- **Mitigation in place:** none. The SAFETY comment at `:574-577` discharges per-field write correctness but is silent on the early-Err drop-order. The Zig source's `errdefer` chain is **not** mirrored.
- **EXP design:**
  - Bucket(s): 11 (panic safety, leak class) — no T1 UB candidate.
  - Falsifier: inject a `FileSystem::init` failure or a `framework.init_transpiler` failure, observe leak via `valgrind --leak-check=full bun dev` or via mimalloc's `mi_stats_print`.
  - Remediation: hoist the per-field writes that must run their Drop on Err into a `scopeguard::guard(dev_uninit, |partial| { /* drop initialized fields */ })`, **or** reshape `init()` into the standard "build subfields fully, then move into final `Box`" idiom (deferring the `MaybeUninit` until everything else has been built).
- **Recommendation:** **NOT a new EXP** (no UB). File a Phase-7 bead for the leak class.

---

### NF-4 (MEDIUM, T0/leak only — promoted): `filter_arg.rs:313-341` `init_walker` partial-init leak

- **Source:** `src/runtime/cli/filter_arg.rs:313-342` (`init_walker`), pairing with `Drop for PackageFilterIterator` at `:380-386` (`if self.valid { self.deinit_walker(); }`).
- **Shape:** `init_walker` writes `self.walker` at line 331 then calls `glob::walk::Iterator::new(walker_ref)` at line 338 and `iter.init()??` at line 340. **The `self.valid = true` flag is set by the caller `next()` at `:361` AFTER `init_walker` returns.** Any panic *inside* `init_walker` after the `self.walker.write(walker)` at line 331 — e.g. inside `Iterator::new` or `init()??` — leaves `self.walker` initialized but `self.valid == false`, so `Drop` skips `deinit_walker` and the walker (which holds an `ArenaAllocator` and the bun_glob state machine) **leaks**.
- **Mitigation in place:** The `Drop` impl deliberately gates on `self.valid` to avoid double-deinit, which is correct, but the validity gate is too coarse: there's no per-field initialization tracking.
- **EXP design:**
  - Bucket(s): 11 (panic safety, leak class). No T1 UB candidate.
  - Falsifier: inject a panic via a custom `glob_ignore_fn` that panics; assert walker leak with Miri's `-Zmiri-track-alloc-id`.
  - Remediation: set `self.valid = true` *between* the `self.walker.write(walker)` and the `glob::walk::Iterator::new(walker_ref)`, so the partial-init covers both deinits. Or use a `scopeguard` on the walker write that does `self.walker.assume_init_drop()` on unwind.
- **Recommendation:** **NOT a new EXP** (no UB). Phase-7 bead.

---

### NF-5 (MEDIUM, hardening / future trip-hazard): `s3/simple_request.rs` `task.http` half-init leak on mid-init panic

- **Source:** `src/runtime/webcore/s3/simple_request.rs:476-495` (`Drop for S3HttpSimpleTask`) and `:599-670` (`execute_simple_s3_request`).
- **Shape:** `execute_simple_s3_request` calls `S3HttpSimpleTask::new(...)` at line 599-613 with `http: MaybeUninit::uninit()`. The task immediately escapes as a raw pointer via `bun_core::heap::into_raw(Box::new(init))`. After that escape and before the `MaybeUninit::write` side effect completes, the code:
  - Calls `task.poll_ref.ref_(...)` (line 616) — can `expect` / panic on bad ctx.
  - Calls `URL::parse(...)` twice (lines 631, 643) — `URL::parse` is total in `bun_jsc::URL` (returns `Option`) so no panic.
  - Calls `task.headers.entries.clone().expect("OOM")` (line 655) while evaluating the arguments to the line-652 `task.http.write(AsyncHTTP::init(...))` call — **explicit `.expect("OOM")` panic site**.
  - Only writes `task.http` after `AsyncHTTP::init(...)` returns and `MaybeUninit::write` is actually invoked by the method call.
- **The hole:** if **any** of those panics fires before `MaybeUninit::write` stores the initialized `AsyncHTTP`, the raw task is leaked and `poll_ref.ref_` has already run, leaking a JS-event-loop keep-alive. `Drop` would be unsound in that half-init state because it calls `unsafe { self.http.assume_init_mut() }.clear_data()` (line 494) unconditionally, but current production unwinding does **not** run `Drop` because the owning `Box` was consumed by `into_raw`.
- **However:** because `bun_core::heap::into_raw(Box::new(...))` *consumes* the Box and returns a raw pointer, **the unwind path does NOT drop the task** — the Box was already leaked by the `into_raw` call. So in the panic-window scenario:
  - `Drop` does **not** run (raw pointer, no owner).
  - The task **leaks** but no UB is materialised on the panic-window path.
  - The `Drop` UB is reached only if a future code path reclaims the task via `heap::take` and the task is in the half-init state — currently the only reclaim is via `http_callback` (line 442+) which is only invoked after `http.schedule(...)` (line 675), past the danger window.
- **Net:** **leak-on-panic, no UB today**, but the Drop preamble's "always initialised" claim is a **trip-hazard** for any future code path that reclaims the task earlier.
- **Mitigation recommendation:** add an `initialized: bool` to `S3HttpSimpleTask` (or move `http` into an `Option<AsyncHTTP>`), and have `Drop` skip `clear_data()` when not initialized. Defends against future refactors.
- **Registry entry:** **EXP-040**.
- **Final verdict:** **NO_EVIDENCE for current production UB**. The Miri witness proves the post-leak-fix trip hazard: if a natural reclaim-on-unwind scopeguard is added, `Drop` will touch uninitialized `http`. Current production code has already consumed the `Box` with `heap::into_raw`, so unwinding leaks the task instead of running `Drop`.
- **Experiment design retained for hardening:**
  - Bucket(s): 11 (panic safety, leak today, UB on future reclaim).
  - Falsifier: insert a `scopeguard::guard(task_ptr, ...)` that triggers Drop on the panic path, then panic at line 655 before the `MaybeUninit::write` side effect — Miri witnesses `assume_init_mut` UB.
  - Status today: **NO_EVIDENCE for current production UB**. Will become **T1 unconditional** the first time someone wires an early reclaim path.
- **Origin:** pre-registration S3HttpSimpleTask Drop trip-hazard candidate, retained as a regression guard / pre-fix proof.

---

### NF-6 (LOW, T0/leak only — promoted): Windows spawn-failure `WindowsSpawnOptions` panic-window leak

- **Source:** `src/runtime/shell/subproc.rs:703-744`, `src/runtime/api/bun/js_bun_spawn_bindings.rs:1118-1162`, and `src/spawn/process.rs:1703-1745`.
- **Shape:** `WindowsSpawnOptions` deliberately has **no `Drop`** (per the `// no Drop` comment at `src/spawn/process.rs:1703-1705`). Callers MUST call `spawn_options.deinit()` (or per-Stdio `.deinit()`) on every error path. Each known call site at `subproc.rs` and `js_bun_spawn_bindings.rs` correctly does so.
- **The hole:** if a panic lands between `WindowsSpawnOptions` construction (via `as_spawn_option`, somewhere around `subproc.rs:660-700` / `js_bun_spawn_bindings.rs:1100-1117`) and the `spawn_options.deinit()` call on the Err branch, the `uv::Pipe` handles `as_spawn_option` registered with the spawn-sync loop **leak**. Worse — per the comment at `js_bun_spawn_bindings.rs:1123-1125`, the leak trips `assert(err == 0)` in `uv_loop_delete` at `SpawnSyncEventLoop::Drop` — converting a leak into an **assertion abort** in libuv (still not UB, but visible).
- **Why "no Drop" was chosen:** `WindowsSpawnOptions` is passed by `&` to `spawn_process_windows`, which mutates the Stdio's `*mut uv::Pipe` fields (transferring ownership). A blanket `Drop` would double-close on the happy path; hence the manual discipline.
- **Remediation options:**
  - Add a `Drop` that consults an `initialized: bool` (or per-field "owner" flag) so post-spawn pipes are not closed twice.
  - Switch to a `scopeguard`-style `defer_on_err` at every construction site.
  - Document explicitly that *no* panicking call (incl. `String::from_utf8(...).expect`) may live between `as_spawn_option` and the Err deinit on Windows.
- **EXP design:** **NOT a new EXP** (no UB). Phase-7 bead.

---

### NF-7 (INFO, no action): NapiFinalizerTask cross-thread `napi_env` lifetime

- **Source:** `src/runtime/napi/napi_body.rs:4292-4352` (NapiFinalizerTask), `:2388-2429` (Finalizer), `:222` (`NapiEnvRef = bun_ptr::ExternalShared<NapiEnv>`).
- **Verdict:** **CLEAN.** `NapiEnvRef` is a `bun_ptr::ExternalShared<NapiEnv>` — the C++-side refcount keeps `NapiEnv` alive as long as any outstanding `NapiFinalizerTask` holds a `Finalizer { env: NapiEnvRef, .. }`. The queued task therefore **cannot** observe a freed `napi_env`; the worst case is the task runs after the JS code that nominally owns the env has been GC'd, which is the documented model.
- **Open caveat (Phase-1 J Q4 unresolved):** `schedule()` at `:4321-4326` has a TODO for the non-main-thread path during VM shutdown:
  > `do we need to handle the case where the vm is shutting down?`
  If `enqueue_task_concurrent` succeeds during shutdown but the event loop never drains the queue, the task (and its `NapiEnvRef`) leaks; the env refcount is held forever. **Leak-only, not UB.**
- **Bucket 11 status:** Section J's Phase-1 owed verification is **DISCHARGED** — the queued task cannot observe a freed env. The shutdown-leak TODO is documented but does not warrant a new EXP.

---

### NF-8 (LOW, observational): `Drop` impls that take a lock or do I/O

Cross-bucket sweep for blocking I/O / lock acquisition inside `Drop` (the
"Drop should not block / panic" hygiene rule):

| Site | Pattern | Severity |
|---|---|---|
| `src/jsc/SavedSourceMap.rs:258-281` (`Drop for SavedSourceMap`) | `self.lock()` + iterate values + per-value FFI deref | Internal lock (`bun_threading::Guarded`) — held only for the iteration; no I/O. **OK.** |
| `src/runtime/bake/DevServer.rs:1072-1178` (`Drop for DevServer`) | snapshot WebSocket keys (line 1090-1098), then `websocket.close()` per key — synchronously dispatches `HmrSocket.onClose` which mutates the map | **MITIGATED upfront** (snapshot taken before iteration, per Phase 1 G's finding). The "synchronous WS-close cascade" is bounded and the SAFETY comment at `:1086-1097` discharges it. **OK.** |
| `src/http/HTTPContext.rs:1054-1106` (`Drop for HTTPContext<SSL>`) | `.at(u16::try_from(idx).expect("int cast"))` at line 1066 | `.expect()` inside Drop → panic during Drop → either abort (if outer frame is unwinding) or double-panic. **LOW**: triggered only if `idx > u16::MAX`, which for the `pending_sockets` pool is bounded by HiveArray capacity (well under 65535). **OK in practice.** |
| `src/runtime/bake/DevServer.rs:1117-1118` | `ManuallyDrop::take(&mut self.bun_watcher)` + `Watcher::shutdown(..., true)` — hands ownership to watcher thread | **Documented; aligned with Phase 1 P open question on Windows watcher Box hand-off race (DevServer.rs:1117-1118 in `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md:835`).** Watcher thread Drop is the canonical exit. **OK.** |
| Various `Drop`s calling `expect("…")` on infallible-in-practice paths | `bit_set.rs:1383`, `libarchive/lib.rs:571`, `MySQLRequestQueue.rs:355`, others | Pure `.expect()` on infallible invariants; cannot panic in practice. **OK.** |

**Bucket 11 status:** no new finds. Existing Drop hygiene is acceptable.

---

## Summary

| ID | Severity | Type | New EXP? |
|---|---|---|---|
| NF-1 | MEDIUM (panic-policy hardening) | `AnyTaskJob` unwind witness applies only if panic=unwind is enabled | **EXP-038 — NO_EVIDENCE today** |
| NF-2 | MEDIUM (unwind-regression guard) | `ptr::read`/`mem::forget` panic-window in `Listener.rs` (×2 live panic-prone sites) | **EXP-039 — NO_EVIDENCE today** |
| NF-3 | MEDIUM (leak only) | DevServer `init` early-Err MaybeUninit field leak | bead, no EXP |
| NF-4 | MEDIUM (leak only) | `filter_arg.rs` `init_walker` partial-init leak | bead, no EXP |
| NF-5 | MEDIUM (hardening / future trip-hazard) | `S3HttpSimpleTask::Drop` `assume_init_mut` trip-hazard if reclaim-on-unwind is added | **EXP-040 — NO_EVIDENCE today** |
| NF-6 | LOW (leak only) | `WindowsSpawnOptions` panic-window leak | bead, no EXP |
| NF-7 | INFO | NapiFinalizerTask env lifetime — clean | none |
| NF-8 | INFO | Drop-lock/IO hygiene sweep — clean | none |

**Three Bucket-11 EXPs were registered and resolved**:
EXP-038 demoted the unwind-only `AnyTaskJob` hypothesis to `NO_EVIDENCE` for
current production profiles, EXP-039 was likewise demoted to a panic-policy
regression guard after the profile check and two-site source correction, and
EXP-040 demoted `S3HttpSimpleTask` to a future-reclaim hardening guard rather
than current production UB.

**Three Phase-7 remediation beads** (NF-3, NF-4, NF-6) — leak-only, no UB
today, but each is a one-future-refactor-away footgun. File against the
bun unsafe-exorcist project per the user's no-push-without-auth policy
(beads stay local).

**Bucket 13's net audit ("53 `mem::forget` sites, all paired — no orphans")
remains accurate** — none of the new finds are orphans; they are
panic-window correctness gaps on otherwise-paired transfers.
