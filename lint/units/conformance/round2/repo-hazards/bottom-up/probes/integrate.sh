#!/bin/bash
# Lays the binding prototype of the notes and the describe("repository") over the scratch clone's conformance.test.ts.
set -euo pipefail
cd /tmp/rh1a/repo
t=test/cli/lint/conformance.test.ts
git checkout -q -- test/cli/lint/conformance.test.ts test/cli/lint/conformance/runner test/cli/lint/conformance/sweep.ts
bash /workspace/notes/lint/units/conformance/round2/corpus-glue/bottom-up/apply.sh /tmp/rh1a/repo
grep -n '^import { dirname, join } from "node:path";$' $t
sed -i 's|^import { dirname, join } from "node:path";$|import { basename, dirname, extname, join, relative, sep } from "node:path";|' $t
line=$(grep -n '^describe("directives", () => {$' $t | cut -d: -f1)
head -n $((line - 1)) $t > /tmp/rh1a/t.new
cat /tmp/rh1a/describe.final.ts >> /tmp/rh1a/t.new
echo >> /tmp/rh1a/t.new
tail -n +$line $t >> /tmp/rh1a/t.new
cat /tmp/rh1a/t.new > $t
git diff --stat -- $t
