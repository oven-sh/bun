#!/usr/bin/env bash
# usage: typecheck.sh [tree]   (default: /workspace/wt/conformance; a scratch clone of scratch.sh works too)
# Type-checks conformance.test.ts, sweep.ts, update-reference.ts and every runner module they import, with the
# compiler options of test/tsconfig.json, and prints only the errors below test/cli/lint. No workflow of CI
# type-checks test/, so this is the only type check that these files get. tsc and bun-types come from the
# worktree, which has node_modules.
set -euo pipefail
tree=$(cd -- "${1:-/workspace/wt/conformance}" && pwd)
wt=/workspace/wt/conformance
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/tsconfig.json" <<EOF
{
  "extends": "$wt/tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ESNext"],
    "ignoreDeprecations": "6.0",
    "baseUrl": "$tree/test",
    "paths": {
      "harness": ["./harness.ts"],
      "_util/*": ["./_util/*"],
      "bun:internal-for-testing": ["$wt/src/js/internal-for-testing.ts"]
    },
    "types": ["$wt/packages/bun-types"],
    "noEmit": true,
    "composite": false,
    "incremental": false,
    "skipLibCheck": true
  },
  "files": [
    "$tree/test/cli/lint/conformance.test.ts",
    "$tree/test/cli/lint/conformance/sweep.ts",
    "$tree/test/cli/lint/conformance/update-reference.ts"
  ]
}
EOF
"$wt/node_modules/.bin/tsc" -p "$tmp/tsconfig.json" > "$tmp/out.txt" 2>&1 || true
# tsc prints a path relative to the current directory: without a leading slash when that directory is the tree.
if grep -E "(^|/)test/cli/lint/" "$tmp/out.txt"; then exit 1; fi
echo "no type error below test/cli/lint ($(grep -c 'error TS' "$tmp/out.txt" || true) elsewhere, in files that these import)"
