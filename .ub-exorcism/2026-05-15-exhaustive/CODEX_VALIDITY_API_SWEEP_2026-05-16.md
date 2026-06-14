# Codex Validity-API Sweep — 2026-05-16

Scope: follow-up application of `/rust-undefined-behavior-exorcist` to validity-bearing APIs after the registry had already converged. This pass looked for missed `str` validity, fat-pointer reinterpretation, `MaybeUninit`/`set_len`, and raw slice construction issues, then promoted only one genuinely missed safe-API UB contract: EXP-085. The registry was linted and reconverged at round 48 after the promotion; later follow-ups continued through EXP-092 / round 56. Use `FINAL_UB_REPORT.md` for live totals.

## Raw Queries

Representative searches:

```bash
rg -n 'MaybeUninit|assume_init|assume_init_read|assume_init_ref|assume_init_mut|mem::zeroed|mem::uninitialized|set_len\(|from_raw_parts|from_raw_parts_mut|read_unaligned|read_volatile|write_volatile|unreachable_unchecked|unwrap_unchecked|get_unchecked|from_utf8_unchecked|from_utf16_unchecked|NonNull::new_unchecked|slice::from_raw_parts|str::from_utf8_unchecked' src --glob '*.rs'
rg -n 'from_utf8_unchecked|from_utf16_unchecked' src --glob '*.rs'
rg -n 'cast::<&' src --glob '*.rs'
```

The first query returns a large candidate set because Bun is intentionally heavy on raw FFI and Zig-port primitives. This artifact records only the deltas after cross-checking against existing Phase-2/Phase-4 findings.

## Already Covered Correctly

- `MaybeUninit` / `set_len` / uninit-storage hazards are already covered by `phase2_findings_05_uninit.md`, EXP-001, EXP-005, EXP-033, EXP-034, EXP-072, and EXP-078.
- Closed sparse-enum / bool validity hazards are already covered by `phase2_findings_04_validity.md`, EXP-002/003/005/006/007/035/036/037, plus the `NEW-V-4` `unreachable_unchecked` watchlist.
- `mem::zeroed::<T>` remains clean: the Phase-2 table's eight live materialisation sites are POD / Zeroable-gated. Spot-checks of `runtime/test_runner/harness/recover.rs` and wrapper APIs did not contradict `F-CLEAN-mem-zeroed`.
- Strict-provenance-only pointer-packing failures remain correctly `DEFERRED` (EXP-020 / EXP-029 / EXP-048 / EXP-049 / EXP-050, later joined by EXP-096 for the separate `SmolStr` representation). This sweep did not promote them to default-runtime UB.

## New Confirmed Finding: EXP-085

The prior unsafe audit correctly had P3-BC-001 for `bun_core::fmt::Raw`, but the UB registry did not contain it. Current source still has:

```rust
#[repr(transparent)]
pub struct Raw<'a>(pub &'a [u8]);
impl fmt::Display for Raw<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        f.write_str(unsafe { core::str::from_utf8_unchecked(self.0) })
    }
}
```

This is not merely an unsafe-block hygiene issue. It is a safe API contract defect: safe callers can pass non-UTF-8 bytes through `fmt::s` / `fmt::raw`, and the `Display` impl constructs an invalid `&str`.

I added:

- `experiments/EXP-085/`
- `phase5_experiment_results/EXP-085.log`
- `EXP-085` in `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`
- `NEW-V-5` in `phase4_unified_findings.md`
- `R-EXP-085` in `phase8_remediation_plan.md`
- `EXP-085` runbook entries in `UB_RUNBOOK.md`

Miri signal:

```text
error: Undefined Behavior: entering unreachable code
  --> .../library/core/src/str/validations.rs:48:23
   |
48 |     let y = unsafe { *bytes.next().unwrap_unchecked() };
```

Important framing: do not reuse the older "argv reachability" wording without a current call-path proof. The confirmed claim is the safe API contract. Current source has representative `fmt::s` uses in `bun_core::output`, `install/extract_tarball.rs`, and package-manager directory/error paths, but each production path's byte source should be classified separately.

## Fat-Pointer / Lifetime Cast Spot-Checks

These look scary but should not be promoted without stronger evidence:

- `src/clap/args.rs:123`: `&ZStr` to `&[u8]` over `#[repr(transparent)] struct ZStr([u8])`. This is a layout-cast over a process-static argv view; no new UB finding from this pass.
- `src/ptr/lib.rs:337-345`: `boxed_slices_as_borrowed<T>` reinterprets `&[Box<[T]>]` as `&[&[T]]`. This is explicitly `unsafe`, `#[doc(hidden)]`, tied to the caller borrow, and debug-checks first/last fat-pointer field order. It remains a contractual / auditor-fragile helper, not a fresh confirmed UB finding.
- `src/runtime/api/filesystem_router.rs:790`: `Vec::from_raw_parts` lifetime erasure for `route_param::Param<'static>`. Already covered by the `F-L-8` good-citizen `unsafe fn detach_lifetime` cluster: ownership is moved into the same heap-stable `MatchedRoute`, not leaked past allocation lifetime.
- `src/runtime/cli/run_command.rs:3875-3882`: description-slice lifetime erasure for shell completions. The code parks the owning maps in `runner_arena()`, so this is a lifetime-contract site to keep reviewed, not a standalone UB proof.

## Unchecked UTF-8 Spot-Checks

Most `from_utf8_unchecked` call sites are locally discharged:

- fixed ASCII generation: UUID, hex, base64, permissions/time formatting, watcher trace error-kind strings, build option path bytes
- checked ASCII first: pwhash PHC strings, `parse_ascii`
- validated UTF-8 first: `bun_core::string::immutable::str_utf8`
- Rust string origins: `MimallocArena::ArenaString`, `PrettyBuf`, compile-target npm-name literals

`fmt::Raw` is different because its safe constructor accepts arbitrary `&[u8]` and the `Display` impl itself performs the unchecked conversion. That is why EXP-085 is the only new EXP from this sweep.

## Artifact Corrections Made

- Updated `FINAL_UB_REPORT.md` counts from 50/80 to 51/81.
- Removed stale `OPEN` / `OPEN-CLUSTER` verdicts from the final report table for F-A-2 and F-21-2. Historical `OPEN` rows remain only in `phase4_unified_findings.md`, where the note explicitly says that table preserves old statuses for traceability.
- Updated `phase4_unified_findings.md`, `phase8_remediation_plan.md`, and `UB_RUNBOOK.md` for EXP-085.

## Validation

```bash
python3 /home/ubuntu/.codex/skills/rust-undefined-behavior-exorcist/scripts/lint-experiment-designs.py \
  /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md

/home/ubuntu/.codex/skills/rust-undefined-behavior-exorcist/scripts/convergence-tracker.sh \
  /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive

git diff --stat -- . ':!.ub-exorcism' ':!.unsafe-audit'
```

Actual result:

```text
[OK] /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md — all blocks well-formed
```

```json
{
  "round": 48,
  "verdicts": {
    "OPEN": 0,
    "CONFIRMED_UB": 51,
    "NO_EVIDENCE": 13,
    "NEEDS_REFINEMENT": 0,
    "DEFERRED": 16,
    "RESOLVED": 1
  },
  "new_findings": 0,
  "new_needs_refinement": 0,
  "quiet": true,
  "prev_quiet": true
}
```

Source-tree diff outside audit artifacts remained empty.
