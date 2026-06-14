# Codex PE Alignment Follow-Up — 2026-05-16

Scope: targeted follow-up while cleaning stale `EXP-022` references in the
Phase-2 Bucket-3 alignment sweep.

## Trigger

`phase2_findings_03_alignment.md` still said the PE header cluster should get a
pending `EXP-022` witness, but the final registry intentionally leaves
`EXP-022..EXP-025` unused after earlier concurrent renumbering. That was more
than an ID typo: the PE cluster was still a real source TODO and had not been
carried into the source-of-truth registry.

## Source Shape

Current `src/exe_format/pe.rs` documents the problem directly:

- `pe.rs:203-206`: "Zig used `*align(1) const T`; Rust references require
  alignment."
- `pe.rs:281-302`: `get_section_headers` / `_mut` cast byte offsets from a
  `Vec<u8>` to `*const SectionHeader` / `*mut SectionHeader`, then construct
  `&[SectionHeader]` / `&mut [SectionHeader]`.
- `pe.rs:315-334`: `view_at_const::<DOSHeader>` and `view_at_mut::<PEHeader>`
  return raw pointers that are immediately materialised as references.
- `pe.rs:389-396`: `init` repeats the `SectionHeader` typed-slice construction.
- `pe.rs:900-920`: `utils::is_pe` materialises `&DOSHeader` and `&PEHeader`
  from a caller-provided byte slice.

The code bounds-checks offsets, but it does not check `off % align_of::<T>()`.
PE metadata controls `e_lfanew` and the optional-header size, so hostile or
tampered PE bytes can produce an odd section-header offset.

## Experiment

Added `experiments/EXP-093`, a minimal Miri witness mirroring the production
shape:

```text
Vec<u8> storage
  -> odd section_headers_offset
  -> cast::<SectionHeader>()
  -> slice::from_raw_parts(ptr, 1)
```

Invocation:

```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-093
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-093.log
```

Miri signal:

```text
constructing invalid value of type &[SectionHeader]:
encountered an unaligned reference (required 4 byte alignment but found 1)
```

## Artifact Changes

- Added registry entry `EXP-093` with verdict `CONFIRMED_UB`.
- Added `experiments/EXP-093` and `phase5_experiment_results/EXP-093.log`.
- Promoted the old PE `EXP-022` alignment candidate to canonical `EXP-093`.
- Updated `phase2_findings_03_alignment.md`, `phase4_unified_findings.md`,
  `phase8_remediation_plan.md`, `UB_RUNBOOK.md`, and `FINAL_UB_REPORT.md`.
- Checkpoint totals became 89 registry experiments / 58 `CONFIRMED_UB` at the
  time of this PE-only follow-up. Later EXP-094/EXP-095 promotions and the
  subsequent EXP-109/110/111 normalization supersede those run-wide totals;
  use `FINAL_UB_REPORT.md` for the current pinned-base count.

## Remediation

Preferred fix: parse/write PE headers by value using `ptr::read_unaligned` /
`ptr::write_unaligned` or explicit byte-copy helpers. Emergency alternative:
reject unaligned offsets before any typed reference is materialised. Avoid
`#[repr(C, packed)]` unless every field access is routed through `addr_of!`;
that option is easier to regress.
