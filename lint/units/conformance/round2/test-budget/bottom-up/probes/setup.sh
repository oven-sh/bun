#!/usr/bin/env bash
# usage: setup.sh   (no argument: the probes name /tmp/test-budget-1a)
# Makes the trees that the numbers of observed/ were taken on, from the commit of the worktree, without touching the worktree:
#   repo     a scratch clone with the corpus (../../../scratch.sh) and the glue of ../../../corpus-glue/bottom-up (apply.sh); the digests
#            of the glue files as they were are in ../observed/glue.sha256. The test file is the one of the commit.
#   listed   the same files, its corpus a link to that of repo, and an expectations.json with 128 names of class C (every fourth
#            instance of conformance/es6/ that passes under a release build with --lint)
#   knobs    the test file of batch 2, 3 and 4: ../prototype/as-measured-in-batch-2.knobs.patch.txt (no time of a check, 60 s for a test with a process)
#   knobs2   the test file of batch 5: ../prototype/as-measured-in-batch-5.knobs2.patch.txt
#   final    the test file as proposed: ../prototype/conformance.test.ts.knobs.patch (batch 6 and the type check of batch 5)
# Then, each under one hold of the lock (/workspace/tools/lk bash probes/batchN.sh):
#   batch1   repo and listed: release cold and warm, with a meter of every test, with the release build that has --lint; debug plain,
#            with the leak check, with the exception checks, and listed with the leak check
#   batch2   knobs: release cold and warm, the form of a release lane of CI, debug in four environments
#   batch3   repo and knobs, release: the time between the tests
#   batch4   repo and knobs turn by turn, release: three cold and three warm runs each; knobs without the tests that start processes
#   batch5   knobs2: release, the form of CI, debug with the leak check twice and with the exception checks; the type check of final
#   batch6   final: release, the form of CI, debug with the leak check
# accept.sh is the same acceptance for the worktree once the corpus and the glue are committed there.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
notes=$(cd -- "$here/../../.." && pwd)
B=/tmp/test-budget-1a
H=test/cli/lint/conformance
mkdir -p $B/out $B/probes
cp "$here"/* $B/probes/
bash "$notes/scratch.sh" $B/repo
bash "$notes/corpus-glue/bottom-up/apply.sh" $B/repo
for tree in listed knobs knobs2 final; do
  mkdir -p $B/$tree
  (cd $B/repo && tar cf - --exclude=./$H/corpus --exclude=./.git .) | (cd $B/$tree && tar xf -)
  ln -s $B/repo/$H/corpus $B/$tree/$H/corpus
done
(cd $B/knobs && patch -p1 -s < "$here/../prototype/as-measured-in-batch-2.knobs.patch.txt")
(cd $B/knobs2 && patch -p1 -s < "$here/../prototype/as-measured-in-batch-5.knobs2.patch.txt")
(cd $B/final && patch -p1 -s < "$here/../prototype/conformance.test.ts.knobs.patch")
cp $B/final/test/cli/lint/conformance.test.ts $B/out/knobs-final.ts
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
echo "trees at $B: repo, listed, knobs, knobs2, final"
