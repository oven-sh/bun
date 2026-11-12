#!/bin/bash
# Push the scripts and baselines of this directory to the scratch branch.
cd /workspace/bun || exit 1
export GIT_INDEX_FILE=/tmp/scratch-index
rm -f "$GIT_INDEX_FILE"
git read-tree --empty
for f in /workspace/jsx-matrix/*.ts /workspace/jsx-matrix/*.py /workspace/jsx-matrix/*.sh /workspace/jsx-matrix/*.md /workspace/jsx-matrix/*.rs /workspace/jsx-matrix/*.jsonl; do
  [ -f "$f" ] || continue
  blob=$(git hash-object -w "$f")
  git update-index --add --cacheinfo 100644,"$blob",jsx-matrix/"$(basename "$f")"
done
tree=$(git write-tree)
commit=$(git commit-tree -S "$tree" -m "scratch: JSX output matrix scripts and baselines (not for merge)")
unset GIT_INDEX_FILE
git push -q -f origin "$commit":refs/heads/robobun/c55aa873/jsx-matrix-scratch && echo "saved $commit"
