# Codex Syn-Walker Round 115 Refresh — 2026-05-16

**Purpose:** rerun the UB skill's `syn` walkers after the EXP-106 promotion and
record detector status without inflating the registry.

**Raw outputs:** `phase2_raw/codex_syn_*_round115_2026-05-16.{stdout,stderr}`.

## Results

| Walker | Exit | Output | Triage |
|---|---:|---:|---|
| `aliasing` | 2 | 0 stdout lines | Scaffolded walker (`TODO: implement aliasing walker`). Not a detector result. |
| `validity` | 2 | 0 stdout lines | Scaffolded walker. Not a detector result. |
| `transmute_pairs` | 0 | 24 stdout rows | Useful inventory; maps to existing EXPs / reviewed FFI casts. No new EXP. |
| `data_races` | 1 | 155 stdout rows | Unsafe-impl synchronization warning list. Maps to existing Send/Sync bucket owners; not 155 bugs. |
| `pin` | 101 | 0 stdout lines | No `pin` bin in the current build target set; no result. |
| `escape` | 0 | 0 stdout rows | Clean for this walker. |
| `safety_doc_coverage` | 1 | 2,565 stdout rows | Documentation coverage inventory: missing/weak `SAFETY` comments and unsafe-fn docs. This is auditability debt, not UB evidence. |

## Transmute-Pair Inventory Mapping

The 24 transmute pairs are already owned by existing findings or reviewed
hardening queues:

- **Confirmed sparse-enum validity:** `errno/linux_errno.rs:192` (EXP-002),
  `errno/lib.rs:310` and `errno/windows_errno.rs:254` (EXP-097),
  `scanImportsAndExports.rs:1682` (`PropertyIdTag`, prior C-002 cluster).
- **Confirmed / deferred lifetime-erasure rows:** `css_parser.rs:2718/2723`
  (EXP-077), `bun_alloc/lib.rs:560` (EXP-059), `bundler/transpiler.rs:308`
  / `resolver/lib.rs:4260` (documented lifetime-widening proof obligations).
- **Reviewed FFI function-pointer / ABI casts:** BoringSSL stack callbacks,
  libuv close / callback adapters, c-ares `i32 -> Error`, WIC conversion
  function, FFI typed-array deallocator, perf tracing callbacks, and syscall
  layout cast. These remain hardening / SAFETY-comment targets unless a
  mismatched ABI or invalid-discriminant proof exists.

No transmute-pair row is currently orphaned.

## Data-Races / Send-Sync Walker Mapping

The 155-row `data_races` output is a conservative sweep over unsafe impls. It
correctly re-flags the already-owned problem classes:

- `StoreSlice<T>` unbounded `Send`/`Sync` (EXP-019).
- `AtomicCell<T>` / `ThreadCell<T>` generic contract (EXP-098 and EXP-047
  correction).
- `RacyCell<T>` / Windows shim `RacyCell<T>` hardening rows.
- JSC / Blob / VM / shell IO auto-trait rows (EXP-082/083/084).

Many remaining rows are deliberately documented marker impls, allocator/FFI
handles, or thread-affine wrappers. They need per-site safety-comment review,
but the walker output alone is not a UB proof.

## Safety-Doc Coverage

The 2,565-row safety-doc output is useful for a separate documentation-quality
campaign:

- Missing `# Safety` sections on `unsafe fn`.
- Unsafe blocks with no preceding `// SAFETY:` comment.
- Weak comments such as "caller contract" / "forwarded" that do not name the
  invariant.

This should not enter the UB count. It belongs in a hardening queue or
unsafe-exorcist-style SAFETY-comment pass.

## Verdict

No new EXP entry from this syn-walker refresh.

The refresh improves defensibility by documenting which bundled walkers are
scaffolded, which produce useful inventories, and which outputs are
auditability debt rather than UB evidence.
