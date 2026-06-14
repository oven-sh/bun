# Codex Review — Phase 1 Sections A/O

Date: 2026-05-15
Branch: `claude/ub-exorcist-audit`
Base: `origin/main` `4d443e5402`

## Section A: runtime-webcore

Verdict: acceptable as a **prior-seeded** inventory, not as a final current-source
enumeration.

Checks performed:

- `phase1_inventory_A.md` has 604 table rows.
- All 604 `file:line` locations exist on current `origin/main`.
- All 604 rows have an unsafe/UB-relevant source token within five lines of the
  listed location.
- The anchored `EXP-004` witness at `src/runtime/webcore/encoding.rs:303` still
  matches the prior shape: `Vec<u8>` is put behind `ManuallyDrop` and rebuilt as
  `Vec<u16>` via `Vec::from_raw_parts`.

Correction applied:

- Added a header note saying this is prior-seeded/current-line-sanity-checked
  and still needs Phase 2 current-source normalization before final counts are
  treated as exact.

## Section O: alloc-and-collections

Verdict: current-source analytical inventory is useful, but its count wording
needed tightening.

Checks performed:

- 48 cited source ranges were spot-validated; all files and line ranges exist.
- The only validator miss was `src/collections/vec_ext.rs:267-294`, a safe
  function whose unsafe block appears inside the cited range. That is not an
  artifact bug.
- `src/collections/linear_fifo.rs:68-70` and `:77-79` are still present and
  still match the `EXP-001` niche/read-uninit shape.
- An independent current-source scan sees 467 non-comment lines containing
  `unsafe` in `src/bun_alloc/` + `src/collections/`, while the Section O mapper
  reports 457 heuristic "unsafe keyword sites". This is a counting-definition
  mismatch, not evidence that the section's substantive findings are wrong.

Corrections applied:

- Reworded the Section O tallies as "mapper tallies".
- Added a note that `457` is a mapper-local workload count, not a final exact
  headline, and that Phase 2 normalization must re-id current-source rows.

## Phase 0 Followups

Corrections applied while reviewing Phase 1:

- `phase0_run.json` no longer calls the bundler parallel-callback cluster
  "confirmed under SB/TB" at Phase 0 time. Later Phase-5/11 evidence promoted
  it to EXP-010 / `CONFIRMED_UB`; the Phase-0 metadata now points at that
  later verdict instead of preserving the old "pending" wording.
- `phase0_partition.json` now explains that per-section counts are approximate
  mapper weights. They sum to 11046 while the prior-audit headline is 11044.
- `phase0_preflight.md` no longer recommends the stale
  `-Zmiri-check-number-validity` flag, which this nightly rejects.
