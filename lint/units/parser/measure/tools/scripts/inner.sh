#!/bin/bash
# runs under the heavy lock: records when the lock was acquired and the worktree state, then runs the command
name=$1; shift
date +%s > /tmp/parser-base/$name.lockacq
cd /workspace/wt/parser || exit 99
echo "# HEAD $(git rev-parse --short=10 HEAD) dirty: [$(git status --porcelain --untracked-files=no | tr '\n' ';')]"
exec "$@"
