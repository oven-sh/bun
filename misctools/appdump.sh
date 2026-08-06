#!/bin/bash
# usage: appdump.sh <cli> <out.img> — CC snapshots itself (CLAUDE_CODE_SNAPSHOT_OUT) after the REPL settles
CLI=$1; OUT=$2; S=ccb$$; rm -f $OUT /tmp/$S.err
tmux new-session -d -s $S -x 120 -y 40 "env CLAUDE_CODE_SNAPSHOT_OUT=$OUT BUN_IMAGE_OUT=$OUT MIMALLOC_DETERMINISTIC_HINT=1 BUN_IMAGE_JIT_ADDR=0x3c0000000 BUN_JSC_useGenerationalGC=${GENGC:-1} BUN_GC_IDLE_SHRINK_DISABLE=1 $EXTRA $CLI --debug-file /tmp/cc-app.log 2>/tmp/$S.err; echo EXITED rc=\$? >> /tmp/$S.err; sleep 5"
T0=$(date +%s); until grep -q "EXITED" /tmp/$S.err 2>/dev/null || [ $(( $(date +%s) - T0 )) -ge 120 ]; do sleep 2; done
tr '\033' '\n' < /tmp/$S.err | grep -a "\[image\] wrote\|EXITED\|quiet" | head -3 | cut -c1-140
tmux kill-session -t $S 2>/dev/null
