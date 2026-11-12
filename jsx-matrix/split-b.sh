#!/bin/bash
# Rebuild the second commit of the PR from the final tree (HEAD). The first commit stays as pushed.
set -e
cd /workspace/bun
FINAL=$(git rev-parse HEAD); A2=0345c8daf4a61caac850ba45d8c0c2b89fb5fd15
B2=$(git commit-tree -S $(git rev-parse $FINAL^{tree}) -p $A2 -F /workspace/jsx-matrix/commit-msg-b.md)
echo $A2 > /tmp/A2; echo $B2 > /tmp/B2
echo "A2=$A2 B2=$B2 FINAL=$FINAL"
git diff --stat $B2 $FINAL | tail -1
echo "files of the first commit that the second one changes (expect only jsx.rs and tsconfig_json.rs of src, plus none of Arguments.rs, bunfig.rs, JSBundler.rs, parallel.test.ts):"
git diff --stat $A2 $B2 -- src/runtime/cli/Arguments.rs src/bunfig/bunfig.rs src/runtime/api/JSBundler.rs test/cli/test/parallel.test.ts | tail -1
