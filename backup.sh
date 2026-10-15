#!/bin/bash
# Pushes /tmp/notes as one commit to refs/robobun-backup/0831da79/notes, and the work branch to its backup ref.
set -e
cd /workspace/bun
tmpidx=$(mktemp)
export GIT_INDEX_FILE=$tmpidx
rm -f $tmpidx
git --work-tree=/tmp/notes add -A . >/dev/null 2>&1
tree=$(git write-tree)
commit=$(echo "notes" | git commit-tree $tree)
unset GIT_INDEX_FILE
rm -f $tmpidx
git push -q -f origin $commit:refs/robobun-backup/0831da79/notes
git push -q -f origin HEAD:refs/robobun-backup/0831da79-autoinstall-install-ca-v2 2>/dev/null || true
echo "backed up notes $commit and branch $(git rev-parse --short HEAD)"
