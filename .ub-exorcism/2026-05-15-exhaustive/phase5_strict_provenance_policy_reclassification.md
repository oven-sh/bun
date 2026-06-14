# Strict-Provenance EXP Reclassification

Date: 2026-05-16

## Verdict

EXP-020, EXP-029, EXP-048, EXP-049, EXP-050, and EXP-096 are **DEFERRED
strict-provenance release-gate failures**, not `NEEDS_REFINEMENT` production-UB
claims.

The executable witnesses are real: each fails under
`MIRIFLAGS="-Zmiri-strict-provenance"`. The important correction is verdict
discipline. The existing artifacts already say these entries are not
default-Miri/runtime UB and should not be marketed as production crashes. A
`NEEDS_REFINEMENT` verdict implies a missing production-shaped proof; that is
the wrong status for this class. The missing decision is policy, not evidence:
whether Bun wants strict provenance as a release gate.

## Affected EXPs

| EXP | Site | Evidence | Correct status |
|-----|------|----------|----------------|
| EXP-020 | `src/url/lib.rs:340-351` | strict-provenance Miri failure | `DEFERRED` |
| EXP-029 | `src/runtime/shell/EnvStr.rs:188-200` | strict-provenance Miri failure | `DEFERRED` |
| EXP-048 | `src/ptr/tagged_pointer.rs:53-64` | strict-provenance Miri failure; central fix point | `DEFERRED` |
| EXP-049 | `src/bun_core/string/immutable.rs:1076` (`StringOrTinyString`) | strict-provenance Miri failure; separate representation rewrite | `DEFERRED` |
| EXP-050 | `src/bun_alloc/lib.rs:925-946` | strict-provenance Miri failure; JSC ABI representation rewrite | `DEFERRED` |
| EXP-096 | `src/bun_core/string/SmolStr.rs:56-91, 115-124, 156-164` | strict-provenance Miri failure; separate exported-string representation rewrite | `DEFERRED` |

## Re-Check Criteria

Reopen these as active remediation work when any of these happens:

- Bun decides to require `-Zmiri-strict-provenance` in CI.
- The Rust memory model / Miri defaults make the stricter provenance rule a
  default-runtime constraint.
- A touching PR modifies `TaggedPtr`, `EnvStr`, `StringOrTinyString`, `SmolStr`, `ZigString`, URL
  slicing, or a packed-pointer ABI and can preserve provenance cheaply.

Until then, these are tracked as a migration plan:

- `TaggedPtr` (`EXP-048`) is the central low-friction fix.
- `StringOrTinyString` (`EXP-049`), `ZigString` (`EXP-050`), and
  `SmolStr` (`EXP-096`) need separate representation rewrites.
- `URL::host_with_path` (`EXP-020`) and `EnvStr` (`EXP-029`) should use
  provenance-carrying pointer arithmetic or a representation that keeps pointer
  identity separate from integer metadata.

## Artifact Rule

Do not count these five entries as current production UB. Do not call them
`NEEDS_REFINEMENT`. Count them as `DEFERRED` with explicit strict-provenance
re-check criteria.
