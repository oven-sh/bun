# Section S: sql-redis-payments

This note exists because the initial Section S mapper wrote a combined
inventory/notes file but did not create the Phase-1 contract's separate
`phase1_notes/S_*.md` artifact.

## Summary

Section S covers `src/sql`, `src/sql_jsc`, `src/valkey`, `src/patch`,
`src/patch_jsc`, `src/codegen`, `src/s3_signing`, `src/csrf`, and
`src/sha_hmac`.

The mapper's central conclusions are mostly sound:

- Crypto remains boring in the right way: `bun_csrf` has no unsafe; HMAC and
  PBKDF2 paths go through BoringSSL; key material zeroing is explicit.
- `bun_sql_jsc` dominates the section's unsafe surface, mostly through JSC
  bridge hooks, speculative refcount undo, BoringSSL cleanup, and tagged-union
  reads.
- `SQLDataCell.rs` `Box::<[u8]>::from_raw` reconstruction is not currently a
  UB finding. Bytea and Postgres TypedArray producer traces layout-match their
  destructors; the source TODOs are stale/misleading rather than evidence of a
  live allocator-layout defect.

## Codex correction

The mapper's original `EXP-001 does not apply in Section S` statement was too
strong. The reason given was that the two SQL request queues store raw pointers
(`*mut PostgresSQLQuery`, `*mut JSMySQLQuery`), which have no niche.

That misses the broader EXP-001 invariant already recorded in Section O/J:
`DynamicBuffer<T>::as_slice()` exposes the whole `Box<[MaybeUninit<T>]>` as
`&[T]`, including uninitialized slots. Niche-bearing element types produce the
cleanest Miri signal, but uninitialized memory is not a valid initialized raw
pointer value either. Section S should therefore be phrased as:

- SQL queues are **lower-signal EXP-001 users**, not a refutation.
- Current queue control flow may avoid observing uninitialized slots, so a
  Section-S-specific raw-pointer Miri witness is a Phase-2 refinement item.
- The global fix belongs in `bun_collections::linear_fifo`, not in SQL.

## Phase-2 priorities

1. Add a hook-table initialization invariant note for `SqlRuntimeHooks` so
   call sites are not treated as independently null-safe.
2. Optional: raw-pointer `LinearFifo` Miri witness for the SQL queue paths
   after the global EXP-001 remediation plan is drafted.
