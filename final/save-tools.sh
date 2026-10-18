#!/bin/bash
# Saves /tmp/h2repro/final/* (text files) to the tools branch without touching the checkout.
set -e
cd /workspace/bun
git fetch -q origin robobun/d972025c/tools
PARENT=$(git rev-parse FETCH_HEAD)
export GIT_INDEX_FILE=/tmp/h2repro/tools.index
rm -f $GIT_INDEX_FILE
git read-tree $PARENT
for f in /tmp/h2repro/final/*.md /tmp/h2repro/final/*.py /tmp/h2repro/final/*.sh /tmp/h2repro/final/*.txt /tmp/h2repro/save-tools.sh /tmp/h2repro/c-37985.md /tmp/h2repro/c-44335.md; do
  [ -f "$f" ] || continue
  blob=$(git hash-object -w "$f")
  git update-index --add --cacheinfo 100644,$blob,final/$(basename $f)
done
TREE=$(git write-tree)
unset GIT_INDEX_FILE
if [ "$TREE" = "$(git rev-parse $PARENT^{tree})" ]; then echo "no change"; exit 0; fi
C=$(git commit-tree $TREE -p $PARENT -m "tools: final texts")
git push -q origin $C:refs/heads/robobun/d972025c/tools
echo "saved $C"
