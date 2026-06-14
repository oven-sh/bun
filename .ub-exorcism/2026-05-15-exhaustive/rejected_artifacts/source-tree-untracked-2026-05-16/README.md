# Quarantined Source-Tree Artifacts

These files appeared as untracked source-tree changes during the UB audit:

- `scripts/audit/bootstrap-vendor.sh`
- `scripts/audit/check-close-order.sh`
- `scripts/audit/check-registry-drift.sh`
- `scripts/regression-runner.sh`
- `test/js/bun/ffi/ffi-bare-jsvalue-regression.test.ts`

They were moved here to keep the Bun source tree clean and prevent accidental inclusion in a code PR.

Reasons:

- The `ffi-bare-jsvalue-regression.test.ts` file asserts the old EXP-109 root-loss hypothesis, which source review falsified for the production `JSCallback` path. It should not be committed as a regression test.
- `scripts/regression-runner.sh` references that invalid EXP-109 test and performs branch checkouts for negative controls. It needs redesign before it is safe as a project script.
- The `scripts/audit/*` files are audit-run helper concepts, not reviewed Bun source changes. If useful, they should be rewritten as `.ub-exorcism` artifacts first and only promoted to `scripts/` after maintainer review.

Do not commit these files to Bun as-is.

