# Codex Uninit Scratch-Buffer Sweep — 2026-05-16

Purpose: revisit Phase-2 Bucket 5 after a fresh ast-grep run surfaced the
`MaybeUninit::uninit().assume_init()` primitive-array pattern. This sweep is a
defensibility correction: it overturns one earlier Phase-2 assumption.

## Promotion

### EXP-089 — primitive scratch arrays constructed from uninitialized storage

Source:

- `src/bun_core/util.rs:997-1003` — `PathBuffer::uninit() -> PathBuffer([u8; N])`
- `src/bun_core/util.rs:1045-1050` — `WPathBuffer::uninit() -> WPathBuffer([u16; N])`
- `src/install/lockfile/Tree.rs:87-91` — `depth_buf_uninit() -> [u32; N]`

Original Phase-2 framing said these were "sound for current caller" because
every bit pattern is valid for `u8`, `u16`, and `u32`, and callers allegedly
never read unwritten slots. That was conceptually wrong. Uninitialized memory
is not an initialized integer value. `MaybeUninit::assume_init()` requires the
whole `T` to be initialized, even if all bit patterns of `T` are otherwise
valid.

The reproducer in `experiments/EXP-089` mirrors the three source shapes. Miri
reports:

```text
error: Undefined Behavior: constructing invalid value of type PathBuffer: at .0[0], encountered uninitialized memory, but expected an integer
  --> src/main.rs:13:14
```

Verdict: `CONFIRMED_UB`. This is immediate construction UB, not a conditional
read-before-write hazard.

## Non-Promotions

- `src/sql_jsc/shared/CachedStructure.rs:58` remains sound: it constructs
  `[MaybeUninit<ExternColumnIdentifier>; 70]`, and the element type itself is
  `MaybeUninit<T>`.
- `src/sys/lib.rs:275-292` `AlignedBuf(MaybeUninit<[u8; BUF_SIZE]>)` remains
  the correct pattern: the uninitialized array stays wrapped, and callers only
  expose initialized prefixes through `unsafe fn filled(len)`.
- `bun_core::ffi::zeroed<T: Zeroable>()` remains a separate validity question;
  zero-initialized integers are initialized values. EXP-089 is about fresh
  uninitialized storage, not all-zero storage.

## Fix Shape

Do not return a primitive array value unless it is initialized.

Reasonable fixes:

- Short-term safe patch: revert `PathBuffer::uninit`, `WPathBuffer::uninit`,
  and `depth_buf_uninit` to zero-initialized arrays. This restores correctness
  with the smallest review surface but reintroduces the documented memset cost.
- Performance-preserving patch: represent scratch buffers as
  `MaybeUninit<[T; N]>` / `[MaybeUninit<T>; N]` and expose only raw write
  pointers plus explicitly initialized prefixes. `src/sys/lib.rs` `AlignedBuf`
  is the local template.

The comments at the promoted sites must be rewritten. "Every bit pattern is
valid" is insufficient for `assume_init()` on uninitialized integers.

## Artifact Impact

- Added `EXP-089` to `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`.
- Added `experiments/EXP-089` and `phase5_experiment_results/EXP-089.log`.
- Corrected `phase2_findings_05_uninit.md` Anti-pattern C.
- Updated `phase4_unified_findings.md`, `phase8_remediation_plan.md`,
  `FINAL_UB_REPORT.md`, `UB_RUNBOOK.md`, and convergence round 52 to 85
  registry entries / 55 `CONFIRMED_UB` at the time of this sweep. Later
  follow-ups continued through EXP-111 and superseded the interim 94-entry /
  60-confirmed checkpoint; use `FINAL_UB_REPORT.md` for the current pinned-base
  count.
