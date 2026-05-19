# Codex Review — Phase 1 Sections S/T

## Section S

**Correction applied:** the original Section S inventory said EXP-001 does not
apply because SQL queues store raw pointers and raw pointers have no niche.
That is conceptually wrong under the corrected EXP-001 framing.

Source facts:

- `src/collections/linear_fifo.rs:167-172` exposes `DynamicBuffer<T>`'s full
  `Box<[MaybeUninit<T>]>` backing storage as `&[T]` / `&mut [T]`.
- `src/sql_jsc/postgres/PostgresRequest.rs:500-502` uses
  `LinearFifo<*mut PostgresSQLQuery, DynamicBuffer<_>>`.
- `src/sql_jsc/mysql/MySQLRequestQueue.rs:20` uses
  `LinearFifo<*mut JSMySQLQuery, DynamicBuffer<_>>`.

Raw pointers do not have invalid discriminants, so they are not the best Miri
witness, but uninitialized memory is still not an initialized `*mut T`.
Section S is a lower-signal user of the global LinearFifo defect, not a proof
that EXP-001 is irrelevant.

I added `phase1_notes/S_sql_redis_payments.md` because the section was missing
its separate Phase-1 notes artifact.

**Additional correction applied:** the initial Section S notes left
`SQLDataCell` Bytea/TypedArray `Box::<[u8]>::from_raw` as the highest-value
open layout target. Current-source tracing does not support that escalation:

- `src/sql_jsc/postgres/DataCell.rs:30-47` `parse_bytea()` allocates exactly
  `hex.len()/2` bytes and records the same decoded count; invalid hex errors
  before ownership transfer, and binary bytea is borrowed (`free_value=0`).
- `src/sql_jsc/postgres/DataCell.rs:822-851` typed-array parsing allocates
  `out_bytes`, records `byte_len = out_bytes`, and sets `free_value = 1`;
  `src/sql_jsc/shared/SQLDataCell.rs:254-258` frees with `byte_len`.

The source TODOs are stale/misleading, but these paths are not current UB
findings.

## Section T

Initial read only. No source patch yet. Operational issue: Claude produced
`phase1_notes/T_ffi_c_libs.md` but no `phase1_inventory_T.md`, while the Phase
1 contract expects both. That needs either a real inventory file or an explicit
note that the T note is serving as a combined inventory/notes artifact.

**Correction applied:** added `phase1_inventory_T.md` as a shim inventory that
points to the combined T note and records the reviewed verdict shape.
