#!/bin/bash
# usage: step.sh <name> <command...>; cwd of the command is /workspace/wt/parser
name=$1; shift
L=/workspace/notes/lint/units/parser/measure/base/logs
mkdir -p $L
rm -f $L/$name.rc /tmp/parser-base/$name.lockacq
s=$(date +%s)
echo "START $name $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) cmd: $*" >> $L/timeline.txt
/workspace/tools/lk /tmp/parser-base/inner.sh "$name" "$@" > $L/$name.log 2>&1
rc=$?
e=$(date +%s)
a=$(cat /tmp/parser-base/$name.lockacq 2>/dev/null || echo $s)
echo "END   $name rc=$rc wall=$((e-s))s lockwait=$((a-s))s run=$((e-a))s $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg)" >> $L/timeline.txt
echo $rc > $L/$name.rc
exit $rc
