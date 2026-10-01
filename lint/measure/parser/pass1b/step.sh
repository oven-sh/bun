#!/bin/bash
# usage: step.sh <name> <dir> <command...>; runs the command under /workspace/tools/lk, logs to /tmp/pbb1b/logs
name=$1; dir=$2; shift 2
L=/tmp/pbb1b/logs
rm -f $L/$name.rc $L/$name.lockacq
s=$(date +%s)
echo "START $name $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) dir=$dir cmd: $*" >> $L/timeline.txt
/workspace/tools/lk /tmp/pbb1b/inner.sh "$name" "$dir" "$@" > $L/$name.log 2>&1
rc=$?
e=$(date +%s)
a=$(cat $L/$name.lockacq 2>/dev/null || echo $s)
echo "END   $name rc=$rc wall=$((e-s))s lockwait=$((a-s))s run=$((e-a))s $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg)" >> $L/timeline.txt
echo $rc > $L/$name.rc
exit $rc
