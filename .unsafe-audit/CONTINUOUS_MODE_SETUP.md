# Continuous-Mode Drift Detection — Setup

Per the skill's `CONTINUOUS-MODE.md` doctrine, this audit has a local-only
continuous-mode setup recipe for ongoing drift detection. The cron job has
**not** been installed by this artifact, and generated baseline/drift outputs
are intentionally ignored by `.unsafe-audit/.gitignore` unless a human writes a
small summary file.

## Files

| File | Role |
|------|------|
| `.unsafe-audit/continuous-mode.toml` | Local per-project drift config (thresholds, cadence, policy); ignored by git by default |
| `.unsafe-audit/unsafe-inventory.jsonl` | Canonical frozen baseline of 11,044 unsafe sites at audit time |
| `~/.claude/skills/rust-unsafe-code-exorcist/scripts/cron-drift-check.sh` | The drift-detection script |

## How it works

1. The cron script re-runs ast-grep enumeration on current source.
2. Diffs against the baseline inventory.
3. Produces a local drift report at `.unsafe-audit/drift/YYYY-MM-DD/`.
4. If drift exceeds thresholds in `continuous-mode.toml`, writes a local alarm file. Bead/GitHub integration should be wired only after maintainers choose a policy.

## Detected drift classes

- **New unsafe site** — a new `unsafe` block appeared since baseline. Audit-author should classify it.
- **Modified-site** — an existing unsafe block's normalized text changed (could indicate a fix, could indicate a new bug). Audit-author should re-classify.
- **Geiger increase** — total per-crate unsafe count went up.
- **Harness failure** — verify.sh started failing for a previously-clean crate.

## To enable nightly locally

Add this to crontab (`crontab -e`):

```cron
0 3 * * * bash ~/.claude/skills/rust-unsafe-code-exorcist/scripts/cron-drift-check.sh .unsafe-audit . >> /var/log/bun-unsafe-drift.log 2>&1
```

That runs the drift check at 03:00 daily and appends output to a log. This audit
does not enable the cron job automatically.

## To suspend without removing

Edit `.unsafe-audit/continuous-mode.toml` and set:

```toml
[continuous]
enabled = false
```

The script exits early when `enabled = false`.

## Manual one-shot

```bash
bash ~/.claude/skills/rust-unsafe-code-exorcist/scripts/cron-drift-check.sh \
  .unsafe-audit \
  .
```

Outputs a single-day drift report to `.unsafe-audit/drift/$(date -u +%Y-%m-%d)/`.

## Baseline

The canonical baseline is `.unsafe-audit/unsafe-inventory.jsonl`:
- 11,044 source-level unsafe sites
- Captured at audit time (2026-05-14 to 2026-05-15)
- Includes per-site normalized text + semantic category tags

Re-baselining after a major refactor wave should be explicit: re-run the full
audit, review the delta, then replace the canonical inventory or store a
human-written summary of the new baseline. Do not commit raw drift workdirs.
