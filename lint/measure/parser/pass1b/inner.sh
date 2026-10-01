#!/bin/bash
# runs under the heavy lock: records lock acquisition, then runs the command in the given directory
name=$1; dir=$2; shift 2
date +%s > /tmp/pbb1b/logs/$name.lockacq
cd "$dir" || exit 99
echo "# dir $dir HEAD $(git rev-parse --short=10 HEAD 2>/dev/null) dirty: [$(git status --porcelain --untracked-files=no 2>/dev/null | tr '\n' ';')]"
exec "$@"
