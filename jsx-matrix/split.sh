#!/bin/bash
# Rebuild the two commits of the PR from the final tree (HEAD).
set -e
cd /workspace/bun
FINAL=$(git rev-parse HEAD); A=137c00c053e; BASE=447ff870b60
python3 /tmp/make-a-files.py >/dev/null
export GIT_INDEX_FILE=/tmp/split-index; rm -f $GIT_INDEX_FILE
git read-tree $A
for f in src/runtime/cli/Arguments.rs src/bunfig/bunfig.rs src/runtime/api/JSBundler.rs test/cli/test/parallel.test.ts; do
  git update-index --cacheinfo 100644,$(git rev-parse $FINAL:$f),$f
done
git update-index --cacheinfo 100644,$(git hash-object -w /tmp/a-jsx.rs),src/options_types/jsx.rs
git update-index --cacheinfo 100644,$(git hash-object -w /tmp/a-tsconfig_json.rs),src/resolver/tsconfig_json.rs
TREE_A=$(git write-tree)
A2=$(git commit-tree -S $TREE_A -p $BASE -F /tmp/msg-a.txt)
B2=$(git commit-tree -S $(git rev-parse $FINAL^{tree}) -p $A2 -F /tmp/msg-b.txt)
unset GIT_INDEX_FILE
echo $A2 > /tmp/A2; echo $B2 > /tmp/B2
echo "A2=$A2 B2=$B2 FINAL=$FINAL"
git diff --stat $B2 $FINAL | tail -1
