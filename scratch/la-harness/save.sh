#!/bin/bash
# Saves the scratch files to the branch robobun/399843a7/scratch (not part of the PR).
# Restore: git fetch origin robobun/399843a7/scratch && git archive FETCH_HEAD scratch | tar -x -C /tmp && cp -r /tmp/scratch/la-harness /tmp/ && cp /tmp/scratch/*.* /tmp/
set -euo pipefail
cd /workspace/bun
export GIT_INDEX_FILE=/tmp/scratch.index
rm -f "$GIT_INDEX_FILE"
git read-tree origin/main
add() { local blob; blob=$(git hash-object -w "$1"); git update-index --add --cacheinfo 100644,"$blob","$2"; }
for f in harness.c build.sh sweep.sh gen.mjs save.sh apply_tar.py; do add /tmp/la-harness/$f scratch/la-harness/$f; done
for f in /tmp/design.json /tmp/la-harness/NOTES.md /tmp/la-harness/genbench.mjs; do
  [ -f "$f" ] && add "$f" "scratch/$(basename "$f")"
done
tree=$(git write-tree)
commit=$(timeout 120 git commit-tree --no-gpg-sign "$tree" -p origin/main -m "scratch: libarchive split harness (not for merge)")
timeout 300 git push -q -f origin "$commit":refs/heads/robobun/399843a7/scratch
echo "saved $commit"
