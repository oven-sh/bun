# Codex Review - Phase 0 + Seed Registry

**Reviewed:** 2026-05-15, while Claude's Phase 1 batch 1 was starting  
**Scope:** `phase0_run.json`, `phase0_partition.json`, `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`

## Fixes Applied

1. **Experiment registry template compliance.** The registry failed the UB-exorcist linter for EXP-007 through EXP-013 because several entries lacked `Falsifiability`, `Invocation`, and in one case `Minimal reproducer` / `Expected signal`. I added conservative placeholder fields so the registry now passes:

   ```text
   [OK] .ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md -- all blocks well-formed
   ```

2. **EXP-002 source-shape correction.** The initial Linux errno reproducer used `#[repr(u32)]` and `transmute::<u32, SystemErrno>`. Current Bun POSIX errno is `#[repr(u16)]` and the live bug is `core::mem::transmute::<u16, E>(int as u16)`. I corrected the witness to match current `src/errno/linux_errno.rs`.

3. **EXP-003 enum-name correction.** Current `HasInstallScript` variants are `Old = 0`, `False = 1`, `True = 2`, not `No/Yes/Unknown`. The invalid-discriminant claim is unchanged, but the artifact now mirrors source.

4. **EXP-008 / EXP-009 reachability wording.** The semver packed `(off, len)` issue should be described as lockfile/string-pool byte reachability unless a separate package-json parser path is proven. I removed the over-specific "package.json range syntax" wording.

5. **EXP-010 bundler wording.** I changed "prior audit confirmed under Stacked / Tree Borrows" to "promoted as high-confidence structural Stacked/Tree Borrows UB." Do not call it miri-confirmed until a minimized dynamic log exists.

6. **Build prerequisite wording.** `phase0_run.json` now reflects that cargo-direct miri can still hit `bun_core` generated `build_options.rs`, because `bun bd --configure-only` is currently blocked locally by missing `clang >=21.1.0 <21.1.99`.

## Remaining Issues / Watchpoints

1. **Partition arithmetic drift.** `phase0_partition.json` says `total_unsafe_sites_from_prior_audit = 11044`, but the sum of `site_count_prior` across the 21 sections is `11046`:

   ```text
   jq '[.sections[].site_count_prior] | add' phase0_partition.json
   # 11046
   ```

   This is minor if the section counts are approximate, but the artifact should say that explicitly or fix the two-count mismatch before public use.

2. **Installed-tool policy.** `semgrep` was installed with `pip --user --break-system-packages` after PEP 668 blocked the normal install. It appears to work (`semgrep 1.163.0`), but the artifact should not imply this was risk-free. It modifies the user Python environment.

3. **EXP-013 is not strict Rust memory UB yet.** Signal-handler async-signal-safety is serious and may be UB under POSIX/C-library rules, but keep it separate from miri-confirmed Rust memory UB unless the call graph proves a Rust unsafe-boundary violation.

4. **EXP-007 / EXP-008 / EXP-009 remain placeholders.** They are now well-formed, but still need concrete minimal reproducers before Phase 5 can change their verdicts.

5. **`-Zmiri-check-number-validity` drift.** My parallel guard run found this installed nightly rejects that flag. Plain miri still catches enum invalidity. Claude's later miri commands should avoid the stale flag unless a different nightly is selected.

