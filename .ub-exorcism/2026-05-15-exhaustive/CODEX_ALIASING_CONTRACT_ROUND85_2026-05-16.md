# Codex Aliasing-Contract Round 85 — 2026-05-16

**Purpose:** cover the intended gap of the skill's `aliasing` and `validity`
syn walkers after discovering that both binaries are still scaffolds.

## Tool Results

The implemented `syn-walkers` directory contains `aliasing` and `validity`
binaries, but both currently exit with a scaffold message:

```text
TODO: implement aliasing walker
TODO: implement validity walker
```

Raw outputs retained:

- `phase2_raw/codex_syn_aliasing_round85_2026-05-16.stderr`
- `phase2_raw/codex_syn_validity_round85_2026-05-16.stderr`

Because those two walkers do not yet inspect source, Codex ran a manual
aliasing-contract sweep instead.

## Manual Sweep

Raw output:

- `phase2_raw/codex_manual_aliasing_contract_sweep_round85_2026-05-16.log`

Query class:

- safe functions taking `&self` and returning `&mut`, `&'a mut`, or
  `&'static mut`
- `core::ptr::from_ref(...).cast_mut()`
- `addr_of!(...).cast_mut()`

The sweep found **128 textual hits**. This is a candidate set, not 128 bugs.

## Triage

The high-signal hits map to existing registry owners:

| Hit family | Existing owner | Current verdict |
|---|---|---|
| caller-chosen `fn(&self) -> &'a mut T` helpers in install/http/sql/JSC | F-L-1 / EXP-057 | `CONFIRMED_UB` shape-level |
| `ThreadPool::get_worker(&self, id) -> &'static mut Worker` | F-L-6 / EXP-087 | `CONFIRMED_UB` |
| `Transpiler::env_mut(&self) -> &'a mut Loader<'a>` | F-L-7 / EXP-079 | `CONFIRMED_UB` |
| `VirtualMachine::{as_mut,event_loop_mut,event_loop_ref,uws_loop_mut}` | F-S-14 / EXP-084 | `CONFIRMED_UB` safe off-thread trap |
| `IOWriter` / `IOReader` safe state mutators | F-S-12 / EXP-083 | `CONFIRMED_UB` generic safe-API contract |
| `StoreRef` / `StoreSlice` caller-chosen-lifetime constructors | EXP-021 / EXP-019 | `CONFIRMED_UB` |
| `WebSocketServerContext` and sibling `addr_of!.cast_mut()` counters | F-A14-A / EXP-041 | `CONFIRMED_UB` |
| `NodeHTTPResponse` shared-provenance deallocation family | F-NHR-1 / EXP-056 | `CONFIRMED_UB` |
| `Body` / `Request` / `Response` `&self -> &mut` JSC-hive helpers | `CODEX_MUT_FROM_REF_SWEEP_2026-05-16.md` queue | remediation/lint queue, not a new count |
| `MimallocArena::{alloc, alloc_slice_*}` and parser arena allocation helpers | arena interior-mutability discipline | not a new EXP without a duplicate-live-`&mut` witness |

## Verdict

No new EXP was added in round 85.

This sweep strengthens the existing story rather than changing the count:
the Bun Rust port has a broad R-2 pattern where shared receivers are used as a
porting convenience for Zig-style mutation. The existing registry already
owns the severe public/safe cases; the remaining hits should become a lint
exception list with explicit owner discipline, not a pile of duplicate EXPs.

## Follow-Up

1. Implement the scaffolded `aliasing` walker so this manual query becomes a
   repeatable tool result.
2. Add a deny-by-default workspace lint for safe `&self -> &mut` APIs.
3. Require exceptions to be one of:
   - `unsafe fn`
   - guard/closure-scoped return
   - private receiver plus inline invariant naming the unique caller discipline
   - explicit link to the owning EXP or remediation row
