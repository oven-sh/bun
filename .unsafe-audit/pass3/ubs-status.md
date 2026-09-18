# UBS status for Codex pass 3

**Date:** 2026-05-15.
**Purpose:** Auxiliary scanner signal for the Codex pass-3 unsafe audit.

## Full Rust scan

Command shape:

```sh
ubs --only=rust --format=jsonl --ci --skip-size-check src
```

Output file: `pass3/ubs-rust.jsonl`.

Result:

- Files scanned: 1,381
- Critical: 1,659
- Warning: 32,540
- Info: 43,537
- Runtime: 752s
- Exit status: non-zero because findings exist

The JSONL emitted by this UBS configuration contains only scanner/totals
records, not individual findings.

## Targeted corroboration scan

Command shape:

```sh
ubs --only=rust --format=json --ci --skip-size-check \
  --beads-jsonl=pass3/ubs-targeted-findings.jsonl \
  --files=<12 pass-3 evidence files> src
```

Output files:

- `pass3/ubs-targeted-findings.jsonl`
- `pass3/ubs-targeted-summary.json` (ignored by nested audit git)

Result:

- Files scanned: 12
- Critical: 6
- Warning: 755
- Info: 605
- Runtime: 21s
- Exit status: non-zero because findings exist

Even with `--beads-jsonl`, this run also emitted summary/totals records only.

## Interpretation

These UBS runs confirm that the selected Rust surface is dense with unsafe-risk
patterns, but they do **not** independently identify the pass-3 issues. The
pass-3 findings are therefore grounded in manual source reading and should be
validated with targeted compile tests, miri/provenance harnesses where possible,
and review by a Bun maintainer familiar with the JSC/task invariants.
