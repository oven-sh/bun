#!/bin/sh
# usage: step.sh <name> <cwd> <command...>   runs the command through the lock helper, logs to /tmp/parser-bb/<name>.log
name="$1"; cwd="$2"; shift 2
log=/tmp/parser-bb/$name.log
done_file=/tmp/parser-bb/$name.done
rm -f "$done_file"
cd "$cwd" || { echo "exit=cd-failed" > "$done_file"; exit 1; }
{
  echo "### step=$name cwd=$cwd"
  echo "### cmd: /workspace/tools/lk $*"
  echo "### queued: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$log"
q=$(date +%s)
/workspace/tools/lk sh -c 'echo "### lock acquired: $(date -u +%Y-%m-%dT%H:%M:%SZ)"; s=$(date +%s); "$@"; rc=$?; echo "### finished: $(date -u +%Y-%m-%dT%H:%M:%SZ) rc=$rc run_secs=$(( $(date +%s) - s ))"; exit $rc' sh "$@" >> "$log" 2>&1
rc=$?
echo "exit=$rc total_secs=$(( $(date +%s) - q ))" > "$done_file"
