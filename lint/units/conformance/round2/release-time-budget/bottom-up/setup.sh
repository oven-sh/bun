#!/usr/bin/env bash
# usage: setup.sh   (no argument: the probes of probes/ name /tmp/rtb1a)
# Makes the three trees that the numbers of observed/ were taken on, from the worktree's commit, without touching the worktree:
#   /tmp/rtb1a/repo    V0: a scratch clone with the corpus (../../scratch.sh) and the binding of ../../runner-corpus-binding/top-down
#   /tmp/rtb1a/after   V1: V0 with runner.patch; its corpus is a link to that of V0
#   /tmp/rtb1a/v3      V3: V1 with conformance-test-prototype.patch; its corpus is a link to that of V0
#   /tmp/rtb1a/runner-orig   the runner as committed, for the probes that take a runner directory
# Then, for example:
#   bun probes/bench2.ts 9 before=/tmp/rtb1a/runner-orig after=/tmp/rtb1a/after/test/cli/lint/conformance/runner
#   bun probes/dump.ts <runner directory> /tmp/rtb1a/repo/test/cli/lint/conformance/corpus/cases <out file>     (the digest that two runners share)
#   /workspace/tools/lk probes/batch.sh      (the test file of the three trees, five runs warm and two cold; logs in /tmp/rtb1a/out/batch)
#   /workspace/tools/lk probes/batch2.sh     (the same with the preload that meters every test; then bun probes/percpu-show.ts <json> <log>)
#   python3 probes/evict.py <directory>      (drops the page cache of the files below a directory)
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root=/tmp/rtb1a
mkdir -p "$root/out"
bash "$here/../../scratch.sh" "$root/repo"
bash "$here/../../runner-corpus-binding/top-down/apply.sh" "$root/repo"
home=test/cli/lint/conformance
cp -r "$root/repo/$home/runner" "$root/runner-orig"
for tree in after v3; do
  mkdir -p "$root/$tree"
  (cd "$root/repo" && tar cf - --exclude="./$home/corpus" --exclude=./.git .) | (cd "$root/$tree" && tar xf -)
  ln -s "$root/repo/$home/corpus" "$root/$tree/$home/corpus"
  (cd "$root/$tree" && patch -p1 -s < "$here/runner.patch")
done
(cd "$root/v3" && patch -p1 -s < "$here/conformance-test-prototype.patch")
mkdir -p "$root/probes" && cp "$here"/probes/* "$root/probes/"
echo "trees at $root: repo (V0), after (V1), v3 (V3)"
