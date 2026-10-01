#!/usr/bin/env bash
# usage: setup.sh   (no argument: the probes name /tmp/test-budget-1a)
# Makes the trees that the numbers of observed/ were taken on, from the commit of the worktree, without touching the worktree:
#   /tmp/test-budget-1a/repo     a scratch clone with the corpus (../../../scratch.sh) and the glue of ../../../corpus-glue/bottom-up (apply.sh);
#                                the digests of the glue files as they were are in ../observed/glue.sha256
#   /tmp/test-budget-1a/listed   the same files, its corpus a link to that of repo, and an expectations.json with 128 names of class C
#                                (every fourth instance of conformance/es6/ that passes under a release build with --lint)
#   /tmp/test-budget-1a/knobs    the same files, its corpus a link, and ../prototype/conformance.test.ts.knobs.patch applied
# Then, each under one hold of the lock:
#   /workspace/tools/lk bash probes/batch1.sh    final glue: release cold and warm, with a meter, with listed names; debug plain, leak, exception checks
#   /workspace/tools/lk bash probes/batch2.sh    the knobs: the same modes, and the environment of scripts/runner.node.ts
#   /workspace/tools/lk bash probes/batch3.sh    the time between the tests of a release run
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
notes=$(cd -- "$here/../../.." && pwd)
B=/tmp/test-budget-1a
H=test/cli/lint/conformance
mkdir -p $B/out $B/probes
cp "$here"/* $B/probes/
bash "$notes/scratch.sh" $B/repo
bash "$notes/corpus-glue/bottom-up/apply.sh" $B/repo
for tree in listed knobs; do
  mkdir -p $B/$tree
  (cd $B/repo && tar cf - --exclude=./$H/corpus --exclude=./.git .) | (cd $B/$tree && tar xf -)
  ln -s $B/repo/$H/corpus $B/$tree/$H/corpus
done
(cd $B/knobs && patch -p1 -s < "$here/../prototype/conformance.test.ts.knobs.patch")
# The names of list C of the tree "listed": a sweep of one directory with a release build that has --lint, four processes at a time.
(cd $B/repo && /workspace/wt/parser/build/release/bun $H/sweep.ts --jobs 4 --kind C --report $B/out/es6-C.json conformance/es6/ > /dev/null)
bun -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("/tmp/test-budget-1a/out/es6-C.json", "utf8"));
const { formatExpectations, compareNames } = require("/tmp/test-budget-1a/repo/test/cli/lint/conformance/runner");
const names = Object.entries(r.instances).filter(([, v]) => v.kind === "C" && v.outcome === "pass").map(([n]) => n);
const picked = names.sort(compareNames).filter((_, i) => i % 4 === 0).slice(0, 128);
fs.writeFileSync("/tmp/test-budget-1a/listed/test/cli/lint/conformance/expectations.json", formatExpectations({ level: "baseline", E: [], C: picked.sort(compareNames) }));
'
echo "trees at $B: repo, listed, knobs"
