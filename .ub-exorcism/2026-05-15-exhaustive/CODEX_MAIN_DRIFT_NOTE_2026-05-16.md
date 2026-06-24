# Codex Main-Branch Drift Note — 2026-05-16

This UB audit is pinned to the source tree at:

- Audit branch: `claude/ub-exorcist-audit`
- Audited base: `origin/main@4d443e5402`
- Run id: `2026-05-15-exhaustive`

After the run and the later Codex defensibility corrections, a fresh fetch on
2026-05-16 found that upstream `origin/main` had advanced to:

- Latest fetched `origin/main`: `e750984db6`
- New commits after the audited base:
  - `e750984db6 cargo fmt`
  - `880ee8929f Clean up Zig-port phase comments and trivial lint warnings (#30877)`
  - `e520065ebb Harden 36 reachable security findings across runtime, install, parsers, http (#30722)`
  - `f7c692ae9c Fix worker teardown crash from missing dupeRef on synthetic-module specifiers (#30882)`
  - `8438ff7baa resolver: split the port's module wrapper into files; type the extern-Rust pointers (#30880)`
  - `f85020a32f hooks: deny direct rustfmt, point at cargo fmt --all (#30881)`
  - `2a3d0e7d29 resolver: keep forward slashes when imports target is a package specifier (#30845)`

The hardening commit is material: `git show --stat e520065ebb -- src
packages/bun-native-plugin-rs` reports 31 Rust files changed, 716 insertions,
118 deletions.

The worker-teardown commit is also material for honesty, though in a different
way: `f7c692ae9c` fixes an additional `ResolvedSource` / `SourceProvider`
refcount bug in `src/runtime/jsc_hooks.rs` that was present at the audited
base but not promoted into the registry. Latest main has the fix; the registry
should not claim it as a live finding, but public summaries should not imply
the audit found every issue that existed at `4d443e5402`.

## Interpretation

The artifacts in this directory remain evidence for `origin/main@4d443e5402`.
They should **not** be quoted as a latest-`origin/main` live-UB count after
`e750984db6` without the W4 refresh table and per-EXP replay status.

Correct public wording:

> The UB exorcist run found 70 confirmed UB-class findings against
> `origin/main@4d443e5402`. Upstream main has since advanced, including
> a broad hardening commit (`e520065ebb`); the W4 refresh confirms several
> high-priority findings are still live, but per-EXP replay is still required
> before quoting an exact latest-main count.

Current correction: earlier versions of this drift note said 58 and then 68.
Later Codex passes promoted additional confirmed entries through EXP-111 and
demoted EXP-109, so the final pinned-base registry contains **70
`CONFIRMED_UB` entries** against `origin/main@4d443e5402`. Quote 70 for the
pinned-base registry, not as an exact latest-main live count.

Incorrect public wording:

> Latest Bun main still has exactly 70 confirmed UB findings.

## Recommended Refresh

Run `/rust-undefined-behavior-exorcist` in W4 already-mature refresh mode:

1. Rebase or recreate the audit branch from `origin/main@e750984db6`.
2. Carry over this run's registry as the committed baseline.
3. For each `CONFIRMED_UB` entry, re-check only the source anchors and
   reproducer harnesses whose touched files appear in
   `git diff --name-only 4d443e5402..e750984db6`.
4. Produce a delta table with statuses:
   - `STILL_LIVE`
   - `FIXED_BY_<commit>`
   - `PARTIALLY_FIXED`
   - `STALE_LINE_ONLY`
   - `NEW_FINDING`
5. Update `FINAL_UB_REPORT.md` only after that delta table exists.
